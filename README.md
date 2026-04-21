# Fordham Registration Helper

> An AI academic advisor that lives inside Fordham's DegreeWorks portal. Chat with Claude about your degree requirements, grounded in your real audit and live Banner course catalog — with natural-language course search, requirement-aware recommendations, and long-term memory across sessions.

A Chrome extension (Manifest V3) that embeds a Claude-powered advisor as a side panel, reading the live DegreeWorks audit via the vendor JSON API and querying Banner SSB for current section data. Every shaping decision is captured as an ADR in [`notes/decisions/`](notes/decisions/); every source file that implements one cites it via a `// Implements: ADR NNNN` header.

Submitted to the **Fordham AI Solutions Challenge 2026**.

---

## Quick start

```bash
git clone https://github.com/NickTrinh/registration-agent
cd registration-agent
npm install
npm run build     # one-shot production build → dist/
```

Load the `dist/` folder as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked). Full setup details in [Running locally](#running-locally).

**Prerequisites:** Node 18+, Chrome with Developer mode, a Fordham DegreeWorks login, and an [Anthropic API key](https://console.anthropic.com).

---

## Where to start reading

This repo is designed for a reader who wants to understand the **shaping decisions** behind the code, not just the code itself. Pick a depth:

**5 minutes — the architectural spine.** Read [ADR 0001](notes/decisions/0001-fork-registration-helper-drop-python.md) (why a Chrome extension, not a Python web app), [ADR 0003](notes/decisions/0003-service-worker-owns-api-calls.md) (the single-owner service-worker model), and [ADR 0009](notes/decisions/0009-pii-boundary-at-renderer.md) (the safe-by-construction PII boundary).

**15 minutes — add the memory architecture.** Continue with [ADR 0011](notes/decisions/0011-background-extractor-memory-curator.md) (the background curator) and [ADR 0013](notes/decisions/0013-two-tier-memory-curator.md) (the two-tier split), plus the [Architecture at a glance](#architecture-at-a-glance) diagram below.

**An hour — the full decision arc.** Read the [ADR Index](#adr-index) in order. Sixteen records walk you from "fork vs build from scratch" through "how does the advisor remember context across sessions." The rejected-alternatives sections are where the reasoning lives; they're the most valuable part of each ADR.

**If you want to run it** — skip to [Running locally](#running-locally).

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

- **The service worker owns every third-party fetch** (DegreeWorks, Banner, Anthropic). Content scripts are ~10 lines; they only send messages to the worker.
- **PII never crosses the Anthropic wire.** The renderer emits token placeholders, Sonnet echoes them, the sidebar substitutes at render time from `chrome.storage.local`.
- **Memory is paged, not injected.** Sonnet sees a routing index (one line per memory); full content loads on demand via `recall_memory`.
- **The curator is a separate model with two tiers.** Haiku runs after each chat turn. Hard facts save immediately; provisional interests accumulate and promote on threshold.
- **Onboarding inverts the write path.** During intake, Sonnet writes memories directly via `save_memory` — the curator is skipped to avoid double-extraction.

---

## Rules of the road

Things to not do when working in this repo. Each is enforced by design but easy to undo accidentally without the reasoning.

- **Don't scrape HTML from DegreeWorks.** The React SPA's DOM is empty; the real data is in the `/api/audit` JSON endpoint. See [ADR 0002](notes/decisions/0002-degreeworks-json-api-not-html-scraping.md).
- **Don't log raw audit response bodies.** They contain Banner ID, full name, and advisor email. The `notes/fixtures/*.real.*` paths are gitignored for exactly this reason. See [ADR 0009](notes/decisions/0009-pii-boundary-at-renderer.md).
- **Don't read `studentName`, `advisorName`, or `advisorEmail` in `degreeworks-audit-to-text.ts`.** That renderer is the PII enforcement boundary; it emits literal `[NAME]` / `[ADVISOR]` / `[ADVISOR_EMAIL]` tokens instead. See [ADR 0009](notes/decisions/0009-pii-boundary-at-renderer.md).
- **Don't add a new `fetch()` call outside the service worker.** All third-party API calls run through `src/background/service-worker.ts` or one of the `src/background/agent/*-client.ts` files. See [ADR 0003](notes/decisions/0003-service-worker-owns-api-calls.md).
- **Don't dispatch on numeric `nodeType`.** The audit response's symbolic `qualifier.name` / `rule.ruleType` fields are the contract; numeric codes are internal Ellucian machinery. See [ADR 0005](notes/decisions/0005-dispatch-on-symbolic-name-not-numeric-nodetype.md).
- **Don't skip Banner's term-bind dance.** `GET /searchResults/searchResults` silently returns default data unless `POST /term/search?mode=search` has committed the term to session state first. See [ADR 0008](notes/decisions/0008-banner-term-bind-and-term-wide-pagination.md).
- **Don't manually handle cookies or JWTs for Fordham endpoints.** Pass `credentials: "include"` to every `fetch()` and let Chrome's cookie jar do the work. See [ADR 0004](notes/decisions/0004-cookie-auth-credentials-include.md).
- **Don't delete `notes/decisions/`.** These are the audit trail for every shaping decision. If you disagree with an ADR, write a new one that supersedes it — don't edit or delete the old one.

---

## ADR Index

Every shaping decision captured in the project. Read them in numerical order for the full architectural story, or skim the one-liners to find the decision you care about.

| # | Title | One-line summary |
|---|-------|------------------|
| [0001](notes/decisions/0001-fork-registration-helper-drop-python.md) | Fork NickTrinh/registration-helper; drop the Python approach | Why we pivoted from a Python web-app prototype to a Chrome extension fork. |
| [0002](notes/decisions/0002-degreeworks-json-api-not-html-scraping.md) | Use DegreeWorks JSON API, not HTML scraping | The React SPA's DOM is empty; the `/api/audit` JSON endpoint is strictly richer. |
| [0003](notes/decisions/0003-service-worker-owns-api-calls.md) | Service worker owns all third-party API calls · **Amended by 0016 for POST endpoints** | Single-owner pattern — content scripts are thin taps. |
| [0004](notes/decisions/0004-cookie-auth-credentials-include.md) | Cookie-based auth via `credentials: "include"` | Browser cookie jar does the work; no manual JWT or refresh handling. |
| [0005](notes/decisions/0005-dispatch-on-symbolic-name-not-numeric-nodetype.md) | Dispatch on symbolic `.name` / `.ruleType`, not numeric `nodeType` | The strings are the public contract; the numbers are internal machinery. |
| [0006](notes/decisions/0006-unified-post-audit-for-whatif-and-lookahead.md) | Unified POST `/api/audit` for What-If and Look-Ahead | One endpoint, three UI features — populated via `goals[]` and `classes[]`. |
| [0007](notes/decisions/0007-reverse-map-attribute-taxonomy-from-rule-tree.md) | Reverse-map ATTRIBUTE taxonomy from the audit rule tree | Walk the server's own rule tree instead of scraping a stale bulletin PDF. |
| [0008](notes/decisions/0008-banner-term-bind-and-term-wide-pagination.md) | Banner session-bind dance + term-wide pagination | Banner SSB is stateful — per-request filters are ignored without a session bind. |
| [0009](notes/decisions/0009-pii-boundary-at-renderer.md) | Safe-by-construction PII boundary at the audit-to-text renderer | Single enforcement file — emits `[NAME]` / `[ADVISOR]` / `[ADVISOR_EMAIL]` tokens, never reads identifying fields. |
| [0010](notes/decisions/0010-prompt-caching-at-system-breakpoint.md) | Prompt caching at the system-prompt breakpoint | ~90% input-token savings on turn 2+ via Anthropic's 5-minute ephemeral cache. |
| [0011](notes/decisions/0011-background-extractor-memory-curator.md) | Background-extractor memory curator (two-model pattern) · **Extended by 0013 (two-tier split)** | Haiku runs after each Sonnet turn to extract durable facts — fire-and-forget, no chat latency cost. |
| [0012](notes/decisions/0012-routing-table-memory-index.md) | Routing-table memory index with `recall_memory` tool | MemGPT-style paging — index always visible, full content loaded on demand. |
| [0013](notes/decisions/0013-two-tier-memory-curator.md) | Two-tier memory curator (hard facts + provisional interests) · **Revisited 2026-04-17** | Soft signals accumulate in a provisional store; promoted to memories at threshold 2. |
| [0014](notes/decisions/0014-onboarding-intake-mode.md) | Onboarding intake mode with `save_memory` tool · **Revisited 2026-04-18** | Conversational intake on first launch solves the cold-start memory problem. |
| [0015](notes/decisions/0015-memory-source-attribution.md) | Memory source attribution (verbatim "you said: ..." quotes) | Every memory carries a verbatim snippet of the student's message that justified the save — visible in Settings. |
| [0016](notes/decisions/0016-cors-carveout-for-whatif-proxy.md) | CORS carveout: proxy What-If POST through the DegreeWorks tab | Amends ADR 0003 — DegreeWorks rejects POST from `chrome-extension://` origins, so the What-If call runs from the DW tab via `chrome.scripting.executeScript`. |
| [0017](notes/decisions/0017-retrospective.md) | Retrospective — what we'd keep, what we'd rebuild, what surprised us | Looks back across the sixteen preceding ADRs. A design-taste document, not a new decision. |

The [ADR convention doc](notes/decisions/README.md) explains how these are structured and what we consider worth capturing.

---

## Running locally

### Prerequisites

- **Node.js 18+** (tested on 20.x)
- **Chrome** or Chromium-based browser with Developer Mode enabled
- **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com). Uses Sonnet 4.6 + Haiku 4.5; expect ~$0.02–0.05 per test session.
- **Fordham student login** — the extension needs you actively logged into DegreeWorks in the same Chrome profile for the cookie-based auth ([ADR 0004](notes/decisions/0004-cookie-auth-credentials-include.md)) to work.

### Setup

```bash
git clone https://github.com/NickTrinh/registration-agent
cd registration-agent
npm install
npm run build     # one-shot production build → dist/
```

> Use `npm run build`, not `npm run dev`. The Vite dev server tries to load `@vite/env` from `localhost:5173`, which Chrome blocks from the extension origin (CORS). Rerun `npm run build` and click the refresh icon on the extension card after code changes.

### Load in Chrome

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked**
4. Select the `dist/` folder produced by Vite
5. Pin the extension to your toolbar
6. Open [https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31](https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31) and log in
7. Click the extension icon to open the side panel
8. **Settings** → paste your Anthropic API key → save
9. **Settings → Course Catalog** → pick a term → Refresh (takes ~30–60 seconds)
10. **Advisor** → start chatting

### Inspecting the service worker

For curator logs, chat loop traces, and error messages:

1. `chrome://extensions`
2. Find "Fordham Registration Helper"
3. Click the **"service worker"** link under "Inspect views"
4. DevTools opens on the worker — check the Console tab

### Typecheck

```bash
npx tsc --noEmit
```

No unit tests. Typecheck + the end-to-end walkthrough in [`notes/TESTING.md`](notes/TESTING.md) is the verification loop.

---

## What works

**Data plane:**
- DegreeWorks audit fetch via JSON API (GET `/api/audit`) and PII-safe plain-text rendering
- What-If audit (POST `/api/audit`) with live hypothetical major/minor/concentration switching, proxied through the DW tab to bypass CORS ([ADR 0016](notes/decisions/0016-cors-carveout-for-whatif-proxy.md))
- Banner SSB catalog refresh — term-wide pagination with the session-bind dance (~2000 sections / ~10 seconds for a typical term)
- Six tools available to Sonnet: `search_catalog`, `list_attributes`, `recall_memory`, `save_memory`, `forget_memory`, `run_what_if`
- PII boundary verified: Anthropic request payloads contain `[NAME]` / `[ADVISOR]` / `[ADVISOR_EMAIL]` tokens, never real values
- Prompt caching on the system prompt (~90% input-token savings on turn 2+, verified via `cache_read_input_tokens`)

**Memory system** (ADRs 0011 → 0013 → 0014 → 0015):
- Two-tier curator — hard facts save immediately; soft signals accumulate in a developer-only provisional store and promote at threshold 2. Absorbed when a hard fact arrives on the same topic.
- `save_memory` exposed in normal chat — students can say "remember X" and Sonnet persists directly.
- Onboarding intake mode — welcome card on first launch; Sonnet runs a conversational intake with **deferred batch saves**. Saves are queued, `complete_onboarding` drains the queue atomically and renders a "Saved N memories" bubble with verbatim `you said: ...` attribution.
- **Auto-save toggle** in Settings disables the background curator entirely.
- **Sensitive-disclosure guardrails** — curator + `save_memory` prompts refuse to persist health, mental-health, family-crisis, romantic, immigration, or finance disclosures.
- **Dedup at write-time** — Jaccard similarity with normalized descriptions, hierarchical topic matching.
- **Inline memory editing** in Settings (pencil icon → edit description + content inline).

**Chat UX:**
- Tool chips — color-coded per tool (🔍 search, 🧠 recall, 💾 save, 🗑️ forget, 🔮 what-if)
- Single-slot memory-save toast above the input bar — 3-second auto-dismiss, replaced by the next save.
- Rotating thinking-spinner phrases while Sonnet reasons between tool calls
- GFM markdown rendering (tables, links, rules, blockquotes, code blocks)
- Session persistence — chat history survives side-panel close/reopen via `chrome.storage.session`
- Stream cancellation on panel close; partial response stays in session storage
- Three-state theme toggle (Light / System / Dark) that tracks `prefers-color-scheme` live

### Known rough edges

- **ADR 0007 is accepted but not yet implemented.** The reverse-mapping of ATTRIBUTE → requirement from the audit rule tree is a good idea that's still a decision-only artifact.
- **`npm run dev` hits a CORS block** in Chrome extension context. Use `npm run build`.

---

## Repository structure

Where the load-bearing files live. Everything else is Vite/React scaffolding.

```text
registration-agent/
├── README.md                                    ← you are here
├── manifest.json                                ← Chrome MV3 manifest (host_permissions, content_scripts, side_panel)
├── package.json                                 ← npm scripts + deps (Vite, React, idb, @anthropic-ai/sdk)
├── notes/
│   ├── TESTING.md                               ← demo walkthrough
│   ├── degreeworks-api-reference.md             ← reverse-engineered Fordham DegreeWorks JSON API reference
│   └── decisions/                               ← ADR register
│       ├── README.md                            ← ADR convention + Index
│       ├── TEMPLATE.md                          ← scaffold for new ADRs
│       └── 0001-*.md … 0016-*.md                ← 16 shaping decisions
└── src/
    ├── background/
    │   ├── service-worker.ts                    ← the orchestrator — message router, Anthropic chat loop, memory wiring (ADR 0003, 0010)
    │   └── agent/
    │       ├── degreeworks-api-client.ts        ← /api/audit GET + POST proxy (ADR 0002, 0003, 0004, 0006, 0016)
    │       ├── degreeworks-audit-to-text.ts     ← PII-safe plain-text renderer (ADR 0005, 0009)
    │       ├── banner-ssb-client.ts             ← Banner class search + term-bind dance (ADR 0003, 0004, 0008)
    │       ├── banner-to-course.ts              ← raw-section-to-Course mapper
    │       ├── catalog-search.ts                ← search_catalog tool executor (IndexedDB-backed)
    │       ├── memory-store.ts                  ← memory + provisional stores, recall/save/forget tools (ADR 0011-0015)
    │       └── memory-curator.ts                ← two-tier Haiku curator (ADR 0011, 0013)
    ├── content/
    │   └── degreeworks-content.ts               ← ~10-line thin tap that pings the worker (ADR 0002, 0003)
    ├── sidebar/
    │   ├── App.tsx                              ← top-level page navigator (Advisor / Settings)
    │   ├── main.tsx                             ← React entry point
    │   ├── index.html                           ← side-panel HTML
    │   ├── pages/
    │   │   ├── AuditChat.tsx                    ← chat UI + PII personalize() + tool chips + onboarding welcome
    │   │   └── Settings.tsx                     ← API key, profile, catalog, Long-Term Memory panel
    │   └── styles.css                           ← Tailwind entrypoint
    └── shared/
        ├── types.ts                             ← Course / Section / ConversationMessage / ToolEvent / MemoryEntry
        ├── degreeworks-types.ts                 ← DegreeWorks API response types (ADR 0005, 0006)
        └── db.ts                                ← IndexedDB wrapper (courseCatalog store)
```

---

## Tech stack

- **Runtime:** Chrome Extension Manifest V3 (service worker, side panel, content script)
- **Language:** TypeScript (strict mode, `noUnusedLocals`)
- **UI:** React 18 + Tailwind CSS, rendered into the side panel via `@crxjs/vite-plugin`
- **Build:** Vite 5 + `@crxjs/vite-plugin`
- **Storage:** `chrome.storage.local` (API key, audit text, profile, memories) + IndexedDB via the `idb` library (course catalog)
- **AI:** Anthropic SDK (`@anthropic-ai/sdk`)
  - **Sonnet 4.6** for the main chat loop with tool use
  - **Haiku 4.5** for profile extraction and the memory curator
  - **Prompt caching** (ephemeral breakpoint on the system prompt)
- **Data sources** (all live, no fixtures):
  - Fordham DegreeWorks JSON API (`dw-prod.ec.fordham.edu/responsiveDashboard/api/*`)
  - Fordham Banner SSB Class Search (`reg-prod.ec.fordham.edu/StudentRegistrationSsb/ssb/*`)

---

## Security & compliance posture

Short answer: **by design, this extension only accesses data the current student can already see in their own browser.**

- **No credentials stored.** We never read, write, or transmit Fordham passwords. Auth flows through the browser's existing session cookies via `credentials: "include"` ([ADR 0004](notes/decisions/0004-cookie-auth-credentials-include.md)).
- **No PII sent to Anthropic.** Banner ID, full name, advisor name, and advisor email are stripped at the renderer ([ADR 0009](notes/decisions/0009-pii-boundary-at-renderer.md)). Claude sees placeholder tokens; the sidebar substitutes real values client-side at render time.
- **No server-side storage.** All data lives in the student's browser (`chrome.storage.local` + IndexedDB). Nothing is transmitted anywhere except Anthropic (audit text + conversation) and Fordham's own endpoints.
- **No bulk scraping or access to other students' data.** Every API call the extension makes is one a student's browser would normally make during regular DegreeWorks or Banner use. Banner catalog refresh is term-scoped and rate-limited to 150 ms between pages ([ADR 0008](notes/decisions/0008-banner-term-bind-and-term-wide-pagination.md)).
- **No background automation.** The extension is driven entirely by user action (opening DegreeWorks, clicking Refresh, typing in chat) — no polling, no scheduled jobs.
- **For use with your own Fordham account.** The extension runs against the student's own browser session and their own Anthropic API key. Not affiliated with Fordham IT or Ellucian.

Source of truth for the data-transfer and auth decisions is [ADR 0004](notes/decisions/0004-cookie-auth-credentials-include.md) and [ADR 0009](notes/decisions/0009-pii-boundary-at-renderer.md). The What-If CORS carveout is explained in [ADR 0016](notes/decisions/0016-cors-carveout-for-whatif-proxy.md).

---

## Team

Built by **Team Gradient** for the Fordham AI Solutions Challenge 2026: [@NickTrinh](https://github.com/NickTrinh), [@pqtch](https://github.com/pqtch), and [@BlazedDonuts](https://github.com/BlazedDonuts). Upstream scaffold by @NickTrinh.

---

## License

TBD.
