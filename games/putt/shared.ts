// Constants, hole-layout types and tiny deterministic helpers shared by Putt Panic's server and
// client. Nothing secret lives here (or in holes.ts): every screen has to draw the course anyway.

// ---------- world ----------

/** Course size in world units (y grows downward). */
export const W = 1000;
export const H = 600;

export const BALL_R = 9;
/** Wooden rails: a segment with this thickness (the ball bounces off its rounded outline). */
export const WALL_T = 12;
export const CUP_R = 13;
/** Slow balls this close to the cup get pulled toward it (the lip "catches" them). */
export const CUP_PULL_R = 24;
export const PORTAL_R = 16;
export const HUB_R = 20;
export const BLADE_T = 10;
/** Boost pads are BOOST_L long (along their arrow) and BOOST_W wide. */
export const BOOST_L = 64;
export const BOOST_W = 40;

// ---------- the round ----------

export const HOLES_PER_GAME = 6;
/** Reach this many strokes without holing out and you pick up... */
export const MAX_STROKES = 6;
/** ...and score this for the hole. */
export const PICKUP_SCORE = 8;
export const MAX_POWER = 100;

/** Aim phase length (the first shot on each hole gets a little longer to read the green). */
export const FIRST_AIM_MS = 15_000;
export const AIM_MS = 12_000;
/** Every aim is revealed for this long before the balls launch together. */
export const REVEAL_MS = 700;
/** After the last ball stops the scene lingers this long (sinks, splashes, the summary). */
export const TAIL_MS = 1_400;
/** The scorecard between holes (ends early once everyone taps "Next hole"). */
export const CARD_MS = 8_000;
/** With fewer than two golfers connected for this long, the game wraps up. */
export const FORFEIT_MS = 30_000;

// ---------- physics ----------

/** The simulation runs at this rate; replay times are in these steps. */
export const STEP_HZ = 120;
export const STEP_MS = 1000 / STEP_HZ;
/** Rolling resistance: deceleration = a + b × speed (u/s²). Sand is much stickier. */
export const FELT = { a: 130, b: 0.8 };
export const SAND = { a: 900, b: 2.6 };
/** At full power a ball rolls this far on flat felt; distance is linear in power. */
export const MAX_ROLL = 850;

/** Distance a ball launched at speed v rolls on flat felt before it stops. */
export function rollDistance(v: number): number {
  const { a, b } = FELT;
  return v / b - (a / (b * b)) * Math.log(1 + (b * v) / a);
}

const SPEEDS: number[] = (() => {
  const out = [0];
  for (let p = 1; p <= MAX_POWER; p++) {
    const want = (MAX_ROLL * p) / MAX_POWER;
    let lo = 0;
    let hi = 4000;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (rollDistance(mid) < want) lo = mid;
      else hi = mid;
    }
    out.push((lo + hi) / 2);
  }
  return out;
})();

/** Launch speed (u/s) for a power of 0..100. */
export function launchSpeed(power: number): number {
  const p = Math.max(0, Math.min(MAX_POWER, Math.round(power)));
  return SPEEDS[p];
}

/** Aim angles travel as tenths of a degree, clockwise from +x (screen right). */
export const ANGLE_STEPS = 3600;
export const angleRad = (a10: number) => (a10 / 10) * (Math.PI / 180);

/** Windmill sail angle (radians) `t` seconds after the hole's clock started. */
export function millAngle(m: readonly number[], t: number): number {
  return ((m[5] ?? 0) * Math.PI) / 180 + m[3] * t;
}

// ---------- hole layouts ----------

/**
 * A shape is a flat number list:
 *   [x, y, r]            circle
 *   [x, y, w, h]         axis-aligned rectangle (top-left corner, size)
 *   [x0, y0, x1, y1, …]  polygon (3+ points)
 */
export type Shape = number[];

