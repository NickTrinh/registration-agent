# 0018 — Committed anonymized fixtures + offline test loop

- **Status**: Accepted
- **Date**: 2026-07-07
- **Related**: acts on 0017 (retrospective's #1 rebuild item); makes 0009's PII boundary machine-checked; extends 0005 (renderer)

## Context

The retrospective (ADR 0017) named this the first thing to rebuild: "Commit anonymized fixtures to the repo." Until now the project kept real captured audit/section responses locally under a `notes/fixtures/*.real.*` gitignore pattern, which kept the repo PII-free but meant every testing cycle required a fresh DegreeWorks login plus a live audit fetch. There was no automated test of any kind — the two most intricate pure transforms in the codebase (the DegreeWorks audit-to-text renderer and the Banner section-to-Course mapper) had only manual, live-data verification.

That gap matters most for ADR 0009's PII boundary. The claim "the renderer cannot emit what it never reads" was enforced only by a 60-second manual grep discipline. Any future edit that started reading `studentName`/`advisorName`/`advisorEmail` would compile, build, and ship — the regret in 0017 was that this safety property was a matter of vigilance, not of types or tests.

The infra pass that follows (ADRs 0019+) is a decomposition of the god-file. Refactoring 1300 lines of behavior with no test net is how a "zero-behavior-change" refactor silently changes behavior. This ADR builds the net first.

## Decision

Commit structurally-complete fixtures with **fabricated** PII in plain view, and stand up a `vitest` offline test loop over the pure transforms.

- `notes/fixtures/audit.fixture.json` — a full `AuditResponse` with fabricated identity (name "Doe, Jane A", Banner ID "A00000000", advisor "Advisor, Test" / `test.advisor@example.edu`). It exercises every renderer branch the code has comments for: a complete block, an in-progress rule, an incomplete rule with a `withArray` ATTRIBUTE clause, a concentration (`Subset`) with sibling rules, and a bare-incomplete rule.
- `notes/fixtures/banner-sections.fixture.json` — one Banner `searchResults` page (10 sections) with overlapping meeting times, an attribute-carrying section, an async-online section, a `creditHours: null` fallback case, and the envelope-level `ztcEncodedImage` blob.
- Tests: a renderer inline snapshot; a **PII-regression** test that asserts the rendered text contains none of the fabricated identity fields and does contain `[NAME]`/`[ADVISOR]`/`[ADVISOR_EMAIL]` (this makes 0009's by-construction claim machine-checked forever); a banner-to-course mapping test that asserts `ztcEncodedImage` never reaches a `Course`; and a `buildWhatIfGoals` test covering the four documented semantic cases.
- `buildWhatIfGoals(input, studentGoal)` was extracted from `executeWhatIf` in `service-worker.ts` into `agent/what-if.ts` as a pure function so its four-case goal-assembly logic can be tested without `chrome` or the network. This is a behavior-preserving move (verified: build + tsc + snapshot unchanged).

`npm test` runs `vitest run`; the config is a dedicated `vitest.config.ts` that deliberately does not load the crx/MV3 vite plugin.

## Alternatives considered

### Alternative A: Keep the local-real-fixture pattern, add no tests

The status quo from 0017. Rejected — it's exactly the regret the retrospective told us to act on, and it leaves the decomposition that follows with no behavior-preservation net.

### Alternative B: Redact real captured responses instead of fabricating

Take a real audit and scrub the identifying fields. Rejected: redaction is the same detect-and-remove race ADR 0009 rejected for the renderer. A missed field ships real PII into the public repo permanently (git history). Fabricated-from-the-interfaces data cannot leak what was never real.

### Alternative C: A full DOM/extension harness (jsdom + mocked chrome APIs)

Rejected as scope for this pass. The highest-value, lowest-friction targets are the pure transforms; they need no browser. A chrome/IndexedDB harness can come later when a tool executor's storage path is worth testing — `fake-indexeddb` is already wired into the setup file for that day.

## Consequences

- The PII boundary is now a test, not a discipline. A regression that reads an identifying field fails CI-equivalent locally on the next `npm test`.
- The infra decomposition gets a green/red signal on "did the refactor change the rendered output or the goal assembly?" — the renderer snapshot is the guardrail.
- New dev-deps (pinned exact): `vitest`, `fake-indexeddb`. No new runtime deps.
- Fixtures must be maintained alongside the interfaces. If `degreeworks-types.ts` grows a field the renderer reads, the fixture and snapshot update in the same change — the snapshot diff makes that visible.
- `buildWhatIfGoals` now lives in its own module; `service-worker.ts` imports it. Phase 1 folds it into the tool registry.

## Revisit if...

- A tool executor's storage/IndexedDB path becomes worth testing — promote the `fake-indexeddb` setup into real DB-backed tests.
- The fixtures drift from the live API shape (a live capture surfaces a field the fixture lacks) — refresh the fabricated fixture from the new interface.

## References

- [`notes/fixtures/audit.fixture.json`](../fixtures/audit.fixture.json), [`notes/fixtures/banner-sections.fixture.json`](../fixtures/banner-sections.fixture.json)
- [`src/background/agent/degreeworks-audit-to-text.test.ts`](../../src/background/agent/degreeworks-audit-to-text.test.ts) — renderer snapshot + PII regression
- [`src/background/agent/tools/what-if.ts`](../../src/background/agent/tools/what-if.ts) — extracted `buildWhatIfGoals` (moved under `tools/` by ADR 0019)
- [ADR 0009](./0009-pii-boundary-at-renderer.md) — the boundary this test now enforces
- [ADR 0017](./0017-retrospective.md) — the rebuild item this acts on
