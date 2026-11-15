// Client-side replay of a roll. Everything here is a pure function of the ROLL view and an
// elapsed time, so every screen (and anyone joining mid-roll) shows the same moment.

import type { PuttView, RollView } from "./server";
import { REVEAL_MS, STEP_MS } from "./shared";

/** Ms into the timeline of simulation step k. */
export const stepMs = (k: number) => REVEAL_MS + k * STEP_MS;
/** A holed ball takes this long to drop out of sight. */
export const DROP_MS = 280;
/** A splashed ball pops back in over this long once everything has stopped... */
export const RESPAWN_MS = 420;
/** ...but never sooner than this after its splash. */
const RESPAWN_AFTER = 650;

export interface FxEvent {
  ms: number;
  e: (string | number)[];
}

export interface Replay {
  key: string;
  r: RollView;
  /** When the last ball stopped. */
  settleMs: number;
  /** Per slot: [angle, power] of the shot taken this roll, or null. */
  shot: ([number, number] | null)[];
  sinkMs: (number | null)[];
  splashMs: (number | null)[];
  resp: ([number, number] | null)[];
  /** Per slot: ms the last path segment ends. */
  endMs: number[];
  fx: FxEvent[];
}

export function replayKey(r: RollView) {
  return `${r.at}:${r.dur}:${r.settle}`;
}

export function buildReplay(view: PuttView): Replay | null {
  const r = view.roll;
  if (!r || view.phase !== "roll" || !Array.isArray(r.from) || !Array.isArray(r.paths)) return null;
  const n = r.from.length;
  const shot: Replay["shot"] = new Array(n).fill(null);
  for (const [slot, a, p] of r.shots) if (slot >= 0 && slot < n) shot[slot] = [a, p];
  const sinkMs: (number | null)[] = new Array(n).fill(null);
  const splashMs: (number | null)[] = new Array(n).fill(null);
  const fx: FxEvent[] = [];
  for (const e of r.ev) {
    const ms = stepMs(Number(e[1]) || 0);
    fx.push({ ms, e });
    const slot = Number(e[2]);
    if (e[0] === "sink" && slot >= 0 && slot < n) sinkMs[slot] = ms;
    if (e[0] === "water" && slot >= 0 && slot < n) splashMs[slot] = ms;
  }
  const resp: Replay["resp"] = new Array(n).fill(null);
  for (const [slot, x, y] of r.resp) if (slot >= 0 && slot < n) resp[slot] = [x, y];
  const endMs = r.paths.map((segs) => {
    const last = segs[segs.length - 1];
    return last && last.length >= 3 ? stepMs(last[last.length - 3]) : REVEAL_MS;
  });
  return { key: replayKey(r), r, settleMs: stepMs(r.settle), shot, sinkMs, splashMs, resp, endMs, fx };
}

export interface BallPose {
  x: number;
  y: number;
  /** 0 = hidden. */
  alpha: number;
  scale: number;
  /** Which path segment we're on (changes on a portal hop), -1 when parked. */
  seg: number;
}

/** Position on a keyframe segment at step k (clamped to its ends). */
function onSeg(seg: number[], k: number, out: BallPose) {
  const m = seg.length / 3;
  if (k <= seg[0] || m === 1) {
    out.x = seg[1];
    out.y = seg[2];
    return;
  }
  if (k >= seg[3 * (m - 1)]) {
    out.x = seg[3 * (m - 1) + 1];
    out.y = seg[3 * (m - 1) + 2];
    return;
  }
  // Binary search for the keyframe pair around k.
  let lo = 0;
  let hi = m - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (seg[3 * mid] <= k) lo = mid;
    else hi = mid;
  }
  const k0 = seg[3 * lo];
  const k1 = seg[3 * hi];
  const f = k1 > k0 ? (k - k0) / (k1 - k0) : 1;
  out.x = seg[3 * lo + 1] + (seg[3 * hi + 1] - seg[3 * lo + 1]) * f;
  out.y = seg[3 * lo + 2] + (seg[3 * hi + 2] - seg[3 * lo + 2]) * f;
}

/** Where ball `slot` is at time e (ms into the roll). Writes into and returns `out`. */
export function ballAt(rp: Replay, slot: number, e: number, cup: readonly number[], out: BallPose): BallPose {
  const from = rp.r.from[slot];
  out.alpha = 1;
  out.scale = 1;
  out.seg = -1;
  if (!from || from[3] !== 1) {
    out.x = from?.[0] ?? 0;
    out.y = from?.[1] ?? 0;
    out.alpha = 0;
    return out;
  }
  const segs = rp.r.paths[slot] ?? [];
  const k = (e - REVEAL_MS) / STEP_MS;
  if (!segs.length || k <= 0) {
    out.x = from[0];
    out.y = from[1];
    return out;
  }
  let si = 0;
  for (let i = 1; i < segs.length; i++) if (segs[i][0] <= k) si = i;
  onSeg(segs[si], k, out);
  out.seg = si;
  const sink = rp.sinkMs[slot];
  if (sink !== null && e >= sink) {
    // Drop into the cup: slide to the middle and shrink away.
    const f = Math.min(1, (e - sink) / DROP_MS);
    out.x += (cup[0] - out.x) * f;
    out.y += (cup[1] - out.y) * f;
    out.scale = 1 - 0.65 * f;
    out.alpha = f >= 1 ? 0 : 1 - f * 0.5;
    return out;
  }
  const splash = rp.splashMs[slot];
  if (splash !== null && e >= splash) {
    const back = rp.resp[slot];
    const at = Math.max(rp.settleMs, splash + RESPAWN_AFTER);
    if (back && e >= at) {
      const f = Math.min(1, (e - at) / RESPAWN_MS);
      out.x = back[0];
      out.y = back[1];
      out.scale = 1 + 0.6 * (1 - f) * (1 - f);
      out.alpha = f;
      out.seg = -2;
    } else out.alpha = 0;
  }
  return out;
}

/** Strokes on the card for ball `slot` at time e (the shot counts at launch, a splash when it lands). */
export function strokesAt(rp: Replay, slot: number, e: number): number {
  const from = rp.r.from[slot];
  if (!from) return 0;
  let s = from[2];
  if (rp.shot[slot] && e >= REVEAL_MS) s += 1;
  const sp = rp.splashMs[slot];
  if (sp !== null && e >= sp) s += 1;
  return s;
}

export function sunkBy(rp: Replay, slot: number, e: number): boolean {
  const from = rp.r.from[slot];
  if (from && from[3] !== 1) return true;
  const s = rp.sinkMs[slot];
  return s !== null && e >= s;
}
