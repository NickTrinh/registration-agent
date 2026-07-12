# 0034 — Body face: Hanken Grotesk, the rounder Styrene stand-in

- **Status**: Accepted · Amends 0032/0033 (swaps the UI/body grotesque; the two-tier structure stands)
- **Date**: 2026-07-12
- **Related**: 0031 (native-app grammar), 0032 (Claude-app dialect), 0033 (two-tier type)

## Context

Round-two live review left a body-type note that didn't reach the round-three type pass (relay
gap, not a new review): Patch likes the sans on the body but wants it **rounder — closer to
Anthropic's sans**. The reference is **Styrene** (Commercial Type): a geometric-humanist grotesque
with rounded terminals, friendly but still a workhorse UI face. Schibsted Grotesk — the face 0032
chose as the Styrene stand-in — is the opposite temperature: crisp, neutral, Nordic. It reads as
correct, not warm.

The two-tier structure from 0033 is not in question. Newsreader stays the display/personality
serif (greeting + wordmark). Only the **UI/body grotesque** changes. So this is a face swap inside
an accepted structure, not a re-litigation of the tiers — which is why it earns its own ADR rather
than an amendment buried in 0033.

Constraints unchanged: extension CSP forbids fetched fonts, the panel must render offline, and at
a 320px minimum width the advisor's measure is ~28 characters — so the replacement has to be a free
(OFL), self-hostable, variable woff2 that does **not** trade legibility at 12–14px for roundness.

## Decision

Swap the UI/body grotesque from **Schibsted Grotesk** to **Hanken Grotesk** (Hanken Design Co.,
SIL OFL 1.1). Geometric-humanist skeleton with rounded terminals and a friendly single-story `a`/
open `g` — the softer, closer-to-Styrene temperature Patch asked for, without giving up the
workhorse density a status/citation-dense panel needs. Bundled as variable woff2 (weight axis
100–900, latin subset), same offline/CSP discipline as before, with the `system-ui` fallback stack
unchanged.

## Alternatives considered

Judged against the whole test: **rounded terminals + geometric-humanist skeleton + a real UI
workhorse at 12–14px in a 320px panel + variable woff2 + OFL.** All candidates were rendered in the
actual panel (dev harness, `webshot.sh`), not chosen from a specimen site. Canvas metrics at 13px/
292px measure recorded below.

### Alternative A: Hanken Grotesk — CHOSEN
Roundest of the true *workhorse* grotesques without tipping into the soft/juvenile register.
Narrowest set width of the warm candidates: **~41 chars per 292px vs Schibsted's 38** — so it fits
*more* measure than the face it replaces, which is pure upside at a 28-char panel. Cap 0.692,
x-height 0.538 — same proportions as Schibsted; nothing about the density read changes but the
temperature.

### Alternative B: Plus Jakarta Sans
Warm and characterful, but the widest of the shortlist (**~39 chars/292px**, set width 312.7px vs
Schibsted 305.6) — the wrong direction at a 28-char measure — and its geometric quirk (angled
terminals, distinctive `k`/`y`) trends editorial-loud for a body face carrying status lines and
citations. Held as the "more personality" fallback if Hanken reads too plain.

### Alternative C: Figtree
Very close second — rounded, clean, workhorse. Nearly identical metrics to Hanken (~40 chars/292px)
but marginally less rounded/warm; Hanken edges it on the specific "closer to Styrene" brief. If
Hanken ever reads too soft, Figtree is the half-step-crisper swap.

### Alternative D: Outfit / Poppins (pure-geometric)
Rejected. Poppins/Outfit are circular-geometric, not humanist — the perfectly round `o` and single
proportion read as *display* geometry, and legibility degrades at 12–14px (Outfit's x-height fell
to 0.462, the lowest measured — small text loses ascender/descender contrast). Round for its own
sake, not a workhorse.

### Alternative E: Nunito Sans / DM Sans
Nunito Sans is rounder still but tips soft/rounded-corner friendly, away from the calm-institutional
register 0031/0032 built. DM Sans is a fine workhorse but no rounder than Schibsted — it doesn't
answer the brief. Both rejected.

## Consequences

- Reverses 0032/0033's "Schibsted is the grotesque"; Schibsted's two woff2 + its OFL are removed
  from `src/sidebar/fonts/`, Hanken's two woff2 + `hanken-grotesk-OFL.txt` added. Bundle size is
  a wash (~70KB the pair, latin subset).
- `font-sans` (tailwind) now resolves to `"Hanken Grotesk"`; `styles.css` `@font-face` pair,
  `body` rule, and the two-tier comment updated. No component or utility class changed — the swap
  is entirely at the font-declaration layer, so every `font-*` weight utility keeps working (real
  instances across 100–900, verified in-panel: 300/400/500/600/700 + italic all render, no
  faux-bold).
- The pairing against Newsreader holds — verified in the real panel across empty/chat/settings,
  light and dark. Newsreader's warm moderate-contrast serif over Hanken's rounded grotesque reads
  as one warm family, not a clash; no reason to touch the display serif.
- **No legibility tradeoff.** Hanken is *narrower* than Schibsted at the same size — it fits more
  measure, not less — and shares its cap/x-height proportions. Roundness was gained without cost.

## Revisit if...

- Patch's next verdict wants *more* personality in the body — swap to Plus Jakarta Sans (Alt B),
  a woff2 + one `@font-face` change; structure stands.
- Hanken reads too soft/plain against Newsreader — Figtree (Alt C) is the half-step-crisper swap.
- The measured char-per-line advantage ever inverts on a real audit's longest terms — re-measure at
  320px before assuming the panel still fits.

## References

- ADR 0033 (two-tier type — the structure this leaves intact), 0032 (the "Schibsted grotesque"
  this swaps), 0031 (native-app grammar)
- Hanken Grotesk: SIL OFL 1.1, bundled at `src/sidebar/fonts/hanken-grotesk-OFL.txt`
- Reference target: Anthropic's Styrene (Commercial Type, licensed) — Hanken is the free stand-in
- Specimen + in-panel verification: rendered via `webshot.sh` at 320px, all states, light/dark
