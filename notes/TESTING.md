# Testing Guide — Fordham Registration Helper

End-to-end test walkthrough for Nick, Paromita, and anyone else running the extension locally. Covers setup, a scripted demo flow, free-form test scenarios for each tool, and what to report back if something looks off.

---

## Setup

### Prerequisites

- **Node.js 18+** (tested on 20.x) — for `npm install` + `npm run build`
- **Chrome** (or any Chromium-based browser) with Developer Mode enabled
- **Fordham student account** with active DegreeWorks access — the extension needs you logged into DegreeWorks in the same Chrome profile for cookie-based auth
- **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com). Uses Sonnet 4.6 + Haiku 4.5. Expect ~$0.02-0.05 per test session.

### Build and load

```bash
git clone https://github.com/NickTrinh/registration-helper
cd registration-helper
git checkout patch-sprint
npm install
npm run build   # produces dist/
```

In Chrome:

1. Open `chrome://extensions`
2. Toggle **Developer mode** ON (top right)
3. Click **Load unpacked** → select the `dist/` folder
4. Pin the extension to the toolbar so the icon is visible
5. Confirm the card shows "Fordham Registration Helper 1.0.0" with no error indicator. If you see a red "Errors" link, click it and report back.

> **Note on `npm run dev`:** The dev server has a known CORS issue with Chrome's extension context (Vite tries to load `@vite/env` from `localhost:5173` and Chrome blocks it). Use `npm run build` for testing. After code changes, rerun `npm run build` + click the refresh icon on the extension card.

### First-time setup in the side panel

1. Click the extension icon → side panel opens
2. Go to **Settings** → paste your Anthropic API key → **Save**. The key is stored locally in `chrome.storage.local` and only ever sent to `api.anthropic.com`.
3. Still on Settings → scroll to **Course Catalog** → pick a term (Fall 2026 or the most recent) → **Refresh**. Takes ~30-60 seconds; pulls ~2000 sections into IndexedDB.
4. Open DegreeWorks in any tab of the same Chrome profile: [https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31](https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31)
5. The extension will fetch your audit automatically. Flip to **Advisor** tab — the green **Ready** banner should appear at the top with your classification, major, minor.

---

## Fresh-run reset (before testing the onboarding flow)

The onboarding welcome card only appears on first launch (no memories, no completion flag). To test it, wipe the relevant state:

1. `chrome://extensions` → click **service worker** link under "Inspect views" for Fordham Helper → DevTools opens
2. In the **Console** tab, paste and run:
   ```js
   chrome.storage.local.remove(["memories", "provisional", "onboardingCompletedAt", "curator_turns", "studentId", "studentGoal"])
   ```
3. Then:
   ```js
   chrome.storage.session.clear()
   ```
4. Close the side panel and reopen it. The welcome card should appear on the Advisor tab. If not, refresh the extension from `chrome://extensions`.

> **Caution:** this only wipes memory/session state. Your API key and catalog stay intact. If you want a full wipe (including the key + catalog), use `chrome.storage.local.clear()` — you'll then need to re-paste the API key.

---

## Scripted demo walkthrough

A 10-minute happy-path run that exercises every major feature. Do this first; any deviation from the expected output is worth reporting.

### Step 1 — Onboarding intake

1. Fresh-run reset (see above)
2. Open Advisor tab → click **"Let's get started"** on the welcome card
3. Sonnet greets you by first name and asks its first intake question
4. Answer naturally over 5-7 exchanges. Mix specific + vague. Talk about:
   - Academic interests outside your major (e.g. "I've been curious about philosophy of mind")
   - A constraint (e.g. "I work library shifts Fridays 1-5pm")
   - A post-grad goal (e.g. "I'm planning to apply to PhD programs in computational neuroscience")
   - Instructor preferences if you have any

**Expected during intake:**
- Sonnet asks one question at a time and follows up on specifics (not a questionnaire dump)
- Rotating spinner phrases like "Pondering", "Consulting the audit", "Channeling your advisor" during thinking
- **No per-turn 💾 chips, no toast storm.** Saves are deferred and batched — the queue fills silently.
- On the final turn Sonnet calls `complete_onboarding` (no visible tool chip for this tool — the system-action bubble replaces it)

**End of intake:**
- A distinct **"Saving your profile…"** bubble appears (maroon-bordered, not AI prose), listing each queued item with a pending dot (·)
- Each row flips to ✓ as the save commits. Type label (INTEREST / CONSTRAINT / GOAL / etc.) is color-coded
- Each row also shows `you said: "..."` with the verbatim quote that justified the save
- Header changes to **"Saved N memories"** with a checkmark when the batch finishes
- Sonnet then streams a warm 3-4 line wrap-up into a NEW bubble below the save list
- An inline **"Continue to chat →"** button appears under the wrap-up
- Input bar is disabled until you press Continue (placeholder reads "Press Continue to start chat…")
- Press **Continue** — button + wrap-up are preserved (you can scroll back and re-read). Input becomes active. You're now in normal chat mode.
- Welcome card does NOT reappear on this tab or on later openings

