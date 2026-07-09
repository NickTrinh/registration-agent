// The advisor chat loop: streams Sonnet, drives the tool-use rounds via the
// tool registry, and fires the background curator after AI_DONE. Moved out of
// service-worker.ts; the worker-owned capabilities it needs (broadcast, the
// refresh flow, student-cache accessors, curator buffer) are injected as
// `deps` so this module never imports the service worker.
// Implements: ADR 0019, ADR 0021 — see notes/decisions/.

import Anthropic from "@anthropic-ai/sdk";
import type { ConversationMessage } from "../../shared/types";
import {
  loadMemories,
  memoriesToIndexText,
  loadProvisional,
} from "./memory-store";
import { runCurator, type ConversationTurn } from "./memory-curator";
import { buildAdvisorSystemBlocks, buildOnboardingSystemBlocks } from "./prompts";
import { TOOLSETS, REGISTRY } from "./tools";
import type { ChatMode, StudentGoal, ToolContext } from "./tools/types";
import { withKeepalive } from "../keepalive";

// Worker-owned capabilities the chat loop reaches for. Injected (not imported)
// to keep this module free of a service-worker dependency cycle.
export interface ChatDeps {
  getApiKey: () => Promise<string | null>;
  broadcast: (message: object) => void;
  refreshAudit: () => Promise<void>;
  hydrateStudentCache: () => Promise<{ id: string | null; goal: StudentGoal | null }>;
  appendCuratorTurn: (turn: ConversationTurn) => Promise<ConversationTurn[]>;
  isCuratorAutoSaveEnabled: () => Promise<boolean>;
}

// Tracks the in-flight chat's AbortController so cancelCurrentChat() can abort
// the Anthropic stream when the side panel closes mid-response. Only one chat
// can be in flight per worker (Sonnet streams are sequential), so a single
// module-level ref is sufficient.
let currentChatController: AbortController | null = null;

export function cancelCurrentChat(): void {
  if (currentChatController) {
    currentChatController.abort();
  }
}

