// Constants, park layouts, the walking model and the snapshot codec shared by
// Incognito's server and client. Nothing secret lives here: this file ships to browsers.
//
// The walking model is the heart of the disguise: every walker (bot or human) moves
// with exactly the same speed, acceleration and obstacle handling, so the motion data
// can't tell them apart. The client runs the same model to predict your own walker.

// ---------- world ----------

export const WORLD_W = 1000;
export const WORLD_H = 700;
/** Collision radius of a walker's feet. */
export const WALKER_R = 9;
/** Walkers stay this far inside the park's edge. */
export const EDGE = 14;
/** Walking speed (units/s): bots always walk at exactly this speed, and so do you. */
export const WALK = 70;
export const SPRINT_MUL = 1.7;
/** Max change of velocity (units/s²): ~0.15s from standstill to full walking speed. */
export const ACCEL = 480;
/** Standing within this distance of a landmark's centre counts as being on it. */
export const LM_R = 30;
/** Stand on a landmark this long to light it. */
export const LIGHT_MS = 1_500;
export const NPC_COUNT = 36;

// ---------- timing & rules ----------

export const TICK_MS = 50;
export const ROUNDS = 3;
export const DARTS = 3;
export const INTRO_MS = 4_000;
export const PLAY_MS = 100_000;
export const ROUND_OVER_MS = 7_500;
/** A missed snipe lights up the sniper in their colour this long. */
export const EXPOSE_MS = 1_500;
/** How long a dart is drawn flying before it lands. */
export const DART_MS = 260;
/** Minimum gap between two darts from the same player. */
export const SNIPE_CD_MS = 700;
/** With fewer than two players connected for this long, the game ends. */
export const ABANDON_MS = 10_000;

export const PTS_ALL_LIT = 3;
export const PTS_SNIPE = 2;
export const PTS_SURVIVOR = 2;
export const PTS_MOST_LIT = 3;

// ---------- parks ----------

export interface Obstacle {
  x: number;
  y: number;
  r: number;
  kind: "tree" | "fountain";
}

export interface Landmark {
  x: number;
  y: number;
}

export interface Park {
  name: string;
  obstacles: Obstacle[];
  landmarks: Landmark[];
}

/** The five landmarks keep their identity in every park; only their spots change. */
export const LANDMARKS = [
  { icon: "🗿", name: "Statue" },
  { icon: "🔔", name: "Bell" },
  { icon: "🕰️", name: "Clock" },
  { icon: "🌷", name: "Tulips" },
  { icon: "🎠", name: "Carousel" },
] as const;
export const ALL_LIT = (1 << LANDMARKS.length) - 1;

const tree = (x: number, y: number, r: number): Obstacle => ({ x, y, r, kind: "tree" });
const fountain = (x: number, y: number, r: number): Obstacle => ({ x, y, r, kind: "fountain" });

export const PARKS: Park[] = [
  {
    name: "Fountain Square",
    obstacles: [
      fountain(500, 350, 62),
      tree(285, 190, 36),
      tree(715, 190, 36),
      tree(250, 500, 32),
      tree(750, 505, 32),
      tree(500, 592, 26),
      tree(150, 120, 28),
      tree(850, 600, 28),
      tree(872, 112, 24),
    ],
    landmarks: [
      { x: 500, y: 105 },
      { x: 120, y: 300 },
      { x: 880, y: 300 },
      { x: 300, y: 620 },
      { x: 700, y: 620 },
    ],
  },
  {
    name: "The Grove",
    obstacles: [
      tree(330, 220, 34),
      tree(670, 220, 34),
      tree(330, 480, 34),
      tree(670, 480, 34),
      fountain(500, 112, 44),
      fountain(500, 598, 44),
      tree(200, 350, 26),
      tree(800, 350, 26),
    ],
    landmarks: [
      { x: 130, y: 120 },
      { x: 870, y: 120 },
      { x: 500, y: 350 },
      { x: 130, y: 580 },
      { x: 870, y: 580 },
    ],
  },
  {
    name: "Twin Ponds",
    obstacles: [
      fountain(300, 360, 56),
      fountain(700, 340, 56),
      tree(500, 170, 32),
      tree(500, 540, 32),
      tree(130, 150, 28),
      tree(870, 560, 28),
      tree(880, 130, 22),
      tree(120, 580, 22),
    ],
    landmarks: [
      { x: 300, y: 120 },
      { x: 110, y: 360 },
      { x: 500, y: 355 },
      { x: 890, y: 340 },
      { x: 720, y: 600 },
    ],
  },
];

