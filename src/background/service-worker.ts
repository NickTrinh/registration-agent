// Extension service worker: message router, audit refresh, Anthropic chat loop
// with tool use, Banner catalog refresh, and long-term memory curator.
// Implements: ADR 0003 — see notes/decisions/. This file is the enforcement
// point for "service worker owns all third-party API calls; content scripts
// are thin taps." Every fetch against DegreeWorks, Banner, and Anthropic
// flows through handlers defined here, and all chrome.storage.local writes
// are owned by the worker so in-memory caches stay coherent.

import Anthropic from "@anthropic-ai/sdk";
import type { ConversationMessage } from "../shared/types";
import {
  getTerms,
  fetchAllSectionsForTerm,
} from "./agent/banner-ssb-client";
import { bannerSectionsToCourses } from "./agent/banner-to-course";
import { saveCourses } from "../shared/db";
import {
  executeCatalogSearch,
  executeListAttributes,
  SEARCH_CATALOG_TOOL,
  LIST_ATTRIBUTES_TOOL,
  type CatalogSearchInput,
} from "./agent/catalog-search";
import {
  fetchStudentMyself,
  fetchCurrentAudit,
  fetchWhatIfAudit,
  DegreeWorksAuthError,
  DegreeWorksNoTabError,
} from "./agent/degreeworks-api-client";
import { auditResponseToText } from "./agent/degreeworks-audit-to-text";
import {
  loadMemories,
  deleteMemory,
  clearMemories,
  memoriesToIndexText,
  executeRecallMemory,
  RECALL_MEMORY_TOOL,
  type RecallMemoryInput,
  loadProvisional,
  deleteProvisional,
  clearProvisional,
  SAVE_MEMORY_TOOL,
  executeSaveMemory,
  type SaveMemoryInput,
  FORGET_MEMORY_TOOL,
  executeForgetMemory,
  type ForgetMemoryInput,
  editMemory,
  type MemoryEditInput,
  addMemory,
  queueOnboardingSave,
  loadOnboardingQueue,
  clearOnboardingQueue,
  COMPLETE_ONBOARDING_TOOL,
} from "./agent/memory-store";
import { runCurator, type ConversationTurn } from "./agent/memory-curator";

// ─── Side Panel Setup ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// ─── In-memory cache ──────────────────────────────────────────────────────────

let cachedAuditText: string | null = null;
let cachedProfile: string | null = null;
let auditRefreshInFlight = false;  // prevent concurrent dual fetches

// Cached student metadata from the most recent audit refresh. Used by the
// What-If tool so it doesn't need a redundant /students/myself call.
//
// MV3 gotcha: module-level variables wipe when the service worker unloads
// (~30s idle). We mirror to chrome.storage.local so the What-If tool works
// even after a long idle period. The module cache is still populated on
// wake via `hydrateStudentCache()` on first access.
const STUDENT_ID_KEY = "studentId";
const STUDENT_GOAL_KEY = "studentGoal";

interface StudentGoal {
  school: string;
  degree: string;
  catalogYear: string;
  college: string;   // e.g. "FC" (Fordham College/Rose Hill). Required for
                     // the What-If endpoint.
  major: string;     // e.g. "NEUR". Required for What-If — server rejects
                     // the POST with 403 when MAJOR goal is missing, even
                     // if the student is only "adding a minor". Captured
                     // from goal.details[code=MAJOR] at refresh time.
  concentration: string | null; // e.g. "NES", or null if student has none.
                     // Included in What-If body to preserve current
                     // concentration when the student swaps major/minor.
}

let cachedStudentId: string | null = null;
let cachedStudentGoal: StudentGoal | null = null;

async function persistStudentCache(id: string, goal: StudentGoal): Promise<void> {
  cachedStudentId = id;
  cachedStudentGoal = goal;
  await chrome.storage.local.set({
    [STUDENT_ID_KEY]: id,
    [STUDENT_GOAL_KEY]: goal,
  });
}

async function hydrateStudentCache(): Promise<{
  id: string | null;
  goal: StudentGoal | null;
}> {
  if (cachedStudentId && cachedStudentGoal) {
    return { id: cachedStudentId, goal: cachedStudentGoal };
  }
  const r = await chrome.storage.local.get([STUDENT_ID_KEY, STUDENT_GOAL_KEY]);
  const id = (r[STUDENT_ID_KEY] as string | undefined) ?? null;
  // Migration guard: treat cache entries missing any of the new fields
  // (college, major, concentration) as a miss so the auto-refresh writes
  // the full shape. Without this, executeWhatIf would send undefined in
  // the goal body and DegreeWorks would 403.
  const rawGoal = r[STUDENT_GOAL_KEY] as
    | (StudentGoal & { college?: string; major?: string; concentration?: string | null })
    | undefined;
  const isFullShape =
    rawGoal &&
    typeof rawGoal.college === "string" &&
    typeof rawGoal.major === "string" &&
    "concentration" in rawGoal;
  const goal = isFullShape ? (rawGoal as StudentGoal) : null;
  if (id && goal) {
    cachedStudentId = id;
    cachedStudentGoal = goal;
  }
  return { id, goal };
}

// ─── Curator turn buffer ──────────────────────────────────────────────────────
//
// Rolling window of the most recent N user/assistant pairs, persisted to
// chrome.storage.local so it survives MV3 service-worker unloads. Used ONLY
// by the background memory curator (Haiku) for multi-turn pattern detection —
// never enters Sonnet's system prompt.

const CURATOR_BUFFER_KEY = "curator_turns";
const CURATOR_BUFFER_SIZE = 5;

// User-facing toggle for auto-saving memories from chat (Settings panel).
// Default ON. When OFF the Haiku curator is skipped entirely and no
// memories are written from normal chat turns — students can still get
// memories saved via explicit "remember X" → save_memory tool calls.
const AUTO_SAVE_KEY = "curatorAutoSaveEnabled";

async function isCuratorAutoSaveEnabled(): Promise<boolean> {
  const r = await chrome.storage.local.get(AUTO_SAVE_KEY);
  const v = r[AUTO_SAVE_KEY];
  return v === undefined ? true : Boolean(v);
}

