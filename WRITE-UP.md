# Fordham Registration Helper — Submission Write-Up

**Team Gradient**: Patch Shields, Nick Trinh, Paromita Talukder
**Competition**: Fordham AI Solutions Challenge 2026
**Repository**: [`github.com/NickTrinh/registration-agent`](https://github.com/NickTrinh/registration-agent)

---

## Problem

Generic AI assistants students use independently hallucinate course numbers, meeting times, and requirement interpretations that do not match Fordham's live catalog. Academic advisors are scarce and meetings are often scheduled too late in the registration cycle to be decision-shaping. Students still have to plan.

The recurring task this extension automates is the pre-advisor-meeting scramble thousands of Fordham students run every registration cycle. Reading through DegreeWorks requirements and classes, even ones often not even offered, then looking up sections by hand in Banner, checking prerequisites, cross-referencing whether a course satisfies a specific requirement. The friction is information-asymmetry: the student has the requirements, the institution has the catalog and rule engine, and neither party has the interface that brings them together in real time in a way that efficiently supports course planning.

## Solution

The Fordham Registration Helper is a Chrome extension (Manifest V3) that opens as a side panel alongside the DegreeWorks portal. It reads the live audit through DegreeWorks' JSON API, strips PII at a safe-by-construction boundary, and grounds every response from Claude Sonnet in the student's real audit plus live Banner section lookups. Six tools are exposed to the model — catalog search, attribute taxonomy lookup, memory recall/save/forget, and a live What-If audit — and a persistent long-term memory store with verbatim-quote attribution remembers facts across sessions.

A student asks *"what should I take next semester to finish my bioinformatics minor?"* and the response is grounded in their actual open sections — specific CRNs, available seats, meeting times, prerequisite conflicts — not made-up course codes. Ask *"what if I switched my major to psychology?"* and the response describes the real audit that would result, block by block, pulled from Fordham's own audit engine. The student gets grounded planning with zero wait time and no hallucinations; the advisor gets students who arrive at meetings already oriented; the institution gets an AI deployment with no server-side data storage and no new PII leaving the student's browser.

## A personal note

*I'm one of the few systems/computational neuroscience majors at Fordham, and my experience has shaped this project more directly than the rest of this write-up suggests. My major is small and specialized enough that most advisors I've worked with haven't been equipped to help me plan around its specific requirements. Between that and a dense curriculum, I've overloaded my semesters more than once and missed classes that would have satisfied requirements earlier, leaving my later years crammed instead of free for the electives I actually wanted or needed to take.*

*The moment I knew this tool worked was during testing. I pointed it at my own live DegreeWorks and asked it to suggest next-semester courses. It surfaced classes I had glanced past during my own registration this year — classes I should have taken, and would have, if I'd seen how cleanly they fit my requirement shape. I was surprised, and a bit disheartened, the tool solves a problem I've been stuck with for three years. If it had existed my freshman year, my plan would have been much clearer and the stress of having no direction would have diminished early on.*

*The memory architecture in particular is something I've been turning over for months: a two-model curator pattern where a small model decides what to save and a large model consumes the resulting index. This kind of architecture shows up in MemGPT (Packer et al., 2023) and the DeepSeek V3.2 gating-network paper. Interpretable Context Methodology (Van Clief & McDermott, 2026), which I use in my own research workflow, inspired the specific memory and context shape I landed on here. Building out my first working version of this design was one of the most rewarding parts of the project; the full reasoning is in ADRs 0011 and 0012.*

*— Patch*

## Evaluation

**Tangible value.** The magic moment described above — finding classes that satisfied requirements I had overlooked — is repeatable. Any student with complex degree requirements (multiple majors, minors, concentrations, catalog-year overrides) is carrying around missed opportunities of this shape. The tool's primary value is surfacing them at the moment of registration rather than years later, with no new task required from the student beyond asking a question.

**Automation of a recurring task.** Every registration cycle, thousands of Fordham students prepare for advisor meetings by hand — reading requirements, looking up sections, checking prerequisites, cross-referencing attributes. This extension compresses that 30-60 minute manual process into a two-minute conversation grounded in the same live data the advisor would reference.

**Evidence of engineering discipline.** The repository captures sixteen shaping decisions plus a retrospective, each with rejected alternatives explicitly listed. Prompt caching is verified directly in service-worker logs during normal chat. Multiple end-to-end test sessions in the final week surfaced and fixed real issues, e.g. concentration sub-requirement rendering for the Subset rule type, the What-If CORS gate, scroll-lock fighting auto-scroll during streaming, and onboarding save duplication, each traced to a specific root cause and fixed before submission.

## Technical approach

The project started as a server-side Python prototype. Three weeks before the demo it became clear the Python path would spend all its time on plumbing problems — institutional SSO, a hosted web UI, a catalog ingest pipeline — rather than the AI integration itself. [ADR 0001](notes/decisions/0001-fork-registration-helper-drop-python.md) documents the pivot. We forked off of the original Chrome extension scaffold and rebuilt the AI integration against the browser surface we already had. Every shaping decision that followed is captured as an ADR (Architecture Decision Record) with rejected alternatives explicitly listed — sixteen records plus a retrospective, browsable at [`notes/decisions/`](notes/decisions/).

### Architecture

DegreeWorks' worksheet is a React SPA with an empty initial DOM, so HTML scraping returns nothing. Network inspection surfaced a JSON audit endpoint with a vendor media type (`application/vnd.net.hedtech.degreeworks.dashboard.audit.v1+json`) that is strictly richer than any rendered view and authenticated by session cookies the student already has ([ADR 0002](notes/decisions/0002-degreeworks-json-api-not-html-scraping.md), [ADR 0004](notes/decisions/0004-cookie-auth-credentials-include.md)). All third-party fetches run from a single-owner service worker ([ADR 0003](notes/decisions/0003-service-worker-owns-api-calls.md)); content scripts are reduced to ~10-line message relays. A few days before submission the What-If POST began returning `403 "Invalid CORS request"`, where Ellucian's server-side Origin allowlist rejected POSTs from `chrome-extension://` origins, even though GETs pass. [ADR 0016](notes/decisions/0016-cors-carveout-for-whatif-proxy.md) documents the fix, which is a targeted `chrome.scripting.executeScript` proxy that runs the POST from the student's existing DegreeWorks tab, inheriting page Origin.

### Safety and privacy

Every DegreeWorks audit response contains the student's full name, Banner ID, and advisor email. [ADR 0009](notes/decisions/0009-pii-boundary-at-renderer.md) imposes a safe-by-construction PII boundary, i.e. the audit-to-text renderer is structured so it *cannot* read those fields, the emission logic does not reference them. Placeholder tokens (`[NAME]`, `[ADVISOR]`, `[ADVISOR_EMAIL]`) flow through Claude and the sidebar substitutes real values client-side at render time. PII leakage to the model is prevented by construction, not by discipline, so adding new features that touch audit text never requires a new privacy audit. [ADR 0010](notes/decisions/0010-prompt-caching-at-system-breakpoint.md) layers prompt caching on top, so the service-worker logs report `cache_read_input_tokens: 3718` from turn two onward and the bulk of the system prompt hits cache on every subsequent turn.

### Memory

A two-tier Haiku curator ([ADRs 0011–0013](notes/decisions/)) extracts durable facts after each chat turn: hard facts save immediately, and soft signals accumulate in a provisional store and are potentiated at threshold. Memory is routed, not injected, so Sonnet sees a one-line index entry per memory and calls `recall_memory` to page in full content on demand ([ADR 0012](notes/decisions/0012-routing-table-memory-index.md)). Onboarding intake mode solves the cold-start problem on first launch ([ADR 0014](notes/decisions/0014-onboarding-intake-mode.md)). Furthermore, source attribution stores a verbatim student quote below every memory entry, editable and deletable from Settings ([ADR 0015](notes/decisions/0015-memory-source-attribution.md)), so students always have control of what the system has learned about them and why.

## Scaling

The technical path to institutional adoption is short. Running costs are approximately $0.02–0.05 per student session on the student's own Anthropic API key (roughly $5 spent total across two weeks of testing). The institution bears no per-user cost: all Anthropic spend stays with the individual student. Deployment would move the extension from GitHub to the Chrome Web Store with no major source changes, and a shared or student-funded API-key model is straightforward to support. No new server-side data storage is introduced, so there is no new compliance surface to negotiate with Fordham IT — the existing PII posture ([ADR 0009](notes/decisions/0009-pii-boundary-at-renderer.md)) is the full story.

DegreeWorks and Banner are Ellucian products used at hundreds of US universities. The API shapes we reverse-engineered are standardized across institutions, which means the same architecture could be deployed at other Ellucian-customer schools with minimal rework — the integration surface is the vendor's, not Fordham-specific.

**Natural next extensions:**

- **Multi-term planning.** A graduation-path simulator that rolls What-If across several terms at once.
- **Advisor-facing tools.** Pre-meeting briefs summarizing student state and open questions; flagging students who haven't registered yet.
- **Cross-device memory sync.** Currently bound to a single Chrome profile; extending to multi-device is a storage migration, not an architectural one.

## Limitations

- **Single-student scope.** No advisor-facing integration yet.
- **Memory cap.** Fifty entries per student; heavy users would eventually need a paging or archival strategy.
- **What-If requires an open DegreeWorks tab** (per the CORS carveout in [ADR 0016](notes/decisions/0016-cors-carveout-for-whatif-proxy.md)) — surfaced cleanly as a "please open DegreeWorks" tool result, but less seamless than auto-opening the tab on demand.
- **ADR 0007 (ATTRIBUTE taxonomy reverse-mapping) is accepted but not yet implemented.** The extension works without it; the implementation is a straightforward rule-tree walk we didn't ship this cycle.

## Team

**Team Gradient** — Patch Shields ([@pqtch](https://github.com/pqtch), architecture and implementation), Nick Trinh ([@NickTrinh](https://github.com/NickTrinh), upstream scaffold and review), Paromita Talukder ([@BlazedDonuts](https://github.com/BlazedDonuts), review and testing).

---

## Appendix — where to find what

| Looking for | Go to |
|---|---|
| ADR register (the reasoning behind every shaping decision) | [`notes/decisions/`](notes/decisions/) |
| DegreeWorks API reference (reverse-engineered) | [`notes/degreeworks-api-reference.md`](notes/degreeworks-api-reference.md) |
| Demo walkthrough | [`notes/TESTING.md`](notes/TESTING.md) |
| The PII boundary in code | [`src/background/agent/degreeworks-audit-to-text.ts`](src/background/agent/degreeworks-audit-to-text.ts) |
| The CORS carveout proxy | [`src/background/agent/degreeworks-api-client.ts`](src/background/agent/degreeworks-api-client.ts) (`fetchWhatIfAudit`) |

---

*For use with your own Fordham account. Not affiliated with Fordham IT or Ellucian.*
