# 0020 — Split cache breakpoints; volatile context after the last breakpoint

- **Status**: Accepted · Revisited 2026-07-09
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

## Revisited — 2026-07-09

**The claim "Prompt text is unchanged — only block boundaries and ordering moved" (above, under Decision) was false.** The split dropped the `\n\n` that separated the prompt's sections, so the assembled text was not what it had been. The sentence stays above, uncorrected, next to this note; the record of what we believed is worth as much as the record of what was true.

**What actually changed.** When the prompt was one string, a blank line sat between each section. Splitting it into blocks moved the section text but not the separators, and Anthropic joins system text blocks with nothing of its own. Three junctions ran on — two in the advisor prompt, one in onboarding:

```
advisor:      …never invent CRNs or times=== LIVE DEGREEWORKS AUDIT ===
advisor:      ==============================## Student Profile (persistent memory)
onboarding:   …feel like a real conversation.=== LIVE DEGREEWORKS AUDIT ===
```

Four characters vanished from the advisor prompt, two from onboarding. Section headers landed on the tail of the preceding line, which is exactly the kind of damage that reads fine in a diff and never shows up in a code review of the builder.

Note that the original claim was wrong in two distinct ways, only one of which is a defect. The **ordering** change was deliberate and is the point of this ADR — that half of the sentence disclosed itself. The **separator** loss was accidental and disclosed nothing. Reordering means the advisor prompt can never again be byte-identical to its pre-split self, and shouldn't be; onboarding has no volatile segment, so its assembly *is* byte-identical again.

**How it was found.** Not by reading the diff — by reconstructing the pre-split builder from `git show 66069f4^:src/background/agent/prompts.ts`, running both builders over the same inputs, and diffing the concatenated block texts. The assembled prompt is the only artifact the model actually sees, and it was the one thing the refactor never compared.

**How it's locked.** `prompts.ts` now routes every separator through one `SECTION_SEPARATOR` constant: each non-final block carries a trailing `\n\n`, the final block carries none. `src/background/agent/prompts.test.ts` asserts the structural invariants rather than snapshotting the copy — that every non-final block ends in exactly one blank line, that no block opens with a newline, that the assembled text never contains a blank run, that the named junctions hold, that the volatile block sits after the last cache breakpoint and stays uncached, and that mutating `profile` / `memoryIndex` leaves the cached blocks byte-stable. A snapshot test would have churned on every wording change and taught the next editor to re-bless it; these fail only when the structure breaks.

**One-time cache invalidation.** Restoring the separators changes the cached prefix, so the first request after this ships pays a full cache write on both the instruction and audit blocks. That is correct and unavoidable — the existing cache is caching the wrong text. The cost is one prefix write per active conversation within a 5-minute TTL, and it does not recur.

**Not affected.** `buildProfileExtractionPrompt` postdates this split (added in `b0526fc`) and never carried the defect. The curator passes a single `CURATOR_SYSTEM_PROMPT` string as `system:`, not a block array, so it has no junctions to lose. The positional-reference debt noted under Consequences ("above" vs "below") is unchanged and still open.

## References

- [`src/background/agent/prompts.ts`](../../src/background/agent/prompts.ts) — `buildAdvisorSystemBlocks` / `buildOnboardingSystemBlocks`.
- [`src/background/agent/prompts.test.ts`](../../src/background/agent/prompts.test.ts) — the boundary tests added by the 2026-07-09 revision.
- [ADR 0010](./0010-prompt-caching-at-system-breakpoint.md) — the single-breakpoint decision this amends.
- [Anthropic prompt caching documentation](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) — breakpoint + TTL semantics.