async function appendCuratorTurn(turn: ConversationTurn): Promise<ConversationTurn[]> {
  const r = await chrome.storage.local.get(CURATOR_BUFFER_KEY);
  const existing = (r[CURATOR_BUFFER_KEY] as ConversationTurn[] | undefined) ?? [];
  const next = [...existing, turn].slice(-CURATOR_BUFFER_SIZE);
  await chrome.storage.local.set({ [CURATOR_BUFFER_KEY]: next });
  return next;
}

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {

    case "REFRESH_AUDIT": {
      refreshAudit().catch((err) => {
        console.error("[FordhamHelper] Audit refresh failed:", err);
        if (err instanceof DegreeWorksAuthError) {
          broadcast({ type: "AUDIT_EXPIRED" });
        } else {
          broadcast({
            type: "AUDIT_ERROR",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
      break;
    }

    case "GET_AUDIT_TEXT": {
      if (cachedAuditText) {
        sendResponse({ text: cachedAuditText });
      } else {
        chrome.storage.local.get("auditText", (r) => {
          cachedAuditText = (r.auditText as string) ?? null;
          sendResponse({ text: cachedAuditText });
        });
        return true;
      }
      break;
    }

    case "GET_PROFILE": {
      if (cachedProfile) {
        sendResponse({ profile: cachedProfile });
      } else {
        chrome.storage.local.get(["studentProfile", "profileGeneratedAt"], (r) => {
          cachedProfile = (r.studentProfile as string) ?? null;
          sendResponse({ profile: cachedProfile, generatedAt: r.profileGeneratedAt ?? null });
        });
        return true;
      }
      break;
    }

    case "REFRESH_PROFILE": {
      chrome.storage.local.get("auditText", (r) => {
        const text = (r.auditText as string) ?? cachedAuditText;
        if (text) extractProfile(text);
      });
      break;
    }

    case "SET_PROFILE": {
      // Settings page sends this after an inline edit. Worker owns the write
      // so cachedProfile stays in sync; rebroadcast so other open sidebars
      // (e.g. the chat page) pick up the new memory on their next read.
      const edited = (message.profile as string | undefined)?.trim();
      if (edited) {
        cachedProfile = edited;
        chrome.storage.local.set({
          studentProfile: edited,
          profileGeneratedAt: Date.now(),
        });
        broadcast({ type: "PROFILE_READY", profile: edited });
      }
      break;
    }

    case "GET_MEMORIES": {
      loadMemories().then((memories) => sendResponse({ memories }));
      return true;
    }

    case "DELETE_MEMORY": {
      const id = message.id as number | undefined;
      if (typeof id !== "number") break;
      deleteMemory(id).then((memories) => {
        broadcast({ type: "MEMORY_UPDATED", memories });
      });
      break;
    }

    case "EDIT_MEMORY": {
      const input = message.input as MemoryEditInput | undefined;
      if (!input || typeof input.id !== "number") break;
      editMemory(input).then(async (updated) => {
        if (updated) {
          const memories = await loadMemories();
          broadcast({ type: "MEMORY_UPDATED", memories });
        }
      });
      break;
    }

    case "CLEAR_MEMORIES": {
      clearMemories().then(() => {
        broadcast({ type: "MEMORY_UPDATED", memories: [] });
      });
      break;
    }

    case "GET_PROVISIONAL": {
      loadProvisional().then((provisional) => sendResponse({ provisional }));
      return true;
    }

    case "DELETE_PROVISIONAL": {
      const id = message.id as number | undefined;
      if (typeof id !== "number") break;
      deleteProvisional(id).then(() => {
        loadProvisional().then((provisional) =>
          broadcast({ type: "PROVISIONAL_UPDATED", provisional })
        );
      });
      break;
    }

    case "CLEAR_PROVISIONAL": {
      clearProvisional().then(() => {
        broadcast({ type: "PROVISIONAL_UPDATED", provisional: [] });
      });
      break;
    }

    case "GET_AUTO_SAVE": {
      isCuratorAutoSaveEnabled().then((enabled) => sendResponse({ enabled }));
      return true;
    }

    case "SET_AUTO_SAVE": {
      const enabled = Boolean(message.enabled);
      chrome.storage.local.set({ [AUTO_SAVE_KEY]: enabled }, () => {
        broadcast({ type: "AUTO_SAVE_UPDATED", enabled });
      });
      break;
    }

    case "AI_CHAT": {
      handleAIChat(
        message.messages as ConversationMessage[],
        message.auditText as string,
        message.profile as string,
        (message.mode as "normal" | "onboarding" | undefined) ?? "normal"
      );
      break;
    }

    case "CANCEL_AI_CHAT": {
      if (currentChatController) {
        currentChatController.abort();
      }
      break;
    }

    case "GET_ONBOARDING_STATE": {
      chrome.storage.local.get(["onboardingCompletedAt"], (r) => {
        sendResponse({
          completedAt: (r.onboardingCompletedAt as number | undefined) ?? null,
        });
      });
      return true;
    }

    case "SET_ONBOARDING_COMPLETED": {
      const now = Date.now();
      chrome.storage.local.set({ onboardingCompletedAt: now }, () => {
        broadcast({ type: "ONBOARDING_COMPLETED", completedAt: now });
      });
      break;
    }

    case "RESET_ONBOARDING": {
      // Student clicked "Re-run onboarding" in Settings. Clear the completion
      // flag, the curator buffer (so the new intake doesn't see stale prior
      // context), and any pending onboarding save queue from an aborted prior
      // run. Then broadcast ONBOARDING_RESET — AuditChat listens so tabs with
      // the chat mounted flip back to intake without needing a close/reopen.
      chrome.storage.local.remove(
        ["onboardingCompletedAt", CURATOR_BUFFER_KEY, "onboarding_save_queue"],
        () => {
          broadcast({ type: "ONBOARDING_RESET" });
        }
      );
      break;
    }

    case "GET_CATALOG_TERMS": {
      getTerms()
        .then((terms) => sendResponse({ terms }))
        .catch((err) => sendResponse({ terms: [], error: String(err) }));
      return true;
    }

    case "REFRESH_CATALOG": {
      refreshCatalog(message.term as string);
      break;
    }

    case "GET_CATALOG_STATUS": {
      chrome.storage.local.get(
        ["catalogTerm", "catalogUpdatedAt", "catalogCourseCount"],
        (r) => {
          sendResponse({
            term: r.catalogTerm ?? null,
            updatedAt: r.catalogUpdatedAt ?? null,
            courseCount: r.catalogCourseCount ?? 0,
          });
        }
      );
      return true;
    }
  }
});

// ─── Audit Refresh ────────────────────────────────────────────────────────────

// Fetch the live DegreeWorks audit via the JSON API, render it as text, cache
// it, kick off profile extraction, and notify the UI. Idempotent: multiple
// REFRESH_AUDIT messages in flight collapse to one network call.
async function refreshAudit(): Promise<void> {
  if (auditRefreshInFlight) {
    console.log("[FordhamHelper] Audit refresh already in flight, skipping");
    return;
  }
  auditRefreshInFlight = true;
  broadcast({ type: "AUDIT_LOADING" });

  try {
    // Bootstrap: pick the first (usually only) active degree goal.
    const student = await fetchStudentMyself();
    const goal = student.goals?.[0];
    if (!goal) {
      throw new Error("No active degree goal on /students/myself");
    }

    // Pull the student's current curriculum codes from goal.details. All
    // three (COLLEGE, MAJOR, CONC) are needed for the What-If endpoint to
    // accept a request — the server wants a full curriculum spec, not a
    // partial one. Default COLLEGE to "FC" (Fordham/Rose Hill) defensively;
    // MAJOR and CONC come through when present.
    const findDetail = (code: string) =>
      goal.details?.find((d) => d.code?.key === code)?.value?.key ?? null;
    const college = findDetail("COLLEGE") ?? "FC";
    const major = findDetail("MAJOR") ?? "";
    const concentration = findDetail("CONC"); // null if student has no conc

    await persistStudentCache(student.id, {
      school: goal.school.key,
      degree: goal.degree.key,
      catalogYear: goal.catalogYear.key,
      college,
      major,
      concentration,
    });

    // Intentionally do not log student.id — Banner ID is PII (ADR 0009).
    console.log(
      `[FordhamHelper] Fetching audit (${goal.school.key}/${goal.degree.key}, ${goal.catalogYear.key})`
    );

    const audit = await fetchCurrentAudit({
      studentId: student.id,
      school: goal.school.key,
      degree: goal.degree.key,
    });

    // NEVER log the full response body — contains PII (name, email, banner id)
    console.log(
      `[FordhamHelper] Audit loaded: ${audit.blockArray?.length ?? 0} blocks,` +
        ` ${audit.auditHeader?.percentComplete ?? "?"}% complete`
    );

    // Renderer emits the audit as a PII-free text with literal [NAME],
    // [ADVISOR], and [ADVISOR_EMAIL] tokens. The real identifying fields never
    // leave this function — they're pulled straight off the audit object,
    // stashed in chrome.storage.local for the sidebar to substitute back into
    // Claude's responses at render time, and then we drop our reference.
    const rawText = auditResponseToText(audit);
    // studentName is Ellucian "Last, First Middle" — split on the comma first,
    // then take the leading word of the trailing portion.
    const firstName =
      audit.auditHeader?.studentName?.split(",")[1]?.trim().split(/\s+/)[0] ?? null;
    const advisorGoal = audit.degreeInformation?.goalArray?.find(
      (g) => g.code === "ADVISOR"
    );
    const advisorEmail = advisorGoal?.advisorEmail ?? null;
    const advisorName = advisorGoal?.advisorName ?? null;

    // When there's no advisor email, replace the token with a descriptive
    // phrase so Claude knows the contact path isn't available (and won't
    // suggest emailing). When the email IS present, leave the token in place
    // so the sidebar substitutes it locally at render time.
    const text =
      advisorEmail === null
        ? rawText.replaceAll("<[ADVISOR_EMAIL]>", "(advisor email not provided)")
        : rawText;

    cachedAuditText = text;
    await chrome.storage.local.set({
      auditText: text,
      studentFirstName: firstName,
      studentAdvisorEmail: advisorEmail,
      studentAdvisorName: advisorName,
    });
    console.log(`[FordhamHelper] Audit text rendered: ${text.length} chars`);

    maybeExtractProfile(text);
    // Sidebar reads the text off this broadcast to populate AuditChat state.
    broadcast({ type: "AUDIT_TEXT_READY", text });
  } finally {
    auditRefreshInFlight = false;
  }
}

// ─── Profile Extraction ───────────────────────────────────────────────────────

// Re-extract if profile is missing or older than 6 months
async function maybeExtractProfile(auditText: string): Promise<void> {
  const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 180;

  chrome.storage.local.get(["studentProfile", "profileGeneratedAt"], (r) => {
    const profile = r.studentProfile as string | undefined;
    const generatedAt = r.profileGeneratedAt as number | undefined;
    const isStale = !generatedAt || Date.now() - generatedAt > SIX_MONTHS_MS;

    if (!profile || isStale) {
      extractProfile(auditText);
    } else {
      cachedProfile = profile;
      console.log("[FordhamHelper] Profile loaded from storage (still fresh)");
    }
  });
}

async function extractProfile(auditText: string): Promise<void> {
  const apiKey = await getApiKey();
  if (!apiKey) return;

  console.log("[FordhamHelper] Extracting student profile with Haiku...");
  broadcast({ type: "PROFILE_LOADING" });

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  // auditText arrives already PII-free from refreshAudit — the renderer emits
  // placeholder tokens instead of identifying fields, so Haiku never sees a
  // real name or email. The template below also doesn't ask for Name/Advisor,
  // so there's no prompt pressure to hallucinate identifying fields.
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{
        role: "user",
        content:
`Extract a compact student profile from this DegreeWorks audit.
Output ONLY the profile block below — no extra text, no explanation.

Field rules:
- Major, Minor, Concentration are SEPARATE fields. Each maps to one of
  the audit's \`MAJOR:\` / \`MINOR:\` / \`CONC:\` lines respectively. NEVER
  put a concentration in the Minor slot or vice versa — the audit
  distinguishes them and so must you.
- If the student has MULTIPLE majors, minors, or concentrations, list
  them comma-separated. A double-major, dual minors, or multiple
  concentrations are valid and should all appear.
- If a field has no value in the audit, write exactly: None

Classification: [year] | Major: [major(s), comma-sep] | Minor: [minor(s) or None] | Concentration: [concentration(s) or None]
GPA: [overall gpa] | Credits: [earned]/[required]
Completed blocks: [comma-separated requirement blocks fully done]
In progress: [courses currently being taken, format SUBJ 1234; or None]
Still needed (top 5):
- [most critical outstanding requirement]
- [next most critical]
- [next]
- [next]
- [next]

=== AUDIT ===
${auditText.substring(0, 10000)}`,
      }],
    });

    const profile =
      response.content[0].type === "text" ? response.content[0].text.trim() : "";

    if (profile) {
      cachedProfile = profile;
      chrome.storage.local.set({
        studentProfile: profile,
        profileGeneratedAt: Date.now(),
      });
      console.log("[FordhamHelper] Profile extracted:\n", profile);
      broadcast({ type: "PROFILE_READY", profile });
    } else {
      // Empty string back from Haiku — surface it so the sidebar spinner
      // doesn't hang waiting for a PROFILE_READY that never comes.
      broadcast({ type: "PROFILE_ERROR", error: "Profile extractor returned an empty result" });
    }
  } catch (err) {
    console.error("[FordhamHelper] Profile extraction failed:", err);
    broadcast({ type: "PROFILE_ERROR", error: err instanceof Error ? err.message : String(err) });
  }
}

