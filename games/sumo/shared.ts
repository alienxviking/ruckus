// Constants, wire types and tiny helpers shared by Ice Sumo's server and client.
// Nothing secret lives here: this file ships to browsers.

// ---------- world ----------

export const WORLD = 1000;
export const CENTER = 500;
export const RINK_R = 440;
/** The rink reaches this radius at the end of the shrink... */
export const RINK_MIN = 160;
/** ...shrinking linearly between these times (ms after the fight starts)... */
export const SHRINK_START_MS = 15_000;
export const SHRINK_END_MS = 55_000;
/** ...and then keeps shrinking at this rate (units/s) until somebody falls. */
export const SUDDEN_RATE = 8;

export const DISC_R = 36;
export const SPAWN_R = 260;

// ---------- timing ----------

export const TICK_MS = 50;
export const SUBSTEPS = 3;
export const COUNTDOWN_MS = 3_000;
export const ROUND_OVER_MS = 3_500;
export const WINS_NEEDED = 3;
export const MAX_ROUNDS = 7;
/** With fewer than two players connected for this long, the match ends. */
export const ABANDON_MS = 10_000;

// ---------- moves & power-ups ----------

export const DASH_CD_MS = 2_500;
export const TURBO_CD_MS = 600;
/** How long a disc counts as "dashing" for the visuals. */
export const DASH_FX_MS = 260;
/** Impacts at least this hard are shown (sparks, shake); softer ones are just shoving. */
export const HIT_FX_MIN = 140;

export const POWER_KINDS = ["heavy", "turbo"] as const;
export type PowerKind = (typeof POWER_KINDS)[number];
export const POWER_INFO: Record<PowerKind, { icon: string; label: string; blurb: string; ms: number; color: string }> =
  {
    heavy: { icon: "🍔", label: "Heavy", blurb: "double mass, bigger disc", ms: 6_000, color: "#fb923c" },
    turbo: { icon: "⚡", label: "Turbo", blurb: "dash recharges in 0.6s", ms: 5_000, color: "#facc15" },
  };
export const HEAVY_MASS = 2.2;
export const HEAVY_SCALE = 1.25;
export const POWER_FIRST_MS = 8_000;
export const POWER_EVERY_MS = 6_000;
/** A power-up is picked up when a disc's centre comes this close (disc radius + this). */
export const POWER_REACH = 22;

// ---------- wire format ----------

export type Phase = "countdown" | "fight" | "roundOver" | "final";

/** Disc flags (bit field). */
export const F_HEAVY = 1;
export const F_TURBO = 2;
export const F_DASH = 4;
export const F_OFFLINE = 8;

/**
 * [slot, x, y, vx, vy, flags, dash cooldown left in tenths of a second, stick]; all ints.
 * Trailing zeros are left off (most discs, most frames: just the first five). The stick
 * (encodeStick; left off when centred) lets every client dead-reckon the other discs.
 */
export type DiscTuple = [number, number, number, number, number, number?, number?, number?];

/**
 * Something that happened during a tick, played back when the snapshot is on screen:
 *   [0, x, y, impulse, slotA, slotB]   impact
 *   [1, slot, x, y, vx, vy, bySlot]    fell off (bySlot -1 = nobody shoved them)
 *   [2, slot, kind]                    picked up a power-up (index into POWER_KINDS)
 *   [3, slot, dx, dy]                  dash (direction x100)
 *   [4, x, y]                          a power-up slid into the water
 */
export type FxTuple = number[];
export const FX_HIT = 0;
export const FX_FALL = 1;
export const FX_PICKUP = 2;
export const FX_DASH = 3;
export const FX_MELT = 4;

/** One physics frame, sent to everyone 20 times a second (and carried in the view). */
export interface Snap {
  k: "s";
  /** Round number (clients never blend frames from different rounds). */
  n: number;
  /** Server time this frame shows. */
  t: number;
  /** Rink radius (one decimal). */
  r: number;
  /** Discs still on the ice. */
  p: DiscTuple[];
  /** Power-up on the floor: [kind index, x, y], or 0. */
  u: [number, number, number] | 0;
  fx?: FxTuple[];
  /** Nothing moved since the previous frame we sent until one tick before this one. */
  q?: 1;
  /**
   * Inputs received since the previous snapshot, for client prediction:
   * [slot, input number, ms from this frame's time to the sim time it takes effect from,
   *  ms from this frame's time to when it arrived (older servers leave it off)].
   */
  a?: [number, number, number, number?][];
}

// ---------- helpers ----------

/** Rink radius `ms` after the fight starts. */
export function rinkRadius(ms: number): number {
  if (ms <= SHRINK_START_MS) return RINK_R;
  if (ms <= SHRINK_END_MS)
    return RINK_R - ((ms - SHRINK_START_MS) / (SHRINK_END_MS - SHRINK_START_MS)) * (RINK_R - RINK_MIN);
  return Math.max(0, RINK_MIN - ((ms - SHRINK_END_MS) / 1000) * SUDDEN_RATE);
}

export function isSnap(v: unknown): v is Snap {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<Snap>;
  return s.k === "s" && typeof s.t === "number" && typeof s.n === "number" && Array.isArray(s.p);
}

// ---------- sticks on the wire ----------

/** A stick (-1..1 each way) as one small integer, 0.05 steps (0 = centred is left off the wire). */
export function encodeStick(x: number, y: number): number {
  return (Math.round(x * 20) + 20) * 41 + (Math.round(y * 20) + 20);
}

export function decodeStick(c: number | undefined): [number, number] {
  if (typeof c !== "number" || !Number.isInteger(c) || c < 0 || c > 40 * 41 + 40) return [0, 0];
  return [(Math.floor(c / 41) - 20) / 20, ((c % 41) - 20) / 20];
}
