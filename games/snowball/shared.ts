// Constants, maps, motion and snowball flight shared by Snowball Showdown's server and client.
// Nothing secret lives here: this file ships to browsers.

// ---------- world ----------

export const WORLD_W = 1000;
export const WORLD_H = 640;
export const PLAYER_R = 16;
/** Players stay this far from the field's edge. */
export const EDGE = 28;
/** Walking speed at full stick (units/s) and how fast velocity turns toward it (units/s²). */
export const SPEED = 190;
export const ACCEL = 1500;

// ---------- timing ----------

export const TICK_MS = 50;
export const SUBSTEPS = 2;
export const SUB_MS = TICK_MS / SUBSTEPS;
export const COUNTDOWN_MS = 3_000;
export const ROUND_OVER_MS = 4_000;
export const WINS_NEEDED = 3;
export const MAX_ROUNDS = 7;
/** Blizzard: from here on, one hit knocks anyone out. */
export const SUDDEN_MS = 60_000;
/** A round still going at this point ends in a draw. */
export const ROUND_CAP_MS = 100_000;
/** With fewer than two players connected for this long, the match ends. */
export const ABANDON_MS = 10_000;

// ---------- snowballs ----------

export const MAX_HP = 3;
export const AMMO = 3;
/** Scooping a snow pile overfills you to this many. */
export const AMMO_PILE = 5;
export const RELOAD_MS = 800;
export const THROW_CD_MS = 220;
export const MIN_RANGE = 60;
export const MAX_RANGE = 520;
export const BALL_R = 6;
export const BIG_R = 12;
/** Height a snowball leaves the hand at. */
export const HAND_H = 18;
/** A snowball lower than this hits a player; lower than FORT_H it hits a fort; trees are tall. */
export const HIT_H = 42;
export const FORT_H = 34;
export const TREE_H = 90;
/** Trees block snowballs with this share of their drawn radius (the trunk and dense branches). */
export const TREE_CORE = 0.72;
export const KNOCK = 260;
export const BIG_KNOCK = 420;
export const FORT_HP = 6;
export const TRIPLE_SPREAD = 0.2;

export const PILE_R = 26;
export const PILE_REGROW_MS = 8_000;

export const POWER_KINDS = ["big", "triple"] as const;
export type PowerKind = (typeof POWER_KINDS)[number];
export const POWER_INFO: Record<PowerKind, { icon: string; label: string; blurb: string }> = {
  big: { icon: "☃️", label: "Big ball", blurb: "2 damage, wide splash" },
  triple: { icon: "❄️", label: "Triple shot", blurb: "three balls in a fan" },
};
export const POWER_CHARGES = 3;
export const POWER_R = 16;
export const POWER_FIRST_MS = 7_000;
export const POWER_EVERY_MS = 9_000;

// ---------- maps ----------

/** A snow wall: a capsule from (x1, y1) to (x2, y2), `th` half-thick. Zero length = a round mound. */
export interface FortDef {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  th: number;
}
export interface Tree {
  x: number;
  y: number;
  r: number;
}
export interface Field {
  name: string;
  forts: FortDef[];
  trees: Tree[];
  piles: [number, number][];
  /** Eight spawn spots around the edge, in ring order. */
  spawns: [number, number][];
}

const wall = (x1: number, y1: number, x2: number, y2: number, th = 15): FortDef => ({ x1, y1, x2, y2, th });
const mound = (x: number, y: number, th = 30): FortDef => ({ x1: x, y1: y, x2: x, y2: y, th });
const tree = (x: number, y: number, r = 24): Tree => ({ x, y, r });

const RING: [number, number][] = [
  [100, 100],
  [500, 75],
  [900, 100],
  [925, 320],
  [900, 540],
  [500, 565],
  [100, 540],
  [75, 320],
];
export const FIELDS: Field[] = [
  {
    name: "Courtyard",
    forts: [
      wall(245, 180, 345, 180),
      wall(655, 180, 755, 180),
      wall(245, 460, 345, 460),
      wall(655, 460, 755, 460),
      wall(500, 262, 500, 378),
    ],
    trees: [tree(395, 95, 22), tree(605, 545, 22), tree(185, 320), tree(815, 320), tree(860, 200, 20), tree(140, 440, 20)],
    piles: [
      [395, 320],
      [605, 320],
    ],
    spawns: RING,
  },
  {
    name: "Pine Hollow",
    forts: [
      wall(210, 250, 290, 170),
      wall(710, 470, 790, 390),
      wall(420, 470, 540, 470),
      wall(460, 170, 580, 170),
      mound(820, 160, 26),
      mound(180, 480, 26),
    ],
    trees: [
      tree(360, 300, 26),
      tree(640, 340, 26),
      tree(300, 560, 20),
      tree(700, 80, 20),
      tree(110, 230, 20),
      tree(890, 410, 20),
      tree(500, 320, 18),
    ],
    piles: [
      [500, 400],
      [270, 380],
      [730, 260],
    ],
    spawns: RING,
  },
  {
    name: "Igloo Row",
    forts: [mound(300, 200), mound(700, 200), mound(300, 440), mound(700, 440), mound(500, 320, 36)],
    trees: [tree(500, 140, 20), tree(500, 500, 20), tree(170, 320, 22), tree(830, 320, 22)],
    piles: [
      [300, 320],
      [700, 320],
    ],
    spawns: RING,
  },
];

