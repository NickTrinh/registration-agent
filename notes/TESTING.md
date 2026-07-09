# Testing & Demo Walkthrough

A scripted run-through of the extension's main features. Use this after completing the setup in [README.md](../README.md) — this doc assumes the extension is loaded, an Anthropic API key is saved, the course catalog has been refreshed, and DegreeWorks is open in another tab.

---

## 1. Onboarding intake

On first launch (no memories saved yet), the Advisor tab shows a welcome card. Click **"Let's get started"** to begin the intake.

Sonnet will greet you by first name and ask five to seven questions about interests, goals, and constraints — not as a form, but as a conversation. Answer naturally. Try mixing specific and vague responses:

- An academic interest outside your major (*"I've been curious about philosophy of mind"*)
- A scheduling constraint (*"I work library shifts Fridays 1–5pm"*)
- A post-graduation goal (*"I'm planning to apply to PhD programs in computational neuroscience"*)

**What to watch for during intake:**

- Sonnet asks one question at a time and follows up on specifics, rather than reading off a pre-set questionnaire.
- Saves are **deferred**, not per-turn — no `SAVED MEMORY` citations should appear mid-intake, and no save-toast storm. The queue fills silently.

**At the end of the intake:**

- A maroon-bordered **"Saving your profile…"** bubble appears, listing each queued item with a pending dot (·).
- Each row flips to ✓ as the save commits. Color-coded type labels (INTEREST / CONSTRAINT / GOAL / etc.) appear alongside the verbatim quote that justified the save (`you said: "…"`).
- Header flips to **"Saved N memories"** with a checkmark when the batch finishes.
- Sonnet streams a warm three- or four-line wrap-up into a new bubble below the save list.
- An inline **"Continue to chat →"** button appears; the input bar stays disabled until you press it.

Press **Continue** — the chat clears to a fresh, personalized greeting with a quiet one-line marker ("Onboarding complete — memories saved · view them in Settings"). The intake transcript is scaffolding; its durable output is the memory list in Settings. The welcome card won't reappear unless you explicitly re-run onboarding.

---

## 2. Verify saved memories

Flip to the **Settings** tab and scroll to **Long-Term Memory**.

You should see five to eight memory rows, each with a color-coded type tag, a short description, and full content. The small italic line below each (`you said: "…"`) is the verbatim student phrase that triggered the save — the source-attribution feature.

Sanity checks:

- No two memories should be near-duplicates (e.g. "theology interest" and "interested in theology" — if you see those, the dedup threshold is miscalibrated).
- Descriptions should be specific — *"Philosophy of mind, drawn from neuro work"* beats *"academic interests."*

---

## 3. Memory recall in chat

Back on the Advisor tab, ask a question that should trigger recall of one of your saved memories:

- *"Based on what you know about me, what electives should I consider next semester?"*
- *"How does my schedule constraint affect what I can take?"*
- *"Given my goals, which professors would be worth reaching out to?"*

**Expected:** A citation line appears above the answer — `RECALLED · #3 · 1 loaded` in tracked caps — and Sonnet's response references the specific memory content (*"since you mentioned working Friday 1–5…"*).

---

## 4. Course search

Ask something that requires live catalog data:

- *"What upper-division CISC courses are open next semester?"*
- *"Any English sections on Tuesday/Thursday mornings?"*

**Expected:** A citation line with the filter summary — `SEARCHED CATALOG · CISC · ≥3000 · open seats · 42 results` — and a response listing real CRNs, instructors, meeting times, and seat counts. While the search is in flight, the citation ends in `…` and the shimmering status phrase reads "Searching the catalog…". Markdown tables render cleanly.

---

## 5. Attribute-tagged search

Ask about a core requirement:

- *"What courses can I take that satisfy American Pluralism?"*
- *"Show me Eloquentia Perfecta 4 options."*

**Expected:** Two stacked citation lines: `LISTED ATTRIBUTES · N found` first (attribute discovery), then a `SEARCHED CATALOG` line filtering by the discovered code (e.g. `PLUR`, `AMER`) — and the response lists sections tagged with that attribute.

