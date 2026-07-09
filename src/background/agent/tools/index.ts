// Tool registry. TOOLSETS defines which tools each chat mode advertises to the
// model (identical memberships to the pre-refactor service-worker tool arrays);
// REGISTRY is the by-name dispatch table the chat loop looks executors up in.
// Adding a tool = one new file here + one line in each.
// Implements: ADR 0019 — see notes/decisions/.

import type { ChatMode, ToolDef } from "./types";
import { searchCatalogTool } from "./search-catalog";
import { listAttributesTool } from "./list-attributes";
import { recallMemoryTool } from "./recall-memory";
import { saveMemoryTool } from "./save-memory";
import { forgetMemoryTool } from "./forget-memory";
import { whatIfTool } from "./what-if";
import { completeOnboardingTool } from "./complete-onboarding";

// Per-mode advertised tool sets — mirrors service-worker.ts:979–981 pre-refactor.
export const TOOLSETS: Record<ChatMode, ToolDef[]> = {
  onboarding: [searchCatalogTool, listAttributesTool, saveMemoryTool, completeOnboardingTool],
  normal: [
    searchCatalogTool,
    listAttributesTool,
    recallMemoryTool,
    saveMemoryTool,
    forgetMemoryTool,
    whatIfTool,
  ],
};

// By-name dispatch table. The union of every tool across modes; the chat loop
// resolves an incoming tool_use block's name here.
export const REGISTRY: Record<string, ToolDef> = Object.fromEntries(
  [
    searchCatalogTool,
    listAttributesTool,
    recallMemoryTool,
    saveMemoryTool,
    forgetMemoryTool,
    whatIfTool,
    completeOnboardingTool,
  ].map((t) => [t.schema.name, t])
);