export async function handleAIChat(
  messages: ConversationMessage[],
  auditText: string,
  profile: string,
  mode: ChatMode = "normal",
  deps: ChatDeps
): Promise<void> {
  const apiKey = await deps.getApiKey();
  if (!apiKey) {
    deps.broadcast({ type: "AI_ERROR", error: "No API key set. Go to Settings and add your Anthropic API key." });
    return;
  }

  // Abort any prior in-flight chat before starting a new one (e.g. if the
  // student sends a second message while the first is still streaming —
  // rare but possible).
  if (currentChatController) currentChatController.abort();
  const controller = new AbortController();
  currentChatController = controller;

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  // auditText arrives already PII-free from refreshAudit — the renderer is the
  // enforcement boundary for Fordham's Third-Party Data Transfer Policy. See
  // degreeworks-audit-to-text.ts for the safe-by-construction design.

  // Long-term memory routing index. The full content stays in storage; Sonnet
  // sees only `#<id> [<type>] <description>` per entry and pages in specifics
  // via the recall_memory tool. Empty string when no memories exist yet.
  const memories = await loadMemories();
  const memoryIndex = memoriesToIndexText(memories);

  // Onboarding mode swaps out the system prompt and the tool set. The audit is
  // still available (Sonnet needs it to reference what's already known about
  // the student) but memory-writing routes via save_memory instead of the
  // curator. Catalog search stays available for any follow-ups that need it.
  const system: Anthropic.Messages.TextBlockParam[] = mode === "onboarding"
    ? buildOnboardingSystemBlocks({ auditText })
    : buildAdvisorSystemBlocks({ profile, memoryIndex, auditText });

  // Capabilities every tool executor may reach for. Worker-owned; injected.
  const ctx: ToolContext = {
    mode,
    broadcast: deps.broadcast,
    refreshAudit: deps.refreshAudit,
    hydrateStudentCache: deps.hydrateStudentCache,
  };

  // Mutable conversation for the tool-use loop. Starts with the UI's history,
  // grows as we append assistant (with tool_use blocks) + user (with
  // tool_result blocks) turns until Claude stops asking for tools.
  const convo: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Hoisted out of the tool-use loop so the curator (fire-and-forget after
  // AI_DONE) can see the assistant's final text blocks.
  let finalMessage: Anthropic.Messages.Message | null = null;

  try {
    // Cap at 5 tool-use rounds per user turn — generous but prevents runaway.
    for (let round = 0; round < 5; round++) {
      const stream = await client.messages.stream(
        {
          model: "claude-sonnet-5",
          max_tokens: 4096,
          system,
          tools: TOOLSETS[mode].map((t) => t.schema),
          messages: convo,
        },
        { signal: controller.signal }
      );

      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          deps.broadcast({ type: "AI_CHUNK", delta: chunk.delta.text });
        }
      }

      const final = await stream.finalMessage();
      finalMessage = final;

      if (final.stop_reason !== "tool_use") break;

      // Append Claude's partial turn (may contain text + tool_use blocks)
      convo.push({ role: "assistant", content: final.content });

      // Execute every tool_use block in this turn and collect results
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of final.content) {
        if (block.type !== "tool_use") continue;

        const def = REGISTRY[block.name];

        // Silent tools: save_memory during onboarding (deferred-batch flow —
        // the system-action bubble at end-of-intake renders the full list,
        // so per-turn chips would duplicate the signal and contradict the
        // "saves are invisible mid-intake" guarantee in ADR 0014 revisit).
        const isSilentTool = !!def?.silentIn?.includes(mode);
        if (!isSilentTool) {
          deps.broadcast({ type: "AI_TOOL_USE", name: block.name, input: block.input });
        }

        try {
          let resultJson: string;
          let resultCount = 0;

          if (def) {
            resultJson = await def.execute(block.input, ctx);
            resultCount = def.resultCount ? def.resultCount(resultJson) : 0;
          } else {
            resultJson = `Error: unknown tool "${block.name}"`;
          }

          if (!isSilentTool) {
            deps.broadcast({
              type: "AI_TOOL_RESULT",
              name: block.name,
              courseCount: resultCount,
            });
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: resultJson,
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      }

      convo.push({ role: "user", content: toolResults });
    }

    // Surface loop-exit conditions the student would otherwise not see. These
    // deltas append to the streamed text before AI_DONE closes the turn.
    if (finalMessage?.stop_reason === "tool_use") {
      // The loop exited while Claude was STILL asking for tools — it ran out of
      // the 5 rounds above (the per-turn cap), not because it was done.
      deps.broadcast({
        type: "AI_CHUNK",
        delta:
          "\n\n*(I hit my per-turn tool limit — ask me to continue and I'll pick up where I left off.)",
      });
    } else if (finalMessage?.stop_reason === "max_tokens") {
      deps.broadcast({
        type: "AI_CHUNK",
        delta: '\n\n*(Response was cut short — say "continue" for the rest.)',
      });
    }

    deps.broadcast({ type: "AI_DONE" });

    // Fire-and-forget memory curation. Haiku scans the just-completed turn
    // for durable facts about the student. Stub mode (write: false) logs
    // candidates to the console without persisting — flip to true once the
    // prompt is tuned. Failures are swallowed so the user-visible path is
    // unaffected.
    const lastUser = messages[messages.length - 1];
    const finalText = finalMessage
      ? finalMessage.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim()
      : "";
    // Curator runs only in normal mode — onboarding writes memories directly
    // via save_memory so running Haiku on top would double-extract. Also
    // gated by the student-facing auto-save toggle (Settings → "Auto-save
    // memories from chat"); when OFF the curator is skipped entirely.
    if (mode === "normal" && lastUser?.role === "user" && finalText) {
      const autoSaveOn = await deps.isCuratorAutoSaveEnabled();
      if (autoSaveOn) {
        // Keepalive: this whole chain runs AFTER AI_DONE, so no UI event is
        // queued to keep the MV3 worker awake. Without it, Chrome's ~30s idle
        // kill can land mid-Haiku-call and silently drop the memory save.
        withKeepalive(
          deps.appendCuratorTurn({ user: lastUser.content, assistant: finalText })
          .then(async (window) => {
            const result = await runCurator(apiKey, window, { write: true });
            // Emit a toast-friendly broadcast for each hard-fact save or
            // provisional promotion. The sidebar renders these as a single-
            // slot toast that auto-dismisses and gets replaced by the next.
            for (const fact of result.hardFacts) {
              deps.broadcast({
                type: "AI_CURATOR_SAVED",
                kind: "saved",
                memoryType: fact.type,
                description: fact.description,
              });
            }
            for (const promoted of result.promoted) {
              deps.broadcast({
                type: "AI_CURATOR_SAVED",
                kind: "promoted",
                memoryType: promoted.type,
                description: promoted.description,
              });
            }
            if (result.hardFacts.length > 0 || result.promoted.length > 0 || result.absorbed > 0) {
              const updated = await loadMemories();
              deps.broadcast({ type: "MEMORY_UPDATED", memories: updated });
            }
            if (result.provisionalHits.length > 0 || result.promoted.length > 0 || result.absorbed > 0) {
              const provisional = await loadProvisional();
              deps.broadcast({ type: "PROVISIONAL_UPDATED", provisional });
            }
          })
        ).catch((err) => console.warn("[Curator] unhandled error:", err));
      } else {
        console.log("[Curator] Skipped — auto-save toggle is OFF.");
      }
    }
  } catch (err) {
    // AbortError is expected on panel close / new turn preempt — don't
    // surface as a user-visible error. The partial response that already
    // streamed stays in session storage; a future turn continues cleanly.
    const isAbort =
      (err instanceof Error && err.name === "AbortError") || controller.signal.aborted;
    if (isAbort) {
      console.log("[FordhamHelper] Chat stream aborted (panel closed or new turn).");
      deps.broadcast({ type: "AI_DONE" });
    } else {
      deps.broadcast({ type: "AI_ERROR", error: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    if (currentChatController === controller) currentChatController = null;
  }
}
