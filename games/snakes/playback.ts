// Playback clock for the grid games (Snake Brawl, Turf). Pure logic so tests and the latency
// harness can drive it.
//
// The server moves everyone one cell per step, and stamps each step with its server time (`at`).
// The renderer draws the board a little in the past and glides every head from cell to cell.
// Which fractional step is on screen comes from the server's own timestamps, mapped onto
// performance.now() by a Timeline (netsmooth.ts): never from when messages happen to arrive.
// So bunched deliveries, gaps and an irregular server timer can't make heads surge or stall:
// motion between two steps takes exactly as long as the server took between them, and the
// adaptive delay keeps the next step in hand even on a jittery connection.

import { Timeline } from "./netsmooth";
import type { SnakeView } from "./server";
import { TICK_MS } from "./shared";

export interface TickSnap<V> {
  tick: number;
  /** Server time of the step (NaN when the frame isn't a timed step, e.g. a countdown). */
  at: number;
  view: V;
}

/** Steps kept (a few seconds' worth: enough for a slow connection's whole buffer). */
const KEEP = 40;

export class TickPlayback<V, S extends TickSnap<V> = TickSnap<V>> {
  snaps: S[] = [];
  /** Fractional step on screen. */
  t = 0;
  /** performance.now() of the last advance (-1: the clock restarts its slew). */
  at = -1;
  readonly clock: Timeline;

  constructor(period: number) {
    this.clock = new Timeline({ period, start: period + 90, min: period + 10, max: 700 });
  }

  /** Start over from this frame (first frame, new round, a jump the board can't animate). */
  reset(snap: S) {
    this.snaps.length = 0;
    this.snaps.push(snap);
    this.t = snap.tick;
  }

  /** Add the next step (`snap.tick` must be newer than the newest). */
  append(snap: S, perf: number) {
    if (Number.isFinite(snap.at)) this.clock.observe(snap.at, perf);
    this.snaps.push(snap);
    // Never drop the frame on screen or anything after it.
    while (this.snaps.length > KEEP && this.snaps[1].tick <= this.t) this.snaps.shift();
    if (this.snaps.length > KEEP * 2) {
      this.snaps.splice(0, this.snaps.length - KEEP);
      this.t = Math.max(this.t, this.snaps[0].tick);
    }
  }

  /** Same step, new facts (a phase change, someone left): replace the newest frame. */
  replaceLast(snap: S) {
    this.snaps[this.snaps.length - 1] = snap;
  }

  /** Jump to the newest frame (the tab was hidden): no fast-forward through old steps. */
  snapToEnd() {
    const last = this.snaps[this.snaps.length - 1];
    if (last) this.reset(last);
    this.at = -1;
    this.clock.pause();
  }

  /** The step on screen at server time `rt`, from the step timestamps (NaN: no timed steps). */
  stepAt(rt: number): number {
    let prev: S | null = null;
    for (const s of this.snaps) {
      if (!Number.isFinite(s.at)) continue;
      if (s.at > rt) {
        if (!prev) return -Infinity; // before the oldest step we hold: wait on it
        if (s.at <= prev.at) return prev.tick;
        return prev.tick + ((rt - prev.at) / (s.at - prev.at)) * (s.tick - prev.tick);
      }
      prev = s;
    }
    // Past the newest step (the buffer ran dry): hold it.
    return prev ? prev.tick : NaN;
  }

  advance(perf: number) {
    if (this.at < 0) this.clock.pause();
    this.at = perf;
    const last = this.snaps[this.snaps.length - 1];
    if (!last) return;
    let newest = -Infinity;
    for (const s of this.snaps) if (Number.isFinite(s.at) && s.at > newest) newest = s.at;
    // Never play past the newest step in hand: if the buffer runs dry, the clock waits (stretches
    // its delay) and carries on from there, instead of jumping ahead when the late steps land.
    const rt = this.clock.ready ? this.clock.tick(perf, newest === -Infinity ? Infinity : newest) : NaN;
    const want = Number.isFinite(rt) ? this.stepAt(rt) : NaN;
    // Untimed frames (countdown, between rounds): sit on the newest. Never run backwards.
    const target = Number.isNaN(want) ? last.tick : want;
    this.t = Math.min(last.tick, Math.max(this.t, target, this.snaps[0].tick));
    // Drop frames played past (keep the one on screen).
    while (this.snaps.length > 1 && this.snaps[1].tick <= this.t) this.snaps.shift();
  }
}

// ---------- Snake Brawl's timeline ----------


/** Bigger jumps than this between frames aren't animated (missed frames, a new round). */
const MAX_GAP = 3;

export interface SnakeSnap extends TickSnap<SnakeView> {
  tick: number;
  view: SnakeView;
}

/** Snake Brawl's frames on the step timeline (TickPlayback). */
export class SnakePlayback extends TickPlayback<SnakeView, SnakeSnap> {
  constructor() {
    super(TICK_MS);
  }

  /** Add a server frame. True when the timeline restarted (first frame, new round, a jump). */
  push(view: SnakeView, now: number): boolean {
    const last = this.snaps[this.snaps.length - 1];
    const snap: SnakeSnap = { tick: view.tick, view, at: view.phase === "play" && typeof view.at === "number" ? view.at : NaN };
    if (!last || view.round !== last.view.round || view.tick < last.tick || view.tick - last.tick > MAX_GAP) {
      this.reset(snap);
      if (Number.isFinite(snap.at)) this.clock.observe(snap.at, now);
      return true;
    }
    if (view.tick === last.tick) {
      // Same moment, new facts (phase change, someone left).
      if (!Number.isFinite(snap.at)) snap.at = last.at;
      this.replaceLast(snap);
      return false;
    }
    this.append(snap, now);
    return false;
  }
}
