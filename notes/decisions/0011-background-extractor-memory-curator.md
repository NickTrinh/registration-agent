# 0011 — Background-extractor memory curator (two-model pattern)

- **Status**: Accepted · Extended by ADR 0013 (two-tier split)
- **Date**: 2026-04-15
- **Related**: enables 0012 (routing-table memory index); runs under 0003 (worker owns the Haiku call); extended by 0013 (single-tier → two-tier)

## Context

The academic advisor needs to remember things across conversations: which electives the student is interested in, schedule constraints, declared goals, committed decisions. Without long-term memory, every session starts from zero — the student re-explains the same context every time, and the assistant re-recommends courses that were already ruled out in a prior session. For a tool meant to reduce cognitive load over a multi-semester planning horizon, that's a fatal UX failure.

The question isn't *whether* to add long-term memory — it's *who decides what's worth remembering* and *when that decision runs*. A naive implementation would give the main chat model a `save_memory` tool and let it decide during the conversation. That raises three problems:

1. Memory curation competes with the chat task for Sonnet's attention budget.
2. Save-memory latency is coupled to chat latency — the student waits on curation before seeing the answer.
3. Sonnet is optimized for the user-facing conversation, not for compressing facts into durable entries.

Recent research and production deployments — OpenAI's ChatGPT memory, A-MEM, AgeMem, MIRIX, RAISE, MemGPT — converge on a different pattern: **background extraction**. A smaller, cheaper model runs alongside the main assistant, scans each turn for durable facts, and writes to a shared memory store. The user sees no latency cost; the main model focuses on conversation.

The user independently arrived at this intuition via DeepSeek V3.2's gating-network pattern (a small specialized model decides what the big model sees). This session locks that design in.

## Decision

After each Sonnet chat turn finishes (`AI_DONE`), fire an asynchronous call to Haiku 4.5 — the "curator" — with:

- The user's message from this turn
- Sonnet's final response text from this turn
- The current memory index (to avoid duplicate extractions)

Haiku runs a dedicated extraction prompt with an explicit type taxonomy (`interest` | `constraint` | `goal` | `decision` | `note`), negative examples, a duplicate-avoidance hook, and a description-quality rubric with concrete BAD/GOOD examples. It returns a JSON object with zero or more candidate memories, each carrying `type`, `description` (≤10 words, the routing-table hook from ADR 0012), and `content` (1–3 sentences, the full body).

The service worker validates each candidate (type in enum, non-empty description, non-empty content) and then either writes it to the store (`write: true`) or logs it for prompt tuning (`write: false`, the day-one default).

The curator is FIRE-AND-FORGET from the chat loop's perspective: failures are caught and logged but never surface to the user. The chat turn is complete before the curator runs; the student is free to send the next message immediately.

## Alternatives considered

### Alternative A: Single-model inline extraction (give Sonnet a `save_memory` tool)

The simplest architecture — one model, one API call, a new tool. Rejected for three reasons:

1. **Attention-budget contention**: Sonnet is already handling a multi-tool chat with catalog search, attribute lookup, memory recall, and reasoning about course recommendations. Adding "is anything in this turn worth remembering?" as a concurrent task dilutes focus on the actual conversation.
2. **Latency coupling**: `save_memory` calls happen during the chat turn. Even if the write itself is fast, the model's token output for the tool call blocks the final streaming response. The student waits on curation before seeing the answer.
3. **Wrong model for the job**: Sonnet is optimized for high-quality conversation; Haiku is optimized for cheap, reliable extraction. Using Sonnet for curation is using a scalpel for hedge trimming.

### Alternative B: User-prompted saves ("remember this")

Only save memories when the student explicitly asks ("remember that I want to graduate spring 2027"). Rejected hard: the whole point of the advisor is to REDUCE the student's cognitive load, not add a "what's worth remembering?" chore. Students won't use it; memory quality would depend on the student's own meta-awareness of their own planning process — exactly the thing the tool is supposed to relieve.

### Alternative C: Anthropic's native `memory_20250818` tool

