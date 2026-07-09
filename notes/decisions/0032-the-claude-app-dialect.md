# 0032. The Claude-app dialect: warm paper, one grotesque, pinned-turn scrolling, paced streaming

- **Status**: Accepted · Amends 0024 (user bubble color, Continue behavior) and 0031 (palette values)
- **Date**: 2026-07-09

## Context

Round one of live product testing: a real student ran the full loop on real DegreeWorks. The
advisor brain held up — memory recall, attribute searches, a What-If comparison all landed. The
body did not. The verdict, in order of pain:

1. **Autoscroll was the worst offender.** The auto-follow effect chased the growing answer,
   clipping the status phrase at the top and scrolling tool citations out of view before they
   could be read. During a long What-If the pane looked *dead*.
2. **The composer dropped focus every turn** — `disabled={loading}` ejects focus, so every
   answer cost a click to type the next question.
3. **Streaming was "100% choppy"** — network-sized AI_CHUNK bursts rendered as slabs.
4. **"Continue to chat" appeared to do nothing** — it dismissed a button and kept the entire
   intake transcript as the student's "first chat".
5. The panel still read bright-white web page, not app. The ruling: go full Claude-app look —
   Anthropic-adjacent lettering, warm paper, grey user bubbles, maroon retained as accent only.

## Decision

Adopt the Claude app's dialect wholesale, as surface + behavior, keeping 0024's document
structure: **Schibsted Grotesk** bundled as the one typeface; the **stone** (warm gray) palette
on a `stone-50` page; **grey user bubbles**; **pin-to-top scrolling** (send pins the user's turn
toward the top; nothing yanks during the stream); **rAF-paced streaming** (buffer + drain
`max(2, ⌈len/10⌉)` chars/frame); **the composer is never disabled by loading**; **Continue
starts a fresh chat** greeted by a rotating personalized line; FirstRun's step 3 fetches the
catalog **inline**; a **shimmer** on the thinking phrase keeps the pane visibly alive.

## Alternatives considered

### Alternative A: Styrene / Tiempos (the actual Claude faces)
Commercial licenses. Schibsted Grotesk is the OFL stand-in with the same wide-stance grotesque
warmth — and it is *bundled* (woff2 + `@font-face`), not fetched: extension CSP forbids remote
fonts and the panel must render offline. Fallback stack stays `system-ui`.

### Alternative B: DegreeWorks-matching chrome
Patch supplied a DegreeWorks reference image (3D-button, cool-blue institutional chrome).
Rejected as a grammar clash: the panel would inherit the exact web-portal feel the directive
was escaping. Warm paper delivered both of his stated wants — "less bright white" and Claude
feel — without the portal costume.

### Alternative C: per-token fade-in instead of rAF pacing
The Claude web app fades word groups in. Here the transcript is `react-markdown` re-rendering
the whole growing message per append — wrapping tokens in animated spans would fight the
markdown parser and re-trigger animations on every re-render. Pacing the *append rate* gets the
fluidity without touching the render tree.

### Alternative D: keep scroll-follow but throttle it
Still yanks — just less often. The failure wasn't frequency; it was that *following the bottom*
is the wrong contract while a long answer streams. Claude's contract (pin the question, let the
answer grow beneath, `↓ Latest` for manual catch-up) removes the yank category. With a short
history the pin clamps at max-scroll rather than forcing a spacer div under the thread —
accepted deviation; there is no jump either way.

## Consequences

- Locks in: `data-turn="user"` on user messages is now a **scroll contract** (Message.tsx ↔
  AuditChat's pin effect); renaming it silently kills pinning. `flushStream()` must precede any
  event that anchors to "what the model said so far" (tool events, errors, save batches) or
  pacing misorders the transcript.
- The fonts add ~97KB to the bundle. Accepted: it's the whole typographic identity, self-hosted.
- Continue-to-chat now *discards* the intake transcript (memories are the durable output, in
  Settings); a one-line marker in the empty state says so.
- `?page=settings` initial-state hook added to App for the dev harness; inert in the extension.
- Amends 0024: user bubble maroon → stone; Continue keeps history → fresh chat. Amends 0031:
  `bg-white` chrome values → `stone-50`; serif wordmark → the bundled grotesque.
- Reduced-motion: pacing bypassed (text lands as it arrives), shimmer frozen legible, smooth
  scrolls collapse to `auto` — the existing global block plus call-site guards.

## Revisit if...

- Patch's round-2 verdict rejects Schibsted Grotesk (fallback candidate: Instrument Sans).
- A "jump to newest while streaming" complaint appears — the pin contract may need the
  bottom-spacer variant after all.
- What-If still reads dead with the shimmer — the parked crystal-ball animation is the next rung.

## References

- ADR 0024 (worksheet structure — stands), 0025 (token split), 0031 (native-app grammar)
- Schibsted Grotesk: SIL OFL 1.1, license bundled at `src/sidebar/fonts/OFL.txt`
