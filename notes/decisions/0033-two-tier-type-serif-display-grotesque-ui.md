# 0033 — Two-tier type: a serif display layer over the grotesque UI

- **Status**: Accepted · Amends 0032 (which set "one grotesque" as the whole typeface) · The
  UI/body grotesque named here (Schibsted) was later swapped to Hanken Grotesk by **0034**; the
  two-tier structure below is unchanged
- **Date**: 2026-07-12
- **Related**: 0031 (native-app grammar), 0032 (Claude-app dialect)

## Context

Round-two live review (Patch, in the browser) landed three notes. Two are type:

1. The suggested-questions main screen — *"likes the feature, not the font."* He pointed at a
   warm high-contrast **serif** greeting ("Afternoon, Patch", Anthropic's Copernicus register) as
   the north star and away from the current **all-grotesque** main screen.
2. The **RamPlan wordmark** should be a serif, not the grotesque.

ADR 0032 committed to *one* typeface (Schibsted Grotesk) partly on a hard constraint: the serif
wordmark "left with the webfont-free constraint" — remote fonts are forbidden by the extension CSP
and the panel must render offline, and at the time no second face was bundled. That constraint is
real but it does not force *one* face; it forces *bundled* faces. A second woff2 satisfies it
exactly as the first did. So the "one grotesque" ruling was over-tight, and round two asked to
loosen it: warmth through **type contrast**, not more softness.

(The review's third note — light-mode Settings cards dissolving into the warm paper — is a
straight elevation fix, not a type decision; handled in the same change, not ADR-worthy.)

## Decision

Adopt a **two-tier type system**: a **display/personality serif** for the greeting and the
wordmark, over **Schibsted Grotesk** which remains the UI/body face for everything else. The serif
is **Newsreader** (Production Type, OFL) — a screen-first humanist serif in the warm,
moderate-high-contrast Tiempos/Lyon register Patch pointed to, and the closest free stand-in for
Anthropic's commercial Copernicus. Bundled as variable woff2 (weight 200–800), same offline/CSP
discipline as the grotesque, with a `Georgia` system-serif fallback so the layer survives a load
failure. Applied deliberately — greeting, wordmark — **never as a blanket**: interactive and body
text stay grotesque, because a high-contrast serif at UI sizes reads worse, not warmer.

## Alternatives considered

### Alternative A: Fraunces (higher-contrast display serif)
The other strong free candidate — more contrast, ball terminals, `SOFT`/`WONK` axes. Rejected as
default: the north-star image is a *calm* humanist serif, and Fraunces trends quirky/editorial-loud
unless dialed down. Held as the fallback if Patch wants more drama than Newsreader delivers.

### Alternative B: keep one face, differentiate by weight/size only
Make the greeting a big grotesque instead of a serif. Rejected — it *is* the current state (the
img #4 the review moved away from). Size alone doesn't create the register contrast Patch asked for.

### Alternative C: put the serif everywhere / on all headings
Over-reach. A serif body/UI at 12–14px loses the contrast advantage and hurts legibility in a
320px panel. The tier boundary (display serif · UI grotesque) is the whole point.

## Consequences

- Reverses 0032's "one typeface" ruling; the bundle carries **two** families now. Adds ~123KB
  (two variable woff2, latin subset) — accepted as the display identity, self-hosted.
- `font-serif` (tailwind) is the *only* serif entry point and is applied to exactly two surfaces
  (`AuditChat` greeting, `App` wordmark). Adding a third serif surface is a design decision, not a
  drive-by class — keep the tier boundary explicit.
- The wordmark comment in `App.tsx` that cited the webfont-free constraint is now stale and
  corrected: bundling dissolved that constraint.
- Newsreader's OFL license ships beside the font (`fonts/newsreader-OFL.txt`).
- Open, not decided here: the **logo mark** beside the wordmark, and a possible **ram mascot**
  animation — both scoped separately, cost-gated by Patch.

## Revisit if...

- Patch's round-three verdict rejects Newsreader — swap to Fraunces (Alternative A) is a woff2 +
  one `@font-face` + fallback-stack change; the tier structure stands regardless of the face.
- The display serif starts creeping onto body/UI surfaces — that's the boundary eroding; pull back.

## References

- ADR 0032 (Claude-app dialect — the "one grotesque" this amends), 0031 (native-app grammar)
- Newsreader: SIL OFL 1.1, bundled at `src/sidebar/fonts/newsreader-OFL.txt`
- Round-two review north star: warm high-contrast serif greeting (Anthropic Copernicus register)
