# End-to-End Smoke Test Checklist

Walkthrough for verifying the full build works in Chrome, end-to-end. Designed to be runnable by a human OR followed by a Claude Code session that needs to verify the branch.

This is **step 1 of the linear path forward** in [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md). Pass this before doing any further feature work.

---

## Prerequisites

- Node.js 18+ (tested on 20.x)
- Chrome (or any Chromium-based browser) with Developer Mode enabled
- An Anthropic API key from [console.anthropic.com](https://console.anthropic.com)
- A Fordham student account with active DegreeWorks access
- You are currently logged into DegreeWorks in the same Chrome profile you'll load the extension into (the cookies in that profile are the auth — see ADR 0004)

If any of those are missing, fix them first. The smoke test will fail in confusing ways otherwise.

---

## Phase 1 — Build and load

### Step 1.1 — Build the extension

```bash
cd registration-agent
npm install
npm run dev
```

`npm run dev` runs Vite in watch mode. It produces a `dist/` folder and rebuilds on every file save.

**Expected:** Vite outputs "ready" or similar within a few seconds. No TypeScript errors. The `dist/` folder appears in the project root and contains a `manifest.json`.

**If it fails:** run `npx tsc --noEmit` separately to surface any type errors. Build errors at this stage usually mean a missing dependency or a leftover file from a previous branch — try `rm -rf node_modules dist && npm install && npm run dev`.

### Step 1.2 — Load the unpacked extension in Chrome

1. Open `chrome://extensions` in your browser
2. Toggle **Developer mode** on (top-right corner)
3. Click **Load unpacked**
4. Select the `dist/` folder produced by Vite
5. Pin the extension to the toolbar so the action icon is visible

**Expected:** "Fordham Registration Helper 1.0.0" appears in the extensions list with no error indicator. The icon shows in the toolbar.

**If it fails:** check the extension's "Errors" link if one appears. Common causes:
- `manifest.json` parse error → re-check the file for syntax issues
- Missing icon files → `public/icons/` should exist (it ships with the repo)
- Service worker registration error → click the "service worker" link to inspect

---

## Phase 2 — Initial setup

### Step 2.1 — Open the side panel

Click the extension icon in the toolbar. The Fordham side panel should slide in from the right.

**Expected:** Side panel opens. Header shows "🎓 Fordham Helper" with two tabs ("Advisor" and "Settings"). The Advisor tab is selected by default.

**If it fails:** check that the manifest has a valid `side_panel.default_path` and that `src/sidebar/index.html` exists in the build output.

### Step 2.2 — Set the API key

1. Click **Settings** in the side panel header
2. Scroll to "Anthropic API Key"
3. Paste your `sk-ant-...` key into the input
4. Click **Save**

**Expected:** A green pill appears with the masked key (`sk-ant-...XXXXXX`). The Save button briefly says "Saved!" and reverts.

**If it fails:** check the service worker console (`chrome://extensions` → click "service worker" link for this extension → DevTools opens). Look for storage write errors.

---

## Phase 3 — DegreeWorks integration

This phase verifies ADR 0002 (JSON API), ADR 0003 (worker-owned fetches), ADR 0004 (cookie auth), and ADR 0009 (PII boundary) are all functional end-to-end.

### Step 3.1 — Open DegreeWorks

In the same Chrome profile, open [https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31](https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31). Log in if prompted.

**Expected:** DegreeWorks loads showing your audit page with your courses, GPA, blocks, etc.

### Step 3.2 — Watch the audit refresh

Open the side panel (extension icon). Open the service worker DevTools in a separate window:

1. `chrome://extensions`
2. Find "Fordham Registration Helper"
3. Click the **"service worker"** link under "Inspect views"
4. The Console tab should be active

You should see a sequence of log lines appear:

```
[FordhamHelper] Audit refresh: fetching student
[FordhamHelper] Fetching audit for student A20XXXXXX (U/BS, 2024)
[FordhamHelper] Audit JSON received, length: ~133000
[FordhamHelper] Rendered audit text, length: ~10000
[FordhamHelper] Profile extracted: <profile body>
```

**Expected sequence:**

1. `REFRESH_AUDIT` message arrives from the content script (shortly after DegreeWorks finishes loading)
2. `fetchStudentMyself()` returns successfully
3. `fetchCurrentAudit()` returns the ~133 kB JSON
4. `auditResponseToText()` renders the plain-text version
5. `chrome.storage.local.set` writes both `auditText` and the parsed name/email
6. Haiku is called for profile extraction
7. `PROFILE_READY` is broadcast back to the side panel

### Step 3.3 — Verify the side panel updates

Switch to the **Advisor** tab in the side panel. The status banner at the top should change from amber ("No audit loaded") through blue ("Building your student profile…") to green ("Ready — Name | Year | Major | Minor").

**Expected:** Green banner shows your name, classification, major, and minor on one line.

**Critical PII check:** Open the service worker DevTools → Network tab → look for the call to `api.anthropic.com/v1/messages` (made during profile extraction). Click it, look at the request body, and verify:

- The system prompt contains `[NAME]`, `[ADVISOR]`, `[ADVISOR_EMAIL]` literal tokens
- It does **NOT** contain your actual name, advisor's name, or advisor's email

If you see your real name in the Anthropic request body, **stop** — that's a PII boundary failure and ADR 0009 is being violated. Don't continue until that's fixed.

**If profile extraction fails or hangs:** the spinner should NOT spin forever (we fixed that bug). If it does, check the service worker console for `[Curator] STUB` or `PROFILE_ERROR` messages.

---

## Phase 4 — Catalog refresh

This phase verifies ADR 0008 (Banner bind dance + pagination).

### Step 4.1 — Run a catalog refresh

1. Side panel → **Settings**
2. Scroll to "Course Catalog"
3. Pick a term from the dropdown (the most recent should be selected by default)
4. Click **Refresh**

**Expected:** A progress bar appears with "Fetching <subject>" labels updating every ~500ms. Progress reaches 100% within 30–60 seconds. The status text changes to "X courses loaded for [Term Name]".

In the service worker console you should see:

```
[FordhamHelper] Refreshing catalog for term 202710...
[FordhamHelper] Raw fetch: ~2000 sections, ~80 unique subjects, ~1500 unique courses
[FordhamHelper] Attributes: ~25 distinct codes across ~1800/2000 sections
[FordhamHelper] Catalog saved: ~1500 courses, ~2000 sections for 202710
```

**If it fails:**
- "0 courses loaded" usually means the Banner three-step bind dance broke silently — check the console for the exact error
- 403 errors on `reg-prod.ec.fordham.edu` mean `manifest.json` is missing the host permission (we added this in commit `eef0b64`, so it should be fine)
- A network timeout is usually transient — retry once

---

## Phase 5 — Chat smoke test

### Step 5.1 — Ask a basic audit question

1. Side panel → **Advisor**
2. Click one of the suggested questions, OR type: "What core requirements am I missing?"
3. Hit Enter

**Expected:**
- "Thinking..." bubble appears briefly
- Streaming response begins, replacing the bubble
- The response references real requirement names from your audit
- Course codes are formatted as `**SUBJ 1234** — Course Title`
- The response addresses you by name (the `[NAME]` token gets substituted to your real first name at render time)

**If the response says "Audit not loaded":** the chat doesn't have access to the audit text. Verify steps 3.2 and 3.3 worked — the audit needs to be in `cachedAuditText` or `chrome.storage.local`.

### Step 5.2 — Ask a course-search question

Type: "What CISC electives can I take next semester?" (or whatever subject you're studying)

**Expected:**
- A small amber chip appears above the assistant message: `🔍 CISC` (or similar) `· searching…`
- After ~1 second, the chip updates with `· N results`
- The streaming response includes real CRNs, meeting times, and seat counts from the catalog

This verifies the `search_catalog` tool is wired correctly and the IndexedDB-backed query is working.

**If the chip doesn't appear:** the tool-use loop in `service-worker.ts` may not be dispatching. Check the service worker console for "tool_use" entries.

### Step 5.3 — Trigger an attribute-tagged query

Type: "What courses can I take that satisfy the American Pluralism requirement?"

**Expected:**
- The chip shows `🔍 list_attributes` (the assistant calls `list_attributes` first to learn the codes)
- Then a second chip: `🔍 PLUR` or similar
- Response lists real courses tagged with that attribute

This verifies the `list_attributes` tool path.

---

## Phase 6 — Memory curator (the main thing we're verifying)

This is the gate before flipping the curator to write mode (step 2 of the IMPLEMENTATION-PLAN linear path).

### Step 6.1 — Capture curator stub logs

After 3–5 chat turns of normal use, look at the service worker console. Filter the console output by typing `Curator` in the filter box.

**Expected output per turn:** ONE of these two patterns:

```
[Curator] STUB — 0 candidates extracted.
```

OR

```
[Curator] STUB — 2 candidates:
  • [interest] ML electives for spring 2026
    Student asked about machine learning courses in this turn and previously...
  • [constraint] No classes Friday mornings (work)
    Student mentioned they work library shifts Friday mornings...
```

### Step 6.2 — Evaluate candidate quality

For each candidate the curator extracts, ask:

1. **Is the description specific enough to route on?** A future model needs to decide whether the memory is relevant from the description alone. "academic interests" is BAD; "ML/AI electives for spring 2026" is GOOD.
2. **Is it actually durable?** "Student asked about CISC 4090" is ephemeral (this turn's topic). "Student is committed to taking CISC 4090 next semester" is durable.
3. **Is the type correct?** `interest` vs `constraint` vs `goal` vs `decision` vs `note` — does the type match what was extracted?
4. **Is the curator skipping turns that have nothing to save?** Most chat turns SHOULD return 0 candidates. If every turn produces 2-3 candidates, the bar is too low.

### Step 6.3 — Iterate the curator prompt if needed

If the candidate quality is consistently good, **the curator is ready for write mode**. Move on to step 2 of `IMPLEMENTATION-PLAN.md`.

If the candidates are vague, hallucinated, or the curator is over-extracting, edit the prompt in [`src/background/agent/memory-curator.ts`](../src/background/agent/memory-curator.ts):

- Strengthen the BAD/GOOD description rubric with more examples from your real failure cases
- Tighten the "What NOT to extract" section
- Make the "Most turns will have NOTHING worth saving" instruction more emphatic

Save the file. Vite hot-reloads the extension build automatically. Reload the extension in `chrome://extensions` (the refresh icon next to the extension card) to pick up the new code. Run another 3-5 chat turns and re-evaluate.

---

## Phase 7 — Prompt caching verification (optional)

This phase verifies ADR 0010 (prompt caching) is actually saving tokens.

### Step 7.1 — Check Anthropic API response metadata

In the service worker DevTools → Network tab → click any `api.anthropic.com/v1/messages` response after the second chat turn in a session. Look at the response body's `usage` field. You should see:

```json
"usage": {
  "input_tokens": 50,
  "cache_creation_input_tokens": 0,
  "cache_read_input_tokens": 3000,
  "output_tokens": 200
}
```

**Expected:** `cache_read_input_tokens` is non-zero on turn 2+ within the 5-minute TTL. If it's zero on every turn, caching isn't working.

**If `cache_read_input_tokens` is zero:** check that the `system` array in the request body has the `cache_control: { type: "ephemeral" }` block on the system prompt.

---

## Pass criteria

The smoke test passes if **all** of the following are true:

- [x] Phase 1: extension builds and loads without errors
- [x] Phase 2: API key saves and shows masked
- [x] Phase 3.1–3.3: audit fetches, profile extracts, side panel shows green Ready banner
- [x] Phase 3.3 PII check: Anthropic request body contains `[NAME]`/`[ADVISOR]`/`[ADVISOR_EMAIL]` tokens, NOT real values
- [x] Phase 4: catalog refresh completes with 1000+ courses for the active term
- [x] Phase 5.1: basic chat returns audit-grounded answers
- [x] Phase 5.2: `search_catalog` tool returns real CRNs
- [x] Phase 6: curator stub logs show reasonable candidate quality (or you've iterated the prompt to where they do)

If everything passes, proceed to step 2 of the [IMPLEMENTATION-PLAN linear path](IMPLEMENTATION-PLAN.md#linear-path-forward) — flip the curator to write mode and continue.

If anything fails, capture the failure mode (console output, screenshot, exact error) and fix before moving on. The failures listed under each step are the common ones; anything else needs investigation.

---

## What to save before compacting context

If a Claude Code session is running this checklist and approaching a context limit, save state to your working notes before handing off. Capture:

1. Which Phase you completed
2. Whether the PII check passed
3. The curator candidate quality assessment (especially anything you'd want to remember for prompt tuning)
4. Any anomalies that don't yet have a clear root cause

Then end the session. The next session reads those notes + this checklist + `IMPLEMENTATION-PLAN.md` and resumes from the Phase you stopped at.
