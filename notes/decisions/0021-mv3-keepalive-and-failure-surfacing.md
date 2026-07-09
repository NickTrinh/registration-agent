# 0021 — MV3 keepalive for post-stream background work + failure surfacing

- **Status**: Accepted
- **Date**: 2026-07-08
- **Related**: runs under 0003 (worker owns the call sites); protects 0011 (background curator) and the profile extractor (ADR 0009-adjacent); interacts with 0014 (tool-round loop)

## Context

Three silent-failure modes surfaced while hardening the background worker.

**1. MV3 idle kill drops post-stream work.** Chrome unloads an idle MV3 service worker after ~30s with no pending events. Most of our work is safe because a UI event is always queued behind it — but three flows run with *nothing* queued behind them: the Haiku memory curator fires *after* `AI_DONE` (the chat turn is already closed), and `refreshCatalog` / `extractProfile` run on their own timers. If the idle kill lands mid-Anthropic-call or mid-Banner-pagination, the worker unloads and the in-flight work (a memory save, a profile write, a catalog fetch) is silently lost. The curator case is the worst: a student says "remember I work Fridays," sees the turn complete, and the save vanishes.

**2. Tool-round cap is invisible.** The chat loop caps at 5 tool-use rounds per turn (runaway guard, ADR 0014-era). When it hits the cap it just stops — the student sees a partial answer with no signal that more work was pending.

**3. `max_tokens` truncation is invisible.** Long plans hit the 2048-token output cap and get cut mid-list, with no indication the response was truncated rather than complete.

## Decision

**Keepalive.** Add `withKeepalive<T>(work: Promise<T>): Promise<T>` (`src/background/keepalive.ts`): a `setInterval` that polls `chrome.runtime.getPlatformInfo()` every 25s (< the ~30s kill window) for the lifetime of the wrapped promise, cleared in `finally`. Extension API calls reset the idle timer (Chrome ≥110), so the worker stays alive until the work resolves or rejects. Wrap the curator chain, `refreshCatalog`'s term fetch, and `extractProfile`'s Haiku call.

**Failure surfacing.** In the chat loop, after the tool-use rounds exit:
- If `stop_reason === "tool_use"` (loop exhausted the cap while still asking for tools), broadcast a final `AI_CHUNK` delta inviting the student to ask it to continue.
- If `stop_reason === "max_tokens"`, broadcast a delta noting the response was cut short.

Also raise `max_tokens` 2048 → 4096: Sonnet-class output pricing makes the doubling a non-issue, and it stops most long-plan truncations at the source rather than only surfacing them.

## Alternatives considered

### Alternative A (keepalive): `chrome.alarms` instead of a polling interval

Register a `chrome.alarms` fire to wake the worker. Rejected: `alarms` has a 30s *minimum* period on MV3 and wakes the worker *after* it may have already died — it's a re-wake mechanism, not a stay-awake one. The in-flight promise is already lost by then. A sub-30s interval that resets the *existing* idle timer is what keeps the current call alive.

### Alternative B (keepalive): an offscreen document / persistent port

Hold a long-lived connection to keep the worker resident. Rejected: heavyweight for the need, and it keeps the worker alive *unconditionally* (battery/CPU cost) rather than only for the duration of real work. `withKeepalive` is scoped to the promise — zero cost when idle.

### Alternative C (surfacing): throw / show an error toast on cap or truncation

Treat cap-hit and truncation as errors. Rejected: they aren't errors — they're expected boundaries. An inline continuation hint in the response stream reads as the assistant being honest about its limit, not as something breaking. It also keeps the partial answer visible instead of replacing it with an error state.

## Consequences

- **The curator memory-loss bug closes.** The most user-visible silent failure (a save that vanishes after the turn completes) is fixed: the worker stays resident until the Haiku call and its follow-up broadcasts finish.
- **`refreshCatalog` and `extractProfile` gain the same protection** — long Banner pagination and the profile Haiku call no longer race the idle kill.
- **Keepalive is scoped, not global.** It costs nothing when no wrapped work is in flight; it does NOT make the worker persistent. A wrapped promise that never resolves would hold the worker open indefinitely — every wrapped call must be a promise that reliably settles (all three here do, via network timeouts / SDK settlement).
- **Doubling `max_tokens` raises worst-case output cost per turn**, accepted as negligible at Sonnet-class pricing and outweighed by not truncating multi-course plans mid-list.
- **Surfacing deltas are plain text appended to the stream** — no new message type, no UI change needed; the sidebar renders them as part of the assistant turn.

## Revisit if...

- Chrome changes MV3 idle semantics so that extension-API calls no longer reset the timer (would break the keepalive mechanism — switch to whatever the new keep-resident primitive is).
- The 5-round tool cap is raised/removed, at which point the cap-hit surfacing branch changes meaning.

## References

- [`src/background/keepalive.ts`](../../src/background/keepalive.ts) — `withKeepalive`.
- [`src/background/agent/chat-loop.ts`](../../src/background/agent/chat-loop.ts) — cap-hit + truncation surfacing; curator keepalive wrap.
- [`src/background/service-worker.ts`](../../src/background/service-worker.ts) — keepalive on `extractProfile` + `refreshCatalog`.
- [Chrome MV3 service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) — idle timeout + timer-reset behavior.
