// Constants, field geometry, walking and the wire format shared by Flag Raid's server and client.
// Nothing secret lives here: this file ships to browsers.

// ---------- world ----------
// The field is tall: Red's half is the bottom (y > MID), Blue's the top. Clients turn it so your
// own base is at the bottom (phones) or on the left (wide screens).

export const WORLD_W = 600;
export const WORLD_H = 1000;
export const MID = WORLD_H / 2;
export const PLAYER_R = 18;
/** Players stay this far from the field's edge. */
export const EDGE = 22;
/** Walking speed at full stick (units/s) and how fast velocity turns toward it (units/s²). */
export const SPEED = 230;
export const ACCEL = 1700;
/** Carrying a flag slows you a little; Turbo makes you much faster. */
export const CARRY_SPEED = 0.86;
export const TURBO_SPEED = 1.45;
export const TURBO_MS = 4_000;

/** Base centres (index = team). Team 0 (Red) lives at the bottom. */
export const BASES: readonly [number, number][] = [
  [WORLD_W / 2, WORLD_H - 92],
  [WORLD_W / 2, 92],
];
/** Base circle: its own team (unless carrying) can't stand in it, so nobody camps on the flag. */
export const BASE_R = 74;
/** A flag is picked up / returned when a player's centre comes this close. */
export const FLAG_REACH = PLAYER_R + 16;
/** Two players touch at this distance. */
export const TOUCH = PLAYER_R * 2 + 2;

// ---------- timing ----------

export const TICK_MS = 50;
export const SUBSTEPS = 2;
export const SUB_MS = TICK_MS / SUBSTEPS;
export const COUNTDOWN_MS = 3_000;
/** After a capture: celebrate, then everyone lines up again. */
export const SCORED_MS = 3_200;
export const RESPAWN_MS = 2_600;
/** Comeback: the team that's behind comes back from a tag faster. */
export const RESPAWN_BEHIND_MS = 1_400;
/** A dropped flag goes home by itself after this long. */
export const FLAG_RETURN_MS = 9_000;
/** Overtime (time ran out on a tie: next capture wins) lasts at most this long. */
export const OVERTIME_MS = 120_000;
/** With a whole team gone for this long, the match ends. */
export const ABANDON_MS = 12_000;
export const POWER_FIRST_MS = 9_000;
export const POWER_EVERY_MS = 13_000;
export const POWER_R = 16;

// ---------- teams ----------

export const teamHalf = (team: number, y: number) => (team === 0 ? y >= MID : y < MID);

// ---------- walking ----------

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Keep a body on the field, and out of its own team's base circle unless it carries a flag
 * (`team` -1 = no base rule).
 */
export function collideBody(b: Body, team: number, carrying: boolean) {
  if (team === 0 || team === 1) {
    if (!carrying) {
      const [bx, by] = BASES[team];
      const dx = b.x - bx;
      const dy = b.y - by;
      const d2 = dx * dx + dy * dy;
      const min = BASE_R + PLAYER_R;
      if (d2 < min * min) {
        const d = Math.sqrt(d2);
        const nx = d > 1e-6 ? dx / d : 0;
        const ny = d > 1e-6 ? dy / d : team === 0 ? -1 : 1;
        b.x = bx + nx * min;
        b.y = by + ny * min;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          b.vx -= vn * nx;
          b.vy -= vn * ny;
        }
      }
    }
  }
  if (b.x < EDGE) {
    b.x = EDGE;
    if (b.vx < 0) b.vx = 0;
  } else if (b.x > WORLD_W - EDGE) {
    b.x = WORLD_W - EDGE;
    if (b.vx > 0) b.vx = 0;
  }
  if (b.y < EDGE) {
    b.y = EDGE;
    if (b.vy < 0) b.vy = 0;
  } else if (b.y > WORLD_H - EDGE) {
    b.y = WORLD_H - EDGE;
    if (b.vy > 0) b.vy = 0;
  }
}

