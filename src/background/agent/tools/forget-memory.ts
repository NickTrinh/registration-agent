// `forget_memory` tool. Schema + executor live in ../memory-store.ts; the
// post-delete MEMORY_UPDATED broadcast moved here from the tool loop.
// Implements: ADR 0019 — see notes/decisions/.

import {
  executeForgetMemory,
  loadMemories,
  FORGET_MEMORY_TOOL,
  type ForgetMemoryInput,
} from "../memory-store";
import type { ToolDef } from "./types";

export const forgetMemoryTool: ToolDef = {
  schema: FORGET_MEMORY_TOOL,
  async execute(input, ctx) {
    const result = await executeForgetMemory(input as ForgetMemoryInput);
    if (result.deleted.length > 0) {
      const updated = await loadMemories();
      ctx.broadcast({ type: "MEMORY_UPDATED", memories: updated });
    }
    return JSON.stringify(result);
  },
  resultCount(raw) {
    return (JSON.parse(raw as string) as { deleted: number[] }).deleted.length;
  },
};
