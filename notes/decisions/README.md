# Decision Records — Convention

This directory holds **ADRs** (Architecture Decision Records) for the registration-helper project. An ADR captures the *why* behind a shaping decision — what was on the table, what was rejected, what we locked in.

ADRs are the evergreen layer. They sit alongside two other documentation layers:

| Layer | Where | What it captures | Lifetime |
|-------|-------|------------------|----------|
| Commits | `git log` | What changed, line-level | Forever, but rarely re-read |
| Journals | Internal team notes (not shipped with this repo) | Day-by-day narrative — insights, dead ends, pivots | Project-scoped |
| **ADRs** | **this folder** | **Shaping decisions — what / why / alternatives** | **Project lifetime** |

Judges, new teammates, and future Claude sessions read the ADRs first. Journals are the messy process that feeds into ADRs once a decision crystallizes.

---

## When to write an ADR

Write one when:

- A decision shapes multiple files or multiple sessions downstream
- You rejected a plausible alternative (the rejection is the interesting part — it's what a judge or future teammate would ask about)
- A constraint came from outside the code (policy, deadline, data availability, an incident, a failed earlier approach)
- You'd want to explain the choice at a whiteboard

Don't write one for:

- Routine implementation (naming, file layout, minor refactors)
- Choices that reverse cheaply
- Anything a `git log` entry with a good commit body already captures

**Aim for roughly 5–10 ADRs per phase of work.** If you're writing 20, the bar is too low and the signal-to-noise tanks. If you're writing 2, you're probably missing shaping decisions worth capturing.

---

## How to write one

1. **Pick the next unused number.** Look at the highest `NNNN-*.md` file in this directory and add one. Numbers are sequential, permanent, and never reused — once an ADR is committed its number is the handle everyone refers to.
2. **Clone [`TEMPLATE.md`](./TEMPLATE.md)** to `NNNN-kebab-case-title.md`.
3. **Fill in the sections.** The template has inline guidance in HTML comments; they're fine to delete as you write.
4. **Add the row to the Index table below.**
5. **Commit with a body that references the ADR.** E.g. `feat: wire recall_memory tool (implements ADR 0003)`.

### Naming

- `NNNN-kebab-case-title.md` — four-digit zero-padded number, short noun phrase title
- Good: `0003-routing-table-memory-index.md`
- Bad: `memory.md`, `decision-about-the-curator.md`

### Format

Every ADR has these sections (see `TEMPLATE.md` for the scaffold):

1. **Header** — number, title, status, date, related ADRs
2. **Context** — what was the problem, what forced a decision now. 1–3 paragraphs.
3. **Decision** — what we chose, plainly stated. Usually the shortest section.
4. **Alternatives considered** — what was rejected and why. **The most valuable section** — at least 2 alternatives. If there was only one path, this isn't ADR-worthy.
5. **Consequences** — what this locks in, what it opens up, what risks it accepts.

Optional: **Revisit if...** (explicit triggers to reconsider), **References** (PRs, papers, related ADRs, external docs).

### Voice

- First-person plural ("we decided") is fine. Passive voice is not.
- Be specific about what was on the table. *"We considered MemGPT-style paging but rejected per-turn recall because..."* beats *"we looked at other approaches."*
- Keep it tight — about one page (~400–600 words). If an ADR sprawls past two pages, it's probably two decisions fused; split them.
- Don't hedge retroactively. If the decision turned out wrong, supersede the ADR with a new one rather than softening the old one.

### Status values

- **Proposed** — drafted but not yet implemented
- **Accepted** — implemented and in effect (the common case when ADRs are written alongside the work)
- **Superseded by NNNN** — replaced by a later ADR (include forward link)
- **Deprecated** — no longer relevant but kept for historical context

Most ADRs in this project are **Accepted** from the moment they're written because we write them alongside implementation, not before.

---

## Commit convention (paired with ADRs)

```
<type>: <subject, ≤60 chars>

<body, 1–3 sentences explaining WHY — what forced the change,
what was considered and rejected. Wrap at 72.>

<optional: implements ADR NNNN>
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`.

The body is required when the subject doesn't obviously explain the motivation. `chore: bump deps` doesn't need a body; `refactor: collapse toolEvents onto ConversationMessage` does.

When a commit implements (or partially implements) an ADR, cite it: `implements ADR 0003` or `partial: ADR 0003`. This gives `git log --grep` a reverse index from ADR number → commits.

---

## Cross-session workflow

This project runs across multiple Claude sessions. The convention is designed so both a fresh session and a returning session can orient themselves from the ADRs alone:

- **Fresh session** (no context from prior work) — read this README, then read every `NNNN-*.md` in order. The ADRs should reconstruct the architectural reasoning without needing chat history.
- **Returning session** (picking up where a prior session left off) — skim new ADRs since your last session; each one is a "catch me up" document for a specific decision.
- **Writing retroactively** — when a session realizes it made a shaping decision without documenting it, write the ADR before moving on. "Write it now or lose it" — the alternatives-considered section is always easiest to fill in while the rejection reasoning is still fresh.

If two sessions write ADRs in parallel and collide on a number, resolve by bumping the later one and updating its Index row. Numbers are cheap; the index table is the source of truth for assignment.

---

## Index

Living table of ADRs in this project. Add a row when you commit a new ADR. Sort by number ascending.

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

---

## Planned ADRs

Topics identified as ADR-worthy but not yet written. Numbers are assigned at write-time (next unused from the Index above), not pinned here. **Claim one by writing it** — delete its line from this list and add the corresponding row to the Index above.

- [ ] Single-writer service-worker pattern for all `chrome.storage.local` mutations (extends 0003)
- [ ] *(add more as you spot them — the `Planned` list is append-only until claimed)*
