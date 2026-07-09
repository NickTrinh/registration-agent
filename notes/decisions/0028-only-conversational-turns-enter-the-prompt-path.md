# 0028 — Only conversational turns enter the prompt path

- **Status**: Accepted
- **Date**: 2026-07-09
- **Related**: hardens the history assembly behind 0010/0020 (prompt caching); the `error` field it threads is produced by the failed-tool broadcast added alongside it

## Context

The sidebar keeps one `ConversationMessage[]` and uses it for two different
jobs: rendering the chat, and building the history sent to Anthropic. Those two
jobs do **not** want the same list.

Three kinds of message live in it:

1. real turns — what the student typed, what the advisor replied;
2. `systemAction` bubbles — UI events, e.g. the end-of-intake save list;
3. the `Error: …` bubble pushed when an `AI_ERROR` broadcast arrives
   (`AuditChat.tsx`, `case "AI_ERROR"`).

Only (1) is conversation. But `sendMessage` filtered **only** `systemAction`:

```ts
const forWorker = next.filter((m) => !m.systemAction);
```

So the error bubble — which is *our* text, written by the UI, containing a raw
API error body — was persisted in `messages` and **replayed to Anthropic as an
assistant turn on every subsequent request for the rest of the session.** The
model was told it had said things it never said. Raw provider error strings
entered the prompt, permanently, and rode along in every cached prefix after.

This is not a presentation question about how errors *look*. It is a correctness
defect in what the model is told. The two are separable and this ADR is only
about the second.

It was found while auditing the UI for a visual redesign: the observation
"errors render as chat bubbles" was a UX note, and pulling the thread showed the
bubble was never excluded from the send path.

## Decision

A message carries an explicit `uiOnly?: boolean` marking it as a UI artifact
rather than a turn. The `AI_ERROR` bubble sets it.

Filtering lives in **one** exported predicate in `shared/types.ts`:

```ts
export function conversationalOnly(messages: ConversationMessage[]) {
  return messages.filter((m) => !m.systemAction && !m.uiOnly);
}
```

Every path that ships history to the worker calls it. There is exactly one such
path today (`AuditChat.tsx` → `AI_CHAT`), verified by grep; the function exists
so that the second one cannot get it wrong.

Separately, `ToolEvent.error?: string` carries a failed tool's reason to the
chip. The worker emits `courseCount: 0` on the failure path as a
*chip-resolved* marker (without it the chip renders "searching…" forever), and
`error` is what distinguishes "the search failed" from "the search found
nothing." Rendering the former as "0 results" tells the student a lie.

## Alternatives considered

### Alternative A: match on the `"Error: "` string prefix at send time

Filter any assistant message whose content starts with `Error: `. Rejected:
it's a data-dependent heuristic on user-visible copy. The advisor could
legitimately begin a sentence with "Error:" when explaining one, and any change
to the error copy silently breaks the filter. Presentation must not be load-
bearing for a correctness invariant.

### Alternative B: never put the error in `messages` at all — a separate error slot

Render errors from dedicated state, outside the message list. Rejected *for
now*, though it is arguably the better end state: errors are currently
interleaved chronologically with the conversation, and a separate slot loses
that ordering. It is also a visual redesign, which is under way independently —
this ADR deliberately does not pre-empt it. `uiOnly` is compatible with either
outcome: if errors later move out of the list, the flag simply has no users.

### Alternative C: strip in the worker instead of the sidebar

Have `handleAIChat` drop non-conversational messages on receipt. Rejected: the
worker would have to re-derive intent the sidebar already knows, and the
worker's message contract is untyped (see Consequences), so it would be
guessing. The producer of a UI artifact is the right place to label it.

## Consequences

- Raw provider error text can no longer enter the prompt. Sessions that hit an
  error stop paying to re-send it on every later turn, and the model is no
  longer told it authored text it did not.
- **One** predicate owns the see/tell boundary. A future second send path that
  forgets to call it is a visible omission rather than a silent divergence.
- `uiOnly` is a widening of `ConversationMessage`, not a new type. Nothing that
  renders the list needs to change; only the send path reads the flag.
- **Known weakness this does not fix:** the worker↔sidebar message bus is
  typed `broadcast: (message: object) => void` (`chat-loop.ts`,
  `tools/types.ts`) and consumed as `(message: any)` (`AuditChat.tsx`). The
  compiler cannot check any broadcast. `ToolEvent.error` was added to both ends
  by hand; nothing would have caught it if only one end had changed. That's a
  separate shaping decision and needs its own ADR.

## Revisit if…

- Errors move out of `messages` into dedicated UI state (Alternative B). Then
  `uiOnly` loses its only user and should be deleted rather than left as an
  attractive nuisance.
- The message bus gains a typed union. `uiOnly` should then be part of it, and
  the `conversationalOnly` boundary re-expressed as a type, not a filter.

## References

- [`src/shared/types.ts`](../../src/shared/types.ts) — `uiOnly`, `ToolEvent.error`, `conversationalOnly`.
- [`src/sidebar/pages/AuditChat.tsx`](../../src/sidebar/pages/AuditChat.tsx) — the `AI_ERROR` bubble, the `AI_TOOL_RESULT` handler, the single `AI_CHAT` send site.
- [`src/background/agent/chat-loop.ts`](../../src/background/agent/chat-loop.ts) — emits the terminal `AI_TOOL_RESULT` with `error` on the tool failure path.
