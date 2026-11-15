// Putt Panic's lockstep ball simulation. Server-only: the server runs it once per roll and sends
// the outcome as a replay (simplified paths + events), so clients never re-simulate anything.
//
// Fixed 1/120 s steps (with substeps for fast balls), every ball together: rolling friction, sand,
// mounds and bowls, boost pads, wooden rails, bumpers, spinning windmill sails, ball-to-ball
// knocks, portals, water and the cup.

import {
  BALL_R,
  BLADE_T,
  BOOST_L,
  BOOST_W,
  CUP_PULL_R,
  CUP_R,
  FELT,
  H,
  HUB_R,
  PORTAL_R,
  SAND,
  STEP_HZ,
  W,
  WALL_T,
  angleRad,
  inSand,
  inWater,
  launchSpeed,
  millAngle,
  onGreen,
  railSegments,
  type Hole,
} from "./shared";

const DT = 1 / STEP_HZ;
/** Simulations stop after 11 s whatever happens. */
export const MAX_STEPS = STEP_HZ * 11;
const MAX_SPEED = 1500;
const STOP_SPEED = 7;
/** A ball faster than this rolls straight over the cup (and may lip out). */
export const SINK_SPEED = 400;
const WALL_E = 0.78;
const BALL_E = 0.94;
const HUB_E = 0.6;
const BLADE_E = 0.7;
/** Sails always bat a ball away at least this fast (relative to the sail). */
const BLADE_KICK = 150;
/** Bumpers return the incoming speed × this, plus a flat kick. */
const BUMP_GAIN = 1.08;
const BUMP_KICK = 110;
const BOOST_ACCEL = 3200;
const BOOST_TOP = 820;
const CUP_PULL = 650;
/** Positions are recorded every SAMPLE steps, then simplified to keyframes within EPS units. */
const SAMPLE = 2;
const EPS = 0.7;
/** Most events one roll may report (the important ones are always kept). */
const EVENT_CAP = 160;

const RW = BALL_R + WALL_T / 2;

export type EventType = "sink" | "water" | "portal" | "bump" | "knock" | "lip" | "boost" | "whack";

/**
 * Replay events, all [type, step, ...]:
 *   ["sink", k, slot]                    holed out
 *   ["water", k, slot, x, y]             splash (the ball is out of this roll)
 *   ["portal", k, slot, from, to]        teleport between portal ends (end = pair × 2 + 0|1)
 *   ["bump", k, bumper]                  a bumper fired
 *   ["knock", k, x, y, hitter, victim, speed]  ball-to-ball hit
 *   ["lip", k, slot]                     rolled over the cup too fast
 *   ["boost", k, pad, slot]              ran over a boost pad
 *   ["whack", k, slot, mill]             batted by a windmill sail
 */
export type RollEvent = (string | number)[];

export interface Shot {
  slot: number;
  /** Angle in tenths of a degree. */
  a: number;
  power: number;
}

export interface BodyIn {
  slot: number;
  x: number;
  y: number;
}

export interface BodyOut {
  slot: number;
  x: number;
  y: number;
  sunk: boolean;
  splashed: boolean;
  /** Keyframe segments, each flat [k, x, y, …] (ints). Empty when the ball never moved. */
  path: number[][];
}

export interface SimResult {
  bodies: BodyOut[];
  events: RollEvent[];
  /** Step at which everything came to rest. */
  settle: number;
}

interface Seg {
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  l2: number;
}

interface Course {
  hole: Hole;
  segs: Seg[];
  /** Portal ends: [x, y] at index pair × 2 + (0 | 1). */
  ends: number[][];
  boosts: { x: number; y: number; c: number; s: number }[];
}

const courses = new Map<string, Course>();

