#!/usr/bin/env python3
"""Deterministic sprite processing: extract figures from a magenta 2x2 grid,
chroma-key to transparency (incl. shadow/fringe cleanup), normalize to a
shared height + baseline, and emit a horizontal strip PNG + preview GIF.

Usage: python3 process.py <grid.png> <state> <outdir> [--frame-height 96]
Outputs: <outdir>/<state>.png (strip, N frames side by side, uniform cells)
         <outdir>/<state>-preview.gif (on warm paper, panel-scale)
Prints:  FRAMES=<n> CELL=<w>x<h> so callers can wire CSS steps(n).
"""
import sys
import numpy as np
from PIL import Image

WARM_PAPER = (250, 247, 240, 255)


def foreground_mask(a: np.ndarray) -> np.ndarray:
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    magenta = (r > 150) & (b > 150) & (g < 140)
    gridline = (r < 60) & (g < 60) & (b < 60)
    # residual drop-shadow on magenta keys to murky purple - kill it too
    shadow = (r > 90) & (r < 190) & (b > 90) & (b < 190) & (g < 90)
    return ~(magenta | gridline | shadow)


def key_alpha(crop: np.ndarray) -> np.ndarray:
    crop = crop.copy()
    crop[..., 3][~foreground_mask(crop)] = 0
    return crop


def extract_figures(path: str):
    """Split each quadrant on column gaps -> one or more figures per cell."""
    img = Image.open(path).convert("RGBA")
    a = np.array(img)
    fg = foreground_mask(a)
    H, W = fg.shape
    frames = []
    for qr in range(2):
        for qc in range(2):
            ys, ye, xs, xe = qr * H // 2, (qr + 1) * H // 2, qc * W // 2, (qc + 1) * W // 2
            sub, suba = fg[ys:ye, xs:xe], a[ys:ye, xs:xe]
            on = sub.sum(0) > 3
            runs, start = [], None
            for i, v in enumerate(on):
                if v and start is None:
                    start = i
                if not v and start is not None:
                    runs.append((start, i)); start = None
            if start is not None:
                runs.append((start, len(on)))
            for s, e in [r for r in runs if r[1] - r[0] > 40]:
                rows = np.where(sub[:, s:e].sum(1) > 3)[0]
                if len(rows) == 0:
                    continue
                y0, y1 = rows[0], rows[-1]
                crop = key_alpha(suba[max(0, y0 - 4):y1 + 5, max(0, s - 4):e + 5])
                frames.append(Image.fromarray(crop))
    return frames


def assemble(frames, state: str, outdir: str, frame_h: int = 96):
    norm = [f.resize((max(1, int(f.width * frame_h / f.height)), frame_h), Image.LANCZOS)
            for f in frames]
    cell_w = max(f.width for f in norm) + 4
    strip = Image.new("RGBA", (cell_w * len(norm), frame_h), (0, 0, 0, 0))
    for i, f in enumerate(norm):
        strip.alpha_composite(f, (i * cell_w + (cell_w - f.width) // 2, frame_h - f.height))
    strip.save(f"{outdir}/{state}.png")
    previews = []
    for f in norm:
        c = Image.new("RGBA", (cell_w, frame_h + 8), WARM_PAPER)
        c.alpha_composite(f, ((cell_w - f.width) // 2, 4))
        previews.append(c.convert("P"))
    previews[0].save(f"{outdir}/{state}-preview.gif", save_all=True,
                     append_images=previews[1:], duration=140, loop=0, disposal=2)
    print(f"FRAMES={len(norm)} CELL={cell_w}x{frame_h} -> {outdir}/{state}.png")


if __name__ == "__main__":
    grid, state, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
    fh = int(sys.argv[sys.argv.index("--frame-height") + 1]) if "--frame-height" in sys.argv else 96
    frames = extract_figures(grid)
    if not frames:
        sys.exit("no figures extracted")
    assemble(frames, state, outdir, fh)
