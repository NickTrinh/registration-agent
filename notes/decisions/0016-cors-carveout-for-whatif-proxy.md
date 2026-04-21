# 0016 — CORS carveout: proxy What-If POST through the DegreeWorks tab

- **Status**: Accepted
- **Date**: 2026-04-19
- **Related**: Amends 0003 (service worker owns all third-party fetches); depends on 0002, 0004, 0006

## Context

The `GET /api/audit` flow (real audit) had been working reliably from the service worker since 0003 + 0004 were wired. On 2026-04-18, the first end-to-end What-If test from the extension 403'd. Over the next day, the failing POST produced a string of misleading hypotheses:

1. **Missing CSRF token** — rejected after cURL capture showed no XSRF cookie or header in the native request.
2. **Missing `CONC` / `COLLEGE` / `MAJOR` goal codes** — rejected after rebuilding the request body to exactly mirror the native one.
3. **Session-prime precall (`POST /api/goals`)** — a HAR capture showed the DW UI makes this call before What-If. Plausible until a DevTools `fetch(...)` with **no** preceding call succeeded.
4. **Expired session** — ruled out by decoded JWT (`exp` days ahead, `SDWHATIF` role present).

The smoking gun came from reading the 403 response body in the extension's service-worker DevTools: a literal string **`"Invalid CORS request"`**. Ellucian's app server intercepts requests whose `Origin` isn't in its allowlist and returns 403 with that body — conflating CORS rejection with authorization failure. The service worker's `Origin: chrome-extension://<id>` is not in DegreeWorks' allowlist; `https://dw-prod.ec.fordham.edu` is. This also explained why `GET /api/audit` had worked: the server's CORS policy permits GET from arbitrary Origins (safe method), but restricts POST.

We needed a path for POST `/api/audit` (and, by extension, any future write endpoint) that presents a same-origin Origin at the wire level.

## Decision

Proxy the POST through a live DegreeWorks tab using `chrome.scripting.executeScript({ world: "ISOLATED" })`. The injected function runs inside the tab with page Origin (`https://dw-prod.ec.fordham.edu`), fetches `/responsiveDashboard/api/audit` with `credentials: "include"`, and returns `{ok, status, statusText, text}` back to the service worker via `executeScript`'s structured-clone result.

GET endpoints remain on the direct service-worker path — no change needed, CORS config already allows them.

A new `DegreeWorksNoTabError` is thrown when no `dw-prod.ec.fordham.edu` tab is open; the chat surfaces this as a targeted "Open DegreeWorks and retry" tool result rather than a generic red error.

## Alternatives considered

### Alternative A: Persistent content script as a message-bus proxy

Add a content script on `dw-prod.ec.fordham.edu/*` that listens for `runtime.sendMessage` and runs the fetch on receipt. Same end result (page-origin fetch) but always resident.

Rejected: duplicates `executeScript`'s capability with more moving parts — a bidirectional message protocol, long-lived content script, and a registration handshake. `executeScript` runs on demand and returns directly; it's the minimum-viable form of the same pattern. Also: the DW SPA already occasionally crashes its React tree on viewport changes (ADR candidate yet unwritten); a persistent script means more exposure to that instability.

### Alternative B: `world: "MAIN"` instead of `"ISOLATED"`

Run the injected function in the page's own JS realm. Both worlds share the page's Origin for fetches, so either would pass the CORS gate.

Rejected: MAIN gives the injected code access to the page's JS globals (React internals, DW config objects), which is more surface area than we need. ISOLATED is same-origin for the network but insulated from the page's JS — strictly less privileged, strictly lower-risk.

### Alternative C: Auto-open a DegreeWorks tab when none is present

If `tabs.query` finds no dw-prod tab, open one programmatically and inject into it.

Rejected for the sprint window: opens a tab the user didn't ask for mid-chat; creates a flash of DW UI while the extension is supposed to feel invisible; race between tab-ready and script-inject adds complexity. The `DegreeWorksNoTabError` message ("Open DegreeWorks and retry") is low-friction and honest about what's happening. Revisitable post-submission.

### Alternative D: Server-side proxy (our own backend relays the POST)

Stand up a tiny backend that holds session cookies and forwards POST /audit. Decouples entirely from tab state.

Rejected: reintroduces the hosting + auth problem that ADR 0001 was specifically written to avoid. A submission-deadline sprint is not the time to add a server. Also: student cookies would leave the student's device, which is worse privacy-wise than the current design.

## Consequences

**Locks in:**
- Write-surface endpoints on DegreeWorks require a proxy path; the service worker alone cannot reach them.
- The extension's What-If feature has a soft dependency on the user having a DW tab open — they usually do while using the advisor, but not always.

**Opens up:**
- The same pattern generalizes to Look-Ahead (ADR 0006) and any future DW POST endpoint (e.g., saving a planner scenario). The proxy becomes the shape of all writes.
- Makes it cheap to add other origin-sensitive integrations later (Banner write surfaces, Ellucian Experience calls) — the `executeScript` pattern is reusable.

**Risks accepted:**
- Requires an active DW tab for What-If (documented UX; surfaced via `DegreeWorksNoTabError`).
- Brittle if DW changes its React crash behavior during the injection; `executeScript` itself is resilient, but a mid-crash DW could refuse to run scripts until reloaded.
- Response bodies (~100–200 KB) cross `executeScript`'s structured-clone boundary — fine today, would need streaming if DW ever returns multi-MB audits.

## Amendment to ADR 0003

ADR 0003 stated: *"The service worker owns every third-party fetch."* This remains true for **read** endpoints and for endpoints whose CORS policy is permissive. For DegreeWorks **write** endpoints (`POST /api/audit` and anticipated siblings), ownership shifts to the page tab via short-lived injection. The service worker still owns the *call site* and the *result handling*; only the wire-level fetch executes in the tab. ADR 0003's original invariant holds for all other APIs (Anthropic, Banner SSB, DegreeWorks GET), and the carveout is scoped to Ellucian's Origin-allowlisted POSTs.

## Revisit if...

- Ellucian relaxes DW's CORS policy to include extension Origins (unlikely; would let the carveout be removed).
- A DW tab becomes reliably detectable as "ready for injection" via a lifecycle event — then Alternative C becomes cheap and we can drop the no-tab error path.
- `chrome.scripting` API changes break the ISOLATED-world fetch semantics.

## References

- [`src/background/agent/degreeworks-api-client.ts`](../../src/background/agent/degreeworks-api-client.ts) — `fetchWhatIfAudit` implementation + `DegreeWorksNoTabError`
- [`src/background/service-worker.ts`](../../src/background/service-worker.ts) — call site + error surfacing in `executeWhatIf`
- Commit `68f9e9e` — "fix: proxy What-If POST through DegreeWorks tab to bypass CORS"
- ADR 0003 — service-worker-as-fetch-owner invariant that this ADR amends
- ADR 0006 — POST /api/audit endpoint semantics
- Chrome Developers — [chrome.scripting.executeScript](https://developer.chrome.com/docs/extensions/reference/api/scripting#method-executeScript)
