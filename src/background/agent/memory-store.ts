// Long-term memory store — routing-table architecture.
//
// Writes come from a Haiku "curator" model that scans each chat turn for
// durable facts about the student (interests, constraints, goals, decisions).
// The main chat model (Sonnet) sees only a short `description` for each entry
// in a routing index, and must call `recall_memory` to page in the full
// `content` on demand. See ADRs 0011–0015 in notes/decisions/ for the full
// design rationale.
//
// Scope: single bucket per extension install (not per-Banner-ID namespaced),
// capped at MAX_MEMORIES with drop-oldest eviction by `createdAt`. The service
// worker is the only *process* that writes — sidebar reads + deletes flow
// through the worker message router. But the worker runs many concurrent async
// writers (the message router, the Haiku curator, Sonnet's memory tools), and
// each `await` inside a read-modify-write is an interleaving point. Single
// process is not single writer. Writes therefore serialize through
// `withStoreLock`, and destructive ops bump `storeGeneration` so a writer whose
// read predates a clear can detect that and drop its write. See ADR 0027.
//
// Lifecycle note: Chrome MV3 unloads service workers after ~30s of idleness.
// The `cachedMemories` module variable is a best-effort warm cache; on worker
// wake, the first `loadMemories()` call re-hydrates from chrome.storage.local.
// Storage is the source of truth.
//
// Implements: ADR 0027 — see notes/decisions/.

import type { MemoryEntry, MemoryType, ProvisionalInterest } from "../../shared/types";

const MEMORY_KEY = "memories";
const PROVISIONAL_KEY = "provisional";
const ONBOARDING_QUEUE_KEY = "onboarding_save_queue";
// Rolling window of recent chat turns, consumed only by the Haiku curator. The
// key lives here (not in the curator) because it is part of the memory state
// that `clearAllMemoryState` must wipe as one unit.
const CURATOR_BUFFER_KEY = "curator_turns";
const MAX_MEMORIES = 50;
const MAX_PROVISIONAL = 20;
const PROMOTION_THRESHOLD = 2; // mentions needed to promote provisional → memory

let cachedMemories: MemoryEntry[] | null = null;
let cachedProvisional: ProvisionalInterest[] | null = null;

// ─── Write serialization ─────────────────────────────────────────────────────
//
// A promise chain, not a boolean flag: a flag can only reject a concurrent
// writer, whereas the chain queues it. Every mutator runs as a link, so no two
// read-modify-write pairs can interleave at an `await`.
//
// One lock covers every key in the memory subsystem (memories, provisional,
// the curator turn buffer, the onboarding queue). Coarse on purpose:
// `clearAllMemoryState` spans all of them, so a per-key lock would let a
// concurrent append to one key race the clear of another.
//
// INVARIANT: never call `withStoreLock` from inside a locked section — the
// inner call queues behind a link that is waiting on it, and the chain
// deadlocks. Mutators that compose are factored into `*Locked` internals which
// assume the lock is already held; the lock is taken exactly once, at the
// public entry point.

let writeLock: Promise<void> = Promise.resolve();

export function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeLock.then(fn);
  // The chain must survive a rejected link, or one failed write wedges every
  // subsequent one. Callers still see their own rejection via `run`.
  writeLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// ─── Store generation ────────────────────────────────────────────────────────
//
// Bumped by every destructive operation (delete / clear). A writer that reads
// the store, awaits something slow (the curator's multi-second Haiku call),
// then writes back cannot be protected by the lock alone: its read was
// legitimate at the time, and the lock is long released by the time the write
// arrives. Such a writer captures the generation before its read and asks the
// store to drop the write if the generation advanced.
//
// Not persisted. A worker unload resets it to 0, which is sound ONLY because no
// writer survives an unload — the curator's in-flight state is a pending promise
// in the worker's heap, so it dies with the counter it captured. Persist a
// writer's in-flight state across an unload (an alarm-based retry, a resumable
// write queue, an offscreen document) and a resumed writer would compare its
// pre-unload generation against a counter reset to 0, match, and resurrect —
// with no test failing. Persist the generation alongside it, or don't do it.
// This premise is stated in ADR 0027 ("The premise the guard rests on").

let storeGeneration = 0;

