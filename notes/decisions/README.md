# Architecture Decision Records

This directory holds the **ADRs** (Architecture Decision Records) for the project. Each ADR captures the reasoning behind one shaping decision — what forced the choice, what we picked, what we rejected, and what that locks in. They're the single clearest way to understand *why* this codebase looks the way it does.

## Why we use them

A Chrome extension that proxies a live DegreeWorks audit to Claude accumulates a lot of decisions that aren't obvious from the code alone:

- **External constraints aren't visible in the diff.** The service-worker-owns-all-fetches pattern (ADR 0003) looks like an architectural preference, but it's actually forced by how Chrome MV3 handles service worker lifetimes and by DegreeWorks' CORS allowlist (ADR 0016). A reader skimming the code would not know which choices were taste and which were non-negotiable.
- **The interesting part is the alternatives we rejected.** Every ADR lists at least two paths we considered and didn't take, with specific reasons. A reader asking "why didn't you just…?" gets the answer in the document, not from digging through commit history or asking the original author.
- **Some decisions got revised.** ADRs 0013 and 0014 each have "Revisited" sections documenting refactors we shipped after live testing surfaced problems with the original design. ADRs 0003 and 0011 were amended or extended by later ADRs. Keeping the old decision readable alongside its revision is more honest than silently rewriting the record.
- **Documentation that cites the code and gets cited by it.** Every source file that implements an ADR carries a `// Implements: ADR NNNN` header. Running `grep -rn "Implements: ADR 0013" src/` gives the full map of where the two-tier curator lives in code. Decisions and implementation point at each other, with no drift.

## How to read them

Each ADR follows a consistent structure. The sections are:

- **Context** — the problem, what forced a decision, which external constraints were in play.
- **Decision** — the chosen path, stated plainly.
- **Alternatives considered** — usually three or four. This is the most load-bearing section; skip it and you miss the reasoning.
- **Consequences** — what the decision locks in, what it opens up, what risk it accepts.
- **Revisit if** / **Revisited — YYYY-MM-DD** / **References** — optional sections for follow-up triggers, after-the-fact revisions, and external links.

Status lines at the top tell you whether an ADR is still authoritative on its own or whether a later record modifies it. For example, `Accepted · Amended by ADR 0016 for POST endpoints` means ADR 0016 carves out a scope narrower than the original claim.

For a narrative pass through the whole decision arc, read them in numerical order. For a quicker read, the one-liners in the Index below will tell you which ADR to dig into for a specific topic.