// ─── AI Chat ──────────────────────────────────────────────────────────────────

// Onboarding intake prompt — used only when memories is empty AND the student
// hasn't completed onboarding yet. Sonnet runs a structured but conversational
// intake, calling save_memory (queued, not persisted) as durable facts emerge.
// When it feels it has a solid picture (5-7 exchanges), it calls the
// complete_onboarding tool, which drains the queue and triggers the UI's
// wrap-up flow.
const ONBOARDING_SYSTEM_PROMPT = `You are an AI academic advisor running a brief intake conversation with a Fordham student you're meeting for the first time. The goal of this short conversation is to learn enough about them that all future advising sessions can be genuinely personalized.

## What you're trying to learn

- **Interests** — what academic or career areas they're drawn to that aren't already obvious from their major on the audit. Be specific: "interested in philosophy" is vague; "interested in philosophy of mind, specifically related to her neuroscience work" is the kind of specificity you want.
- **Goals** — what they're aiming at after graduation. Grad school? Which programs? Specific fields? Industry? Research?
- **Constraints** — real-world limits on when/where they can take classes. Work schedules, commuting, family obligations, health.
- **Preferences** — section styles they work well with (morning vs afternoon, small vs large, lecture vs seminar), instructors they want to avoid or seek out, learning formats.
- **Past context** — courses or experiences (inside or outside Fordham) that shaped what they want to do next.

## How to conduct the intake

- Start with a **very short** intro — strict 2 sentences max — explaining what this is and that it takes about 5 minutes. Use the student's first name (rendered from the [NAME] token). Then go straight to the first question on the next line. Do NOT open with a multi-paragraph welcome; previous versions ran to 9+ sentences and made students bounce.
- Ask ONE question at a time. Never dump a questionnaire.
- **Keep each reply short — roughly 5-6 sentences maximum.** Acknowledge briefly (one short sentence), then ask the next question. Don't philosophize, don't wax enthusiastic across paragraphs, don't riff at length on what they just told you. The student is here to get help planning, not to have a pen-pal exchange. (Edge case: if you genuinely need to explain something to move forward, you can exceed this — but default to brief.)
- **Always wrap the question itself in \`**bold**\`** so the student can spot it at a glance when your reply has preceding acknowledgement text. Example: "Good, neuroscience research is a strong base. **What are you hoping to do after graduation — grad school, industry, something else?**"
- Listen. Follow up on interesting answers — if they say "I loved that theology class", ask which one and what made it click. Drill down before moving on. But stay brief.
- Mix closed and open questions. Don't make it feel like a form.
- Reference what's in their audit when relevant ("I see you're doing Integrative Neuroscience — what drew you to that?") but don't pepper them with audit facts.
- Never ask about things already in their audit as if you don't know them. You do.

## Saving memories — deferred batch

Saves are DEFERRED during intake: every \`save_memory\` call is queued, not persisted. The full batch commits in one atomic pass at the end when you call \`complete_onboarding\`. This means you should:

- Call \`save_memory\` ONCE per distinct topic — aim for 5-8 high-quality saves by the end of intake.
- Do NOT mention "saving" or "remembering" in your replies. The student sees the batch at the end, not per-turn confirmations.
- Never re-queue a topic you already queued earlier in this conversation. The queue dedupes, but the cleaner the queue, the cleaner the final batch view.

Before calling save_memory, ask yourself:
1. Did I already queue something about this topic earlier in this conversation?
2. Is the student stating a genuinely new fact, or restating/expanding one they already gave?

If the answer to #1 is yes, skip. If the answer to #2 is "restating", skip.

Guidelines for each save_memory call:
- \`type\`: interest | constraint | goal | decision | note — pick the best fit
- \`description\`: ≤10 words, specific enough that a future advisor can route on it without loading the full content. "Philosophy of mind, drawn from her neuro work" is good; "academic interests" is useless.
- \`content\`: 1-3 sentences with the details. Quote the student when practical.
- \`sourceQuote\`: a short verbatim snippet from the student's most recent message that justified this save.

Only save what the student explicitly said during this conversation. Never save inferences. Never save audit facts. DO NOT save disabilities, diagnoses, medications, mental-health topics, or family-crisis disclosures — acknowledge them warmly in your reply but do not queue a save for them.

## Ending the intake — complete_onboarding

After roughly 5-7 exchanges, OR when you feel you have a solid picture, OR when the student signals they're done — call the \`complete_onboarding\` tool. This drains the save queue, persists everything at once, and flips the chat back to normal mode. After the tool returns, give a warm 3-4 line wrap-up summary of what you learned and invite the student to ask anything now that you have context.

- Call complete_onboarding EXACTLY ONCE, at the end.
- Never call it on the first turn. Ask enough questions first.
- Do NOT describe the save flow to the student ("I'm saving these now…") — the UI renders the list for them. Just write a warm wrap-up after the tool returns.

## Tone

Warm, curious, human. You are not a form — you are a new advisor trying to get to know a student. It should feel like a real conversation.`;

