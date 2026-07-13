#!/usr/bin/env python3
"""RamPlan header logo — one-shot lockup, NOT a sprite-grid state.

Fordhawke's head (pixel style, from master) on the left looking LEFT, with
"Ram Plan" in cursive fountain-pen script to the right. Generated on flat
magenta, chroma-keyed + defringed at full resolution (no pixel-snap — the
script's fine strokes would not survive refine.py's downscale/quantize).

Usage: OPENROUTER_KEY=... python3 logo.py [gen|key]   (default: both)
Writes work/logo-raw.png -> assets/logo.png + preview PNG on warm paper.
"""
import os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PREVIEW_DIR = "/mnt/c/Users/Public/ramplan-mascot-preview/current"
WARM_PAPER = (250, 247, 240, 255)
RAW = os.path.join(HERE, "work/logo-raw.png")
OUT = os.path.join(HERE, "assets/logo.png")

PROMPT = (
    "A horizontal wordmark/logo lockup for a university course-planning app "
    "called 'Ram Plan'.\n"
    "LEFT side: the head ONLY of the mascot from Image 1 - 'Fordhawke', a white "
    "ram with gold spiral horns wearing a brown graduation cap with a gold F - "
    "drawn in the SAME detailed pixel-art style as Image 1, facing LEFT "
    "(looking toward the left edge of the canvas).\n"
    "RIGHT of the head: the words 'Ram Plan' written in elegant flowing CURSIVE "
    "script, as if handwritten with a fountain pen - fluid connected letterforms, "
    "confident thick-and-thin ink strokes, in a warm dark brown ink that matches "
    "the mascot's brown, with a subtle gold accent allowed on a flourish. "
    "Spell it exactly: 'Ram Plan' (capital R, capital P, two words).\n"
    "Layout: single horizontal line, head vertically centered against the text, "
    "modest gap between head and text. Everything inside the central 80% of the "
    "canvas with clear margin on all sides.\n"
    "Background: the ENTIRE canvas one solid flat #FF00FF magenta - no gradients, "
    "no shadows, no borders, no extra text or taglines."
)


def gen() -> None:
    import base64, json, urllib.request
    from generate import MASTER, MODEL

    def b64(p): return base64.b64encode(open(p, "rb").read()).decode()

    body = {
        "model": MODEL,
        "modalities": ["image", "text"],
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64(MASTER)}"}},
        ]}],
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {os.environ['OPENROUTER_KEY']}",
                 "Content-Type": "application/json"},
    )
    resp = json.load(urllib.request.urlopen(req, timeout=240))
    msg = resp["choices"][0]["message"]
    imgs = msg.get("images") or []
    if not imgs:
        sys.exit(f"NO IMAGE: {(msg.get('content') or '')[:300]}")
    import base64 as _b
    open(RAW, "wb").write(_b.b64decode(imgs[0]["image_url"]["url"].split(",", 1)[1]))
    print(f"logo: saved {RAW} cost={resp.get('usage', {}).get('cost')}")


def key() -> None:
    """Chroma-key magenta at full res + magenta-signature defringe (refine.py's
    test: r~=b, both high, g far below - purple-safe, though the logo has none)."""
    a = np.array(Image.open(RAW).convert("RGBA"))
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    dist = np.sqrt((r - 255) ** 2 + g ** 2 + (b - 255) ** 2)
    a[..., 3] = np.where(dist < 100, 0, a[..., 3])
    # soften the rim: partial alpha in the 100-160 band
    band = (dist >= 100) & (dist < 160)
    a[..., 3][band] = np.minimum(a[..., 3][band], ((dist[band] - 100) / 60 * 255).astype(np.uint8))
    # defringe leftover magenta-tinged pixels — HUE test at any brightness:
    # the raw carries a dark magenta halo (e.g. 139,0,136) outside the art's
    # own dark-brown outline. Legit browns are r>g>b, so "g far below both
    # r and b" only matches chroma contamination. (Logo has no purple props.)
    magentaish = (g < r - 40) & (g < b - 30) & (b > 40) & (np.abs(r - b) < 90)
    a[..., 3][magentaish] = 0
    img = Image.fromarray(a)
    img = img.crop(img.getbbox())
    img.save(OUT)

    bg = Image.new("RGBA", (img.width + 80, img.height + 60), WARM_PAPER)
    bg.alpha_composite(img, (40, 30))
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    prev = os.path.join(PREVIEW_DIR, "logo.png")
    bg.convert("RGB").save(prev)
    print(f"logo: {img.width}x{img.height} -> {OUT} + {prev}")


def dark() -> None:
    """Dark-mode variant: same letterforms, ink remapped. The head survives
    dark backgrounds (cream/gold); the dark-brown cursive ghosts (~1.8:1 on
    stone-900). Deterministic recolor of the TEXT region only — never
    regenerate, or the two modes get different lettering. Gold flourish
    (g high) kept; brown ink (g low) -> warm cream."""
    a = np.array(Image.open(OUT).convert("RGBA"))
    alpha_cols = (a[..., 3] > 0).sum(axis=0)
    gaps = [x for x in range(200, a.shape[1] - 200) if alpha_cols[x] == 0]
    if not gaps:
        sys.exit("logo dark: no head/text gap found - layout changed?")
    split = gaps[len(gaps) // 2]
    text = a[:, split:]
    g = text[..., 1].astype(int)
    ink = (text[..., 3] > 0) & (g < 80)          # brown strokes, not gold
    text[..., :3][ink] = (242, 231, 209)          # warm cream, matches the face
    out = Image.fromarray(a)
    dst = OUT.replace(".png", "-dark.png")
    out.save(dst)

    stone900 = (28, 25, 23, 255)
    bg = Image.new("RGBA", (out.width + 80, out.height + 60), stone900)
    bg.alpha_composite(out, (40, 30))
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    prev = os.path.join(PREVIEW_DIR, "logo-dark.png")
    bg.convert("RGB").save(prev)
    print(f"logo-dark: split@{split} -> {dst} + {prev}")


if __name__ == "__main__":
    steps = sys.argv[1:] or ["gen", "key"]
    if "gen" in steps:
        gen()
    if "key" in steps:
        key()
    if "dark" in steps:
        dark()
