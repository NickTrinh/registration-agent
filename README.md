# Fordham Registration Helper

> **AI academic advisor embedded inside Fordham's DegreeWorks portal.** A Chrome extension that lets students chat with Claude about their degree requirements, grounded in their real DegreeWorks audit and live Banner section data — with natural-language course search, requirement-aware recommendations, and long-term memory across conversations.

**Submission for the Fordham AI Solutions Challenge 2026** — deadline Sunday 2026-04-19.

> **Judges**: the submission write-up is at [`WRITE-UP.md`](WRITE-UP.md). For a 60-second technical tour of this README, skim the [ADR Index](#adr-index) and [Architecture at a glance](#architecture-at-a-glance). The [Security & compliance posture](#security--compliance-posture) section answers the "is this allowed?" question. The remainder is dense reviewer material.

---

## For reviewers (and for Claude Code)

This branch (`patch-sprint`) is a sprint rewrite of the original NickTrinh/registration-helper scaffold. It retires the dead HTML-scraping path, adds a typed DegreeWorks JSON API client, a Banner SSB catalog client, a two-tier memory architecture (hard facts + provisional interest promotion) with a background Haiku curator, onboarding intake mode for cold-start personalization, a live What-If audit tool for hypothetical major-switching, and Anthropic prompt caching. Every shaping decision is captured as an ADR in [`notes/decisions/`](notes/decisions/), and every source file cites the ADRs it implements via a `// Implements: ADR NNNN` header line.

If you are **Nick or Paromita** reviewing this PR, read the [Read in this order](#read-in-this-order) section below and skim the ADR one-liners in [ADR Index](#adr-index). You don't need to read every line of source — the ADRs plus the commit bodies cover the *why* for every decision.

If you are **Claude Code picking up this branch fresh**, this README is your entry point. The [Working with Claude Code](#working-with-claude-code) section lists specific prompts that will orient a fresh session efficiently.

---

## Read in this order

1. **[`notes/TESTING.md`](notes/TESTING.md)** — end-to-end testing guide with setup, a scripted demo walkthrough, free-form test scenarios for each tool, and reporting instructions. **Start here if you want to try the extension yourself.**
2. **[`notes/IMPLEMENTATION-PLAN.md`](notes/IMPLEMENTATION-PLAN.md)** — sprint status, what's done, what's next, explicit non-goals. "Current state of the world" doc.
3. **[`notes/AUDIT-2026-04-16.md`](notes/AUDIT-2026-04-16.md)** — post-shipping code audit: 7 fixes landed, 4 follow-up items discussed. Useful for understanding recent patches.
4. **[`notes/decisions/README.md`](notes/decisions/README.md)** — the ADR convention (format, numbering, when to write one, commit pairing). 2 minutes.
5. **[`notes/decisions/`](notes/decisions/) — every `NNNN-*.md` ADR in order, 0001 through 0016.** These document every shaping decision on this branch with rejected alternatives included. The alternatives sections are where the reasoning lives — don't skip them.
6. **[`notes/degreeworks-api-reference.md`](notes/degreeworks-api-reference.md)** — the authoritative reference for Fordham's Ellucian DegreeWorks JSON API. Reverse-engineered from live responses on 2026-04-14. Do NOT re-run API discovery; everything needed to build against `/api/audit` is in this doc.
7. **The source code itself.** Every file in `src/` that implements an ADR has a `// Implements: ADR NNNN, ADR MMMM — see notes/decisions/.` line at the top of its header comment. Grep `Implements: ADR` to see the map at a glance.

---

## Working with Claude Code

If you're using Claude Code to review or extend this branch, here are prompts tuned to the structure of the repo. Each one is self-contained — paste it into a fresh Claude session.

### Getting oriented (30 seconds of reading, big context gain)

> Read `README.md`, then `notes/decisions/README.md`, then every ADR in `notes/decisions/` in numerical order. Then skim `notes/IMPLEMENTATION-PLAN.md` for current sprint state. Summarize in 3 bullets: what this project does, what the core shaping decisions were, and what's currently in progress.

### Understanding the memory architecture

> Read ADRs 0011, 0012, 0013, and 0014, then read `src/background/agent/memory-store.ts` and `src/background/agent/memory-curator.ts`. Explain how the two-tier curator works: hard facts go directly to the memory store; provisional interests accumulate and promote at threshold; hard facts absorb matching provisional rows. Then explain how onboarding inverts the pattern — Sonnet uses `save_memory` directly during intake, bypassing the Haiku curator entirely.

### Understanding the DegreeWorks JSON client

> Read ADR 0002 and ADR 0006, then `notes/degreeworks-api-reference.md`, then `src/background/agent/degreeworks-api-client.ts`. Explain the vendor Accept header quirk on the GET vs POST endpoints, and how `fetchWhatIfAudit` unifies What-If and Look-Ahead into one call.

### Understanding the PII boundary

> Read ADR 0009, then `src/background/agent/degreeworks-audit-to-text.ts`, then the `personalize` function in `src/sidebar/pages/AuditChat.tsx`. Explain the safe-by-construction token substitution pattern — why the renderer deliberately doesn't read `studentName`/`advisorName`/`advisorEmail`, how the tokens flow through Claude, and how the sidebar substitutes real values at render time.

### Finding all files that implement a given ADR

> `grep -rn "Implements: ADR 000X" src/`

Every source file that implements a shaping decision carries that citation in its header comment. One grep gives you the full implementation surface for any ADR.

### Running the test suite / typecheck

> There are no unit tests on this branch. Verification loop is `npx tsc --noEmit` + `npm run build` (both should be clean), then the end-to-end walkthrough in [`notes/TESTING.md`](notes/TESTING.md). The scripted demo in that file exercises every tool and surfaces any regressions.

### Picking up sprint work mid-stream

> Read `notes/IMPLEMENTATION-PLAN.md` for what's done vs. remaining. Then read `notes/AUDIT-2026-04-16.md` for the most recent round of fixes (testing issues #1-5 and 4 follow-up items D-01 through D-04). Proceed with the highest-priority item still marked open.

---

## Rules of the road

Things to not do when working in this repo. Each is enforced by design, but easy to undo accidentally if you don't know the reasoning.

- **Do NOT scrape HTML from DegreeWorks.** The React SPA's DOM is empty; the real data is in the `/api/audit` JSON endpoint. If you find yourself reading `document.body.innerText`, stop — see [ADR 0002](notes/decisions/0002-degreeworks-json-api-not-html-scraping.md).
- **Do NOT log raw audit response bodies.** They contain Banner ID, full name, and advisor email. The `notes/fixtures/*.real.*` paths are gitignored for exactly this reason. See [ADR 0009](notes/decisions/0009-pii-boundary-at-renderer.md).
- **Do NOT read `studentName`, `advisorName`, or `advisorEmail` in `degreeworks-audit-to-text.ts`.** The renderer is the PII enforcement boundary; it emits literal `[NAME]`/`[ADVISOR]`/`[ADVISOR_EMAIL]` tokens instead. The sidebar substitutes real values at render time from `chrome.storage.local`. See [ADR 0009](notes/decisions/0009-pii-boundary-at-renderer.md).
- **Do NOT add a new `fetch()` call outside the service worker.** All third-party API calls run through `src/background/service-worker.ts` or one of the `src/background/agent/*-client.ts` files. Content scripts are thin taps that only send messages to the worker. See [ADR 0003](notes/decisions/0003-service-worker-owns-api-calls.md).
- **Do NOT dispatch on numeric `nodeType`.** The audit response's symbolic `qualifier.name` / `rule.ruleType` fields are the contract; the numeric codes are internal Ellucian machinery. See [ADR 0005](notes/decisions/0005-dispatch-on-symbolic-name-not-numeric-nodetype.md).
- **Do NOT skip Banner's term-bind dance.** `GET /searchResults/searchResults` silently returns default data unless `POST /term/search?mode=search` has committed the term to the session state first. See [ADR 0008](notes/decisions/0008-banner-term-bind-and-term-wide-pagination.md).
- **Do NOT manually handle cookies or JWTs for Fordham endpoints.** Pass `credentials: "include"` to every `fetch()` and let Chrome's cookie jar do the work. See [ADR 0004](notes/decisions/0004-cookie-auth-credentials-include.md).
- **Do NOT delete `notes/decisions/`.** These are the audit trail for every shaping decision. If you disagree with an ADR, write a new one that supersedes it — don't edit or delete the old one.

---

## Architecture at a glance

```text
┌─────────────────────────────────────────────────────────────────────┐
│                      CHROME EXTENSION (MV3)                         │
│                                                                     │
│  ┌──────────────┐      ┌─────────────────────────┐                  │
│  │ Content      │      │  Service Worker         │                  │
│  │ Script       │──────▶  (single owner of all   │                  │
│  │              │      │   third-party fetches)  │                  │
│  │ Detects      │      │                         │                  │
│  │ DegreeWorks  │      │  ┌───────────────────┐  │                  │
│  │ tab → ping   │      │  │ Agent / clients   │  │                  │
│  │ worker       │      │  │                   │  │                  │
│  └──────────────┘      │  │ degreeworks-      │──┼──▶ DegreeWorks   │
│                        │  │   api-client      │  │   JSON API       │
│  ┌──────────────┐      │  │                   │  │                  │
│  │ Side Panel   │◀────▶│  │ banner-ssb-client │──┼──▶ Banner SSB    │
│  │ (React SPA)  │      │  │                   │  │   Class Search   │
│  │              │      │  │ memory-store      │  │                  │
│  │ - Chat       │      │  │ memory-curator ───┼──┼──▶ Anthropic     │
│  │ - Settings   │      │  │                   │  │   (Haiku + Sonnet)│
│  │ - Advisor    │      │  │ catalog-search    │  │                  │
│  └──────────────┘      │  └───────────────────┘  │                  │
│                        │                         │                  │
│                        │  Normal mode: Sonnet    │                  │
│                        │  + tools (search_catalog│                  │
│                        │  / list_attributes /    │                  │
│                        │  recall_memory /        │                  │
│                        │  forget_memory /        │                  │
│                        │  run_what_if)           │                  │
│                        │                         │                  │
│                        │  Onboarding mode: Sonnet│                  │
│                        │  + save_memory tool     │                  │
│                        │  (ADR 0014)             │                  │
│                        │                         │                  │
│                        │  After each turn:       │                  │
│                        │  fire-and-forget Haiku  │                  │
│                        │  two-tier curator       │                  │
│                        │  (ADR 0011, 0013)       │                  │
│                        └─────────────────────────┘                  │
│                                                                     │
│  ┌──────────────────────┐   ┌──────────────────────────────┐        │
│  │ chrome.storage.local │   │ IndexedDB (via idb)          │        │
│  │                      │   │                              │        │
│  │ - API key            │   │ - Banner course catalog      │        │
│  │ - Audit text         │   │   (courseCatalog store)      │        │
│  │ - Student profile    │   │                              │        │
│  │ - firstName          │   │                              │        │
│  │ - advisorEmail       │   │                              │        │
│  │ - memories[]         │   │                              │        │
│  │ - provisional[]      │   │                              │        │
│  │ - curator_turns[]    │   │                              │        │
│  │ - onboardingDone     │   │                              │        │
│  │ - studentId / goal   │   │                              │        │
│  │ - curatorAutoSave    │   │                              │        │
│  │ - themePreference    │   │                              │        │
│  └──────────────────────┘   └──────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
```

**Key invariants:**

- **Service worker owns every third-party fetch** (DegreeWorks, Banner, Anthropic). Content scripts are ~10 lines; they only send messages to the worker.
- **PII never crosses the Anthropic wire.** The renderer emits token placeholders, Sonnet echoes them, the sidebar substitutes at render time.
- **Memory is paged, not injected.** Sonnet sees a routing index (one line per memory); full content loads on demand via `recall_memory`.
- **The curator is a separate model with two tiers.** Haiku runs after each chat turn. Hard facts save immediately; provisional interests accumulate and promote on threshold.
- **Onboarding inverts the write path.** During intake, Sonnet writes memories directly via `save_memory` — the curator is skipped to avoid double-extraction.

---

## What this PR contains

**9 commits** on top of NickTrinh's initial, grouped by theme:

### Documentation (4 commits)

1. `docs: add DegreeWorks JSON API reference` — authoritative ~1000-line reverse-engineered reference for Fordham's Ellucian DegreeWorks JSON API.
2. `docs: add 3-day implementation sprint plan` — day-by-day plan for shipping the working demo by Friday.
3. `docs: add ADR register with 8 retroactive decision records` — ADRs 0001-0008 capturing the discovery-phase shaping decisions (fork, JSON API, worker ownership, cookie auth, symbolic dispatch, unified POST, ATTRIBUTE reverse-mapping, Banner bind dance).
4. `docs: add ADRs 0009-0012 for memory architecture, PII, and caching` — ADRs 0009-0012 for the 2026-04-15 session's memory architecture + PII boundary + prompt caching decisions.

### Source (5 commits)

1. `feat: DegreeWorks JSON API client + typed schema + PII-safe renderer` — retires the HTML scraper. Adds a typed JSON client for GET/POST `/api/audit` and `GET /students/myself`, a complete TypeScript schema mirroring the live response shape, and the PII-safe plain-text renderer.
2. `feat: Banner SSB catalog client + course mapper + search_catalog tool` — the three-step Banner session-bind dance, term-wide pagination, ZTC badge stripping, raw-section-to-Course mapping, and the `search_catalog` tool Claude uses for course queries.
3. `feat: service worker chat loop + memory wiring + manifest host perms` — the main orchestrator: message router, Anthropic chat loop with prompt caching, memory router (GET/DELETE/CLEAR_MEMORIES), fire-and-forget curator, tool-use dispatcher, manifest host permissions for Banner and Anthropic.
4. `refactor: sidebar UI — collapse toolEvents onto ConversationMessage` — retires the old degree-audit types, collapses per-message tool events onto the `ConversationMessage` shape itself (eliminates a nested-setState antipattern), and sweeps five minor bugs (firstName parse, AUDIT_ERROR listener, Haiku empty-response, unused React imports, Settings storage consolidation).
5. `feat: long-term memory store + Haiku curator + recall_memory tool` — the routing-table memory architecture: 50-entry bounded store, MemGPT-style index injection into the system prompt, Haiku-based background curator with a BAD/GOOD description-quality rubric, stub mode for prompt tuning, `recall_memory` tool for on-demand paging.

For the full, line-by-line view: `git log --oneline main..patch-sprint` and `git show <commit-hash>`.

---

## ADR index

Short pointer to every shaping decision captured in this branch. Read them in numerical order if you want the full architectural story.

| # | Title | One-line summary |
|---|-------|------------------|
| [0001](notes/decisions/0001-fork-registration-helper-drop-python.md) | Fork NickTrinh/registration-helper; drop the Python approach | Why we pivoted from a Python/Streamlit prototype to a Chrome extension fork. |
| [0002](notes/decisions/0002-degreeworks-json-api-not-html-scraping.md) | Use DegreeWorks JSON API, not HTML scraping | The React SPA's DOM is empty; the `/api/audit` JSON endpoint is strictly richer. |
| [0003](notes/decisions/0003-service-worker-owns-api-calls.md) | Service worker owns all third-party API calls | Single-owner pattern — content scripts are thin taps. |
| [0004](notes/decisions/0004-cookie-auth-credentials-include.md) | Cookie-based auth via `credentials: "include"` | Browser cookie jar does the work; no manual JWT or refresh handling. |
| [0005](notes/decisions/0005-dispatch-on-symbolic-name-not-numeric-nodetype.md) | Dispatch on symbolic `.name` / `.ruleType`, not numeric `nodeType` | The strings are the public contract; the numbers are internal machinery. |
| [0006](notes/decisions/0006-unified-post-audit-for-whatif-and-lookahead.md) | Unified POST `/api/audit` for What-If and Look-Ahead | One endpoint, three UI features — populated via `goals[]` and `classes[]`. |
| [0007](notes/decisions/0007-reverse-map-attribute-taxonomy-from-rule-tree.md) | Reverse-map ATTRIBUTE taxonomy from the audit rule tree | Walk the server's own rule tree instead of scraping a stale bulletin PDF. |
| [0008](notes/decisions/0008-banner-term-bind-and-term-wide-pagination.md) | Banner session-bind dance + term-wide pagination | Banner SSB is stateful — per-request filters are ignored without a session bind. |
| [0009](notes/decisions/0009-pii-boundary-at-renderer.md) | Safe-by-construction PII boundary at the audit-to-text renderer | Single enforcement file — emits `[NAME]`/`[ADVISOR]`/`[ADVISOR_EMAIL]` tokens, never reads identifying fields. |
| [0010](notes/decisions/0010-prompt-caching-at-system-breakpoint.md) | Prompt caching at the system-prompt breakpoint | ~90% input-token savings on turn 2+ via Anthropic's 5-minute ephemeral cache. |
| [0011](notes/decisions/0011-background-extractor-memory-curator.md) | Background-extractor memory curator (two-model pattern) | Haiku runs after each Sonnet turn to extract durable facts — fire-and-forget, no chat latency cost. |
| [0012](notes/decisions/0012-routing-table-memory-index.md) | Routing-table memory index with `recall_memory` tool | MemGPT-style paging — index always visible, full content loaded on demand. |
| [0013](notes/decisions/0013-two-tier-memory-curator.md) | Two-tier memory curator (hard facts + provisional interests) | Soft signals accumulate in a provisional store; promoted to memories at threshold 2. |
| [0014](notes/decisions/0014-onboarding-intake-mode.md) | Onboarding intake mode with `save_memory` tool | Conversational intake on first launch solves the cold-start memory problem. |
| [0015](notes/decisions/0015-memory-source-attribution.md) | Memory source attribution (verbatim "you said: ..." quotes) | Every memory carries a verbatim snippet of the student's message that justified the save — visible in Settings. |
| [0016](notes/decisions/0016-cors-carveout-for-whatif-proxy.md) | CORS carveout: proxy What-If POST through the DegreeWorks tab | Amends ADR 0003 — DegreeWorks rejects POST from `chrome-extension://` origins, so the What-If call runs from the user's DW tab via `chrome.scripting.executeScript`. |

---

## File map

Where the important things live. Everything else is Vite/React scaffolding you can ignore.

```text
registration-helper/
├── README.md                                    ← you are here
├── manifest.json                                ← Chrome MV3 manifest (host_permissions, content_scripts, side_panel)
├── package.json                                 ← npm scripts + deps (Vite, React, idb, @anthropic-ai/sdk)
├── notes/
│   ├── IMPLEMENTATION-PLAN.md                   ← 3-day sprint plan (read first)
│   ├── degreeworks-api-reference.md             ← reverse-engineered Fordham DegreeWorks JSON API reference
│   └── decisions/                               ← ADR register (read second)
│       ├── README.md                            ← ADR convention + Index + Planned list
│       ├── TEMPLATE.md                          ← scaffold for new ADRs
│       └── 0001-*.md … 0016-*.md                ← 16 shaping decisions
└── src/
    ├── background/
    │   ├── service-worker.ts                    ← the orchestrator — message router, Anthropic chat loop, memory wiring (ADR 0003, 0010)
    │   └── agent/
    │       ├── degreeworks-api-client.ts        ← /api/audit GET + POST (ADR 0002, 0003, 0004, 0006)
    │       ├── degreeworks-audit-to-text.ts     ← PII-safe plain-text renderer (ADR 0005, 0009)
    │       ├── banner-ssb-client.ts             ← Banner class search + term bind dance (ADR 0003, 0004, 0008)
    │       ├── banner-to-course.ts              ← raw-section-to-Course mapper
    │       ├── catalog-search.ts                ← search_catalog tool executor (IndexedDB-backed)
    │       ├── memory-store.ts                  ← memory + provisional stores, recall/save/forget tools (ADR 0011-0014)
    │       └── memory-curator.ts                ← two-tier Haiku curator (ADR 0011, 0013)
    ├── content/
    │   └── degreeworks-content.ts               ← ~10-line thin tap that pings the worker (ADR 0002, 0003)
    ├── sidebar/
    │   ├── App.tsx                              ← top-level page navigator (Advisor / Settings)
    │   ├── main.tsx                             ← React entry point
    │   ├── index.html                           ← side panel HTML
    │   ├── pages/
    │   │   ├── AuditChat.tsx                    ← chat UI + PII personalize() + tool chips (🔍🧠💾🗑️🔮) + onboarding welcome
    │   │   └── Settings.tsx                     ← API key, profile, catalog, Long-Term Memory panel, Developing Interests
    │   └── styles.css                           ← Tailwind entrypoint
    └── shared/
        ├── types.ts                             ← Course/Section/ConversationMessage/ToolEvent/MemoryEntry
        ├── degreeworks-types.ts                 ← DegreeWorks API response types (ADR 0005, 0006)
        └── db.ts                                ← IndexedDB wrapper (courseCatalog store only)
```

---

## Current state

### ✅ What works end-to-end

- Extension loads in Chrome; side panel opens from the action icon
- DegreeWorks audit fetches via JSON API and renders to PII-safe plain text
- PII boundary verified: Anthropic request payload contains `[NAME]`/`[ADVISOR]`/`[ADVISOR_EMAIL]` tokens, never real values
- Haiku extracts a compact student profile from the rendered audit
- Banner catalog refresh pulls sections term-wide (~2000 sections / ~10 seconds for a typical term)
- Sonnet streaming chat with six tools: `search_catalog`, `list_attributes`, `recall_memory`, `save_memory`, `forget_memory`, `run_what_if`
- Prompt caching on the system prompt (verified: `cache_read_input_tokens: 3718` on turn 2+)
- Service worker single-writer pattern for all `chrome.storage.local` mutations

**Memory system (ADR 0013 revised + ADR 0014 + ADR 0015):**
- Two-tier curator — hard facts saved immediately; soft signals (provisional) accumulate internally with promotion at threshold 2 and absorption when a hard fact arrives on the same topic. The provisional tier is implementation-only; not shown in the UI.
- `save_memory` exposed in normal chat mode so students can say "remember X" and Sonnet persists directly, no waiting for the curator to catch it.
- Onboarding intake mode — welcome card when memory is empty; Sonnet runs a 5-minute conversational intake with **deferred batch saves**. `save_memory` calls during intake are queued (not persisted per turn); Sonnet ends the intake by calling `complete_onboarding`, which drains the queue atomically, renders a "Saved N memories" bubble listing each item, and then streams a wrap-up message followed by an inline **"Continue to chat →"** button the student dismisses at their own pace. No auto-fade, no per-turn duplicate saves, no re-run loop.
- **Memory source attribution** — every saved memory stores the verbatim student phrase that justified it; Settings shows "you said: ..." so students can trace provenance.
- **Auto-save toggle** — student-facing control in Settings to disable the background curator entirely. Memories then only save via onboarding or explicit `save_memory` calls.
- **Sensitive-disclosure guardrails** — curator + save_memory prompts refuse to persist health, mental-health, family-crisis, romantic, immigration, or finance disclosures.
- **Memory dedup at write-time** — Jaccard-similarity check with normalized descriptions, hierarchical topic matching with 3-char minimum.
- **Inline memory editing** in Settings (pencil icon → edit description + content inline).
- **Re-run onboarding** button in Settings — wipes memories + provisional + curator buffer + completion flag, welcome card reappears.

**Chat UX:**
- Tool-event chips — color-coded per tool: 🔍 search (amber), 🧠 recall (purple), 💾 save (green), 🗑️ forget (red), 🔮 what-if (blue)
- Single-slot memory-save toast above the input bar — auto-dismisses after 3s, replaced by the next save. No clutter.
- Thinking spinner with rotating phrases ("Pondering", "Consulting the audit", "Wrangling credits"…) while Sonnet reasons between output
- Markdown GFM rendering — tables, links, horizontal rules, blockquotes, code blocks all styled
- Session persistence — chat history survives side-panel close/reopen via `chrome.storage.session`
- Stream cancellation — closing the panel mid-stream aborts the Anthropic request (token savings); partial response stays in session storage
- Page-switch preserves streaming — switching to Settings mid-response no longer unmounts the chat

**External integrations:**
- What-If audit tool — live hypothetical major/minor/concentration switching against the real DegreeWorks audit engine; `studentId` + goal persist to `chrome.storage.local` so the tool survives MV3 service-worker unloads
- Session-expiry UX — targeted banner with re-login link when DegreeWorks cookies expire (401/403)
- `forget_memory` tool — conversational memory deletion

**Appearance:**
- Three-state theme toggle (Light / System / Dark) in Settings. `System` tracks OS `prefers-color-scheme` live.

### 🚧 Still to land before submission

- Slide deck for the Friday/Sunday presentation
- Submission write-up + demo video
- Final Chrome verification pass — see [`notes/TESTING.md`](notes/TESTING.md)
- Lazy course-description hydration (stretch)

### ⚠ Known issues / rough edges

- ADR 0007 (reverse-map ATTRIBUTE taxonomy) is **accepted but not yet implemented in source**. Not blocking.
- `npm run dev` hits a CORS block in Chrome extension context (Vite's HMR client tries to load from `localhost:5173`). Use `npm run build` for testing.
- Line-endings warning on Windows (LF vs CRLF) is harmless but noisy in `git commit` output.

---

## Running locally

### Prerequisites

- Node.js 18+ (tested on 20.x)
- Chrome or Chromium-based browser with Developer Mode enabled
- An Anthropic API key (get one at [console.anthropic.com](https://console.anthropic.com))
- Fordham student login — the extension needs you to be actively logged into DegreeWorks in the same Chrome profile for the cookie-based auth (ADR 0004) to work

### Setup

```bash
git clone https://github.com/NickTrinh/registration-helper
cd registration-helper
git checkout patch-sprint
npm install
npm run build     # one-shot production build → dist/
```

> Use `npm run build`, not `npm run dev`. The Vite dev server tries to load `@vite/env` from `localhost:5173`, which Chrome blocks from the extension origin (CORS). Rerun `npm run build` + click the refresh icon on the extension card after code changes.

In Chrome:

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked**
4. Select the `dist/` folder produced by Vite
5. Pin the extension to your toolbar
6. Open [https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31](https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31) and log in
7. Click the extension icon to open the side panel
8. Go to **Settings** → paste your Anthropic API key → save
9. Go to **Settings** → Course Catalog → pick a term → Refresh (takes ~30–60 seconds)
10. Go to **Advisor** and start chatting

### Inspecting the service worker

For curator logs, chat loop traces, and error messages:

1. `chrome://extensions`
2. Find "Fordham Registration Helper"
3. Click the **"service worker"** link under "Inspect views"
4. DevTools opens on the worker — check the **Console** tab

### Typecheck

```bash
npx tsc --noEmit
```

No unit tests yet. Typecheck + manual end-to-end smoke test is the verification loop for this branch.

---

## Tech stack

- **Runtime**: Chrome Extension Manifest V3 (service worker, side panel, content script)
- **Language**: TypeScript (strict mode, `noUnusedLocals`)
- **UI**: React 18 + Tailwind CSS, rendered into the side panel via `@crxjs/vite-plugin`
- **Build**: Vite 5 + `@crxjs/vite-plugin`
- **Storage**: `chrome.storage.local` (API key, audit text, profile, memories) + IndexedDB via the `idb` library (course catalog)
- **AI**: Anthropic SDK (`@anthropic-ai/sdk`)
  - **Sonnet 4.6** for the main chat loop with tool use
  - **Haiku 4.5** for profile extraction and the memory curator
  - **Prompt caching** (ephemeral breakpoint on the system prompt)
- **Data sources** (all live, no fixtures):
  - Fordham DegreeWorks JSON API (`dw-prod.ec.fordham.edu/responsiveDashboard/api/*`)
  - Fordham Banner SSB Class Search (`reg-prod.ec.fordham.edu/StudentRegistrationSsb/ssb/*`)

---

## Security & compliance posture

Short answer: **by design, this extension only accesses data the current student can already see in their own browser.**

- **No credentials stored.** We never read, write, or transmit Fordham passwords. Auth flows through the browser's existing session cookies via `credentials: "include"` (ADR 0004).
- **No PII sent to Anthropic.** Banner ID, full name, advisor name, and advisor email are stripped at the renderer (ADR 0009). Claude sees placeholder tokens; the sidebar substitutes real values client-side at render time.
- **No server-side storage.** All data lives in the student's browser (`chrome.storage.local` + IndexedDB). Nothing is transmitted anywhere except Anthropic (audit text + conversation) and Fordham's own endpoints.
- **No bulk scraping or scraping of other students' data.** Every API call the extension makes is one a student's browser would normally make during regular DegreeWorks or Banner use. Banner catalog refresh is term-scoped and rate-limited to 150 ms between pages (ADR 0008).
- **No automation against authenticated endpoints.** The extension is driven entirely by user action (opening DegreeWorks, clicking Refresh, typing in chat) — no background polling, no scheduled jobs.
- **For use with your own Fordham account.** The extension runs against the student's own browser session and their own Anthropic API key. Not affiliated with Fordham IT or Ellucian.

Source of truth for the data-transfer and auth decisions is [ADR 0004](notes/decisions/0004-cookie-auth-credentials-include.md) and [ADR 0009](notes/decisions/0009-pii-boundary-at-renderer.md). The What-If CORS carveout is explained in [ADR 0016](notes/decisions/0016-cors-carveout-for-whatif-proxy.md).

---

## Team

Built for the Fordham AI Solutions Challenge 2026 by a 3-person team: [@NickTrinh](https://github.com/NickTrinh), [@pqtch](https://github.com/pqtch), and Paromita. Upstream scaffold by @NickTrinh. Sprint branch (`patch-sprint`) by @pqtch across 2026-04-13 through 2026-04-19.

---

## License

TBD — to be determined before submission.
