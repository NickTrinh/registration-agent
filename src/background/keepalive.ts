// MV3 keepalive for post-stream background work.
//
// Chrome kills an idle MV3 service worker after ~30s with no pending events.
// Several of our flows do real async work with NO event queued behind them —
// the Haiku curator fires AFTER AI_DONE, and catalog/profile refreshes run on
// their own. If the idle timer lands mid-Anthropic-call, the worker unloads and
// the in-flight work (e.g. a memory save) is silently lost.
//
// An extension API call resets the idle timer (Chrome >= 110). withKeepalive
// polls a cheap, side-effect-free API on an interval for the lifetime of the
// wrapped promise, then clears it in finally. This keeps the worker alive until
// the work resolves or rejects — no behavior change to the work itself.
// Implements: ADR 0021 — see notes/decisions/.

// 25s < Chrome's ~30s idle kill, so the timer resets before it can fire.
const KEEPALIVE_INTERVAL_MS = 25_000;

export async function withKeepalive<T>(work: Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    // getPlatformInfo is cheap and side-effect-free; the call itself is what
    // resets the idle timer — the result is discarded.
    chrome.runtime.getPlatformInfo().catch(() => {});
  }, KEEPALIVE_INTERVAL_MS);

  try {
    return await work;
  } finally {
    clearInterval(timer);
  }
}
