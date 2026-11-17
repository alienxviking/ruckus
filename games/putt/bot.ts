// Practice bot for Putt Panic. It only uses what its own view shows (ball positions, the hole
// layout, the windmill clock), "imagines" a handful of putts with the same physics a human
// can see play out, and putts the best one with a shaky hand. Thinking is spread over ticks.

import type { GameCtx } from "../../shared/game";
import { HOLE_BY_ID, HOLES } from "./holes";
import { simulate, type BodyIn } from "./physics";
import { ANGLE_STEPS, MAX_POWER, MAX_ROLL, REVEAL_MS, inSand, type Hole } from "./shared";
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
  // A few wild ideas: banks off the rails, around obstacles, through portals.
  for (let i = 0; i < 20; i++) out.push({ a: wrapA(random() * ANGLE_STEPS), p: clampP(25 + random() * 75) });
  return out;
}

function judge(hole: Hole, bodies: BodyIn[], slot: number, a: number, p: number, t0: number): number {
  const out = simulate(hole, bodies, [{ slot, a, power: p }], t0).bodies.find((b) => b.slot === slot);
  if (!out) return 1e6;
  if (out.sunk) return 0;
  if (out.splashed) return 5000;
  const d = Math.hypot(out.x - hole.cup[0], out.y - hole.cup[1]);
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
    for (let i = 0; i < 10; i++) m.queue.push({ a: wrapA(b.a + (ctx.random() - 0.5) * 80), p: clampP(b.p * (0.85 + ctx.random() * 0.3)) });
  }

  const hurry = now >= v.endsAt - 1200;
  if ((now < m.at || m.queue.length) && !hurry) return null;
  const best = m.best ?? { a: 0, p: 40, score: 0 };
  // A human hand: a little off line, a little off pace.
  return { type: "lock", a: wrapA(best.a + (ctx.random() - 0.5) * 36), p: clampP(best.p * (0.94 + ctx.random() * 0.12)) };
}
