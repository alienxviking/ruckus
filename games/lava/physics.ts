// Player motion shared by Floor is Lava's server and client: the server runs it for everyone,
// the client runs the very same code for your own avatar to predict it between snapshots.
// Nothing secret here (it ships to browsers). Bumps and the floor stay server-only.

import { SUB_MS } from "./shared";

export const DT = SUB_MS / 1000;
/** Acceleration at full stick (units/s²). Top speed on foot ends up around 190 units/s (~2.7 tiles/s). */
export const ACCEL = 600;
/** Floor friction per substep: momentum carries a little, so bumps matter. */
export const FRICTION = 0.95;
/** In the air you drift (slowing down) and can only nudge your direction: a jump clears one tile, not two. */
export const AIR_FRICTION = 0.97;
export const AIR_CONTROL = 0.3;
/** Absolute cap so nothing can ever explode. */
export const HARD_SPEED = 900;
/** Take-off push along the stick (or your motion, or where you face). */
export const JUMP_BOOST = 80;
/** Once a round is decided the survivors skid to a stop. */
export const BRAKE_FRICTION = 0.85;

/** Position and velocity (units, units/s). */
export interface Kin {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Jump push: along the stick, else along the current motion, else where the player faces.
 * Applies it to `d` and returns the unit direction.
 */
export function applyJump(d: Kin, ix: number, iy: number, fx: number, fy: number): [number, number] {
  let ux = ix;
  let uy = iy;
  let m = Math.hypot(ux, uy);
  if (m < 0.15) {
    const sp = Math.hypot(d.vx, d.vy);
    if (sp > 30) [ux, uy, m] = [d.vx, d.vy, sp];
    else [ux, uy, m] = [fx, fy, Math.hypot(fx, fy) || 1];
  }
  ux /= m;
  uy /= m;
  d.vx += ux * JUMP_BOOST;
  d.vy += uy * JUMP_BOOST;
  return [ux, uy];
}

/** One substep of steering, friction and motion. */
export function integrate(d: Kin, ix: number, iy: number, air: boolean, friction: number, steer: boolean) {
  const moving = steer && (ix !== 0 || iy !== 0);
  if (moving) {
    const a = ACCEL * (air ? AIR_CONTROL : 1) * DT;
    d.vx += ix * a;
    d.vy += iy * a;
  }
  const f = air && friction === FRICTION ? AIR_FRICTION : friction;
  d.vx *= f;
  d.vy *= f;
  const sp = Math.hypot(d.vx, d.vy);
  if (sp > HARD_SPEED) {
    d.vx *= HARD_SPEED / sp;
    d.vy *= HARD_SPEED / sp;
  } else if (!moving && sp < 3) {
    d.vx = 0;
    d.vy = 0;
  }
  d.x += d.vx * DT;
  d.y += d.vy * DT;
}

// ---------- bumps (shared, so the client can predict them the way the server resolves them) ----------

export const E_SOFT = 0.45;
export const E_BOUNCY = 1.25;
export const E_SOFT_BELOW = 40;
export const E_BOUNCY_ABOVE = 220;

export function restitution(approach: number) {
  if (approach <= E_SOFT_BELOW) return E_SOFT;
  if (approach >= E_BOUNCY_ABOVE) return E_BOUNCY;
  return E_SOFT + ((approach - E_SOFT_BELOW) / (E_BOUNCY_ABOVE - E_SOFT_BELOW)) * (E_BOUNCY - E_SOFT);
}

/**
 * Resolve one bump between two players of radius `r` (equal mass): push apart, exchange an
 * impulse along the normal. `fx`/`fy` split two on top of each other. Returns the impulse and
 * the normal (j 0 = touching but separating), or null when they don't touch.
 */
export function resolveBump(a: Kin, b: Kin, r: number, fx: number, fy: number): { j: number; nx: number; ny: number } | null {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minD = r * 2;
  if (dist >= minD) return null;
  if (dist < 1e-6) {
    dx = fx || 1;
    dy = fy;
  }
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const overlap = minD - dist;
  a.x -= (nx * overlap) / 2;
  a.y -= (ny * overlap) / 2;
  b.x += (nx * overlap) / 2;
  b.y += (ny * overlap) / 2;
  const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vrel >= 0) return { j: 0, nx, ny };
  const approach = -vrel;
  const j = ((1 + restitution(approach)) * approach) / 2;
  a.vx -= j * nx;
  a.vy -= j * ny;
  b.vx += j * nx;
  b.vy += j * ny;
  return { j, nx, ny };
}

// ---------- input stamping (see sumo/physics.ts: the same scheme) ----------

/** The substep an input stamped for sim time `at` takes effect in (k covers (k-1)..k substeps). */
export function stampStep(at: number, fightAt: number): number {
  return Math.max(1, Math.ceil((at - fightAt) / SUB_MS - 0.5));
}

/** A late input counts back at most this many substeps (~150 ms). */
export const MAX_REWIND_STEPS = 9;

/** How far a player ends up from where they are, had their stick been (dix, diy) different for the last `steps` substeps. */
export function rewindDelta(steps: number, dix: number, diy: number, air: boolean): Kin {
  const k: Kin = { x: 0, y: 0, vx: 0, vy: 0 };
  const a = ACCEL * (air ? AIR_CONTROL : 1) * DT;
  const f = air ? AIR_FRICTION : FRICTION;
  for (let i = 0; i < steps; i++) {
    k.vx += dix * a;
    k.vy += diy * a;
    k.vx *= f;
    k.vy *= f;
    k.x += k.vx * DT;
    k.y += k.vy * DT;
  }
  return k;
}
