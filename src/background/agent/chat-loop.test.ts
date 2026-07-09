// chat-loop tests. Everything faked here is a real seam:
//   - `deps` is genuinely injected by service-worker.ts (ADR 0019), so a fake
//     broadcast/getApiKey is the production wiring, not a stand-in for it.
//   - the Anthropic SDK is mocked at the network boundary.
//   - `chrome` is the browser platform, absent under `environment: "node"`.
// The tool registry is NOT mocked: the throwing-tool test drives the real
// `run_what_if` executor and injects the fault through ToolContext, which is
// the only dependency that tool has on the worker.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ConversationMessage } from "../../shared/types";
import type { ChatDeps } from "./chat-loop";

const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = { stream: streamMock };
  },
}));

const { handleAIChat } = await import("./chat-loop");

// ─── Fakes ───────────────────────────────────────────────────────────────────

type AnyMessage = Record<string, unknown>;

function message(stop_reason: string, content: unknown[] = []): AnyMessage {
  return { id: "msg_1", type: "message", role: "assistant", content, stop_reason };
}

// Mimics the shape chat-loop consumes: async-iterable of chunks + finalMessage().
function fakeStream(
  final: AnyMessage,
  opts: { delayMs?: number; throws?: Error; text?: string } = {}
) {
  return {
    async *[Symbol.asyncIterator]() {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.throws) throw opts.throws;
      if (opts.text) {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: opts.text } };
      }
    },
    finalMessage: async () => final,
  };
}

const USER_TURN: ConversationMessage[] = [
  { role: "user", content: "what if I add a philosophy minor?", timestamp: "2026-07-08T00:00:00Z" },
];

let broadcasts: AnyMessage[];
let getPlatformInfo: ReturnType<typeof vi.fn>;
let deps: ChatDeps;

function broadcastsOfType(type: string): AnyMessage[] {
  return broadcasts.filter((b) => b.type === type);
}

