# 0017 — Retrospective

- **Status**: Accepted
- **Date**: 2026-04-21
- **Related**: Covers ADRs 0001–0016

## Context

The other sixteen ADRs each capture a single decision in the moment — what we chose, what we rejected, why it mattered then. This one is different in kind. It looks back across the whole decision arc and asks: *what would we keep, what would we rebuild, and what did we not see coming?*

We wrote this because the ADRs as a set describe a credible architecture, but they don't describe the shape of our own mistakes. A reader picking up this repo should know where we'd bet differently a second time, not just where we bet correctly the first time.

## What we'd keep unchanged

**Invest a day in reverse-engineering before writing any client code.** The DegreeWorks JSON API (ADR 0002) and the Banner SSB session-bind dance (ADR 0008) are both cases where guessing at the protocol would have cost more than mapping it properly up front. Banner's stateful filter-commit model is not documented anywhere we could find; `GET /searchResults/searchResults` returns default data silently if you skip the `POST /term/search?mode=search` step first. A project that tried to build against guesses would have lost days to "why does every subject return the same sections?" We lost minutes, because the discovery session surfaced the answer before the client was written.

**A Chrome extension, not a web app** (ADR 0001). Piggybacking on the student's existing DegreeWorks session via `credentials: "include"` (ADR 0004) eliminated every hard problem that a web app version would have reopened: no SSO to intercept, no hosting, no credential storage, no privacy-policy fight with Fordham IT. The fact that the extension surface also happens to be a great demo format (open the tab, open the side panel, ask a question) was a bonus — the actual driver was "we don't have to solve auth."

**A type-level PII boundary** (ADR 0009). The `degreeworks-audit-to-text.ts` renderer deliberately does not *read* `studentName`, `advisorName`, or `advisorEmail`. It emits `[NAME]` / `[ADVISOR]` / `[ADVISOR_EMAIL]` tokens instead, and the sidebar substitutes real values client-side at render time. Every downstream file (profile extractor, memory curator, chat loop) can trust its input is PII-free *by construction*, because it came through the one file that can't produce PII. A scrub-right-before-send approach would have required re-auditing every call site whenever a new feature touched audit text. The single-enforcement-site design scales with the feature count at zero marginal vigilance cost.

**Writing ADRs alongside implementation, not before.** Every rejected-alternative paragraph in the sixteen records is sharper than it would have been retroactively. When a path is rejected two hours ago the reasoning is specific; when rejected two weeks ago it blurs into "we considered it but it didn't work out." We'd keep the cadence.

## What we'd rebuild

**Design the memory system as two-tier from day one.** ADR 0011 shipped a single-tier Haiku curator; two days later ADR 0013 split it into hard facts + provisional interests after testing revealed the single-tier couldn't tell "student stated a new fact" from "advisor restated audit data." The split is load-bearing — it's the whole reason the curator can extract soft signals (a student asking about theology three times) without hallucinating durable facts from them. We'd start with that structure instead of rediscovering the need two days after shipping. The revision is captured honestly in [ADR 0013](./0013-two-tier-memory-curator.md#revisited--2026-04-17), but the decision *could* have been right-first-time with a little more design patience up front.

**Commit anonymized fixtures to the repo.** We used a `notes/fixtures/*.real.*` gitignore pattern to keep real captured responses locally while excluding them from the repo. That kept the repo PII-free but meant every testing cycle required a fresh DegreeWorks login + audit fetch. A better pattern: structurally-identical fixtures with fabricated IDs and names, committed in plain view, driving a cheap offline test loop. We'd add this before the next feature cycle.

**Commit to the PII-token pattern earlier.** ADR 0009 was written on day 3, after the chat loop was already sending text that *could* contain real names if nothing intervened. We got lucky that the renderer was the first thing downstream of the audit fetch — had another file been reading `studentName` directly in between, the PII boundary would have been a compliance fix instead of a design choice. A first-week ADR on "how do we prevent PII from crossing the Anthropic wire?" would have made the same decision earlier and spent less time lucky.

## What surprised us

- **Banner's stateful session model.** `GET /searchResults/searchResults?txt_subject=CISC` returns a 200 OK with default data if you haven't first `POST /term/search?mode=search` to commit the term to session state. No error, no warning, no log — just silently wrong data, the kind of bug that burns hours. See [ADR 0008](./0008-banner-term-bind-and-term-wide-pagination.md).

- **DegreeWorks conflates CORS rejection with auth failure.** A 403 response with body `"Invalid CORS request"` turned out to be the Origin-allowlist check, not the authorization check. We spent a day chasing CSRF tokens, session priming calls, and JWT expiry before reading the 403 body closely enough to notice the smoking gun. See [ADR 0016](./0016-cors-carveout-for-whatif-proxy.md).

- **`ztcEncodedImage`.** Banner serves a 50 kB base64-encoded "Zero Textbook Cost" PNG badge on every section-search response, whether any section in the page is actually ZTC or not. Stored naively, it would dominate IndexedDB by an order of magnitude. We strip it before persisting.

- **Term code arithmetic runs opposite to intuition.** Banner's six-digit term codes use `YYYY + 10/20/30/40` for Fall/Spring/Summer/Winter — but `YYYY` is the academic year *ending*, not starting. So `202610` is Fall 2025, not Fall 2026. An earlier version of our API reference had this inverted, four places. Cross-referencing live class terms against their human-readable labels made the correct mapping unmissable.

- **An intuition about small-model routing turned out to match published research.** The two-model pattern in ADR 0011 (Haiku as a curator behind Sonnet) was something we arrived at independently — the intuition was "one small model decides what deserves to be remembered, the big model consumes the remembered index." Reading MemGPT, A-MEM, AgeMem, and the DeepSeek V3.2 gating-network paper afterward, the same structural move showed up in all of them. Convergence is a useful signal; it's not proof the design is right, but it's evidence that several people working independently landed in the same place.

## What we learned

- **Simplicity beats cleverness in several places and shipped faster for it.** We deleted a memory-consolidator we'd written once Jaccard dedup at write-time plus the curator's skip-if-exists rule turned out to cover 95% of what the consolidator did. We didn't build an embedding store; a routing-table index + LLM description-matching works. We didn't stand up our own server to proxy write endpoints; `chrome.scripting.executeScript` sidesteps CORS from a tab the student has open anyway. Each of these kept one less moving part in the critical path.

- **The "Revisited" section is a feature, not a bug.** ADRs 0013 and 0014 both have `## Revisited — YYYY-MM-DD` sections documenting substantial refactors of shipped designs. Traditionally that looks like "the original ADR was wrong." In practice, it looks like "we shipped, we tested, we found friction, we redesigned honestly." We'd use that pattern again freely.

- **Good documentation pays off compound.** Every source file that implements an ADR cites it (`// Implements: ADR NNNN`). Six weeks from now, grep `Implements: ADR 0013` will still give a complete map of where the two-tier curator lives in code. Zero infrastructure, zero drift — the citation is in the file the decision shapes.

- **Write the rejected alternatives in full.** The most valuable paragraph in almost every ADR is not the decision — it's the rejected path. Future readers asking "why didn't you just do X?" deserve an honest, specific answer in the record, not a "we considered it." The habit of listing three rejected alternatives with concrete reasoning was more useful than any other single convention we adopted.
