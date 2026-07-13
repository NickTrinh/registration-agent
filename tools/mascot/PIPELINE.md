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

## Approved so far (4-frame, 128px)
`strips/{idle,walk,wave}-strip.png` — Patch gated the walk at 128; idle/wave delivered 07-13.
These may be superseded by the smoother batch below.

## Next batch (Patch-authorized, ~$4.00 allowance, 07-13)
Smoother = more frames: 6-8 per state (2x3 / 2x4 anchor sheets). States:
- idle · walk-right · **walk-left = deterministic mirror of walk-right** (flip; backpack/F-pin
  will mirror — accepted, vscode-pets does the same) · wave
- **ponder** (thinking pose — reference board's Ponder: scroll/paper + hand to chin)
- **what-if** (wizard hat + crystal ball — new props, keep suit)
- **reading** (puts on glasses, scans a book)
Budget math: ~$0.07/generation; 6 generated states x ~2 attempts + retries fits well under $4.
Integration after gate: Maren wires strips via CSS steps() (mechanism proven in her 0035 spike;
sprite in panel, prefers-reduced-motion static fallback).
