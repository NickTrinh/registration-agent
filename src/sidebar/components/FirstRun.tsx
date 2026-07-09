// Implements: ADR 0024 (the annotated worksheet, not a chat app)
//
// The old first run showed two overlapping instructions at once: an amber
// "No audit loaded" card AND a welcome card whose primary button was a dead
// end ("Waiting for audit…"). This replaces both with one screen: three
// numbered prerequisites with live checkmarks, so a brand-new student always
// knows exactly what's missing and where to fix it. The intake button
// unlocks when the two hard prerequisites are met; the catalog is
// recommended, not required.

import type { ReactNode } from "react";

export const DEGREEWORKS_URL =
  "https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31";

function Step({
  n,
  done,
  title,
  detail,
  action,
}: {
  n: number;
  done: boolean;
  title: string;
  detail?: string;
  action: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        aria-hidden
        className={`w-5 shrink-0 text-center text-xs font-mono mt-0.5 ${
          done ? "text-green-700 dark:text-green-400" : "text-gray-600 dark:text-gray-400"
        }`}
      >
        {done ? "✓" : `${n}.`}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 dark:text-gray-100">
          {title}
          {done && <span className="sr-only"> — done</span>}
        </p>
        {detail && !done && (
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-snug">{detail}</p>
        )}
      </div>
      {!done && <span className="shrink-0">{action}</span>}
    </li>
  );
}

export default function FirstRun({
  hasKey,
  hasAudit,
  hasCatalog,
  onOpenSettings,
  onStart,
  onSkip,
}: {
  hasKey: boolean;
  hasAudit: boolean;
  hasCatalog: boolean;
  onOpenSettings: () => void;
  onStart: () => void;
  onSkip: () => void;
}) {
  const ready = hasKey && hasAudit;
  const settingsLink = (
    <button
      onClick={onOpenSettings}
      className="focus-ring rounded px-2 py-1 text-xs font-medium text-fordham-maroon dark:text-fordham-maroon-ink border border-gray-200 dark:border-gray-700 hover:border-fordham-maroon dark:hover:border-fordham-maroon-ink transition-colors"
    >
      Open Settings
    </button>
  );

  return (
    <div className="pt-6 px-1 animate-msg-in">
      {/* No wordmark here — the header bar 60px above already says RamPlan.
          Repeating the brand inside the card was a stutter; the heading's
          job is the task, not the name. */}
      <p className="font-serif text-[15px] font-semibold text-gray-900 dark:text-gray-100 mb-2">
        Set up in three steps.
      </p>

      <ol className="divide-y divide-gray-100 dark:divide-gray-800 border-y border-gray-100 dark:border-gray-800">
        <Step
          n={1}
          done={hasKey}
          title="Add your Anthropic API key"
          detail="Stored in your browser, sent nowhere but Anthropic."
          action={settingsLink}
        />
        <Step
          n={2}
          done={hasAudit}
          title="Open DegreeWorks so I can read your audit"
          detail="The audit loads itself as soon as the page opens."
          action={
            <a
              href={DEGREEWORKS_URL}
              target="_blank"
              rel="noreferrer"
              className="focus-ring rounded px-2 py-1 text-xs font-medium text-fordham-maroon dark:text-fordham-maroon-ink border border-gray-200 dark:border-gray-700 hover:border-fordham-maroon dark:hover:border-fordham-maroon-ink transition-colors inline-block"
            >
              Open DegreeWorks
            </a>
          }
        />
        <Step
          n={3}
          done={hasCatalog}
          title="Load a term's course catalog"
          detail="Recommended — I can't suggest real sections without it."
          action={settingsLink}
        />
      </ol>

      <div className="mt-4 space-y-2">
        <button
          onClick={onStart}
          disabled={!ready}
          className="focus-ring w-full px-3 py-2 rounded-lg bg-fordham-maroon text-white text-sm font-medium hover:bg-fordham-maroon/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {ready ? "Let's get to know each other" : "Finish steps 1–2 to start"}
        </button>
        <button
          onClick={onSkip}
          className="focus-ring w-full px-3 py-1.5 rounded-lg text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
