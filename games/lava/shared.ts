// Constants, hex-grid helpers and wire types shared by Floor is Lava's server and client.
// Nothing secret lives here: this file ships to browsers.

// ---------- world ----------

/** Centre of the arena in world units. Every coordinate on the wire is a positive int. */
export const CENTER = 600;
/** Hex tile size: centre to corner (flat-top hexes). */
export const TILE = 40;
export const SQRT3 = Math.sqrt(3);
/** Centre to the middle of a flat side. */
export const APOTHEM = (TILE * SQRT3) / 2;
export const PLAYER_R = 22;
/** Arena radius in tiles: 127 tiles for up to 4 players, 169 for 5-8. */
export const arenaRadius = (players: number) => (players <= 4 ? 6 : 7);

// ---------- timing ----------

export const TICK_MS = 50;
export const SUBSTEPS = 3;
export const COUNTDOWN_MS = 3_000;
export const ROUND_OVER_MS = 3_500;
export const WINS_NEEDED = 3;
export const MAX_ROUNDS = 7;
/** With fewer than two players connected for this long, the match ends. */
export const ABANDON_MS = 10_000;

// ---------- tiles ----------

/** Tile stages: 0 solid, 1-3 cracking, 4 gone (lava). */
export const GONE = 4;
/** Each crack stage lasts this long, so a tile falls 0.9 s after it starts cracking. */
export const CRACK_STAGE_MS = 300;
/** Standing on one tile this long cracks it too (no camping). */
export const CAMP_MS = 1_200;
/** From this long into a round, the outer ring crumbles... */
export const COLLAPSE_START_MS = 25_000;
/** ...and the next ring in every this often. */
export const COLLAPSE_EVERY_MS = 3_000;

// ---------- moves & power-ups ----------

/** Physics substep length (ms). Jumps are counted in substeps so both sides agree exactly. */
export const SUB_MS = TICK_MS / SUBSTEPS;
/** Airborne for 33 substeps (550 ms)... */
export const JUMP_STEPS = 33;
export const JUMP_MS = JUMP_STEPS * SUB_MS;
/** ...and ready again 90 substeps (1.5 s) after take-off. */
export const JUMP_CD_STEPS = 90;
export const JUMP_CD_MS = JUMP_CD_STEPS * SUB_MS;
/** How high a jump arcs on screen (world units; visual only). */
export const JUMP_HEIGHT = 30;

export const POWER_KINDS = ["rebuild", "float", "shock"] as const;
export type PowerKind = (typeof POWER_KINDS)[number];
export const POWER_INFO: Record<PowerKind, { icon: string; label: string; blurb: string; color: string }> = {
  rebuild: { icon: "🧱", label: "Rebuild", blurb: "rebuilds the floor around you", color: "#fbbf24" },
  float: { icon: "🪽", label: "Float", blurb: "hover over lava for 3 s", color: "#7dd3fc" },
  shock: { icon: "💥", label: "Shockwave", blurb: "cracks everyone else's floor", color: "#f472b6" },
};
export const FLOAT_MS = 3_000;
/** The last stretch of a float blinks as a warning. */
export const FLOAT_WARN_MS = 900;
/** Rebuild restores tiles up to this many steps away; Shockwave cracks this far around each rival. */
export const REBUILD_RANGE = 2;
export const SHOCK_RANGE = 1;
export const POWER_FIRST_MS = 4_000;
export const POWER_EVERY_MS = 5_000;
export const MAX_POWERS = 2;
/** A power-up is grabbed when your centre comes this close to its tile's centre. */
export const POWER_REACH = 26;

// ---------- wire format ----------

export type Phase = "countdown" | "fight" | "roundOver" | "final";

/** Player flags (bit field). */
export const F_FLOAT = 1;
/** Float runs out soon (it blinks). */
export const F_FLOAT_LOW = 2;
export const F_OFFLINE = 4;

/**
 * [slot, x, y, vx, vy, flags, jump cooldown left in substeps]; all ints.
 * Trailing zeros are left off (most players, most frames: just the first five).
 * Airborne while the cooldown is above JUMP_CD_STEPS - JUMP_STEPS.
 */
export type PlayerTuple = [number, number, number, number, number, number?, number?];

/**
 * Something that happened during a tick, played back when the snapshot is on screen:
 *   [0, x, y, impulse, slotA, slotB]   bump
 *   [1, slot, x, y, bySlot]            fell into the lava (bySlot -1 = nobody bumped them)
 *   [2, slot, kind, tile]              picked up a power-up (kind = index into POWER_KINDS)
 *   [3, slot, dx, dy]                  jumped (direction x100)
 *   [4, slot]                          set off a shockwave
 *   [5, tile]                          a power-up sank with its tile
 */
