// Guards the see/tell boundary: what the student sees is a superset of what the
// model is told. Implements: ADR 0028 (as amended by its revisit clause — the
// uiOnly flag is gone; errors never enter `messages` at all, see ADR 0026).

import { describe, it, expect } from "vitest";
import { conversationalOnly, type ConversationMessage } from "./types";

function turn(
  role: "user" | "assistant",
  content: string,
  extra: Partial<ConversationMessage> = {}
): ConversationMessage {
  return { role, content, timestamp: "2026-07-09T00:00:00.000Z", ...extra };
}

describe("conversationalOnly (ADR 0028)", () => {
  it("keeps real user and assistant turns", () => {
    const msgs = [turn("user", "what do I still need?"), turn("assistant", "two courses.")];
    expect(conversationalOnly(msgs)).toEqual(msgs);
  });

  it("drops systemAction bubbles (they are UI events, not turns)", () => {
    const msgs = [
      turn("user", "I'm a neuroscience major"),
      turn("assistant", "", {
        systemAction: { kind: "onboarding-saves", items: [], done: true },
      }),
    ];
    expect(conversationalOnly(msgs)).toHaveLength(1);
  });

  it("systemAction bubbles stay dropped across many later turns", () => {
    // The original bug class: a UI artifact riding along in EVERY subsequent
    // request for the rest of the session.
    const msgs: ConversationMessage[] = [
      turn("assistant", "", {
        systemAction: { kind: "onboarding-saves", items: [], done: true },
      }),
    ];
    for (let i = 0; i < 10; i++) {
      msgs.push(turn("user", `q${i}`), turn("assistant", `a${i}`));
    }
    const sent = conversationalOnly(msgs);
    expect(sent).toHaveLength(20);
    expect(sent.some((m) => m.systemAction)).toBe(false);
  });

  it("does not mutate the input array", () => {
    const msgs = [
      turn("assistant", "", {
        systemAction: { kind: "onboarding-saves", items: [], done: true },
      }),
    ];
    conversationalOnly(msgs);
    expect(msgs).toHaveLength(1);
  });
});
