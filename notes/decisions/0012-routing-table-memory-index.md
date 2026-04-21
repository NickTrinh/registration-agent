# 0012 — Routing-table memory index with `recall_memory` tool (MemGPT-style paging)

- **Status**: Accepted
- **Date**: 2026-04-15
- **Related**: depends on 0011 (the curator supplies memory content); runs under 0003 (worker owns the tool executor); affects 0010 (memory index is part of the cached prefix)

## Context

Given a background curator that writes memories (ADR 0011) and a hard cap on memory-store size (50 entries), the next decision is: **how does the main chat model (Sonnet) see memory?** The naive option is to inject every memory's full content into every chat turn's system prompt. At 50 entries × ~100 tokens per full content, that's ~5000 tokens of memory per turn, before the audit (~2–3k), profile (~500), and instructions (~500). A single turn's system prompt balloons to 8–9k tokens on static content alone, crowding out conversation history and tool results.

Worse, most of those memories are irrelevant to most turns. A student asking "what electives can I take this semester?" doesn't need the model to reload "student wants to apply to grad school in 2028" — that's context for a different turn. Full injection is wasteful tokens AND attentional noise.

Research on long-context memory (MemGPT, A-MEM, LangMem) converges on a paging architecture: keep a small index in the always-visible prompt, load specific memories on demand via a tool call. The index is cheap to inject; the content is loaded only when needed. This is the exact pattern here.

The user proposed a routing-table variant: an ID-addressable index where Sonnet sees `#<id> [<type>] <short description>` per entry, and a `recall_memory(ids)` tool that loads full content for specific IDs. This session locked that design in.

## Decision

Inject a Memory Index into the system prompt on every chat turn. Each entry is one line:

```
#1 [interest] ML electives for spring 2026
#2 [constraint] No Friday classes (works library shift)
#3 [goal] Graduating Spring 2027
```

The description is the curator's ≤10-word terse hook (ADR 0011). Sonnet reads the index, decides whether any entry is relevant to the student's current message, and calls `recall_memory({ ids: [1, 3] })` to load the full `content` field for selected entries. The index is ALWAYS in the system prompt; contents are loaded ON DEMAND.

`recall_memory` is a third tool alongside `search_catalog` and `list_attributes`, defined in `memory-store.ts` and executed in the same tool-use dispatch loop in `handleAIChat`. Sonnet's tool-calling training handles the "is this relevant?" decision.

Touched memories bump their `lastAccessedAt` timestamp, supporting later consolidation passes that prune low-value entries by access recency.

## Alternatives considered

### Alternative A: Full injection (every memory, every turn)

Dump all 50 memories' full content into the system prompt. Rejected:

- 5k tokens of memory content per turn is 50% of a typical 10k system-prompt budget, leaving little room for audit + profile + history + tool results.
- Most memories are irrelevant to any given turn; Sonnet's attention is spent parsing unrelated context.
- Cache invalidation (ADR 0010) costs scale with memory writes — one new memory invalidates the full-injection prefix, forcing a cache rewrite of ~5k tokens. With routing, one new memory invalidates only the index line, ~30 tokens. The cache-friendliness delta is significant over a session.
- Doesn't align with memory-as-paging literature, which demonstrably works better for conversation agents at this scale.

### Alternative B: Hybrid — hot cache in full + routing table for the rest

Inject the N most recent memories in full (the "hot set"), index the rest. Tempting for demo moments where the very recent memories are exactly what the model needs. Rejected for MVP because:

- Adds a "what's N?" tuning knob with no clear right answer — is it 3? 5? 10?
- The routing-table version is simpler to implement and reason about.
- If Sonnet skips `recall_memory` too often, the fix is prompt tuning (stronger instruction, better description quality), not architectural complication.

Can be added later as an optimization if token budget pressure reappears.

### Alternative C: Vector embeddings + semantic retrieval

Embed each memory on write, embed the current user message on every turn, retrieve top-K semantically similar memories. Rejected because:

