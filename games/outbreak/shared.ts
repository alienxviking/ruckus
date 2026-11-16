// Constants, maps, the movement model and the snapshot codec shared by Outbreak's
// server and client. Nothing secret lives here: this file ships to browsers.
//
// The client runs exactly the same movement and wall code (stepPlayer) to predict
// your own runner, so steering reacts on the very next frame.

// ---------- world ----------

export const WORLD_W = 1000;
export const WORLD_H = 700;
/** Wall thickness. */
export const T = 16;
/** Body radii: zombies are bigger, so they can't squeeze through doors. */
export const R_S = 14;
export const R_Z = 19;
/** Centres closer than this = a touch (infection or cure). */
export const TOUCH = R_S + R_Z + 3;
export const EDGE = 2;

/** Survivors are nimble; zombies are ~8% faster but turn (accelerate) far slower. */
export const SPEED_S = 165;
export const SPEED_Z = 178;
export const ACCEL_S = 1_600;
export const ACCEL_Z = 560;
/** Zombie LUNGE: a short burst in the facing direction, then a cooldown. */
export const LUNGE_SPEED = 360;
export const LUNGE_ACCEL = 4_000;
export const LUNGE_MS = 300;
export const LUNGE_CD_MS = 4_000;

// ---------- timing & rules ----------

export const TICK_MS = 50;
/** Physics substep (two per tick). The client predicts with the same step. */
export const SUB_MS = 25;
export const ROUNDS = 3;
/** Survivors get a head start: zombies wake when the intro ends. */
export const INTRO_MS = 3_500;
export const PLAY_MS = 75_000;
export const ROUND_OVER_MS = 6_500;
/** A fresh zombie staggers for this long before it can move or bite. */
export const TURN_MS = 900;
/** A cured player can't be re-infected for this long. */
export const SHIELD_MS = 2_000;
export const FLASH_R = 180;
export const FLASH_STUN_MS = 2_200;
export const ITEM_FIRST_MS = 6_000;
export const ITEM_EVERY_MS = 8_000;
export const MAX_CURES = 2;
export const MAX_FLASHES = 2;
/** Picking up an item: centre within this of the item. */
export const ITEM_REACH = 22;
/** With fewer than two players connected for this long, the game ends. */
export const ABANDON_MS = 10_000;

export const PTS_SURVIVE = 5;
export const PTS_BITE = 2;
export const PTS_CURE = 2;
export const PTS_WIPEOUT = 3;

/** Two patient zeros from this many players. */
export const TWO_ZOMBIES_AT = 8;
export const zombieCount = (n: number) => (n >= TWO_ZOMBIES_AT ? 2 : 1);

// ---------- maps ----------

/** [x, y, w, h] */
export type Rect = [number, number, number, number];

export interface MapDef {
  name: string;
  /** Block everybody. */
  walls: Rect[];
  /** Narrow doorways: survivors slip through, zombies are too big. */
  doors: Rect[];
  /** Floor colours [a, b] for the checker. */
  floor: [string, string];
}

type Gap = [number, number, boolean?];

/** A horizontal wall from x1 to x2 at y (top edge), with gaps [start, length, door?] in absolute x. */
function hwall(m: { walls: Rect[]; doors: Rect[] }, x1: number, x2: number, y: number, gaps: Gap[] = []) {
  let x = x1;
  for (const [a, n, door] of gaps.slice().sort((p, q) => p[0] - q[0])) {
    if (a > x) m.walls.push([x, y, a - x, T]);
    if (door) m.doors.push([a, y, n, T]);
    x = a + n;
  }
  if (x2 > x) m.walls.push([x, y, x2 - x, T]);
}

/** A vertical wall from y1 to y2 at x (left edge), with gaps [start, length, door?] in absolute y. */
function vwall(m: { walls: Rect[]; doors: Rect[] }, x: number, y1: number, y2: number, gaps: Gap[] = []) {
  let y = y1;
  for (const [a, n, door] of gaps.slice().sort((p, q) => p[0] - q[0])) {
    if (a > y) m.walls.push([x, y, T, a - y]);
    if (door) m.doors.push([x, a, T, n]);
    y = a + n;
  }
  if (y2 > y) m.walls.push([x, y, T, y2 - y]);
}

function build(name: string, floor: [string, string], f: (m: { walls: Rect[]; doors: Rect[] }) => void): MapDef {
  const m = { walls: [] as Rect[], doors: [] as Rect[] };
  f(m);
  return { name, walls: m.walls, doors: m.doors, floor };
}

const D = 52; // door width
const O = 96; // wide opening

