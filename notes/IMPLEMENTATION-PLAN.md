# Implementation Plan — Linear Path to Submission

**Status as of 2026-04-17 (afternoon):** Implementation substantially complete on the `patch-sprint` branch — 19+ commits. 15 ADRs. Feature-complete: two-tier memory curator (with auto-save toggle, sensitive-disclosure guardrails, source attribution, dedup), onboarding intake mode, What-If audit, forget_memory, save_memory in normal mode, inline memory editing, re-run onboarding, chat session persistence, stream cancellation, GFM markdown rendering, three-state dark mode, live session-expiry handling. Pending: final Chrome verification, slide deck, submission write-up, demo video. Open as draft PR at [NickTrinh/registration-helper#1](https://github.com/NickTrinh/registration-helper/pull/1).

**Deadline:** Extended to Sunday 2026-04-19 (coordinator-confirmed extension from original Friday 2026-04-17). Unclear whether the Sunday deadline is the full submission package or slide deck only — awaiting coordinator clarification.

## Read these first

1. **[README.md](../README.md)** — project overview, architecture, reading order, Claude Code workflow prompts, current state, running locally.
2. **[notes/decisions/README.md](decisions/README.md)** — ADR convention, Index, Planned list.
3. **Every ADR in [notes/decisions/](decisions/)** — 0001 through 0015. These document every shaping decision, with rejected alternatives. Read them in numerical order. ADR 0013 has a "Revisited 2026-04-17" section documenting the memory-system refactor.
4. **[notes/degreeworks-api-reference.md](degreeworks-api-reference.md)** — the reverse-engineered Fordham DegreeWorks JSON API reference. Authoritative. Don't re-derive.

## What's done

Committed on `patch-sprint`:

### Discovery phase (ADRs 0001-0008)

Fork the NickTrinh scaffold; drop the Python approach; use DegreeWorks JSON API instead of HTML scraping; service worker owns all third-party fetches; cookie auth via `credentials: "include"`; symbolic dispatch on `.name` / `.ruleType` instead of numeric `nodeType`; unified POST `/api/audit` for What-If and Look-Ahead; reverse-map ATTRIBUTE taxonomy from the audit rule tree (decision only — see Known Issues); Banner session-bind dance + term-wide pagination.

### Session 2026-04-15 shaping decisions (ADRs 0009-0014)

Safe-by-construction PII boundary at the audit-to-text renderer; prompt caching at the system-prompt breakpoint; background-extractor memory curator (two-model Haiku-after-Sonnet pattern); routing-table memory index with `recall_memory` tool (MemGPT-style paging); two-tier curator with provisional interest promotion (ADR 0013); onboarding intake mode with `save_memory` tool (ADR 0014).

### Session 2026-04-17 refactor + additions (ADR 0013 revised + ADR 0015)

After live testing surfaced friction with the memory architecture, we ran a fresh-eyes review and refactored across four design axes (documented in the ADR 0013 "Revisited" section):

- **Axis 1 = B**: expose `save_memory` in normal chat mode so student-initiated saves ("remember X") work without waiting for the curator.
- **Axis 2 = B + D**: single-slot save toast above the input bar + Settings toggle to disable the auto-curator entirely.
- **Axis 3 = D**: hide the "Developing Interests" section from Settings (provisional accumulation still happens internally).
- **Axis 4 = C**: drop the separate Haiku consolidator; rely on store-level Jaccard dedup + curator's "don't re-extract" rule.

Plus: ADR 0015 introduces **memory source attribution** — every saved memory stores the verbatim student quote that justified it. Settings shows "you said: ..." so students can trace provenance and trust what's in the store. Also added: inline memory editing, re-run onboarding button, stream cancellation on panel close, three-state dark mode (Light / System / Dark), sensitive-disclosure guardrails (health / mental-health / family-crisis / immigration / finance topics are not persisted).

### Source code

- `src/background/agent/degreeworks-api-client.ts` — typed GET / POST `/api/audit` + `/students/myself` + What-If audit
- `src/background/agent/degreeworks-audit-to-text.ts` — PII-safe plain-text renderer with `[NAME]` / `[ADVISOR]` / `[ADVISOR_EMAIL]` token substitution
- `src/background/agent/banner-ssb-client.ts` — Banner class search with three-step session bind and term-wide pagination
- `src/background/agent/banner-to-course.ts` — Banner section → Course shape mapper
- `src/background/agent/catalog-search.ts` — `search_catalog` tool executor, IndexedDB-backed
- `src/background/agent/memory-store.ts` — routing-table memory store + provisional interest store, CRUD with count-based promotion, `recall_memory` / `save_memory` / `forget_memory` tool schemas + executors
- `src/background/agent/memory-curator.ts` — two-tier Haiku curator: hardFacts (immediate save) + provisionalHits (accumulate, promote at threshold), multi-turn context window (last 5 turns), framing-consistency judgments
- `src/background/service-worker.ts` — message router, Anthropic chat loop with prompt caching, onboarding mode (separate system prompt + save_memory tool), normal mode (recall/forget/what-if tools + fire-and-forget curator), rolling conversation buffer, provisional + memory router
- `src/content/degreeworks-content.ts` — ~10-line thin-tap content script
- `src/sidebar/pages/AuditChat.tsx` — chat UI with PII `personalize()`, tool-event chips (search 🔍 / recall 🧠 / save 💾 / forget 🗑️ / what-if 🔮), onboarding welcome card with auto-trigger + completion detection
- `src/sidebar/pages/Settings.tsx` — API key, profile, catalog refresh, Long-Term Memory panel, collapsed Developing Interests section
- `src/shared/degreeworks-types.ts` — complete DegreeWorks API response type schema
- `src/shared/types.ts` — `Course`, `Section`, `ConversationMessage` (with `toolEvents`), `ToolEvent`, `MemoryType`, `MemoryEntry`, `ProvisionalInterest`
- `src/shared/db.ts` — IndexedDB wrapper for the course catalog store
- `manifest.json` — `host_permissions` for DegreeWorks, Banner, and Anthropic

### Five bug fixes folded into the source commits

- `firstName` parse: split on comma first to handle the Ellucian `"Last, First Middle"` format
- `SET_PROFILE` handler added (was missing; Settings edits had been going stale in the worker cache)
- `AUDIT_ERROR` listener + red banner in `StatusBar` (previously broadcast but nobody subscribed)
- Haiku empty-response → explicit `PROFILE_ERROR` broadcast (previously hung the profile spinner)
- Unused React default imports removed (`App.tsx`, `main.tsx`, `AuditChat.tsx`, `Settings.tsx`) — required by `noUnusedLocals` + the `jsx: "react-jsx"` runtime

### Performance

Prompt caching wrap on the full system prompt (audit + profile + memory index + instructions). Turn 2+ within the 5-minute TTL pays ~10% of the input-token cost for the cached prefix. ~70–80% savings across a typical session.

### Documentation

`README.md`, this file, `SMOKE-TEST.md`, and ADRs 0001–0014 with `TEMPLATE.md` + README convention doc in `notes/decisions/`.

---

## Linear path forward

What's still remaining, in dependency order.

### Verification (before submission)

1. **End-to-end Chrome test** — follow [TESTING.md](TESTING.md). Covers the full feature set including the 2026-04-17 additions:
   - Onboarding → memory saves with source attribution → `**Onboarding complete.**` clears chat
   - Dark mode 3-state toggle (Light / System / Dark) — system tracks OS
   - `save_memory` in normal chat ("remember I want X")
   - Memory editing (pencil icon) + "you said: ..." provenance rendering
   - Re-run onboarding button wipes memories cleanly
   - Auto-save toggle actually disables the curator when OFF
   - Close-panel-mid-stream cancels the Anthropic request (confirm via DevTools Network)
   - Toast appears above input when a memory is saved, auto-dismisses after 3s
   - What-If after SW unload (wait 60s, trigger What-If) — confirms studentId rehydration from storage
   - Stream chunks keep arriving when switching Advisor ↔ Settings mid-response

### Catalog polish (time permitting)

1. **Lazy course-description hydration.**
   - Add `getCourseDescription(term, crn)` to [`src/background/agent/banner-ssb-client.ts`](../src/background/agent/banner-ssb-client.ts)
   - POSTs to `searchResults/getCourseDescription`, strips HTML tags from the response
   - Modify `executeCatalogSearch` in [`src/background/agent/catalog-search.ts`](../src/background/agent/catalog-search.ts) to lazy-fetch descriptions for the top 5 results of each search and merge them into the IndexedDB catalog store
   - Cache by `subjectCourse` — descriptions are per-course, not per-CRN

2. **Preserve descriptions across catalog refresh.**
   - Modify `bannerSectionsToCourses` to preserve existing `description` / `prerequisites` fields when re-running catalog refresh
   - Expose `description` in `CatalogSearchResult` so the search tool output carries it back to Sonnet

### Submission packaging

1. **README pass for submission.**
    - Refresh the "Still to land" list with what actually shipped
    - Confirm the live-demo instructions are accurate against the final `dist/`
    - Add final screenshots if the write-up calls for inline images
    - Strip any leftover sprint-time artifacts

2. **Submission write-up.**
    - 1–2 pages for the coordinators
    - Structure: problem statement · approach · architecture summary · novelty points (PII boundary, memory architecture, cookie-based auth without credential handling, reverse-engineered Fordham DegreeWorks JSON API) · test plan · screenshots
    - Pulls heavily from the README and ADRs — this is where the ADR alternatives-considered sections pay off

3. **Demo video record.**
    - 2–3 minute screen recording
    - Script follows the three canonical stories from the 4/8 brainstorm:
      - **"The Lost Sophomore"** — open DegreeWorks → open the extension → ask "what do I still need to graduate?" → streaming answer with real course codes → "what electives can I take next semester?" → `search_catalog` chip appears → real CRNs returned
      - **"The Group Project"** (only if group scheduling lands)
      - **"Pre-Advisor Meeting"** — one-click progress summary with remaining requirements, risks, suggested questions
    - Record via OBS or Windows Game Bar. Keep it tight.

4. **Final testing pass.**
    - Load the extension fresh
    - Run through the three demo stories end-to-end
    - Fix anything that surfaces before step 15
    - `npx tsc --noEmit` one more time

5. **Submit.**
    - Push the final commit to `patch-sprint`
    - Mark the PR ready for review (un-draft)
    - Send the submission email to coordinators with repo link + write-up + demo video

---

## Non-goals

Explicit cuts. Things we are NOT doing this sprint:

- Python anything. Dead since ADR 0001.
- Training or fine-tuning models. Competition email explicitly says don't.
- Multi-semester schedule planner UI. Types exist but building UI would eat a day we don't have.
- Covering every edge case in the audit rule grammar. Render what's there; unknown node types fall through to label rendering (ADR 0005's "graceful degradation" consequence).
- Backwards compatibility with the HTML content script. Deleted in commit `7d6465b`.
- Implementing ADR 0007's ATTRIBUTE reverse-mapping in source. The decision stands as documentation; the current chat flow works without it because `search_catalog` already filters on Banner's own `sectionAttributes` taxonomy. See Known Issues.

