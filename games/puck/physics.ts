// Puck motion shared by the server (the real thing) and the client (which runs the very same code
// a little ahead of the newest snapshot, so your own hits show the moment they happen).
// Paddles are moved first each substep; the puck is then swept against each paddle's motion over
// that substep (continuous collision: a fast flick can't skip through the puck), then walls, posts
// and goal mouths. Nothing secret here.

import {
  DT,
  GOAL_X0,
  GOAL_X1,
  H,
  PADDLE_E,
  PADDLE_MAX,
  PUCK_R,
  W,
  WALL_E,
  clampTo,
  type Rect,
} from "./shared";

export interface Kin {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A paddle's motion over one substep: from (x0, y0) to (x1, y1). */
export interface Sweep {
  slot: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
}

/** Contact kinds reported to `hit`. */
export const C_PADDLE = 0;
export const C_WALL = 1;
export type HitFn = (kind: number, slot: number, x: number, y: number, power: number) => void;

/** Move a paddle toward its target (clamped to its zone) at most PADDLE_MAX. Returns the sweep end. */
export function stepPaddle(x: number, y: number, tx: number, ty: number, rect: Rect, dt = DT): [number, number] {
  const [cx, cy] = clampTo(rect, tx, ty);
  const dx = cx - x;
  const dy = cy - y;
  const d = Math.hypot(dx, dy);
  const max = PADDLE_MAX * dt;
  if (d <= max) return [cx, cy];
  return [x + (dx / d) * max, y + (dy / d) * max];
}

function cap(p: Kin, max: number) {
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > max) {
    p.vx *= max / sp;
    p.vy *= max / sp;
  }
}

/** Earliest s in [0, lim] with |a + b·s| = r (a outside the circle), or -1. */
function sweepHit(ax: number, ay: number, bx: number, by: number, r: number, lim: number): number {
  const A = bx * bx + by * by;
  if (A < 1e-9) return -1;
  const B = 2 * (ax * bx + ay * by);
  if (B >= 0) return -1; // moving apart
  const C = ax * ax + ay * ay - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return -1;
  const s = (-B - Math.sqrt(disc)) / (2 * A);
  return s >= 0 && s <= lim ? s : -1;
}

/** Bounce the puck off a paddle at (px, py) moving (pvx, pvy). Returns the approach speed. */
function bounce(p: Kin, px: number, py: number, pvx: number, pvy: number, r: number, max: number): number {
  let nx = p.x - px;
  let ny = p.y - py;
  const d = Math.hypot(nx, ny);
  if (d < 1e-6) {
    nx = 0;
    ny = py > H / 2 ? -1 : 1;
  } else {
    nx /= d;
    ny /= d;
  }
  if (d < r) {
    p.x = px + nx * (r + 0.01);
    p.y = py + ny * (r + 0.01);
  }
  const vn = (p.vx - pvx) * nx + (p.vy - pvy) * ny;
  if (vn >= 0) return 0;
  p.vx -= (1 + PADDLE_E) * vn * nx;
  p.vy -= (1 + PADDLE_E) * vn * ny;
  cap(p, max);
  return -vn;
}

/**
 * One substep of the puck against `paddles` (already swept this substep), the walls and posts.
 * Returns the team that just scored (0 = into the top goal, 1 = into the bottom one) or -1.
 */
