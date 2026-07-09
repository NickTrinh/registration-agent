// `save_memory` tool. Two behaviors, selected by ctx.mode:
//   - onboarding: queue only — the batch commits atomically when the model
//     calls complete_onboarding. No toast, no MEMORY_UPDATED broadcast; the
//     student sees the full list in the system-action bubble at end-of-intake.
//     (Silent in onboarding — see silentIn / ADR 0014 revisit.)
//   - normal: persist immediately, then broadcast MEMORY_UPDATED + the
//     AI_CURATOR_SAVED toast.
// Executor + schema live in ../memory-store.ts; the mode branching moved here
// intact from the service-worker tool loop.
// Implements: ADR 0019 — see notes/decisions/.

import {
  executeSaveMemory,
  queueOnboardingSave,
  loadMemories,
  SAVE_MEMORY_TOOL,
  type SaveMemoryInput,
} from "../memory-store";
import type { ToolDef } from "./types";

export const saveMemoryTool: ToolDef = {
  schema: SAVE_MEMORY_TOOL,
  silentIn: ["onboarding"],
  async execute(rawInput, ctx) {
    const input = rawInput as SaveMemoryInput;
    if (ctx.mode === "onboarding") {
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
      return JSON.stringify(queued);
    }
    const result = await executeSaveMemory(input);
    if (result.saved) {
      const updated = await loadMemories();
      ctx.broadcast({ type: "MEMORY_UPDATED", memories: updated });
      ctx.broadcast({
        type: "AI_CURATOR_SAVED",
        kind: "saved",
        memoryType: input.type,
        description: input.description,
      });
    }
    return JSON.stringify(result);
  },
};
