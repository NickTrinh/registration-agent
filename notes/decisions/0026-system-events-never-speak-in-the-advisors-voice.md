# 0026 — System events never speak in the advisor's voice

- **Status**: Accepted
- **Date**: 2026-07-09
- **Related**: cites 0028 (prompt-path half of the same boundary); renders 0029's typed expiry;
  supersedes the pastel alert-card pattern

## Context

A network failure rendered as the advisor saying `Error: 401 authentication_error` — a plain
assistant bubble, in the advisor's position and typography. Tool-cap and truncation notices were
injected as markdown into the advisor's own streamed prose. Catalog failures dumped raw provider
strings (`Unexpected token '<'`) into a red card with no recovery path.

ADR 0028 fixed the *correctness* half of this: system text no longer re-enters the prompt path
(`uiOnly` / `conversationalOnly()`). This ADR is the *presentation* half of the same boundary.
The advisor's credibility is the product's core asset — it tells a student whether they graduate
on time. Every stack trace delivered in its voice spends that credibility. And the student needs
the opposite signal: *this is the plumbing talking, not your advisor; your advisor didn't break.*

The second forcing function: failure modes were multiplying (DegreeWorks expiry, Banner expiry
per 0029, API errors, tool caps, truncation), each acquiring bespoke UI — four pastel alert hues
in a 320px column, plus a **permanent green card** announcing that nothing was wrong.

## Decision

One `<Notice>` component owns every system event: severity (`info | warn | error`), a title in
our words, an optional mono `body` where raw provider text is **quoted, never spoken**, at most
**one action**, and optional dismiss. Two placements — ambient (standing conditions) and
turn-scoped (anchored under the turn that failed). Visual: a 2px left rule in the severity color
on a transparent fill; no pastel cards. The severity families differ in their *action*, not their
prose — a DegreeWorks expiry sends you to DegreeWorks, a Banner expiry to Browse Classes (0029's
`recoveryUrl`), an opaque failure sends you nowhere and says so. Design around the slot.

## Alternatives considered

### Alternative A: keep the error bubble, style it red

Cheapest diff. Rejected: position and shape are voice — a red bubble in the assistant slot is
still the advisor speaking, and the message stays in `messages`, exactly the attractive nuisance
0028's "Revisit if" warns about.

### Alternative B: severity-colored alert cards (status quo)

amber-50/red-50/blue-50/green-50 filled cards. Rejected: four hues carry a taxonomy no student
needs, the filled-card treatment is louder than the advisor's own answers, and it imposed no
action discipline — cards accumulated prose instead of recoveries.

### Alternative C: toasts for errors

Reuse the existing toast channel. Rejected: toasts are transient by design; an error whose
recovery is "go log in to Banner" must persist until acted on or dismissed. Toasts stay for
fire-and-forget confirmations only.

## Consequences

- Every future failure mode is a Notice row — severity, sentence, action — not new UI.
- When chat-stream errors move out of `messages` into Notices, 0028's `uiOnly` flag loses its
  only user and **must be deleted with that change**, per 0028's own revisit clause.
- Raw provider text is always visually distinguishable (mono, quoted) from our sentences.
- Accepts a constraint: recoveries must be expressible as *one* action. A failure needing a
  two-step recovery has to either sequence its Notices or fix its API, and that pressure is
  intentional.
- `role="alert"` for errors, `role="status"` otherwise — announcement severity tracks visual
  severity for free.

## Revisit if...

- A real failure mode genuinely needs two actions (not one action plus prose).
- Notices start being used for non-system content (tips, upsells) — that's voice creep in the
  opposite direction and grounds to split the component.

## References

- ADR 0028 (prompt path), ADR 0029 (typed Banner expiry + `recoveryUrl`), ADR 0021 (tool-cap /
  truncation surfacing).
- Implemented in `src/sidebar/components/Notice.tsx`; first consumers in `Settings.tsx`.
