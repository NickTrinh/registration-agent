# 0005 — Dispatch on symbolic `.name` / `.ruleType`, not numeric `nodeType`

- **Status**: Accepted
- **Date**: 2026-04-14
- **Session**: [`_ops/journal/2026-04-14.md`](../../../../_ops/journal/2026-04-14.md)
- **Related**: downstream of 0002; closes a "Known Unknown" in the API reference

## Context

Ellucian's audit response decorates every qualifier and rule with *two* identifiers for what it is:

- A numeric `nodeType`: e.g. `"4101"` (MAXCLASS qualifier), `"4200"` (Course rule), `"4400"` (Block rule), `"4500"` (Blocktype rule used by What-If), `"4600"` (Group rule), `"4900"` (Complete rule). The codes live in a `4100–4999` space, are internal DB artifacts, and aren't publicly documented anywhere.
- A symbolic string: `qualifier.name` (e.g. `"MAXCLASS"`, `"MINGPA"`, `"NONEXCLUSIVE"`) or `rule.ruleType` (e.g. `"Course"`, `"Block"`, `"Group"`). These strings correspond directly to keywords in Ellucian's **Scribe** rule language — the DSL Fordham's registrar actually authors degree requirements in.

During API discovery we initially planned to maintain a complete numeric enum by observing all codes in live responses and building a lookup table — the API reference doc even had a "Known Unknowns: complete nodeType enum" item tracking it.

Then, while writing the `Qualifier` TypeScript interface, it became obvious that every observed response already carries `.name` next to `.nodeType`. We were about to maintain an enum that was strictly redundant with a field the server already ships on every object.

## Decision

The parser dispatches on the string fields (`qualifier.name`, `rule.ruleType`) exclusively. Qualifier handlers are keyed by name (`"MAXCLASS" | "MINGPA" | "NONEXCLUSIVE" | ...`); rule handlers are keyed by `ruleType`. The numeric `nodeType` is kept in `degreeworks-api-reference.md` as a debug quick-reference only — useful when staring at a raw response dump, but never used in code switches.

## Alternatives considered

### Alternative A: Dispatch on numeric `nodeType`

Requires reverse-engineering a complete enum from live responses we've never seen. Any unknown code encountered in production is a silent parse failure with no clear path to "what does 4187 mean?" — there's no Ellucian source document to consult. Also pins the parser to Ellucian's internal integer assignments, which could in theory be reassigned in a future release (the Scribe vocabulary is the external contract; the ints are implementation detail).

### Alternative B: Primary on numeric, fallback to string

Doubles the parsing surface area for zero benefit. The strings are already authoritative; adding numeric dispatch on top is strictly extra maintenance with no capability gain. We'd still need the string table for the fallback, plus a numeric table we couldn't fully populate.

### Alternative C: Handle only the observed subset and throw on unknowns

Rejected as a default. The audit has hundreds of rule nodes per student, and a single unknown would fail the entire parse with one hard error. Graceful degradation is correct here: unknown qualifier → show its `label` text, pass through; unknown rule → render its label and children without special handling.

## Consequences

**Closes the "complete nodeType enum" known-unknown** — not by completing it, but by demonstrating it isn't needed. The reference doc was updated to reflect this resolution and the item moved to the "Resolved ✅" section.

**Robust to rules we haven't seen yet.** Any new qualifier or rule type can be added by writing a new branch keyed on its `.name` / `.ruleType` value; unknown types fall through to a generic label renderer without crashing. This is the right degradation behavior for a parser that must handle arbitrary Fordham degree structures we haven't seen in Patch's audit.

**Couples the parser to Ellucian's Scribe vocabulary.** Strings like `"MAXCLASS"`, `"NONEXCLUSIVE"`, `"MINGPA"` are keywords in the Scribe rule language that Ellucian ships and that registrars write against. They're the most stable identifier Ellucian exposes — more stable than internal DB integer assignments.

**Documented qualifier keyword reference** (24 known names with shape hints, 12 live-confirmed and 12 documented-but-unobserved) lives in `degreeworks-api-reference.md`. This is the lookup future parser contributors consult, not a numeric table.

**One risk accepted**: if Ellucian ever renames a Scribe keyword (e.g. `MINRESIDENCECLASSES` → `MINRESCLASSES`), our switch fails for that case. This is unlikely because Scribe is a published rule language with backward compatibility requirements, but the "unknown → graceful label fallback" behavior mitigates even that.

## References

- [`notes/degreeworks-api-reference.md`](../degreeworks-api-reference.md) — Qualifier section has the full dispatch table.
- Ellucian Scribe rule language is the external source of truth for qualifier/rule keywords (not publicly linked here because docs are behind Ellucian customer portal).
