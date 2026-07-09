// Extension service worker: message router, audit refresh, Anthropic chat loop
// with tool use, Banner catalog refresh, and long-term memory curator.
// Implements: ADR 0003 — see notes/decisions/. This file is the enforcement
// point for "service worker owns all third-party API calls; content scripts
// are thin taps." Every fetch against DegreeWorks, Banner, and Anthropic
// flows through handlers defined here, and all chrome.storage.local writes
// are owned by the worker so in-memory caches stay coherent.
// Implements: ADR 0021 (MV3 keepalive on extractProfile + refreshCatalog).
//
// The agent layer (chat loop, prompts, tool registry) lives under agent/;
// this file owns the caches, refresh flows, and message router, and injects
// its worker-owned capabilities into the chat loop as `deps`. See ADR 0019.

import Anthropic from "@anthropic-ai/sdk";
import type { ConversationMessage } from "../shared/types";
import {
  getTerms,
  fetchAllSectionsForTerm,
} from "./agent/banner-ssb-client";
import { bannerSectionsToCourses } from "./agent/banner-to-course";
import { saveCourses } from "../shared/db";
import {
  fetchStudentMyself,
  fetchCurrentAudit,
  DegreeWorksAuthError,
} from "./agent/degreeworks-api-client";
import { auditResponseToText } from "./agent/degreeworks-audit-to-text";
import {
  loadMemories,
  deleteMemory,
  clearMemories,
  loadProvisional,
  deleteProvisional,
  clearProvisional,
  editMemory,
  type MemoryEditInput,
} from "./agent/memory-store";
import type { ConversationTurn } from "./agent/memory-curator";
import { handleAIChat, cancelCurrentChat, type ChatDeps } from "./agent/chat-loop";
import type { ChatMode, StudentGoal } from "./agent/tools/types";
import { buildProfileExtractionPrompt } from "./agent/prompts";
import { withKeepalive } from "./keepalive";

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
// StudentGoal shape lives in agent/tools/types.ts (the What-If tool consumes it).
const STUDENT_ID_KEY = "studentId";
const STUDENT_GOAL_KEY = "studentGoal";

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

// Worker-owned capabilities handed to the chat loop. Everything here touches
// worker state (caches, the refresh flow, the curator buffer) — the chat loop
// itself imports none of it, avoiding an import cycle.
const chatDeps: ChatDeps = {
  getApiKey,
  broadcast,
  refreshAudit,
  hydrateStudentCache,
  appendCuratorTurn,
  isCuratorAutoSaveEnabled,
};

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
        (message.mode as ChatMode | undefined) ?? "normal",
        chatDeps
      );
      break;
    }

    case "CANCEL_AI_CHAT": {
      cancelCurrentChat();
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
  // real name or email. The extraction template (in prompts.ts) also doesn't
  // ask for Name/Advisor, so there's no prompt pressure to hallucinate them.
  try {
    // Keepalive: this runs on its own (post-refresh, no queued UI event), so
    // the MV3 idle kill could land mid-call and drop the profile write.
    const response = await withKeepalive(client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: buildProfileExtractionPrompt(auditText),
      }],
    }));

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

// ─── Course Catalog Refresh ───────────────────────────────────────────────────

async function refreshCatalog(term: string): Promise<void> {
  console.log(`[FordhamHelper] Refreshing catalog for term ${term}...`);
  broadcast({ type: "CATALOG_PROGRESS", done: 0, total: 1, label: "starting" });

  try {
    // Keepalive: the term-wide Banner fetch paginates for many seconds with no
    // queued UI event behind it — the classic MV3 idle-kill window. Hold the
    // worker awake until the fetch resolves.
    const rawSections = await withKeepalive(
      fetchAllSectionsForTerm(term, (done, total, label) => {
        broadcast({ type: "CATALOG_PROGRESS", done, total, label });
      })
    );

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
