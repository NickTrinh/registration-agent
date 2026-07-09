// Implements: ADR 0032 (extracted from OnboardingSavesBubble so Settings can
// share it — memory types wear the same colors everywhere they appear).
//
// The safe accessor exists because live data has already produced a type
// OUTSIDE the MemoryType union ("preference", from an older prompt). The UI
// renders what the store actually holds: unknown types fall back to the
// note treatment but keep their own label, instead of lying "NOTE".

import type { MemoryType } from "../../shared/types";

export interface MemoryTypeStyle {
  label: string;
  bg: string;
  text: string;
}

export const MEMORY_TYPE_STYLE: Record<MemoryType, MemoryTypeStyle> = {
  interest: { label: "INTEREST", bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-800 dark:text-purple-200" },
  constraint: { label: "CONSTRAINT", bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-800 dark:text-amber-200" },
  goal: { label: "GOAL", bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-800 dark:text-blue-200" },
  decision: { label: "DECISION", bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-800 dark:text-green-200" },
  note: { label: "NOTE", bg: "bg-stone-100 dark:bg-stone-800", text: "text-stone-700 dark:text-stone-300" },
};

export function memoryTypeStyle(type: string): MemoryTypeStyle {
  const known = MEMORY_TYPE_STYLE[type as MemoryType];
  if (known) return known;
  return { ...MEMORY_TYPE_STYLE.note, label: type.toUpperCase() };
}
