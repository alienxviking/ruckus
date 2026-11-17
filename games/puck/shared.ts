// Constants, wire types and table geometry shared by Puck's server and client.
// Nothing secret lives here: this file ships to browsers.

// ---------- table ----------

/** The table is portrait: team 0 (Red) defends the bottom goal, team 1 (Blue) the top one. */
export const W = 600;
export const H = 1000;
export const MID = H / 2;
export const PUCK_R = 24;
export const PADDLE_R = 38;
/** A player alone against two gets a bigger paddle. */
export const BIG_PADDLE_R = 46;
/** Goal mouth width (centred on each end wall). */
export const GOAL_W = 230;
export const GOAL_X0 = (W - GOAL_W) / 2;
export const GOAL_X1 = (W + GOAL_W) / 2;
/** How deep the net is drawn behind the end wall. */
export const NET_D = 50;

// ---------- timing ----------

export const TICK_MS = 50;
export const SUBSTEPS = 5;
export const SUB_MS = TICK_MS / SUBSTEPS;
export const DT = SUB_MS / 1000;
/** First faceoff countdown, the goal celebration, and the faceoff freeze after it. */
export const START_MS = 3_000;
export const GOAL_MS = 2_200;
export const SET_MS = 1_300;
/** The puck may sit in one half this long before it's handed to the other side. */
export const HALF_MS = 7_000;
/** A team with nobody connected for this long forfeits. */
export const ABANDON_MS = 12_000;

// ---------- physics ----------

export const PADDLE_MAX = 3_000;
export const WALL_E = 0.88;
export const PADDLE_E = 0.9;
/** Puck speed caps and per-substep friction for each speed setting. */
export const SPEEDS = {
  normal: { max: 1_700, friction: 0.9985 },
  turbo: { max: 2_300, friction: 0.9993 },
} as const;
export type SpeedKey = keyof typeof SPEEDS;

// ---------- teams & zones ----------

/** "all" = the whole half, "fwd"/"back" = the two lanes of a 2-player side. */
export type Zone = "all" | "fwd" | "back";

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Where a paddle's centre may go. */
export function zoneRect(team: number, zone: Zone, r: number): Rect {
  // Bottom side (team 0) in its own terms; the top side is the mirror image.
  let y0 = MID + r;
  let y1 = H - r;
  if (zone === "fwd") y1 = H * 0.8;
  else if (zone === "back") y0 = H * 0.68;
  const x0 = r;
  const x1 = W - r;
  return team === 0 ? { x0, x1, y0, y1 } : { x0, x1, y0: H - y1, y1: H - y0 };
}

export function clampTo(rect: Rect, x: number, y: number): [number, number] {
  return [Math.max(rect.x0, Math.min(rect.x1, x)), Math.max(rect.y0, Math.min(rect.y1, y))];
}

/** A paddle's resting spot. */
export function homeOf(team: number, zone: Zone): [number, number] {
  const y = zone === "fwd" ? H * 0.66 : H - 120;
  return team === 0 ? [W / 2, y] : [W / 2, H - y];
}

/** Which half the puck is in: 0 = bottom (team 0's), 1 = top. */
export const halfOf = (y: number) => (y >= MID ? 0 : 1);

// ---------- wire format ----------

export type Phase = "set" | "live" | "goal" | "final";

/** One physics frame, sent to everyone 20 times a second (and carried in the view). */
export interface Snap {
  k: "s";
  /** Faceoff number: frames from different faceoffs are never blended. */
  n: number;
  /** Server time this frame shows. */
  t: number;
  /** Puck: x, y, vx, vy (ints). */
  p: [number, number, number, number];
  /** Paddles in slot order: x, y, ... (ints). */
  d: number[];
  /** Slot that touched the puck last (-1 none). */
  l: number;
  /** Sim time the puck entered the half it's in (for the 7-second rule). */
  h: number;
  /** Nothing moved since the previous frame sent until one tick before this one. */
  q?: 1;
}

export function isSnap(v: unknown): v is Snap {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<Snap>;
  return s.k === "s" && typeof s.t === "number" && typeof s.n === "number" && Array.isArray(s.p) && Array.isArray(s.d);
}

/** Move your paddle toward (x, y): world units, ints. */
export type PuckAction = { type: "m"; x: number; y: number };

export interface GoalRec {
  /** Team that scored, the slot credited (-1 = own goal) and the slot that touched it last. */
  team: number;
  slot: number;
  last: number;
}

export interface PuckView {
  phase: Phase;
  endsAt: number;
  ids: string[];
  team: number[];
  zone: Zone[];
  r: number[];
  score: [number, number];
  target: number;
  speed: SpeedKey;
  goals: number[];
  log: GoalRec[];
  /** Winning team once the match is over (-1 = nobody). */
  champions: number | null;
  /** The last faceoff came from the 7-second rule: the team handed the puck. */
  handed: number | null;
  /** The match ends at this time unless someone on the empty side returns. */
  abandonAt: number | null;
  snap: Snap;
}