### Step 2 — Verify saved memories

1. Flip to **Settings** tab → scroll to **Long-Term Memory**
2. You should see 5-8 memory rows, each with a type tag (interest, constraint, goal, decision, note), a short description, and full content
3. Click the **"▶ Developing interests"** toggle at the bottom — should be empty (or nearly so; the curator only populates this after organic chat turns)

**What to check:**
- No two memories should be near-duplicates (e.g. "theology interest" and "interested in theology")
- Descriptions should be specific — "Philosophy of mind, drawn from neuro work" not "academic interests"
- If you see duplicates, report which ones; the dedup threshold may need tuning

### Step 3 — Normal chat, memory recall

Back on Advisor tab. Ask a question that should trigger recall of one of your saved memories. Example prompts:

- **"Based on what you know about me, what electives should I consider next semester?"**
- **"How does my schedule constraint affect what I can take?"**
- **"Given my goals, which professors would be worth reaching out to?"**

**Expected:**
- Purple 🧠 chip appears: "Recalling #3" (or similar)
- Sonnet's response references the specific memory content (e.g. "since you mentioned working Friday 1-5...")

### Step 4 — Course search

Ask something that requires live catalog data:

- **"What upper-division CISC courses are open next semester?"**
- **"Any English sections on Tuesday/Thursday mornings?"**

