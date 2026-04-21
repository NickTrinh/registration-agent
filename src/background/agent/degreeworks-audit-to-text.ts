// Render a DegreeWorks AuditResponse as compact plain text for Claude.
// Implements: ADR 0005 — see notes/decisions/.
//
// Target shape: ~8-12 kB of text that Haiku can digest for profile extraction
// and Sonnet can read as grounding context. Walks `blockArray` and recurses
// into each block's rule tree. Skips satisfied noise (already-complete `Complete`
// rules with no children) and unknown node types render as a bare label.
//
// Dispatch rules: match on `rule.ruleType` (symbolic) and `qualifier.name`
// (symbolic) — NEVER on the numeric `nodeType` mirror. All numeric fields in
// the audit are string-encoded; parse defensively with parseFloat / parseInt.
//
// PII: this renderer is the *only* path from audit → outbound text, so it is
// the boundary enforced by Fordham's Third-Party Data Transfer Policy. Safe by
// construction: identifying fields (student name, advisor name, advisor email)
// are emitted as literal placeholder tokens ([NAME], [ADVISOR], [ADVISOR_EMAIL])
// rather than read from the audit. Claude sees the tokens, echoes them verbatim,
// and the sidebar substitutes real values at render time from chrome.storage.local.
// DO NOT read h.studentName, g.advisorName, or g.advisorEmail in this file.

import type {
  AuditResponse,
  AuditBlock,
  AuditRule,
  TakenClass,
  AppliedClass,
  CourseMatcher,
  WithClause,
  Goal,
} from "../../shared/degreeworks-types";

const MAX_OUTPUT_CHARS = 12000;
const INDENT = "  ";

// ─── Entry point ──────────────────────────────────────────────────────────────

export function auditResponseToText(audit: AuditResponse): string {
  const parts: string[] = [];

  parts.push(renderHeader(audit));
  parts.push("");
  parts.push(renderGoals(audit.degreeInformation?.goalArray ?? []));
  parts.push("");
  parts.push(renderBlocks(audit.blockArray ?? []));
  parts.push("");
  parts.push(renderInProgress(audit.classInformation?.classArray ?? []));

  const full = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (full.length <= MAX_OUTPUT_CHARS) return full;
  return full.slice(0, MAX_OUTPUT_CHARS) + "\n\n[… audit truncated for length …]";
}

// ─── Section: header ──────────────────────────────────────────────────────────

function renderHeader(audit: AuditResponse): string {
  const h = audit.auditHeader;
  if (!h) return "DEGREEWORKS AUDIT (header missing)";

  const lines: string[] = [];
  lines.push("=== DEGREEWORKS AUDIT ===");
  lines.push("Student: [NAME]");
  if (h.whatIf === "Y") lines.push("Audit type: WHAT-IF (hypothetical)");
  if (h.degreeworksGpa) lines.push(`GPA: ${h.degreeworksGpa}`);
  if (h.percentComplete) lines.push(`Overall progress: ${h.percentComplete}% complete`);
  if (h.residentApplied) {
    const inProg = h.residentAppliedInProgress || "0";
    lines.push(`Credits applied: ${h.residentApplied} resident + ${h.transferApplied || 0} transfer (${inProg} in progress)`);
  }
  return lines.join("\n");
}

// ─── Section: active goals (major / minor / concentration) ────────────────────

function renderGoals(goals: Goal[]): string {
  if (!goals.length) return "";
  const relevant = goals.filter((g) =>
    ["MAJOR", "MINOR", "CONC", "COLLEGE", "PROGRAM", "ADVISOR"].includes(g.code)
  );
  if (!relevant.length) return "";

  const lines: string[] = ["--- Active goals ---"];
  for (const g of relevant) {
    if (g.code === "ADVISOR") {
      // PII boundary: never read g.advisorName / g.advisorEmail here. Emit
      // placeholder tokens verbatim; the sidebar substitutes real values at
      // render time from chrome.storage.local.
      lines.push("Advisor: [ADVISOR] <[ADVISOR_EMAIL]>");
    } else {
      const label = g.valueLiteral || g.value;
      lines.push(`${g.code}: ${label}${g.catalogYear ? ` (catalog ${g.catalogYear})` : ""}`);
    }
  }
  return lines.join("\n");
}

