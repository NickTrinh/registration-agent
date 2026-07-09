// Implements: ADR 0026 (system events never speak in the advisor's voice)
//
// A system event — an error, an expired session, a truncated response — is
// never the advisor's voice. It renders here instead: a rule in the severity
// colour, a transparent fill, and at most one action.
//
// Two placements, one component:
//   ambient    — a standing condition (no audit, session expired). Not dismissible.
//   turn-scoped — anchored under the turn that failed. Dismissible, carries Retry.
//
// The severity families differ in their ACTION, not their prose: a DegreeWorks
// expiry sends you to DegreeWorks, a Banner expiry sends you to Browse Classes,
// an opaque failure sends you nowhere and says so. Design around the slot.

type Severity = "info" | "warn" | "error";

// A link when recovery lives on another page, a handler when it lives on this
// one. `href` is never hard-coded here — the broadcast that reports the failure
// carries the URL, because the client that knows the failure owns the BASE.
export type NoticeAction =
  | { label: string; href: string }
  | { label: string; onClick: () => void };

// Rules clear the 3:1 non-text floor on both surfaces; inks clear 4.5:1.
// amber-500 measured 2.15:1 on white and is why `warn` uses amber-600.
const SEVERITY = {
  info: {
    rule: "border-stone-500 dark:border-stone-400",
    title: "text-stone-800 dark:text-stone-100",
  },
  warn: {
    rule: "border-amber-600 dark:border-amber-400",
    title: "text-amber-700 dark:text-amber-300",
  },
  error: {
    rule: "border-red-600 dark:border-red-400",
    title: "text-red-700 dark:text-red-400",
  },
} as const satisfies Record<Severity, { rule: string; title: string }>;

export default function Notice({
  severity,
  title,
  body,
  action,
  onDismiss,
}: {
  severity: Severity;
  title: string;
  // Raw provider text lands here, in mono, never in `title`. It is quoted, not
  // spoken — the student should be able to tell our sentence from the API's.
  body?: string;
  action?: NoticeAction;
  onDismiss?: () => void;
}) {
  const s = SEVERITY[severity];
  return (
    <div
      role={severity === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 border-l-2 pl-3 pr-1 py-1.5 ${s.rule}`}
    >
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold ${s.title}`}>{title}</p>
        {body && (
          <p className="mt-0.5 text-xs font-mono break-words text-stone-600 dark:text-stone-400">
            {body}
          </p>
        )}
        {action && (
          <div className="mt-1.5">
            {"href" in action ? (
              <a
                href={action.href}
                target="_blank"
                rel="noreferrer"
                className="focus-ring inline-block rounded px-2 py-1 text-xs font-medium bg-fordham-maroon text-white hover:bg-fordham-maroon/90"
              >
                {action.label} →
              </a>
            ) : (
              <button
                onClick={action.onClick}
                className="focus-ring inline-block rounded px-2 py-1 text-xs font-medium bg-fordham-maroon text-white hover:bg-fordham-maroon/90"
              >
                {action.label}
              </button>
            )}
          </div>
        )}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="focus-ring shrink-0 rounded px-1 text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
        >
          ×
        </button>
      )}
    </div>
  );
}
