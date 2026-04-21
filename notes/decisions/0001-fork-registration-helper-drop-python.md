# 0001 — Fork NickTrinh/registration-helper and drop the Python approach

- **Status**: Accepted
- **Date**: 2026-04-13
- **Related**: precedes 0002 (which retired the parser this fork brought with it)

## Context

The original plan for the AI Solutions Challenge was a Python prototype: scrape Fordham's DegreeWorks HTML on the server, compute audit gaps in Python, and expose results through a separate web UI. A few days into scaffolding it, the runway problem became clear. Every layer needed work that wasn't the AI part:

- **Auth**: a Fordham student logging into our app would need some credential flow, and Fordham's SSO is not one we can legally intercept.
- **UI**: the web frontend was days of shadcn/React scaffolding before anything was visible.
- **Hosting**: public web app meant hosting, domain, and deployment story.
- **Data**: a per-semester course catalog ingest pipeline, separate from the audit flow.

We started with [NickTrinh/registration-helper](https://github.com/NickTrinh/registration-helper), a MV3 extension with a React sidebar, a streaming `@anthropic-ai/sdk` chat loop, a DegreeWorks parser skeleton, a Banner SSB client, and IndexedDB plumbing — roughly 70% of the plumbing needed, already working.

## Decision

Forked `NickTrinh/registration-helper`, deleted the Python prototype, and rebuilt the project around the Chrome extension surface. Accept TypeScript + React + MV3 + Vite + Tailwind as the locked-in stack for the rest of the build.

## Alternatives considered

### Alternative A: Keep building the Python prototype

The blocking problems were auth, UI, and hosting — each a week of runway we didn't have. Intercepting Fordham's SSO for our own app is against policy; hosting a student-credential-handling web app introduces liability; building a polished enough UI from scratch in parallel with the AI logic was unrealistic in our timeframe. No credible path to a working demo.

### Alternative B: Build the extension from scratch in TypeScript

Even starting fresh with a template, the MV3 manifest + permissions + side-panel wiring + content-script/worker message router is two to three days of plumbing before anything visible runs. There was no reason to re-discover those patterns the hard way when the existing project had working versions.

### Alternative C: Use an existing commercial degree-audit tool as a backend

None are exposed to Fordham students, and the competition explicitly rewards *building* something — wrapping someone else's audit engine doesn't satisfy the brief.

## Consequences

Commits the project to TypeScript/React/MV3 for the remainder. Inherits the fork's assumptions, including one that turns out to be wrong: the inherited `degreeworks-content.ts` HTML parser is dead code because DegreeWorks is a React SPA with no DOM content (retired in ADR 0002). The side panel, message router, Banner SSB client, and streaming chat loop all work out of the box, saving days.

Most consequentially: puts the extension inside the real DegreeWorks tab with real session cookies. That is the architectural move that unlocks the entire later JSON-API path (ADR 0002), because we can call DegreeWorks endpoints with `credentials: "include"` (ADR 0004) and inherit the user's auth — no separate login flow needed.

Locks us to Chrome. An extension is a demo-ready surface for a competition demo (open the tab, open the side panel, ask a question, judges see it live) but isn't portable to Firefox/Safari without work we've set aside for now.

## References

- Upstream: [NickTrinh/registration-helper](https://github.com/NickTrinh/registration-helper)
- Retires the HTML parser inherited here: ADR 0002