// ─── What-If Audit Tool ──────────────────────────────────────────────────────

import type { WhatIfGoal } from "../shared/degreeworks-types";

const WHAT_IF_AUDIT_TOOL = {
  name: "run_what_if",
  description:
    "Run a hypothetical What-If audit against the student's real DegreeWorks data to show " +
    "how their degree progress would change under a different major, minor, or concentration. " +
    "Provide AT LEAST ONE of major / minor / concentration — whichever the student is asking about. " +
    "Map the student's phrasing to the right field: " +
    "\"added/exploring a philosophy MINOR\" → pass { minor: 'PHIL' } (do NOT pass a major — " +
    "the real major is kept automatically). " +
    "\"switched to psychology\" → pass { major: 'PSYC' }. " +
    "\"added the XYZ concentration\" → pass { concentration: 'XYZ' }. " +
    "Passing only the current major with nothing else is a NO-OP — don't do that. " +
    "Returns a full plain-text audit under the hypothetical scenario; compare against the " +
    "real audit in your system prompt and describe the differences.",
  input_schema: {
    type: "object" as const,
    properties: {
      major: {
        type: "string",
        description: "Major code, e.g. 'PSYC', 'CISC', 'ENGL'. Only include when the student is " +
          "SWITCHING to a new major. Omit for minor-only or concentration-only queries; the real major is kept.",
      },
      minor: {
        type: "string",
        description: "Minor code, e.g. 'PHIL', 'CISC'. Use this when the student asks about ADDING a minor.",
      },
      concentration: {
        type: "string",
        description: "Concentration code. Use this when the student asks about adding or switching a concentration.",
      },
      college: {
        type: "string",
        description:
          "Optional college code, e.g. 'FC' (Fordham College/Rose Hill), 'FL' (Fordham/Lincoln Center), 'GS' (Gabelli School of Business). " +
          "Defaults to the student's current college if omitted. Only set this when the student explicitly asks about TRANSFERRING schools " +
          "(\"what if I transferred to Gabelli?\"). For same-school major/minor/concentration swaps, omit it and the student's real college is used.",
      },
      classes: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional Look-Ahead: hypothetical courses to include, formatted as 'SUBJ 1234' " +
          "(e.g. ['PSYC 3110', 'PSYC 4200']). The audit engine treats these as if the " +
          "student is enrolled in them.",
      },
    },
  },
};

interface WhatIfInput {
  major?: string;
  minor?: string;
  concentration?: string;
  college?: string;
  classes?: string[];
}

