// `search_catalog` tool. Schema + executor logic live in ../catalog-search.ts
// (the catalog-query module); this file adapts them to the ToolDef contract.
// Implements: ADR 0019 — see notes/decisions/.

import {
  executeCatalogSearch,
  SEARCH_CATALOG_TOOL,
  type CatalogSearchInput,
} from "../catalog-search";
import type { ToolDef } from "./types";

export const searchCatalogTool: ToolDef = {
  schema: SEARCH_CATALOG_TOOL,
  async execute(input) {
    const result = await executeCatalogSearch(input as CatalogSearchInput);
    return JSON.stringify(result);
  },
  resultCount(raw) {
    return (JSON.parse(raw as string) as unknown[]).length;
  },
};