// ─── Section: requirement blocks ──────────────────────────────────────────────

function renderBlocks(blocks: AuditBlock[]): string {
  if (!blocks.length) return "--- No requirement blocks ---";

  const parts: string[] = [];
  for (const block of blocks) {
    parts.push(renderBlock(block));
    parts.push("");
  }
  return parts.join("\n").trim();
}

function renderBlock(block: AuditBlock): string {
  const lines: string[] = [];
  const pct = block.percentComplete || "0";
  const status = pct === "100" ? "COMPLETE" : `${pct}% complete`;
  lines.push(`### ${block.title || block.requirementType} [${status}]`);
  if (block.creditsApplied) {
    lines.push(`${INDENT}credits applied: ${block.creditsApplied}`);
  }

  const header = block.header;
  if (header?.qualifierArray?.length) {
    for (const q of header.qualifierArray) {
      if (q.text && isMeaningfulQualifier(q.name)) {
        lines.push(`${INDENT}• ${q.text}`);
      }
    }
  }

  for (const rule of block.ruleArray ?? []) {
    const rendered = renderRule(rule, 1);
    if (rendered) lines.push(rendered);
  }

  return lines.join("\n");
}

function isMeaningfulQualifier(name: string): boolean {
  // Skip qualifiers that are pure machinery and add no student-facing info
  const skip = new Set(["HEADERTAG", "BANNERHEADER", "HIDERULE", "BLOCKCONNECTOR"]);
  return !skip.has(name);
}

// ─── Rule tree walker ─────────────────────────────────────────────────────────

