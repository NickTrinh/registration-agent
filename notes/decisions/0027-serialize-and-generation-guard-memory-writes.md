# 0027 — Serialize memory writes and guard them with a store generation

- **Status**: Accepted
- **Date**: 2026-07-09
- **Related**: Applies 0003 (service worker owns state) to the memory store; hardens the curator from 0011/0013

## Context

`memory-store.ts` carried a comment claiming "the service worker is the single
writer." That is true of *processes* and false of *writers*. The worker runs
several concurrent async writers — the message router (delete / edit / clear),
Sonnet's `save_memory` and `forget_memory` tools, and the Haiku curator — and
every `await` inside a read-modify-write is an interleaving point. The comment
was the root misconception; the code inherited it.

The store looked safe because the warm-cache path serialized *by accident*:
`persist` assigned `cachedMemories` synchronously before its own `await`, and
`addMemory` had no interior `await` between its read and its persist. Nothing
enforced that. Any cold cache, any added `await`, and it breaks. Real races
survived on cold-cache reads, the provisional mention counter, the onboarding
save queue, `promoteProvisional` (double-promote), and the curator turn buffer.

The dominant harm was not a lost update, though. It was **resurrection after
clear**. The curator reads the store, awaits a multi-second Haiku call, then
writes back. A student who hits "clear all memories" inside that window watches
the store empty and then refill with the memories they just deleted. A lock
cannot fix this: the curator's read was legitimate when it happened, and no lock
is held across the API call. Two mechanisms are needed, not one.

Two adjacent bugs made the clear leaky on their own: the handler wiped
`memories` but left `provisional` and `curator_turns` behind — both of which
feed writes back into `memories` — and nothing cancelled the in-flight chat.

## Decision

The memory store is the concurrency boundary. Two mechanisms:

1. **`withStoreLock`** — a promise-chain serializer (`lock = lock.then(fn)`)
   wrapping every mutator across all four memory-subsystem keys. Non-reentrant
   by design: composing mutators call `*Locked` internals, so the lock is taken
   exactly once, at the public entry point.
2. **`storeGeneration`** — an in-memory counter bumped by every destructive op.
   A writer whose read is separated from its write by an external call captures
   the generation first and commits through `applyCuratorWrites`, which
   discards the entire batch, inside the lock, if the generation moved.

`CLEAR_MEMORIES` becomes a barrier: it cancels the in-flight chat, bumps the
generation, and wipes all three state keys under one lock.

## Alternatives considered

### Alternative A: the lock alone

Serialize every mutator and call it done. Rejected because it does not fix
resurrection, and we measured that rather than assumed it: with `withStoreLock`
in place and only the generation check disabled, the two resurrection tests fail
while all nine serialization and promotion tests pass. The lock orders writers
that overlap in time; the curator's write does not overlap the clear — it
*follows* it, carrying a read from before it.

### Alternative B: hold the lock across the Haiku call

Let the curator take the lock before its read and release it after its write.
Rejected: it holds a store-wide lock for the multi-second latency of an API
call. The student's "clear all memories" click would queue behind it, appear to
hang, and then resolve into exactly the write it was waiting on — the same bug,
now with a frozen UI.

### Alternative C: abort the curator via the chat's `AbortController`

Reuse the `CANCEL_AI_CHAT` teardown to kill the curator too. Rejected: by the
time the curator runs there is no controller to abort. The curator is
fire-and-forget *after* `AI_DONE`, and `chat-loop.ts`'s `finally` has already
nulled `currentChatController`. We still cancel the chat on clear — it stops the
stream and gives the sidebar its terminal `AI_DONE` — but it cannot reach the
curator. Cancellation covers producers that are still running; the generation
covers writes already in flight.

### Alternative D: compare-and-swap on a version key in `chrome.storage.local`

Persist the generation and check it at write time. Rejected: `chrome.storage`
has no CAS primitive, so the check-then-write on the version key is itself an
unserialized read-modify-write — the same race one level down. Every writer
lives in one worker, so an in-memory counter is exact and free.

## Consequences

- Mutators can no longer be composed by callers. The curator's write loop moved
  *into* the store as `applyCuratorWrites` so the generation check and the
  writes share one critical section; checking in the caller would leave a window
  between the check and each mutator's lock acquisition.
- **`withStoreLock` is not reentrant.** A future mutator that calls a public
  mutator instead of its `*Locked` twin deadlocks the chain silently. The
  invariant is commented at the lock and at each `*Locked` function. Real
  reentrancy detection needs `AsyncLocalStorage`, which MV3 does not have.
- One coarse lock spans memories, provisional, the curator buffer, and the
  onboarding queue. Writes to unrelated keys now serialize. Acceptable: every
  write is a sub-millisecond `chrome.storage` call, and `clearAllMemoryState`
  spans all four, so a per-key lock would let an append to one key race the
  clear of another.
- The generation is **not persisted**. A worker unload resets it to 0, which is
  sound — the unload kills every in-flight writer that could hold a stale one.
- The curator drops its **whole batch** if any delete intervenes, including a
  single `forget_memory`. It loses at most one turn's extraction, and a
  partially-applied batch is harder to reason about than none.
- Eviction, absorption, and promotion deliberately do **not** bump the
  generation. They are system-internal deletions; bumping would make a full
  store, or the curator's own absorption step, invalidate the batch mid-write.

## The premise the guard rests on

`storeGeneration` is module state, so an MV3 worker unload resets it to 0. That
is only sound because of an unstated property of the current design:

> **No writer survives a worker unload.** The curator's in-flight state lives
> entirely in the worker's heap — a pending promise around a `fetch`. When
> Chrome unloads the worker, the writer dies with the counter it captured. A
> generation of 0 can therefore never be compared against a stale capture,
> because no stale capture exists.

This premise is load-bearing and it is not enforced by anything. If a future
change persists the curator's pending work across an unload — resuming it from
`chrome.storage` on wake, retrying it from an alarm, or moving it to an
offscreen document — then a resumed writer would hold a pre-unload generation
and compare it against a counter that has been reset to 0. It would match. The
guard would pass, silently, and resurrection would return with no test failing.
Persisting the curator's in-flight state requires persisting the generation
alongside it (and then Alternative D's CAS problem is back).

## Revisit if...

- **Anything makes an in-flight writer outlive a worker unload** — an alarm-based
  curator retry, a resumable write queue, an offscreen document. That falsifies
  the premise above and the generation must become persisted state.
- Telemetry shows curator batches dropping often — that would argue for
  per-fact generation checks rather than batch-level.
- A second writer process appears (an offscreen document, another extension
  page). The in-memory generation stops being exact and Alternative D's
  persisted version — with a real CAS primitive — becomes necessary.
- Chrome ships a transactional `chrome.storage` API.

## References

- [`src/background/agent/memory-store.ts`](../../src/background/agent/memory-store.ts) — `withStoreLock`, `storeGeneration`, `applyCuratorWrites`, `clearAllMemoryState`.
- [`src/background/agent/memory-curator.ts`](../../src/background/agent/memory-curator.ts) — captures the generation before its read; owns the turn buffer.
- [`src/background/service-worker.ts`](../../src/background/service-worker.ts) — `CLEAR_MEMORIES` as a barrier.
- [`src/background/agent/memory-store.test.ts`](../../src/background/agent/memory-store.test.ts) — resurrection + serialization regressions.
- ADR 0003 — service worker owns all state writes. Enforcing the clear invariant in the worker rather than in `Settings.tsx` follows from it.
- ADR 0013 — the two-tier curator whose read/write split opens the resurrection window.
