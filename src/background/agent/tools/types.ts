// Tool-registry contracts for the chat loop. A ToolDef bundles a tool's
// Anthropic schema with its executor and the two behaviors the chat loop needs
// to know without a per-tool if/else: how to count results for the UI chip, and
// which modes it runs silently in. See tools/index.ts for the registry.
// Implements: ADR 0019 — see notes/decisions/.

import type Anthropic from "@anthropic-ai/sdk";

export type ChatMode = "normal" | "onboarding";

// Cached student metadata from the most recent audit refresh. Owned by the
// service worker (persist/hydrate), passed to the What-If tool through
// ToolContext so it doesn't need a redundant /students/myself call.
//
// All three of college / major / concentration are required by the What-If
// endpoint (a full curriculum spec, not a partial one). See ADR 0006 / 0016.
export interface StudentGoal {
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

// The capabilities a tool executor may reach for. These are all worker-owned
// (broadcast, the refresh flow, the student-cache accessors) and injected so
// tool files never import the service worker (which would cycle).
export interface ToolContext {
  mode: ChatMode;
  broadcast: (message: object) => void;
  refreshAudit: () => Promise<void>;
  hydrateStudentCache: () => Promise<{ id: string | null; goal: StudentGoal | null }>;
}

export interface ToolDef {
  schema: Anthropic.Messages.Tool;   // name, description, input_schema
  execute(input: unknown, ctx: ToolContext): Promise<string>;  // returns result JSON/text
  resultCount?(raw: unknown): number;  // parses execute's return for the AI_TOOL_RESULT chip
  silentIn?: ChatMode[];               // e.g. save_memory in "onboarding"
}
