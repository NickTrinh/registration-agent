// Implements: ADR 0024 (the annotated worksheet, not a chat app)
//
// A tool call is a citation, not a notification. One tracked-caps line per
// tool, stacked above the answer it grounds — it reads like a footnote,
// which is what it is. The verb carries the tool's identity; COLOR is
// reserved for state (in flight / done / failed), because five hues for
// five tools is a taxonomy no student needs.
//
// `courseCount` is a chip-resolved marker, NOT a claim of zero results —
// a failed search broadcasts `courseCount: 0` plus `error`. Read `error`
// FIRST or a broken search renders as "0 results", which is a lie.

import type { ToolEvent } from "../../shared/types";

function describeSearch(input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (input.course_code) parts.push(String(input.course_code));
  if (input.subject) parts.push(String(input.subject));
  if (input.min_number && input.max_number)
    parts.push(`${input.min_number}–${input.max_number}`);
  else if (input.min_number) parts.push(`≥${input.min_number}`);
  else if (input.max_number) parts.push(`≤${input.max_number}`);
  if (input.keyword) parts.push(`"${input.keyword}"`);
  if (Array.isArray(input.days) && input.days.length > 0)
    parts.push(input.days.join(""));
  if (Array.isArray(input.attributes) && input.attributes.length > 0)
    parts.push(input.attributes.map((a) => String(a)).join("+"));
  if (input.has_seats) parts.push("open seats");
  return parts.join(" · ");
}

function idsOf(input: Record<string, unknown>): string {
  const ids = Array.isArray(input.ids) ? input.ids : [];
  return ids.map((id: unknown) => `#${id}`).join(" ");
}

// verb: tracked caps · detail: mono (codes/filters) or plain (prose) ·
// done: the resolved suffix, always with its count in mono.
function describe(ev: ToolEvent): { verb: string; detail: string; done: string } {
  switch (ev.name) {
    case "recall_memory":
      return { verb: "Recalled", detail: idsOf(ev.input), done: `${ev.courseCount ?? 0} loaded` };
    case "save_memory": {
      const desc = typeof ev.input.description === "string" ? ev.input.description : "";
      return { verb: "Saved memory", detail: desc, done: "saved" };
    }
    case "forget_memory":
      return { verb: "Forgot", detail: idsOf(ev.input), done: "done" };
    case "run_what_if": {
      const major = typeof ev.input.major === "string" ? ev.input.major : "";
      return { verb: "What-if audit", detail: major, done: "done" };
    }
    case "list_attributes":
      return { verb: "Listed attributes", detail: "", done: `${ev.courseCount ?? 0} found` };
    default:
      // search_catalog and anything a sixth tool adds later.
      return {
        verb: "Searched catalog",
        detail: describeSearch(ev.input),
        done: `${ev.courseCount ?? 0} results`,
      };
  }
}

export default function Citation({ event }: { event: ToolEvent }) {
  const failed = event.error !== undefined;
  const pending = !failed && event.courseCount === undefined;
  const { verb, detail, done } = describe(event);

  const ink = failed
    ? "text-red-700 dark:text-red-400"
    : pending
      ? "text-gray-500 dark:text-gray-500"
      : "text-gray-600 dark:text-gray-400";

  return (
    <p className={`text-[11px] uppercase tracking-wider leading-relaxed ${ink}`}>
      <span className="font-semibold">{verb}</span>
      {detail && (
        <>
          {" · "}
          <span className="font-mono normal-case tracking-normal">{detail}</span>
        </>
      )}
      {failed ? (
        <> · failed</>
      ) : pending ? (
        <span aria-hidden>…</span>
      ) : (
        <>
          {" · "}
          <span className="font-mono tracking-normal">{done}</span>
        </>
      )}
    </p>
  );
}
