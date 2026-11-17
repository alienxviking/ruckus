// Tower Stack: the deterministic block physics shared by server.ts (which decides) and
// client.tsx (which predicts, so drops feel instant). Everything here is a pure function of
// the game's seed, the level and the drop time, so both sides compute identical towers.

export const READY_MS = 3_000;
/** After a drop, the next block starts sliding this much later. */
export const GAP_MS = 380;
/** A block nobody drops falls by itself after this long. */
export const IDLE_MS = 9_000;
/** How far in the past a drop may claim to have happened (network lag allowance). */
export const MAX_LAG_MS = 700;
/** After a collapse, the next tower (if you have one left) starts this much later. */
export const RESTART_MS = 2_200;
/** The whole game is capped (towers still standing then just count as they are). */
export const GAME_MS = 4 * 60_000;
/** A disconnected player's tower is closed after this long away. */
export const AWAY_MS = 6_000;

/** Base footprint (world units), block height and the slide's half-range. */
export const SIZE = 100;
export const BLOCK_H = 16;
export const RANGE = 140;
/** Landing within this of dead centre counts as perfect (snaps, nothing is cut). */
export const PERFECT = 3;
/** From this many perfects in a row, each perfect also grows the block back a little. */
export const GROW_FROM = 3;
export const GROW_BY = 6;

export const BLOCK_POINTS = 10;
export const PERFECT_POINTS = 5;
/** How many top blocks views carry (the camera only ever shows the top of the tower). */
export const KEEP = 18;

export type Speed = "chill" | "normal" | "fast";
/** Starting slide speed in world units per ms. */
export const SPEEDS: Record<Speed, number> = { chill: 0.1, normal: 0.13, fast: 0.165 };

/** [centre x, centre z, width along x, depth along z]. */
export type Rect = [number, number, number, number];
export const BASE: Rect = [0, 0, SIZE, SIZE];

const r2 = (n: number) => Math.round(n * 100) / 100;

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Motion {
  /** Slides along x (true) or z (false). */
  alongX: boolean;
  /** Which side it enters from (-1 / 1). */
  dir: number;
  /** Units per ms. */
  v: number;
}

/** How the block for level `lv` (1 = first block on the base) moves. Same for everyone. */
export function motion(seed: number, lv: number, speed: Speed): Motion {
  const rnd = mulberry32((seed ^ Math.imul(lv, 0x9e3779b1)) >>> 0);
  const dir = rnd() < 0.5 ? -1 : 1;
  const jitter = 0.9 + rnd() * 0.2;
  const ramp = 1 + 0.045 * Math.min(lv - 1, 36);
  return { alongX: lv % 2 === 1, dir, v: SPEEDS[speed] * ramp * jitter };
}

/** Offset of the sliding block from the top block's centre, `t` ms after it appeared. */
export function offsetAt(m: Motion, t: number): number {
  const d = m.v * Math.max(0, t);
  const u = d % (4 * RANGE);
  const off = u < 2 * RANGE ? -RANGE + u : 3 * RANGE - u;
  return r2(off * m.dir);
}

/** The sliding block's rect at offset `off` over `top`. */
export function slidingRect(top: Rect, m: Motion, off: number): Rect {
  return m.alongX ? [r2(top[0] + off), top[1], top[2], top[3]] : [top[0], r2(top[1] + off), top[2], top[3]];
}

export interface Landing {
  kind: "perfect" | "cut" | "miss";
  /** The block that stays (null on a miss). */
  rect: Rect | null;
  /** The piece that falls off (the whole block on a miss, null on a perfect). */
  chip: Rect | null;
  combo: number;
}

/** What happens when the block for `lv` is dropped at offset `off` onto `top`. */
export function land(top: Rect, m: Motion, off: number, combo: number): Landing {
  const ax = m.alongX ? 0 : 1;
  const size = top[ax + 2];
  const a = Math.abs(off);
  if (a <= PERFECT) {
    const rect = top.slice() as Rect;
    const next = combo + 1;
    if (next >= GROW_FROM) rect[ax + 2] = r2(Math.min(SIZE, size + GROW_BY));
    return { kind: "perfect", rect, chip: null, combo: next };
  }
  const moving = slidingRect(top, m, off);
  if (a >= size) return { kind: "miss", rect: null, chip: moving, combo: 0 };
  const keep = r2(size - a);
  const rect = top.slice() as Rect;
  rect[ax] = r2(top[ax] + off / 2);
  rect[ax + 2] = keep;
  const chip = top.slice() as Rect;
  chip[ax] = r2(top[ax] + Math.sign(off) * (size / 2 + a / 2));
  chip[ax + 2] = r2(a);
  return { kind: "cut", rect, chip, combo: 0 };
}

export const towerPoints = (placed: number, perfects: number) => placed * BLOCK_POINTS + perfects * PERFECT_POINTS;

// ---------- wire types ----------

export type StackAction =
  /** Drop the block of level `lv`, `t` ms after it appeared (the client's own clock, server time). */
  { type: "drop"; lv: number; t: number };

export interface TowerView {
  /** Which tower this is (0-based; a new one starts after a collapse when tries remain). */
  n: number;
  /** Level of the block now sliding (blocks placed = lv - 1). */
  lv: number;
  /** The top blocks, highest last (at most KEEP; the base is level 0). */
  top: Rect[];
  /** Level of top[0]. */
  from: number;
  /** When the sliding block appeared (server time). */
  spawnAt: number;
  combo: number;
  perfects: number;
  score: number;
  alive: boolean;
  /** Collapsed: when the next tower starts (null = no tries left). */
  restartAt: number | null;
}

export interface Row {
  id: string;
  /** Current tower height (blocks placed) and best score so far. */
  h: number;
  best: number;
  score: number;
  alive: boolean;
  done: boolean;
  /** Top block's area as a share of the base (how much room is left). */
  room: number;
}

export interface StackView {
  phase: "ready" | "play" | "over";
  startsAt: number;
  endsAt: number;
  seed: number;
  speed: Speed;
  tries: number;
  rows: Row[];
  me: { tower: TowerView; best: number; triesLeft: number } | null;
  /** Spectators watch the leader's tower. */
  watch: { id: string; tower: TowerView } | null;
}

/** One-shot: someone's tower collapsed (for a sound / ticker). */
export interface FallEvent {
  t: "fall";
  id: string;
  h: number;
}
export type StackEvent = FallEvent;