async function executeWhatIf(input: WhatIfInput): Promise<string> {
  // Re-hydrate module cache from chrome.storage.local if the service worker
  // was unloaded since the last audit refresh.
  let { id: studentId, goal: studentGoal } = await hydrateStudentCache();

  // Cache miss — either the extension was reset, it's a first-run that
  // never touched DegreeWorks, or storage was selectively wiped. Try to
  // heal by forcing a refresh; this only works if DegreeWorks is
  // authenticated in any tab of the same Chrome profile (cookie auth).
  // If the refresh succeeds we get studentId back transparently; if not
  // we surface a clear instruction to the student.
  if (!studentId || !studentGoal) {
    console.log("[FordhamHelper] What-If: student cache empty, attempting auto-refresh");
    try {
      await refreshAudit();
      ({ id: studentId, goal: studentGoal } = await hydrateStudentCache());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[FordhamHelper] What-If auto-refresh failed:", msg);
      return (
        "Error: I couldn't load your DegreeWorks record automatically. " +
        "Please open https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31 " +
        "in any tab of this browser, let your real audit load, then ask me the What-If again. " +
        "(This almost always means your Fordham session expired — logging in again fixes it.)"
      );
    }
    if (!studentId || !studentGoal) {
      return (
        "Error: I refreshed the audit but still can't see your student record. " +
        "Please open DegreeWorks at https://dw-prod.ec.fordham.edu/responsiveDashboard/worksheets/WEB31, " +
        "confirm your real audit is visible there, then try again. " +
        "If DegreeWorks loads fine but this keeps failing, reload the extension from chrome://extensions."
      );
    }
  }

  // DegreeWorks's What-If endpoint requires a full curriculum spec, not a
  // partial one. Missing MAJOR or COLLEGE gives 403; missing CONC is OK
  // only when the student has no current concentration. The native UI
  // always sends [MAJOR, MINOR?, CONC?, COLLEGE] — we match that shape.
  //
  // Semantics: the student's explicit input overrides the cached current
  // curriculum. If they said "add a philosophy minor", input has minor=PHIL
  // but no major — we keep current MAJOR (NEUR), current CONC (NES), and
  // add the new MINOR. If they said "switch to PSYC", input has major=PSYC
  // and no conc — we keep CONC off (PSYC-specific concentrations differ
  // from NEUR-specific ones; sending the old CONC would be semantically
  // wrong).
  const goals: WhatIfGoal[] = [];

  // MAJOR — always required. Use explicit override or current cached major.
  const majorValue = (input.major || studentGoal.major || "").toUpperCase();
  if (!majorValue) {
    return "Error: student has no declared major — What-If can't run without one.";
  }
  goals.push({ code: "MAJOR", value: majorValue });

  // MINOR — only when the student asked about one.
  if (input.minor) {
    goals.push({ code: "MINOR", value: input.minor.toUpperCase() });
  }

  // CONC — explicit override OR (if the student has a current concentration
  // AND the major wasn't swapped) preserve it. When the model swaps major,
  // we drop the old concentration since it's typically major-tied.
  // NB: code is "CONC", not "CONCENTRATION" — confirmed via cURL.
  if (input.concentration) {
    goals.push({ code: "CONC", value: input.concentration.toUpperCase() });
  } else if (!input.major && studentGoal.concentration) {
    goals.push({ code: "CONC", value: studentGoal.concentration.toUpperCase() });
  }

  // COLLEGE — always required. Explicit override or current.
  const collegeValue = (input.college || studentGoal.college).toUpperCase();
  goals.push({ code: "COLLEGE", value: collegeValue });

  // Refuse a truly empty What-If (no user-specified changes). Otherwise the
  // request is just the student's current curriculum, which gives no new
  // info and wastes a round-trip.
  if (!input.major && !input.minor && !input.concentration && !input.college) {
    return "Error: What-If needs at least one of major, minor, concentration, or college to swap — otherwise it's identical to the real audit.";
  }

  const classes = (input.classes ?? [])
    .map((c) => {
      const parts = c.trim().split(/\s+/);
      return parts.length >= 2
        ? { discipline: parts[0].toUpperCase(), number: parts.slice(1).join(" ") }
        : null;
    })
    .filter((c): c is { discipline: string; number: string } => c !== null);

  try {
    const audit = await fetchWhatIfAudit(studentId, goals, {
      school: studentGoal.school,
      degree: studentGoal.degree,
      catalogYear: studentGoal.catalogYear,
      classes,
    });
    const text = auditResponseToText(audit);
    console.log(
      `[FordhamHelper] What-If audit completed: ${audit.blockArray?.length ?? 0} blocks, ` +
        `${audit.auditHeader?.percentComplete ?? "?"}% complete`
    );
    return text;
  } catch (err) {
    if (err instanceof DegreeWorksNoTabError) {
      console.warn("[FordhamHelper] What-If skipped: no DegreeWorks tab open.");
      return "Error: please open DegreeWorks in a tab, then retry this What-If question. (What-If queries need an active DegreeWorks session for cross-origin reasons.)";
    }
    if (err instanceof DegreeWorksAuthError) {
      console.warn("[FordhamHelper] What-If auth failed:", err.message);
      return "Error: DegreeWorks session expired. Log back into DegreeWorks and retry.";
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[FordhamHelper] What-If audit failed:", msg);
    return `Error running What-If audit: ${msg}`;
  }
}

// Tracks the in-flight chat's AbortController so CANCEL_AI_CHAT can abort
// the Anthropic stream when the side panel closes mid-response. Only one
// chat can be in flight per worker (Sonnet streams are sequential), so a
// single module-level ref is sufficient.
let currentChatController: AbortController | null = null;

async function handleAIChat(
  messages: ConversationMessage[],
  auditText: string,
  profile: string,
  mode: "normal" | "onboarding" = "normal"
): Promise<void> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    broadcast({ type: "AI_ERROR", error: "No API key set. Go to Settings and add your Anthropic API key." });
    return;
  }

  // Abort any prior in-flight chat before starting a new one (e.g. if the
  // student sends a second message while the first is still streaming —
  // rare but possible).
  if (currentChatController) currentChatController.abort();
  const controller = new AbortController();
  currentChatController = controller;

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  // auditText arrives already PII-free from refreshAudit — the renderer is the
  // enforcement boundary for Fordham's Third-Party Data Transfer Policy. See
  // degreeworks-audit-to-text.ts for the safe-by-construction design.

  // Long-term memory routing index. The full content stays in storage; Sonnet
  // sees only `#<id> [<type>] <description>` per entry and pages in specifics
  // via the recall_memory tool. Empty string when no memories exist yet.
  const memories = await loadMemories();
  const memoryIndex = memoriesToIndexText(memories);

  // Onboarding mode swaps out the system prompt and the tool set. The audit is
  // still available (Sonnet needs it to reference what's already known about
  // the student) but memory-writing routes via save_memory instead of the
  // curator. Catalog search stays available for any follow-ups that need it.
  const systemText = mode === "onboarding"
    ? `${ONBOARDING_SYSTEM_PROMPT}

=== LIVE DEGREEWORKS AUDIT ===
${auditText || "Audit not loaded. Ask the student to visit their DegreeWorks page."}
==============================`
    :
