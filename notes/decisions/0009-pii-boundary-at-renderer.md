# 0009 — Safe-by-construction PII boundary at the audit-to-text renderer

- **Status**: Accepted
- **Date**: 2026-04-15
- **Related**: depends on 0002 (JSON API supplies the PII); runs under 0003 (worker owns the fetches)

## Context

Every DegreeWorks audit response carries personally identifying data: Banner student ID (`studentId`), full name (`auditHeader.studentName`, format `"Student, Sample A."`), advisor name and email (`goal.advisorName` / `goal.advisorEmail`), plus nested fields in the rule tree. Fordham's Third-Party Data Transfer Policy prohibits transmitting these fields outside the university's systems. The extension sends audit text to Anthropic on every chat turn — unambiguously a third-party transfer — so the audit payload crossing that boundary must be PII-free.

The question isn't *whether* to strip PII. It's *where* to strip it, and *how* to make the strip unmissable. Any enforcement scheme that depends on programmer discipline ("remember to scrub before sending") is one forgotten code path away from a compliance violation. The extension has multiple places where audit text could be logged or transmitted: the chat-loop system prompt, the Haiku profile-extractor prompt, the memory-curator prompt, DevTools logs, error messages. Each new code path is a new opportunity to leak.

We needed a design where PII compliance is a property of TYPES, not of VIGILANCE.

## Decision

Make `src/background/agent/degreeworks-audit-to-text.ts` the single enforcement point. The renderer emits literal placeholder tokens (`[NAME]`, `[ADVISOR]`, `[ADVISOR_EMAIL]`) instead of reading identifying fields from the audit. It deliberately **does not read** `h.studentName`, `g.advisorName`, or `g.advisorEmail`. The rendered text is PII-free by construction: the renderer cannot emit what it never reads.

The sidebar chat view substitutes real values at RENDER time from `chrome.storage.local` (written by the worker during `refreshAudit` from fields never transmitted to Anthropic). Claude sees the literal tokens in context, echoes them verbatim in responses, and the React chat view's `personalize()` function swaps them for real values when painting the DOM. The real name never crosses the Anthropic wire.

Secondary invariant: every file that processes audit text downstream can trust its input is PII-free because it came from this renderer.

## Alternatives considered

### Alternative A: Scrub PII right before sending to Anthropic

Insert a scrubbing pass in the chat loop, immediately before `client.messages.stream(...)`. Rejected because "right before sending" is the LAST opportunity to catch a leak, not the first. Every new code path that hits Anthropic (profile extraction, memory curator, future what-if explainer) would need its own scrub pass or its own audit. The number of enforcement sites scales linearly with features, and missing one is a silent compliance failure with no runtime signal.

### Alternative B: Trust the LLM to follow a "don't repeat PII" instruction

Rejected on two grounds. First, LLMs are not reliable PII filters — "don't repeat X" instructions are the weakest form of alignment. Second, and more important, Fordham's policy prohibits TRANSMISSION of PII, not just ECHO. The moment audit text containing a student's Banner ID reaches Anthropic's servers, the violation has occurred regardless of whether Claude chooses to quote it. Prompt-level mitigations address the wrong layer entirely.

### Alternative C: Regex scrubber over the rendered text

Post-process the rendered audit: match and replace names, emails, Banner IDs. Rejected because regex is a race against adversarial content. Hyphenated last names, non-ASCII characters, email addresses with plus-addressing, nicknames in parens — every edge case is a new regex or a missed redaction. Safe-by-construction > detect-and-remove.

### Alternative D: Inline substitution without named tokens

Just replace `h.studentName` with "the student" in the renderer, without emitting a token. Rejected because the sidebar needs a way to RESTORE the real name in the rendered chat bubble so the conversation feels personal. The token (`[NAME]`) is the stable handle both ends agree on. Without it, there's no way to personalize responses after they return from Anthropic.

## Consequences

**Exactly one file to audit for compliance**: `degreeworks-audit-to-text.ts`. A grep for `studentName`, `advisorName`, or `advisorEmail` in that file must return zero hits. This is a 60-second manual review (or CI check) and it covers the entire third-party transfer surface of the extension.

**Downstream files can trust their input**: every caller of `auditResponseToText()` can assume the returned string is PII-free. No defensive scrubbing required at consumer sites. `service-worker.ts`, `memory-curator.ts`, the profile-extraction prompt — all consume already-clean text without needing to know anything about compliance.

**Claude's responses are visually correct**: when a response says "Hi [NAME], based on your audit..." the sidebar's `personalize()` function substitutes the real first name at paint time, stored in `chrome.storage.local` from `studentFirstName` (which is written by the worker from `auditHeader.studentName` during `refreshAudit` — the only place the name is ever read). The chat feels personal without identifying data ever leaving the extension.

**Substitution failure is graceful**: if `studentFirstName` is null (e.g. name parsing failed on an unusual format), `personalize()` falls back to "you" for `[NAME]`, "your advisor" for `[ADVISOR]`, and "advisor email not provided" for `[ADVISOR_EMAIL]`. Worst case is slightly stilted English, not a PII leak.

**One UX quirk accepted**: the profile extractor (Haiku) also sees the literal `[NAME]` token in its input and carries it through to the extracted profile. We pass the profile back into Sonnet's system prompt as-is — substitution happens in the chat renderer, not in the storage layer. Claude never operates on real names at any stage, not even through the profile.

**Easy to extend**: adding a new identifying field (e.g. date of birth, home address) means adding a new token (`[DOB]`), a new substitution in `personalize()`, and a new "do not read" note at the top of the renderer. Three small changes, all at well-known sites.

## Trust boundary (and what this ADR does NOT cover)

The renderer assumes its input — the raw DegreeWorks audit response — is from a trusted source (Fordham's production DegreeWorks instance). It does NOT sanitize the audit content for prompt injection. Fields like course titles, block descriptions, rule labels, and advisor-entered notes pass through unchanged to Sonnet's system prompt.

This is acceptable because Fordham controls DegreeWorks end-to-end: the only parties who can write to audit fields are the Registrar, faculty advisors, and the degree-audit system itself. There is no known path for an external actor (including the student) to inject text that lands in our system prompt.

**If we ever ingest external data** — RateMyProfessor, student-submitted schedule notes, Fordham subreddit posts — we would need a new ADR covering input sanitization for those sources specifically. The current trust boundary is: `DegreeWorks = trusted; Banner = trusted; anything else = untrusted`.

## Revisit if...

- A new audit field is added to the renderer without first being audited as PII / non-PII.
- Fordham's policy is updated to require transmission-layer encryption in addition to content-layer redaction.
- Anthropic publishes a verified PII-redacting middleware that would let us simplify the renderer.

## References

- [`src/background/agent/degreeworks-audit-to-text.ts`](../../src/background/agent/degreeworks-audit-to-text.ts) — the renderer, carrying a prominent PII comment in its header.
- [`src/sidebar/pages/AuditChat.tsx`](../../src/sidebar/pages/AuditChat.tsx) — the `personalize()` function that does token substitution at render time.
- Fordham Third-Party Data Transfer Policy (internal; consult the Office of Information Security).