Anthropic recently shipped a memory tool with six primitives (`view` / `create` / `str_replace` / `insert` / `delete` / `rename`) and a client-side backend. Tempting to adopt wholesale. Rejected because the tool provides STORAGE primitives only — it doesn't decide what to save. Using it would still require a second model (or Sonnet with `save_memory`-style tool calls) to decide what to write, which lands us back at Alternative A or at this ADR. The native tool is worth reconsidering post-MVP as a drop-in backend replacement for `memory-store.ts`, but it doesn't change the two-model pattern decision.

### Alternative D: Vector embeddings + semantic retrieval (no curator)

Embed every message, store embeddings, retrieve top-K similar past messages per turn. Rejected because it solves the wrong problem. Vector retrieval addresses "how do I search saved things?" — but the shaping question here is "what's worth saving in the first place?" Vector search over raw conversation logs, without any curation, means Sonnet either sees a firehose of old messages (useless) or depends on retrieval quality to surface the right one (unreliable). Curation is the prerequisite; retrieval is a later optimization layer.

## Consequences

**Chat latency is unchanged**: the fire-and-forget curator runs after `AI_DONE`, which is after Sonnet's stream has completed. The student sees the next-turn input box the moment Sonnet finishes; the curator runs in the background on the worker thread.

**Cost is cheap**: Haiku at ~500 input + ~200 output tokens per turn is well under a penny at current pricing. Even at 100 turns per session across the competition demo period, total curator cost is negligible compared to the Sonnet chat itself.

**Stub mode decouples prompt tuning from data persistence**: Day 1 ships with `{ write: false }`. Candidates log to the service worker console; the prompt can be iterated on real turns; no real memory writes happen until the prompt is dialed in. Day 2 flips a single flag at the call site. This de-risks the prompt-quality dimension entirely — we can tune without polluting the store.

**Curator failures are invisible to the user**: every call path is wrapped in `.catch()`. If Haiku is slow, flaky, returns malformed JSON, or throws on a network hiccup, the student sees nothing; only the service worker log shows the issue.

**Two-model pattern mirrors DeepSeek V3.2's gating network** — independent intuition from the user, independently validated by the background-extractor literature from OpenAI production, A-MEM, AgeMem, MIRIX, RAISE, and MemGPT. This convergence is demo-ready context: "how does this memory system work? same pattern as DeepSeek's MoE routing — one small model decides, the big model consumes."

**Extensibility is cheap**: adding a memory type (e.g. `deadline`) is a prompt change; adding per-Banner-ID namespacing is a storage-key change; adding consolidation (merging related memories, pruning stale ones) is a new pass over the memory list. Each extension has a clean insertion point without restructuring the curator.

**Accepts the risk of over-extraction**: an aggressive curator could write low-quality memories that pollute the index. Mitigation is the stub-mode testing phase plus the curator's explicit "most turns will have NOTHING worth saving" instruction and the 50-entry cap with drop-oldest eviction. If the bar turns out to be wrong, the prompt is the tuning knob, not the architecture.

## Revisit if...

- Haiku curator latency exceeds ~3s per turn and starts blocking subsequent curator runs (implies concurrency limit is needed).
- Anthropic's native memory tool gains a "curator" primitive or a built-in extraction model.
- Memory write rate sustains at >3 per turn, implying the extraction prompt is too permissive and the curator is generating noise.

## References

- [`src/background/agent/memory-curator.ts`](../../src/background/agent/memory-curator.ts) — the curator implementation, including the full extraction prompt with BAD/GOOD description examples.
- [`src/background/service-worker.ts`](../../src/background/service-worker.ts) — the fire-and-forget integration after `AI_DONE`.
- [`src/background/agent/memory-store.ts`](../../src/background/agent/memory-store.ts) — the underlying CRUD that `addMemory()` writes through.
- Related literature: MemGPT (UC Berkeley 2023), A-MEM, AgeMem, MIRIX, LangMem, OpenAI production memory architecture. DeepSeek V3.2 gating-network paper cited as the user's independent intuition anchor.
