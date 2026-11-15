// How Quick Draw times a tap on the client. Pure, so it can be tested.
//
// Reaction time runs from the animation frame that first painted "DRAW!" (the timestamp
// requestAnimationFrame hands its callback, which is when that frame started), to the tap's
// own event timestamp (when the browser received the touch or key, not when the handler ran).
// Both are on the performance.now() clock. A tap stamped before that frame started was made
// before the signal could be seen: it counts as jumping the gun, however the messages raced.

export interface Painted {
  /** `${game}:${round}` the paint belongs to. */
  key: string;
  /** requestAnimationFrame timestamp of the frame that painted the signal. */
  at: number;
}

export type TapTiming = { kind: "drew"; rt: number } | { kind: "early"; rt: null };

/** Classify a tap at `at` (event timestamp) during the `phase` the screen shows for round `key`. */
export function timeTap(phase: string, key: string, painted: Painted | null, at: number): TapTiming {
  if (phase === "go" && painted && painted.key === key && Number.isFinite(at) && at >= painted.at) {
    return { kind: "drew", rt: Math.round(at - painted.at) };
  }
  return { kind: "early", rt: null };
}