/** How many fields rounds rotate through. */
export const FIELD_COUNT = FIELDS.length;

// ---------- forts ----------

export interface FortShape {
  /** Core segment from (ax, ay) to (bx, by); the wall is `th` thick around it. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  th: number;
}

/** A fort's current shape: it shrinks with every hit and is gone at 0 hp. */
export function fortShape(f: FortDef, hp: number): FortShape | null {
  if (hp <= 0) return null;
  const k = Math.max(0, Math.min(1, hp / FORT_HP));
  const len = 0.45 + 0.55 * k;
  const thick = 0.55 + 0.45 * k;
  const cx = (f.x1 + f.x2) / 2;
  const cy = (f.y1 + f.y2) / 2;
  const hx = ((f.x2 - f.x1) / 2) * len;
  const hy = ((f.y2 - f.y1) / 2) * len;
  return { ax: cx - hx, ay: cy - hy, bx: cx + hx, by: cy + hy, th: f.th * thick };
}

/** Closest point on a fort's core segment to (x, y). */
export function closestOnFort(s: FortShape, x: number, y: number): [number, number] {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const l2 = dx * dx + dy * dy;
  const k = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l2)) : 0;
  return [s.ax + dx * k, s.ay + dy * k];
}

/** Distance from (x, y) to a fort's surface (negative inside). */
export function fortDistance(s: FortShape, x: number, y: number): number {
  const [cx, cy] = closestOnFort(s, x, y);
  return Math.hypot(x - cx, y - cy) - s.th;
}

// ---------- walking ----------

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Push a body out of trees, forts and the field's edge (sliding along them). */
export function collideBody(b: Body, field: Field, fortHp: ArrayLike<number>) {
  for (const t of field.trees) pushOut(b, t.x, t.y, t.r * TREE_CORE + PLAYER_R);
  field.forts.forEach((f, i) => {
    const s = fortShape(f, fortHp[i] ?? 0);
    if (!s) return;
    const [cx, cy] = closestOnFort(s, b.x, b.y);
    pushOut(b, cx, cy, s.th + PLAYER_R);
  });
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

function pushOut(b: Body, ox: number, oy: number, min: number) {
  const dx = b.x - ox;
  const dy = b.y - oy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  const d = Math.sqrt(d2);
  const nx = d > 1e-6 ? dx / d : 1;
  const ny = d > 1e-6 ? dy / d : 0;
  b.x = ox + nx * min;
  b.y = oy + ny * min;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= vn * nx;
    b.vy -= vn * ny;
  }
}

/**
 * One step of walking: velocity turns toward the stick's velocity with at most ACCEL·dt of
 * change (so a knockback fades out quickly), then the body moves and is kept out of obstacles.
 */
export function stepBody(b: Body, ix: number, iy: number, dt: number, field: Field, fortHp: ArrayLike<number>) {
  let ax = ix * SPEED - b.vx;
  let ay = iy * SPEED - b.vy;
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
  collideBody(b, field, fortHp);
}

/** Stick input as sent (ints in -100..100) -> direction with magnitude <= 1 (small = stand still). */
export function inputDir(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < 20) return [0, 0];
  const k = m > 100 ? 1 / m : 0.01;
  return [x * k, y * k];
}

// ---------- flight ----------

/** A snowball's flight: straight over the ground from (x0, y0) to (tx, ty), arcing up on the way. */
export interface Flight {
  x0: number;
  y0: number;
  tx: number;
  ty: number;
  t0: number;
  /** Flight time (ms) and the arc's extra height at the middle. */
  T: number;
  A: number;
}

export function makeFlight(x0: number, y0: number, tx: number, ty: number, t0: number): Flight {
  const d = Math.hypot(tx - x0, ty - y0);
  // Long throws fly a little faster but still take nearly a second: you can dodge a lob.
  const T = Math.max(140, (d / (300 + 0.45 * d)) * 1000);
  return { x0, y0, tx, ty, t0, T, A: 6 + 0.16 * d };
}

