#!/usr/bin/env python3
"""Fordhawke mascot sprite generation (ADR 0035 spike -> production).

Generates per-state 2x2 animation grids on flat #FF00FF magenta via
OpenRouter (google/gemini-3.1-flash-image), grounded on the toon reference
board (notes/brand/reference/ram-sprite-board-toon.png). Deterministic
extraction/assembly lives in process.py.

Usage: OPENROUTER_KEY=... python3 generate.py <state> [outfile]
States: idle, walk, wave (extend STATE_SPECS for more).
"""
import base64, json, os, sys, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REFERENCE = os.path.join(REPO, "notes/brand/reference/ram-sprite-board-toon.png")
MODEL = "google/gemini-3.1-flash-image"

CHARACTER = (
    "'Fordhawke' exactly as drawn in this reference - cartoony chibi proportions "
    "(large head roughly 1/3 of total height, short stout body), white ram head, "
    "gold spiral horns, brown graduation cap with gold F, brown suit with gold F pin "
    "and tie, small brown backpack, hooved shoes. 1940s rubber-hose/Looney-Tunes energy."
)

RULES = """Rules:
- Exactly ONE character per cell - four figures total in the whole image
- Character identical in every cell (size, colors, proportions, expression) - only the pose changes
- Centered per cell, full body inside central 70% of the cell, same scale in all cells, feet sharing one baseline
- Nothing crosses cell edges; no motion lines; NO drop shadow, NO ground shadow of any kind
- Background: the ENTIRE canvas one solid flat #FF00FF magenta - no gridlines, borders, labels, text
- Style: match the reference exactly"""

STATE_SPECS = {
    "idle": (
        "a front-facing IDLE breathing loop, standing relaxed. Use the reference's 'Idle' pose. "
        "Frame phases: 1) neutral stance; 2) chest rises slightly, head lifts a touch; "
        "3) peak inhale, shoulders up a hair; 4) settling back down, eyes mid-blink. "
        "Subtle motion - this loops as a calm breathing cycle."
    ),
    "walk": (
        "a side-view WALK cycle, walking to the RIGHT - relaxed stroll, not a run. "
        "Frame phases: 1) contact - front foot planted, back heel lifting; "
        "2) passing - legs crossing, body up a touch; 3) opposite contact; 4) opposite passing. "
        "Make the four leg positions CLEARLY distinct."
    ),
    "wave": (
        "a front-facing friendly WAVE. Use the reference's 'Wave' pose. "
        "Frame phases: 1) hand raised beside head; 2) hand tilted outward; "
        "3) hand tilted inward past vertical; 4) back to raised. "
        "Other arm relaxed at side; cheerful open-mouth smile in all frames."
    ),
}


def generate(state: str, outfile: str) -> None:
    spec = STATE_SPECS[state]
    prompt = (
        "The attached image is a CHARACTER REFERENCE ONLY - do not reproduce its "
        f"layout, labels, or multiple poses.\n\nCharacter: {CHARACTER}\n\n"
        "OUTPUT: one image, a 2x2 sprite animation grid - FOUR cells, each containing "
        f"the SAME character in one frame of {spec}\n\n{RULES}"
    )
    ref = base64.b64encode(open(REFERENCE, "rb").read()).decode()
    body = {
        "model": MODEL,
        "modalities": ["image", "text"],
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{ref}"}},
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
        sys.exit(f"NO IMAGE for {state}: {(msg.get('content') or '')[:300]}")
    b64 = imgs[0]["image_url"]["url"].split(",", 1)[1]
    open(outfile, "wb").write(base64.b64decode(b64))
    print(f"{state}: saved {outfile} cost={resp.get('usage', {}).get('cost')}")


if __name__ == "__main__":
    state = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else f"/tmp/claude/mascot-{state}-grid.png"
    generate(state, out)
