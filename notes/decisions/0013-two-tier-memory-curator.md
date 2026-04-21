# 0013 — Two-Tier Memory Curator (Hard Facts + Provisional Interests)

- **Status**: Accepted · Revisited 2026-04-17
- **Date**: 2026-04-15
- **Related**: Extends 0011 (background-extractor memory curator), extends 0012 (routing-table memory index)

## Context

ADR 0011 introduced a single-tier Haiku curator: scan one user/assistant turn, extract durable facts, write to the memory store. Testing revealed two fundamental issues:

1. **Over-extraction.** The curator was extracting 5 candidates per turn — all of them restatements of audit data already in the system prompt. It couldn't distinguish "the advisor restated the student's enrollment" from "the student stated a new fact" because it only saw one turn of conversation and had no concept of what was already grounded.

2. **Soft signal blindness.** Single-turn extraction misses developing interests — a student who asks about theology three times across a session clearly cares about it, but no single turn explicitly states "I'm interested in theology." The single-tier model can only extract explicit statements, not patterns.

## Decision

Split the curator into two tiers:

- **Hard facts** (Tier 1): explicit, student-stated durable facts. Saved immediately to the main memory store. Extracted ONLY from what the student said in their own words, never from the advisor's responses.
- **Provisional interests** (Tier 2): soft signals. Accumulated in a separate `provisional` store with mention counts. When the same topic reaches 2 consistent mentions, automatically promoted to a real memory entry. Absorbed (deleted) when a hard fact on the same topic arrives.

The curator now receives the last 5 conversation turns (rolling window in `chrome.storage.local`) instead of one, enabling multi-turn pattern detection. Output schema changed from a single `memories[]` to `hardFacts[]` + `provisionalHits[]`.

## Alternatives considered

### Alternative A: Pass the full audit to the curator

Feed the audit text into Haiku's context so it can literally check "is this already in the audit?" Most robust for deduplication, but doubles the curator's token cost (~10k extra per turn) and adds latency. The "student-said-it" test plus worked examples achieved the same deduplication effect at ~100 extra tokens.

### Alternative B: Explicit counter without LLM involvement

Track topic tallies in a key-value store, increment mechanically on keyword match, promote on count threshold. Fully auditable but loses the ability to judge framing consistency — "theology" as a browsing query vs "theology focused on Middle Eastern traditions" as a developing interest look identical to a counter. The LLM-in-the-loop approach lets Haiku assess whether mentions are truly reinforcing.

### Alternative C: Embedding-based clustering

Vectorize each user message, store embeddings, cluster periodically, promote clusters that cross a density threshold. Elegant for research but requires an embedding model, vector storage, and clustering infrastructure — overkill for a sprint deadline and a Chrome extension's resource budget.

## Consequences

- **Curator prompt is now ~1200 tokens** (up from ~600), with 6 worked examples anchoring the BAD/GOOD rubric. Token cost per curator call roughly 3.5× the original.
- **Provisional store** (`chrome.storage.local` key `provisional`) is capped at 20 entries with drop-lowest-count eviction. Never enters Sonnet's system prompt — curator-only.
- **Absorption rule** prevents memory/provisional duplication: when a hard fact about topic X arrives, any provisional row matching topic X is deleted.
- **Curator is now in write mode** (`{ write: true }`) — the prompt is tuned, and writes are guarded by the two-check gate (student-said-it + not-in-audit).
- **Rolling buffer** (`curator_turns`, 5 entries) persists across MV3 service-worker unloads. Consumed only by the curator.
- **Settings UI** exposes both stores: "Long-Term Memory" for memories, collapsed "Developing interests" for provisional. Both are deletable.

## Revisit if...

- Haiku curator latency exceeds 3s per turn (would indicate the multi-turn context is too large)
- Provisional store regularly fills to 20 entries without promotions (threshold may be too high)
- Framing-consistency judgments prove unreliable (would motivate Alternative B's deterministic counter)

## Revisited — 2026-04-17

After live testing and a fresh-eyes code review, four friction points emerged:

1. **Silent saves felt invasive.** The curator was writing memories without any UI signal. Students didn't know memories were being created until they opened Settings.
2. **Students couldn't ask to save.** Saying "remember I want X" in normal chat didn't actually save — the curator *might* catch it later, but Sonnet had no `save_memory` tool in normal mode.
3. **The "Developing interests" UI section was confusing.** Students didn't understand why there were two lists. The provisional tier is implementation detail, not something they should reason about.
4. **The separate Haiku consolidator was redundant.** The store-level Jaccard dedup in `addMemory` + the curator's "don't re-extract" rule caught most of what the consolidator did, at zero extra Haiku cost.

We held a design-axis review with the user and locked in four choices. Each is implemented in commit `ebaebf8`:

- **Axis 1 = B** — Expose `save_memory` in normal chat mode alongside onboarding. Students can now explicitly save via "remember X" and Sonnet persists directly. Best of curator + explicit-request worlds.
- **Axis 2 = B + D** — Single-slot memory-save toast above the input bar (green chip, 3s auto-dismiss, replaced by the next save) + user-facing Settings toggle "Auto-save memories from chat" (default ON). Consent + transparency without clutter.
- **Axis 3 = D** — Hide the "Developing interests" Settings section; provisional store continues to accumulate internally. Students see only the memories tier; the provisional tier is developer-only.
- **Axis 4 = C** — Delete the standalone `memory-consolidator.ts` + `CONSOLIDATE_MEMORIES` handler + Settings button. Trust the Jaccard dedup at write-time and the curator's skip-if-exists rule to prevent duplicates in the first place.

Net effect: 474 lines deleted, 229 added. The refactor made the system simpler AND more responsive.

**Related updates in the same session:**
- `absorbProvisionalByTopic` now requires `MIN_TOPIC_LENGTH = 3` and uses hierarchical startsWith matching instead of raw substring. Fixes the "cs" → "economics" false-absorption bug.
- Sensitive-disclosure guardrails added to both the curator prompt and `save_memory` tool description (health, mental health, family crises, romantic/sexual, immigration, finances — acknowledge warmly but do not persist).
- ADR 0015 adds memory source attribution — every saved memory stores the verbatim quote that triggered it, shown in Settings as "you said: ..." for trust + debuggability.

## References

- ADR 0011 — original single-tier curator design
- ADR 0012 — routing-table memory index (unchanged by this ADR)
- ADR 0015 — memory source attribution (complements this architecture)
- MemGPT (Packer et al., 2023) — inspiration for the tiered memory architecture