## Known issues

- **ADR 0007 is accepted but not yet implemented in source.** The reverse-mapping of ATTRIBUTE → requirement from the audit rule tree is a good idea that didn't make it into the sprint code. Not blocking.
- **Two-tier curator + onboarding are untested in Chrome.** Typechecks clean, builds succeed, but no live verification yet. The 7-phase smoke test must pass before submission.
- **Line-ending warnings (LF / CRLF) on Windows** are harmless but noisy in `git commit` output. Safe to ignore.
- **Anthropic API key is user-provided** (Settings → paste). If a reviewer loads the extension without an API key, the Advisor tab shows a clear CTA to Settings — but the chat can't actually run until the key is set.
- **What-If tool requires cached studentId.** The tool will fail if the service worker has restarted since the last audit refresh (module-level cache is wiped). Mitigation: the audit auto-refreshes on DegreeWorks page load, so in practice this only matters if the student opens the extension without DegreeWorks open.

## Architecture invariants to preserve

These are enforced by ADRs 0003, 0004, 0005, 0008, 0009 and locked into the source code. If you find yourself violating one, stop and check the relevant ADR first.

- **Service worker owns every third-party fetch.** Content scripts are thin taps (~10 lines). Never add a `fetch()` in a content script or a sidebar component.
- **Symbolic dispatch.** Use `qualifier.name` / `rule.ruleType` (strings), never numeric `nodeType`.
- **Never log full audit response bodies.** Log lengths and IDs only — they contain Banner ID and full name.
- **Banner requires the three-step session-bind dance** (`resetDataForm` → `term/search?mode=search` → `searchResults`). Don't skip step 2 or the subsequent searches silently return default data.
- **The audit-to-text renderer is the PII enforcement boundary.** Never read `studentName`, `advisorName`, or `advisorEmail` in that file. Emit the literal tokens instead.
- **Single-writer pattern for `chrome.storage.local`.** The service worker owns every write. Sidebar mutations dispatch a message (`SET_PROFILE`, `DELETE_MEMORY`, etc.) and let the worker persist + rebroadcast.
- **Cookie-based auth only.** Pass `{ credentials: "include" }` to every fetch. Do not read cookies manually, do not parse JWTs, do not build an Authorization header.

