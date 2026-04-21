# 0008 — Banner session-bind dance + term-wide pagination (not per-subject filters)

- **Status**: Accepted
- **Date**: 2026-04-14 (codified from earlier sprint learning)
- **Session**: [`_ops/journal/2026-04-14.md`](../../../../_ops/journal/2026-04-14.md)
- **Related**: runs under 0003 (service-worker ownership)

## Context

Fordham's class search runs on **Ellucian Banner SSB** at `reg-prod.ec.fordham.edu/StudentRegistrationSsb/ssb`. The `/searchResults/searchResults` endpoint *looks* like a conventional REST GET — it takes `txt_term`, `txt_subject`, `pageOffset`, `pageMaxSize`, and returns a JSON page of section rows. A naive client would write a per-subject loop:

```
for subject in subjects:
  GET /searchResults/searchResults?txt_term=202710&txt_subject=CISC
```

This was in fact the first approach. The result: every call returned the same default page. No error, no 400, no logging anywhere — just silently wrong data. The root cause, after much debugging, turned out to be that Banner SSB is **stateful**. The server holds session-bound filter criteria, and per-request query parameters for subject/level/etc. are ignored when the session has no "committed" criteria. The commit step is a separate POST call to `/term/search?mode=search` that binds the term into the session; without that, every subsequent `searchResults` ignores your filters and returns a default.

There's also a subtle trap: if you stop mid-loop and start a new run, Banner remembers the old session criteria. Stale filter state causes fetches to return wrong data for a different term entirely.

A third quirk: the response includes a `ztcEncodedImage` field — a ~50 kB base64-encoded PNG "Zero Textbook Cost" badge, served on every response whether or not any section is actually ZTC. Stored naively, it would dominate IndexedDB size.

## Decision

Every catalog refresh runs this exact sequence per term:

1. `POST /classSearch/resetDataForm` — clear any stale session criteria left by a prior run (best-effort, errors ignored).
2. `POST /term/search?mode=search` with `term=202710` (form-encoded) — bind the term into the server-side session. *This step is mandatory*; skipping it breaks step 3 silently.
3. `GET /searchResults/searchResults?txt_term=202710&pageOffset=N&pageMaxSize=500&sortColumn=subjectDescription&sortDirection=asc` in a pagination loop, incrementing `pageOffset` by 500 each iteration. No subject filter, no level filter — pull the entire term in one wide query. Stop when `totalCount` is reached, the response is an empty array, or a partial page (<500) is returned.

Between pages: 150 ms sleep to be polite to the shared university server.

Before persisting: `delete response.ztcEncodedImage` on every page to prevent the badge from bloating IndexedDB.

## Alternatives considered

### Alternative A: Per-subject loop with `txt_subject` as a filter

This was the first approach. Silently returns duplicate default pages because Banner ignores filter params without a committed session criterion. The failure mode is pernicious: the client *looks* like it's working (gets 200s, parses JSON, stores rows), but every loop iteration writes the same rows. Debugging cost us hours before the stateful model became clear. Rejected with prejudice.

### Alternative B: Scrape Banner's HTML search page

Same reasons as DegreeWorks (ADR 0002): stateful SPAs aren't scrape-stable, and the JSON endpoints are strictly better when you know the session protocol.

### Alternative C: Use Banner's XE GraphQL / stateless REST endpoint

Ellucian does publish a newer "XE" API family for Banner that is stateless, but Fordham doesn't expose it publicly. The SSB endpoints are what the registrar's own UI uses, so they're the interface we must target.

### Alternative D: Bind per subject (do the dance for every subject)

Quadratic cost (bind + bind + bind + search + search + search) for no benefit over a single bind + term-wide pagination. Would also trigger Banner's rate-limiting more aggressively.

## Consequences

**A single term refresh pulls ~2000 sections in roughly 10 seconds** at 500 rows per page × 4 pages + inter-page delays. Observed on Patch's catalog refresh for Fall 2026.

**Catalog refresh is idempotent.** Calling twice in a row overwrites the same IndexedDB rows; no duplicate-key issues and no cleanup logic needed.

**Strips the 50 kB ZTC badge** from every response before storage. Without this, every stored page carries a 50 kB base64 image and the IndexedDB store balloons proportional to page count, not row count.

**Accepts fragility around Banner's stateful session model.** If Ellucian ever migrates Fordham's Banner to stateless search (unlikely — SSB is mature), this client needs rewriting. Documented in the client source so future maintainers understand why the bind dance exists.

**The `resetDataForm` call is best-effort** (wrapped in `.catch(() => {})`). If it errors, we proceed anyway — the worst case is that the subsequent `bindTerm` overwrites whatever was there. Documenting the intent (clearing stale criteria) is more important than the call succeeding.

## References

- [`src/background/agent/banner-ssb-client.ts`](../../src/background/agent/banner-ssb-client.ts) — the client implementing this sequence; comments at the top of the file explain the three-step dance.
- `fetchAllSectionsForTerm` is the function that runs the pagination loop.