export const MAPS: MapDef[] = [
  build("Ward 13", ["#1d2b27", "#20302b"], (m) => {
    // Four corner wards: a wide entrance from the hall and a narrow door.
    hwall(m, 0, 320, 230, [[130, D, true]]);
    vwall(m, 304, 0, 246, [[70, O]]);
    hwall(m, 680, 1000, 230, [[826, D, true]]);
    vwall(m, 680, 0, 246, [[70, O]]);
    hwall(m, 0, 320, 454, [[130, D, true]]);
    vwall(m, 304, 454, 700, [[546, O]]);
    hwall(m, 680, 1000, 454, [[826, D, true]]);
    vwall(m, 680, 454, 700, [[546, O]]);
    // Nurses' station in the middle: a door on top, open below.
    hwall(m, 430, 570, 300, [[478, D, true]]);
    vwall(m, 430, 300, 400);
    vwall(m, 554, 300, 400);
    // Dividers splitting the top and bottom halls.
    vwall(m, 492, 0, 120);
    vwall(m, 492, 580, 700);
    // Gurneys in the side halls.
    m.walls.push([150, 330, 60, 40], [790, 330, 60, 40]);
  }),
  build("Dead Mall", ["#2a2433", "#2e2838"], (m) => {
    // Three shops along the top and three along the bottom of a long hall.
    hwall(m, 0, 1000, 260, [
      [120, O],
      [400, D, true],
      [540, O],
      [760, O],
      [900, D, true],
    ]);
    vwall(m, 333, 0, 260, [[100, D, true]]);
    vwall(m, 666, 0, 260, [[150, D, true]]);
    hwall(m, 0, 1000, 424, [
      [60, D, true],
      [200, O],
      [420, O],
      [580, D, true],
      [720, O],
      [880, D, true],
    ]);
    vwall(m, 333, 440, 700, [[540, D, true]]);
    vwall(m, 666, 440, 700, [[600, D, true]]);
    // Planters down the hall and displays in the shops.
    m.walls.push([215, 330, 60, 40], [470, 326, 60, 48], [725, 330, 60, 40]);
    m.walls.push([130, 100, 90, 34], [450, 90, 110, 30], [810, 110, 80, 40]);
    m.walls.push([120, 560, 100, 36], [440, 540, 120, 34], [790, 570, 90, 36]);
  }),
  build("Lab Complex", ["#1b2433", "#1e2839"], (m) => {
    // Two long lab walls with wide breaches and a door each, split by a corridor wall.
    vwall(m, 250, 0, 700, [
      [60, O],
      [300, D, true],
      [540, O],
    ]);
    vwall(m, 734, 0, 700, [
      [80, O],
      [356, D, true],
      [520, O],
    ]);
    hwall(m, 266, 734, 342, [
      [320, O],
      [470, D, true],
      [600, O],
    ]);
    // Lab benches.
    m.walls.push([400, 140, 180, 34], [400, 530, 180, 34]);
    m.walls.push([90, 250, 60, 50], [90, 430, 60, 50], [850, 230, 60, 50], [850, 420, 60, 50]);
  }),
];

export const mapOf = (i: number): MapDef => MAPS[i] ?? MAPS[0];

// ---------- movement ----------

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function pushOut(b: Body, rc: Rect, r: number) {
  const [x, y, w, h] = rc;
  const cx = b.x < x ? x : b.x > x + w ? x + w : b.x;
  const cy = b.y < y ? y : b.y > y + h ? y + h : b.y;
  const dx = b.x - cx;
  const dy = b.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return;
  let nx: number;
  let ny: number;
  let pen: number;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    nx = dx / d;
    ny = dy / d;
    pen = r - d;
  } else {
    // Centre inside the rect: leave by the nearest side.
    const l = b.x - x;
    const rr = x + w - b.x;
    const t = b.y - y;
    const bt = y + h - b.y;
    const m = Math.min(l, rr, t, bt);
    if (m === l) [nx, ny, pen] = [-1, 0, l + r];
    else if (m === rr) [nx, ny, pen] = [1, 0, rr + r];
    else if (m === t) [nx, ny, pen] = [0, -1, t + r];
    else [nx, ny, pen] = [0, 1, bt + r];
  }
  b.x += nx * pen;
  b.y += ny * pen;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= vn * nx;
    b.vy -= vn * ny;
  }
}

