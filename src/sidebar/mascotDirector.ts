// The mascot movement director (pure core). The raw stream flips the desired
// pose every time a tool starts or finishes — and tools return fast
// (run_what_if in ~1s), so a direct event→pose mapping blinks: Patch only ever
// saw ponder and idle because the what-if pose never held. This reducer sits
// between the stream and the mascot and gives every pose a real beat: a
// minimum hold, a short queue so a new state waits its turn instead of
// clobbering the current one, and coalescing so a repeated tool doesn't
// re-queue. The React wiring + timers live in useMascotDirector.ts; keeping the
// logic pure makes the min-hold / coalesce / drain-cap rules unit-testable.
import type { MascotState } from "./components/Mascot";

// One beat of behavior: a pose plus the tool phrase that belongs with it
// (null = pure reasoning, which renders the live rotating thinking phrase).
export type Beat = { pose: MascotState; toolPhrase: string | null };

// Minimum time any non-idle pose stays on screen before the next may replace
// it. Must clear the longest sprite loop (whatif, 1280ms in styles.css) so
// every pose completes at least one cycle; ~2s is what makes a one-second
// what-if read as "he looked in the crystal ball" instead of a flicker. Single
// knob — turn it down if the poses feel laggy behind the stream.
export const MIN_HOLD_MS = 2000;

export type DirectorState = {
  displayed: Beat | null; // the pose actually on screen (null = idle)
  queue: Beat[]; // beats waiting for the current hold to elapse
  holdUntil: number; // epoch ms; when `displayed`'s min-hold ends
};

export const initialDirectorState: DirectorState = {
  displayed: null,
  queue: [],
  holdUntil: 0,
};

export type DirectorAction =
  | { type: "push"; beat: Beat; now: number } // a new desired pose arrived
  | { type: "advance"; now: number; desired: Beat | null } // hold may be up
  | { type: "end" }; // the turn finished — cap any drain

export function sameBeat(a: Beat | null, b: Beat | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.pose === b.pose && a.toolPhrase === b.toolPhrase;
}

// The tail of the pipeline: the last beat that will play (queued if any,
// otherwise the one on screen). Coalescing compares against this.
const tailOf = (s: DirectorState): Beat | null =>
  s.queue.length ? s.queue[s.queue.length - 1] : s.displayed;

export function directorReducer(
  s: DirectorState,
  action: DirectorAction
): DirectorState {
  switch (action.type) {
    case "push": {
      // Coalesce: a beat identical to the pipeline's tail is a repeat of a pose
      // already scheduled (the same tool firing twice) — drop it.
      if (sameBeat(tailOf(s), action.beat)) return s;
      // Nothing playing → show it now and start its hold.
      if (!s.displayed) {
        return {
          displayed: action.beat,
          queue: [],
          holdUntil: action.now + MIN_HOLD_MS,
        };
      }
      // Otherwise it waits behind the current pose's min-hold.
      return { ...s, queue: [...s.queue, action.beat] };
    }
    case "advance": {
      // The current pose hasn't earned its keep yet — ignore.
      if (s.displayed && action.now < s.holdUntil) return s;
      // Something queued → promote it and start its hold.
      if (s.queue.length) {
        const [next, ...rest] = s.queue;
        return {
          displayed: next,
          queue: rest,
          holdUntil: action.now + MIN_HOLD_MS,
        };
      }
      // Queue empty: if the same pose is still wanted, keep it (the CSS loop
      // just continues); otherwise retire to idle.
      if (action.desired && sameBeat(action.desired, s.displayed)) {
        return { ...s, holdUntil: action.now + MIN_HOLD_MS };
      }
      if (!s.displayed) return s;
      return { displayed: null, queue: [], holdUntil: 0 };
    }
    case "end": {
      // Turn finished while poses were still draining. Let the current beat
      // finish its hold, but collapse any backlog to just the latest, so he
      // doesn't narrate three stale beats over an answer already on screen.
      if (s.queue.length <= 1) return s;
      return { ...s, queue: s.queue.slice(-1) };
    }
  }
}