export function getStoreGeneration(): number {
  return storeGeneration;
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function loadMemories(): Promise<MemoryEntry[]> {
  if (cachedMemories) return cachedMemories;
  const r = await chrome.storage.local.get(MEMORY_KEY);
  // Re-check after the await: a writer may have persisted while this cold read
  // was in flight. Its value is newer than ours — don't clobber the cache with
  // a stale read.
  if (cachedMemories) return cachedMemories;
  cachedMemories = (r[MEMORY_KEY] as MemoryEntry[] | undefined) ?? [];
  return cachedMemories;
}

export async function getMemoriesByIds(ids: number[]): Promise<MemoryEntry[]> {
  if (ids.length === 0) return [];
  const all = await loadMemories();
  const wanted = new Set(ids);
  // Preserve the caller's requested order so Sonnet sees results in the same
  // order it asked for them.
  const byId = new Map(all.filter((m) => wanted.has(m.id)).map((m) => [m.id, m]));
  return ids
    .map((id) => byId.get(id))
    .filter((m): m is MemoryEntry => m !== undefined);
}

// ─── Write ───────────────────────────────────────────────────────────────────

// Normalize a description for dedup comparison: lowercase, strip punctuation,
// collapse whitespace. "Middle Eastern Theology — deep interest!" and
// "middle eastern theology deep interest" compare equal.
function normalizeForDedup(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Jaccard similarity over word sets. 0..1; higher = more overlap. Used to
// catch near-duplicates where the descriptions differ in wording but point
// at the same fact ("theology classes" vs "theology courses").
function jaccardSim(a: string, b: string): number {
  const aw = new Set(normalizeForDedup(a).split(/\s+/).filter(Boolean));
  const bw = new Set(normalizeForDedup(b).split(/\s+/).filter(Boolean));
  if (aw.size === 0 || bw.size === 0) return 0;
  let intersect = 0;
  for (const w of aw) if (bw.has(w)) intersect++;
  const unionSize = aw.size + bw.size - intersect;
  return unionSize === 0 ? 0 : intersect / unionSize;
}

const DEDUP_SIMILARITY_THRESHOLD = 0.6;

export async function addMemory(
  input: Pick<MemoryEntry, "type" | "description" | "content"> & { sourceQuote?: string }
): Promise<MemoryEntry[]> {
  return withStoreLock(() => addMemoryLocked(input));
}

// Assumes the store lock is held. Callers that already hold it (the curator's
// write batch, promoteProvisional) call this directly.
async function addMemoryLocked(
  input: Pick<MemoryEntry, "type" | "description" | "content"> & { sourceQuote?: string }
): Promise<MemoryEntry[]> {
  const existing = await loadMemories();
  const now = Date.now();

  // Dedup: if an existing memory of the same type has a normalized-exact
  // or high-Jaccard description match, merge into it instead of appending.
  // This stops onboarding from producing 5 overlapping "theology interest"
  // entries when the student mentions theology at different angles.
  const normalizedNew = normalizeForDedup(input.description);
  const mergeTarget = existing.find((m) => {
    if (m.type !== input.type) return false;
    const normalizedExisting = normalizeForDedup(m.description);
    if (normalizedExisting === normalizedNew) return true;
    return jaccardSim(m.description, input.description) >= DEDUP_SIMILARITY_THRESHOLD;
  });

  if (mergeTarget) {
    // Keep the longer content — assume the newer call has more detail,
    // unless the existing content is already longer. Keep the existing
    // sourceQuote unless the merge target is missing one.
    const mergedContent =
      input.content.trim().length > mergeTarget.content.length
        ? input.content.trim()
        : mergeTarget.content;
    const updatedList = existing.map((m) =>
      m.id === mergeTarget.id
        ? {
            ...m,
            content: mergedContent,
            sourceQuote: m.sourceQuote ?? input.sourceQuote?.trim(),
            lastAccessedAt: now,
          }
        : m
    );
    await persistLocked(updatedList);
    return updatedList;
  }

  const nextId = existing.reduce((max, m) => Math.max(max, m.id), 0) + 1;
  const entry: MemoryEntry = {
    id: nextId,
    type: input.type,
    description: input.description.trim(),
    content: input.content.trim(),
    sourceQuote: input.sourceQuote?.trim() || undefined,
    createdAt: now,
    lastAccessedAt: now,
  };
  const updated = [...existing, entry];
  // Capacity eviction, not a delete: deliberately does NOT bump storeGeneration.
  // Once the store is full every add would evict, and a bump here would make
  // each curator write invalidate the next one.
  while (updated.length > MAX_MEMORIES) {
    let oldestIdx = 0;
    for (let i = 1; i < updated.length; i++) {
      if (updated[i].createdAt < updated[oldestIdx].createdAt) oldestIdx = i;
    }
    updated.splice(oldestIdx, 1);
  }
  await persistLocked(updated);
  return updated;
}

// Student-initiated edit from the Settings panel. Only the fields the
// student can meaningfully revise: description, content, type. sourceQuote,
// createdAt, and id are immutable (they're provenance, not opinion).
export interface MemoryEditInput {
  id: number;
  type?: MemoryType;
  description?: string;
  content?: string;
}

export async function editMemory(input: MemoryEditInput): Promise<MemoryEntry | null> {
  return withStoreLock(async () => {
    const existing = await loadMemories();
    const idx = existing.findIndex((m) => m.id === input.id);
    if (idx < 0) return null;
    const prev = existing[idx];
    const next: MemoryEntry = {
      ...prev,
      type: input.type ?? prev.type,
      description: input.description?.trim() || prev.description,
      content: input.content?.trim() || prev.content,
      lastAccessedAt: Date.now(),
    };
    const updated = [...existing];
    updated[idx] = next;
    await persistLocked(updated);
    return next;
  });
}

export async function deleteMemory(id: number): Promise<MemoryEntry[]> {
  return withStoreLock(async () => (await deleteMemoryLocked(id)).memories);
}

// Assumes the store lock is held. Reports whether anything was actually
// removed so `executeForgetMemory` doesn't need a second read to find out.
async function deleteMemoryLocked(
  id: number
): Promise<{ memories: MemoryEntry[]; removed: boolean }> {
  const existing = await loadMemories();
  const updated = existing.filter((m) => m.id !== id);
  if (updated.length === existing.length) return { memories: existing, removed: false };
  storeGeneration++;
  await persistLocked(updated);
  return { memories: updated, removed: true };
}

export async function clearMemories(): Promise<void> {
  return withStoreLock(async () => {
    storeGeneration++;
    await persistLocked([]);
  });
}

// The full-wipe path behind the Settings "clear all memories" button. Memories
// alone are not the whole of the student's memory state: the curator turn
// buffer and the provisional store both feed writes back into it, so clearing
// only `memories` lets the other two resurrect what was deleted. Clear means
// clear — one generation bump, one lock, all three keys. See ADR 0027.
export async function clearAllMemoryState(): Promise<void> {
  return withStoreLock(async () => {
    storeGeneration++;
    await persistLocked([]);
    await persistProvisionalLocked([]);
    await chrome.storage.local.remove(CURATOR_BUFFER_KEY);
  });
}

// Called by recall_memory when Sonnet pages memories in. Consolidation passes
// later may use lastAccessedAt to decide which low-value entries to prune.
export async function touchMemories(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  return withStoreLock(async () => {
    const existing = await loadMemories();
    const set = new Set(ids);
    const now = Date.now();
    let changed = false;
    const updated = existing.map((m) => {
      if (!set.has(m.id)) return m;
      changed = true;
      return { ...m, lastAccessedAt: now };
    });
    if (changed) await persistLocked(updated);
  });
}

// Exposed for the consolidation pass, which needs to apply a whole-list
// rewrite atomically (merge clusters in one pass, single cache flush).
// Regular writers should use addMemory / deleteMemory / clearMemories.
export async function persistRaw(memories: MemoryEntry[]): Promise<void> {
  return withStoreLock(() => persistLocked(memories));
}

// Assumes the store lock is held. Sets the warm cache before awaiting the
// storage write so a concurrent cold `loadMemories` cannot re-hydrate a stale
// list mid-write; the lock is what makes that ordering meaningful rather than
// accidental.
async function persistLocked(memories: MemoryEntry[]): Promise<void> {
  cachedMemories = memories;
  await chrome.storage.local.set({ [MEMORY_KEY]: memories });
}

// ─── Index Renderer ──────────────────────────────────────────────────────────

// Produces the routing index Sonnet sees in the system prompt. Each line is
// `#<id> [<type>] <description>`, one per memory, in insertion order.
//
// Format invariants (important — Sonnet parses these visually):
//   - Leading `#<id>` gives the tool-callable handle. IDs are sparse after
//     eviction but always unique.
//   - `[<type>]` tags let Sonnet pattern-match on category without loading.
//   - `<description>` is the curator's ≤10-word hook. Must be specific enough
//     that match/no-match is obvious — if it leaks full content, Sonnet will
//     skip `recall_memory` and hallucinate from the index alone.
//
// Returns the empty string when there are no memories so the system-prompt
// caller can conditionally omit the whole section.
export function memoriesToIndexText(memories: MemoryEntry[]): string {
  if (memories.length === 0) return "";
  return memories
    .map((m) => `#${m.id} [${m.type}] ${m.description}`)
    .join("\n");
}

// ─── `recall_memory` Tool ────────────────────────────────────────────────────

// Anthropic tool schema — exposed to Sonnet alongside the catalog tools. The
// description is deliberately forceful: we want Sonnet to err on the side of
// NOT calling it when nothing in the index looks relevant, and to treat the
// terse index descriptions as handles, not as full grounding.
export const RECALL_MEMORY_TOOL = {
  name: "recall_memory",
  description:
    "Load the full content of one or more memories by ID from the Memory Index in your system prompt. " +
    "Call this whenever the student's current message relates to a memory description — the index descriptions " +
    "are intentionally terse and MUST NOT be treated as sufficient grounding on their own. " +
    "You can batch multiple IDs in a single call. " +
    "If nothing in the index looks relevant, don't call this tool — unrelated recalls waste turns.",
  input_schema: {
    type: "object" as const,
    properties: {
      ids: {
        type: "array",
        items: { type: "integer" },
        description: "Memory IDs (from the Memory Index) to load in full.",
      },
    },
    required: ["ids"],
  },
};

export interface RecallMemoryInput {
  ids: number[];
}

// ─── `save_memory` Tool (onboarding mode only) ───────────────────────────────

// Exposed to Sonnet during the onboarding intake, and ONLY during onboarding.
// Normal chat relies on the Haiku background curator to write memories after
// the fact. Onboarding inverts this — Sonnet asks direct intake questions and
// persists durable facts the student states, with no curator involvement.
export const SAVE_MEMORY_TOOL = {
  name: "save_memory",
  description:
    "Save a durable fact about the student to the long-term memory store. " +
    "Use this during onboarding (each time the student states something that will still be " +
    "true weeks or months from now) AND in normal chat when the student explicitly asks you " +
    "to remember something, or states a clear durable commitment. ONLY save facts the student " +
    "explicitly stated in their own words during this conversation — never infer, never guess, " +
    "never save anything already visible in the DegreeWorks audit. Also: DO NOT save " +
    "disabilities, diagnoses, medications, mental-health topics, or family-crisis disclosures; " +
    "acknowledge them warmly in your reply but do not persist them.",
  input_schema: {
    type: "object" as const,
    properties: {
      type: {
        type: "string",
        enum: ["interest", "constraint", "goal", "decision", "note"],
        description: "Category of the memory.",
      },
      description: {
        type: "string",
        description:
          "Short (≤10 words), specific-enough-to-route-on description. This is the " +
          "ONLY text shown in the memory index later, so vague descriptions are useless.",
      },
      content: {
        type: "string",
        description: "1-3 sentences with the full details. Quote the student when practical.",
      },
      sourceQuote: {
        type: "string",
        description:
          "The verbatim phrase or sentence from the student's most recent message that " +
          "justifies this memory. Shown to the student later as 'you said: ...' so they " +
          "can trace the memory's provenance. Keep it short (≤25 words), quote exactly, " +
          "and pull it from the student's own words — never paraphrase.",
      },
    },
    required: ["type", "description", "content"],
  },
};

export interface SaveMemoryInput {
  type: MemoryType;
  description: string;
  content: string;
  sourceQuote?: string;
}

export async function executeSaveMemory(
  input: SaveMemoryInput
): Promise<{ saved: boolean; id?: number }> {
  if (
    typeof input?.type !== "string" ||
    typeof input?.description !== "string" ||
    typeof input?.content !== "string" ||
    !(["interest", "constraint", "goal", "decision", "note"] as MemoryType[]).includes(
      input.type
    )
  ) {
    return { saved: false };
  }
  const updated = await addMemory({
    type: input.type,
    description: input.description,
    content: input.content,
    sourceQuote: typeof input.sourceQuote === "string" ? input.sourceQuote : undefined,
  });
  const last = updated[updated.length - 1];
  return { saved: true, id: last?.id };
}

// Executor for the `recall_memory` tool. Returns the full memory entries for
// requested IDs (preserving caller order), and bumps `lastAccessedAt` on each
// successfully recalled memory — future consolidation passes may use that
// timestamp to decide which low-value memories to prune.
//
// Silent on missing IDs: if Sonnet asks for an ID that's been evicted or
// never existed, it's simply absent from the result. Sonnet can infer from
// the result length.
export async function executeRecallMemory(
  input: RecallMemoryInput
): Promise<MemoryEntry[]> {
  const ids = Array.isArray(input.ids)
    ? input.ids.filter((x): x is number => typeof x === "number" && Number.isInteger(x))
    : [];
  if (ids.length === 0) return [];
  const memories = await getMemoriesByIds(ids);
  if (memories.length > 0) {
    await touchMemories(memories.map((m) => m.id));
  }
  return memories;
}

// ─── Provisional Interest Store ──────────────────────────────────────────────

// The curator's "maybe" tier. Soft signals land here first; when the same
// topic is reinforced with consistent framing across enough turns, it gets
// promoted to a real MemoryEntry. Hard facts on the same topic absorb the
// provisional entry (delete it — the memory supersedes the hint).
//
// Invariants:
//   - `topic` is the match key. Two provisional entries with the same topic
//     must never coexist — addProvisionalHit merges into an existing row.
//   - Capped at MAX_PROVISIONAL with drop-lowest-count eviction (ties broken
//     by oldest lastSeenAt) so long-lived accumulators aren't kicked out by
//     a flurry of one-off hints.
//   - Never entered into Sonnet's system prompt — curator-only.

export async function loadProvisional(): Promise<ProvisionalInterest[]> {
  if (cachedProvisional) return cachedProvisional;
  const r = await chrome.storage.local.get(PROVISIONAL_KEY);
  // Same cold-read re-check as loadMemories: a writer may have persisted while
  // this read was in flight.
  if (cachedProvisional) return cachedProvisional;
  cachedProvisional = (r[PROVISIONAL_KEY] as ProvisionalInterest[] | undefined) ?? [];
  return cachedProvisional;
}

export interface ProvisionalHit {
  topic: string;
  description: string;
  proposedType: MemoryType;
  framing: string; // short snippet describing how the student phrased it this turn
}

// Add a new provisional seed OR increment the count on an existing matching
// topic. Returns the resulting entry (with its current count) so callers can
// decide whether to promote.
export async function addProvisionalHit(
  hit: ProvisionalHit
): Promise<ProvisionalInterest> {
  return withStoreLock(() => addProvisionalHitLocked(hit));
}

// Assumes the store lock is held. The count increment below is a
// read-modify-write: unserialized, two hits on the same topic in the same turn
// both read count=N and both write N+1, so one mention is silently swallowed.
async function addProvisionalHitLocked(
  hit: ProvisionalHit
): Promise<ProvisionalInterest> {
  const existing = await loadProvisional();
  const now = Date.now();
  const normalizedTopic = hit.topic.trim().toLowerCase();

  const matchIdx = existing.findIndex(
    (p) => p.topic.trim().toLowerCase() === normalizedTopic
  );

  if (matchIdx >= 0) {
    const prev = existing[matchIdx];
    const updated: ProvisionalInterest = {
      ...prev,
      count: prev.count + 1,
      framings: [...prev.framings, hit.framing].slice(-5), // keep last 5
      lastSeenAt: now,
    };
    const next = [...existing];
    next[matchIdx] = updated;
    await persistProvisionalLocked(next);
    return updated;
  }

  const nextId = existing.reduce((max, p) => Math.max(max, p.id), 0) + 1;
  const entry: ProvisionalInterest = {
    id: nextId,
    topic: hit.topic.trim(),
    description: hit.description.trim(),
    proposedType: hit.proposedType,
    count: 1,
    framings: [hit.framing],
    createdAt: now,
    lastSeenAt: now,
  };
  const next = [...existing, entry];
  while (next.length > MAX_PROVISIONAL) {
    let evictIdx = 0;
    for (let i = 1; i < next.length; i++) {
      const a = next[i];
      const b = next[evictIdx];
      if (a.count < b.count || (a.count === b.count && a.lastSeenAt < b.lastSeenAt)) {
        evictIdx = i;
      }
    }
    next.splice(evictIdx, 1);
  }
  await persistProvisionalLocked(next);
  return entry;
}

// Promote a provisional entry to a full MemoryEntry. Removes the provisional
// row on success. Returns the new MemoryEntry, or null if the ID no longer
// exists (e.g. it was absorbed or evicted between the promotion decision and
// this call).
export async function promoteProvisional(id: number): Promise<MemoryEntry | null> {
  return withStoreLock(() => promoteProvisionalLocked(id));
}

// Assumes the store lock is held. Holding it across the whole promote — read,
// addMemory, remove the provisional row — is what makes double-promotion
// impossible: the second caller finds the row already gone and returns null.
// Hence `addMemoryLocked`, not `addMemory`: re-taking the lock here would
// deadlock against the link this function is running on.
async function promoteProvisionalLocked(id: number): Promise<MemoryEntry | null> {
  const existing = await loadProvisional();
  const entry = existing.find((p) => p.id === id);
  if (!entry) return null;
  const memories = await addMemoryLocked({
    type: entry.proposedType,
    description: entry.description,
    content:
      `Promoted from provisional interest after ${entry.count} consistent mentions. ` +
      `Framings: ${entry.framings.map((f) => `"${f}"`).join("; ")}`,
  });
  const remaining = existing.filter((p) => p.id !== id);
  await persistProvisionalLocked(remaining);
  return memories[memories.length - 1] ?? null;
}

// Absorption — called when a hard fact about a topic arrives and should
// supersede any matching provisional hint. Uses hierarchical matching
// ("theology" absorbs "theology/middle-east" and vice versa) but refuses
// topics shorter than MIN_TOPIC_LENGTH to prevent spurious substring hits
// (e.g. "cs" matching "economics"). Topics are expected to be slugs like
// "theology/middle-east" or "schedule/friday-afternoon", not English words.
const MIN_TOPIC_LENGTH = 3;

function topicsMatch(a: string, b: string): boolean {
  const aNorm = a.trim().toLowerCase();
  const bNorm = b.trim().toLowerCase();
  if (aNorm.length < MIN_TOPIC_LENGTH || bNorm.length < MIN_TOPIC_LENGTH) return false;
  if (aNorm === bNorm) return true;
  return aNorm.startsWith(bNorm + "/") || bNorm.startsWith(aNorm + "/");
}

export async function absorbProvisionalByTopic(topic: string): Promise<number> {
  return withStoreLock(() => absorbProvisionalByTopicLocked(topic));
}

// Assumes the store lock is held. Absorption is system-internal (a hard fact
// superseding its own hint), so it does not bump storeGeneration — the curator
// would otherwise invalidate its own batch halfway through.
async function absorbProvisionalByTopicLocked(topic: string): Promise<number> {
  const existing = await loadProvisional();
  const needle = topic.trim();
  if (needle.length < MIN_TOPIC_LENGTH) return 0;
  const remaining = existing.filter((p) => !topicsMatch(p.topic, needle));
  if (remaining.length === existing.length) return 0;
  await persistProvisionalLocked(remaining);
  return existing.length - remaining.length;
}

export async function deleteProvisional(id: number): Promise<void> {
  return withStoreLock(async () => {
    const existing = await loadProvisional();
    const remaining = existing.filter((p) => p.id !== id);
    if (remaining.length === existing.length) return;
    storeGeneration++;
    await persistProvisionalLocked(remaining);
  });
}

export async function clearProvisional(): Promise<void> {
  return withStoreLock(async () => {
    storeGeneration++;
    await persistProvisionalLocked([]);
  });
}

// Assumes the store lock is held.
async function persistProvisionalLocked(entries: ProvisionalInterest[]): Promise<void> {
  cachedProvisional = entries;
  await chrome.storage.local.set({ [PROVISIONAL_KEY]: entries });
}

// Renders the provisional store for the curator's prompt. Each line is
// `#<id> (<count>) <topic> — <description>`. The curator uses this to decide
// whether a new turn's soft signal matches an existing row (increment) or
// introduces a new topic (seed).
export function provisionalToIndexText(entries: ProvisionalInterest[]): string {
  if (entries.length === 0) return "";
  return entries
    .map((p) => `#${p.id} (${p.count}) ${p.topic} — ${p.description}`)
    .join("\n");
}

// ─── Curator Write Batch ─────────────────────────────────────────────────────
//
// The curator is the one writer whose read and write are separated by a
// multi-second external call. Between them the student can clear the store, and
// the curator's write would resurrect everything they just deleted. The lock
// cannot prevent this: the curator's read was legitimate when it happened, and
// no lock is held across the Haiku call (holding one for seconds would stall
// every other writer, including the clear itself).
//
// So the curator captures `getStoreGeneration()` before it reads, and hands it
// back here. The whole batch — hard facts, absorption, provisional hits,
// promotions — commits under one lock, gated on that generation. The check is
// inside the lock, which is what makes it atomic: a clear can only run before
// the batch (generation advances, batch drops) or after it (the clear wins).
// Checking the generation in the curator, then calling the mutators, would
// leave a window between the check and each mutator's lock acquisition.

export interface CuratorHardFact {
  type: MemoryType;
  description: string;
  content: string;
  topic: string; // used to absorb matching provisional rows; "" to skip
  sourceQuote?: string;
}

export interface CuratorWriteBatch {
  hardFacts: CuratorHardFact[];
  provisionalHits: ProvisionalHit[];
}

export interface CuratorWriteOutcome {
  // True when the batch was discarded because the store was cleared (or a
  // memory deleted) while the curator was waiting on Haiku.
  dropped: boolean;
  promoted: MemoryEntry[];
  absorbed: number;
}

export async function applyCuratorWrites(
  expectedGeneration: number,
  batch: CuratorWriteBatch
): Promise<CuratorWriteOutcome> {
  return withStoreLock(async () => {
    if (storeGeneration !== expectedGeneration) {
      return { dropped: true, promoted: [], absorbed: 0 };
    }

    const outcome: CuratorWriteOutcome = { dropped: false, promoted: [], absorbed: 0 };

    // Hard facts → memories + absorb matching provisional rows.
    for (const fact of batch.hardFacts) {
      try {
        await addMemoryLocked({
          type: fact.type,
          description: fact.description,
          content: fact.content,
          sourceQuote: fact.sourceQuote,
        });
        if (fact.topic) {
          outcome.absorbed += await absorbProvisionalByTopicLocked(fact.topic);
        }
      } catch (err) {
        console.warn("[Curator] addMemory failed for hard fact:", fact, err);
      }
    }

    // Provisional hits → increment counters, promote when threshold met.
    for (const hit of batch.provisionalHits) {
      try {
        const updated = await addProvisionalHitLocked(hit);
        if (updated.count >= PROMOTION_THRESHOLD) {
          const promoted = await promoteProvisionalLocked(updated.id);
          if (promoted) outcome.promoted.push(promoted);
        }
      } catch (err) {
        console.warn("[Curator] provisional update failed for hit:", hit, err);
      }
    }

    return outcome;
  });
}

// ─── `forget_memory` Tool (normal chat mode) ────────────────────────────────

// Exposed to Sonnet in normal chat mode alongside recall_memory. Enables
// conversational corrections: "forget that I wanted to minor in CS" → Sonnet
// identifies the matching memory ID from the routing index, calls
// forget_memory, and it's gone.
export const FORGET_MEMORY_TOOL = {
  name: "forget_memory",
  description:
    "Delete one or more long-term memories by ID. Use this when the student says " +
    "something is no longer true ('I changed my mind about the CS minor', 'forget " +
    "that I work on Fridays'). Look up the matching ID(s) in the Memory Index in your " +
    "system prompt — the index description tells you which entry to delete. Only " +
    "delete what the student explicitly asked to remove.",
  input_schema: {
    type: "object" as const,
    properties: {
      ids: {
        type: "array",
        items: { type: "integer" },
        description: "Memory IDs (from the Memory Index) to delete.",
      },
    },
    required: ["ids"],
  },
};

export interface ForgetMemoryInput {
  ids: number[];
}

export async function executeForgetMemory(
  input: ForgetMemoryInput
): Promise<{ deleted: number[] }> {
  const ids = Array.isArray(input.ids)
    ? input.ids.filter((x): x is number => typeof x === "number" && Number.isInteger(x))
    : [];
  const deleted: number[] = [];
  for (const id of ids) {
    // One lock per id, and the delete reports its own outcome. The old
    // before/after length compare read the store outside the lock, so a
    // concurrent write between the two reads could mask or fake a deletion.
    const { removed } = await withStoreLock(() => deleteMemoryLocked(id));
    if (removed) deleted.push(id);
  }
  return { deleted };
}

// ─── Onboarding Save Queue ───────────────────────────────────────────────────
//
// During the intake conversation, save_memory tool calls are deferred into
// this queue instead of writing to the main memory store. When Sonnet signals
// end-of-intake via complete_onboarding, the service worker drains the queue,
// dedups across it + against existing memories (via addMemory's Jaccard
// check), and persists in one batch. This eliminates per-turn duplicate saves
// that happened when the model re-extracted the same fact across multiple
// turns, and gives the UI a single "here's what I saved" moment instead of a
// toast-per-turn stream.
//
// Lifecycle: seeded fresh on each onboarding start (cleared by RESET_ONBOARDING
// and by complete_onboarding on drain). Persisted to chrome.storage.local so
// MV3 service-worker unloads mid-intake don't lose queued facts.

export interface OnboardingQueueItem {
  type: MemoryType;
  description: string;
  content: string;
  sourceQuote?: string;
}

// The queue has no warm cache, so its read-modify-write is a pure
// storage.get → storage.set pair with an await between: two save_memory tool
// calls resolving in the same tick both read the same queue and the second
// `set` drops the first item. Serialized like every other mutator.
export async function queueOnboardingSave(
  item: OnboardingQueueItem
): Promise<{ queued: boolean; reason?: "duplicate" }> {
  return withStoreLock(async () => {
    const r = await chrome.storage.local.get(ONBOARDING_QUEUE_KEY);
    const existing = (r[ONBOARDING_QUEUE_KEY] as OnboardingQueueItem[] | undefined) ?? [];
    // Pre-dedup within the queue: if the model already queued the same topic
    // earlier in the intake, skip the second one. Uses the same normalize+
    // Jaccard check that addMemory applies at write time — keeping logic
    // consistent across both write paths.
    const normalizedNew = normalizeForDedup(item.description);
    const duplicate = existing.some((q) => {
      if (q.type !== item.type) return false;
      if (normalizeForDedup(q.description) === normalizedNew) return true;
      return jaccardSim(q.description, item.description) >= DEDUP_SIMILARITY_THRESHOLD;
    });
    if (duplicate) return { queued: false, reason: "duplicate" as const };
    const next = [...existing, item];
    await chrome.storage.local.set({ [ONBOARDING_QUEUE_KEY]: next });
    return { queued: true };
  });
}

export async function loadOnboardingQueue(): Promise<OnboardingQueueItem[]> {
  const r = await chrome.storage.local.get(ONBOARDING_QUEUE_KEY);
  return (r[ONBOARDING_QUEUE_KEY] as OnboardingQueueItem[] | undefined) ?? [];
}

export async function clearOnboardingQueue(): Promise<void> {
  return withStoreLock(async () => {
    await chrome.storage.local.remove(ONBOARDING_QUEUE_KEY);
  });
}

// ─── `complete_onboarding` Tool (onboarding mode only) ──────────────────────

// Signals end-of-intake. Service worker drains the save queue, writes each
// entry through addMemory (which re-applies Jaccard dedup against existing
// memories, catching duplicates the queue-level check missed), broadcasts
// progress so the UI can render a system-action bubble, sets the onboarding-
// completed flag, and returns a tool result telling Sonnet to emit its final
// wrap-up. Sonnet's wrap-up text after this tool call lands in a fresh bubble
// because the system-action bubble is a non-append target for streaming.
export const COMPLETE_ONBOARDING_TOOL = {
  name: "complete_onboarding",
  description:
    "Call this when you've gathered enough to end the intake. This persists every fact you " +
    "queued via save_memory during the conversation, then transitions the student out of intake " +
    "mode. After this tool returns, give your final wrap-up message — a warm 3-4 line summary " +
    "of what you learned and an invitation to ask anything now that you have context. " +
    "Call this exactly once, and only after the student has answered enough questions that you " +
    "have a solid picture (usually 5-7 exchanges). Never call it on the first turn.",
  input_schema: {
    type: "object" as const,
    properties: {},
  },
};

export { MAX_MEMORIES, MAX_PROVISIONAL, PROMOTION_THRESHOLD, CURATOR_BUFFER_KEY };
export type { MemoryEntry, MemoryType, ProvisionalInterest };