/** One step of running: velocity turns toward the stick's velocity, then the body moves. */
export function stepBody(b: Body, ix: number, iy: number, dt: number, speed: number, team: number, carrying: boolean) {
  let ax = ix * SPEED * speed - b.vx;
  let ay = iy * SPEED * speed - b.vy;
  const m = Math.hypot(ax, ay);
  const max = ACCEL * dt;
  if (m > max) {
    ax *= max / m;
    ay *= max / m;
  }
  b.vx += ax;
  b.vy += ay;
  if (ix === 0 && iy === 0 && Math.abs(b.vx) < 0.5 && Math.abs(b.vy) < 0.5) {
    b.vx = 0;
    b.vy = 0;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  collideBody(b, team, carrying);
}

/** Stick input as sent (ints in -100..100) -> direction with magnitude <= 1 (small = stand still). */
export function inputDir(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < 20) return [0, 0];
  const k = m > 100 ? 1 / m : 0.01;
  return [x * k, y * k];
}

// ---------- wire format ----------

export type Phase = "countdown" | "play" | "scored" | "final";

/** Per-player status digit in a frame. */
export const ST_ON = 0;
export const ST_OUT = 1;
export const ST_TURBO = 2;

/**
 * A flag in a frame: [where, x, y]. where: -1 = at its base, -2 = dropped at (x, y),
 * a slot = carried by that player.
 */
export type FlagTuple = [number, number, number];
export const FLAG_HOME = -1;
export const FLAG_DROPPED = -2;

/**
 * Something that happened, played back when the frame is on screen:
 *   [FX_TAG, slot, bySlot]      tagged and sent home
 *   [FX_GRAB, slot, team]       grabbed team's flag
 *   [FX_CAP, slot, team]        captured (team = the scoring team)
 *   [FX_RETURN, team, bySlot]   a flag went home (bySlot -1 = by itself)
 *   [FX_DROP, team]             a flag was dropped
 *   [FX_POWER, slot]            picked up Turbo
 *   [FX_SPAWN, slot]            back on the field
 */
export type FxTuple = number[];
export const FX_TAG = 0;
export const FX_GRAB = 1;
export const FX_CAP = 2;
export const FX_RETURN = 3;
export const FX_DROP = 4;
export const FX_POWER = 5;
export const FX_SPAWN = 6;

/** One frame, sent to everyone 20 times a second (and carried in the view). */
export interface Snap {
  k: "s";
  /** Line-up number: bumps whenever everyone is put back in place (frames never blend across). */
  n: number;
  /** Server time this frame shows. */
  t: number;
  /** Every player's position, 4 characters each (see encodePositions), in slot order. */
  p: string;
  /** Per player one status digit (ST_*). */
  s: string;
  /** Both flags (index = owning team). */
  g: [FlagTuple, FlagTuple];
  /** Turbo on the field: [x, y]. */
  u?: [number, number];
  f?: FxTuple[];
  /** Nothing moved since the previous frame sent until one tick before this one. */
  q?: 1;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

/** Integer x and y (10 bits each) packed into four URL-safe base64 characters per player. */
export function encodePositions(xy: ArrayLike<number>): string {
  let out = "";
  for (let i = 0; i + 1 < xy.length; i += 2) {
    const x = Math.max(0, Math.min(1023, Math.round(xy[i])));
    const y = Math.max(0, Math.min(1023, Math.round(xy[i + 1])));
    const v = x * 1024 + y;
    out += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
  }
  return out;
}

/** Inverse of encodePositions: [x0, y0, x1, y1, …]. Bad characters decode as 0. */
export function decodePositions(p: string): number[] {
  const n = Math.floor(p.length / 4);
  const out = new Array<number>(n * 2);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const v =
      ((B64_INDEX[p[o]] ?? 0) << 18) |
      ((B64_INDEX[p[o + 1]] ?? 0) << 12) |
      ((B64_INDEX[p[o + 2]] ?? 0) << 6) |
      (B64_INDEX[p[o + 3]] ?? 0);
    out[i * 2] = v >> 10;
    out[i * 2 + 1] = v & 1023;
  }
  return out;
}

export function isSnap(v: unknown): v is Snap {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<Snap>;
  return (
    s.k === "s" &&
    typeof s.t === "number" &&
    typeof s.n === "number" &&
    typeof s.p === "string" &&
    typeof s.s === "string" &&
    Array.isArray(s.g) &&
    s.g.length === 2
  );
}

/** Speed multiplier for a player from their frame status and whether they carry a flag. */
export function speedOf(status: number, carrying: boolean) {
  return (status === ST_TURBO ? TURBO_SPEED : 1) * (carrying ? CARRY_SPEED : 1);
}
