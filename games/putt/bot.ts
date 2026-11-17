// Practice bot for Putt Panic. It only uses what its own view shows (ball positions, the hole
// layout, the windmill clock), "imagines" a handful of putts with the same physics a human
// can see play out, and putts the best one with a shaky hand. Thinking is spread over ticks.

import type { GameCtx } from "../../shared/game";
import { HOLE_BY_ID, HOLES } from "./holes";
import { course, railDistance, simulate, type BodyIn } from "./physics";
import { ANGLE_STEPS, BALL_R, H, MAX_POWER, MAX_ROLL, REVEAL_MS, W, WALL_T, inSand, inWater, onGreen, type Hole } from "./shared";
import type { PuttAction, PuttState, PuttView } from "./server";

interface Cand {
  a: number;
  p: number;
  score: number;
}

interface Mem {
  key: string;
  /** When the bot is happy to putt (think time). */
  at: number;
  queue: { a: number; p: number }[];
  best: Cand | null;
  refined: boolean;
}

const memory = new WeakMap<PuttState, Map<string, Mem>>();
/** Imagined putts per tick (each is one short physics run). */
const PER_TICK = 5;

const wrapA = (a: number) => ((Math.round(a) % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
const clampP = (p: number) => Math.max(1, Math.min(MAX_POWER, Math.round(p)));

function memFor(s: PuttState): Map<string, Mem> {
  let m = memory.get(s);
  if (!m) memory.set(s, (m = new Map()));
  return m;
}

function firstIdeas(hole: Hole, x: number, y: number, random: () => number): { a: number; p: number }[] {
  const [cx, cy] = hole.cup;
  const d = Math.hypot(cx - x, cy - y);
  const straight = (Math.atan2(cy - y, cx - x) * 180) / Math.PI;
  const base = ((d + 30) / MAX_ROLL) * MAX_POWER;
  const out: { a: number; p: number }[] = [];
  for (const off of [0, -5, 5, -12, 12]) for (const k of [0.9, 1.05, 1.25]) out.push({ a: wrapA((straight + off) * 10), p: clampP(base * k) });
  // Aim along the way round: a few spots on the shortest path to the cup, at a few paces.
  for (const [wx, wy] of waypoints(hole, x, y)) {
    const dir = (Math.atan2(wy - y, wx - x) * 180) / Math.PI;
    const far = Math.hypot(wx - x, wy - y);
    for (const k of [0.95, 1.2, 1.5]) out.push({ a: wrapA(dir * 10), p: clampP(((far + 30) / MAX_ROLL) * MAX_POWER * k) });
  }
  // A few wild ideas: banks off the rails, around obstacles, through portals.
  for (let i = 0; i < 20; i++) out.push({ a: wrapA(random() * ANGLE_STEPS), p: clampP(25 + random() * 75) });
  return out;
}

// ---------- how far is it really? ----------
// Straight-line distance to the cup lies on holes with dividing rails (a ball parked behind a wall
// "looks" close), so bots judge a landing spot by the walking distance around rails, water and
// bumpers, with portals as free shortcuts. One grid per hole, built once.

const CELL = 10;
const GW = Math.ceil(W / CELL);
const GH = Math.ceil(H / CELL);
const fields = new Map<string, Float64Array>();

function pathField(hole: Hole): Float64Array {
  const hit = fields.get(hole.id);
  if (hit) return hit;
  const c = course(hole);
  const open = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++)
    for (let gx = 0; gx < GW; gx++) {
      const x = gx * CELL + CELL / 2;
      const y = gy * CELL + CELL / 2;
      if (!onGreen(hole, x, y) || inWater(hole, x, y)) continue;
      if (railDistance(c, x, y) < BALL_R + WALL_T / 2 - 4) continue;
      if (hole.bumpers?.some(([bx, by, r]) => Math.hypot(x - bx, y - by) < r + BALL_R)) continue;
      open[gy * GW + gx] = 1;
    }
  const cellOf = (x: number, y: number) =>
    Math.max(0, Math.min(GH - 1, Math.floor(y / CELL))) * GW + Math.max(0, Math.min(GW - 1, Math.floor(x / CELL)));
  const dist = new Float64Array(GW * GH).fill(Infinity);
  // Portal ends: reaching one means you are at the other.
  const ends = c.ends.map(([x, y]) => cellOf(x, y));
  // Dijkstra with a simple binary heap.
  const heap: [number, number][] = [];
  const push = (d: number, i: number) => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (heap[up][0] <= heap[k][0]) break;
      [heap[up], heap[k]] = [heap[k], heap[up]];
      k = up;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const start = cellOf(hole.cup[0], hole.cup[1]);
  dist[start] = 0;
  push(0, start);
  const STEPS = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    const gx = i % GW;
    const gy = (i - gx) / GW;
    const sandy = inSand(hole, gx * CELL + CELL / 2, gy * CELL + CELL / 2) ? 3 : 1;
    for (const [dx, dy, w] of STEPS) {
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const j = ny * GW + nx;
      if (!open[j]) continue;
      const nd = d + w * CELL * sandy;
      if (nd < dist[j]) {
        dist[j] = nd;
        push(nd, j);
      }
    }
    const e = ends.indexOf(i);
    if (e >= 0) {
      const j = ends[e ^ 1];
      if (d < dist[j]) {
        dist[j] = d;
        push(d, j);
      }
    }
  }
  fields.set(hole.id, dist);
  return dist;
}

