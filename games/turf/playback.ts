// Turf's frames on the step timeline (see snakes/playback.ts: which tick is on screen comes from
// the server's step timestamps, never from when frames happen to arrive).

import { TickPlayback, type TickSnap } from "../snakes/playback";
import type { PainterTuple, TurfView } from "./server";
import { TICK_MS } from "./shared";

/** Bigger jumps than this between frames aren't animated (missed frames, a new game). */
const MAX_GAP = 4;

export interface TurfSnap<P> extends TickSnap<TurfView> {
  tick: number;
  view: TurfView;
  painters: P[];
}

export class TurfPlayback<P> extends TickPlayback<TurfView, TurfSnap<P>> {
  constructor(private readonly parse: (list: PainterTuple[]) => P[]) {
    super(TICK_MS);
  }

  /** True when the timeline restarted (first frame, new game, a jump). */
  push(view: TurfView, now: number): boolean {
    const last = this.snaps[this.snaps.length - 1];
    const at = view.phase === "play" && typeof view.at === "number" ? view.at : NaN;
    const snap: TurfSnap<P> = { tick: view.tick, view, painters: this.parse(view.players), at };
    if (
      !last ||
      view.tick < last.tick ||
      view.tick - last.tick > MAX_GAP ||
      view.w !== last.view.w ||
      view.h !== last.view.h ||
      view.players.length !== last.view.players.length ||
      view.seq < last.view.seq
    ) {
      this.reset(snap);
      if (Number.isFinite(at)) this.clock.observe(at, now);
      return true;
    }
    if (view.tick === last.tick) {
      if (!Number.isFinite(snap.at)) snap.at = last.at;
      this.replaceLast(snap); // same moment, new facts (aim, someone left, the end)
      return false;
    }
    this.append(snap, now);
    return false;
  }
}
