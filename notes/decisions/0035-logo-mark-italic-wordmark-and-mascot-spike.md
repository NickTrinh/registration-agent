# 0035 — The ram mark, the italic wordmark, and a mascot spike

- **Status**: Accepted · Builds on 0033/0034 (adds the picture half of the brand; wordmark restyled)
- **Date**: 2026-07-12
- **Related**: 0031 (native-app grammar), 0032 (Claude-app dialect), 0033 (two-tier type), 0034 (Hanken body)

## Context

Round-three type/brand pass was accepted in the browser (`9b8bc3e`). The closing pass carried three
brand items Patch named at round two that the type work deferred:

1. A small light-mode bug: on the empty-chat screen the hairlines *between* the suggested questions
   were invisible — the same too-faint-on-warm-paper failure that dissolved the settings cards at
   round two (fixed in 0034's sibling pass).
2. The core ask: the **"RamPlan" wordmark** wanted a serif/cursive treatment, and the brand needed
   an actual **logo mark** — one that survives both a hero lockup and a 16px toolbar icon.
3. A stretch, now ungated: a **mascot** — a Codex-pets-style animated ram living in the panel.

The type system (0033/0034) is settled; this ADR adds the *pictorial* layer on top of it and does
not touch the tiers.

## Decision

**Separator fix.** The suggestion dividers used `divide-stone-100` / `border-stone-100`, which sit
directly on the warm paper (not inside a white card) and vanish — identical to the card bug. Bumped
to `stone-200`, the same hairline value that restored the card edge. Dark reads on lightness alone
(`stone-800`), unchanged.

**Wordmark → Newsreader italic.** The display serif is already bundled (0033), and its *italic* has
genuine calligraphic character — the "serif/cursive" read Patch asked for — so the wordmark becomes
Newsreader semibold **italic** rather than adding a script face. Zero new bytes.

**Logo mark — a frontal ram head.** A ram reduces, at 16px, to one idea: the swept spiral horns (the
same signal the Aries glyph rides). The mark is three filled masses — a narrow muzzle, two ears, two
spiral horns — chosen because filled forms survive tiny sizes where strokes and inner detail muddy.
Delivered two ways from one shape:
- **In-app** (`components/RamMark.tsx`): a bare inline SVG with `fill="currentColor"`, so the header
  lockup's single `text-fordham-maroon dark:…-maroon-ink` declaration themes the glyph and the word
  together — no dark variant asset.
- **Toolbar / manifest** (`public/icons/icon{16,48,128}.png`): the same head knocked out of a maroon
  rounded-square badge — a self-contained tile that reads on any browser chrome, where a bare maroon
  glyph could vanish on a dark toolbar. Glyph scale is optically tuned per size (fills more of the
  badge at 16px than at 128px). Real transparent-alpha PNGs, rasterized from the SVG via headless
  Chrome (`--default-background-color=00000000`).

The header is now a lockup: `[ram mark] RamPlan`, glyph at 22px beside the italic wordmark.

**Mascot — spiked, not shipped.** See below.

## The mascot spike

The pattern (vscode-pets: a sprite sheet advanced by CSS `steps()`, no canvas, CSP-clean) is
**viable in this panel** — prototyped and verified. The mechanism is a 40px window onto a 4-frame
sheet with two CSS animations (`steps(4)` walk-cycle + a linear stroll across the floor) and a
`prefers-reduced-motion` static-frame fallback. No JS, no rAF, no canvas — it satisfies the
extension CSP exactly as the pattern promises. Prototype + placeholder sprite live in the spike
scratch, not in the repo.

**What blocks shipping it is the asset, not the mechanism.** The plan is to take a premade,
modify+commercial-licensed sheep sprite (the itch.io sources Patch named), horn-edit and recolor it
to a ram. Two problems surfaced:
- The itch.io asset hosts are unreachable from the build sandbox (network is whitelisted to a few
  domains), so the sprites can't be fetched or their exact licenses verified from here. Acquisition
  has to happen on Patch's side or in an unsandboxed context.
- Horn-editing + recoloring a multi-frame walk cycle to a consistent ram across every frame is real
  pixel work, not a drive-by — the kind of task the spike brief said to report rather than grind on.

**Recommendation:** the mechanism is a green light; treat the mascot as a follow-up build gated on
getting the licensed sprite in hand (or commissioning/hand-authoring one). Do not lift vscode-pets'
own sprites — they're artist-credited, not ours.

## Alternatives considered (logo mark)

All candidates were rasterized at 96 / 32 / 16px and as a knocked-out toolbar chip, on light and
dark, via `webshot.sh` — chosen from the tiny-size render, not the hero.

### Chosen: filled ram head, crescent spiral horns + ears + narrow muzzle
Holds cleanest at 16px and reads unambiguously as a horned head in the knockout chip (the true
toolbar test). Bold masses, generous negative space between horn and head, symmetric.

### Rejected A: plump teardrop face + inward-curling comma horns
Earliest form. The round, plump face drifted toward an anatomical read (the Aries-glyph hazard), and
the inward-curling tips crowded at 16px.

### Rejected B: same head with an *inner spiral roll* drawn into each horn
The most characterful at hero — a real ram's-horn spiral — but the inner detail muddied at 16px, and
the toolbar icon is the hard constraint that has to win. Detail that dies small is a liability, not a
flourish.

### Rejected C: stroked horns
Strokes thin out and break up at 16px where filled forms hold. Filled won on the smallest-size test.

## Consequences

- New `components/RamMark.tsx` (inline SVG, `currentColor`); imported into `App.tsx`'s header.
- `App.tsx` wordmark: `<span>` → a `flex` lockup (mark + word), wordmark now `italic`.
- `public/icons/icon{16,48,128}.png` replaced (were unreadable placeholders) with the ram badge;
  the manifest's `action` has no `default_icon`, so the toolbar icon falls back to `icons` — these
  three files *are* the toolbar icon.
- `AuditChat.tsx` suggestion block: `stone-100` → `stone-200` dividers/border (light only).
- Build green; no new deps; no runtime code touched beyond the header component.

## Revisit if...

- Patch wants more drama in the wordmark — Newsreader has weight to 800, or the logged Fraunces
  fallback from 0033 remains available.
- The mark ever needs a monochrome/one-color print context — the bare glyph already is one color
  (currentColor); the badge is the only two-tone form.
- The mascot gets a licensed sprite — the mechanism is proven; it becomes an integration task.

## References

- ADR 0033 (two-tier type — Newsreader is the display serif this italicizes), 0034 (Hanken body)
- Mark rasterized + verified via `webshot.sh` at 96/32/16px + knockout chip, light/dark
- vscode-pets (github.com/tonybaloney/vscode-pets) — the sprite-sheet/`steps()` pattern; sprites
  NOT reused (artist-credited)
- Mascot asset sources named by Patch: gntldragon.itch.io/pixel-sheep, harbingersh.itch.io/animals-sprite-sheat
  (modify+commercial licenses — verify on acquisition)