export interface Hole {
  id: string;
  name: string;
  par: number;
  /** 1 = gentle opener, 3 = devious. Games ramp up through the tiers. */
  tier: 1 | 2 | 3;
  /** One-line hint on the hole card. */
  tip: string;
  /** Tee centre and the direction (degrees, clockwise from +x) the tee faces. */
  tee: [number, number, number];
  cup: [number, number];
  /** Felt polygons. Their edges are wooden rails. */
  green: number[][];
  /** Extra rails: polylines [x0, y0, x1, y1, …]. */
  walls?: number[][];
  /** Bouncy posts: [x, y, r]. */
  bumpers?: number[][];
  sand?: Shape[];
  water?: Shape[];
  /** Bridges and islands: these override water. */
  dry?: Shape[];
  /** Paired portals: [ax, ay, bx, by]. Roll into one end, pop out of the other at the same speed. */
  portals?: number[][];
  /** Boost pads: [x, y, direction in degrees]. */
  boosts?: number[][];
  /** Windmills: [x, y, sail length, spin (rad/s, sign = direction), sails, phase (degrees)]. */
  mills?: number[][];
  /** Round slopes: [x, y, r, g]. g > 0 is a mound (rolls you outward), g < 0 a bowl. Strength g at the rim. */
  hills?: number[][];
}

export const CIRCLE = 3;
export const RECT = 4;

export function inShape(s: Shape, x: number, y: number): boolean {
  if (s.length === CIRCLE) {
    const dx = x - s[0];
    const dy = y - s[1];
    return dx * dx + dy * dy <= s[2] * s[2];
  }
  if (s.length === RECT) return x >= s[0] && x <= s[0] + s[2] && y >= s[1] && y <= s[1] + s[3];
  return inPoly(s, x, y);
}

export function inPoly(p: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const n = p.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i];
    const yi = p[2 * i + 1];
    const xj = p[2 * j];
    const yj = p[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function onGreen(h: Hole, x: number, y: number): boolean {
  return h.green.some((g) => inPoly(g, x, y));
}

export function inWater(h: Hole, x: number, y: number): boolean {
  if (!h.water?.some((s) => inShape(s, x, y))) return false;
  return !h.dry?.some((s) => inShape(s, x, y));
}

export function inSand(h: Hole, x: number, y: number): boolean {
  return !!h.sand?.some((s) => inShape(s, x, y));
}

/** Every rail as flat [ax, ay, bx, by] segments: felt outlines (closed) plus the extra walls. */
export function railSegments(h: Hole): number[][] {
  const out: number[][] = [];
  for (const g of h.green) {
    const n = g.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      out.push([g[2 * i], g[2 * i + 1], g[2 * j], g[2 * j + 1]]);
    }
  }
  for (const w of h.walls ?? []) {
    for (let i = 0; i + 3 < w.length; i += 2) out.push([w[i], w[i + 1], w[i + 2], w[i + 3]]);
  }
  return out;
}

/**
 * The eight tee spots in fill order (two staggered rows across the tee direction, centre first),
 * so two players stand side by side and a full group of eight fills the box.
 */
export function teeSpots(h: Hole): [number, number][] {
  const [x, y, deg] = h.tee;
  const a = (deg * Math.PI) / 180;
  const fx = Math.cos(a);
  const fy = Math.sin(a);
  const px = -fy;
  const py = fx;
  const rows: [number, number][] = [
    [0, -15],
    [0, 15],
    [0, -45],
    [0, 45],
    [-30, 0],
    [-30, -30],
    [-30, 30],
    [-30, -60],
  ];
  return rows.map(([f, p]) => [Math.round(x + fx * f + px * p), Math.round(y + fy * f + py * p)]);
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Score name relative to par (strokes taken on a finished hole). */
export function scoreName(strokes: number, par: number, picked = false): string {
  if (picked) return "Picked up";
  if (strokes === 1) return "Hole in one!";
  const d = strokes - par;
  if (d <= -3) return "Albatross!";
  if (d === -2) return "Eagle!";
  if (d === -1) return "Birdie!";
  if (d === 0) return "Par";
  if (d === 1) return "Bogey";
  if (d === 2) return "Double bogey";
  return `+${d}`;
}
