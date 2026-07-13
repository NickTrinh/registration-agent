#!/usr/bin/env python3
"""Batch driver for the smoother mascot set: process -> refine -> strip -> preview.

Per state: raw grid (work/<state>-raw.png, from generate.py) is cut + QC'd by
agent-sprite-forge, refined to 128px master-palette pixel art, assembled into a
transparent horizontal strip (strips/<state>-strip.png), and a preview GIF is
written to the Windows preview dir. walk-left = deterministic mirror of walk.

Usage: python3 batch.py <state> [<state> ...]     (state incl. walk-left)
Env:   FORGE=/tmp/claude/agent-sprite-forge  (override if cloned elsewhere)
"""
import glob, os, subprocess, sys
import numpy as np
from PIL import Image

import refine as rf
from generate import STATES

HERE = os.path.dirname(os.path.abspath(__file__))
FORGE = os.environ.get("FORGE", "/tmp/claude/agent-sprite-forge")
PROC = os.path.join(FORGE, "skills/generate2dsprite/scripts/generate2dsprite.py")
MASTER = os.path.join(HERE, "assets/master-pixel.png")
PREVIEW_DIR = "/mnt/c/Users/Public/ramplan-mascot-preview/current"
WARM_PAPER = (250, 247, 240, 255)

DURATION = {"idle": 180, "walk": 120, "walk-left": 120, "wave": 140, "whatif": 160}  # ms/frame; default 200


# Per-state processor overrides. whatif: default edge-threshold 150 flood-fills
# INTO the purple crystal ball (mid-purples sit ~115-145 from magenta); 90 keeps
# the ball, refine.py's defringe handles the extra rim residue.
EXTRA_PROC_ARGS = {"whatif": ["--edge-threshold", "90"]}


def process(state: str) -> list[str]:
    rows, cols, _ = STATES[state]
    outdir = os.path.join(HERE, f"work/{state}-proc")
    cmd = [
        sys.executable, PROC, "process",
        "--input", os.path.join(HERE, f"work/{state}-raw.png"),
        "--target", "player", "--mode", state, "--output-dir", outdir,
        "--rows", str(rows), "--cols", str(cols),
        "--align", "feet", "--scale-strategy", "preserve",
        "--component-mode", "largest", "--strict-qc",
        "--max-body-scale-cv", "0.08", "--max-anchor-y-std", "0.05",
    ] + EXTRA_PROC_ARGS.get(state, [])
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 and "touch a source-cell edge" in (r.stdout + r.stderr):
        # Forge doctrine: override allowed only for visually complete contours
        # when output-edge/clamp counts stay zero. INSPECT THE STRIP.
        print(f"WARNING {state}: source-edge touch; retrying with override - inspect frames")
        r = subprocess.run(cmd + ["--allow-source-edge-touch"], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"{state}: processing failed:\n{r.stdout[-500:]}\n{r.stderr[-800:]}")
    frames = sorted(glob.glob(os.path.join(outdir, "**/*.png"), recursive=True))
    frames = [f for f in frames if "sheet" not in os.path.basename(f).lower()]
    if len(frames) != rows * cols:
        sys.exit(f"{state}: expected {rows * cols} frames, processor emitted {len(frames)}")
    return frames


# States whose props introduce colors absent from the master (whatif: purple
# swirl/sparks). Master-only palette quantizes those away — extend with the
# frames' own colors, master pixels still dominating.
EXTENDED_PALETTE = {"whatif"}


def build_palette(state: str, frame_paths: list[str]) -> Image.Image:
    """Master palette, plus RESERVED slots for prop colors (purple swirl) when
    the state needs them. Feeding master+frames into one mediancut fails: the
    master's ~1M pixels drown the ball's ~200/frame, purple gets no bucket."""
    base = rf.master_palette(Image.open(MASTER), 32)
    if state not in EXTENDED_PALETTE:
        return base
    px = []
    for p in frame_paths:
        a = np.array(Image.open(p).convert("RGBA"))
        r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
        prop = (b > r + 30) & (b > 120) & (a[..., 3] > 128)  # purple-ish, opaque
        px.append(a[prop][:, :3])
    allpx = np.concatenate(px)
    if len(allpx) == 0:
        return base
    prop_pal = Image.fromarray(allpx.reshape(1, -1, 3), "RGB").quantize(
        colors=16, method=Image.MEDIANCUT)
    colors = base.getpalette()[:32 * 3] + prop_pal.getpalette()[:16 * 3]
    out = Image.new("P", (1, 1))
    out.putpalette(colors + colors[:3] * ((768 - len(colors)) // 3))
    return out


def refine(state: str, frame_paths: list[str]) -> list[Image.Image]:
    pal = build_palette(state, frame_paths)
    frames = [rf.snap(Image.open(p), pal, 128) for p in frame_paths]
    cw, ch = max(f.width for f in frames) + 2, 130
    cells = []
    for f in frames:
        cell = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        cell.alpha_composite(f, ((cw - f.width) // 2, ch - f.height - 1))
        cells.append(cell)
    return cells


def assemble(state: str, cells: list[Image.Image]) -> None:
    cw, ch = cells[0].size
    strip = Image.new("RGBA", (cw * len(cells), ch), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        strip.alpha_composite(c, (i * cw, 0))
    strip_path = os.path.join(HERE, f"strips/{state}-strip.png")
    strip.save(strip_path)

    dur = DURATION.get(state, 200)
    previews = []
    for c in cells:
        bg = Image.new("RGBA", (cw, ch), WARM_PAPER)
        bg.alpha_composite(c)
        previews.append(bg.resize((cw * 2, ch * 2), Image.NEAREST).convert("P"))
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    gif = os.path.join(PREVIEW_DIR, f"{state}-128.gif")
    previews[0].save(gif, save_all=True, append_images=previews[1:],
                     duration=dur, loop=0, disposal=2)
    print(f"{state}: FRAMES={len(cells)} CELL={cw}x{ch} -> {strip_path} + {gif}")


def run(state: str) -> None:
    if state == "walk-left":
        src = os.path.join(HERE, "strips/walk-strip.png")
        if not os.path.exists(src):
            sys.exit("walk-left needs strips/walk-strip.png first")
        strip = Image.open(src)
        n = STATES["walk"][0] * STATES["walk"][1]
        cw = strip.width // n
        cells = [strip.crop((i * cw, 0, (i + 1) * cw, strip.height))
                 .transpose(Image.FLIP_LEFT_RIGHT) for i in range(n)]
        assemble("walk-left", cells)
        return
    assemble(state, refine(state, process(state)))


if __name__ == "__main__":
    for s in sys.argv[1:]:
        run(s)