export function course(hole: Hole): Course {
  const hit = courses.get(hole.id);
  if (hit && hit.hole === hole) return hit;
  const segs = railSegments(hole).map(([ax, ay, bx, by]) => {
    const dx = bx - ax;
    const dy = by - ay;
    return { ax, ay, dx, dy, l2: dx * dx + dy * dy };
  });
  const ends: number[][] = [];
  for (const p of hole.portals ?? []) ends.push([p[0], p[1]], [p[2], p[3]]);
  const boosts = (hole.boosts ?? []).map(([x, y, d]) => {
    const a = (d * Math.PI) / 180;
    return { x, y, c: Math.cos(a), s: Math.sin(a) };
  });
  const c: Course = { hole, segs, ends, boosts };
  courses.set(hole.id, c);
  return c;
}

/** Clear distance from (x, y) to the nearest rail centreline. */
export function railDistance(c: Course, x: number, y: number): number {
  let best = Infinity;
  for (const s of c.segs) {
    const t = s.l2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * s.dx + (y - s.ay) * s.dy) / s.l2)) : 0;
    best = Math.min(best, Math.hypot(x - (s.ax + s.dx * t), y - (s.ay + s.dy * t)));
  }
  return best;
}

/** Radius around a windmill inside which a resting ball would be in the sails' way. */
export const millReach = (m: readonly number[]) => m[2] + BALL_R + BLADE_T / 2 + 1;

/** Could a ball rest at (x, y)? On the felt, clear of rails, hazards, posts, the cup and other balls. */
export function freeSpot(hole: Hole, x: number, y: number, others: readonly number[][]): boolean {
  const c = course(hole);
  if (x < 0 || x > W || y < 0 || y > H || !onGreen(hole, x, y)) return false;
  if (railDistance(c, x, y) < RW + 1) return false;
  if (inWater(hole, x, y) || inSand(hole, x, y)) return false;
  if (Math.hypot(x - hole.cup[0], y - hole.cup[1]) < CUP_PULL_R + BALL_R) return false;
  for (const b of hole.bumpers ?? []) if (Math.hypot(x - b[0], y - b[1]) < b[2] + BALL_R + 2) return false;
  for (const m of hole.mills ?? []) if (Math.hypot(x - m[0], y - m[1]) < millReach(m) + 2) return false;
  for (const e of c.ends) if (Math.hypot(x - e[0], y - e[1]) < PORTAL_R + BALL_R) return false;
  for (const b of c.boosts) if (onBoost(b, x, y, BALL_R)) return false;
  for (const h of hole.hills ?? []) if (Math.hypot(x - h[0], y - h[1]) < h[2] && Math.abs(h[3]) > FELT.a * 0.8) return false;
  for (const o of others) if (Math.hypot(x - o[0], y - o[1]) < BALL_R * 2 + 2) return false;
  return true;
}

/** Nearest free spot to (x, y), searching outward in rings. Falls back to (x, y). */
export function nearestFree(hole: Hole, x: number, y: number, others: readonly number[][]): [number, number] {
  if (freeSpot(hole, x, y, others)) return [Math.round(x), Math.round(y)];
  for (let r = 8; r <= 400; r += 8) {
    const n = Math.max(8, Math.round((r * Math.PI * 2) / 14));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = Math.round(x + Math.cos(a) * r);
      const py = Math.round(y + Math.sin(a) * r);
      if (freeSpot(hole, px, py, others)) return [px, py];
    }
  }
  return [Math.round(x), Math.round(y)];
}

function onBoost(b: { x: number; y: number; c: number; s: number }, x: number, y: number, pad = 0): boolean {
  const dx = x - b.x;
  const dy = y - b.y;
  const along = dx * b.c + dy * b.s;
  const across = -dx * b.s + dy * b.c;
  return Math.abs(along) <= BOOST_L / 2 + pad && Math.abs(across) <= BOOST_W / 2 + pad;
}

// ---------- the simulation ----------

interface Body {
  slot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  on: boolean;
  sleep: boolean;
  sunk: boolean;
  splashed: boolean;
  /** Portal end we just came out of (no re-entry until we leave it), or -1. */
  lock: number;
  /** Boost pad we're on now / at the end of the previous step (for entry events), or -1. */
  pad: number;
  lastPad: number;
  lipped: boolean;
  /** Net push from slopes/boosts last step (decides whether the ball may rest). */
  push: number;
  inSand: boolean;
  /** Raw samples of the current segment, flat [k, x, y, …]. */
  cur: number[];
  segs: number[][];
  lastWhack: number;
}

