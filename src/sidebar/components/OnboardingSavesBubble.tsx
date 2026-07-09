// MOVED from AuditChat.tsx unchanged in structure (ADR 0024's move-don't-
// rewrite step) — this is the best-designed thing in the codebase and the
// structure stays. Three surface fixes only:
//   - header ink was maroon-on-dark (1.51:1) → maroon.ink in dark
//   - type badge was text-[9px] → 11px tracked caps
//   - the ADR 0015 provenance quote was 10px grey italic — the trust
//     artifact styled like a disclaimer. It is evidence, so it is set like
//     evidence: 12px, upright, with a rule.
//
// Bubble A at end of intake: "Saving your profile…" with a per-row status.
// Rows start as pending (·) and flip to saved (✓) as ONBOARDING_SAVE_COMMITTED
// broadcasts arrive. Once the whole batch is done, the header loses the
// spinner. This is intentionally visually distinct from AI prose — it's a
// system event, not the model's voice. The wrap-up message (Bubble B) streams
// in afterward as a normal assistant message.

import type { SystemActionItem, MemoryType } from "../../shared/types";

const SYSTEM_ACTION_TYPE_STYLE: Record<
  MemoryType,
  { label: string; bg: string; text: string }
> = {
  interest: { label: "INTEREST", bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-800 dark:text-purple-200" },
  constraint: { label: "CONSTRAINT", bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-800 dark:text-amber-200" },
  goal: { label: "GOAL", bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-800 dark:text-blue-200" },
  decision: { label: "DECISION", bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-800 dark:text-green-200" },
  note: { label: "NOTE", bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-700 dark:text-gray-300" },
};

export default function OnboardingSavesBubble({
  items,
  done,
}: {
  items: SystemActionItem[];
  done: boolean;
}) {
  const savedCount = items.filter((i) => i.status === "saved").length;
  return (
    <div className="rounded-xl border border-fordham-maroon/30 dark:border-fordham-maroon-ink/30 bg-fordham-maroon/5 dark:bg-fordham-maroon-ink/5 p-3 animate-msg-in">
      <div className="flex items-center gap-2 mb-2">
        {!done && (
          <span
            className="inline-block w-3 h-3 rounded-full border-2 border-fordham-maroon dark:border-fordham-maroon-ink border-t-transparent dark:border-t-transparent animate-spin"
            aria-hidden
          />
        )}
        {done && <span aria-hidden>✓</span>}
        <p className="text-xs font-semibold text-fordham-maroon dark:text-fordham-maroon-ink">
          {!done
            ? "Saving your profile…"
            : savedCount === 0
              ? "All set"
              : `Saved ${savedCount} ${savedCount === 1 ? "memory" : "memories"}`}
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-600 dark:text-gray-400 italic">
          Nothing to save — we'll still get you set up.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => {
            const style = SYSTEM_ACTION_TYPE_STYLE[item.type] ?? SYSTEM_ACTION_TYPE_STYLE.note;
            return (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <span
                  aria-hidden
                  className={
                    item.status === "saved"
                      ? "text-green-700 dark:text-green-400 mt-[1px]"
                      : "text-gray-400 dark:text-gray-600 mt-[1px]"
                  }
                >
                  {item.status === "saved" ? "✓" : "·"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`inline-block px-1.5 py-[1px] rounded text-[11px] font-semibold uppercase tracking-wide ${style.bg} ${style.text}`}
                    >
                      {style.label}
                    </span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium break-words">
                      {item.description}
                    </span>
                  </div>
                  {item.sourceQuote && (
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 pl-2 border-l-2 border-gray-300 dark:border-gray-600 break-words">
                      you said: “{item.sourceQuote}”
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
