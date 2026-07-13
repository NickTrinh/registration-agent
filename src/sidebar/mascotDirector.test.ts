import { describe, it, expect } from "vitest";
import {
  directorReducer,
  initialDirectorState,
  MIN_HOLD_MS,
  type Beat,
  type DirectorState,
} from "./mascotDirector";

const whatif: Beat = { pose: "whatif", toolPhrase: "Running a what-if audit" };
const reading: Beat = { pose: "reading", toolPhrase: "Searching the catalog" };
const ponder: Beat = { pose: "ponder", toolPhrase: null };

describe("mascot movement director", () => {
  it("shows the first beat immediately and starts its hold", () => {
    const s = directorReducer(initialDirectorState, {
      type: "push",
      beat: whatif,
      now: 1000,
    });
    expect(s.displayed).toEqual(whatif);
    expect(s.holdUntil).toBe(1000 + MIN_HOLD_MS);
  });

  it("queues a second pose behind the current hold instead of clobbering it", () => {
    let s = directorReducer(initialDirectorState, { type: "push", beat: whatif, now: 0 });
    s = directorReducer(s, { type: "push", beat: ponder, now: 500 });
    expect(s.displayed).toEqual(whatif);
    expect(s.queue).toEqual([ponder]);
  });

  it("holds a fast pose for its full min-hold (the what-if blink fix)", () => {
    let s = directorReducer(initialDirectorState, { type: "push", beat: whatif, now: 0 });
    // the tool already finished — reasoning wants to take over
    s = directorReducer(s, { type: "push", beat: ponder, now: 300 });
    // an advance before the hold elapses is a no-op: whatif stays on screen
    s = directorReducer(s, { type: "advance", now: 1000, desired: ponder });
    expect(s.displayed).toEqual(whatif);
    // once the hold is up, ponder takes over
    s = directorReducer(s, { type: "advance", now: MIN_HOLD_MS, desired: ponder });
    expect(s.displayed).toEqual(ponder);
  });

  it("coalesces a repeat of the tail beat (same tool firing twice)", () => {
    const s = directorReducer(initialDirectorState, { type: "push", beat: reading, now: 0 });
    const again = directorReducer(s, { type: "push", beat: reading, now: 100 });
    expect(again).toBe(s); // unchanged reference — dropped
  });

  it("keeps the same pose when it's still wanted after the hold (no idle flicker)", () => {
    let s = directorReducer(initialDirectorState, { type: "push", beat: ponder, now: 0 });
    s = directorReducer(s, { type: "advance", now: MIN_HOLD_MS, desired: ponder });
    expect(s.displayed).toEqual(ponder);
    expect(s.holdUntil).toBe(MIN_HOLD_MS + MIN_HOLD_MS); // re-armed, not retired
  });

  it("retires to idle when nothing is wanted and the queue is empty", () => {
    let s = directorReducer(initialDirectorState, { type: "push", beat: reading, now: 0 });
    s = directorReducer(s, { type: "advance", now: MIN_HOLD_MS, desired: null });
    expect(s.displayed).toBeNull();
  });

  it("caps the drain at turn end to the current beat plus the latest", () => {
    const backlog: DirectorState = {
      displayed: whatif,
      queue: [reading, ponder, reading],
      holdUntil: 5000,
    };
    const s = directorReducer(backlog, { type: "end" });
    expect(s.displayed).toEqual(whatif); // current beat still finishes
    expect(s.queue).toEqual([reading]); // backlog collapsed to the latest
  });
});