- 50 memories is too small a haystack for vector search to dominate keyword-or-routing-based matching.
- Embedding calls are an extra API hop per turn and per write.
- The routing decision quality depends on description quality (which the curator controls) and matching quality (which Sonnet's tool-calling handles natively). No embedding infrastructure required.
- If memory count grows past ~500, vector retrieval becomes the natural next step — but that's a later optimization, not an MVP requirement.

### Alternative D: Anthropic's native `memory_20250818` tool as the backend

Use Anthropic's shipped memory primitives (`view`, `create`, `str_replace`, etc.) as the storage layer, routing the index as custom content. Rejected for the MVP because:

- The native tool's interface is file-system-oriented (paths, views), not index-oriented. Bending it into a routing table adds layers without simplifying.
- The full control we have over the index format (critical for Sonnet's match/no-match decision quality) would be partially lost to the native tool's abstractions.
- The native tool is a viable post-MVP drop-in backend for `memory-store.ts`, but it doesn't change this ADR's shaping decision.

## Consequences

**Token budget scales as O(memories × description_length)**, not O(memories × content_length). Descriptions are ≤10 words (~15 tokens each); contents are 1–3 sentences (~50–100 tokens each). ~5–7× savings on memory injection. At the 50-entry cap, the full index fits in ~750 tokens instead of ~5000.

**Cache behavior is favorable**: a new memory invalidates one index line (~30 tokens), not the whole memory content block. Cache rewrite cost is bounded per curator write, amortizing cleanly across a session.

**Sonnet must decide whether to call `recall_memory`**. This is the key risk. If descriptions are too vague, Sonnet skips the tool and hallucinates from the index alone; if descriptions are too specific, Sonnet calls recall unnecessarily and wastes turns. Mitigation: the curator prompt (ADR 0011) has explicit BAD/GOOD description examples, and the description-quality rubric is the curator's single most important guardrail.

**Demo narrative is legible**: "the assistant consults its long-term memory when relevant" is a story judges can follow. The tool call will be visible in the chat UI's tool-event chips (once A8 ships), showing Sonnet making a deliberate decision to look up a specific memory. Full injection would be opaque — the model just "magically knows" without an observable lookup.

**Aligns with Claude's training**: tool use is a first-class capability in Anthropic's models. `recall_memory` as a tool is a natural fit for Sonnet's reasoning loop, reusing the exact same infrastructure as `search_catalog` and `list_attributes`.

**Matches published research architectures**: MemGPT's paging mechanism is the canonical example; this ADR's routing table is essentially MemGPT-style paging without the full OS-like memory hierarchy. Independent research validation for a choice we arrived at from first principles.

**One new dependency per turn**: the memory index must be rendered into system-prompt text on every `handleAIChat` call. `memoriesToIndexText()` is O(memories) and runs in <1ms for 50 entries. Negligible overhead.

**Touched memories bump `lastAccessedAt`**: this enables a future consolidation pass that prunes low-access memories. Not implemented today, but the data is captured so the future pass doesn't need a migration.

## Revisit if...

- Sonnet's `recall_memory` call rate drops below ~10% of turns where a relevant memory exists (descriptions are too vague — tune the curator).
- Sonnet calls `recall_memory` on every turn even when nothing's relevant (index is too noisy — tighten the curator's "empty is expected" instruction).
- Memory count grows past ~500 and token pressure or index readability degrade.
- Anthropic ships a native memory-routing primitive that makes the custom tool obsolete.

## References

- [`src/background/agent/memory-store.ts`](../../src/background/agent/memory-store.ts) — CRUD, `memoriesToIndexText()` renderer, `RECALL_MEMORY_TOOL` schema, `executeRecallMemory` executor.
- [`src/background/service-worker.ts`](../../src/background/service-worker.ts) — system-prompt injection site and tool-use dispatcher branch.
- [MemGPT (Packer et al., 2023)](https://arxiv.org/abs/2310.08560) — the paging-mechanism paper this ADR's routing table is modeled on.
- Related memory-routing designs: A-MEM, LangMem, AgeMem.
