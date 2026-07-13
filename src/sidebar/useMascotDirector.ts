import { useEffect, useReducer } from "react";
import {
  type Beat,
  directorReducer,
  initialDirectorState,
  sameBeat,
} from "./mascotDirector";

// React wiring for the movement director (logic + rules live in
// mascotDirector.ts). `desired` is the pose the current stream state wants;
// `active` is whether a turn is in flight; `reduced` bypasses everything (a
// reduced-motion ram is a static frame, so the phrase should just track the
// live status with no holds). Returns the beat actually on screen — route BOTH
// the mascot pose and the bubble phrase through it so they never disagree.
export function useMascotDirector(
  desired: Beat | null,
  active: boolean,
  reduced: boolean
): Beat | null {
  const [state, dispatch] = useReducer(directorReducer, initialDirectorState);

  // Feed desired transitions in. Keyed so ponder's rotating phrase (same pose,
  // changing text, but toolPhrase stays null) never churns the director.
  const key = desired ? `${desired.pose}|${desired.toolPhrase ?? ""}` : "";
  useEffect(() => {
    if (desired) dispatch({ type: "push", beat: desired, now: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Turn end caps any drain to the current beat plus the latest queued one.
  useEffect(() => {
    if (!active) dispatch({ type: "end" });
  }, [active]);

  // There's timer work only if something is queued, or the on-screen pose is no
  // longer the one wanted (it must advance or retire). When the same pose is
  // wanted and nothing's queued, the CSS loop just runs — no timer needed.
  const needsWork =
    state.queue.length > 0 ||
    (!!state.displayed && !sameBeat(desired, state.displayed));

  useEffect(() => {
    if (reduced || !needsWork) return;
    const delay = Math.max(0, state.holdUntil - Date.now());
    const t = setTimeout(
      () => dispatch({ type: "advance", now: Date.now(), desired }),
      delay
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsWork, state.holdUntil, reduced, key]);

  // Reduced motion: no holds. The pose renders as a static idle frame anyway,
  // and the bubble should show the live status, so hand back `desired` directly.
  return reduced ? desired : state.displayed;
}
