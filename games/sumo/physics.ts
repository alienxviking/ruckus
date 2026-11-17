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

// ---------- collisions (shared, so the client can predict contacts the way the server resolves them) ----------

/** Restitution blends from soft (slow shoves) to bouncy (real hits). */
export const E_SOFT = 0.35;
export const E_BOUNCY = 1.15;
export const E_SOFT_BELOW = 40;
export const E_BOUNCY_ABOVE = 200;

export function restitution(approach: number) {
  if (approach <= E_SOFT_BELOW) return E_SOFT;
  if (approach >= E_BOUNCY_ABOVE) return E_BOUNCY;
  return E_SOFT + ((approach - E_SOFT_BELOW) / (E_BOUNCY_ABOVE - E_SOFT_BELOW)) * (E_BOUNCY - E_SOFT);
}

/** Result of a contact: impulse (0 = touching but separating) and the normal from a to b. */
export interface Contact {
  j: number;
  nx: number;
  ny: number;
}

/**
 * Resolve one disc-disc contact: push the two apart (the lighter one moves more) and exchange an
 * impulse along the normal. `fx`/`fy` split two discs exactly on top of each other. Returns null
 * when they don't touch.
 */
export function resolveContact(
  a: Kin,
  b: Kin,
  ra: number,
  rb: number,
  ma: number,
  mb: number,
  fx: number,
  fy: number,
): Contact | null {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minD = ra + rb;
  if (dist >= minD) return null;
  if (dist < 1e-6) {
    dx = fx || 1;
    dy = fy;
  }
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const ima = 1 / ma;
  const imb = 1 / mb;
  const sum = ima + imb;
  const overlap = minD - dist;
  a.x -= (nx * overlap * ima) / sum;
  a.y -= (ny * overlap * ima) / sum;
  b.x += (nx * overlap * imb) / sum;
  b.y += (ny * overlap * imb) / sum;
  const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vrel >= 0) return { j: 0, nx, ny };
  const approach = -vrel;
  const j = ((1 + restitution(approach)) * approach) / sum;
  a.vx -= j * ima * nx;
  a.vy -= j * ima * ny;
  b.vx += j * imb * nx;
  b.vy += j * imb * ny;
  return { j, nx, ny };
}

// ---------- input stamping ----------

/**
 * An input may name the sim time it is meant for (`at`, from the client's smoothed clock). It
 * takes effect in the substep whose end time is nearest: substep k covers (k-1)·SUB_MS..k·SUB_MS
 * after the fight starts. The client's replay uses the same rule (`at <= end + SUB_MS / 2`).
 */
export function stampStep(at: number, fightAt: number): number {
  return Math.max(1, Math.ceil((at - fightAt) / SUB_MS - 0.5));
}

/** A late input may be applied as if it had arrived at most this many substeps earlier (~150 ms). */
export const MAX_REWIND_STEPS = 9;

/**
 * How far (position and velocity) a disc ends up from where it is, had its stick been
 * (dix, diy) different for the last `steps` substeps, or had it got an extra velocity kick
 * (kvx, kvy) that many substeps ago. Linear in the input, so it's added on top of the real state:
 * the bounded "lag compensation" for one player's own late input. (Speed caps are ignored: at
 * most 150 ms of a difference.)
 */
export function rewindDelta(steps: number, dix: number, diy: number, heavy: boolean, kvx = 0, kvy = 0, friction = FRICTION): Kin {
  const k: Kin = { x: 0, y: 0, vx: kvx, vy: kvy };
  const a = ACCEL * (heavy ? HEAVY_ACCEL : 1) * DT;
  for (let i = 0; i < steps; i++) {
    k.vx += dix * a;
    k.vy += diy * a;
    k.vx *= friction;
    k.vy *= friction;
    k.x += k.vx * DT;
    k.y += k.vy * DT;
  }
  return k;
}
