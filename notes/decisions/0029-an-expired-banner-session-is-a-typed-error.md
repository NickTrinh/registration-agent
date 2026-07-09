# 0029 — An expired Banner session is a typed error, not a SyntaxError

- **Status**: Accepted
- **Date**: 2026-07-09
- **Related**: 0003/0004/0008 (the Banner SSB client); consumed by the catalog UI

## Context

`banner-ssb-client.ts` reached Banner through one helper:

```ts
async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Banner GET ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}
```

The `!res.ok` guard assumes an expired session produces a failing status. It
does not. Ellucian answers an unauthenticated request with a **302 to the SSO
login page**; `fetch` follows redirects by default, so the extension receives a
`200 text/html` body. `res.ok` is true. `.json()` then throws
`SyntaxError: Unexpected token '<'`, `refreshCatalog`'s catch stringifies it,
and the student is shown:

> Catalog refresh failed — Unexpected token '<', "<!DOCTYPE "... is not valid JSON

The most common recoverable failure in the extension rendered as a parser
message. The code that *knew* what to do about it already existed —
`fetchAllSectionsForTerm` throws a prose "the registration session likely
expired" string on the `success: false` path — but nothing downstream could
distinguish that string from any other, so no UI could offer the recovery. The
re-login branch was, in effect, unreachable.

There are two ways a Banner session dies, and both are the same event to the
student:

1. **cookie gone** → HTML login page where JSON was expected;
2. **criteria desync** → valid JSON, `success: false`, `data: null` — the
   session answers, but has lost the term binding.

## Decision

One exported error type, thrown on both paths:

```ts
export class SessionExpiredError extends Error { … }
```

`getJSON` guards on **content-type**, not on the body: every real Banner
endpoint answers `application/json`, and the login page is `text/html`. A
non-JSON content-type is an expiry, full stop. `fetchAllSectionsForTerm`'s
`success: false` branch throws the same type.

The service worker's `CATALOG_ERROR` broadcast gains two fields:

```ts
{ type: "CATALOG_ERROR", error, expired: boolean, recoveryUrl?: string }
```

`expired` splits the UI taxonomy in exactly one place: a recoverable expiry (one
action — re-establish the session) versus an opaque failure (no action, raw
text). The URL travels with the flag rather than being hard-coded in the
sidebar, because the client already owns `BASE`.

## Alternatives considered

### Alternative A: sniff the body for `<!DOCTYPE`

Read the text, look for HTML, re-parse as JSON otherwise. Rejected: it consumes
the body to decide how to consume the body, and it makes a heuristic on
*content* load-bearing for a correctness branch. Content-type is the field the
server sets for exactly this purpose.

### Alternative B: `redirect: "manual"` and treat any 3xx as expiry

Closer to the wire truth, and it would catch the redirect before the HTML ever
arrives. Rejected for now: `fetch` in an MV3 worker with `redirect: "manual"`
returns an opaque response, which loses the status we would then want to log,
and Banner also 302s in benign cases (trailing-slash normalisation). The
content-type guard catches the same failures without depending on redirect
semantics. Revisit if a benign non-JSON 200 ever appears.

### Alternative C: keep the prose string, match on it in the UI

Rejected for the reason 0028 rejected the `"Error: "` prefix filter:
presentation must not be load-bearing for a correctness invariant. Copy edits
would silently unhook the recovery.

## Consequences

- The catalog UI can render one action — "Open Browse Classes" — instead of a
  parser error. The recovery is a *link*, not a retry button: re-running the
  fetch against a dead session reproduces the failure. The existing "Refresh
  catalog" control is the second step, and it is already on that screen.
- Both failure modes converge on one message and one affordance, so the student
  never has to know which of the two happened.
- `SessionExpiredError` is exported and `instanceof`-checked across a module
  boundary. That is safe here (single bundle, no realm hop) and would not be
  across a `postMessage`; the flag on the broadcast — not the class — is what
  crosses to the sidebar.
- The `!res.ok` guard stays. A 500 is still a plain `Error`, and a test pins
  that it is *not* reported as an expiry.

## Revisit if…

- Banner starts answering a live session with a non-JSON 200 (a maintenance
  page, an HTML error). The guard would then mislabel it, and body-shape or
  status inspection has to join the decision.
- The worker↔sidebar bus gains a typed union (the weakness recorded in 0028's
  Consequences). `expired`/`recoveryUrl` should become part of it.

## References

- [`src/background/agent/banner-ssb-client.ts`](../../src/background/agent/banner-ssb-client.ts) — `SessionExpiredError`, the `getJSON` content-type guard, the `success:false` branch.
- [`src/background/agent/banner-ssb-client.test.ts`](../../src/background/agent/banner-ssb-client.test.ts) — the login-page response, the JSON response, the 500, the desync.
- [`src/background/service-worker.ts`](../../src/background/service-worker.ts) — `CATALOG_ERROR` gains `expired` + `recoveryUrl`.
