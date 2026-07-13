#!/usr/bin/env python3
"""Post-refinement for generated Fordhawke frames: snap to a true pixel grid
and quantize to the master sprite's palette so every frame shares one style.

The generator (Gemini) redraws shading/detail per frame ("boil"). Downscaling
to a real pixel grid with NEAREST + forcing the master palette collapses those
per-frame differences into a coherent retro sprite.

Usage: python3 refine.py <master.png> <outdir> <frame1.png> [frame2.png ...]
       [--px-height 64] [--colors 32]
Writes <outdir>/frame-N.png (pixel-true, transparent) + <outdir>/preview.gif
"""
import sys
import numpy as np
from PIL import Image

WARM_PAPER = (250, 247, 240, 255)


def master_palette(master: Image.Image, colors: int) -> Image.Image:
    """Palette image from the master's opaque pixels."""
    m = master.convert("RGBA")
    a = np.array(m)
    opaque = a[a[..., 3] > 128][:, :3]
    src = Image.fromarray(opaque.reshape(1, -1, 3), "RGB")
    return src.quantize(colors=colors, method=Image.MEDIANCUT)


def snap(frame: Image.Image, pal: Image.Image, px_h: int) -> Image.Image:
    """BOX resample (not NEAREST): averages within pixel blocks, which survives
    the ~7x downscale from generated art; point-sampling turns it to mush.
    Target px_h ~96-128 - the generator's fake pixel grid is coarser than 64."""
    f = frame.convert("RGBA")
    w = max(1, round(f.width * px_h / f.height))
    small = f.resize((w, px_h), Image.BOX)
    alpha = small.getchannel("A").point(lambda v: 255 if v > 100 else 0)
    rgb = small.convert("RGB").quantize(palette=pal, dither=Image.NONE).convert("RGB")
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


def main() -> None:
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("master")
    p.add_argument("outdir")
    p.add_argument("frames", nargs="+")
    p.add_argument("--px-height", type=int, default=128)
    p.add_argument("--colors", type=int, default=32)
    a = p.parse_args()
    master_path, outdir, frame_paths, px_h, ncol = a.master, a.outdir, a.frames, a.px_height, a.colors

    pal = master_palette(Image.open(master_path), ncol)
    frames = [snap(Image.open(p), pal, px_h) for p in frame_paths]
    cw, ch = max(f.width for f in frames) + 2, px_h + 2

    for i, f in enumerate(frames, 1):
        cell = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        cell.alpha_composite(f, ((cw - f.width) // 2, ch - f.height - 1))
        cell.save(f"{outdir}/frame-{i}.png")

    scale = 3  # preview at 3x nearest for visibility
    previews = []
    for f in frames:
        c = Image.new("RGBA", (cw, ch), WARM_PAPER)
        c.alpha_composite(f, ((cw - f.width) // 2, ch - f.height - 1))
        previews.append(c.resize((cw * scale, ch * scale), Image.NEAREST).convert("P"))
    previews[0].save(f"{outdir}/preview.gif", save_all=True, append_images=previews[1:],
                     duration=150, loop=0, disposal=2)
    print(f"refined {len(frames)} frames -> {outdir} (cell {cw}x{ch} @ {px_h}px)")


if __name__ == "__main__":
    main()