**Expected:**
- Amber 🔍 chip with filter summary (e.g. "CISC · ≥3000 · open seats · 42 results")
- Response lists real CRNs, instructors, meeting times, seat counts
- Markdown table renders cleanly (no raw `|` pipes — that's the main formatting fix)

### Step 5 — Attribute-tagged search

Ask about a core requirement:

- **"What courses can I take that satisfy American Pluralism?"**
- **"Show me Eloquentia Perfecta 4 options."**

**Expected:**
- First search is `list_attributes` (amber chip showing attribute discovery)
- Second search filters by the discovered code (e.g. `PLUR` or `AMER`)
- Response lists tagged sections with the attribute chip visible

### Step 6 — What-If audit (the big one)

Ask about a hypothetical major switch:

- **"What if I switched my major to psychology?"**
- **"How would my audit look as a CS major instead?"**

**Expected:**
- Blue 🔮 chip: "What-If: PSYC" or similar
- Status shows "running audit…" for ~3-5 seconds
- Response describes the hypothetical: new percent complete, newly-satisfied blocks, newly-unmet requirements
- Sonnet compares against your real audit (which is still loaded)

**If this errors with "No audit loaded":**
- The studentId cache is the classic failure mode. As of today's commits it should auto-recover from storage. If it still fails, that's a new bug worth reporting.

### Step 7 — Forget a memory

Tell Sonnet to remove one of your memories:

- **"Forget that I mentioned philosophy of mind — I was just being curious."**
- **"Delete the memory about library shifts, that changed."**

**Expected:**
- Red 🗑️ chip: "Forgetting #N"
- Confirmation in response
- Settings tab → memory is gone

### Step 8 — Explicit `save_memory` in normal chat

As of 2026-04-17 the `save_memory` tool is exposed in normal chat mode (not only onboarding). Try:

- **"Remember that I'm planning to apply to MD/PhD programs after graduation."**
- **"Keep track that I can't take classes before 10am — I'm not a morning person."**

**Expected:**
- Green 💾 chip: "Memory saved: ..." in the chat
- A matching toast appears above the input bar for ~3 seconds
- Settings → new row in Long-Term Memory with a **"you said: ..."** line below showing the verbatim quote

### Step 9 — Memory editing + source attribution

1. Go to Settings → Long-Term Memory → find any memory → click the **✎ pencil** icon
2. The row becomes an inline form with editable description + content
3. Type a correction → click **Save**
4. Row updates in place; no page reload

**Also verify source attribution is showing:** each memory should display a small italic line below its content: `you said: "<verbatim student phrase>"`. If it's missing, the memory was created before the source-attribution feature (still valid, just no provenance visible).

### Step 10 — Re-run onboarding

Settings → scroll to bottom of Long-Term Memory → **↻ Re-run onboarding (wipes memories)**

**Expected:**
- Confirmation dialog; click OK
- All memories cleared in place
- Alert confirms reset
- Switch to Advisor tab → welcome card reappears → intake starts fresh

### Step 11 — Auto-save toggle

Settings → **Auto-save memories from chat** toggle (top of Long-Term Memory section). Switch it OFF.

**Expected:**
- Toggle turns gray
- In a subsequent normal chat turn, the curator should NOT save anything
- Service worker console: `[Curator] Skipped — auto-save toggle is OFF.`
- Explicit `save_memory` calls (from "remember X" prompts) still work — they bypass the curator

Flip it back ON when done.

### Step 12 — Stream cancellation

Send a question that'll produce a long response (e.g. "Give me a comprehensive plan to complete my degree"). While Sonnet is mid-stream:

1. Open the service worker DevTools → **Network** tab
2. Close the side panel (click the extension icon again)
3. Watch the Anthropic request row in Network — status should flip to `(canceled)` within a second
4. Reopen the panel — the partial response streamed before cancellation is still visible in the chat

### Step 13 — Page switch during stream

Send a long-response question. While streaming:
1. Switch to **Settings** tab
2. Wait 3-5 seconds
3. Switch back to **Advisor**

**Expected:** the chat kept streaming while Settings was open. The assistant's full response is in the bubble. (This tests the page-unmount fix — both pages stay mounted via CSS display toggle.)

### Step 14 — Dark mode

Settings → **Appearance** section → click **Dark**.

**Expected:**
- Entire extension flips to dark (background, text, borders, message bubbles, buttons all adapt)
- Close and reopen the side panel — dark mode persists

Click **System** — the toggle follows your OS setting. Switch your OS to light then dark (Windows: Settings → Personalization → Colors) to confirm it tracks live.

Click **Light** — explicit light override.

---

## Free-form exercises

Use any of these to stress-test particular areas. Report anything weird.

### Memory quality

- Start a new session. Ask genuine questions unrelated to your saved memories. Check the service worker console (Inspect views → service worker → Console tab → filter by `Curator`). The curator should emit `[Curator] WRITE — no candidates (empty turn)` for most turns. If it's over-extracting on generic questions, the prompt still needs tuning.
- Mention a topic across 2 turns without explicitly committing. The curator tracks provisional hits internally (not shown in Settings UI as of 2026-04-17). If you repeat the topic with consistent framing, it should auto-promote to a real memory after the second mention. Check Settings → Long-Term Memory for the new entry.
- Try to get the curator to save a sensitive disclosure (disability, family crisis, mental health). It should NOT save these — guardrails in the prompt refuse to persist them. Acknowledge should happen in-chat but no memory row should appear in Settings.

### Tool selection

- Ask something ambiguous that could trigger multiple tools. E.g. "What classes should I take?" could be `search_catalog` or `recall_memory` or both. Which chip fires first?
- Ask a question that should NOT need any tool. E.g. "How many credits do I need to graduate?" — Sonnet should answer from audit context without calling `search_catalog`.

### Edge cases

- Close the side panel mid-conversation. Reopen. Your chat history should persist (session storage). Quit Chrome entirely and reopen — chat should clear.
- Leave the extension idle for 2+ minutes, then ask a What-If question. The module cache has wiped by then; the tool should still work because `studentId` is in `chrome.storage.local`.
- Log out of DegreeWorks in another tab, then trigger a catalog refresh in the extension. Should surface a targeted "session expired" banner, not a generic red error.

### UI / formatting

- Ask Sonnet to "list the pros and cons" of something. It'll likely respond with a markdown table. The table should render cleanly.
- Ask for a long, structured answer. Check that headers, bullets, bold, italic, and code blocks all render.
- Long response that overflows the panel — does it scroll smoothly?

---

## Reporting issues

If something doesn't match the expected behavior, capture:

1. **What you did** (exact prompt, which button)
2. **What you expected** (from this doc or from the previous step)
3. **What you saw** (screenshot is ideal; transcript + error message works)
4. **Service worker console output** (if any errors — `chrome://extensions` → service worker → Console)

Post these in the team chat or as comments on [PR #1](https://github.com/NickTrinh/registration-helper/pull/1). The more specific, the faster they get fixed.

---

## Known limitations

- **Thinking indicator is idle-only.** The rotating phrases only show when Sonnet hasn't started emitting output yet. Between tool rounds with active text streaming, there's no indicator (intentional — the text itself is the indicator).
- **Catalog is per-term.** If you switch the term selector in Settings, you have to click Refresh again. The extension doesn't auto-refresh catalogs.
- **Onboarding is one-shot.** Once completed, the welcome card won't reappear. To re-run, use the fresh-run reset above.
- **DegreeWorks session expiry.** Fordham cookies expire after ~1 hour of DegreeWorks inactivity. If the extension errors on audit refresh, open DegreeWorks in another tab to re-authenticate.

---

## Tool reference

Quick summary of what each tool does and when Sonnet uses it:

| Tool | Emoji | When Sonnet calls it | Color |
|---|---|---|---|
| `search_catalog` | 🔍 | Course/section lookups with filters | amber |
| `list_attributes` | 🔍 | Discovering requirement-tag codes once per conversation | amber |
| `recall_memory` | 🧠 | Loading full memory content by ID | purple |
| `save_memory` | 💾 | Onboarding OR normal chat when student says "remember X" | green |
| `forget_memory` | 🗑️ | Student asks to remove a memory | red |
| `run_what_if` | 🔮 | Hypothetical major/minor/concentration switch | blue |

Behind the scenes, a 7th tool runs without a visible chip:
- **`memory-curator`** (Haiku) runs fire-and-forget after every normal-mode turn. Extracts new memories and updates the provisional store. See service worker console (`[Curator]` logs) for visibility.

For the full architecture, see [README.md](../README.md) and the ADRs in [notes/decisions/](decisions/).
