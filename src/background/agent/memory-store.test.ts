import { describe, it, expect, beforeEach, vi } from "vitest";

// Concurrency regression suite for the memory store.
//
// Two hazards are covered, and they need different machinery:
//
//   1. Interleaved read-modify-write between two async writers (lost update).
//      Reproduced by racing two mutators against a COLD cache, so both of them
//      await `chrome.storage.local.get` before either persists.
//   2. Resurrection-after-clear. The curator reads the store, awaits a
//      multi-second Haiku call, then writes back. A clear landing inside that
//      window must win — the curator's stale write has to be dropped.
//
// Both need a `chrome.storage.local` that actually yields to the event loop
// between the read and the resolve; a synchronous fake would hide the races
// entirely. Every access below burns a macrotask on purpose.

// ─── Deferred ────────────────────────────────────────────────────────────────

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// ─── Anthropic SDK fake ──────────────────────────────────────────────────────
//
// The curator's Haiku call is the await that opens the resurrection window.
// `haikuCalled` fires once the curator has finished reading the store and is
// parked on the API call — that's the deterministic moment to clear. The test
// then resolves `haikuResponse` to let the curator's write land.

let haikuCalled: Deferred<void>;
let haikuResponse: Deferred<unknown>;

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: () => {
        haikuCalled.resolve();
        return haikuResponse.promise;
      },
    };
  }
  return { default: FakeAnthropic };
});

function haikuText(payload: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

// ─── chrome.storage.local fake ───────────────────────────────────────────────

type FakeStorage = Record<string, unknown>;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function installFakeChrome(): FakeStorage {
  const data: FakeStorage = {};
  const asList = (keys: string | string[]) => (Array.isArray(keys) ? keys : [keys]);

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        async get(keys: string | string[]) {
          await tick();
          const out: FakeStorage = {};
          for (const k of asList(keys)) {
            if (k in data) out[k] = structuredClone(data[k]);
          }
          return out;
        },
        async set(items: FakeStorage) {
          await tick();
          for (const [k, v] of Object.entries(items)) data[k] = structuredClone(v);
        },
        async remove(keys: string | string[]) {
          await tick();
          for (const k of asList(keys)) delete data[k];
        },
      },
    },
  };
  return data;
}