export type FxTuple = number[];
export const FX_HIT = 0;
export const FX_FALL = 1;
export const FX_PICKUP = 2;
export const FX_JUMP = 3;
export const FX_SHOCK = 4;
export const FX_SINK = 5;

/** One physics frame, sent to everyone 20 times a second (and carried in the view). */
export interface Snap {
  k: "s";
  /** Round number (clients never blend frames from different rounds). */
  n: number;
  /** Server sim time this frame shows. */
  t: number;
  /** Players still standing (or flying). */
  p: PlayerTuple[];
  /** Tile changes since the previous frame, flattened: [tile, stage, tile, stage, ...]. */
  c?: number[];
  /** Power-ups on the floor: [kind index, tile]. */
  u: [number, number][];
  fx?: FxTuple[];
  /** Nothing moved since the previous frame we sent until one tick before this one. */
  q?: 1;
  /**
   * Inputs received since the previous snapshot, for client prediction:
   * [slot, input number, ms from this frame's time to the sim time it took effect from].
   */
  a?: [number, number, number][];
}

export function isSnap(v: unknown): v is Snap {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<Snap>;
  return s.k === "s" && typeof s.t === "number" && typeof s.n === "number" && Array.isArray(s.p);
}

// ---------- hex grid (flat-top, axial q/r) ----------

export interface Hex {
  q: number;
  r: number;
  /** Centre in world units. */
  x: number;
  y: number;
  /** Steps from the centre tile (0 = centre ring). */
  d: number;
}

export interface Board {
  R: number;
  tiles: Hex[];
  /** (q + R) * (2R + 1) + (r + R) -> tile index, or -1. */
  lookup: Int16Array;
  /** Neighbour tile indexes per tile. */
  near: number[][];
  /** Half extents of the arena in world units (tile corners included). */
  halfW: number;
  halfH: number;
}

const boards = new Map<number, Board>();

export const hexDist = (q: number, r: number) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
export const hexX = (q: number) => CENTER + 1.5 * TILE * q;
export const hexY = (q: number, r: number) => CENTER + SQRT3 * TILE * (r + q / 2);

/** The hex arena of radius R (cached; tile order is fixed, so indexes match on both sides). */
export function board(R: number): Board {
  const hit = boards.get(R);
  if (hit) return hit;
  const tiles: Hex[] = [];
  const side = 2 * R + 1;
  const lookup = new Int16Array(side * side).fill(-1);
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      lookup[(q + R) * side + (r + R)] = tiles.length;
      tiles.push({ q, r, x: hexX(q), y: hexY(q, r), d: hexDist(q, r) });
    }
  }
  const b: Board = {
    R,
    tiles,
    lookup,
    near: [],
    halfW: 1.5 * TILE * R + TILE,
    halfH: SQRT3 * TILE * (R + 0.5),
  };
  const dirs = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  b.near = tiles.map((h) =>
    dirs.map(([dq, dr]) => tileOf(b, h.q + dq, h.r + dr)).filter((i) => i >= 0),
  );
  boards.set(R, b);
  return b;
}

/** Tile index at axial (q, r), or -1 off the arena. */
export function tileOf(b: Board, q: number, r: number): number {
  const R = b.R;
  if (q < -R || q > R || r < -R || r > R || hexDist(q, r) > R) return -1;
  return b.lookup[(q + R) * (2 * R + 1) + (r + R)];
}

/** Axial coordinates of the hex containing a world point. */
export function hexAt(x: number, y: number): [number, number] {
  const dx = x - CENTER;
  const dy = y - CENTER;
  const fq = ((2 / 3) * dx) / TILE;
  const fr = ((-1 / 3) * dx + (SQRT3 / 3) * dy) / TILE;
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  // (+0 so a rounded -0 never leaks out.)
  return [q + 0, r + 0];
}

/** Tile index under a world point (-1 = off the arena). */
export function tileAt(b: Board, x: number, y: number): number {
  const [q, r] = hexAt(x, y);
  return tileOf(b, q, r);
}

/** Crack stage `ms` after a tile started cracking (0 before it starts, GONE once it falls). */
export function crackStage(ms: number): number {
  if (ms < 0) return 0;
  return Math.min(GONE, 1 + Math.floor(ms / CRACK_STAGE_MS));
}

/** Unit vector from a point toward the arena centre ((0, 1) at the centre). */
export function faceCentre(x: number, y: number): [number, number] {
  const dx = CENTER - x;
  const dy = CENTER - y;
  const m = Math.hypot(dx, dy);
  return m < 1e-6 ? [0, 1] : [dx / m, dy / m];
}

/** Jump cooldown on the wire (substeps left) -> substeps since take-off, or -1 when not jumping lately. */
export function jumpAge(cd: number): number {
  return cd > 0 ? JUMP_CD_STEPS - cd : -1;
}
