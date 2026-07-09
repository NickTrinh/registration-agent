// `recall_memory` tool. Schema + executor live in ../memory-store.ts.
// Implements: ADR 0019 — see notes/decisions/.

import {
  executeRecallMemory,
  RECALL_MEMORY_TOOL,
  type RecallMemoryInput,
} from "../memory-store";
import type { ToolDef } from "./types";

export const recallMemoryTool: ToolDef = {
  schema: RECALL_MEMORY_TOOL,
  async execute(input) {
    const result = await executeRecallMemory(input as RecallMemoryInput);
    return JSON.stringify(result);
  },
  resultCount(raw) {
    return (JSON.parse(raw as string) as unknown[]).length;
  },
};
