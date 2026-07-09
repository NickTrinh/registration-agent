# 0030 — Exactly one terminal event, from the turn that owns the spinner

- **Status**: Accepted
- **Date**: 2026-07-09
- **Related**: 0019 (chat loop extracted, deps injected), 0021 (MV3 keepalive); constrains the UI redesign's loading-state work

## Context

The sidebar's `loading` flag is set on send and cleared by a **terminal
broadcast** — `AI_DONE` or `AI_ERROR`. Nothing else clears it. Two defects broke
that contract from opposite directions.

**Too few.** `handleAIChat` did real work before its `try`:

```ts
const apiKey = await deps.getApiKey();   // storage read — can reject
…
const memories = await loadMemories();   // storage read — can reject
```

Both are `chrome.storage.local` reads. A rejection from either escaped the
function as an unhandled promise rejection (the caller in `service-worker.ts`
does not await it), no terminal event was ever broadcast, and the spinner ran
until the panel closed. The `!apiKey` case was handled; the *throwing* case, one
line above it, was not. Prompt assembly and the `Anthropic` construction sat in
the same unguarded region.

**Too many.** A turn that starts while another is streaming aborts the old
controller. The old turn's catch treats `AbortError` as benign and broadcasts
`AI_DONE` — which is correct for a *cancel* (panel close, the `CLEAR_MEMORIES`
barrier, where `AI_DONE` is the sidebar's only resolution) and wrong for a
*preempt*, where the new turn has already set `loading = true`. The stale
`AI_DONE` arrives a microtask later and clears the new turn's spinner while it
is still streaming. The comment on that branch — "panel closed **or new turn**"
— named the bug and shipped it anyway.

The two share one invariant: **exactly one terminal event per turn, emitted by
the turn that owns the spinner.**

## Decision

**Coverage.** The whole body of `handleAIChat` moves inside the `try`. The
controller is declared before it and assigned inside, so `finally` can still
release it. Every pre-stream rejection now reaches the catch and broadcasts
`AI_ERROR`.

**Ownership.** A module-level `WeakSet<AbortController>` records controllers
aborted *because a newer turn replaced them*:

```ts
if (currentChatController) {
  preempted.add(currentChatController);
  currentChatController.abort();
}
```

A preempted turn returns from its catch without broadcasting. Cancel is
untouched: its controller was never added, so `AI_DONE` is still delivered and
the panel-close / clear-memories paths still resolve.

## Alternatives considered

### Alternative A: infer preemption from `currentChatController !== controller`

The replacement assigns `currentChatController` synchronously after the abort,
so by the time the old turn's catch runs the identity check would already be
false. Rejected: it is true only because of microtask ordering between the abort
and the reassignment. A future `await` between those two lines silently inverts
it, and nothing would fail. The WeakSet states the intent *at the abort site*,
where the intent is actually known.

### Alternative B: sequence-number every turn; drop broadcasts from stale ids

Strictly more general — it would also suppress a preempted turn's `AI_CHUNK` and
tool broadcasts, not just its terminal event. Rejected as scope: aborting the
stream already stops those in practice, the bus is untyped (0028's recorded
weakness), and a turn id belongs in that typed-bus decision rather than smuggled
in ahead of it. Revisit when the bus is typed.

### Alternative C: let the sidebar ignore terminal events for a turn it did not start

Rejected for the same reason 0028 put the `uiOnly` label at the producer: the
worker knows it preempted a turn. Making the sidebar re-derive that from event
ordering asks the consumer to reconstruct information the producer discarded.

### Alternative D: guard each pre-stream call individually

`try`-wrap `getApiKey`, then `loadMemories`, then the prompt build. Rejected:
it enumerates today's throwing calls, and the next one added outside the list
reintroduces the hang. One region, one catch.

## Consequences

- The sidebar's loading state is unchanged by this ADR — no new flag, no new
  broadcast. `isInitialWait` and `isBetweenRounds` (`AuditChat.tsx`) remain the
  only two loading predicates, and a preempt now leaves them alone rather than
  needing a UI-side guard. The redesign can collapse the indicators against the
  machine as it stands.
- `AI_ERROR` becomes reachable from the pre-stream region. Its text is a storage
  error, not an API error — the sidebar renders both the same way, and 0028
  keeps both out of the prompt path.
- A preempted turn now logs and exits silently. If a preempt ever needs to be
  visible (e.g. "your previous question was cancelled"), it needs a *non*-terminal
  event; reusing `AI_DONE` for it is what this ADR forbids.
- `WeakSet` keys on the controller object, so a preempted controller is
  collectable the moment its turn unwinds. No cleanup path to forget.

## Revisit if…

- More than one chat can be in flight per worker. The single
  `currentChatController` module ref, not this decision, is the constraint —
  both would be replaced by a per-turn record.
- The worker↔sidebar bus gains a typed union. Terminal events should then be
  expressible as one variant carrying a turn id, and Alternative B becomes cheap.

## References

- [`src/background/agent/chat-loop.ts`](../../src/background/agent/chat-loop.ts) — the `try` that spans the preamble, the `preempted` WeakSet, the silent-return branch.
- [`src/background/agent/chat-loop.test.ts`](../../src/background/agent/chat-loop.test.ts) — pre-stream rejections (api key, memory load), preempt suppresses `AI_DONE`, cancel still delivers it.
- [`src/sidebar/pages/AuditChat.tsx`](../../src/sidebar/pages/AuditChat.tsx) — `case "AI_DONE"` / `case "AI_ERROR"`, the only writers of `loading = false`.