function startSeg(b: Body, k: number) {
  b.cur = [k, b.x, b.y];
}

function endSeg(b: Body, k: number) {
  if (b.cur.length && b.cur[b.cur.length - 3] !== k) b.cur.push(k, b.x, b.y);
  else if (b.cur.length) {
    b.cur[b.cur.length - 2] = b.x;
    b.cur[b.cur.length - 1] = b.y;
  }
  if (b.cur.length) b.segs.push(b.cur);
  b.cur = [];
}

/** Keep the fewest keyframes such that linear interpolation (in time) stays within EPS. */
export function simplify(raw: readonly number[]): number[] {
  const n = raw.length / 3;
  const out: number[] = [];
  const put = (i: number) => out.push(raw[3 * i], Math.round(raw[3 * i + 1]), Math.round(raw[3 * i + 2]));
  if (n === 0) return out;
  put(0);
  let i = 0;
  while (i < n - 1) {
    let best = i + 1;
    for (let j = i + 2; j < n && j - i <= 90; j++) {
      const k0 = raw[3 * i];
      const k1 = raw[3 * j];
      let ok = true;
      for (let m = i + 1; m < j; m++) {
        const f = (raw[3 * m] - k0) / (k1 - k0);
        const ex = raw[3 * i + 1] + (raw[3 * j + 1] - raw[3 * i + 1]) * f;
        const ey = raw[3 * i + 2] + (raw[3 * j + 2] - raw[3 * i + 2]) * f;
        const dx = ex - raw[3 * m + 1];
        const dy = ey - raw[3 * m + 2];
        if (dx * dx + dy * dy > EPS * EPS) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
      best = j;
    }
    put(best);
    i = best;
  }
  return out;
}

/**
 * Roll every ball in lockstep until they all rest. `t0` is the windmill clock (seconds since the
 * hole started) at step 0. Balls not in `shots` start at rest but can be knocked about.
 */
export function simulate(hole: Hole, balls: readonly BodyIn[], shots: readonly Shot[], t0: number): SimResult {
  const c = course(hole);
  const mills = hole.mills ?? [];
  const bumpers = hole.bumpers ?? [];
  const hills = hole.hills ?? [];
  const [cupX, cupY] = hole.cup;
  const events: RollEvent[] = [];
  let minor = 0;
  const note = (e: RollEvent, important = false) => {
    if (important || minor < EVENT_CAP) {
      events.push(e);
      if (!important) minor++;
    }
  };

  const bodies: Body[] = balls.map((b) => ({
    slot: b.slot,
    x: b.x,
    y: b.y,
    vx: 0,
    vy: 0,
    on: true,
    sleep: false,
    sunk: false,
    splashed: false,
    lock: -1,
    pad: -1,
    lastPad: -1,
    lipped: false,
    push: 0,
    inSand: false,
    cur: [],
    segs: [],
    lastWhack: -999,
  }));
  for (const b of bodies) {
    const shot = shots.find((s) => s.slot === b.slot);
    if (shot && shot.power > 0) {
      const v = launchSpeed(shot.power);
      const a = angleRad(shot.a);
      b.vx = Math.cos(a) * v;
      b.vy = Math.sin(a) * v;
    }
    // Resting on a portal end doesn't send you straight back through it.
    c.ends.forEach((e, i) => {
      if (Math.hypot(b.x - e[0], b.y - e[1]) < PORTAL_R + BALL_R) b.lock = i;
    });
    startSeg(b, 0);
  }
  const lastKnock = new Map<number, number>();
  const lastBump = bumpers.map(() => -999);

  const integrate = (b: Body, h: number) => {
    let ax = 0;
    let ay = 0;
    for (const hl of hills) {
      const dx = b.x - hl[0];
      const dy = b.y - hl[1];
      const d = Math.hypot(dx, dy);
      if (d > 0.001 && d < hl[2]) {
        const g = (hl[3] * d) / hl[2];
        ax += (dx / d) * g;
        ay += (dy / d) * g;
      }
    }
    let onPad = -1;
    c.boosts.forEach((p, i) => {
      if (!onBoost(p, b.x, b.y)) return;
      onPad = i;
      if (b.vx * p.c + b.vy * p.s < BOOST_TOP) {
        ax += p.c * BOOST_ACCEL;
        ay += p.s * BOOST_ACCEL;
      }
    });
    b.pad = onPad;
    const cdx = cupX - b.x;
    const cdy = cupY - b.y;
    const cd = Math.hypot(cdx, cdy);
    if (cd > 0.001 && cd < CUP_PULL_R && Math.hypot(b.vx, b.vy) < SINK_SPEED * 1.2) {
      const g = CUP_PULL * (1 - cd / CUP_PULL_R) + 120;
      ax += (cdx / cd) * g;
      ay += (cdy / cd) * g;
    }
    b.push = Math.hypot(ax, ay);
    b.vx += ax * h;
    b.vy += ay * h;
    b.inSand = inSand(hole, b.x, b.y);
    const f = b.inSand ? SAND : FELT;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) {
      let ns = Math.max(0, sp - (f.a + f.b * sp) * h);
      if (ns > MAX_SPEED) ns = MAX_SPEED;
      b.vx *= ns / sp;
      b.vy *= ns / sp;
    }
    b.x += b.vx * h;
    b.y += b.vy * h;
  };

  const rails = (b: Body) => {
    for (let pass = 0; pass < 2; pass++) {
      for (const s of c.segs) {
        const t = s.l2 > 0 ? Math.max(0, Math.min(1, ((b.x - s.ax) * s.dx + (b.y - s.ay) * s.dy) / s.l2)) : 0;
        const px = s.ax + s.dx * t;
        const py = s.ay + s.dy * t;
        let nx = b.x - px;
        let ny = b.y - py;
        const d2 = nx * nx + ny * ny;
        if (d2 >= RW * RW) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-6) {
          nx = -s.dy;
          ny = s.dx;
          const l = Math.hypot(nx, ny) || 1;
          nx /= l;
          ny /= l;
        } else {
          nx /= d;
          ny /= d;
        }
        b.x = px + nx * RW;
        b.y = py + ny * RW;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          b.vx -= (1 + WALL_E) * vn * nx;
          b.vy -= (1 + WALL_E) * vn * ny;
          // A touch of grip along the rail.
          const vt = -b.vx * ny + b.vy * nx;
          b.vx -= -ny * vt * 0.02;
          b.vy -= nx * vt * 0.02;
        }
      }
    }
  };

  const posts = (b: Body, step: number) => {
    bumpers.forEach((p, i) => {
      const dx = b.x - p[0];
      const dy = b.y - p[1];
      const r = p[2] + BALL_R;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) return;
      const d = Math.sqrt(d2) || 1e-6;
      const nx = dx / d;
      const ny = dy / d;
      b.x = p[0] + nx * r;
      b.y = p[1] + ny * r;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        const out = Math.min(1100, -vn * BUMP_GAIN + BUMP_KICK);
        b.vx += (out - vn) * nx;
        b.vy += (out - vn) * ny;
        if (step - lastBump[i] > 6) note(["bump", step, i]);
        lastBump[i] = step;
      }
    });
    for (const m of mills) {
      const dx = b.x - m[0];
      const dy = b.y - m[1];
      const r = HUB_R + BALL_R;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const nx = dx / d;
      const ny = dy / d;
      b.x = m[0] + nx * r;
      b.y = m[1] + ny * r;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= (1 + HUB_E) * vn * nx;
        b.vy -= (1 + HUB_E) * vn * ny;
      }
    }
  };

  const sails = (b: Body, t: number, step: number) => {
    mills.forEach((m, mi) => {
      const [mx, my, len, spin, count] = m;
      const dx0 = b.x - mx;
      const dy0 = b.y - my;
      const reach = len + BALL_R + BLADE_T / 2;
      if (dx0 * dx0 + dy0 * dy0 > reach * reach) return;
      const base = millAngle(m, t);
      for (let i = 0; i < count; i++) {
        const a = base + (i / count) * Math.PI * 2;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        // Closest point on the sail (from the hub's edge to the tip).
        const along = Math.max(HUB_R * 0.5, Math.min(len, dx0 * ux + dy0 * uy));
        const px = mx + ux * along;
        const py = my + uy * along;
        let nx = b.x - px;
        let ny = b.y - py;
        const r = BALL_R + BLADE_T / 2;
        const d2 = nx * nx + ny * ny;
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2);
        // Sail velocity at the contact point.
        const svx = -spin * (py - my);
        const svy = spin * (px - mx);
        if (d < 1e-6) {
          nx = -uy * Math.sign(spin || 1);
          ny = ux * Math.sign(spin || 1);
        } else {
          nx /= d;
          ny /= d;
        }
        b.x = px + nx * r;
        b.y = py + ny * r;
        const rvx = b.vx - svx;
        const rvy = b.vy - svy;
        const vn = rvx * nx + rvy * ny;
        if (vn < BLADE_KICK) {
          const want = Math.max(BLADE_KICK, -vn * BLADE_E);
          b.vx += (want - vn) * nx;
          b.vy += (want - vn) * ny;
          if (b.sleep) b.sleep = false;
          if (step - b.lastWhack > 40) note(["whack", step, b.slot, mi]);
          b.lastWhack = step;
        }
      }
    });
  };

  const pairs = (step: number) => {
    const D = BALL_R * 2;
    for (let i = 0; i < bodies.length; i++) {
      const p = bodies[i];
      if (!p.on) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const q = bodies[j];
        if (!q.on || (p.sleep && q.sleep)) continue;
        let nx = q.x - p.x;
        let ny = q.y - p.y;
        const d2 = nx * nx + ny * ny;
        if (d2 >= D * D) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-6) {
          nx = 1;
          ny = 0;
        } else {
          nx /= d;
          ny /= d;
        }
        const push = (D - d) / 2;
        p.x -= nx * push;
        p.y -= ny * push;
        q.x += nx * push;
        q.y += ny * push;
        const pv = p.vx * nx + p.vy * ny;
        const qv = q.vx * nx + q.vy * ny;
        const rel = pv - qv;
        if (rel <= 0) continue;
        const j2 = ((1 + BALL_E) / 2) * rel;
        p.vx -= j2 * nx;
        p.vy -= j2 * ny;
        q.vx += j2 * nx;
        q.vy += j2 * ny;
        p.sleep = false;
        q.sleep = false;
        const key = p.slot * 64 + q.slot;
        if (rel > 50 && step - (lastKnock.get(key) ?? -999) > 10) {
          lastKnock.set(key, step);
          const pFirst = pv >= -qv;
          note([
            "knock",
            step,
            Math.round((p.x + q.x) / 2),
            Math.round((p.y + q.y) / 2),
            pFirst ? p.slot : q.slot,
            pFirst ? q.slot : p.slot,
            Math.round(rel),
          ]);
        }
      }
    }
  };

  const zones = (b: Body, step: number) => {
    // Portals.
    if (b.lock >= 0) {
      const e = c.ends[b.lock];
      if (Math.hypot(b.x - e[0], b.y - e[1]) > PORTAL_R + BALL_R + 1) b.lock = -1;
    }
    for (let i = 0; i < c.ends.length; i++) {
      if (i === b.lock) continue;
      const e = c.ends[i];
      if (Math.hypot(b.x - e[0], b.y - e[1]) >= PORTAL_R) continue;
      const to = i ^ 1;
      endSeg(b, step);
      b.x = c.ends[to][0];
      b.y = c.ends[to][1];
      b.lock = to;
      startSeg(b, step);
      note(["portal", step, b.slot, i, to], true);
      break;
    }
    // Water (or somehow off the course).
    if (inWater(hole, b.x, b.y) || b.x < 0 || b.x > W || b.y < 0 || b.y > H || !onGreen(hole, b.x, b.y)) {
      endSeg(b, step);
      b.on = false;
      b.splashed = true;
      note(["water", step, b.slot, Math.round(b.x), Math.round(b.y)], true);
      return;
    }
    // The cup.
    const cd = Math.hypot(b.x - cupX, b.y - cupY);
    if (cd < CUP_R) {
      const sp = Math.hypot(b.vx, b.vy);
      if (sp < SINK_SPEED) {
        endSeg(b, step);
        b.on = false;
        b.sunk = true;
        b.vx = 0;
        b.vy = 0;
        note(["sink", step, b.slot], true);
        return;
      }
      if (!b.lipped) {
        b.lipped = true;
        // Rattle round the rim: lose some pace and get dragged toward the middle.
        const k = 0.72;
        const tx = (cupX - b.x) / (cd || 1);
        const ty = (cupY - b.y) / (cd || 1);
        b.vx = b.vx * k + tx * sp * 0.18;
        b.vy = b.vy * k + ty * sp * 0.18;
        note(["lip", step, b.slot]);
      }
    } else if (cd > CUP_R + 6) b.lipped = false;
  };

  const inMillReach = (b: Body) =>
    mills.some((m) => Math.hypot(b.x - m[0], b.y - m[1]) < millReach(m));

  let settle = MAX_STEPS;
  for (let step = 1; step <= MAX_STEPS; step++) {
    let vmax = 0;
    for (const b of bodies) if (b.on && !b.sleep) vmax = Math.max(vmax, Math.hypot(b.vx, b.vy));
    const subs = Math.min(5, Math.max(1, Math.ceil((vmax * DT) / 5)));
    const h = DT / subs;
    for (let sub = 1; sub <= subs; sub++) {
      const t = t0 + (step - 1 + sub / subs) * DT;
      for (const b of bodies) if (b.on && !b.sleep) integrate(b, h);
      for (const b of bodies) {
        if (!b.on) continue;
        if (mills.length) sails(b, t, step);
        if (b.sleep) continue;
        rails(b);
        posts(b, step);
      }
      pairs(step);
      for (const b of bodies) if (b.on && !b.sleep) zones(b, step);
    }
    for (const b of bodies) {
      if (!b.on || b.sleep) continue;
      const sp = Math.hypot(b.vx, b.vy);
      const grip = b.inSand ? SAND.a : FELT.a;
      if (sp < STOP_SPEED && b.push < grip) {
        b.vx = 0;
        b.vy = 0;
        b.sleep = true;
      }
    }
    for (const b of bodies) {
      if (!b.on) continue;
      if (b.pad >= 0 && b.pad !== b.lastPad) note(["boost", step, b.pad, b.slot]);
      b.lastPad = b.pad;
      if (step % SAMPLE === 0) b.cur.push(step, b.x, b.y);
    }
    const busy = bodies.some((b) => b.on && (!b.sleep || inMillReach(b)));
    if (!busy) {
      settle = step;
      break;
    }
  }

  // Anything still in a windmill's way when time runs out gets nudged clear of the sails.
  for (const b of bodies) {
    if (!b.on) continue;
    for (const m of mills) {
      const dx = b.x - m[0];
      const dy = b.y - m[1];
      const d = Math.hypot(dx, dy) || 1;
      const reach = millReach(m) + 1;
      if (d < reach) {
        b.x = m[0] + (dx / d) * reach;
        b.y = m[1] + (dy / d) * reach;
      }
    }
    b.x = Math.round(b.x);
    b.y = Math.round(b.y);
    endSeg(b, settle);
  }

  const out: BodyOut[] = bodies.map((b, bi) => {
    const path = b.segs.map(simplify).filter((s) => s.length >= 3);
    // A ball that never budged needs no path at all.
    const x0 = Math.round(balls[bi].x);
    const y0 = Math.round(balls[bi].y);
    const still = path.length === 1 && path[0].every((v, i) => i % 3 === 0 || v === (i % 3 === 1 ? x0 : y0));
    return {
      slot: b.slot,
      x: b.x,
      y: b.y,
      sunk: b.sunk,
      splashed: b.splashed,
      path: still ? [] : path,
    };
  });
  events.sort((a, b) => (a[1] as number) - (b[1] as number));
  return { bodies: out, events, settle };
}
