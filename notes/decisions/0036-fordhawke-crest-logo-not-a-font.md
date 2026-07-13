# 0036 — The Fordhawke crest: a logo, not a font

- **Status**: Accepted · Supersedes the wordmark treatment in 0035 (crest replaces the italic + the monochrome glyph); the type system (0033/0034) is untouched
- **Date**: 2026-07-12
- **Related**: 0035 (ram glyph + italic wordmark — the thing this reverses), 0033 (two-tier type — the pattern this mirrors), 0031 (native-app surface grammar)

## Context

Round-one brand verdict on 0035 (`304aa55`) rejected the wordmark: *"I don't like the
italics as much. I think we need to make it a logo rather than just a font."* The italic
Newsreader treatment (0035's zero-byte "serif/cursive" answer) was still typeset text doing
the work of a mark — clever, but a font, not a logo. The monochrome `currentColor` ram glyph
beside it was a competent silhouette but read as a UI icon, not a brand.

Patch supplied the art direction: a Gemini-built reference (`notes/brand/reference/ram-head-hero.png`)
— "Fordhawke the Ram," a vintage collegiate mascot: white ram head, 3/4 view, gold engraved
spiral horns, dark-brown mortarboard with a gold "F" and tassel, a sly expression, on a cream
badge with brown/gold rings. Its warm cream/gold/brown palette sits naturally beside our
warm-paper + maroon system. The reference is the direction, not necessarily the literal asset.

## Decision

Replace the header lockup's italic-wordmark treatment with a **crest logo**: the Fordhawke
ram head on a ringed collegiate badge, paired with an **upright** Newsreader nameplate. The
crest carries the brand personality; the wordmark goes clean and subordinate.

A **two-tier logo**, deliberately mirroring the two-tier *type* system (0033):

- **Primary — the crest.** A full-color badge (gold horns, cream field, brown + gold rings).
  A logo is a full-color island, so unlike 0035's `currentColor` glyph the crest does **not**
  theme-swap — it holds constant while the wordmark alone carries maroon / `maroon.ink`.
  Lives inline as `components/RamMark.tsx` (crisp at any size, no PNG) and as the 48 / 128 icons.
- **Compact — a bare, ring-less ram head.** At 16px the badge rings eat the pixel budget and
  the ram shrinks to an unreadable disc. So the toolbar (`icon16.png`) drops the rings and lets
  the head fill the frame. This is 0035's law restated: *the 16px toolbar icon is the hard
  constraint that wins.*

**Raster / vector split** (governed by the same 0035 law — engraved detail dies small):

- `icon128.png` = the **rich engraved reference art**, cropped to the head and knocked onto a
  redrawn (watermark-free) badge. The engraving is the hero, and 128px is where it lives —
  chrome://extensions detail, the store listing.
- `icon48.png` = the **simplified flat vector** crest, rasterized. Engraving is already muddy
  by 48px; the flat derivative reads cleaner and matches the in-app header crest.
- `icon16.png` = the **compact bare ram**, rasterized.
- The manifest `action` has no `default_icon`, so these three files *are* the toolbar icon.

All PNGs are real transparent-alpha RGBA, rasterized from HTML/SVG via headless Chrome
(`--default-background-color=00000000`) — no rsvg/cairosvg in the environment (the 0035 recipe).

## Alternatives considered

### A: Ship the reference raster at every size
Rejected on the 16px floor — the engraving is an unreadable smudge below ~48px, and the
reference carries a faint corner watermark. Cropping and redrawing the badge dodges both; a
flat vector is the only thing that survives the toolbar.

### B: Keep the crest as the toolbar icon too (rings and all)
Rejected: rendered at 16px the rings consume the frame and the ram becomes a brown dot with a
cream center. The compact bare form reads at 16px where the crest cannot — per-size tuning, not
one asset scaled.

### C: Full-color crest that themes with the header ink (extend 0035's `currentColor`)
Rejected: a full-color logo *is* the point — recoloring it maroon on light / pink on dark would
throw away the gold-and-cream identity that makes it read as Fordham. Logos hold constant; only
the nameplate themes.

### D: Redraw the whole mascot as flat vector, drop the raster entirely
Rejected as a downgrade of the art Patch is excited about. The engraving is genuinely richer
than any flat trace; the right move keeps it as the hero (128) and derives the flat version only
where detail must die.

## Consequences

- `RamMark.tsx` rewritten: monochrome `currentColor` glyph → full-color inline crest SVG (fixed
  palette hardcoded in the component; **no new Tailwind tokens** — the warm palette is a one-off
  illustration island, not a system, and 0031 already retired systemic gold).
- `App.tsx` header: `RamMark` 22px → 28px; wordmark `italic` → upright (`font-serif` semibold).
- `public/icons/icon{16,48,128}.png` replaced with the crest system (16 compact, 48 flat, 128
  rich). Verified transparent RGBA at native dimensions; build copies them into `dist/`.
- Locks in a **two-form logo**: the crest for anywhere it can breathe, the bare ram for 16px.
  A future third context (favicon, print one-color) reuses one of the two, not a new draw.
- Accepts that the toolbar (16, bare) and the app/store (crest) differ in form. This is normal
  favicon-vs-logo practice and unified by palette + character; only worth revisiting if the
  divergence reads as *two* brands rather than one at two scales.
- The type system (0033/0034) is not touched — this is the pictorial layer only.

## Flag — Fordham-mascot adjacency

The reference is **Fordham-mascot-adjacent**: a ram in a mortarboard with a gold "F," in
collegiate-athletic style. RamPlan is a personal-use, unaffiliated DegreeWorks helper (public
repo, no PII), so the trademark risk is low — but the record should show we *saw* it. If this
ever went public-facing or distributed at scale, the "F" and the athletic-mascot styling would
want a clean-room redesign or Fordham's blessing. Noted, not blocking, at this scope.

## Revisit if...

- Patch wants the crest's engraved richness in-app (not just at 128) — the rich raster could
  become a larger brand moment (e.g. a welcome header), but FirstRun deliberately carries no
  wordmark (0035), so that is a new placement decision, not a drive-by.
- RamPlan goes public / distributed — trigger the mascot-adjacency clean-room review above.
- The mascot (phase 2 — `ram-sprite-board.png`, `codex-pet-states.png`) ships: it must be the
  **same** Fordhawke character as this crest. One brand figure across logo and mascot is the point.

## References

- Art direction: `notes/brand/reference/ram-head-hero.png` (Patch, via Gemini)
- Phase-2 mascot direction (NOT this ADR): `ram-sprite-board.png`, `codex-pet-states.png`
- Verified via headless-Chrome raster battery at 16 / 26 / 32 / 48 / 96 / 128, light + dark,
  and against the live dev harness header (`dev.html?theme=light|dark`)
- Supersedes 0035's wordmark + glyph; the mascot spike in 0035 still stands (mechanism proven,
  asset-gated)