function renderRule(rule: AuditRule, depth: number): string {
  const pad = INDENT.repeat(depth);
  const status = ruleStatus(rule);
  const label = (rule.label || "(unnamed rule)").trim();

  switch (rule.ruleType) {
    case "Complete": {
      // Terminal "done / not done" marker. Skip satisfied ones with no text —
      // they're just visual confirmation in the GUI and waste tokens.
      if (status === "x" && !rule.remark?.textList?.length) return "";
      return `${pad}[${status}] ${label}`;
    }

    case "Course": {
      // A Course rule can be:
      //  (a) concrete — "1 Class in NEUR 4999 with credits >= 3"
      //  (b) wildcard with attribute — "3 Classes in @ @ with attribute = NESY"
      //  (c) partial — e.g. 2 of 3 NESY-tagged applied, still 1 needed
      // The old renderer missed (b) entirely (wildcards filtered out, withArray
      // ignored) and missed (c) in the sense that once ANY class applied it
      // stopped reporting how many more were needed — leaving Sonnet to infer
      // "complete" from partial progress.
      const lines: string[] = [];
      lines.push(`${pad}[${status}] ${label}`);

      const applied = rule.classesAppliedToRule?.classArray ?? [];
      const classesBegin = parseInt(rule.requirement?.classesBegin || "0", 10);
      const creditsBegin = parseFloat(rule.requirement?.creditsBegin || "0");
      const remainingClasses =
        classesBegin > 0 ? Math.max(0, classesBegin - applied.length) : 0;

      if (applied.length) {
        lines.push(`${pad}${INDENT}→ applied: ${formatAppliedClasses(applied)}`);
      }

      // Still-need line: emit when the rule isn't complete. Prefer the
      // advice list (concrete course suggestions) when it has real entries;
      // fall back to the requirement's own courseArray (which carries the
      // wildcard + withArray attribute/credit constraints). This is the
      // path that was blind to NESY-style rules.
      if (status !== "x") {
        const adviceCourses = rule.advice?.courseArray ?? [];
        const reqCourses = rule.requirement?.courseArray ?? [];
        const adviceText = formatAdviceCourses(adviceCourses);
        const useAdvice =
          adviceText && adviceText !== "any eligible course";
        const needText = useAdvice
          ? adviceText
          : formatAdviceCourses(reqCourses);
        const countPrefix = formatCountPrefix(
          remainingClasses,
          classesBegin,
          applied.length,
          creditsBegin
        );
        if (needText) {
          lines.push(`${pad}${INDENT}→ still need${countPrefix}: ${needText}`);
        } else if (remainingClasses > 0) {
          lines.push(
            `${pad}${INDENT}→ still need ${remainingClasses} more class(es)`
          );
        } else if (applied.length === 0) {
          // Incomplete Course rule with no courseArray, no advice, no
          // classesBegin, and nothing applied — the audit engine knows the
          // rule is incomplete but didn't expose its sub-requirements in
          // the API response. Hint to Sonnet to discover via catalog.
          lines.push(`${pad}${INDENT}→ (audit did not expose specifics — call list_attributes + search_catalog to discover related sections)`);
        }
      }
      return lines.join("\n");
    }

    case "Group": {
      // Group: pick N-of-M subrules. Render label as subheader then recurse.
      const lines: string[] = [];
      const needed = rule.requirement?.numberOfRules;
      const suffix = needed ? ` (choose ${needed})` : "";
      lines.push(`${pad}[${status}] ${label}${suffix}`);
      let renderedChildren = 0;
      for (const child of rule.ruleArray ?? []) {
        const rendered = renderRule(child, depth + 1);
        if (rendered) {
          lines.push(rendered);
          renderedChildren++;
        }
      }
      // Same hint for Group rules that expose no children.
      if (status !== "x" && renderedChildren === 0) {
        lines.push(`${pad}${INDENT}→ (audit did not expose specifics — call list_attributes + search_catalog to discover related sections)`);
      }
      return lines.join("\n");
    }

    case "Subset": {
      // Subset: like Group but without a "choose N of M" semantic — all
      // children collectively are the requirement. Fordham uses Subset for
      // concentration containers (e.g. "Systems/Computational Concentration"
      // bundles the NESY coursework rule that would otherwise be invisible
      // under a bare container label). Recurse into children; emit the
      // fallback hint only if the container is truly empty.
      const lines: string[] = [];
      lines.push(`${pad}[${status}] ${label}`);
      let renderedChildren = 0;
      for (const child of rule.ruleArray ?? []) {
        const rendered = renderRule(child, depth + 1);
        if (rendered) {
          lines.push(rendered);
          renderedChildren++;
        }
      }
      if (status !== "x" && renderedChildren === 0) {
        lines.push(`${pad}${INDENT}→ (audit did not expose specifics — call list_attributes + search_catalog to discover related sections)`);
      }
      return lines.join("\n");
    }

    case "Block":
    case "Blocktype": {
      const pct = rule.percentComplete || "0";
      const tag = pct === "100" ? "COMPLETE" : `${pct}%`;
      return `${pad}→ ${label} [${tag}]`;
    }

    default: {
      // Unknown rule type — emit the label and still recurse into ruleArray
      // so a future DegreeWorks rule kind (Groupthreshold, Noncourse, etc.)
      // doesn't silently swallow children the way Subset did pre-fix.
      const lines: string[] = [];
      lines.push(`${pad}[${status}] ${label}`);
      for (const child of rule.ruleArray ?? []) {
        const rendered = renderRule(child, depth + 1);
        if (rendered) lines.push(rendered);
      }
      return lines.join("\n");
    }
  }
}

// ─── Status + formatting helpers ──────────────────────────────────────────────

function ruleStatus(rule: AuditRule): "x" | "~" | " " {
  const pct = parseInt(rule.percentComplete || "0", 10);
  if (pct >= 100) return "x";
  if (rule.inProgressIncomplete === "Yes" || (rule.classesAppliedToRule?.classArray?.length ?? 0) > 0) {
    return "~";
  }
  return " ";
}

function formatAppliedClasses(classes: AppliedClass[]): string {
  return classes
    .slice(0, 6)
    .map((c) => {
      const grade = c.letterGrade ? ` (${c.letterGrade})` : " (IP)";
      return `${c.discipline} ${c.number}${grade}`;
    })
    .join(", ") + (classes.length > 6 ? `, +${classes.length - 6} more` : "");
}