/** Where a snowball is at time `t` (ground x, y and height h); p is 0..1 through the flight. */
export function flightAt(f: Flight, t: number, out: { x: number; y: number; h: number; p: number }) {
  const p = Math.max(0, Math.min(1, (t - f.t0) / f.T));
  out.p = p;
  out.x = f.x0 + (f.tx - f.x0) * p;
  out.y = f.y0 + (f.ty - f.y0) * p;
  out.h = HAND_H * (1 - p) + f.A * 4 * p * (1 - p);
  return out;
}

/** Clamp an aim point to the throwing range from (x, y) and keep it on the field. */
export function aimPoint(x: number, y: number, tx: number, ty: number, fx: number, fy: number): [number, number] {
  let dx = tx - x;
  let dy = ty - y;
  let d = Math.hypot(dx, dy);
  if (d < 1) {
    const m = Math.hypot(fx, fy) || 1;
    [dx, dy, d] = [fx / m, fy / m, 1];
  }
  const r = Math.max(MIN_RANGE, Math.min(MAX_RANGE, d));
  const ax = Math.max(8, Math.min(WORLD_W - 8, x + (dx / d) * r));
  const ay = Math.max(8, Math.min(WORLD_H - 8, y + (dy / d) * r));
  return [Math.round(ax), Math.round(ay)];
}

/** The two side balls of a triple shot: the aim point turned by ±TRIPLE_SPREAD around (x, y). */
export function spreadPoint(x: number, y: number, tx: number, ty: number, side: number): [number, number] {
  const a = TRIPLE_SPREAD * side;
  const dx = tx - x;
  const dy = ty - y;
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  return [
    Math.round(Math.max(8, Math.min(WORLD_W - 8, x + rx))),
    Math.round(Math.max(8, Math.min(WORLD_H - 8, y + ry))),
  ];
}

// ---------- wire format ----------

export type Phase = "countdown" | "fight" | "roundOver" | "final";

/** A new snowball: [id, slot, x0, y0, tx, ty, t0 (ms relative to the frame's t), big 0/1, input number]. */
export type BallTuple = [number, number, number, number, number, number, number, number, number];
/** A snowball stopped: [id, time (ms relative to the frame's t), what, which]. */
export type EndTuple = [number, number, number, number];
export const END_GROUND = 0;
export const END_PLAYER = 1;
export const END_FORT = 2;
export const END_TREE = 3;

/**
 * Something else that happened, played back when the frame is on screen:
 *   [FX_OUT, slot, bySlot]        knocked out (bySlot -1 = nobody)
 *   [FX_PICK, slot, kind]         picked up a power-up (index into POWER_KINDS)
 *   [FX_PILE, slot, pile]         scooped a snow pile
 *   [FX_FORT, fort]               a fort crumbled
 */
export type FxTuple = number[];
export const FX_OUT = 0;
export const FX_PICK = 1;
export const FX_PILE = 2;
export const FX_FORT = 3;

/** One frame, sent to everyone 20 times a second (and carried in the view). */
export interface Snap {
  k: "s";
  /** Round number (frames from different rounds are never blended). */
  n: number;
  /** Server time this frame shows. */
  t: number;
  /** Every player's position, 4 characters each (see encodePositions), in slot order. */
  p: string;
  /** Per player, 3 digits: hp, ammo, power (0 none, 1-3 big balls left, 4-6 triple shots left). */
  s: string;
  /** Fort hp, one digit each. */
  w: string;
  /** Snow piles: "1" ready to scoop, "0" regrowing. */
  c: string;
  /** Power-up on the field: [kind index, x, y]. */
  u?: [number, number, number];
  b?: BallTuple[];
  e?: EndTuple[];
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

/** Player `slot`'s status from a frame: hp, ammo, power kind index (-1 none) and charges left. */
export function readStatus(s: string, slot: number): { hp: number; ammo: number; power: number; charges: number } {
  const hp = Number(s[slot * 3]) || 0;
  const ammo = Number(s[slot * 3 + 1]) || 0;
  const pw = Number(s[slot * 3 + 2]) || 0;
  return { hp, ammo, power: pw === 0 ? -1 : pw <= 3 ? 0 : 1, charges: pw === 0 ? 0 : pw <= 3 ? pw : pw - 3 };
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
    typeof s.w === "string"
  );
}

/** Private message to the thrower: their throw `s` was refused. */
export interface NoEvent {
  k: "no";
  s: number;
}
