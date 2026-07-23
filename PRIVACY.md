# RamPlan — Privacy Policy

**Effective date:** July 19, 2026
**Extension:** RamPlan (Chrome extension)
**Contact:** pshields7@fordham.edu

RamPlan is an AI academic advisor that runs inside your browser alongside Fordham's
DegreeWorks. This policy explains, in plain terms, what data the extension handles, where it
goes, and what it never does.

## The short version

- **RamPlan has no server.** The developer operates no backend, database, or analytics. No
  data is ever sent to the developer, and none can be — there is nowhere for it to go.
- **Your data stays on your device**, in your browser's local storage, except for the specific
  content RamPlan sends to Anthropic to generate advice — which you authorize with your own
  Anthropic API key.
- **Your name, student ID, and advisor's name and email are never transmitted to Anthropic.**
  They are removed before any request leaves your browser and re-inserted only when displaying
  results on your screen.
- **No tracking, no advertising, no sale of data**, ever.

## What data RamPlan handles

RamPlan works with the following data, all read from systems you are already logged in to:

| Data | Source | Where it lives |
|---|---|---|
| Your Anthropic API key | You enter it in Settings | Your browser (`chrome.storage.local`) — on your device only |
| Your DegreeWorks degree audit (requirements, completed and remaining courses, GPA, term data) | Fordham DegreeWorks, via your existing logged-in session | Your browser (`chrome.storage.local`) |
| Your name, Banner student ID, and advisor's name and email | Fordham DegreeWorks | Your browser only — **never sent to Anthropic** (see below) |
| A short advising profile RamPlan derives from your conversations (e.g. "prefers morning classes") | Generated on your device from your chats | Your browser (`chrome.storage.local`) |
| Course catalog for a term you choose to load | Fordham Banner, via your existing logged-in session | Your browser (`IndexedDB`) |
| Your chat messages with the advisor | You type them | Your browser session storage |

RamPlan does **not** collect your Fordham password or login credentials. It reads DegreeWorks
and Banner through the session you have already authenticated in your own browser; it never
sees or stores your Fordham login.

## What is sent off your device, and to whom

RamPlan makes network requests to exactly two destinations, both of which you initiate:

**1. Fordham (DegreeWorks and Banner).** RamPlan reads your degree audit and the course catalog
from Fordham's own systems, using your existing authenticated session. This data does not leave
Fordham's environment except to be stored locally in your browser.

**2. Anthropic (the Claude API).** To generate advice, RamPlan sends the following to Anthropic
using **your own API key**: the text of your degree audit **with all personal identifiers
removed**, your chat messages, your derived advising profile, and course-catalog details
relevant to your questions. This is governed by
[Anthropic's Privacy Policy](https://www.anthropic.com/legal/privacy) and, for API usage,
Anthropic's Commercial Terms — under which **API inputs and outputs are not used to train
models**.

### How personal identifiers are protected

Your **name, Banner student ID, and advisor's name and email are removed from the audit before
any request is built** — the component that prepares audit text for Anthropic is written so
that it cannot read those fields in the first place. In their place it emits neutral
placeholders (for example, `[NAME]`). Your real name is substituted back in only when advice is
displayed on your screen, locally in your browser. As a result, these identifiers are never
transmitted to Anthropic under any circumstance.

## Sensitive data

Your degree audit is an education record and is treated as sensitive. RamPlan handles it only to
provide the advising features you request, stores it solely on your device, and — apart from the
de-identified content described above — does not transmit it anywhere. RamPlan does not use any
data for advertising, profiling unrelated to advising, credit assessment, or any purpose beyond
answering your academic-planning questions.

## Data retention and your controls

- **Everything RamPlan stores lives on your device.** You are in control of it at all times.
- **Uninstalling RamPlan deletes all of its local data**, including your API key, stored audit,
  profile, memories, and course catalog.
- You can **remove your API key or clear stored data from the extension's Settings** at any time.
- Because there is no server, there is no separate copy of your data to request, export, or
  delete elsewhere — removing it locally removes it completely.
- Data you send to Anthropic is subject to Anthropic's retention practices; consult their
  privacy policy for details.

## Children's privacy

RamPlan is intended for university students and is not directed to children under 13.

## Changes to this policy

If this policy changes, the updated version will be posted at this URL with a revised effective
date.

## Contact

Questions about this policy or RamPlan's data practices:
**pshields7@fordham.edu**

---

*RamPlan is an independent student project and is not endorsed by or officially affiliated with
Fordham University. "Fordham," "DegreeWorks," and "Banner" are used only to describe
interoperation with those systems.*
