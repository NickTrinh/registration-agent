// Shared domain types for the registration helper UI + Banner catalog path.
//
// Raw DegreeWorks API shapes live in `./degreeworks-types.ts` — keep them out
// of this file. This module is for the Banner-sourced course catalog, the
// chat message shape, and anything else shared between sidebar and worker.

// ─── Course Catalog (Banner-sourced) ──────────────────────────────────────────

export interface Course {
  courseCode: string;
  subject: string;
  title: string;
  credits: number;
  description: string;
  prerequisites: string;
  sections: Section[];
}

export interface Section {
  crn: string;
  instructor: string;
  seatsAvailable: number;
  campus: string;
  deliveryMode: "in_person" | "online" | "hybrid";
  meetings: MeetingTime[];
  attributes: SectionAttribute[];
}

// Fordham's section-level requirement tags — core curriculum (e.g. American
// Pluralism, ICC), major/concentration requirements, per-course flags. See
// banner-ssb-client.ts for the raw shape.
export interface SectionAttribute {
  code: string;
  description: string;
}

export interface MeetingTime {
  days: Day[];
  startTime: string;  // "14:00"
  endTime: string;    // "15:15"
  building: string;
  room: string;
}

export type Day = "M" | "T" | "W" | "R" | "F";

// ─── AI Conversation ──────────────────────────────────────────────────────────

export interface ToolEvent {
  name: string;
  input: Record<string, unknown>;
  // Filled in when the corresponding AI_TOOL_RESULT arrives. Undefined while
  // the tool call is still in flight so the chip can show a "searching…" state.
  courseCount?: number;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  // Only present on assistant messages that triggered tool calls. The chat UI
  // renders these as chips above the message body. Stripped before the list
  // is sent to Anthropic — see service-worker.ts handleAIChat.
  toolEvents?: ToolEvent[];
  // When present, this message renders as a system-action bubble instead of
  // AI prose (e.g. onboarding batch-save at end of intake). Streaming handlers
  // treat systemAction bubbles as non-append targets so the next AI chunk
  // creates a fresh bubble. Filtered out before the history is sent to
  // Anthropic — it represents a UI event, not a turn in the conversation.
  systemAction?: SystemAction;
}

export interface SystemActionItem {
  type: MemoryType;
  description: string;
  sourceQuote?: string;
  status: "pending" | "saved";
}

export interface SystemAction {
  kind: "onboarding-saves";
  items: SystemActionItem[];
  done: boolean;
}

// ─── Long-term Memory (routing-table architecture) ───────────────────────────

// Memory writes come from a Haiku "curator" model that scans each chat turn
// for durable facts about the student (interests, constraints, goals). The
// main chat model (Sonnet) sees only the short `description` in a routing
// index, and must call `recall_memory` to load the full `content` on demand.
// See notes/IMPLEMENTATION-PLAN.md for the full design rationale.

export type MemoryType = "interest" | "constraint" | "goal" | "decision" | "note";

export interface MemoryEntry {
  id: number;
  type: MemoryType;
  description: string; // ≤10 words; shown in the routing index
  content: string;     // full memory body; loaded via recall_memory
  // Verbatim quote from the student's message that triggered the save. Shown
  // in Settings as "you said: ..." so the student can trace why each memory
  // exists and trust the system. Optional because legacy entries predate
  // this field and the consolidation/dedup path merges may not preserve it.
  sourceQuote?: string;
  createdAt: number;   // epoch ms
  lastAccessedAt: number;
}

// Provisional interests — the curator's "maybe" tier. Soft signals (a topic
// the student hinted at but didn't explicitly commit to) land here instead of
// the memory store. When the same topic accumulates enough consistent hits
// across turns/sessions, it gets promoted to a real MemoryEntry. Absorbed
// (deleted) when a hard fact on the same topic arrives.
//
// Stored under a separate chrome.storage.local key so it never enters Sonnet's
// system prompt — only the curator (Haiku) sees these.
export interface ProvisionalInterest {
  id: number;
  topic: string;              // short topic identifier, e.g. "theology/middle-east"
  description: string;        // human-readable hook (what it would become if promoted)
  proposedType: MemoryType;   // what type it would become if promoted
  count: number;              // total mention count across turns
  framings: string[];         // short snippets of each mention, used for consistency
  createdAt: number;
  lastSeenAt: number;
}