---

## 6. What-If audit

Ask about a hypothetical major switch:

- *"What if I switched my major to psychology?"*
- *"How would my audit look as a CS major instead?"*

**Expected:** A `WHAT-IF AUDIT · PSYC…` citation line, the status phrase "Running a what-if audit…" shimmering for the 3–5 second wait, then a response describing the hypothetical: new percent complete, newly-satisfied blocks, newly-unmet requirements. Sonnet compares against your real audit (which is still loaded in the background).

This is the most complex tool path — it proxies a POST through the active DegreeWorks tab via `chrome.scripting.executeScript` to bypass the extension's Origin being blocked by DegreeWorks' CORS allowlist. See [ADR 0016](decisions/0016-cors-carveout-for-whatif-proxy.md).

---

## 7. Forget a memory

Tell Sonnet to remove one of your memories:

- *"Forget that I mentioned philosophy of mind — I was just being curious."*
- *"Delete the memory about library shifts, that changed."*

**Expected:** A `FORGOT · #N · done` citation line, a confirmation in the response, and the memory gone from the Settings tab. (A failed tool call renders its citation in red with `· failed` — color marks state, never tool identity.)

---

## 8. Explicit save in normal chat

Sonnet has a `save_memory` tool in normal chat mode (not just onboarding), so explicit "remember X" prompts work:

- *"Remember that I'm planning to apply to MD/PhD programs after graduation."*
- *"Keep track that I can't take classes before 10am — I'm not a morning person."*

**Expected:** A `SAVED MEMORY · <description> · saved` citation line in the chat, a maroon-ruled "SAVED · …" line above the input bar for a few seconds, and a new row in Settings → Long-Term Memory with the verbatim quote attached.

---

## 9. Re-run onboarding

To test the intake flow again, go to Settings → scroll to the bottom of Long-Term Memory → **↻ Re-run onboarding (wipes memories)**. This clears memories, the provisional store, and the completion flag. The welcome card will reappear on the Advisor tab.

---

## Known limitations

- **Thinking indicator is idle-only.** The shimmering status phrase (a real tool description like "Searching the catalog…" when one is in flight, otherwise a rotating registrar's-world line) only shows while Sonnet hasn't started emitting text yet. Mid-stream there's no indicator — the paced, growing prose is the indicator.
- **Catalog is per-term.** Switching the term selector in Settings requires a manual Refresh; the extension doesn't auto-update catalogs.
- **DegreeWorks session expiry.** Fordham cookies expire after about an hour of DegreeWorks inactivity. If audit refresh errors, open DegreeWorks in another tab to re-authenticate — the side panel will surface a targeted banner pointing you there.
- **`npm run dev` doesn't work for extension loading.** Vite's HMR client tries to load from `localhost:5173`, which Chrome blocks from the extension origin (CORS). Use `npm run build`.

---

## Tool reference

Tool calls render as citation lines — tracked-caps verb, mono detail, resolved count — stacked like footnotes above the answer they ground (ADR 0024). Color marks *state* (grey in flight, ink resolved, red failed), never tool identity.

| Tool | Citation verb | When Sonnet calls it |
|---|---|---|
| `search_catalog` | `SEARCHED CATALOG` | Course and section lookups with filters |
| `list_attributes` | `LISTED ATTRIBUTES` | Discovering requirement-tag codes (once per conversation) |
| `recall_memory` | `RECALLED` | Loading full memory content by ID |
| `save_memory` | `SAVED MEMORY` | Onboarding, or normal chat when the student says "remember X" |
| `forget_memory` | `FORGOT` | Student asks to remove a memory |
| `run_what_if` | `WHAT-IF AUDIT` | Hypothetical major / minor / concentration switch |

A seventh worker, the Haiku memory curator, runs fire-and-forget after every normal-mode turn with no visible chip. See [ADRs 0011 and 0013](decisions/) for the architecture.

For the full technical story, see [README.md](../README.md) and the ADRs in [notes/decisions/](decisions/).
