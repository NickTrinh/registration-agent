// `list_attributes` tool. Schema + executor live in ../catalog-search.ts.
// Implements: ADR 0019 — see notes/decisions/.

import { executeListAttributes, LIST_ATTRIBUTES_TOOL } from "../catalog-search";
import type { ToolDef } from "./types";

export const listAttributesTool: ToolDef = {
  schema: LIST_ATTRIBUTES_TOOL,
  async execute() {
    const result = await executeListAttributes();
    return JSON.stringify(result);
  },
  resultCount(raw) {
    return (JSON.parse(raw as string) as unknown[]).length;
  },
};
