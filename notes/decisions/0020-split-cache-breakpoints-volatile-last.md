# 0020 — Split cache breakpoints; volatile context after the last breakpoint

- **Status**: Accepted
- **Date**: 2026-07-08
- **Related**: amends 0010 (single system-prompt breakpoint); runs under 0003 (worker owns the call site); interacts with 0011/0012 (curator writes the memory index that invalidated the old single block)

## Context

ADR 0010 wrapped the entire advisor system prompt — instructions, profile, memory index, and the live audit — in ONE `cache_control: { type: "ephemeral" }` breakpoint. That was correct when the memory index was empty and the curator ran in stub mode. It stopped being correct once the curator began writing memories live (ADR 0011 → write mode).

The problem is invalidation granularity. Anthropic's prompt cache keys on the byte prefix up to a breakpoint. With a single breakpoint covering the whole prompt, ANY change to ANY segment invalidates the entire cached prefix. The memory index sits inside that prefix, and the background curator rewrites it on any turn it flags a durable fact. So the most frequent mutation in the system — a memory save — forces a full-length cache write on the next turn, re-tokenizing the ~3k-token instruction + audit prefix that did not change at all. ADR 0010's own "Revisit if…" anticipated exactly this: "Memory index grows … separating the memory-index segment into its own breakpoint … becomes worth the complexity."

## Decision

Split the advisor system prompt into three ordered blocks:

1. **Stable instructions** — role, placeholders, audit-format guide, tools guide, response style, tone, constraints (everything mode-invariant). `cache_control: ephemeral`.
2. **Audit text** — changes only on a DegreeWorks refresh. `cache_control: ephemeral`.
3. **Volatile** — student profile + memory index. **No `cache_control`.**

Because the volatile block sits *after* the last cache breakpoint, its churn never invalidates blocks 1–2. A curator memory save now costs only the (small) re-send of the volatile tail; the ~3k-token instruction + audit prefix keeps reading from cache for the rest of the 5-minute TTL. The onboarding prompt gets the same treatment with two blocks (intake prompt | audit) and no volatile segment (memories are empty during intake by definition).

Prompt text is unchanged — only block boundaries and ordering moved.

## Alternatives considered

### Alternative A: Keep the single breakpoint (ADR 0010 as-is)

The status quo. Rejected: every curator save invalidates the whole prefix, and with live curation that is the common case, not the rare one ADR 0010 assumed. The single breakpoint now pays a full cache-write on a large fraction of turns.

### Alternative B: Move the memory index into its own cached breakpoint (between audit and a trailing segment)

Give the memory index a third `cache_control` breakpoint so it caches independently. Rejected: a volatile segment that mutates every few turns does not benefit from caching — you pay the write penalty on each mutation with little read amortization, and you consume one of Anthropic's four breakpoint slots for no gain. Leaving the volatile block *uncached and last* is strictly better: no write penalty, no invalidation upstream.

### Alternative C: Stop rendering the memory index in the system prompt entirely (fetch on demand)

Drop the routing index from the prompt and have the model recall blindly. Rejected: the index is the whole mechanism of ADR 0012 — the model needs the terse `#id [type] description` lines to decide *what* to recall. Removing it trades a caching problem for a capability regression.

## Consequences

- **Cache-hit rate on turn 2+ recovers to ~100% of the instruction + audit prefix even after a memory save.** The dominant invalidation source (curator writes) is moved out of the cached region. This is the direct payoff ADR 0010 deferred.
- **Locks in block ordering as load-bearing.** The volatile block MUST stay last; a future edit that appends anything cache-worthy after it, or that reorders profile/memory ahead of the audit, silently reintroduces the invalidation. The builder comments call this out.
- **Positional-reference debt.** The "Tools" and "Memory Index" copy still says the index is "above," but it now renders below the instructions. Wording was preserved per the execution plan; behavior in testing is unaffected (the model reads the whole prompt), but a future prose pass should reconcile "above" → "below." Flagged for Patch/Cael.
- **Accepts up to four breakpoints max** (Anthropic's cap). Advisor uses two, onboarding two — comfortable headroom.
- **Verification is Patch's** (needs live DegreeWorks login): a two-turn chat with a `save_memory` between turns should show `cache_read_input_tokens > 0` on turn 2+ in the worker logs, where the old single-block prompt would show 0 after the save.

## Revisit if...

- Anthropic changes cache semantics so that trailing uncached segments carry a re-tokenization penalty large enough to matter.
- The volatile block grows large enough (profile + index past ~1.5k tokens) that its per-turn re-send cost rivals what caching it would save — at which point Alternative B's cost/benefit flips.

## References

- [`src/background/agent/prompts.ts`](../../src/background/agent/prompts.ts) — `buildAdvisorSystemBlocks` / `buildOnboardingSystemBlocks`.
- [ADR 0010](./0010-prompt-caching-at-system-breakpoint.md) — the single-breakpoint decision this amends.
- [Anthropic prompt caching documentation](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) — breakpoint + TTL semantics.
