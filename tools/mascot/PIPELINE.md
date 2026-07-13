# Fordhawke mascot sprite pipeline

State as of 2026-07-13. Canon + process for generating the RamPlan panel mascot.

## Canon
- **Master sprite**: `assets/master-pixel.png` — detailed-pixel-art chibi Fordhawke, 3/4 view,
  Patch-approved ("looks great"). ALL states ground on this image. Do not regenerate it.
- **Anchor sheet**: `assets/anchor-pixel.png` — master repeated 2x2 at fixed scale + feet line
  (0.82), built with agent-sprite-forge `make_anchor_layout.py`. Rebuild at other grid shapes
  (2x3, 2x4) for higher frame counts.
- Style references (art direction only): `../../notes/brand/reference/ram-sprite-board-toon.png`
  (+ hero/board/pet-states PNGs alongside).

## Proven chain (each step earned; don't skip)
1. **Generate** — OpenRouter `google/gemini-3.1-flash-image` (~$0.07/img), key `OPENROUTER_KEY`
   in claudeV2 `.abraxas.env`. TWO images per request: master (identity) + anchor sheet
   (scale/root template), with the anchor-sheet prompt language from agent-sprite-forge
   `references/prompt-rules.md` ("Preserve Image 2's exact cell locations... change only the
   pose"). Flat #FF00FF background, no shadows/gridlines/text. `generate.py` holds the
   pre-anchor prompt shapes; the anchor language lives in the 07-13 session transcripts and
   prompt-rules.md.
2. **Process** — agent-sprite-forge `generate2dsprite.py process --align feet
   --scale-strategy preserve --component-mode largest --strict-qc --max-body-scale-cv 0.08
   --max-anchor-y-std 0.05`. QC failure = regenerate, don't accept. (Repo: clone
   github.com/0x0funky/agent-sprite-forge, skills/generate2dsprite/scripts/.)
3. **Refine** — `refine.py <master> <outdir> <frames...> --px-height 128`: BOX-filter downscale
   (NEAREST turns 7x downscales to mush; 64px too coarse — 128 approved) + quantize every frame
   to the MASTER's palette (kills inter-frame shading boil).
4. **Assemble** — transparent horizontal strip per state (`strips/`), preview GIF on warm paper
   (250,247,240) at 2x NEAREST → `C:\Users\Public\ramplan-mascot-preview\current\`.
   Idle previews as ping-pong (1-2-3-4-3-2 @220ms); locomotion straight loop @150ms.

## Smoother batch (delivered, awaiting final gate)
All 7 states at 128px in `strips/`: idle (6f) · walk (8f) · walk-left (8f, free mirror of
walk — same frames flipped) · wave (8f) · ponder (6f) · whatif (8f) · reading (6f).
`batch.py <state>...` drives process→refine→strip→preview from `work/<state>-raw.png`.
Spend ~$0.62 of the $4.00 allowance (9 generations: 7 states + ponder & wave/whatif retries).

Fix history (hard-won; don't regress):
- **Pink pixels** (Patch round-1 critique): TWO bugs. (a) master-pixel.png is flat RGB, so
  `master_palette` had magenta IN the quantize palette; now excluded. (b) BOX downscale blends
  magenta into partial-alpha rim pixels; refine.py defringes by magenta *signature* (r≈b, both
  high, g far below) — NOT a broad pink test, which would eat the whatif purple ball.
- **whatif purple ball**: three killers found in sequence — forge flood-fill `--edge-threshold
  150` chews INTO the ball (mid-purples are 115-145 from magenta; use 90 via EXTRA_PROC_ARGS);
  refine's broad pink defringe (fixed above); and one-pot mediancut (master's ~1M px drown the
  ball's ~200/frame — palette now RESERVES 16 slots quantized from purple pixels only).
- **Zoom drift**: model draws larger than the anchor → QC edge-touch fail. RULES now pin
  "central 70% ... matching Image 2's figure size". Ponder needed this.
- **Source-edge touch on intact contours** (wave caps): batch.py auto-retries with
  `--allow-source-edge-touch` + loud WARNING; forge doctrine says inspect the strip after.

Patch round-1 verdicts (07-13): idle/walk/ponder/reading good · wave regen'd (8f, short chibi
arm pinned) · whatif regen'd (purple spiral + sparks + rubbing hand). Pink fixed pipeline-wide.
Timing: idle 180ms · walk 120 · wave 140 · whatif 160 · default 200.

Integration after gate: Maren wires strips via CSS steps() (mechanism proven in her 0035 spike;
sprite in panel, prefers-reduced-motion static fallback). Landed `d68f23e`. Render-size rule
from that pass: 130px cells are crisp ONLY at 1x and exact integer halves (65px) — a placement
needing an in-between size gets a natively-rendered smaller strip, never CSS scaling.

## Logo (Patch-approved 07-13)
`assets/logo.png` — header wordmark lockup: pixel-art Fordhawke head facing left + "Ram Plan"
in fountain-pen cursive (brown ink, gold flourish). One-shot via `logo.py` (gen + key), NOT the
sprite chain — cursive strokes don't survive refine.py's downscale/quantize, so it's chroma-keyed
at full res (1199x313). Fix history: the raw carries a DARK magenta halo (~rgb 139,0,136) outside
the art's own outline that the bright-magenta defringe misses — logo.py kills by magenta HUE at
any brightness (safe only because the logo has no purple props; don't port blindly to whatif).
