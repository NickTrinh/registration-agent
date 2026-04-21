# 0004 — Cookie-based auth via `credentials: "include"` (no manual token handling)

- **Status**: Accepted
- **Date**: 2026-04-14
- **Session**: [`_ops/journal/2026-04-14.md`](../../../../_ops/journal/2026-04-14.md)
- **Related**: enables 0002; runs under 0003

## Context

Both Fordham backends the extension talks to — DegreeWorks (`dw-prod.ec.fordham.edu`) and Banner SSB (`reg-prod.ec.fordham.edu`) — use Ellucian's cookie-based auth pattern:

- **DegreeWorks** sets three cookies: `X-AUTH-TOKEN` (JWT, ~10 min lifetime), `REFRESH_TOKEN` (JWT, ~10 min lifetime, refreshes automatically as long as the student touches DegreeWorks), and `NAME` (URL-encoded display name for header UX). The JWTs encode `{sub: studentId, roles: [SDWHATIF, SDLOKAHD, ...]}`.
- **Banner** sets its own session cookies from the `reg-prod` origin with similar refresh semantics.

All of these are `HttpOnly` (not readable from JavaScript via `document.cookie`) and `SameSite` (sent only on same-site requests, which from an extension's service-worker context counts as same-site for the target origin as long as the origin has been granted `host_permissions`).

Short version: if the student is currently logged into DegreeWorks or Banner in the same Chrome profile, the cookies exist in the browser's cookie jar and will be sent automatically on any cross-origin fetch made with `credentials: "include"`. No auth flow of our own is needed — or permitted by policy.

## Decision

Every third-party fetch from the service worker passes `{ credentials: "include" }`. No manual cookie extraction, no Authorization header, no JWT parsing, no refresh-token handling in extension code. Cookies flow automatically from the browser's jar. If a fetch returns 401 or 403, the side panel surfaces a "Refresh DegreeWorks to re-authenticate" banner and the user clicks once.

## Alternatives considered

### Alternative A: Read the JWT from cookies and pass as `Authorization: Bearer <token>`

Impossible for the primary cookies — `X-AUTH-TOKEN` and `REFRESH_TOKEN` are `HttpOnly`, unreadable from `document.cookie` *by design*. We could add the `cookies` permission to `manifest.json` and use `chrome.cookies.get(...)` to read them — that would work technically — but:

1. Requesting the `cookies` permission shows a user-visible install warning ("Read and change cookies on all websites") that is scary out of proportion to the benefit.
2. There is no benefit over `credentials: "include"`. The server treats both as equivalent.
3. Manual token passing means manually handling refresh, rotation, and expiry — work we don't need to do.

### Alternative B: Prompt the student for Fordham credentials and mint our own session

Rejected hard. Unauthorized authentication against an institutional SSO is against Fordham policy, and storing university credentials in extension storage is a liability we refuse. Almost certainly blocked by MFA on the actual login page anyway.

### Alternative C: Stand up a backend proxy that handles auth

Same problems as ADR 0002's rejected Alternative C — PII, hosting, latency, credential handling, 3-week budget. Solves a problem we don't have.

## Consequences

**"Just works"** for any student already logged into DegreeWorks or Banner in the same Chrome profile. Zero-friction auth for the demo — judges can see the extension pull real data without any setup beyond installing it.

**Accepts cookie expiry as a failure mode.** The JWTs have ~10 min lifetimes; the refresh token extends them as long as DegreeWorks has been touched within ~1 hour. When the extension hits 401/403, it shows a banner instructing the user to refresh DegreeWorks in another tab. One click recovers.

**Forces explicit `host_permissions`** in `manifest.json`. Chrome blocks cross-origin fetches from an MV3 worker unless the origin is listed. Current minimum: `https://dw-prod.ec.fordham.edu/*`, `https://reg-prod.ec.fordham.edu/*`, `https://api.anthropic.com/*`. This must be verified before any of the new DegreeWorks client code is expected to work — a common "why is fetch silently failing" bug.

**No secrets to rotate or store.** The extension has zero persistent credentials of its own for Fordham backends. The only secret stored is the user's own Anthropic API key (in `chrome.storage.local`), which is a different axis.

**No portability story.** A student not logged into DegreeWorks sees the "Refresh DegreeWorks" banner and has no alternative. This is a feature — we never need to see their password.

## References

- Background on cookie behavior in MV3 extensions: [Chrome extension docs — cross-origin fetch](https://developer.chrome.com/docs/extensions/reference/api/webRequest)
- Existing pattern to mirror: [`banner-ssb-client.ts`](../../src/background/agent/banner-ssb-client.ts) already uses `credentials: "include"` throughout.
