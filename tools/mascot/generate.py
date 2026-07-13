#!/usr/bin/env python3
"""Fordhawke mascot sprite generation — anchor-sheet workflow (smoother batch).

Grounds every request on TWO images:
  Image 1: assets/master-pixel.png  (identity/art reference — Patch-approved canon)
  Image 2: assets/anchor-pixel-<r>x<c>.png (scale-and-root template, same character)
Model: OpenRouter google/gemini-3.1-flash-image (~$0.07/img).
Anchor prompt language: agent-sprite-forge references/prompt-rules.md ("Character
Anchor Sheets"). walk-left is NOT generated — deterministic mirror of walk at assembly.

Usage: OPENROUTER_KEY=... python3 generate.py <state> [outfile]
"""
import base64, json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MASTER = os.path.join(HERE, "assets/master-pixel.png")
MODEL = "google/gemini-3.1-flash-image"

CHARACTER = (
    "'Fordhawke' exactly as drawn in Image 1 - detailed pixel art, cartoony chibi "
    "proportions (large head, short stout body), white ram head, gold spiral horns, "
    "brown graduation cap with gold F, brown suit with gold F pin and tie, small "
    "brown backpack, hooved shoes."
)

ANCHOR_LANGUAGE = (
    "Image 1 is the exact character identity and art reference.\n"
    "Image 2 is a scale-and-root template made from the same accepted character.\n"
    "Preserve Image 2's exact cell locations, fixed camera distance, "
    "standing-equivalent anatomical scale, body-root position, grounded "
    "foot-contact line, and padding. Change only the action pose in each slot. "
    "Never zoom or resize a pose to fill its cell. Natural pose changes may alter "
    "the visible bbox, but head, torso, limb thickness, costume, and prop scale "
    "must remain constant."
)

RULES = """Rules:
- Exactly ONE character per cell; same character identity in every cell - only the pose changes
- Full body AND all held props inside the central 70% of each cell, matching Image 2's figure size exactly - do NOT draw the character larger than Image 2's figures
- Nothing crosses cell edges; leave generous magenta margin on all four sides of every figure
- No motion lines; NO drop shadow, NO ground shadow of any kind
- Background: the ENTIRE canvas one solid flat #FF00FF magenta - no gradients, gridlines, borders, labels, text
- Style: match Image 1's pixel art exactly"""

# state -> (rows, cols, frame-phase spec). Frames read left-to-right, top row first.
STATES = {
    "idle": (2, 3, (
        "a front-facing IDLE breathing loop, standing relaxed. Six frames, one full "
        "breath cycle so the sequence loops seamlessly. Frame phases: "
        "1) neutral stance; 2) chest rising, head lifting a touch; "
        "3) peak inhale, shoulders up a hair; 4) beginning to exhale, shoulders easing; "
        "5) settled low point of the breath, eyes mid-blink; 6) back to neutral. "
        "Subtle motion - a calm loop."
    )),
    "walk": (2, 4, (
        "a side-view WALK cycle, walking to the RIGHT - relaxed stroll, not a run. "
        "Eight frames, one full stride so the sequence loops seamlessly. Frame phases: "
        "1) contact - right foot planted forward, left heel lifting; "
        "2) down - weight onto right foot, body lowest; "
        "3) passing - legs crossing, body rising; "
        "4) up - left foot swinging forward, body highest; "
        "5) opposite contact - left foot planted forward; "
        "6) opposite down; 7) opposite passing; 8) opposite up. "
        "Make the eight leg positions CLEARLY distinct with natural arm swing."
    )),
    "wave": (2, 4, (
        "a front-facing friendly WAVE. Eight frames, one smooth loop. "
        "IMPORTANT: keep his arms SHORT chibi proportions exactly as in Image 1 - "
        "do not lengthen or stretch the waving arm; the hand stays close to the head. "
        "Frame phases: 1) right hand just raised beside head; 2) hand tilting outward; "
        "3) hand at outermost tilt; 4) hand swinging back; 5) hand upright beside head; "
        "6) hand tilting inward; 7) hand at innermost tilt; 8) hand swinging back out. "
        "Other arm relaxed at side; cheerful open-mouth smile in all frames."
    )),
    "ponder": (2, 3, (
        "a front-facing PONDER (deep-thought) loop. He holds an unrolled scroll of "
        "paper in his left hand and brings his right hand to his chin. Six frames, "
        "looping. Frame phases: "
        "1) looking down at the scroll, right hand rising; 2) right hand at chin, "
        "eyes on the scroll; 3) eyes drift up and to the side, thinking; "
        "4) head tilts slightly, hand strokes chin; 5) eyebrows raise - almost got it; "
        "6) eyes back down to the scroll. Thoughtful, quiet motion."
    )),
    "whatif": (2, 4, (
        "a front-facing WHAT-IF fortune-teller loop. REPLACE the graduation cap with "
        "a pointed wizard hat (same brown with gold F); a crystal ball rests in his "
        "left hand at chest height while his RIGHT hand rubs slow circles over it. "
        "Inside the ball, PURPLE energy visibly SPIRALS, and a few tiny purple sparks "
        "rise just above the ball (staying close to it, well inside the cell). "
        "Keep the suit, tie, and backpack. Eight frames, one smooth loop. Frame phases: "
        "1) right hand at the ball's top, purple swirl small; 2) hand rubbing to the "
        "right side, swirl growing; 3) hand at the right, one spark rising; "
        "4) hand circling under, swirl spiraling wider; 5) hand at the left side, "
        "sparks at their peak, eyes widen; 6) hand rising back up, swirl bright; "
        "7) hand back at top, swirl easing, knowing smile; 8) settle to frame 1. "
        "The face stays fully visible and clearly drawn in every frame - the glow "
        "never washes out or covers the face."
    )),
    "reading": (2, 3, (
        "a front-facing READING loop. He wears small round glasses and holds an open "
        "book in both hands at chest height, looking down at it. Six frames, looping. "
        "Frame phases: "
        "1) eyes on the left page; 2) eyes scanning to the right page; "
        "3) finishes the page, slight nod; 4) right hand turns the page; "
        "5) page settles, eyes back to the left; 6) absorbed, small contented smile. "
        "Quiet studious motion."
    )),
}


def b64(path: str) -> str:
    return base64.b64encode(open(path, "rb").read()).decode()


def generate(state: str, outfile: str) -> None:
    rows, cols, spec = STATES[state]
    anchor = os.path.join(HERE, f"assets/anchor-pixel-{rows}x{cols}.png")
    prompt = (
        f"{ANCHOR_LANGUAGE}\n\nCharacter: {CHARACTER}\n\n"
        f"OUTPUT: one image, a {rows}x{cols} sprite animation grid - {rows * cols} cells, "
        f"each containing the SAME character in one frame of {spec}\n\n{RULES}"
    )
    body = {
        "model": MODEL,
        "modalities": ["image", "text"],
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64(MASTER)}"}},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64(anchor)}"}},
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
    b64data = imgs[0]["image_url"]["url"].split(",", 1)[1]
    open(outfile, "wb").write(base64.b64decode(b64data))
    print(f"{state}: saved {outfile} cost={resp.get('usage', {}).get('cost')}")


if __name__ == "__main__":
    state = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, f"work/{state}-raw.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    generate(state, out)
