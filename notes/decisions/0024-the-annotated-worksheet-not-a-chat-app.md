# 0024 — The annotated worksheet, not a chat app

- **Status**: Accepted · Amended by 0032 (user bubble grey, Continue starts a fresh chat)
- **Date**: 2026-07-09
- **Related**: batches the visual-redesign decisions; sits on the token split (0025); `<Notice>` (0026) owns everything with a severity; lands 0028's Alternative B (see its Revisited note)

## Context

The sidebar looked like every AI chat app of 2024: avatar circles saying "AI"
and "You", grey bubbles on both sides, three bouncing dots, a spinner inside a
fake message, emoji-tagged tool chips in five pastel hues, and a permanently
green status card announcing that nothing was wrong. Generic, and — at Chrome's
320px side-panel minimum — actively hostile: a two-sided bubble layout leaves
~28 characters of measure (panel − avatars − two bubble insets), and the
advisor's markdown tables had no chance at all.

The product isn't a chat app. It's an advisor annotating a degree audit — the
answer is a *document* the student reads, sometimes 40 lines with tables. The
redesign decisions below were made together, against one metaphor, in one
session (with Patch ruling on direction throughout); recording them as six
one-page ADRs would bury the actual decision — the metaphor — under its
corollaries. One record, deliberately.

## Decision

**The advisor's answer is the document; everything else annotates it.**

Concretely:

1. **Prose, not bubbles.** Assistant turns render as plain ink, full column,
   no container, capped at `65ch` on wide panels. The student's turn keeps a
   right-aligned maroon bubble — the query in the margin. Avatars deleted
   (36px of a 320px column saying nothing). `Message.tsx`.
2. **Tool calls are citations, not notifications.** One tracked-caps line per
   tool above the answer it grounds, footnote-style. The verb carries the
   tool's identity; color is reserved for *state* (in flight / done /
   failed) — five hues for five tools was a taxonomy no student needed, and
   the emoji went with it. `Citation.tsx`.
3. **Status is a strip, not a card.** The healthy path is one quiet 28px line
   under the header; while a turn is in flight a 1px maroon hairline sweeps
   its bottom edge. Anything with a severity renders as a `<Notice>` (0026)
   instead — never both. The old GREEN-forever card gave the loudest
   treatment to the most boring fact. `StatusStrip.tsx`.
4. **One waiting indicator, and it tells the truth.** The spinner-in-a-bubble
   and the bounce dots are deleted. A single derived phrase renders under the
   thread: if a tool call is awaiting its result, the phrase says what that
   tool is doing (`TOOL_PHRASES`); otherwise a rotating registrar-flavored
   thinking phrase covers the reasoning gap. Hidden the moment text streams —
   growing prose is its own indicator.
5. **First run is a checklist, not a dead end.** The old empty state stacked
   an amber "No audit" card on a welcome card whose primary button read
   "Waiting for audit…". `FirstRun.tsx` replaces both: three numbered
   prerequisites with live checkmarks (key, audit, catalog), the intake
   button unlocked by the two hard ones. Suggestions render as hairline
   rows, not boxed cards.
6. **The input is a messenger input.** `<textarea rows={1}>` growing with
   content (`field-sizing: content`, capped ~5 lines); Enter sends,
   Shift+Enter breaks the line.
7. **The live region stays quiet while streaming.** `aria-live` flips to
   `off` during a turn — announcing every chunk and every rotating phrase is
   screen-reader spam. The completed turn announces once; an `sr-only`
   "Advisor is thinking" covers the gap.

## Alternatives considered

### Alternative A: keep bubbles, restyle them

Tighter palette, no avatars, same two-sided layout. Rejected: restyling
doesn't return the ~90px of measure the layout itself spends at 320px, and
symmetric bubbles assert the advisor's 40-line answer and the student's
7-word question are the same kind of object. They aren't.

### Alternative B: full document view — no conversation surface at all

Render only the latest answer as a page; history in a drawer. Rejected:
follow-up ("what about summer?") is the product's core loop, and hiding the
thread breaks the student's sense of a running consultation. The worksheet
metaphor needs the margin, not just the page.

### Alternative C: six separate ADRs

One per component. Rejected by Patch's ruling (fewer, batched ADRs): the
decisions share one context and one metaphor; separately they'd each fail the
"is this ADR-worthy alone?" bar while together they're the redesign.

## Consequences

- Every visual element now needs a job description: what does it annotate?
  Decoration has no slot to live in — this is the enforcement mechanism
  against drift back to chat-app defaults.
- 320px is the design width; 65ch is the ceiling. Patch's actual panel
  (~958px) gets the cap, not a stretched line.
- The single-indicator rule (#4) plus the strip's sweep (#3) means exactly
  one indeterminate signal exists per surface. A future spinner PR is a
  design regression by definition.
- Code carries `// Implements: ADR 0024` headers in `Message.tsx`,
  `Citation.tsx`, `StatusStrip.tsx`, `FirstRun.tsx`, and at the indicator,
  live-region, and textarea sites in `AuditChat.tsx` — grep gives the map.
- Risk accepted: prose-not-bubbles leans on typography (measure, size,
  weight) to separate speakers. If a future theme flattens those cues, the
  layout has no bubble to fall back on.

## References

- [`src/sidebar/components/Message.tsx`](../../src/sidebar/components/Message.tsx)
- [`src/sidebar/components/Citation.tsx`](../../src/sidebar/components/Citation.tsx)
- [`src/sidebar/components/StatusStrip.tsx`](../../src/sidebar/components/StatusStrip.tsx)
- [`src/sidebar/components/FirstRun.tsx`](../../src/sidebar/components/FirstRun.tsx)
- [`src/sidebar/pages/AuditChat.tsx`](../../src/sidebar/pages/AuditChat.tsx)
- ADR 0025 (token split), ADR 0026 (`<Notice>`), ADR 0028 Revisited (uiOnly deletion)
