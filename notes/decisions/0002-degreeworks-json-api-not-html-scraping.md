# 0002 — Use DegreeWorks JSON API instead of scraping the HTML DOM

- **Status**: Accepted
- **Date**: 2026-04-14
- **Session**: [`_ops/journal/2026-04-14.md`](../../../../_ops/journal/2026-04-14.md)
- **Related**: builds on 0001; forces 0003 and 0004; enables 0005, 0006, 0007

## Context

The forked codebase came with `src/content/degreeworks-content.ts`: a content script that ran `document.body.innerText` on the DegreeWorks tab and shipped the string back to the service worker, where a parser in `degreeworks-parser.ts` reconstructed the audit. Testing end-to-end in a real DegreeWorks session returned empty strings from the profile extractor and "Audit not loaded" in the chat.

Inspection of the live page explained why. `dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31` is an Ellucian React SPA. The initial HTML is an empty `<div id="app">` shell; content is hydrated by React after a chain of API calls. Even after hydration, the rendered DOM is a tree of React components with generated class names — no `innerText` structure a stable scraper could depend on. Any "fix" would pattern-match class names that change on every Ellucian frontend deploy.

Opening the Network tab revealed the real data path: the SPA calls `GET /responsiveDashboard/api/audit?studentId=...&school=U&degree=BS&...` with a custom vendor Accept header (`application/vnd.net.hedtech.degreeworks.dashboard.audit.v1+json`) and gets back a ~133 kB JSON response containing every block, rule, qualifier, exception, in-progress class, fit decision, and requirement — strictly more data than any HTML rendering ever exposes.

Auth is cookie-based and already available to an extension running in the user's Chrome (ADR 0004 documents this).

## Decision

Delete `degreeworks-content.ts` and the HTML parser. Replace them with a typed JSON API client (`degreeworks-api-client.ts`) running in the service worker (ADR 0003). All audit data comes from `/api/audit` JSON directly. The content script shrinks to ~10 lines: detect the DegreeWorks tab, send a `REFRESH_AUDIT` message to the worker, done.

## Alternatives considered

### Alternative A: Fix the HTML scraper

React SPAs aren't `innerText`-stable by construction. Any fix would pattern-match against generated CSS classes and regex the output into shape. Every Ellucian release would potentially break it. Worse: the DOM is stripped of the grammar metadata (qualifiers, rule-nodetypes, fit info, `decide: LOWTERM` tiebreakers) that the JSON carries — a perfect scraper would still produce a degraded parse.

### Alternative B: Run a headless browser inside the extension

Puppeteer / playwright can't run from an MV3 service worker (no Node, no Chrome-DevTools-Protocol access, no fs). Architecturally wrong anyway — re-rendering the page to scrape what the server already sent as JSON is pointless work.

### Alternative C: Stand up a backend that proxies DegreeWorks

Adds a login flow for the student, adds hosting, adds PII risk (the audit body transits a third server), adds latency, adds ops. None of it fits in the 3-week budget, and it doesn't improve any capability the direct extension-to-DegreeWorks path lacks.

## Consequences

Unlocks strictly richer data than the HTML path ever had: full rule tree, qualifier taxonomy, fit list, exception list, `classesAppliedToRule` cross-references, the `decide: "LOWTERM"` tiebreaker signal, and critically the `auditHeader.whatIf: "Y"` flag — which is what enables the unified POST What-If endpoint (ADR 0006).

Forces all fetches into the service worker (ADR 0003) since content scripts can't easily set custom Accept headers and can't hold long-lived state for caching. Forces cookie-inheritance as the auth model (ADR 0004).

Accepts the (low) risk that the API changes. Mitigation: Ellucian exposes this API for vendor integration, so it's stable by commercial contract — much more stable than the React frontend.

Removes ~200 lines of dead parser code. Replaces them with a typed client that mirrors the existing `banner-ssb-client.ts` pattern, so there's one way to write fetch layers in this codebase.

## References

- API reference: [`notes/degreeworks-api-reference.md`](../degreeworks-api-reference.md) (authoritative, maintained first)
- Pattern being mirrored: [`src/background/agent/banner-ssb-client.ts`](../../src/background/agent/banner-ssb-client.ts)
- Retires: `src/content/degreeworks-content.ts`, `src/background/agent/degreeworks-parser.ts`