beforeEach(() => {
  vi.useFakeTimers();
  streamMock.mockReset();
  broadcasts = [];
  getPlatformInfo = vi.fn().mockResolvedValue({ os: "linux" });

  globalThis.chrome = {
    runtime: { getPlatformInfo },
    storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
  } as unknown as typeof chrome;

  deps = {
    getApiKey: async () => "sk-test",
    broadcast: (m: object) => void broadcasts.push(m as AnyMessage),
    refreshAudit: async () => {},
    hydrateStudentCache: async () => ({ id: null, goal: null }),
    // Curator OFF: it has its own withKeepalive (chat-loop.ts, post-AI_DONE).
    // Leaving it on would make the loop keepalive assertions ambiguous.
    isCuratorAutoSaveEnabled: async () => false,
    appendCuratorTurn: async () => [],
  };
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Bug 1 — MV3 keepalive around the tool-round loop ────────────────────────

describe("handleAIChat keepalive", () => {
  it("pings an extension API while a round runs longer than the MV3 idle kill", async () => {
    streamMock.mockReturnValue(fakeStream(message("end_turn"), { delayMs: 30_000 }));

    const done = handleAIChat(USER_TURN, "audit", "profile", "normal", deps);
    await vi.advanceTimersByTimeAsync(30_000);
    await done;

    // 25s interval, 30s round: at least one ping must have reset the idle timer.
    expect(getPlatformInfo).toHaveBeenCalled();
    expect(broadcastsOfType("AI_DONE")).toHaveLength(1);
  });

  it("clears the keepalive interval when the round loop throws", async () => {
    streamMock.mockReturnValue(
      fakeStream(message("end_turn"), { delayMs: 1_000, throws: new Error("stream exploded") })
    );

    const done = handleAIChat(USER_TURN, "audit", "profile", "normal", deps);
    await vi.advanceTimersByTimeAsync(1_000);
    await done;

    expect(broadcastsOfType("AI_ERROR")).toHaveLength(1);
    // A keepalive that leaks its interval on the error path pins the worker
    // awake forever. Nothing may still be scheduled once the call settles.
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ─── Bug 2 — a thrown tool must still terminate its UI chip ──────────────────

describe("handleAIChat tool failure", () => {
  it("broadcasts a terminal AI_TOOL_RESULT when a tool executor throws", async () => {
    // Real `run_what_if`, real REGISTRY dispatch. executeWhatIf awaits
    // ctx.hydrateStudentCache() outside any try — rejecting it makes the real
    // tool reject, which is exactly the production failure this bug is about.
    deps.hydrateStudentCache = async () => {
      throw new Error("storage unavailable");
    };

    streamMock
      .mockReturnValueOnce(
        fakeStream(
          message("tool_use", [
            { type: "tool_use", id: "toolu_1", name: "run_what_if", input: { minor: "PHIL" } },
          ])
        )
      )
      .mockReturnValueOnce(fakeStream(message("end_turn"), { text: "Recovered." }));

    await handleAIChat(USER_TURN, "audit", "profile", "normal", deps);

    const results = broadcastsOfType("AI_TOOL_RESULT");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("run_what_if");
    expect(results[0].error).toContain("storage unavailable");
    // `courseCount` is the sidebar's chip-resolved marker — it must be defined
    // on the failure path or the chip spins "searching…" for the whole session.
    expect(results[0].courseCount).toBeDefined();

    // The model still gets the is_error tool_result and recovers.
    const secondCall = streamMock.mock.calls[1][0] as { messages: AnyMessage[] };
    const toolTurn = secondCall.messages[secondCall.messages.length - 1];
    expect(toolTurn).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: true }],
    });
    expect(broadcastsOfType("AI_ERROR")).toHaveLength(0);
    expect(broadcastsOfType("AI_DONE")).toHaveLength(1);
  });

  it("does not broadcast a tool result for a silent tool that throws", async () => {
    // save_memory is silent during onboarding (ADR 0014 revisit). A silent tool
    // has no chip, so a failure broadcast would create one out of nowhere.
    streamMock
      .mockReturnValueOnce(
        fakeStream(
          message("tool_use", [
            { type: "tool_use", id: "toolu_1", name: "save_memory", input: {} },
          ])
        )
      )
      .mockReturnValueOnce(fakeStream(message("end_turn")));
    (globalThis.chrome.storage.local.set as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("quota exceeded")
    );

    await handleAIChat(USER_TURN, "audit", "profile", "onboarding", deps);

    // Prove the tool genuinely threw (otherwise the silence below is vacuous):
    // the model must have received an is_error tool_result.
    const secondCall = streamMock.mock.calls[1][0] as { messages: AnyMessage[] };
    const toolTurn = secondCall.messages[secondCall.messages.length - 1];
    expect(toolTurn).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", is_error: true }],
    });
    expect(broadcastsOfType("AI_TOOL_RESULT")).toHaveLength(0);
    expect(broadcastsOfType("AI_TOOL_USE")).toHaveLength(0);
  });
});

// ─── Bug 3 — loop-exit notices are valid markdown ────────────────────────────

describe("handleAIChat loop-exit notices", () => {
  const BALANCED = /^\n\n\*\(.+\)\*$/s;

  it("closes the emphasis on the per-turn tool-cap notice", async () => {
    // Never stops asking for tools: exhausts the 5-round cap.
    streamMock.mockReturnValue(
      fakeStream(
        message("tool_use", [{ type: "tool_use", id: "toolu_1", name: "nope", input: {} }])
      )
    );

    await handleAIChat(USER_TURN, "audit", "profile", "normal", deps);

    const notice = broadcastsOfType("AI_CHUNK").pop();
    expect(notice?.delta as string).toMatch(BALANCED);
    expect(notice?.delta as string).toContain("per-turn tool limit");
    expect(streamMock).toHaveBeenCalledTimes(5);
  });

  it("closes the emphasis on the max_tokens truncation notice", async () => {
    streamMock.mockReturnValue(fakeStream(message("max_tokens"), { text: "half a sent" }));

    await handleAIChat(USER_TURN, "audit", "profile", "normal", deps);

    const notice = broadcastsOfType("AI_CHUNK").pop();
    expect(notice?.delta as string).toMatch(BALANCED);
    expect(notice?.delta as string).toContain("cut short");
  });
});
