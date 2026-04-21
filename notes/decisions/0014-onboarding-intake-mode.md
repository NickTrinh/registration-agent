# 0014 — Onboarding Intake Mode

- **Status**: Accepted · Revisited 2026-04-18
- **Date**: 2026-04-15
- **Related**: Depends on 0011 (curator), depends on 0012 (memory store), complements 0013 (two-tier curator)

## Context

The memory store starts empty. Without seeding, the advisor runs "cold" for the first 5-10 turns — it can't personalize recommendations because it hasn't learned anything about the student beyond the audit. The Haiku curator (ADR 0011/0013) extracts facts from natural conversation, but students rarely volunteer personal preferences unprompted. A student who opens the advisor and immediately asks "what do I still need to graduate?" generates zero extractable facts.

This creates a cold-start problem: the feature that most differentiates the advisor (personalized memory) is invisible during the demo's most critical moment — the first impression. Judges evaluating the tool in a 2-minute video need to see personalization from the first interaction, not after 10 turns of organic signal accumulation.

## Decision

Add an **onboarding intake mode** that triggers automatically when the memory store is empty and onboarding hasn't been completed before. Sonnet runs a structured but conversational intake, asking 5-7 questions about the student's interests, goals, constraints, and preferences. As facts emerge, Sonnet calls a new `save_memory` tool to persist them directly — no Haiku curator involvement (avoids double-extraction).

The intake runs in the same chat interface (Advisor tab) with a welcome card that auto-shows on first launch. The student can skip onboarding via a "Skip for now" button, which sets the completion flag without running the intake.

Onboarding ends when Sonnet emits the literal marker `**Onboarding complete.**` at the start of its final intake message. The side panel watches for this marker and flips the chat back to normal mode.

## Alternatives considered

### Alternative A: Seed memory from the audit

Run the Haiku curator over the raw audit text on first refresh to extract baseline facts (major, classification, in-progress courses, remaining requirements). Cheapest implementation. Rejected because every fact in the audit is already in the system prompt — "remembering" audit data is pure duplication (the exact failure mode we fixed in ADR 0013). The value of onboarding is learning things the audit doesn't contain.

### Alternative B: Hard-coded questionnaire form

Separate UI page with input fields for interests, goals, constraints, etc. Student fills it out, answers get saved as memories. More traditional UX. Rejected because (a) it feels like a form, not an advisor, and (b) it prevents follow-up questions — a form can't say "you mentioned theology, what specifically about theology?" The conversational intake is both more natural and more effective at eliciting specific, useful memories.

### Alternative C: Passive accumulation only

Rely entirely on the two-tier curator (ADR 0013) to build the memory store organically over multiple sessions. No special onboarding step. Rejected because of the cold-start problem: the first session produces minimal extractable facts (the student is browsing, not stating), and the demo video needs to show personalization immediately.

## Consequences

- **New tool: `save_memory`**, exposed to Sonnet only during onboarding mode. Mirrors `recall_memory` as an explicit write path. Haiku curator writes implicitly after turns; Sonnet writes explicitly during intake.
- **Mode flag**: `onboardingCompletedAt` in `chrome.storage.local`. Once set, onboarding never re-triggers — even if the student clears all memories, they'd need to manually reset this flag (or the developer clears storage) to re-run onboarding.
- **Curator is skipped during onboarding** — Sonnet is already writing memories via `save_memory`, running Haiku would double-extract.
- **Welcome card** in the Advisor tab is styled with Fordham maroon, has a "Let's get started" button (disabled until audit is loaded) and a "Skip for now" button. No separate page or route.
- **Memory chips**: `save_memory` calls render as green `💾` chips in the chat UI, giving the student real-time visibility into what the advisor is learning about them.
- **Settings panel** shows memories appearing live during onboarding (via `MEMORY_UPDATED` broadcast on each `save_memory` call).

## Revisit if...

- Students consistently skip onboarding — may need a gentler re-prompt mechanism
- Sonnet over-saves during intake (every answer → memory) — would need to tighten the onboarding system prompt
- Onboarding conversations routinely exceed 10 turns — the prompt may need a harder "wrap up" instruction

## Revisited — 2026-04-18

Live end-to-end testing surfaced three structural defects in the original design:

1. **Per-turn duplicate saves.** Sonnet re-extracted the same facts across multiple turns (e.g. "interest: philosophy of mind" saved on turn 2, then again on turn 4 with a slightly different phrasing). The curator prompt said "one memory per topic" but nothing enforced it — Jaccard dedup in `addMemory` was running but the model reframed topics enough to slip past the 0.6 threshold. Settings showed 6-8 memories after a 5-exchange intake where 4 were actually distinct.
2. **Post-tool-result echo bug.** When `save_memory` fired mid-turn, Sonnet's continuation after the tool result sometimes re-emitted the same wrap-up text into the same bubble, producing a double-paragraph render. The tool round-trip inside the assistant turn created an opportunity for the model to "recover" by repeating itself.
3. **Auto-fade wrap-up.** The `**Onboarding complete.**` marker triggered a 4-second `setMessages([])` that wiped the intake transcript. The student couldn't read the summary; worse, they couldn't see what memories had been saved before the chat vanished.

We locked in four changes:

- **Deferred-save queue** — `save_memory` during intake is queued to `onboarding_save_queue` in `chrome.storage.local` instead of persisting. The queue dedupes within itself at insertion time using the same normalize+Jaccard check used for cross-entry dedup.
- **New `complete_onboarding` tool** — replaces the text marker. Sonnet calls it to signal end-of-intake. The service worker drains the queue, writes each entry through `addMemory` (re-running Jaccard against existing memories), broadcasts progressive saves, sets the completion flag, and returns a result instructing Sonnet to emit its wrap-up.
- **Two-bubble end-of-intake UI** — a new "system-action" bubble (distinct from AI prose, maroon-bordered) lists each save with live pending→saved status and `you said: "..."` attribution. The wrap-up message streams in as a separate bubble below. Bug #2 dies because there's no mid-turn tool round-trip writing into the same bubble.
- **Inline "Continue to chat →" button** — replaces the 4-second auto-fade. The button appears under the wrap-up bubble; the input is disabled until the student clicks it. Conversation history is preserved (the student can scroll back and re-read the intake and save list).

Also folded in: `RESET_ONBOARDING` now also clears the queue; it broadcasts `ONBOARDING_RESET` which `AuditChat` listens for (no close/reopen required to see the welcome card again).

Net effect: the intake produces **exactly one save per distinct topic** at the end, the end-of-intake moment is explicit and gated by user action, and the duplicate-text bubble can no longer occur in onboarding (save_memory no longer does a mid-turn tool round-trip in onboarding mode).

## References

- ADR 0013 — two-tier curator (explains why onboarding bypasses the curator)
- ADR 0009 — PII boundary (onboarding prompt uses same [NAME]/[ADVISOR] tokens)
- ADR 0015 — source attribution (preserved across the queue → shown in the save-batch bubble)
