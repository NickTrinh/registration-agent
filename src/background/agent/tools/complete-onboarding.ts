// `complete_onboarding` tool. Drains the onboarding save queue atomically,
// persists each item through addMemory (re-running Jaccard dedup against
// existing memories), broadcasts progress for the system-action bubble, sets
// the completion flag, and tells Sonnet to write its wrap-up. Schema + queue
// lifecycle live in ../memory-store.ts; the drain logic moved here intact from
// the service-worker tool loop.
// Implements: ADR 0019 — see notes/decisions/.

import {
  loadOnboardingQueue,
  clearOnboardingQueue,
  addMemory,
  loadMemories,
  COMPLETE_ONBOARDING_TOOL,
} from "../memory-store";
import type { ToolDef } from "./types";

export const completeOnboardingTool: ToolDef = {
  schema: COMPLETE_ONBOARDING_TOOL,
  async execute(_input, ctx) {
    if (ctx.mode !== "onboarding") {
      return JSON.stringify({
        error: "complete_onboarding may only be called in onboarding mode.",
      });
    }
    if ((await chrome.storage.local.get("onboardingCompletedAt")).onboardingCompletedAt) {
      // Idempotency: the prompt says call once, but defend anyway. A second
      // call within the same handleAIChat would drain an empty queue and emit
      // a duplicate system-action bubble. Refuse politely so the model can
      // just write the wrap-up.
      return JSON.stringify({
        alreadyCompleted: true,
        message: "Intake already finalized. Proceed with the wrap-up.",
      });
    }

    // Drain the queue, then persist each item through addMemory so the Jaccard
    // dedup runs against already-existing memories too (e.g. from a prior
    // incomplete intake). Broadcasts let the UI render the system-action bubble
    // and populate it progressively.
    const queued = await loadOnboardingQueue();
    ctx.broadcast({
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
      ctx.broadcast({ type: "ONBOARDING_SAVE_COMMITTED", index: i });
      savedCount++;
    }
    await clearOnboardingQueue();
    const memories = await loadMemories();
    ctx.broadcast({ type: "MEMORY_UPDATED", memories });
    ctx.broadcast({ type: "ONBOARDING_SAVES_DONE", count: savedCount });

    const now = Date.now();
    await chrome.storage.local.set({ onboardingCompletedAt: now });
    ctx.broadcast({ type: "ONBOARDING_COMPLETED", completedAt: now });

    return JSON.stringify({
      savedCount,
      message: `Saved ${savedCount} memories. Now give your warm 3-4 line wrap-up summary.`,
    });
  },
};
