# 0015 — Memory Source Attribution (Verbatim Quotes)

- **Status**: Accepted
- **Date**: 2026-04-17
- **Related**: Complements 0013 (two-tier curator) and 0014 (onboarding)

## Context

By mid-April, the extension was writing memories from two paths:
1. The Haiku background curator (after each chat turn)
2. Sonnet's `save_memory` tool (during onboarding; later extended to normal chat per ADR 0013 revisions)

Both paths produced memories that read as the model's paraphrase of something the student said — e.g., `content: "Student is interested in philosophy of mind, drawn from her neuroscience work"`. These paraphrases were reasonable but carried a trust problem:

- **The student couldn't verify.** Looking at a memory in Settings, there was no way to tell what they actually said vs. what the model inferred. If the memory was wrong, the only feedback was "this doesn't sound right."
- **Debugging was impossible.** When a memory looked off, we couldn't trace it back to a source turn. Was it a misunderstanding? A hallucinated inference? A real statement we forgot making?
- **The curator had no self-check.** The prompt said "extract from the student's own words," but nothing enforced it. A disciplined Haiku would respect the rule; a sloppy one would synthesize.

We needed a mechanism that simultaneously built student trust AND tightened the grounding signal for the models.

## Decision

Every memory entry stores a `sourceQuote` field — a **verbatim** snippet from the student's own message that justified the save. The quote is:

- Required (as a strong signal) — the curator prompt instructs: *"if you can't cite a concrete quote, drop the candidate."* Treating absence as a drop-signal ratchets up the grounding threshold.
- Short (≤25 words) — just enough context to be recognizable.
- Shown to the student in Settings as `you said: "..."` below each memory's content.
- Never paraphrased; never from the advisor's response; never synthesized.

This is implemented across three surfaces:
- `MemoryEntry.sourceQuote?: string` in the shared type
- `SAVE_MEMORY_TOOL` input schema adds an optional `sourceQuote` parameter (Sonnet supplies it)
- Curator hardFact output schema adds `sourceQuote` as a required field (Haiku supplies it)
- `addMemory()` accepts and persists the field; merge-dedup preserves existing quote when merging
- Settings UI renders the quote below content with a distinct italic style

## Alternatives considered

### Alternative A: Store the full user message that triggered the save

Keep the entire turn's user message alongside each memory. Maximum context, zero loss of detail.

Rejected: dramatically bloats storage for information the student doesn't need (a whole message to justify a short fact). Also privacy-adjacent — full messages may contain unrelated content (e.g. a health disclosure in the same turn as a course question). The short quote is specifically the fragment that justified the memory, which is the signal we actually want.

### Alternative B: Store a turn reference (index or timestamp), re-render quote from chat history

Memory entries store only `sourceTurnId`; Settings looks up the turn and extracts the relevant sentence at render time.

Rejected: chat history is session-scoped (cleared on browser quit). Memories outlive chat history by design. A reference that can't resolve later is worse than no reference.

### Alternative C: Confidence score instead of attribution

Each memory carries a 0–1 confidence score the curator sets based on how explicit the student was. Low confidence = the model was less sure.

Rejected for this use case: confidence is an abstraction that doesn't help the student. A number tells them nothing about WHY the memory exists. A quote tells them exactly. (Confidence as a concept was considered for the Axis 3 memory-tier redesign and also rejected in favor of D — hide provisional but keep the two-tier structure.)

### Alternative D: Don't store anything — students can trust the model

Rejected on user-trust grounds. In a tool that persists information across sessions and feeds it back into the model's context, provenance isn't optional. Particularly because the competition's key metric is "creates tangible value" — a black-box memory store is hard to defend as valuable.

## Consequences

**For the student:**
- Every memory has a visible "you said: ..." line. They can verify each entry against what they remember saying.
- Broken memories are easy to spot and fix — either delete, or use the inline editor (added in the same session) to correct.
- Trust in the memory system increases; over time the system is seen as an accurate record-keeper, not a surveillance tool.

**For the models:**
- Haiku's curator prompt now has a stronger grounding instruction. "Cite or drop" tightens extraction — a model that can't identify a specific quote is hallucinating, and the prompt tells it to bail. Expect this to reduce over-extraction further.
- Sonnet's `save_memory` tool description requires the quote too, enforcing the same discipline when the student asks to remember something.

**For the codebase:**
- One additional optional field on `MemoryEntry`. Merge logic preserves existing quotes (hard fact merging into an older entry keeps the older quote; the older entry's quote was valid).
- No migration concern for legacy entries — `sourceQuote` is optional, so pre-refactor memories display without the "you said" line; they still work.

## Revisit if...

- Haiku's curator consistently fails to produce citable quotes and we lose too many valid candidates (would soften the "cite or drop" instruction)
- Students don't find the "you said" line useful in testing (would consider hiding it behind a toggle)
- The same fact gets saved across multiple turns with different quotes — decide whether to preserve the first quote or the most recent

## References

- ADR 0013 — two-tier curator (source of the curator write path)
- ADR 0014 — onboarding mode (source of the save_memory write path)
- [`src/shared/types.ts`](../../src/shared/types.ts) — `MemoryEntry.sourceQuote`
- [`src/sidebar/pages/Settings.tsx`](../../src/sidebar/pages/Settings.tsx) — "you said" rendering