/** Which landmark (index) a point stands on, or -1. */
export function landmarkAt(park: Park, x: number, y: number): number {
  const lms = park.landmarks;
  for (let i = 0; i < lms.length; i++) {
    const dx = x - lms[i].x;
    const dy = y - lms[i].y;
    if (dx * dx + dy * dy <= LM_R * LM_R) return i;
  }
  return -1;
}

export const countBits = (m: number) => {
  let n = 0;
  for (let v = m; v; v &= v - 1) n++;
  return n;
};

// ---------- the walking model (identical for every walker) ----------

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Push a walker out of trees, fountains and the park's edge (sliding along them). */
export function collideBody(b: Body, park: Park) {
  for (const o of park.obstacles) {
    const dx = b.x - o.x;
    const dy = b.y - o.y;
    const min = o.r + WALKER_R;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    const nx = d > 1e-6 ? dx / d : 1;
    const ny = d > 1e-6 ? dy / d : 0;
    b.x = o.x + nx * min;
    b.y = o.y + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= vn * nx;
      b.vy -= vn * ny;
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

/**
 * One step of the walking model: velocity turns toward the wanted velocity with at
 * most ACCEL·dt of change, then the walker moves and is kept out of obstacles.
 */
export function stepBody(b: Body, wantX: number, wantY: number, dt: number, park: Park) {
  let ax = wantX - b.vx;
  let ay = wantY - b.vy;
  const m = Math.hypot(ax, ay);
  const max = ACCEL * dt;
  if (m > max) {
    ax *= max / m;
    ay *= max / m;
  }
  b.vx += ax;
  b.vy += ay;
  if (wantX === 0 && wantY === 0 && Math.abs(b.vx) < 0.05 && Math.abs(b.vy) < 0.05) {
    b.vx = 0;
    b.vy = 0;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  collideBody(b, park);
}

/**
 * Turn a steering input (integers in -100..100, as sent over the wire) into a unit
 * direction. Small inputs mean "stand still": walkers only ever walk at full speed.
 */
export function inputDir(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < 25) return [0, 0];
  return [x / m, y / m];
}

// ---------- wire format ----------

export type Phase = "intro" | "play" | "roundOver" | "final";

export const FX_PULSE = 0;

/** One frame of the crowd, sent to everyone every tick (and carried in the view). */
export interface Snap {
  k: "s";
  /** Round number (frames from different rounds are never blended). */
  n: number;
  /** Server time this frame shows. */
  t: number;
  /** Every walker's position, 4 characters each (see encodePositions). */
  p: string;
  /** Effects that happened since the previous frame: [FX_PULSE, landmark]. */
  f?: number[][];
  /** Nothing moved since the previous frame we sent until one tick before this one. */
  q?: 1;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

/**
 * Positions as a compact string: integer x and y (10 bits each) packed into four
 * URL-safe base64 characters per walker. Every walker uses the same quantisation.
 */
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
  return s.k === "s" && typeof s.t === "number" && typeof s.n === "number" && typeof s.p === "string";
}

/** Private message to one player: they lit a landmark (m = their lit landmarks bit mask). */
export interface LitEvent {
  k: "lit";
  n: number;
  l: number;
  m: number;
}

/** Private message to one player: their snipe was refused. */
export interface NoEvent {
  k: "no";
  w: number;
  why: string;
}