export function stepPuck(p: Kin, paddles: readonly Sweep[], max: number, friction: number, hit?: HitFn, dt = DT): number {
  p.vx *= friction;
  p.vy *= friction;
  let tau = 0;
  let done = 0; // bit mask of paddles already resolved this substep
  for (let iter = 0; iter < 3; iter++) {
    let best = -1;
    let bs = Infinity;
    for (let i = 0; i < paddles.length; i++) {
      if (done & (1 << i)) continue;
      const q = paddles[i];
      const R = q.r + PUCK_R;
      const px = q.x0 + (q.x1 - q.x0) * tau;
      const py = q.y0 + (q.y1 - q.y0) * tau;
      const ax = p.x - px;
      const ay = p.y - py;
      const bx = p.vx * dt - (q.x1 - q.x0);
      const by = p.vy * dt - (q.y1 - q.y0);
      let s: number;
      if (ax * ax + ay * ay < R * R) s = 0;
      else s = sweepHit(ax, ay, bx, by, R, 1 - tau);
      if (s >= 0 && s < bs) {
        bs = s;
        best = i;
      }
    }
    if (best < 0) break;
    p.x += p.vx * dt * bs;
    p.y += p.vy * dt * bs;
    tau += bs;
    const q = paddles[best];
    done |= 1 << best;
    const px = q.x0 + (q.x1 - q.x0) * tau;
    const py = q.y0 + (q.y1 - q.y0) * tau;
    const power = bounce(p, px, py, (q.x1 - q.x0) / dt, (q.y1 - q.y0) / dt, q.r + PUCK_R, max);
    if (power > 0 && hit) hit(C_PADDLE, q.slot, p.x, p.y, power);
  }
  p.x += p.vx * dt * (1 - tau);
  p.y += p.vy * dt * (1 - tau);
  // Still inside a paddle at the end (it kept pushing): out you go.
  for (const q of paddles) {
    const R = q.r + PUCK_R;
    if ((p.x - q.x1) ** 2 + (p.y - q.y1) ** 2 < R * R) bounce(p, q.x1, q.y1, (q.x1 - q.x0) / dt, (q.y1 - q.y0) / dt, R, max);
  }
  return walls(p, hit);
}

function wallHit(hit: HitFn | undefined, x: number, y: number, v: number) {
  if (hit && v > 60) hit(C_WALL, -1, x, y, v);
}

/** Side walls, end walls (outside the goal mouths) and the four posts. */
function walls(p: Kin, hit?: HitFn): number {
  const R = PUCK_R;
  if (p.x < R) {
    p.x = R;
    if (p.vx < 0) {
      wallHit(hit, 0, p.y, -p.vx);
      p.vx = -p.vx * WALL_E;
    }
  } else if (p.x > W - R) {
    p.x = W - R;
    if (p.vx > 0) {
      wallHit(hit, W, p.y, p.vx);
      p.vx = -p.vx * WALL_E;
    }
  }
  const inMouth = p.x > GOAL_X0 && p.x < GOAL_X1;
  if (!inMouth) {
    if (p.y < R) {
      p.y = R;
      if (p.vy < 0) {
        wallHit(hit, p.x, 0, -p.vy);
        p.vy = -p.vy * WALL_E;
      }
    } else if (p.y > H - R) {
      p.y = H - R;
      if (p.vy > 0) {
        wallHit(hit, p.x, H, p.vy);
        p.vy = -p.vy * WALL_E;
      }
    }
  }
  // Posts: points at the ends of each goal mouth.
  for (const py of [0, H]) {
    for (const px of [GOAL_X0, GOAL_X1]) {
      const dx = p.x - px;
      const dy = p.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R) continue;
      const d = Math.sqrt(d2) || 1;
      const nx = dx / d;
      const ny = dy / d;
      p.x = px + nx * R;
      p.y = py + ny * R;
      const vn = p.vx * nx + p.vy * ny;
      if (vn < 0) {
        wallHit(hit, px, py, -vn);
        p.vx -= (1 + WALL_E) * vn * nx;
        p.vy -= (1 + WALL_E) * vn * ny;
      }
    }
  }
  // Inside a net: keep between its side walls.
  if (p.y < 0 || p.y > H) {
    if (p.x < GOAL_X0 + R) p.x = GOAL_X0 + R;
    if (p.x > GOAL_X1 - R) p.x = GOAL_X1 - R;
  }
  if (p.y < -R) return 0;
  if (p.y > H + R) return 1;
  return -1;
}