// The store keeps module-level caches (`cachedMemories`, `cachedProvisional`)
// and a module-level lock. Every test needs a virgin module graph.
async function freshModules() {
  vi.resetModules();
  const storage = installFakeChrome();
  haikuCalled = deferred<void>();
  haikuResponse = deferred<unknown>();
  const store = await import("./memory-store");
  const curator = await import("./memory-curator");
  return { storage, store, curator };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("memory store — write serialization", () => {
  let ctx: Awaited<ReturnType<typeof freshModules>>;

  beforeEach(async () => {
    ctx = await freshModules();
  });

  it("does not lose an update when two addMemory calls race on a cold cache", async () => {
    const { store } = ctx;

    // Cold cache: both calls miss `cachedMemories` and await storage.get, so
    // both observe an empty list before either persists. Un-serialized, the
    // second persist clobbers the first.
    await Promise.all([
      store.addMemory({
        type: "interest",
        description: "Theology electives beyond core",
        content: "Wants theology past the required core credit.",
      }),
      store.addMemory({
        type: "goal",
        description: "Grad school in computational neuroscience",
        content: "Plans to apply to comp-neuro PhD programs.",
      }),
    ]);

    const all = await store.loadMemories();
    expect(all.map((m) => m.type).sort()).toEqual(["goal", "interest"]);
  });

  it("assigns distinct ids to memories written concurrently", async () => {
    const { store } = ctx;

    await Promise.all([
      store.addMemory({ type: "note", description: "Works library shifts", content: "a" }),
      store.addMemory({ type: "constraint", description: "No Friday afternoons", content: "b" }),
      store.addMemory({ type: "decision", description: "Dropped the CS minor", content: "c" }),
    ]);

    const ids = (await store.loadMemories()).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
  });
});

describe("memory store — resurrection after clear", () => {
  let ctx: Awaited<ReturnType<typeof freshModules>>;

  beforeEach(async () => {
    ctx = await freshModules();
  });

  it("drops a curator write whose read predates a clear", async () => {
    const { store, curator, storage } = ctx;

    await store.addMemory({
      type: "interest",
      description: "Middle Eastern theology traditions",
      content: "Asked repeatedly about Middle Eastern theology.",
    });

    // The curator reads the store, then parks on Haiku.
    const run = curator.runCurator(
      "test-key",
      [{ user: "I work library shifts Fridays 1-5", assistant: "Noted — avoiding Friday afternoons." }],
      { write: true }
    );

    await haikuCalled.promise; // curator has read; it is now inside the API await

    // Student hits "clear all memories" mid-flight.
    await store.clearMemories();
    expect(await store.loadMemories()).toEqual([]);

    // Haiku answers with a hard fact. This write is based on a pre-clear read.
    haikuResponse.resolve(
      haikuText({
        hardFacts: [
          {
            type: "constraint",
            description: "No Friday afternoons (library shift 1-5pm)",
            content: "Student cannot attend Friday 1-5pm classes.",
            topic: "schedule/friday-afternoon",
            sourceQuote: "I work library shifts Fridays 1-5",
          },
        ],
        provisionalHits: [],
      })
    );
    await run;

    // The clear must win. Nothing may come back from the dead.
    expect(await store.loadMemories()).toEqual([]);
    expect(storage.memories ?? []).toEqual([]);
  });

  it("still persists a curator write when no clear intervenes", async () => {
    const { store, curator } = ctx;

    const run = curator.runCurator(
      "test-key",
      [{ user: "I work library shifts Fridays 1-5", assistant: "Noted." }],
      { write: true }
    );

    await haikuCalled.promise;
    haikuResponse.resolve(
      haikuText({
        hardFacts: [
          {
            type: "constraint",
            description: "No Friday afternoons (library shift 1-5pm)",
            content: "Student cannot attend Friday 1-5pm classes.",
            topic: "schedule/friday-afternoon",
            sourceQuote: "I work library shifts Fridays 1-5",
          },
        ],
        provisionalHits: [],
      })
    );
    const result = await run;

    expect(result.hardFacts).toHaveLength(1);
    const all = await store.loadMemories();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("constraint");
  });

  it("drops a curator write when the full-wipe path runs mid-flight", async () => {
    const { store, curator, storage } = ctx;

    // The CLEAR_MEMORIES handler calls clearAllMemoryState, not clearMemories.
    // Same guard, but exercise the path the worker actually takes.
    await curator.appendCuratorTurn({ user: "any theology classes?", assistant: "Here are some." });

    const run = curator.runCurator(
      "test-key",
      [{ user: "any theology classes?", assistant: "Here are some." }],
      { write: true }
    );

    await haikuCalled.promise;
    await store.clearAllMemoryState();

    haikuResponse.resolve(
      haikuText({
        hardFacts: [],
        provisionalHits: [
          {
            topic: "theology",
            description: "Theology courses beyond required core",
            proposedType: "interest",
            framing: "asked about interesting theology classes",
          },
        ],
      })
    );
    await run;

    expect(await store.loadMemories()).toEqual([]);
    expect(await store.loadProvisional()).toEqual([]);
    expect(storage[store.CURATOR_BUFFER_KEY]).toBeUndefined();
  });

  it("announces nothing when the batch is dropped", async () => {
    const { store, curator } = ctx;

    const run = curator.runCurator(
      "test-key",
      [{ user: "Remember I want a gender studies elective", assistant: "Saved." }],
      { write: true }
    );

    await haikuCalled.promise;
    await store.clearMemories();
    haikuResponse.resolve(
      haikuText({
        hardFacts: [
          {
            type: "interest",
            description: "Gender studies elective for next semester",
            content: "Wants a gender studies elective.",
            topic: "gender-studies",
            sourceQuote: "I want a gender studies elective",
          },
        ],
        provisionalHits: [],
      })
    );

    // The caller renders a "saved!" toast per hardFact. A dropped batch saved
    // nothing, so it must report nothing.
    const result = await run;
    expect(result.hardFacts).toEqual([]);
    expect(result.promoted).toEqual([]);
  });
});

describe("memory store — clear is a barrier", () => {
  let ctx: Awaited<ReturnType<typeof freshModules>>;

  beforeEach(async () => {
    ctx = await freshModules();
  });

  it("clearAllMemoryState empties provisional and the curator buffer, not just memories", async () => {
    const { store, curator, storage } = ctx;

    await store.addMemory({
      type: "interest",
      description: "Theology electives beyond core",
      content: "Wants theology past the required core credit.",
    });
    await store.addProvisionalHit({
      topic: "theology",
      description: "Theology courses beyond required core",
      proposedType: "interest",
      framing: "asked about interesting theology classes",
    });
    await curator.appendCuratorTurn({ user: "any theology classes?", assistant: "Here are some." });

    // Everything is populated before the clear — otherwise the assertions below
    // would pass vacuously.
    expect(await store.loadMemories()).toHaveLength(1);
    expect(await store.loadProvisional()).toHaveLength(1);
    expect(storage[store.CURATOR_BUFFER_KEY]).toHaveLength(1);

    await store.clearAllMemoryState();

    expect(await store.loadMemories()).toEqual([]);
    expect(await store.loadProvisional()).toEqual([]);
    expect(storage[store.CURATOR_BUFFER_KEY]).toBeUndefined();
  });

  it("bumps the store generation on clear and on delete, but not on add", async () => {
    const { store } = ctx;

    const atStart = store.getStoreGeneration();
    await store.addMemory({ type: "note", description: "Works library shifts", content: "a" });
    expect(store.getStoreGeneration()).toBe(atStart);

    await store.deleteMemory(1);
    const afterDelete = store.getStoreGeneration();
    expect(afterDelete).toBeGreaterThan(atStart);

    // A delete that matches nothing changed nothing — no bump, or every no-op
    // forget_memory call would discard a concurrent curator write.
    await store.deleteMemory(999);
    expect(store.getStoreGeneration()).toBe(afterDelete);

    await store.clearAllMemoryState();
    expect(store.getStoreGeneration()).toBeGreaterThan(afterDelete);
  });

  it("serializes concurrent curator-buffer appends", async () => {
    const { curator, storage } = ctx;

    await Promise.all([
      curator.appendCuratorTurn({ user: "first", assistant: "a" }),
      curator.appendCuratorTurn({ user: "second", assistant: "b" }),
    ]);

    expect(storage.curator_turns).toHaveLength(2);
  });
});

describe("memory store — provisional promotion", () => {
  let ctx: Awaited<ReturnType<typeof freshModules>>;

  beforeEach(async () => {
    ctx = await freshModules();
  });

  it("promotes at threshold without deadlocking on the nested addMemory", async () => {
    const { store } = ctx;

    const hit = {
      topic: "theology",
      description: "Theology courses beyond required core",
      proposedType: "interest" as const,
      framing: "asked about theology classes",
    };
    await store.addProvisionalHit(hit);
    const second = await store.addProvisionalHit({ ...hit, framing: "asked again, Middle East focus" });
    expect(second.count).toBe(store.PROMOTION_THRESHOLD);

    // promoteProvisional takes the lock, then calls addMemory internally. If the
    // inner call re-took the lock, this would hang rather than fail.
    const promoted = await store.promoteProvisional(second.id);
    expect(promoted?.type).toBe("interest");
    expect(await store.loadProvisional()).toEqual([]);
    expect(await store.loadMemories()).toHaveLength(1);
  });

  it("counts every hit when two land on the same topic concurrently", async () => {
    const { store } = ctx;

    const hit = {
      topic: "cs/ai-ml",
      description: "ML and AI electives",
      proposedType: "interest" as const,
      framing: "asked about ML electives",
    };
    await store.addProvisionalHit(hit);
    await Promise.all([
      store.addProvisionalHit({ ...hit, framing: "asked about AI electives" }),
      store.addProvisionalHit({ ...hit, framing: "asked about deep learning" }),
    ]);

    const rows = await store.loadProvisional();
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3); // un-serialized, the two racers both write 2
  });

  it("refuses to promote the same provisional row twice", async () => {
    const { store } = ctx;

    const row = await store.addProvisionalHit({
      topic: "gender-studies",
      description: "Gender studies elective",
      proposedType: "interest",
      framing: "asked about gender studies",
    });

    const [first, second] = await Promise.all([
      store.promoteProvisional(row.id),
      store.promoteProvisional(row.id),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await store.loadMemories()).toHaveLength(1);
  });
});