## Risks

- **DegreeWorks session expiry.** Cookies are `HttpOnly` and refresh as long as the user has touched DegreeWorks within ~1 hour. If a fetch 401s, the side panel's red banner tells the user to refresh DegreeWorks. No credential handling on our end. See ADR 0004.
- **PII in demo screenshots.** Every audit view shows Patch's Banner ID and name. The safe-by-construction renderer handles the Anthropic wire, but screenshots for the write-up and video must be manually redacted (or taken with a scrubbed audit).
- **Curator writes polluting the store.** Once `{ write: true }` is flipped, low-quality extraction candidates land for real. Mitigation: only flip after step 2 confirms the prompt is extracting well. The `CLEAR_MEMORIES` router handler is a kill switch.
- **Description hydration latency.** `searchResults/getCourseDescription` is one POST per course. Capping at top 5 per search and caching by `subjectCourse` in IndexedDB keeps this bounded, but first-run searches will be noticeably slower than cached ones.
- **Network flakiness mid-session.** Both `gh pr create` and chat turns go over the network. Nothing to do about this beyond retry — worth mentioning in the risks section so a teammate hitting a timeout doesn't assume the code is broken.

## If you hit context limits mid-session

Save state to your working notes before handing off. Capture:

1. Which numbered step in "Linear path forward" you're currently on
2. Which files you've edited in this session
3. What's committed vs. staged vs. working-tree only
4. Any error message you're stuck on
5. The immediate next action

Then end the session. The next session reads those notes + this file + the README to reorient.
