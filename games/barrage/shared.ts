// Constants and deterministic helpers used by BOTH the server and the client.
//
// The client replays every volley locally from the server's event list: it starts from the
// terrain as it was before the volley and applies each crater at its time with `carve`. Both
// sides run the exact same integer maths here, so every screen ends up with the very same
// ground the server has (no drift, no "after" terrain needs to be sent).

/** World size in logical units (y grows downward). */
export const W = 1000;
export const H = 560;
/** Heightmap: one column every COL units, COLS columns (x = 0 .. 1000). */
export const COL = 2;
export const COLS = 501;

export const TANK_R = 12;
/** A shell explodes when it passes this close to a tank's centre. */
export const HIT_R = TANK_R + 3;
/** A tank's centre sits this far above the ground under it. */
export const TANK_LIFT = 7;
/** The turret pivots this far above the ground; the barrel is BARREL long. */
export const PIVOT_LIFT = 12;
export const BARREL = 16;

export const GRAVITY = 300; // u/s²
export const SPEED_PER_POWER = 9; // launch speed = power × 9 u/s
export const WIND_ACCEL = 6; // u/s² per wind point
/** Simulation step: 1/60 s. */
export const DT = 1 / 60;
export const STEP_MS = 1000 / 60;
/** Flights are capped at 10 s. */
export const MAX_STEPS = 600;
/** Ground deeper than this under a tank means it drops into the abyss. */
export const ABYSS_Y = 556;
export const MIN_X = 14;
export const MAX_X = W - 14;

export const FUEL = 200;
export const MAX_MOVE = 40;
export const MAX_TURNS = 15;
export const MAX_HP = 100;
export const MIN_POWER = 10;
export const MAX_POWER = 100;
export const MAX_WIND = 10;

/** Aim phase length (the first turn gets a little longer to find your bearings). */
export const AIM_MS = 15_000;
export const FIRST_AIM_MS = 20_000;
/** Resolve timeline: tanks drive and turrets swing for MOVE_MS, then everyone fires at FIRE_MS. */
export const MOVE_MS = 600;
export const FIRE_MS = 750;
/** After the last shell lands the scene lingers this long (falls, smoke, damage numbers). */
export const TAIL_MS = 1800;
/** With fewer than two live tanks still connected for this long, the game wraps up. */
export const FORFEIT_MS = 30_000;

/** Splitter bomblets fan out with this horizontal speed difference. */
export const SPLIT_SPREAD = 55;

export type Weapon = "shell" | "heavy" | "split";
export const WEAPON_LIST: readonly Weapon[] = ["shell", "heavy", "split"];

export interface WeaponSpec {
  name: string;
  emoji: string;
  /** Blast radius / max damage of one explosion (bomblets for the splitter). */
  r: number;
  max: number;
  /** Uses per game (Infinity = unlimited). */
  ammo: number;
  blurb: string;
}

export const WEAPONS: Record<Weapon, WeaponSpec> = {
  shell: { name: "Shell", emoji: "💣", r: 34, max: 35, ammo: Infinity, blurb: "Reliable. Unlimited." },
  heavy: { name: "Heavy", emoji: "☄️", r: 60, max: 55, ammo: 1, blurb: "Huge blast. One per game." },
  split: { name: "Splitter", emoji: "✨", r: 24, max: 20, ammo: 2, blurb: "Splits in 3 at the top." },
};

export interface Aim {
  angle: number;
  power: number;
  weapon: Weapon;
  move: number;
}

/** Surface height (y) at world x, linearly interpolated between columns. */
export function groundAt(t: ArrayLike<number>, x: number): number {
  const f = Math.min(COLS - 1, Math.max(0, x / COL));
  const i = Math.floor(f);
  if (i >= COLS - 1) return t[COLS - 1];
  return t[i] + (t[i + 1] - t[i]) * (f - i);
}

/** Centre of a tank standing at x. */
export const tankCy = (t: ArrayLike<number>, x: number) => groundAt(t, x) - TANK_LIFT;

/**
 * Blow a circular crater into the heightmap (in place). A heightmap can't hold caves, so
 * ground above a buried blast collapses into it: each column loses the slice of the circle
 * that overlaps the ground. Heights stay integers, so server and clients agree exactly.
 * Columns that changed are marked in `burnt` (no grass grows there any more).
 */
export function carve(t: number[], burnt: number[] | null, cx: number, cy: number, r: number): void {
  const c0 = Math.max(0, Math.ceil((cx - r) / COL));
  const c1 = Math.min(COLS - 1, Math.floor((cx + r) / COL));
  for (let c = c0; c <= c1; c++) {
    const dx = c * COL - cx;
    const h = Math.sqrt(Math.max(0, r * r - dx * dx));
    const bottom = cy + h;
    const s = t[c];
    if (s >= bottom) continue;
    const removed = bottom - Math.max(s, cy - h);
    const next = Math.min(H, Math.round(s + removed));
    if (next !== s) {
      t[c] = next;
      if (burnt) burnt[c] = 1;
    }
  }
}

/** Damage from a blast `d` units from a tank's hull (0 = touching). */
export function blastDamage(max: number, r: number, d: number): number {
  if (d >= r) return 0;
  return Math.round(max * Math.pow(1 - Math.max(0, d) / r, 1.5));
}

/** Muzzle position and launch velocity for a tank at x. */
export function launch(t: ArrayLike<number>, x: number, angle: number, power: number) {
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  const py = groundAt(t, x) - PIVOT_LIFT;
  const v = power * SPEED_PER_POWER;
  return { x: x + dx * BARREL, y: py + dy * BARREL, vx: dx * v, vy: dy * v };
}

/** Column runs of a 0/1 mask, as flat [from, to, from, to, ...] (inclusive). */
export function encodeRuns(mask: ArrayLike<number>): number[] {
  const out: number[] = [];
  let start = -1;
  for (let c = 0; c <= COLS; c++) {
    const on = c < COLS && mask[c] === 1;
    if (on && start < 0) start = c;
    else if (!on && start >= 0) {
      out.push(start, c - 1);
      start = -1;
    }
  }
  return out;
}

export function decodeRuns(runs: readonly number[]): number[] {
  const mask = new Array<number>(COLS).fill(0);
  for (let i = 0; i + 1 < runs.length; i += 2) {
    const a = Math.max(0, runs[i]);
    const b = Math.min(COLS - 1, runs[i + 1]);
    for (let c = a; c <= b; c++) mask[c] = 1;
  }
  return mask;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
