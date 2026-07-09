// Pure goal-assembly logic for the `run_what_if` tool, extracted from
// service-worker.ts so it can be unit-tested offline (no chrome, no network).
// Implements: ADR 0018 — see notes/decisions/.
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

import type { WhatIfGoal } from "../../shared/degreeworks-types";

export interface WhatIfInput {
  major?: string;
  minor?: string;
  concentration?: string;
  college?: string;
  classes?: string[];
}

// The subset of the cached student goal that goal assembly needs. The full
// StudentGoal (service-worker.ts) structurally satisfies this.
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
  if (!input.major && !input.minor && !input.concentration && !input.college) {
    return {
      ok: false,
      error:
        "Error: What-If needs at least one of major, minor, concentration, or college to swap — otherwise it's identical to the real audit.",
    };
  }

  return { ok: true, goals };
}
