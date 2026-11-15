// Disc motion shared by Ice Sumo's server and client: the server runs it for every disc, the
// client runs the very same code for your own disc to predict it between snapshots.
// Nothing secret here (it ships to browsers). Collisions stay server-only.

import { CENTER, SUBSTEPS, TICK_MS } from "./shared";

/** One physics substep (ms) and its length in seconds. */
export const SUB_MS = TICK_MS / SUBSTEPS;
export const DT = SUB_MS / 1000;
/** Acceleration at full stick (units/s²). */
export const ACCEL = 1000;
/** A heavy disc is a little slower off the mark. */
export const HEAVY_ACCEL = 0.8;
/** Ice friction per substep. */
export const FRICTION = 0.992;
export const MAX_SPEED = 480;
/** Above MAX_SPEED (after a dash or a big hit) speed bleeds off at most this fast per substep. */
export const OVERSPEED_KEEP = 0.95;
/** Absolute cap so nothing can ever explode. */
export const HARD_SPEED = 1_600;
export const DASH_IMPULSE = 650;
/** Once a round is decided the survivors brake to a stop (and can't slide off any more). */
export const BRAKE_FRICTION = 0.93;

/** Position and velocity of a disc (units, units/s). */
export interface Kin {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Dash impulse: along the stick, else along the current motion, else where the disc faces.
 * Applies it to `d` and returns the unit direction.
 */
export function applyDash(d: Kin, ix: number, iy: number, fx: number, fy: number): [number, number] {
  let ux = ix;
  let uy = iy;
  let m = Math.hypot(ux, uy);
  if (m < 0.15) {
    const sp = Math.hypot(d.vx, d.vy);
    if (sp > 40) [ux, uy, m] = [d.vx, d.vy, sp];
    else [ux, uy, m] = [fx, fy, 1];
  }
  ux /= m;
  uy /= m;
  d.vx += ux * DASH_IMPULSE;
  d.vy += uy * DASH_IMPULSE;
  return [ux, uy];
}

/** One substep of steering, friction, speed limits and motion. */
export function integrate(d: Kin, ix: number, iy: number, heavy: boolean, friction: number, steer: boolean) {
  const moving = steer && (ix !== 0 || iy !== 0);
  if (moving) {
    const a = ACCEL * (heavy ? HEAVY_ACCEL : 1) * DT;
    d.vx += ix * a;
    d.vy += iy * a;
  }
  d.vx *= friction;
  d.vy *= friction;
  const sp = Math.hypot(d.vx, d.vy);
  if (sp > MAX_SPEED) {
    const k = Math.min(HARD_SPEED, Math.max(MAX_SPEED, sp * OVERSPEED_KEEP)) / sp;
    d.vx *= k;
    d.vy *= k;
  } else if (!moving && sp < 3) {
    d.vx = 0;
    d.vy = 0;
  }
  d.x += d.vx * DT;
  d.y += d.vy * DT;
}

/** After a round is decided: keep a surviving disc on the ice (it teeters at the edge). */
export function keepOnIce(d: Kin, r: number) {
  const dx = d.x - CENTER;
  const dy = d.y - CENTER;
  const dist = Math.hypot(dx, dy);
  const lim = Math.max(0, r - 4);
  if (dist <= lim || dist === 0) return;
  const nx = dx / dist;
  const ny = dy / dist;
  d.x = CENTER + nx * lim;
  d.y = CENTER + ny * lim;
  const out = d.vx * nx + d.vy * ny;
  if (out > 0) {
    d.vx -= out * nx;
    d.vy -= out * ny;
  }
}
