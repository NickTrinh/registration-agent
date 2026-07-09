# 0019 — Tool registry + agent-layer decomposition

- **Status**: Accepted
- **Date**: 2026-07-07
- **Related**: amends 0003 (worker still owns every fetch — see below); depends on 0018 (test net); sets up 0020 (cache-breakpoint split)

## Context

`service-worker.ts` had grown to 1306 lines. It held, in one file: the message-router switch, the audit-refresh flow, the profile extractor, the Banner catalog refresh, the full Sonnet chat loop, both system prompts (the ~90-line advisor prompt and the ~55-line onboarding prompt as template literals), the What-If tool executor, and an eight-branch `if/else if` chain that dispatched every tool by name inside the streaming loop. Adding a tool meant editing three places (the tool-set arrays, the dispatch chain, the result-chip logic) in a 1300-line file, and the chat loop couldn't be reasoned about without scrolling past 300 lines of prompt text.

The retrospective (0017) didn't call this out by name, but it's the same class of problem as the memory system it *did* flag: structure discovered late costs more than structure designed in. The infra pass exists to pay that down before the next feature cycle adds more tools.

## Decision

Decompose the agent layer into modules the worker imports, and replace the by-name `if/else` dispatch with a **tool registry**.

- `agent/tools/types.ts` — `ToolDef` (schema + `execute(input, ctx)` + optional `resultCount` for the UI chip + optional `silentIn` modes), `ToolContext` (the worker-owned capabilities a tool may reach for: `mode`, `broadcast`, `refreshAudit`, `hydrateStudentCache`), and the `StudentGoal` shape.
- `agent/tools/<one file per tool>` — `search-catalog`, `list-attributes`, `recall-memory`, `save-memory`, `forget-memory`, `what-if`, `complete-onboarding`. Each exports a `ToolDef`. The behaviors that used to live inline in the loop moved into their tool files intact: save_memory's onboarding-queue-vs-persist branch, and complete_onboarding's whole queue-drain-and-broadcast sequence.
- `agent/tools/index.ts` — `TOOLSETS: Record<ChatMode, ToolDef[]>` (identical per-mode memberships to the old tool arrays) and `REGISTRY` (by-name dispatch table).
- `agent/prompts.ts` — `ONBOARDING_SYSTEM_PROMPT` plus `buildAdvisorSystemBlocks(...)` / `buildOnboardingSystemBlocks(...)`. Prompt **text is byte-for-byte unchanged** this phase; the builders are the seam ADR 0020 splits.
- `agent/chat-loop.ts` — `handleAIChat` + `cancelCurrentChat`. The tool-use loop collapses to: look up the `ToolDef` by `block.name`, honor `silentIn`, call `execute(input, ctx)`, chip via `resultCount`; unknown tool → the same error string as before.
- `service-worker.ts` keeps the router, the caches (audit/profile/student-cache persist+hydrate), the curator buffer, `refreshAudit`, `extractProfile`, `refreshCatalog`, `getApiKey`, `broadcast` — and injects those worker-owned capabilities into the chat loop as a `ChatDeps` object.

This is a **zero-behavior-change refactor**: the offline test net from ADR 0018 (renderer snapshot, PII regression, banner mapping, `buildWhatIfGoals` cases) plus `tsc` and the production build are all green before and after.

### Why this amends 0003 rather than overturning it

ADR 0003 says "the service worker owns every third-party fetch." That ownership is **unchanged**. The code that performs the fetches (DegreeWorks, Banner, Anthropic) now lives in modules, but those modules are imported and driven by the worker, and the tools reach network capability only through the worker-injected `ToolContext`/`ChatDeps` — no tool file imports the service worker, and none opens a fetch surface the worker doesn't own. The decomposition moves *where the code lives*, not *who owns the capability*.

## Alternatives considered

### Alternative A: Leave the if/else dispatch, just move the prompts out

Would have cut ~150 lines cheaply. Rejected: the dispatch chain is the part that scales badly with tool count, and it's exactly what a feature cycle touches. Moving prompts without fixing dispatch treats the symptom.

### Alternative B: A class hierarchy of tools (abstract `Tool` base class, subclasses)

Rejected as over-engineered for seven tools with no shared state. A flat `ToolDef` record (data + two functions) is enough; a class tree adds ceremony and `this`-binding hazards for no gain.

### Alternative C: Keep executors in their existing modules; only relocate the schemas

Rejected as half a decomposition. The genuinely homeless logic (What-If executor, the save/complete-onboarding branches) lived in `service-worker.ts` with nowhere to go — the registry gives it one. (Catalog/memory *executors* do stay in their cohesive backing modules, `catalog-search.ts` / `memory-store.ts`; the tool files wrap them. See Consequences.)

## Consequences

- **Adding a tool is now one file** plus one line in each of `TOOLSETS`/`REGISTRY` — the done-state the plan asked for.
- **The chat loop is readable end-to-end** without scrolling through prompt text.
- **`service-worker.ts` dropped from 1306 to ~630 lines.** It did not reach the plan's optimistic "~500" estimate: what remains is all plan-designated keeps — the message router (~215 lines, kept unchanged by mandate), `refreshAudit`, the Haiku `extractProfile` (a worker-owned fetch under ADR 0003), `refreshCatalog`, and the caches. Cutting further would mean relocating a fetch the worker is supposed to own.
- **Backing-module cohesion is preserved.** `executeCatalogSearch`, `executeSaveMemory`, `executeForgetMemory`, `executeRecallMemory` stay in `catalog-search.ts` / `memory-store.ts` (which also export non-tool helpers the router and curator use). The tool files are thin `ToolDef` adapters over them. This deviates from a literal reading of "move all schemas/executors into tool files" in favor of one-source-of-truth: the memory logic stays in one place. The What-If and complete-onboarding schemas *did* relocate, because their logic had no backing module.
- **`ToolContext`/`ChatDeps` injection** keeps the dependency graph acyclic (worker → chat-loop → tools → types; nothing points back at the worker).
- **`buildWhatIfGoals`** (extracted in 0018) now lives with the What-If tool at `agent/tools/what-if.ts`.

## Revisit if...

- A tool needs a capability not on `ToolContext` — add it to the interface + `ChatDeps`, not a back-door import.
- Tool count or per-tool state grows enough that the flat `ToolDef` record starts wanting shared lifecycle — reconsider Alternative B then, not before.

## References

- [`src/background/agent/tools/`](../../src/background/agent/tools/) — registry + one file per tool
- [`src/background/agent/chat-loop.ts`](../../src/background/agent/chat-loop.ts), [`src/background/agent/prompts.ts`](../../src/background/agent/prompts.ts)
- [ADR 0003](./0003-service-worker-owns-api-calls.md) — fetch-ownership invariant this amends but preserves
- [ADR 0018](./0018-anonymized-fixtures-offline-test-loop.md) — the test net that made this safe
