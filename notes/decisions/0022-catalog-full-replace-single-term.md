# 0022 — Course catalog is a full-replace, single-term store

- **Status**: Accepted
- **Date**: 2026-07-08
- **Related**: writes the store defined in 0008 (term-bind + term-wide pagination); constrains a future multi-term feature (see "Revisit if")

## Context

`saveCourses` (`src/shared/db.ts`) wrote the Banner catalog with a `put()` per
course and nothing else — an upsert. The IndexedDB store is keyed by
`courseCode` (e.g. `"CISC 2010"`), which is **term-independent**: the same code
is reused every term. `refreshCatalog(term)` always fetches a term's *complete*
section set and hands `saveCourses` the whole list in one call.

The bug: switching terms never removed courses that existed in the old term but
not the new one. A course offered in Fall but not Spring lingered in the store as
a ghost — carrying its stale Fall sections, CRNs, seat counts, and meeting times.
`put()` overwrites the courses that *do* recur across terms, but it can never
delete the ones that don't. So the catalog silently accumulated cross-term
debris, and anything reading it (the search tool, a future conflict checker, a
future multi-term simulation) saw a mix of the current term and leftovers from
whatever terms were loaded before.

## Decision

`saveCourses` performs a **full replace**: it clears the object store and writes
the new courses **in a single transaction**. `clear()` is queued first (IndexedDB
runs requests in order), and it shares the transaction with the `put()`s so the
swap is atomic — a concurrent reader never sees an empty store mid-refresh, and a
crash can't leave the catalog half-cleared. The catalog is therefore **single
term by design**: it reflects exactly the last term `refreshCatalog` ran.

## Alternatives considered

### Alternative A: term-keyed schema (store many terms at once)

Add a `term` field to `Course` and key the store by `term + courseCode`, keeping
every loaded term resident. Rejected *for now*: it's a larger schema migration,
and nothing in the current UI needs more than one term's catalog at a time. It's
the right move when multi-term simulation lands — deferred to that feature, not
paid for speculatively.

### Alternative B: clear in `refreshCatalog`, before calling `saveCourses`

Do `clear()` in the caller, then `saveCourses`. Rejected: two separate
transactions. Between them a reader could observe an empty catalog, and a crash
after the clear but before the writes would wipe the catalog with nothing to show
for it. Atomicity requires the clear and the writes to share one transaction,
which means it belongs inside `saveCourses` (which owns the transaction).

### Alternative C: diff-and-delete

Compute which courses disappeared this term and delete exactly those. Rejected:
more code and more failure surface for zero benefit — when you always hold the
term's complete set, clear-then-write is strictly simpler and just as correct.

## Consequences

- The catalog always matches exactly one term — the last one refreshed. Stale
  cross-term ghosts are impossible.
- **Single-term is now locked in.** Multi-term simulation cannot reuse this store
  as-is; it will need the term-keyed schema from Alternative A (a future ADR).
- The clear+write is atomic, so there is no torn-read or half-cleared-catalog
  window.
- `saveCourses` is no longer a general-purpose upsert — its contract is now
  "replace the catalog with this set." It is only ever called that way
  (`refreshCatalog`), and the code comment says so.

## Revisit if...

- A feature needs two or more terms' catalogs resident simultaneously
  (multi-term / cross-term simulation). That triggers the term-keyed schema and
  supersedes the single-term constraint here.

## References

- [`src/shared/db.ts`](../../src/shared/db.ts) — `saveCourses` (clear + put, one transaction).
- [`src/shared/db.test.ts`](../../src/shared/db.test.ts) — replace-semantics regression (no cross-term ghosts).
- [`src/background/service-worker.ts`](../../src/background/service-worker.ts) — `refreshCatalog` (sole caller; passes the term's full set).