> **A note on `notes/degreeworks-api-reference.md`.** Several ADRs cite it. It's a working document — a reverse-engineered map of Ellucian's DegreeWorks and Banner request/response shapes, assembled from the browser's own Network tab while building. It is **not published in this repo**. Nothing in it is secret (any student with DevTools open sees the same traffic) and it holds no PII, but a turnkey map of a university's internal endpoints isn't ours to hand out. The ADRs that cite it stand on their own; the reference only adds field-level detail.

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| [0001](./0001-fork-registration-helper-drop-python.md) | Fork NickTrinh/registration-helper and drop the Python approach | Accepted | 2026-04-13 |
| [0002](./0002-degreeworks-json-api-not-html-scraping.md) | Use DegreeWorks JSON API instead of scraping the HTML DOM | Accepted | 2026-04-14 |
| [0003](./0003-service-worker-owns-api-calls.md) | Service worker owns all third-party API calls; content scripts are thin taps · Amended by 0016 for POST endpoints | Accepted | 2026-04-14 |
| [0004](./0004-cookie-auth-credentials-include.md) | Cookie-based auth via `credentials: "include"` (no manual token handling) | Accepted | 2026-04-14 |
| [0005](./0005-dispatch-on-symbolic-name-not-numeric-nodetype.md) | Dispatch on symbolic `.name` / `.ruleType`, not numeric `nodeType` | Accepted | 2026-04-14 |
| [0006](./0006-unified-post-audit-for-whatif-and-lookahead.md) | Unified POST `/api/audit` for What-If (and Look-Ahead) | Accepted | 2026-04-14 |
| [0007](./0007-reverse-map-attribute-taxonomy-from-rule-tree.md) | Reverse-map Fordham's ATTRIBUTE taxonomy from the audit rule tree | Accepted | 2026-04-14 |
| [0008](./0008-banner-term-bind-and-term-wide-pagination.md) | Banner session-bind dance + term-wide pagination (not per-subject filters) | Accepted | 2026-04-14 |
| [0009](./0009-pii-boundary-at-renderer.md) | Safe-by-construction PII boundary at the audit-to-text renderer | Accepted | 2026-04-15 |
| [0010](./0010-prompt-caching-at-system-breakpoint.md) | Prompt caching at the system-prompt breakpoint | Accepted | 2026-04-15 |
| [0011](./0011-background-extractor-memory-curator.md) | Background-extractor memory curator (two-model pattern) · Extended by 0013 (two-tier split) | Accepted | 2026-04-15 |
| [0012](./0012-routing-table-memory-index.md) | Routing-table memory index with `recall_memory` tool (MemGPT-style paging) | Accepted | 2026-04-15 |
| [0013](./0013-two-tier-memory-curator.md) | Two-tier memory curator (hard facts + provisional interests) · Revisited 2026-04-17 | Accepted | 2026-04-15 |
| [0014](./0014-onboarding-intake-mode.md) | Onboarding intake mode with `save_memory` tool · Revisited 2026-04-18 | Accepted | 2026-04-15 |
| [0015](./0015-memory-source-attribution.md) | Memory source attribution (verbatim "you said: ..." quotes) | Accepted | 2026-04-17 |
| [0016](./0016-cors-carveout-for-whatif-proxy.md) | CORS carveout: proxy What-If POST through the DegreeWorks tab · Amends 0003 | Accepted | 2026-04-19 |
| [0017](./0017-retrospective.md) | Retrospective — what we'd keep, what we'd rebuild, what surprised us | Accepted | 2026-04-21 |
| [0018](./0018-anonymized-fixtures-offline-test-loop.md) | Committed anonymized fixtures + offline test loop (PII boundary machine-checked) | Accepted | 2026-07-07 |
| [0019](./0019-tool-registry-agent-layer-decomposition.md) | Tool registry + agent-layer decomposition · Amends 0003 | Accepted | 2026-07-07 |
| [0020](./0020-split-cache-breakpoints-volatile-last.md) | Split cache breakpoints; volatile context after the last breakpoint · Amends 0010 | Accepted | 2026-07-08 |
| [0021](./0021-mv3-keepalive-and-failure-surfacing.md) | MV3 keepalive for post-stream work + tool-cap/truncation surfacing | Accepted | 2026-07-08 |
| [0022](./0022-catalog-full-replace-single-term.md) | Course catalog is a full-replace, single-term store · Constrains multi-term | Accepted | 2026-07-08 |
| [0023](./0023-weekend-meeting-days.md) | Weekend meeting days (Saturday / Sunday) · Fixes the 0008 day mapping | Accepted | 2026-07-08 |
| [0024](./0024-the-annotated-worksheet-not-a-chat-app.md) | The annotated worksheet, not a chat app (batched visual redesign) · Lands 0028's Alt B | Accepted | 2026-07-09 |
| [0025](./0025-dark-mode-is-a-token-split-not-an-inversion.md) | Dark mode is a token split, not an inversion (maroon fills; `maroon.ink` writes) | Accepted | 2026-07-09 |
| [0026](./0026-system-events-never-speak-in-the-advisors-voice.md) | System events never speak in the advisor's voice (`<Notice>`) · Cites 0028, renders 0029 | Accepted | 2026-07-09 |
| [0027](./0027-serialize-and-generation-guard-memory-writes.md) | Serialize memory writes and guard them with a store generation · Applies 0003 | Accepted | 2026-07-09 |
| [0028](./0028-only-conversational-turns-enter-the-prompt-path.md) | Only conversational turns enter the prompt path · Hardens 0010/0020 · Revisited (`uiOnly` deleted) | Accepted | 2026-07-09 |
| [0029](./0029-an-expired-banner-session-is-a-typed-error.md) | An expired Banner session is a typed error, not a SyntaxError | Accepted | 2026-07-09 |
| [0030](./0030-exactly-one-terminal-event-from-the-turn-that-owns-the-spinner.md) | Exactly one terminal event, from the turn that owns the spinner | Accepted | 2026-07-09 |
