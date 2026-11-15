// Client-side replay of a volley. Everything here is a pure function of the RESOLVE view and
// an elapsed time, so every screen (and anyone joining mid-volley) shows the same moment.

import type { BarrageView, ResolveView, TankView } from "./server";
import {
  ABYSS_Y,
  COL,
  COLS,
  FIRE_MS,
  H,
  MOVE_MS,
  STEP_MS,
  WEAPON_LIST,
  carve,
  decodeRuns,
  groundAt,
  type Weapon,
} from "./shared";

/** Ms into the timeline of simulation step k. */
export const stepMs = (k: number) => FIRE_MS + k * STEP_MS;
/** A crater sinks in over this long. */
export const CARVE_MS = 170;
/** Visual fall acceleration for tanks dropping into craters (u/s²). */
const FALL_G = 1400;

export interface Fall {
  ms: number;
  from: number;
  to: number;
}

export interface Replay {
  key: string;
  r: ResolveView;
  /** Terrain before the volley (snaps[0]) and after each boom i (snaps[i + 1]). */
  snaps: number[][];
  /** Burnt masks, same indexing. */
  burnt: number[][];
  /** Column range each boom touched, [from, to]. */
  spans: [number, number][];
  boomMs: number[];
  shellT0: number[];
  shellT1: number[];
  /** Per slot: x before and after the drive. */
  x0: number[];
  x1: number[];
  /** Per slot: turret angle before / fired (null = didn't fire). */
  ang0: number[];
  fired: (number | null)[];
  weapon: (Weapon | null)[];
  power: (number | null)[];
  hp0: number[];
  alive0: boolean[];
  /** Per slot: ground drops under the tank (after the drive). */
  falls: Fall[][];
  /** Per slot: when it died (ms) and how, or null. */
  death: ({ ms: number; why: "hp" | "abyss"; by: number } | null)[];
  /** When the last thing happened (last boom or shell end). */
  lastMs: number;
}

export function replayKey(r: ResolveView) {
  return `${r.at}:${r.dur}:${r.booms.length}:${r.shells.length}`;
}

export function buildReplay(view: BarrageView): Replay | null {
  const r = view.resolve;
  if (!r || view.phase !== "resolve") return null;
  const n = view.tanks.length;
  const snaps: number[][] = [view.terrain.slice()];
  const burnt: number[][] = [decodeRuns(view.burnt)];
  const spans: [number, number][] = [];
  for (const b of r.booms) {
    const t = snaps[snaps.length - 1].slice();
    const m = burnt[burnt.length - 1].slice();
    carve(t, m, b.x, b.y, b.r);
    snaps.push(t);
    burnt.push(m);
    spans.push([Math.max(0, Math.ceil((b.x - b.r) / COL)), Math.min(COLS - 1, Math.floor((b.x + b.r) / COL))]);
  }
  const x0 = Array.from({ length: n }, (_, i) => r.from[i]?.[0] ?? view.tanks[i].x);
  const x1 = x0.slice();
  for (const [s, , to] of r.moves) if (s >= 0 && s < n) x1[s] = to;
  const ang0 = Array.from({ length: n }, (_, i) => r.from[i]?.[3] ?? view.tanks[i].angle);
  const fired: (number | null)[] = new Array(n).fill(null);
  const weapon: (Weapon | null)[] = new Array(n).fill(null);
  const power: (number | null)[] = new Array(n).fill(null);
  for (const [s, a, p, w] of r.aims) {
    if (s < 0 || s >= n) continue;
    fired[s] = a;
    power[s] = p;
    weapon[s] = WEAPON_LIST[w] ?? "shell";
  }
  const boomMs = r.booms.map((b) => stepMs(b.t));
  const death: Replay["death"] = new Array(n).fill(null);
  for (const d of r.deaths) if (d.s >= 0 && d.s < n) death[d.s] = { ms: stepMs(d.t), why: d.why, by: d.by };
  const falls: Fall[][] = Array.from({ length: n }, (_, i) => {
    const out: Fall[] = [];
    const x = x1[i];
    for (let b = 0; b < r.booms.length; b++) {
      const g0 = groundAt(snaps[b], x);
      const g1 = groundAt(snaps[b + 1], x);
      if (g1 > g0 + 0.5) out.push({ ms: boomMs[b], from: g0, to: g1 > ABYSS_Y ? H + 80 : g1 });
    }
    return out;
  });
  const shellT0 = r.shells.map((s) => stepMs(s.a));
  const shellT1 = r.shells.map((s) => stepMs(s.a + s.n));
  const lastMs = Math.max(FIRE_MS, ...shellT1, ...boomMs);
  return {
    key: replayKey(r),
    r,
    snaps,
    burnt,
    spans,
    boomMs,
    shellT0,
    shellT1,
    x0,
    x1,
    ang0,
    fired,
    weapon,
    power,
    hp0: Array.from({ length: n }, (_, i) => r.from[i]?.[1] ?? view.tanks[i].hp),
    alive0: Array.from({ length: n }, (_, i) => (r.from[i]?.[2] ?? 1) === 1),
    falls,
    death,
    lastMs,
  };
}

