// Implements: ADR 0024 (the annotated worksheet, not a chat app)
// Implements: ADR 0032 (step 3 fetches the catalog inline)
//
// The old first run showed two overlapping instructions at once: an amber
// "No audit loaded" card AND a welcome card whose primary button was a dead
// end ("Waiting for audit…"). This replaces both with one screen: three
// numbered prerequisites with live checkmarks, so a brand-new student always
// knows exactly what's missing and where to fix it. The intake button
// unlocks when the two hard prerequisites are met; the catalog is
// recommended, not required.

import { useState, useEffect, type ReactNode } from "react";

export const DEGREEWORKS_URL =
  "https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31";

function Step({
  n,
  done,
  title,
  detail,
  action,
  extra,
}: {
  n: number;
  done: boolean;
  title: string;
  detail?: string;
  action: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        aria-hidden
        className={`w-5 shrink-0 text-center text-xs font-mono mt-0.5 ${
          done ? "text-green-700 dark:text-green-400" : "text-stone-600 dark:text-stone-400"
        }`}
      >
        {done ? "✓" : `${n}.`}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-stone-800 dark:text-stone-100">
          {title}
          {done && <span className="sr-only"> — done</span>}
        </p>
        {detail && !done && (
          <p className="text-xs text-stone-600 dark:text-stone-400 mt-0.5 leading-snug">{detail}</p>
        )}
        {!done && extra}
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

  // Step 3 fetches the catalog HERE (ADR 0032) — live-test round 1 showed
  // the detour ("go to Settings, pick a term, come back") losing people at
  // the exact moment they'd committed to setting up. One button, the same
  // default term Settings would pick (terms[0] = upcoming). The parent's
  // catalogCourseCount storage listener flips `hasCatalog`, so the checkmark
  // needs no wiring of its own.
  const [defaultTerm, setDefaultTerm] = useState<{ code: string; description: string } | null>(null);
  const [fetching, setFetching] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    if (hasCatalog) return;
    chrome.runtime.sendMessage({ type: "GET_CATALOG_TERMS" }, (r) => {
      const t = r?.terms?.[0];
      if (t?.code && t?.description) setDefaultTerm(t);
    });
  }, [hasCatalog]);

  useEffect(() => {
    const listener = (msg: any) => {
      switch (msg.type) {
        case "CATALOG_PROGRESS":
          setProgress({ done: msg.done ?? 0, total: msg.total ?? 1 });
          break;
        case "CATALOG_READY":
          // hasCatalog flips via the parent's storage listener; this just
          // retires the local progress UI.
          setFetching(false);
          setProgress(null);
          break;
        case "CATALOG_ERROR":
          setFetching(false);
          setProgress(null);
          setFetchError(true);
          break;
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  function loadCatalog() {
    if (!defaultTerm || fetching) return;
    setFetchError(false);
    setFetching(true);
    setProgress({ done: 0, total: 1 });
    chrome.runtime.sendMessage({ type: "REFRESH_CATALOG", term: defaultTerm.code });
  }
  const settingsLink = (
    <button
      onClick={onOpenSettings}
      className="focus-ring rounded px-2 py-1 text-xs font-medium text-fordham-maroon dark:text-fordham-maroon-ink border border-stone-200 dark:border-stone-700 hover:border-fordham-maroon dark:hover:border-fordham-maroon-ink transition-colors"
    >
      Open Settings
    </button>
  );

  return (
    <div className="pt-6 px-1 animate-msg-in">
      {/* No wordmark here — the header bar 60px above already says RamPlan.
          Repeating the brand inside the card was a stutter; the heading's
          job is the task, not the name. */}
      <p className="text-[15px] font-semibold text-stone-900 dark:text-stone-100 mb-2">
        Set up in three steps.
      </p>

      <ol className="divide-y divide-stone-100 dark:divide-stone-800 border-y border-stone-100 dark:border-stone-800">
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
              className="focus-ring rounded px-2 py-1 text-xs font-medium text-fordham-maroon dark:text-fordham-maroon-ink border border-stone-200 dark:border-stone-700 hover:border-fordham-maroon dark:hover:border-fordham-maroon-ink transition-colors inline-block"
            >
              Open DegreeWorks
            </a>
          }
        />
        <Step
          n={3}
          done={hasCatalog}
          title="Load a term's course catalog"
          detail="Recommended — I can't suggest real sections without it. You can switch terms later in Settings."
          action={
            defaultTerm && !fetchError ? (
              <button
                onClick={loadCatalog}
                disabled={fetching}
                className="focus-ring rounded px-2 py-1 text-xs font-medium text-fordham-maroon dark:text-fordham-maroon-ink border border-stone-200 dark:border-stone-700 hover:border-fordham-maroon dark:hover:border-fordham-maroon-ink disabled:opacity-50 transition-colors"
              >
                {fetching ? "Loading…" : `Load ${defaultTerm.description}`}
              </button>
            ) : (
              settingsLink
            )
          }
          extra={
            <>
              {fetching && progress && (
                <div
                  className="h-1 mt-2 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-label="Catalog download"
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.done}
                >
                  <div
                    className="h-full bg-fordham-maroon dark:bg-fordham-maroon-ink rounded-full transition-all duration-200 ease-spring"
                    style={{
                      width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                    }}
                  />
                </div>
              )}
              {fetchError && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1 leading-snug">
                  Couldn't load the catalog — try it from Settings.
                </p>
              )}
            </>
          }
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
          className="focus-ring w-full px-3 py-1.5 rounded-lg text-xs text-stone-600 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
