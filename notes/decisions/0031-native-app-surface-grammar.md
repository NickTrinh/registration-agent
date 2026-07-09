# 0031. The native-app surface grammar (chrome, settings, composer, motion)

- **Status**: Accepted · Amends 0025 (header fill) · Preserves 0024's structure
- **Date**: 2026-07-09

## Context

The AI Solutions Challenge has been judged; the extension is now being run as a live product.
The product direction set for this stage: the panel should feel like the Claude iOS app,
iMessage, or Instagram DMs — fluid motion, natural lettering, modern-app chrome.

Three surfaces still spoke an older dialect:

1. **The header** was a solid maroon slab with white text and a gold tab underline — collegiate
   web-portal chrome, not app chrome. ADR 0025 had ratified it as "the brand anchor that does
   not move between themes."
2. **Settings** was a web form: large bold headings, explainer paragraphs above bordered boxes,
   `<hr>` separators, filled-maroon radio buttons.
3. **The composer** was a rectangular textarea with a labeled "Send" button — a form control,
   not a messenger control.

Motion existed (ADR 0024's enters + sweep) but every curve was stock `ease-out`, and nothing
in the panel responded to a press.

One interpretation question had to be settled first: does "feel like iMessage" mean re-bubbling
the advisor? **No.** ADR 0024's structure — advisor prose unbubbled at 65ch, tool calls as
citations — was ratified on measure-and-honesty grounds that a styling directive does not
overturn. What those apps share is not bubbles; it is *surface grammar*: translucent bars,
grouped cards, pill fields, circular action buttons, spring curves, press feedback. This ADR
adopts the grammar and leaves the structure alone.

## Decision

1. **Header**: light translucent bar (`bg-white/80` + `backdrop-blur`, hairline bottom border;
   dark: `gray-900/80`). The brand lives in the maroon serif wordmark and the accents below —
   the way Messages carries blue without painting its navigation bar blue. Navigation is an
   iOS segmented control (gray track, raised active segment).
2. **Settings**: the iOS grouped-table grammar. Each group is a small-caps label (with optional
   trailing action), a `rounded-2xl` card of hairline-divided rows, and its explainer as a
   footer *below* the card. Text fields are borderless — the row is the field. Actions are
   maroon text buttons; destructive actions are red text rows at the bottom of their group
   with in-place two-step confirms. The theme picker reuses the header's segmented control.
   The page background recedes (`gray-100` / `gray-950`) so the cards read as surfaces.
3. **Composer**: pill textarea (18px radius, matching the bubble geometry) with a circular
   34px send button carrying a drawn arrow-up glyph — Stop is the same circle with a square.
   The user bubble drops its corner notch for a uniform 18px radius.
4. **Motion**: one spring curve (`cubic-bezier(0.32, 0.72, 0, 1)` — the UIKit sheet curve) for
   everything that moves; `msg-in` gains 8px travel + a scale settle; tab switches replay a
   `page-in` settle (display:none cancels animations, so kept-mounted pages re-animate on
   re-show for free); interactive controls get `active:scale` press feedback. The animation
   budget stays enumerated and everything still dies under `prefers-reduced-motion`.
5. **Retired tokens**: `fordham.gold` and `maroon.deep` existed only for the solid maroon
   header (gold is illegible on every other surface — 2.29:1 on white). Both deleted.

## Alternatives considered

- **Keep the maroon header** (ADR 0025's position). Rejected: a 44px solid-brand slab is the
  single loudest "university web portal" signal in the panel. Brand ≠ chrome; maroon saturates
  the product from the wordmark, bubbles, citations, toggles, and buttons. 0025's dark-mode
  token split is untouched — only its header-fill clause is amended.
- **Re-bubble the advisor to literally look like iMessage.** Rejected — see Context. At 320px
  a two-sided bubble layout leaves ~28ch of measure; the worksheet structure is the product's
  moat. Feel changes; structure doesn't.
- **A component library (Radix/shadcn) for the segmented control, switch, cards.** Rejected:
  no new dependencies for what Tailwind + 30 lines of JSX already express; a dependency is a
  supply-chain and bundle cost forever.
- **Framer Motion for the spring physics.** Rejected for the same reason — one cubic-bezier
  approximates the spring feel at zero bytes.

## Consequences

- One surface grammar, stated: recessed page / raised card / hairline rows / text-button
  actions / segmented selection / circular primary action. New settings rows have an obvious
  pattern to join; a future bordered-box-with-heading is a regression by definition.
- The header no longer isolates the panel from theme changes — it participates in the token
  split like everything else, which is more consistent with 0025's own principle (fills keep
  their role, inks swap).
- `backdrop-blur` implies things scroll *under* bars. The chat scroll container already does;
  if a future surface puts an opaque wrapper between content and bar, the blur silently does
  nothing — harmless, but the effect is gone.
- Anything that moves and doesn't use the spring curve will look wrong next to everything
  that does. That's intended pressure.

## References

- ADR 0024 (worksheet structure — preserved), ADR 0025 (token split — header clause amended)
- Verified in the dev harness (`src/sidebar/dev.html`, ADR-less tooling from commit 77d4919)
  at 320px and 958px, light and dark, via scripted screenshots.
