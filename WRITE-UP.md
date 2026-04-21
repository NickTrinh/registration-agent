# Fordham Registration Helper — Submission Write-Up

**Team**: Patch Shields, Nick Trinh, Paromita Talukder
**Competition**: Fordham AI Solutions Challenge 2026
**Repository**: [`github.com/NickTrinh/registration-helper`](https://github.com/NickTrinh/registration-helper) · Branch: `submission/2026-04-19`
**Date**: 2026-04-19

---

## Problem

Every registration cycle, thousands of Fordham students have their DegreeWorks audit open in a browser tab. The audit tells them what they still need — incomplete core requirements, missing attributes, credits outstanding — but does not help them plan around those requirements. The fallbacks students actually reach for do not close the gap: generic AI assistants like ChatGPT confidently hallucinate course numbers, meeting times, and requirement interpretations that do not match Fordham's live catalog; advisor meetings are scarce, lossy, and often scheduled too late in the cycle to be decision-shaping. The core friction is information-asymmetry: the student has the requirements, the institution has the catalog and rule engine, and neither party has the interface that brings them together in real time.

## Solution

The Fordham Registration Helper is a Chrome Manifest V3 extension that opens as a side panel alongside the DegreeWorks SPA. On student interaction, it reads the live audit through DegreeWorks' JSON API, renders it to a PII-stripped plain-text representation, and grounds every response from Anthropic's Claude Sonnet in that real data plus live Banner section lookups. It exposes six tools to the model — catalog search, attribute taxonomy, memory recall/save/forget, and a live What-If audit — and maintains a persistent long-term memory store with verbatim-quote attribution so students can audit what the system remembers about them and why. The student gets grounded planning on demand with zero wait time; the advisor gets students who arrive at meetings prepared; the institution gets a privacy-respecting AI deployment that requires no server-side infrastructure and keeps student data on the student's own device.

## Technical approach

The project began as a server-side Python prototype. Three weeks out from the demo, it became clear that the Python path would spend its time on plumbing problems — institutional SSO, a hosted web UI, a catalog ingest pipeline — rather than the AI integration itself. **ADR 0001** documents the pivot: we forked an existing Chrome extension scaffold and rebuilt the AI integration against the browser surface we already had.

The first technical discovery drove the rest of the architecture. DegreeWorks' worksheet is a React SPA whose initial DOM is empty; HTML scraping returns nothing. Network inspection revealed a JSON audit endpoint with a vendor media type (`application/vnd.net.hedtech.degreeworks.dashboard.audit.v1+json`) that is strictly richer than any rendered view and available to every authenticated session. **ADR 0002** made the JSON API the canonical data source. **ADR 0003** placed all third-party fetches in the service worker, reducing content scripts to ~10-line thin taps. **ADR 0004** accepted that browser cookies + `credentials: "include"` replaces every custom auth flow we would otherwise have to build.

The most consequential safety decision was the PII boundary. Every DegreeWorks audit response contains the student's full name, Banner ID, and advisor email. **ADR 0009** imposes a safe-by-construction constraint: the audit-to-text renderer is structured so it cannot read those fields — the emission logic does not know they exist. Placeholder tokens (`[NAME]`, `[ADVISOR]`, `[ADVISOR_EMAIL]`) flow through Claude; the sidebar substitutes real values client-side at render time. PII leakage to the model is prevented by construction, not by discipline. On the cost side, **ADR 0010** introduces prompt caching at the system-prompt breakpoint; the service-worker logs report `cache_read_input_tokens: 3718` on turn 2 and beyond, meaning the bulk of the system prompt hits cache on every subsequent turn. The memory subsystem is layered: a two-tier Haiku curator extracts durable facts after each chat turn (**ADRs 0011–0013**); onboarding intake mode solves the cold-start memory problem (**ADR 0014**); memory source attribution stores a verbatim student quote below every entry, editable and deletable from the Settings panel (**ADR 0015**).

Three days before submission, the What-If audit endpoint began returning 403 from the service worker. Debugging stepped through CSRF, session-prime, and header-mismatch hypotheses before the 403 response body yielded the string `"Invalid CORS request"`. Ellucian's server-side Origin allowlist rejects POSTs from any `chrome-extension://` origin; GETs are permitted. **ADR 0016** documents the fix: we proxy the POST through the user's existing DegreeWorks tab via `chrome.scripting.executeScript({ world: "ISOLATED" })`, so the fetch runs with page Origin and passes the gate. The amendment to ADR 0003 preserves its service-worker-as-owner invariant for all read endpoints while scoping the carveout to Ellucian's Origin-allowlisted writes.

## Evaluation

The repository documents 16 shaping decisions as architecture decision records, each with rejected alternatives explicitly listed — ADRs are the audit trail for every non-trivial choice, so a reader can reconstruct the reasoning without digging through commit history. There are zero TODO markers in shipped source code. Prompt caching is verified directly in the service-worker logs during normal chat. Three end-to-end test sessions in the final 72 hours caught and fixed a range of real issues: concentration sub-requirement rendering for the Subset rule type, the What-If CORS gate (which required the proxy shipped in ADR 0016), prompt hardening to surface concentration-sibling requirements, a scroll user-lock bug that fought auto-scroll during streaming, and a missing toast entry animation whose root cause was an undefined Tailwind keyframe. Every fix landed as a commit with a body explaining the forcing function.

## Limitations and future work

The extension is a single-student tool. It does not integrate with advisor-facing systems, does not synchronize memory across devices, and requires the student to have a DegreeWorks tab open when running What-If (per ADR 0016's CORS carveout). The memory store is bounded to 50 entries per student; heavy users may hit this ceiling and would need a paging or archival strategy. The `run_what_if` dependency on a live tab means the extension silently refuses What-If requests when DegreeWorks is closed — handled with a targeted "please open DegreeWorks" tool result, but a more seamless solution would auto-open the tab on demand. The most natural extensions are multi-term planning (a full graduation-path simulator), advisor-facing tooling (pre-meeting briefs and flagged students), and cross-device memory synchronization. Each builds on the audit-and-catalog foundation without requiring institutional buy-in.

---

## Appendix — where to find what

| Looking for | Go to |
|---|---|
| ADR register (the reasoning behind every shaping decision) | [`notes/decisions/`](notes/decisions/) |
| DegreeWorks API reference (reverse-engineered) | [`notes/degreeworks-api-reference.md`](notes/degreeworks-api-reference.md) |
| Implementation plan + status | [`notes/IMPLEMENTATION-PLAN.md`](notes/IMPLEMENTATION-PLAN.md) |
| End-to-end testing guide | [`notes/TESTING.md`](notes/TESTING.md) |
| Post-audit fix register | [`notes/AUDIT-2026-04-16.md`](notes/AUDIT-2026-04-16.md) |
| The PII boundary in code | [`src/background/agent/degreeworks-audit-to-text.ts`](src/background/agent/degreeworks-audit-to-text.ts) |
| The CORS carveout proxy | [`src/background/agent/degreeworks-api-client.ts`](src/background/agent/degreeworks-api-client.ts) (`fetchWhatIfAudit`) |

---

*For use with your own Fordham account. Not affiliated with Fordham IT or Ellucian.*