function formatAdviceCourses(courses: CourseMatcher[]): string {
  if (!courses.length) return "";

  // Three categories of CourseMatcher:
  //   concrete   — both discipline and number specified (e.g. "NEUR 4999")
  //   halfWild   — one side wild ("PSYC @" = any PSYC course, rare "@ 3000")
  //   pureWild   — both wild, only meaningful with a withArray constraint
  // The previous version filtered with `&&` so only fully-concrete survived
  // and all withArray constraints (NESY, credits≥3, DWTERM filters) were lost.
  const concrete = courses.filter(
    (c) => c.discipline !== "@" && c.number !== "@"
  );
  const halfWild = courses.filter(
    (c) =>
      (c.discipline === "@" && c.number !== "@") ||
      (c.discipline !== "@" && c.number === "@")
  );
  const pureWild = courses.filter(
    (c) => c.discipline === "@" && c.number === "@"
  );

  const parts: string[] = [];

  if (concrete.length) {
    const formatted = concrete.slice(0, 8).map((c) => {
      const base = `${c.discipline} ${c.number}${
        c.numberEnd ? `-${c.numberEnd}` : ""
      }`;
      const w = formatWithClauses(c.withArray);
      return w ? `${base} ${w}` : base;
    });
    const extra =
      concrete.length > 8 ? `, +${concrete.length - 8} more` : "";
    parts.push(formatted.join(", ") + extra);
  }

  for (const c of halfWild.slice(0, 4)) {
    const subj = c.discipline === "@" ? "any subject" : c.discipline;
    const num =
      c.number === "@"
        ? "any number"
        : `${c.number}${c.numberEnd ? `-${c.numberEnd}` : ""}`;
    const w = formatWithClauses(c.withArray);
    parts.push(w ? `${subj} ${num} ${w}` : `${subj} ${num}`);
  }

  for (const c of pureWild.slice(0, 4)) {
    const w = formatWithClauses(c.withArray);
    parts.push(w ? `any class ${w}` : "any eligible course");
  }

  // Drop duplicate "any eligible course" entries that can come from multiple
  // bare wildcards.
  const seen = new Set<string>();
  const deduped = parts.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  return deduped.join("; ");
}

// Render a WithArray entry (attribute / credits / term constraint) into a
// human-readable suffix. Examples:
//   ATTRIBUTE = NESY            → "with attribute = NESY"
//   DWCREDITS >= 3              → "with credits >= 3"
//   DWTERM = 202710             → "with term = 202710"
// Multiple entries join with "and".
function formatWithClauses(withArr?: WithClause[]): string {
  if (!withArr || withArr.length === 0) return "";
  const phrases = withArr.map((w) => {
    const value = (w.valueList ?? []).join(", ");
    const label = codeToLabel(w.code);
    return `with ${label} ${w.operator} ${value}`;
  });
  return phrases.join(" and ");
}

function codeToLabel(code: string): string {
  switch (code) {
    case "ATTRIBUTE":
      return "attribute";
    case "DWCREDITS":
      return "credits";
    case "DWTERM":
      return "term";
    case "DWPASSFAIL":
      return "pass/fail";
    case "DWSCHOOL":
      return "school";
    case "DWINPROGRESS":
      return "in-progress";
    default:
      return code.toLowerCase();
  }
}

// Build the count prefix shown inside "still need[ X of Y]:" and its variants.
// Keeps the renderer honest about partial progress — Sonnet was previously
// inferring completion from the applied list and missing that 2 of 3 ≠ done.
function formatCountPrefix(
  remaining: number,
  total: number,
  applied: number,
  creditsNeeded: number
): string {
  if (remaining > 0 && total > 0 && applied > 0) {
    return ` ${remaining} more (${applied}/${total} applied)`;
  }
  if (remaining > 0 && total > 0) {
    return ` ${remaining} of ${total}`;
  }
  if (total > 0) {
    return ` ${total}`;
  }
  if (creditsNeeded > 0) {
    return ` ${creditsNeeded} credits`;
  }
  return "";
}

// ─── Section: in-progress / preregistered courses ─────────────────────────────

function renderInProgress(classes: TakenClass[]): string {
  const ip = classes.filter((c) => c.inProgress === "Y" || c.preregistered === "Y");
  if (!ip.length) return "";

  const lines: string[] = ["--- Courses in progress / preregistered ---"];
  for (const c of ip) {
    const tag = c.preregistered === "Y" ? "PRE" : "IP";
    const title = c.courseTitle ? ` — ${c.courseTitle}` : "";
    const term = c.termLiteral || c.term;
    lines.push(`${INDENT}[${tag}] ${c.discipline} ${c.number} (${term})${title}`);
  }
  return lines.join("\n");
}