/** Points along the shortest way round from (x, y) towards the cup (downhill on the distance grid). */
function waypoints(hole: Hole, x: number, y: number): [number, number][] {
  const f = pathField(hole);
  let gx = Math.max(0, Math.min(GW - 1, Math.floor(x / CELL)));
  let gy = Math.max(0, Math.min(GH - 1, Math.floor(y / CELL)));
  const out: [number, number][] = [];
  const marks = [120, 240, 380, 540];
  let walked = 0;
  for (let n = 0; n < 200 && out.length < marks.length; n++) {
    let best = f[gy * GW + gx];
    let bx = gx;
    let by = gy;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        if (f[ny * GW + nx] < best) {
          best = f[ny * GW + nx];
          bx = nx;
          by = ny;
        }
      }
    if (bx === gx && by === gy) break;
    walked += Math.hypot(bx - gx, by - gy) * CELL;
    gx = bx;
    gy = by;
    if (walked >= marks[out.length]) out.push([gx * CELL + CELL / 2, gy * CELL + CELL / 2]);
  }
  return out;
}

/** Distance from (x, y) to the cup the long way round (straight line if the grid has no answer). */
function pathDistance(hole: Hole, x: number, y: number): number {
  const f = pathField(hole);
  const c = course(hole);
  const gx = Math.floor(x / CELL);
  const gy = Math.floor(y / CELL);
  // Never "see" a cell through a rail.
  const clear = (tx: number, ty: number) => {
    for (let k = 1; k <= 4; k++) {
      const t = k / 4;
      if (railDistance(c, x + (tx - x) * t, y + (ty - y) * t) < WALL_T / 2) return false;
    }
    return true;
  };
  let best = Infinity;
  // A resting ball can sit in a cell the grid calls blocked (right against a rail): look next door.
  for (let r = 0; r <= 2 && best === Infinity; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const v = f[ny * GW + nx];
        if (v === Infinity || (r > 0 && !clear(nx * CELL + CELL / 2, ny * CELL + CELL / 2))) continue;
        best = Math.min(best, v + Math.hypot(dx, dy) * CELL);
      }
  return best === Infinity ? Math.hypot(x - hole.cup[0], y - hole.cup[1]) * 2 : best;
}

function judge(hole: Hole, bodies: BodyIn[], slot: number, a: number, p: number, t0: number): number {
  const out = simulate(hole, bodies, [{ slot, a, power: p }], t0).bodies.find((b) => b.slot === slot);
  if (!out) return 1e6;
  if (out.sunk) return 0;
  if (out.splashed) return 5000;
  const d = pathDistance(hole, out.x, out.y);
  return d + (inSand(hole, out.x, out.y) ? 60 : 0);
}

export function puttBot(s: PuttState, v: PuttView, botId: string, ctx: GameCtx): PuttAction | null {
  const now = ctx.now();
  const mems = memFor(s);
  const slot = v.balls.findIndex((b) => b.id === botId);
  const me = v.balls[slot];
  if (!me) return null;

  if (v.phase === "card") {
    if (me.ready) return null;
    const key = `card:${v.hole}`;
    let m = mems.get(botId);
    if (!m || m.key !== key) {
      m = { key, at: now + 1500 + ctx.random() * 2500, queue: [], best: null, refined: false };
      mems.set(botId, m);
    }
    return now >= m.at ? { type: "ready" } : null;
  }

  if (v.phase !== "aim" || me.sunk || me.out || me.locked) return null;
  const hole = HOLE_BY_ID[v.course[v.hole]] ?? HOLES[0];
  const key = `aim:${v.hole}:${v.shot}`;
  let m = mems.get(botId);
  if (!m || m.key !== key) {
    const think = 1500 + ctx.random() * 2500;
    m = { key, at: Math.min(now + think, v.endsAt - 1500), queue: firstIdeas(hole, me.x, me.y, ctx.random), best: null, refined: false };
    mems.set(botId, m);
  }

  // Everyone else's ball sits where it is now (the bot can't know their secret aims).
  const bodies: BodyIn[] = v.balls.flatMap((b, i) => (!b.sunk && !b.out ? [{ slot: i, x: b.x, y: b.y }] : []));
  const t0 = (Math.max(now, m.at) + REVEAL_MS - v.t0) / 1000;
  for (let n = 0; n < PER_TICK && m.queue.length; n++) {
    const c = m.queue.shift()!;
    const score = judge(hole, bodies, slot, c.a, c.p, t0);
    if (!m.best || score < m.best.score) m.best = { ...c, score };
  }
  if (!m.queue.length && !m.refined && m.best && m.best.score > 0) {
    m.refined = true;
    const b = m.best;
    for (let i = 0; i < 16; i++) m.queue.push({ a: wrapA(b.a + (ctx.random() - 0.5) * 80), p: clampP(b.p * (0.85 + ctx.random() * 0.3)) });
  }

  const hurry = now >= v.endsAt - 1200;
  if ((now < m.at || m.queue.length) && !hurry) return null;
  const best = m.best ?? { a: 0, p: 40, score: 0 };
  // A human hand: a little off line, a little off pace.
  return { type: "lock", a: wrapA(best.a + (ctx.random() - 0.5) * 36), p: clampP(best.p * (0.94 + ctx.random() * 0.12)) };
}
