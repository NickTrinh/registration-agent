# 0025 — Dark mode is a token split, not an inversion

- **Status**: Accepted
- **Date**: 2026-07-09
- **Related**: informs 0026; native-control theming complements 0029's recovery UI

## Context

Fordham maroon `#6B1A1A` is an excellent ink on white — 11.75:1, comfortably past AAA. On
`gray-900` (the dark-mode page) it measures **1.51:1**, and on the `gray-700` assistant bubble
**1.14:1** — both effectively invisible. Yet `text-fordham-maroon` carried real content in dark
mode: the welcome-card heading, the onboarding saves header, memory type badges, every inline
markdown link, the Edit/Show links in Settings. Gold `#C8A84B` has the mirror problem: 7.74:1 on
gray-900 but **2.29:1 on white** — it fails even the 3:1 UI-component floor in light mode.

Meanwhile the dark theme itself was half-implemented as scattered `dark:` variants, and
`color-scheme` was never set anywhere in `src/`, so every native control — the chat input, both
textareas, the term `<select>` and its popup, the scrollbars — rendered light chrome regardless of
the class on `<html>`. The empty-state copy sat at `gray-400` on `gray-50` (2.43:1), making the
lowest-contrast text in the product the first thing a new student reads.

The forcing function is arithmetic, not taste: no single maroon value can write on both white and
gray-900. The brand needs two inks or zero.

## Decision

**Maroon fills; `maroon.ink` writes.** The token splits — `maroon.DEFAULT` `#6B1A1A` (fill
anywhere, ink on light), `maroon.ink` `#D98A8A` (ink and rules on dark surfaces, 6.72:1 on
gray-900), `maroon.deep` `#5A1616` (dark-mode header fill, 13.45:1 with white). Gold is an accent
only, legible solely against maroon. `color-scheme` is declared in CSS (`light dark`, so the
pre-JS frame follows the OS) and narrowed by `applyTheme()` — that line, not Tailwind, is what
themes native controls. Body ink floors: `gray-800`/`gray-100`; meta ink `gray-600`/`gray-400`.

## Alternatives considered

### Alternative A: flip the accent — gold-dominant dark mode

Gold reads well on dark, so let gold carry the brand at night. Rejected: gold-dominant maroon-less
dark mode reads as a different university, and gold still can't write on light surfaces, so the
palette would fork by theme instead of by role. The header staying maroon in both themes is the
one fixed brand anchor.

### Alternative B: darken/brighten the whole palette programmatically (or `filter: invert()`)

One transform, zero new tokens. Rejected: inversion destroys the maroon fills (the header becomes
teal-ish), and global lightness shifts move every color including the ones that already pass.
Contrast failures are positional — ink-on-surface pairs — and only a per-role split targets them.

### Alternative C: keep patching individual `dark:` variants (status quo)

What the codebase was doing. Rejected as provably incomplete: the audit enumerated nine surfaces
with zero dark variants, and without a designated dark ink every patch has to invent its own
color, which is how the four broken `hover:` classes happened.

## Consequences

- Every maroon *ink* call site needs `dark:text-fordham-maroon-ink`; fills stay untouched.
  Greppable rule: `text-fordham-maroon` without an adjacent `dark:` is a defect.
- `text-fordham-maroon` keeps resolving to `DEFAULT` — nothing renames, no class churn.
- Native controls follow the theme with no custom widgets — the `<select>` keeps its OS popup.
- Accepts a hard rule that costs vigilance: gold never writes on light surfaces, ever.
- Focus rings inherit the split: maroon ring on light, `maroon.ink` on dark, gold only on the
  maroon header.

## Revisit if...

- Tailwind v4 / broad `light-dark()` CSS adoption lets the pair collapse into single declarations.
- Fordham rebrands, or the panel ever renders on surfaces other than white/gray-50/gray-800/gray-900.

## References

- Contrast ratios independently recomputed twice (design audit + engineering verification), exact
  agreement: 11.75, 1.51, 1.14, 7.74, 4.50, 2.29.
- Implemented in `tailwind.config.js`, `src/sidebar/styles.css`, `src/sidebar/theme.ts`.
