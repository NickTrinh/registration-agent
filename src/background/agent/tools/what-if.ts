// `run_what_if` tool: schema, the executor (moved out of service-worker.ts),
// and the pure goal-assembly helper `buildWhatIfGoals` (unit-tested offline).
// Implements: ADR 0018 (buildWhatIfGoals), ADR 0019 (tool decomposition).
//
// DegreeWorks's What-If endpoint requires a FULL curriculum spec, not a partial
// one. Missing MAJOR or COLLEGE gives 403; missing CONC is OK only when the
// student has no current concentration. The native UI always sends
// [MAJOR, MINOR?, CONC?, COLLEGE] — we match that shape.
//
// Semantics: the student's explicit input overrides the cached current
// curriculum. If they said "add a philosophy minor", input has minor=PHIL but
// no major — we keep current MAJOR, current CONC, and add the new MINOR. If
// they said "switch to PSYC", input has major=PSYC and no conc — we keep CONC
// off (PSYC-specific concentrations differ from NEUR-specific ones; sending the
// old CONC would be semantically wrong).

import type { WhatIfGoal } from "../../../shared/degreeworks-types";
import {
  fetchWhatIfAudit,
  DegreeWorksAuthError,
  DegreeWorksNoTabError,
} from "../degreeworks-api-client";
import { auditResponseToText } from "../degreeworks-audit-to-text";
import type { ToolContext, ToolDef } from "./types";

export interface WhatIfInput {
  major?: string;
  minor?: string;
  concentration?: string;
  college?: string;
  classes?: string[];
}

// The subset of the cached student goal that goal assembly needs. The full
// StudentGoal (tools/types.ts) structurally satisfies this.
export interface WhatIfCurriculum {
  major: string;
  concentration: string | null;
  college: string;
}

export type BuildWhatIfGoalsResult =
  | { ok: true; goals: WhatIfGoal[] }
  | { ok: false; error: string };

// Assemble the What-If goal array from the student's explicit request plus
// their cached current curriculum. Returns an error result for the two cases
// the endpoint can't service: no declared major, and an empty (no-op) request.
export function buildWhatIfGoals(
  input: WhatIfInput,
  studentGoal: WhatIfCurriculum
): BuildWhatIfGoalsResult {
  const goals: WhatIfGoal[] = [];

  // MAJOR — always required. Use explicit override or current cached major.
  const majorValue = (input.major || studentGoal.major || "").toUpperCase();
  if (!majorValue) {
    return {
      ok: false,
      error: "Error: student has no declared major — What-If can't run without one.",
    };
  }
  goals.push({ code: "MAJOR", value: majorValue });

  // MINOR — only when the student asked about one.
  if (input.minor) {
    goals.push({ code: "MINOR", value: input.minor.toUpperCase() });
  }

  // CONC — explicit override OR (if the student has a current concentration
  // AND the major wasn't swapped) preserve it. When the model swaps major,
  // we drop the old concentration since it's typically major-tied.
  // NB: code is "CONC", not "CONCENTRATION" — confirmed via cURL.
  if (input.concentration) {
    goals.push({ code: "CONC", value: input.concentration.toUpperCase() });
  } else if (!input.major && studentGoal.concentration) {
    goals.push({ code: "CONC", value: studentGoal.concentration.toUpperCase() });
  }

  // COLLEGE — always required. Explicit override or current.
  const collegeValue = (input.college || studentGoal.college).toUpperCase();
  goals.push({ code: "COLLEGE", value: collegeValue });

  // Refuse a truly empty What-If (no user-specified changes). Otherwise the
  // request is just the student's current curriculum, which gives no new
  // info and wastes a round-trip.
  //
  // A classes-only request is NOT empty: it's the Look-Ahead mode of the same
  // unified endpoint (ADR 0006) — current curriculum in `goals`, hypothetical
  // courses in `classes`. "What if I take these three courses?" is a supported
  // shape and must reach the endpoint.
  const swapsCurriculum = !!(input.major || input.minor || input.concentration || input.college);
  const looksAhead = (input.classes?.length ?? 0) > 0;
  if (!swapsCurriculum && !looksAhead) {
    return {
      ok: false,
      error:
        "Error: What-If needs at least one of major, minor, concentration, or college to swap — " +
        "or a list of hypothetical classes to look ahead at. Otherwise it's identical to the real audit.",
    };
  }

  return { ok: true, goals };
}

