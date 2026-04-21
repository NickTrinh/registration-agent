# 0006 — Unified POST `/api/audit` for What-If (and Look-Ahead)

- **Status**: Accepted
- **Date**: 2026-04-14
- **Session**: [`_ops/journal/2026-04-14.md`](../../../../_ops/journal/2026-04-14.md)
- **Related**: depends on 0002 (JSON API) and 0003 (service-worker ownership)

## Context

DegreeWorks surfaces three features in the UI that each return "an audit" and that a naive API explorer would expect to map to three distinct endpoints:

1. **Regular audit** — recompute the student's audit against their current curriculum. Fired on page load or when the "Process New" button is clicked on the main worksheet.
2. **What-If audit** — "what would my audit look like if I swapped in this major / minor / concentration / college?" Different worksheet tab in DegreeWorks UI.
3. **Look-Ahead audit** — "what would my audit look like if I add these hypothetical courses I haven't taken?" Another worksheet tab. The `SDLOKAHD` role in Patch's JWT proves it's enabled for his account.

Discovery: the regular audit is `GET /api/audit?studentId=...&school=U&degree=BS&...` with a custom vendor media-type Accept header (`application/vnd.net.hedtech.degreeworks.dashboard.audit.v1+json`). What-If was captured live on 2026-04-14 via the Network tab while the user swapped Neuroscience → Psychology. Surprise: the request is a `POST` to *the same path* (`/api/audit`, no query string) with plain `application/json` Accept — no vendor media type — and a JSON body:

```json
{
  "studentId": "A20000000",
  "isIncludeInprogress": true,
  "isIncludePreregistered": true,
  "isKeepCurriculum": false,
  "school": "U",
  "degree": "BS",
  "catalogYear": "2024",
  "goals": [
    { "code": "MAJOR",   "value": "PSYC", "catalogYear": "" },
    { "code": "COLLEGE", "value": "FC",   "catalogYear": "" }
  ],
  "classes": []
}
```

The server responded with the same top-level audit shape as the GET, but `auditHeader.whatIf: "Y"` and the `blockArray` rewritten to reflect the hypothetical major. `goals: []` is the empty/identity for curriculum overrides; `classes: []` is the empty/identity for hypothetical courses. Populating either (or both) expresses any of the three modes — regular (empty arrays, `isKeepCurriculum: true`), What-If (goals populated), Look-Ahead (classes populated).

## Decision

Implement one `fetchWhatIfAudit(studentId, goals, opts)` function in the JSON client. Parameters:

- `goals`: major/minor/college/concentration overrides (What-If use case)
- `opts.classes`: hypothetical courses to overlay (Look-Ahead use case)
- both populated: combined what-if-plus-look-ahead in a single call

The response shape is identical to the regular audit response; `auditHeader.whatIf: "Y"` is the unified marker the parser reads to distinguish. The Anthropic tool belt gets one `run_what_if_audit` tool that wraps this.

## Alternatives considered

### Alternative A: Three separate client functions, one per UI feature

Wasted effort and factually wrong — the server is treating this as one operation parameterized by the body. Three clients would duplicate all the headers, credentials, parsing, and error handling scaffolding for no capability difference. If Ellucian ever adds a fourth what-if mode (catalog year rollback, common request), the unified design absorbs it by adding a field; the split design requires a new function.

### Alternative B: Block implementation on a live Look-Ahead capture

Tempting for correctness — just open the Look-Ahead tab in DegreeWorks and capture the real request. But the user reported the Look-Ahead tab wasn't visible in their DegreeWorks UI (possibly Fordham UI-disabled despite the `SDLOKAHD` role), which would have blocked capture indefinitely. Given the strongly-inferable body shape (the existing `classes: []` field is the obvious populate-me slot) and the 3-day deadline, shipping the guess and testing in minutes is better than blocking on a capture we might never get.

### Alternative C: Skip Look-Ahead entirely as an MVP scope cut

Rejected because Look-Ahead is ~0 incremental code once What-If exists — populating an array that's already in the body. The scope-cut would save nothing and lose a demo-ready feature.

## Consequences

**One-line combined call** for "what if I switched to Psychology AND added CISC 4090?" — a capability no other Fordham advising tool has. The What-If Anthropic tool becomes a two-line wrapper over `fetchWhatIfAudit()`. The Look-Ahead Anthropic tool is a second two-line wrapper that populates `classes` instead of `goals`, sharing the same backend client.

**Closes another Known-Unknown** from the API reference (What-If endpoint shape). Look-Ahead remains listed but is downgraded from "unknown endpoint" to "unknown body shape, strongly inferred" — a much smaller risk.

**Accepts that Look-Ahead has been inferred, not live-captured.** Mitigation is a single test on Day 2 of the sprint: `fetchWhatIfAudit(studentId, [], { classes: [{discipline: "CISC", number: "4090"}], isKeepCurriculum: true })`. Expected outcome: same response shape with the hypothetical course applied to a rule. If the server rejects the body, the error message identifies the missing field and we fix in minutes.

**Two different Accept headers for the same path.** The GET uses `application/vnd.net.hedtech.degreeworks.dashboard.audit.v1+json`; the POST uses plain `application/json`. This is an Ellucian quirk documented in the reference — any developer building the client must remember it or the GET silently fails.

## References

- [`notes/degreeworks-api-reference.md`](../degreeworks-api-reference.md) — "⭐ What-If audits" section has the full request/response documentation and a ready-to-paste `fetchWhatIfAudit()` sketch.
- Live capture (cURL) from 2026-04-14 DegreeWorks Network tab — not committed (contains JWT).
