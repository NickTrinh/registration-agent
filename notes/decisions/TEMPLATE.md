<!--
  ADR TEMPLATE — clone this file to `NNNN-kebab-case-title.md` and fill in.

  Conventions live in ./README.md. Delete these HTML comments as you write.
  Target length: ~1 page (400–600 words). If you hit 2 pages, you probably
  have two decisions fused — split them into two ADRs.
-->

# NNNN — Title

- **Status**: Proposed <!-- or: Accepted | Superseded by NNNN | Deprecated -->
- **Date**: YYYY-MM-DD
- **Session**: [`_ops/journal/YYYY-MM-DD.md`](../../../../_ops/journal/YYYY-MM-DD.md) <!-- journal entry this came out of; delete if n/a -->
- **Related**: <!-- other ADRs, e.g. "depends on 0001, superseded by 0009" -->

## Context

<!--
  What was the problem? What forced a decision now?

  Include the forcing function — deadline, incident, policy constraint, data
  availability, a failed earlier approach. Be specific about constraints that
  weren't obvious from the code alone. A reader six months from now should
  understand WHY this decision mattered without having to dig through git log.

  1–3 paragraphs. Avoid generalities like "we needed to handle memory" —
  say "Sonnet's context budget caps around X tokens, and injecting the full
  memory corpus per turn was already 40% of that on day 1."
-->

## Decision

<!--
  What we chose, stated plainly. One or two sentences is ideal.

  This is the shortest section. If it takes four paragraphs to state the
  decision, the decision probably isn't crisp yet.
-->

## Alternatives considered

<!--
  The most valuable section for future readers. For each alternative:
    - What it was (one sentence)
    - Why we rejected it (one or two sentences — be CONCRETE)

  At least 2 alternatives. If there was genuinely only one path, this
  probably isn't ADR-worthy — a commit body would capture it better.
-->

### Alternative A: <name>

<!-- What it was; why rejected. -->

### Alternative B: <name>

<!-- What it was; why rejected. -->

<!-- Add more as needed. -->

## Consequences

<!--
  - What does this lock in?
  - What does this open up (future ADRs, features, refactors)?
  - What risks does this accept?
  - What would need to change elsewhere to undo this?

  Both sides of the ledger. Don't only list benefits — an ADR with no
  downsides is usually hiding something.
-->

## Revisit if...

<!--
  Optional. Explicit triggers that should prompt re-opening this decision.
  Examples:
    - "Haiku curator latency exceeds 3s per turn"
    - "Memory store regularly hits the 50-entry cap within a single session"
    - "Anthropic adds native memory primitives that obsolete the routing table"
  Omit this section entirely if there's no clear trigger.
-->

## References

<!--
  Optional. Links to:
    - PRs that implemented this ADR
    - Papers / external docs that informed the decision
    - Related ADRs in this directory
    - Upstream issues or vendor documentation
-->
