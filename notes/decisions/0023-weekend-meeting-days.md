# 0023 — Weekend meeting days (Saturday / Sunday)

- **Status**: Accepted
- **Date**: 2026-07-08
- **Related**: fixes a gap in the 0008 Banner→Course mapping; unblocks a schedule-conflict checker

## Context

The `Day` type was `"M" | "T" | "W" | "R" | "F"` and `daysFromMeeting`
(`src/background/agent/banner-to-course.ts`) only read the Monday–Friday booleans
off Banner's `meetingTime`. But Banner exposes **all seven** days as separate
booleans (`monday`…`sunday`), and Fordham **does** schedule weekend sections —
confirmed against live data: `CHEM 1331` general chemistry lab meets Saturday, in
two blocks (08:30–09:20 and 09:30–12:20).

With the weekday-only mapping, a Saturday section lost its day entirely. Worse,
the mapper drops any meeting row where `days.length === 0 && !beginTime` — so a
Saturday section with an unusual/empty begin time could be dropped *whole*, and
one with a time kept the time but reported *no day*. Either outcome silently
corrupts any logic that reasons over when a class meets: a schedule-conflict
checker would miss weekend collisions, and the student would see a class with a
time but no day.

## Decision

Extend `Day` to `"M" | "T" | "W" | "R" | "F" | "S" | "U"` and map the
`saturday` / `sunday` booleans in `daysFromMeeting`. Letters follow the registrar
convention already in use (`R` = Thursday): **`S` = Saturday, `U` = Sunday**.

## Alternatives considered

### Alternative A: numeric day codes (0–6)

Represent days as integers. Rejected: throws away the human-readable, self-
documenting convention the codebase already uses (`R` for Thursday), for no gain —
the letters render directly and read clearly in tests and logs.

### Alternative B: keep M–F, bucket weekends as "other"

Add a single non-weekday marker. Rejected: it still discards *which* weekend day,
so it doesn't actually fix conflict detection — two Saturday classes and a
Saturday/Sunday pair would be indistinguishable.

## Consequences

- Weekend sections are represented faithfully; the schedule-conflict checker
  (future) can trust that every meeting carries its real day set.
- `Day` is now a **7-value union** — any exhaustive `switch`/mapping over `Day`
  (e.g. day-ordering, display formatting) must handle `S` and `U`. There are none
  today that would silently miss them, but new code should.
- A real, PII-scrubbed Saturday section (`CHEM 1331`, two meeting blocks) is now
  in `banner-sections.fixture.json`, so the mapping is locked against live data,
  not just a synthetic row.

## Revisit if...

- Banner changes how it encodes meeting days (e.g. drops the per-day booleans for
  a bitmask or day-of-week string) — the mapper's input contract would change.

## References

- [`src/shared/types.ts`](../../src/shared/types.ts) — `Day` union.
- [`src/background/agent/banner-to-course.ts`](../../src/background/agent/banner-to-course.ts) — `daysFromMeeting`.
- [`src/background/agent/banner-to-course.test.ts`](../../src/background/agent/banner-to-course.test.ts) — weekend-day tests + the real CHEM 1331 fixture case.
