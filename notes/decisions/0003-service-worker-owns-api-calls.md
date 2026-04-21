# 0003 — Service worker owns all third-party API calls; content scripts are thin taps

- **Status**: Accepted
- **Date**: 2026-04-14
- **Session**: [`_ops/journal/2026-04-14.md`](../../../../_ops/journal/2026-04-14.md)
- **Related**: cascades from 0002; complements planned "single-writer for `chrome.storage.local`" ADR

## Context

After pivoting to the DegreeWorks JSON API (ADR 0002), the extension needs to call three third-party backends: Fordham DegreeWorks (`dw-prod.ec.fordham.edu`), Fordham Banner SSB (`reg-prod.ec.fordham.edu`), and the Anthropic API (`api.anthropic.com`). In a Chrome MV3 extension, `fetch()` can run in two different contexts, each with different properties:

- **Content script**: runs in the page's JavaScript context, inherits the page's origin and cookies, dies when the tab closes, has no persistent cross-tab state, subject to the page's CSP.
- **Service worker**: runs in the extension's own context, needs explicit `host_permissions` in `manifest.json` to make cross-origin calls, survives across tabs, has `chrome.storage.local` access, can be woken by events.

We had to pick which context owned each of the three fetch surfaces, and whether to split or unify the ownership.

## Decision

The service worker owns every third-party fetch. All API clients (`banner-ssb-client.ts`, the new `degreeworks-api-client.ts`, the Anthropic SDK call in the chat loop) live in `src/background/agent/`. Content scripts are capped at ~10 lines: detect the right tab, dispatch a message to the worker (e.g. `REFRESH_AUDIT`), hand back nothing. The worker holds all in-memory caches (`cachedAuditText`, `cachedProfile`), all `chrome.storage.local` writes, and all logging.

## Alternatives considered

### Alternative A: Content script owns the DegreeWorks fetch

Tempting because the content script is already running in the DegreeWorks origin and "inherits" cookies most naturally. Rejected because:

1. Each tab spawns a fresh content-script instance with no cross-tab memory, so caching would have to be synced through the worker anyway.
2. When the user closes the DegreeWorks tab, the content script dies — and with it any in-flight refresh or tool handler.
3. Some institutional portals inject CSPs that restrict `fetch`; worker-context fetches sidestep this entirely.

### Alternative B: Hybrid — content script for first-party-tab fetches, worker for everything else

Rejected because it doubles the plumbing for no benefit. The worker can already fetch DegreeWorks with `credentials: "include"` (ADR 0004) and inherit cookies from Chrome's jar. There is no capability the content script has here that the worker lacks.

### Alternative C: Shared module callable from either layer

Inviting both contexts to own the same call would make debugging non-deterministic — if a cached audit is stale, which context's cache is authoritative? Single-owner is a property worth preserving.

## Consequences

**Single place for everything that matters about third-party calls**: rate limiting, caching, auth-expiry detection (watch for 401/403, broadcast a "session expired" event), logging, and test mocking. All three API clients share the same `fetch(..., { credentials: "include" })` pattern.

**In-memory shadow caches are cheap**: the worker already holds `cachedAuditText` and `cachedProfile`; side-panel message handlers read from them without hitting `chrome.storage.local` on every render.

**Content scripts become trivially small and testable**: the DegreeWorks detector is ~10 lines, the Banner detector (if added later) another ~10. Neither needs fetch logic.

**Accepts the `host_permissions` constraint**: every origin the worker fetches must be listed in `manifest.json` or Chrome blocks the request. Current list must include `https://dw-prod.ec.fordham.edu/*` and `https://reg-prod.ec.fordham.edu/*`; the Anthropic origin is already there.

**Natural precursor** to the planned "single-writer for `chrome.storage.local`" ADR: if the worker is the only *reader* of most storage keys (because it holds in-memory shadows), making it the only *writer* too is a free win, and that ADR can be added later without refactoring this one.

## References

- Mirror pattern: [`src/background/agent/banner-ssb-client.ts`](../../src/background/agent/banner-ssb-client.ts)
- Message-router switch: [`src/background/service-worker.ts`](../../src/background/service-worker.ts)