/** Number of booms that have happened by time e. */
export function boomsBy(rp: Replay, e: number): number {
  let i = 0;
  while (i < rp.boomMs.length && rp.boomMs[i] <= e) i++;
  return i;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function tankX(rp: Replay, slot: number, e: number): number {
  const a = rp.x0[slot];
  const b = rp.x1[slot];
  if (a === b || e >= MOVE_MS) return b;
  if (e <= 0) return a;
  return a + (b - a) * easeInOut(e / MOVE_MS);
}

export function turretAngle(rp: Replay, slot: number, e: number): number {
  const a = rp.ang0[slot];
  const b = rp.fired[slot];
  if (b === null || e >= MOVE_MS) return b ?? a;
  if (e <= 0) return a;
  return a + (b - a) * easeInOut(e / MOVE_MS);
}

/** Ground y under a tank at time e, with falls into fresh craters animated. */
export function tankGround(rp: Replay, slot: number, e: number): number {
  const falls = rp.falls[slot];
  let last: Fall | null = null;
  for (const f of falls) if (f.ms <= e) last = f;
  if (!last) return groundAt(rp.snaps[0], tankX(rp, slot, e));
  const dt = (e - last.ms) / 1000;
  return Math.min(last.to, last.from + 0.5 * FALL_G * dt * dt);
}

export function tankHp(rp: Replay, slot: number, e: number): number {
  const d = rp.death[slot];
  if (d && d.ms <= e) return 0; // the abyss takes whatever armour was left
  let hp = rp.hp0[slot];
  for (let b = 0; b < rp.r.booms.length && rp.boomMs[b] <= e; b++) {
    const d = rp.r.booms[b].d;
    for (let k = 0; k + 1 < d.length; k += 2) if (d[k] === slot) hp -= d[k + 1];
  }
  return Math.max(0, hp);
}

export function tankAlive(rp: Replay, slot: number, e: number): boolean {
  if (!rp.alive0[slot]) return false;
  const d = rp.death[slot];
  return !d || d.ms > e;
}

/** Time of path point k of shell i. */
function pointMs(rp: Replay, i: number, k: number): number {
  const s = rp.r.shells[i];
  return stepMs(s.a + Math.min(k * rp.r.every, s.n));
}

/** Where shell i is at time e, or null when it isn't flying. Writes into `out` = [x, y]. */
export function shellPos(rp: Replay, i: number, e: number, out: number[]): boolean {
  const s = rp.r.shells[i];
  const t0 = rp.shellT0[i];
  const t1 = rp.shellT1[i];
  if (e < t0 || e >= t1 || s.p.length < 2) return false;
  const m = s.p.length >> 1;
  const seg = rp.r.every * STEP_MS;
  let k = Math.floor((e - t0) / seg);
  if (k >= m - 1) k = m - 2;
  if (k < 0) {
    out[0] = s.p[0];
    out[1] = s.p[1];
    return true;
  }
  const ta = pointMs(rp, i, k);
  const tb = k + 1 === m - 1 ? t1 : pointMs(rp, i, k + 1);
  const f = tb > ta ? Math.min(1, Math.max(0, (e - ta) / (tb - ta))) : 1;
  out[0] = s.p[2 * k] + (s.p[2 * k + 2] - s.p[2 * k]) * f;
  out[1] = s.p[2 * k + 1] + (s.p[2 * k + 3] - s.p[2 * k + 1]) * f;
  return true;
}

/** Path points of shell i between times a and b (for trails), as flat [x, y, ...]. */
export function shellTrail(rp: Replay, i: number, a: number, b: number, out: number[]): number {
  const s = rp.r.shells[i];
  const m = s.p.length >> 1;
  let len = 0;
  const pos = [0, 0];
  if (shellPos(rp, i, Math.max(a, rp.shellT0[i]), pos)) {
    out[len++] = pos[0];
    out[len++] = pos[1];
  }
  for (let k = 0; k < m; k++) {
    const t = k === m - 1 ? rp.shellT1[i] : pointMs(rp, i, k);
    if (t <= a) continue;
    if (t >= b) break;
    out[len++] = s.p[2 * k];
    out[len++] = s.p[2 * k + 1];
  }
  if (shellPos(rp, i, b, pos)) {
    out[len++] = pos[0];
    out[len++] = pos[1];
  }
  return len;
}

/**
 * Terrain to draw at time e into `out` (fresh craters sink in over CARVE_MS).
 * Returns a key that changes whenever the drawn ground changes.
 */
export function terrainAt(rp: Replay, e: number, out: Float32Array): string {
  const i = boomsBy(rp, e);
  const base = rp.snaps[i];
  for (let c = 0; c < COLS; c++) out[c] = base[c];
  let key = `${rp.key}|${i}`;
  for (let j = Math.max(0, i - 12); j < i; j++) {
    const age = e - rp.boomMs[j];
    if (age >= CARVE_MS) continue;
    const k = 1 - Math.pow(1 - age / CARVE_MS, 2);
    const [c0, c1] = rp.spans[j];
    const pre = rp.snaps[j];
    const post = rp.snaps[j + 1];
    for (let c = c0; c <= c1; c++) out[c] -= (post[c] - pre[c]) * (1 - k);
    key += `|${j}:${Math.round(k * 12)}`;
  }
  return key;
}

/** Tank list in the after-volley order with their animated values, for the DOM roster. */
export function hpNow(view: BarrageView, rp: Replay | null, e: number): { hp: number; alive: boolean }[] {
  return view.tanks.map((t: TankView, i) =>
    rp ? { hp: tankHp(rp, i, e), alive: tankAlive(rp, i, e) } : { hp: t.hp, alive: t.alive },
  );
}