export async function executeWhatIf(input: WhatIfInput, ctx: ToolContext): Promise<string> {
  // Re-hydrate module cache from chrome.storage.local if the service worker
  // was unloaded since the last audit refresh.
  let { id: studentId, goal: studentGoal } = await ctx.hydrateStudentCache();

  // Cache miss — either the extension was reset, it's a first-run that
  // never touched DegreeWorks, or storage was selectively wiped. Try to
  // heal by forcing a refresh; this only works if DegreeWorks is
  // authenticated in any tab of the same Chrome profile (cookie auth).
  // If the refresh succeeds we get studentId back transparently; if not
  // we surface a clear instruction to the student.
  if (!studentId || !studentGoal) {
    console.log("[FordhamHelper] What-If: student cache empty, attempting auto-refresh");
    try {
      await ctx.refreshAudit();
      ({ id: studentId, goal: studentGoal } = await ctx.hydrateStudentCache());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[FordhamHelper] What-If auto-refresh failed:", msg);
      return (
        "Error: I couldn't load your DegreeWorks record automatically. " +
        "Please open https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31 " +
        "in any tab of this browser, let your real audit load, then ask me the What-If again. " +
        "(This almost always means your Fordham session expired — logging in again fixes it.)"
      );
    }
    if (!studentId || !studentGoal) {
      return (
        "Error: I refreshed the audit but still can't see your student record. " +
        "Please open DegreeWorks at https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31, " +
        "confirm your real audit is visible there, then try again. " +
        "If DegreeWorks loads fine but this keeps failing, reload the extension from chrome://extensions."
      );
    }
  }

  // Assemble the What-If goal array (MAJOR/MINOR/CONC/COLLEGE) from the
  // explicit request + cached curriculum. Error results surface verbatim.
  const built = buildWhatIfGoals(input, studentGoal);
  if (!built.ok) return built.error;
  const goals = built.goals;

  const classes = (input.classes ?? [])
    .map((c) => {
      const parts = c.trim().split(/\s+/);
      return parts.length >= 2
        ? { discipline: parts[0].toUpperCase(), number: parts.slice(1).join(" ") }
        : null;
    })
    .filter((c): c is { discipline: string; number: string } => c !== null);

  try {
    const audit = await fetchWhatIfAudit(studentId, goals, {
      school: studentGoal.school,
      degree: studentGoal.degree,
      catalogYear: studentGoal.catalogYear,
      classes,
    });
    const text = auditResponseToText(audit);
    console.log(
      `[FordhamHelper] What-If audit completed: ${audit.blockArray?.length ?? 0} blocks, ` +
        `${audit.auditHeader?.percentComplete ?? "?"}% complete`
    );
    return text;
  } catch (err) {
    if (err instanceof DegreeWorksNoTabError) {
      console.warn("[FordhamHelper] What-If skipped: no DegreeWorks tab open.");
      return "Error: please open DegreeWorks in a tab, then retry this What-If question. (What-If queries need an active DegreeWorks session for cross-origin reasons.)";
    }
    if (err instanceof DegreeWorksAuthError) {
      console.warn("[FordhamHelper] What-If auth failed:", err.message);
      return "Error: DegreeWorks session expired. Log back into DegreeWorks and retry.";
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[FordhamHelper] What-If audit failed:", msg);
    return `Error running What-If audit: ${msg}`;
  }
}

const WHAT_IF_AUDIT_TOOL = {
  name: "run_what_if",
  description:
    "Run a hypothetical What-If audit against the student's real DegreeWorks data to show " +
    "how their degree progress would change under a different major, minor, or concentration. " +
    "Provide AT LEAST ONE of major / minor / concentration / classes — whichever the student is asking about. " +
    "Map the student's phrasing to the right field: " +
    "\"added/exploring a philosophy MINOR\" → pass { minor: 'PHIL' } (do NOT pass a major — " +
    "the real major is kept automatically). " +
    "\"switched to psychology\" → pass { major: 'PSYC' }. " +
    "\"added the XYZ concentration\" → pass { concentration: 'XYZ' }. " +
    "\"what if I take PSYC 3110 and PSYC 4200 next term?\" → pass { classes: ['PSYC 3110', 'PSYC 4200'] } " +
    "with no curriculum fields (Look-Ahead; the real curriculum is kept automatically). " +
    "Passing only the current major with nothing else is a NO-OP — don't do that. " +
    "Returns a full plain-text audit under the hypothetical scenario; compare against the " +
    "real audit in your system prompt and describe the differences.",
  input_schema: {
    type: "object" as const,
    properties: {
      major: {
        type: "string",
        description: "Major code, e.g. 'PSYC', 'CISC', 'ENGL'. Only include when the student is " +
          "SWITCHING to a new major. Omit for minor-only or concentration-only queries; the real major is kept.",
      },
      minor: {
        type: "string",
        description: "Minor code, e.g. 'PHIL', 'CISC'. Use this when the student asks about ADDING a minor.",
      },
      concentration: {
        type: "string",
        description: "Concentration code. Use this when the student asks about adding or switching a concentration.",
      },
      college: {
        type: "string",
        description:
          "Optional college code, e.g. 'FC' (Fordham College/Rose Hill), 'FL' (Fordham/Lincoln Center), 'GS' (Gabelli School of Business). " +
          "Defaults to the student's current college if omitted. Only set this when the student explicitly asks about TRANSFERRING schools " +
          "(\"what if I transferred to Gabelli?\"). For same-school major/minor/concentration swaps, omit it and the student's real college is used.",
      },
      classes: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional Look-Ahead: hypothetical courses to include, formatted as 'SUBJ 1234' " +
          "(e.g. ['PSYC 3110', 'PSYC 4200']). The audit engine treats these as if the " +
          "student is enrolled in them.",
      },
    },
  },
};

export const whatIfTool: ToolDef = {
  schema: WHAT_IF_AUDIT_TOOL,
  execute(input, ctx) {
    return executeWhatIf(input as WhatIfInput, ctx);
  },
};
