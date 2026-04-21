# 0007 — Reverse-map Fordham's ATTRIBUTE taxonomy from the audit rule tree

- **Status**: Accepted
- **Date**: 2026-04-14
- **Session**: [`_ops/journal/2026-04-14.md`](../../../../_ops/journal/2026-04-14.md)
- **Related**: depends on 0002 (JSON API) and 0005 (parser grammar)

## Context

Fordham's Core Curriculum is structured around **ATTRIBUTE codes** — short symbols the registrar attaches to courses to indicate which core requirement a course satisfies. Known attributes include:

- Core slots: `FCRH`, `MCR`, `FACC`, `HC`, `SSCI`, `STXT`, `ALC`, `ASSC`, `ICC`, `EP1`–`EP4` (Eloquentia Perfecta levels), `GLBL`, `PLUR`, `MANR`
- Major-specific: `PYBP`, `PYCP`, `PYAC`, `PYCA`, `PYCL`, `PSDV`, `PSYC` (Psychology)
- Dozens more per department

For the AI advisor to answer questions like *"what courses satisfy my remaining EP3 requirement?"*, it needs an **ATTRIBUTE → requirement** mapping: which attribute codes satisfy which rule slots, and which courses in the Banner catalog carry those attributes. The obvious source is Fordham's official Academic Bulletin, a ~330 kB PDF describing the core curriculum.

Early in the data-gathering phase we started down that path: parsed the bulletin PDF into `projects/ai-challenge/data/core-curriculum.json` (~170 kB) as a static lookup table. This was the approach the project inherited from the Python prototype era.

Then, while mapping the `Requirement` grammar from live audit responses (ADR 0002, ADR 0005), a pattern emerged: every Course-rule in the audit has `requirement.courseArray[].withArray[]` clauses of the form:

```json
{ "code": "ATTRIBUTE", "operator": "=", "valueList": ["EP3"], "connector": "OR" }
```

This is the server's own proof that attribute `EP3` is exactly the constraint satisfying this rule's slot. It's richer than the bulletin because it carries boolean connectors (AND/OR), exclusion clauses (`except.courseArray`), and tiebreaker fields (`decide: "LOWTERM"`) that no PDF summary captures.

## Decision

Don't scrape the bulletin. Walk the audit's own rule tree to derive the ATTRIBUTE → requirement mapping per-student, on-the-fly, from the rule tree in the response we already have in hand. Each Course-rule's `withArray` clause with `code: "ATTRIBUTE"` is the authoritative proof of which attribute satisfies that slot. A single traversal of the rule tree builds the full per-student map in O(rules) time.

Corollary: delete `projects/ai-challenge/data/core-curriculum.json` and the `2025-2026 Fordham Academic Bulletin-core-curriculum.pdf` that fed it. Removed 2026-04-14.

## Alternatives considered

### Alternative A: Scrape the academic bulletin PDF into a static lookup

Started this and backed out. Three failure modes:

1. **Stale by construction.** The bulletin lags the actual audit engine. Course attributes and requirement rules change by catalog year and can be patched intra-year by the registrar. A static JSON is a snapshot that drifts.
2. **Lossy parsing.** PDF → JSON extraction misses nuance: boolean connectors, exclusions, in-progress treatment, `decide` tiebreakers. Any parser is a continuous battle against the PDF format.
3. **Wrong source of truth.** The audit server is the canonical authority. Anything derived from the PDF is a second-order estimate of what the audit server will do. Reverse-mapping from the server's own output is first-order.

### Alternative B: Ask Claude to supply the mapping from training knowledge

Rejected because training data is stale and incomplete for institution-specific taxonomies like Fordham's attribute codes. Claude would hallucinate confidently — e.g. guess that `EP3` means something plausible based on "Eloquentia Perfecta 3" without knowing which specific rule it satisfies in the 2024 catalog for a Biology BS. Unacceptable for grounded advising.

### Alternative C: Manually curate an internal table by asking an advisor

Doesn't scale (we have ~15 core slots × ~8 majors we want to support) and the advisor's mental model is itself a stale cache of the real audit rules. Introduces a human-in-the-loop where one isn't needed.

## Consequences

**Always current.** The mapping reflects whatever the audit server evaluated for this specific student on today's date for their specific catalog year. A 2023-catalog student and a 2024-catalog student get their respective mappings automatically — no per-catalog-year maintenance.

**Works across majors and programs without code changes.** Any new major block (via What-If, ADR 0006) comes with its own `withArray` clauses; the reverse-mapper walks them with the same traversal.

**Deleted ~500 kB of files** (the `data/` folder and the bulletin PDF) on 2026-04-14. The project tree is cleaner and the fork's initial data-scraping assumption is removed.

**Couples the parser to `Requirement.courseArray[].withArray[]` shape**, which is preserved explicitly in the TypeScript interface in `degreeworks-api-reference.md`. The interface is the contract the reverse-mapper depends on; if Ellucian changes the grammar, we update in one place.

**Opens a follow-on feature**: a "why is this course recommended?" explainer that quotes the literal `withArray` clause the server used to justify the match. This is a natural demo moment and grounds the AI's reasoning in the server's actual evaluation logic.

## References

- [`notes/degreeworks-api-reference.md`](../degreeworks-api-reference.md) — the `Requirement` and `CourseMatcher` and `WithClause` interfaces document the tree shape the reverse-mapper walks.
- Deleted: `projects/ai-challenge/2025-2026 Fordham Academic Bulletin-core-curriculum.pdf`, `projects/ai-challenge/data/core-curriculum.json`, `projects/ai-challenge/data/`.
