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