`You are an AI academic advisor embedded inside Fordham University's DegreeWorks portal.

## Student Profile (persistent memory)
${profile || "Profile not yet generated — it will appear after the audit loads."}

## Memory Index
The entries below are durable facts learned about this student in prior conversations. Each line is \`#<id> [<type>] <description>\` — the description is intentionally terse and is NOT sufficient grounding on its own. To use a memory in your response, call \`recall_memory\` with the relevant ID(s); this loads the full content. If nothing in the index looks relevant to the student's current message, don't call the tool — unrelated recalls waste turns.

${memoryIndex || "(no memories yet — the background curator populates these from future conversations.)"}

## Placeholders
The student's name, advisor name, and advisor email appear in the audit as the literal tokens [NAME], [ADVISOR], and [ADVISOR_EMAIL]. These are privacy placeholders — the extension substitutes real values on the client side before the chat is rendered. Use the tokens verbatim when addressing the student or referencing their advisor; never ask for the real values and never guess. If the audit shows "(advisor email not provided)" in place of the email token, the advisor's email isn't available — in that case, don't suggest emailing the advisor; suggest checking DegreeWorks or the Office of Academic Advising instead.

**When the student asks about their own identity details** ("what is my name?", "what is my advisor's email?", "who is my advisor?"), just answer using the token directly — e.g. "You're [NAME]" or "Your advisor is [ADVISOR]; their email is [ADVISOR_EMAIL]". **Do NOT explain the placeholder/substitution mechanism in your reply.** From your vantage point the tokens are identity-opaque, but the student sees the real values after client-side substitution — meta-explaining the substitution reads as "your name is a placeholder for your name" and confuses them. Only explain the PII boundary if they explicitly ask how their data is handled or why you seem to "know" their name.

## Reading the audit — authoritative format

The audit text in your system prompt uses a specific format. Every incomplete requirement block is followed by indented \`→ still need: …\` lines naming the exact course(s) or attribute-tagged requirement. Examples:

\`\`\`
[ ] American Pluralism
    → still need 1 of 1: any class with attribute = PLUR and with credits >= 3

[~] The Fine Arts
    → applied: MUSC 1100 (IP)
    → still need 1: ARHI 1101, ARHI 1102, …; any class with attribute = FACC

[ ] Research Experience Capstone
    → still need 1 of 1: NEUR 4900
\`\`\`

When a student asks "what does X require?" or "what's left for Y?": find the block named X/Y in the audit, read the \`→ still need:\` lines directly below it, and cite those requirements. These lines are the authoritative answer — they come straight from the DegreeWorks rule engine. DO NOT call \`search_catalog\` as a first move for requirement questions; re-read the audit first. Only call \`search_catalog\` after you've identified the requirement and the student wants to know SECTIONS (CRNs, meeting times, open seats, instructors).

### Concentration rules span multiple sibling entries

DegreeWorks sometimes returns a concentration's sub-requirements as SIBLING rules in the same major block, not as children of the concentration container. For example, the "Systems/Computational Concentration" rule may only contain the "Coursework" sub-rule, while "Research Experience" and "Research Experience Capstone" appear later in the same block as top-level siblings — even though the DegreeWorks web UI visually nests all three under the concentration.

**When the student asks about a concentration (e.g. "what does my Systems/Computational concentration still need?"), include every related sibling rule in the same major block, not just what's literally nested under the concentration label.** The convention: "Research Experience", "Research Experience Capstone", and similarly-named sibling rules that appear immediately after a concentration block are part of that concentration's requirement set. Scan the major block for them and cite all of them. If you only mention what's nested under the concentration label, the student gets an incomplete picture.

### Bare-incomplete rules (important escape hatch)

Occasionally a rule renders as just \`[ ] Some Requirement\` with NO \`→\` sub-content — or with a literal note like \`→ (audit did not expose specifics — call list_attributes + search_catalog…)\`. This happens for some concentration containers where the DegreeWorks web UI shows sub-rules but the JSON API doesn't expose them. When you see this:

1. **Do NOT say "details unclear from audit" and stop.** That leaves the student stuck.
2. Call \`list_attributes\` to discover attribute codes plausibly tied to the rule (e.g. a "Systems/Computational Concentration" rule likely maps to attributes like NESY, NEUR, or the concentration's initials).
3. Then \`search_catalog\` with those attributes to show the student what COULD satisfy the rule.
4. Briefly flag in your reply that the audit doesn't fully expose this rule's sub-requirements and recommend the student confirm with their advisor OR open the DegreeWorks UI to see the nested details.

Status markers: \`[x]\` = complete, \`[~]\` = in progress, \`[IP]\` = in-progress course, \`[ ]\` = not yet complete.

## Tools
You have six tools:

1. \`search_catalog\` — returns real CRNs, meeting times, instructors, seat counts, and the full attribute-code list on each section. Call it whenever the student asks about specific courses, electives, schedules, open seats, professors, or what's offered. NEVER guess section availability or meeting times — always search. You may call it multiple times per turn to combine filters (e.g. search CISC 3000-level and MATH 3000-level separately), and you can pass an \`attributes\` array to intersect Fordham's requirement tags (e.g. \`{attributes: ["ICC","AMER"]}\` finds sections that satisfy BOTH ICC and American Pluralism).

2. \`list_attributes\` — returns the distinct set of Fordham requirement-tag attributes present in the catalog, with their codes, human descriptions, and section counts. Fordham uses these attributes for core curriculum (American Pluralism, ICC, Eloquentia Perfecta, Global Studies, Values Seminar), major/concentration requirements, and cross-listings. **MANDATORY: before ANY \`search_catalog\` call that uses an \`attributes\` filter, you MUST have called \`list_attributes\` at least once this conversation.** Never guess attribute codes; they're not intuitive (e.g. concentration codes like NESY/NEUR are obvious only in retrospect). list_attributes is cheap — call it the first time the student asks about any requirement-tagged category, then reuse the results for the rest of the conversation.

3. \`recall_memory\` — loads the full content of one or more memories by ID from the Memory Index above. Pass an array of IDs. Use this when the student's message relates to a memory description. Batch related IDs in a single call. Don't call it if nothing in the index looks relevant to what the student just asked.

4. \`save_memory\` — persists a durable fact about the student to the long-term memory store. Use this when the student explicitly asks you to remember something ("remember I want to take gender studies", "keep track that I work Fridays") OR when they state a clear durable commitment you should hold onto. Prefer saving over promising ("I'll remember that") when the fact is unambiguous. DO NOT save disabilities, diagnoses, medications, mental-health topics, or family-crisis disclosures — acknowledge them warmly in your reply but do not persist them.

5. \`forget_memory\` — deletes one or more memories by ID. Use this when the student says something is no longer true ("I changed my mind about the CS minor", "forget that I work on Fridays"). Look up the matching ID(s) in the Memory Index above — the description tells you which entry to delete. Only delete what the student explicitly asked to remove.

6. \`run_what_if\` — runs a hypothetical What-If audit against the student's real DegreeWorks data. Takes a major code (required), optional minor, optional concentration, and optional look-ahead classes. Returns the full audit text under the hypothetical scenario. Use this when the student asks "what if I switched to psychology?" or "how would my credits transfer if I changed my major?" Compare the result to the real audit above and describe the differences — new requirements, newly-satisfied blocks, remaining gaps. This hits the real audit engine with the student's real transcript, so the results are authoritative.

## Response Style
- Be concise and direct — no filler like "Great question!" or restating the question
- Use bullet points or numbered lists for multi-part answers
- Reference exact course codes (e.g. CISC 3810) and requirement names from the audit
- Format courses as: **SUBJ 1234** — Course Title
- When recommending sections, include CRN, days/time, instructor, and seats available
- **When asking the student a clarifying question, wrap the question itself in \`**bold**\`** so they can spot it at a glance when the reply has preceding context or options. Example: "Two of those sections fit your window. **Do you want me to also check CISC 3000-level options for backup?**"
- If something is unclear from the audit, say so rather than guessing

## Tone
Friendly but professional — like a knowledgeable peer advisor.

## Constraints
- Ground requirement advice in the audit data below
- Ground section/schedule advice in search_catalog results — never invent CRNs or times

=== LIVE DEGREEWORKS AUDIT ===
${auditText || "Audit not loaded. Ask the student to visit their DegreeWorks page."}
==============================`;

  // Wrap the system prompt in a cache breakpoint so Anthropic caches the
  // (~3k-token) audit + instructions for 5 minutes. Turn 2+ in the same
  // conversation reads the prefix from cache — ~90% input-token savings.
  // Cache invalidates automatically if `profile` or `auditText` change.
  const system: Anthropic.Messages.TextBlockParam[] = [
    { type: "text", text: systemText, cache_control: { type: "ephemeral" } },
  ];

  // Mutable conversation for the tool-use loop. Starts with the UI's history,
  // grows as we append assistant (with tool_use blocks) + user (with
  // tool_result blocks) turns until Claude stops asking for tools.
  const convo: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Hoisted out of the tool-use loop so the curator (fire-and-forget after
  // AI_DONE) can see the assistant's final text blocks.
  let finalMessage: Anthropic.Messages.Message | null = null;

  try {
    // Cap at 5 tool-use rounds per user turn — generous but prevents runaway.
    for (let round = 0; round < 5; round++) {
      const stream = await client.messages.stream(
        {
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          system,
          tools: mode === "onboarding"
            ? [SEARCH_CATALOG_TOOL, LIST_ATTRIBUTES_TOOL, SAVE_MEMORY_TOOL, COMPLETE_ONBOARDING_TOOL]
            : [SEARCH_CATALOG_TOOL, LIST_ATTRIBUTES_TOOL, RECALL_MEMORY_TOOL, SAVE_MEMORY_TOOL, FORGET_MEMORY_TOOL, WHAT_IF_AUDIT_TOOL],
          messages: convo,
        },
        { signal: controller.signal }
      );

      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          broadcast({ type: "AI_CHUNK", delta: chunk.delta.text });
        }
      }

      const final = await stream.finalMessage();
      finalMessage = final;

      if (final.stop_reason !== "tool_use") break;

      // Append Claude's partial turn (may contain text + tool_use blocks)
      convo.push({ role: "assistant", content: final.content });

      // Execute every tool_use block in this turn and collect results
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of final.content) {
        if (block.type !== "tool_use") continue;

        // Silent tools: save_memory during onboarding (deferred-batch flow —
        // the system-action bubble at end-of-intake renders the full list,
        // so per-turn chips would duplicate the signal and contradict the
        // "saves are invisible mid-intake" guarantee in ADR 0014 revisit).
        const isSilentTool =
          block.name === "save_memory" && mode === "onboarding";
        if (!isSilentTool) {
          broadcast({ type: "AI_TOOL_USE", name: block.name, input: block.input });
        }

        try {
          let resultJson: string;
          let resultCount = 0;

          if (block.name === "search_catalog") {
            const result = await executeCatalogSearch(block.input as CatalogSearchInput);
            resultJson = JSON.stringify(result);
            resultCount = result.length;
          } else if (block.name === "list_attributes") {
            const result = await executeListAttributes();
            resultJson = JSON.stringify(result);
            resultCount = result.length;
          } else if (block.name === "recall_memory") {
            const result = await executeRecallMemory(block.input as RecallMemoryInput);
            resultJson = JSON.stringify(result);
            resultCount = result.length;
          } else if (block.name === "save_memory") {
            const input = block.input as SaveMemoryInput;
            if (mode === "onboarding") {
              // Onboarding mode: queue only — the batch commits atomically when
              // Sonnet calls complete_onboarding. No toast, no MEMORY_UPDATED
              // broadcast here; the student sees the full list rendered in the
              // system-action bubble at the end.
              const queued = await queueOnboardingSave({
                type: input.type,
                description: input.description,
                content: input.content,
                sourceQuote: input.sourceQuote,
              });
              resultJson = JSON.stringify(queued);
            } else {
              const result = await executeSaveMemory(input);
              resultJson = JSON.stringify(result);
              if (result.saved) {
                const updated = await loadMemories();
                broadcast({ type: "MEMORY_UPDATED", memories: updated });
                broadcast({
                  type: "AI_CURATOR_SAVED",
                  kind: "saved",
                  memoryType: input.type,
                  description: input.description,
                });
              }
            }
          } else if (block.name === "complete_onboarding") {
            if (mode !== "onboarding") {
              resultJson = JSON.stringify({
                error: "complete_onboarding may only be called in onboarding mode.",
              });
            } else if (
              (await chrome.storage.local.get("onboardingCompletedAt"))
                .onboardingCompletedAt
            ) {
              // Idempotency: the prompt says call once, but defend anyway.
              // A second call within the same handleAIChat would drain an
              // empty queue and emit a duplicate system-action bubble. Refuse
              // politely so the model can just write the wrap-up.
              resultJson = JSON.stringify({
                alreadyCompleted: true,
                message: "Intake already finalized. Proceed with the wrap-up.",
              });
            } else {
              // Drain the queue, then persist each item through addMemory so
              // the Jaccard dedup runs against already-existing memories too
              // (e.g. from a prior incomplete intake). Broadcasts let the UI
              // render the system-action bubble and populate it progressively.
              const queued = await loadOnboardingQueue();
              broadcast({
                type: "ONBOARDING_SAVES_START",
                items: queued.map((q) => ({
                  type: q.type,
                  description: q.description,
                  sourceQuote: q.sourceQuote,
                })),
              });
              let savedCount = 0;
              for (let i = 0; i < queued.length; i++) {
                const q = queued[i];
                await addMemory({
                  type: q.type,
                  description: q.description,
                  content: q.content,
                  sourceQuote: q.sourceQuote,
                });
                broadcast({ type: "ONBOARDING_SAVE_COMMITTED", index: i });
                savedCount++;
              }
              await clearOnboardingQueue();
              const memories = await loadMemories();
              broadcast({ type: "MEMORY_UPDATED", memories });
              broadcast({ type: "ONBOARDING_SAVES_DONE", count: savedCount });

              const now = Date.now();
              await chrome.storage.local.set({ onboardingCompletedAt: now });
              broadcast({ type: "ONBOARDING_COMPLETED", completedAt: now });

              resultJson = JSON.stringify({
                savedCount,
                message:
                  `Saved ${savedCount} memories. Now give your warm 3-4 line wrap-up summary.`,
              });
            }
          } else if (block.name === "forget_memory") {
            const result = await executeForgetMemory(block.input as ForgetMemoryInput);
            resultJson = JSON.stringify(result);
            resultCount = result.deleted.length;
            if (result.deleted.length > 0) {
              const updated = await loadMemories();
              broadcast({ type: "MEMORY_UPDATED", memories: updated });
            }
          } else if (block.name === "run_what_if") {
            const result = await executeWhatIf(block.input as WhatIfInput);
            resultJson = result;
          } else {
            resultJson = `Error: unknown tool "${block.name}"`;
          }

          if (!isSilentTool) {
            broadcast({
              type: "AI_TOOL_RESULT",
              name: block.name,
              courseCount: resultCount,
            });
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: resultJson,
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      }

      convo.push({ role: "user", content: toolResults });
    }

    broadcast({ type: "AI_DONE" });

    // Fire-and-forget memory curation. Haiku scans the just-completed turn
    // for durable facts about the student. Stub mode (write: false) logs
    // candidates to the console without persisting — flip to true once the
    // prompt is tuned. Failures are swallowed so the user-visible path is
    // unaffected.
    const lastUser = messages[messages.length - 1];
    const finalText = finalMessage
      ? finalMessage.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim()
      : "";
    // Curator runs only in normal mode — onboarding writes memories directly
    // via save_memory so running Haiku on top would double-extract. Also
    // gated by the student-facing auto-save toggle (Settings → "Auto-save
    // memories from chat"); when OFF the curator is skipped entirely.
    if (mode === "normal" && lastUser?.role === "user" && finalText) {
      const autoSaveOn = await isCuratorAutoSaveEnabled();
      if (autoSaveOn) {
        appendCuratorTurn({ user: lastUser.content, assistant: finalText })
          .then(async (window) => {
            const result = await runCurator(apiKey, window, { write: true });
            // Emit a toast-friendly broadcast for each hard-fact save or
            // provisional promotion. The sidebar renders these as a single-
            // slot toast that auto-dismisses and gets replaced by the next.
            for (const fact of result.hardFacts) {
              broadcast({
                type: "AI_CURATOR_SAVED",
                kind: "saved",
                memoryType: fact.type,
                description: fact.description,
              });
            }
            for (const promoted of result.promoted) {
              broadcast({
                type: "AI_CURATOR_SAVED",
                kind: "promoted",
                memoryType: promoted.type,
                description: promoted.description,
              });
            }
            if (result.hardFacts.length > 0 || result.promoted.length > 0 || result.absorbed > 0) {
              const memories = await loadMemories();
              broadcast({ type: "MEMORY_UPDATED", memories });
            }
            if (result.provisionalHits.length > 0 || result.promoted.length > 0 || result.absorbed > 0) {
              const provisional = await loadProvisional();
              broadcast({ type: "PROVISIONAL_UPDATED", provisional });
            }
          })
          .catch((err) => console.warn("[Curator] unhandled error:", err));
      } else {
        console.log("[Curator] Skipped — auto-save toggle is OFF.");
      }
    }
  } catch (err) {
    // AbortError is expected on panel close / new turn preempt — don't
    // surface as a user-visible error. The partial response that already
    // streamed stays in session storage; a future turn continues cleanly.
    const isAbort =
      (err instanceof Error && err.name === "AbortError") || controller.signal.aborted;
    if (isAbort) {
      console.log("[FordhamHelper] Chat stream aborted (panel closed or new turn).");
      broadcast({ type: "AI_DONE" });
    } else {
      broadcast({ type: "AI_ERROR", error: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    if (currentChatController === controller) currentChatController = null;
  }
}

// ─── Course Catalog Refresh ───────────────────────────────────────────────────

async function refreshCatalog(term: string): Promise<void> {
  console.log(`[FordhamHelper] Refreshing catalog for term ${term}...`);
  broadcast({ type: "CATALOG_PROGRESS", done: 0, total: 1, label: "starting" });

  try {
    const rawSections = await fetchAllSectionsForTerm(term, (done, total, label) => {
      broadcast({ type: "CATALOG_PROGRESS", done, total, label });
    });

    if (rawSections.length > 0) {
      const uniqueSubjects = new Set(rawSections.map((s) => s.subject));
      const uniqueCourseCodes = new Set(rawSections.map((s) => `${s.subject} ${s.courseNumber}`));
      const uniqueAttributes = new Set<string>();
      let sectionsWithAttrs = 0;
      for (const s of rawSections) {
        const attrs = s.sectionAttributes ?? [];
        if (attrs.length > 0) sectionsWithAttrs++;
        for (const a of attrs) uniqueAttributes.add(a.code);
      }
      console.log(
        `[FordhamHelper] Raw fetch: ${rawSections.length} sections, ` +
          `${uniqueSubjects.size} unique subjects, ${uniqueCourseCodes.size} unique courses`
      );
      console.log(
        `[FordhamHelper] Attributes: ${uniqueAttributes.size} distinct codes across ` +
          `${sectionsWithAttrs}/${rawSections.length} sections`
      );
      console.log("[FordhamHelper] Subjects seen:", Array.from(uniqueSubjects).sort().join(", "));
    }

    const courses = bannerSectionsToCourses(rawSections);
    await saveCourses(courses);

    const updatedAt = Date.now();
    await chrome.storage.local.set({
      catalogTerm: term,
      catalogUpdatedAt: updatedAt,
      catalogCourseCount: courses.length,
    });

    console.log(
      `[FordhamHelper] Catalog saved: ${courses.length} courses, ${rawSections.length} sections for ${term}`
    );
    broadcast({
      type: "CATALOG_READY",
      term,
      courseCount: courses.length,
      sectionCount: rawSections.length,
      updatedAt,
    });
  } catch (err) {
    console.error("[FordhamHelper] Catalog refresh failed:", err);
    broadcast({
      type: "CATALOG_ERROR",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getApiKey(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get("anthropicApiKey", (r) => {
      resolve((r.anthropicApiKey as string) ?? null);
    });
  });
}

function broadcast(message: object): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}