/** Keep a body out of walls (and doors, for zombies) and inside the world, sliding along them. */
export function collide(b: Body, map: MapDef, zombie: boolean) {
  const r = zombie ? R_Z : R_S;
  for (let pass = 0; pass < 2; pass++) {
    for (const w of map.walls) pushOut(b, w, r);
    if (zombie) for (const d of map.doors) pushOut(b, d, r);
  }
  const lo = r + EDGE;
  if (b.x < lo) {
    b.x = lo;
    if (b.vx < 0) b.vx = 0;
  } else if (b.x > WORLD_W - lo) {
    b.x = WORLD_W - lo;
    if (b.vx > 0) b.vx = 0;
  }
  if (b.y < lo) {
    b.y = lo;
    if (b.vy < 0) b.vy = 0;
  } else if (b.y > WORLD_H - lo) {
    b.y = WORLD_H - lo;
    if (b.vy > 0) b.vy = 0;
  }
}

/**
 * One physics substep. (ix, iy) is the steering direction (unit vector or 0). A
 * lunge overrides it with a burst along (lx, ly). Stunned bodies stand still.
 */
export function stepPlayer(
  b: Body,
  ix: number,
  iy: number,
  zombie: boolean,
  lunge: [number, number] | null,
  stunned: boolean,
  dt: number,
  map: MapDef,
) {
  if (stunned) {
    b.vx = 0;
    b.vy = 0;
    collide(b, map, zombie);
    return;
  }
  let wx: number;
  let wy: number;
  let accel: number;
  if (lunge) {
    wx = lunge[0] * LUNGE_SPEED;
    wy = lunge[1] * LUNGE_SPEED;
    accel = LUNGE_ACCEL;
  } else {
    const sp = zombie ? SPEED_Z : SPEED_S;
    wx = ix * sp;
    wy = iy * sp;
    accel = zombie ? ACCEL_Z : ACCEL_S;
  }
  let ax = wx - b.vx;
  let ay = wy - b.vy;
  const m = Math.hypot(ax, ay);
  const max = accel * dt;
  if (m > max) {
    ax *= max / m;
    ay *= max / m;
  }
  b.vx += ax;
  b.vy += ay;
  if (wx === 0 && wy === 0 && Math.abs(b.vx) < 0.5 && Math.abs(b.vy) < 0.5) {
    b.vx = 0;
    b.vy = 0;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  collide(b, map, zombie);
}

/** Steering input as sent over the wire (ints -100..100) to a unit direction; small = stand still. */
export function inputDir(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < 25) return [0, 0];
  return [x / m, y / m];
}

/** Does a body of radius r fit at (x, y), with `pad` to spare? */
export function freeSpot(map: MapDef, x: number, y: number, r: number): boolean {
  if (x < r || y < r || x > WORLD_W - r || y > WORLD_H - r) return false;
  for (const rc of [...map.walls, ...map.doors]) {
    const cx = Math.max(rc[0], Math.min(rc[0] + rc[2], x));
    const cy = Math.max(rc[1], Math.min(rc[1] + rc[3], y));
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return false;
  }
  return true;
}

// ---------- wire format ----------

export type Phase = "intro" | "play" | "roundOver" | "final";

/** Per-player flags in a snapshot (one base64 character each). */
export const F_ZOMBIE = 1;
export const F_STUN = 2;
export const F_CURE = 4;
export const F_FLASH = 8;
export const F_SHIELD = 16;
export const F_OFF = 32;

/**
 * Effects, played back when the snapshot is on screen:
 *   [0, victim, biter, x, y]   infection
 *   [1, cured, medic, x, y]    cure
 *   [2, slot, x, y]            flash
 *   [3, slot, kind]            item picked up (0 cure, 1 flash)
 *   [4, slot, dx, dy]          lunge (direction x100)
 */
export const FX_BITE = 0;
export const FX_CURE = 1;
export const FX_FLASH = 2;
export const FX_PICK = 3;
export const FX_LUNGE = 4;

export const ITEM_CURE = 0;
export const ITEM_FLASH = 1;

/** One frame, sent to everyone 20 times a second (and carried in the view). */
export interface Snap {
  k: "s";
  /** Round (frames from different rounds are never blended). */
  n: number;
  /** Server sim time this frame shows. */
  t: number;
  /** Every seat's position, 4 characters each. */
  p: string;
  /** Every seat's flags, 1 character each. */
  f: string;
  fx?: number[][];
  /** Nothing moved since the previous frame we sent until one tick before this one. */
  q?: 1;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

/** Integer x, y (10 bits each) packed into four URL-safe base64 characters. */
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

export const encodeFlags = (f: number[]) => f.map((v) => B64[v & 63]).join("");
export const decodeFlags = (s: string) => [...s].map((c) => B64_INDEX[c] ?? 0);

export function isSnap(v: unknown): v is Snap {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<Snap>;
  return s.k === "s" && typeof s.t === "number" && typeof s.n === "number" && typeof s.p === "string" && typeof s.f === "string";
}
