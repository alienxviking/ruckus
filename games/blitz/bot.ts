// Practice bots for Blitz. A bot only reads its own view (what a human in its seat sees):
// it memorises the count flash and the memory arrows while they're shown, "thinks" for a
// human-ish moment, then answers. Medium skill: right most of the time, never instant.

import type { GameCtx } from "../../shared/game";
import type { BlitzAction, BlitzState, BlitzView } from "./server";
import { CLOCK_TARGET_MS, TAP_BATCH_MS, exprValue, type MicroType, type Puzzle } from "./shared";

interface BotMem {
  round: number;
  /** When the bot submits its answer (null until answers open). */
  decideAt: number | null;
  /** Count flash: how many targets the bot counted while the field was showing. */
  counted: number | null;
  /** Memory: the arrows the bot watched. */
  seq: number[] | null;
  /** Stop the clock: the moment the bot will press stop. */
  stopAt: number;
  /** Tap frenzy: taps per second for this round, and the last batch time. */
  rate: number;
  lastTap: number;
  owed: number;
}

const memory = new WeakMap<BlitzState, Map<string, BotMem>>();

/** Chance of getting it right, per microgame. */
const ACCURACY: Partial<Record<MicroType, number>> = {
  odd: 0.85,
  count: 0.7,
  math: 0.8,
  ink: 0.8,
  bigger: 0.65,
  memory: 0.7,
  pair: 0.75,
  arrows: 0.7,
  anagram: 0.75,
  fruit: 0.65,
};
/** Extra think time (ms) for the chewier ones. */
const EXTRA_THINK: Partial<Record<MicroType, number>> = { bigger: 700, fruit: 1200, anagram: 800, pair: 600, memory: 400 };

function memOf(s: BlitzState, botId: string, round: number, ctx: GameCtx): BotMem {
  let byBot = memory.get(s);
  if (!byBot) memory.set(s, (byBot = new Map()));
  let m = byBot.get(botId);
  if (!m || m.round !== round) {
    m = {
      round,
      decideAt: null,
      counted: null,
      seq: null,
      // Usually within a few tenths of 5.00s, sometimes further out.
      stopAt: CLOCK_TARGET_MS + Math.round((ctx.random() + ctx.random() - 1) * 600),
      rate: 7 + ctx.random() * 5,
      lastTap: 0,
      owed: 0,
    };
    byBot.set(botId, m);
  }
  return m;
}

const randInt = (ctx: GameCtx, n: number) => Math.floor(ctx.random() * n);

/** A wrong choice out of `n` (anything but `right`). */
function wrongOf(ctx: GameCtx, n: number, right: number): number {
  const k = randInt(ctx, n - 1);
  return k >= right ? k + 1 : k;
}

/** The right choice index as the bot works it out from the puzzle (-1 when it can't tell). */
function solve(pz: Puzzle, m: BotMem): number {
  switch (pz.t) {
    case "odd": {
      const counts = new Map<string, number>();
      for (const c of pz.cells) counts.set(c, (counts.get(c) ?? 0) + 1);
      return pz.cells.findIndex((c) => counts.get(c) === 1);
    }
    case "count":
      return m.counted === null || !pz.options ? -1 : pz.options.indexOf(m.counted);
    case "math": {
      const match = /^(\d+) (\+|−|×) (\d+)$/.exec(pz.text);
      if (!match) return -1;
      const a = Number(match[1]);
      const b = Number(match[3]);
      const v = match[2] === "+" ? a + b : match[2] === "−" ? a - b : a * b;
      return pz.options.indexOf(v);
    }
    case "ink":
      return pz.options.indexOf(pz.ink);
    case "bigger":
      return exprValue(pz.items[0]) > exprValue(pz.items[1]) ? 0 : 1;
    case "arrows": {
      const counts = [0, 0, 0, 0];
      for (const [d] of pz.arrows) counts[d] += 1;
      return counts.indexOf(Math.max(...counts));
    }
    case "anagram": {
      const key = pz.letters.split("").sort().join("");
      return pz.options.findIndex((w) => w.split("").sort().join("") === key);
    }
    case "fruit": {
      const worth = new Map<string, number>();
      // Line one is a single fruit repeated; every later line has one unknown left.
      for (const line of pz.lines) {
        const known = line.l.filter((f) => worth.has(f)).reduce((sum, f) => sum + worth.get(f)!, 0);
        const unknown = line.l.filter((f) => !worth.has(f));
        if (unknown.length && unknown.every((f) => f === unknown[0])) worth.set(unknown[0], (line.r - known) / unknown.length);
      }
      if (!pz.ask.every((f) => worth.has(f))) return -1;
      return pz.options.indexOf(pz.ask.reduce((sum, f) => sum + worth.get(f)!, 0));
    }
    default:
      return -1;
  }
}

function choiceCount(pz: Puzzle): number {
  if (pz.t === "odd") return pz.cells.length;
  if (pz.t === "bigger") return 2;
  if (pz.t === "arrows") return 4;
  if ("options" in pz && pz.options) return pz.options.length;
  return 4;
}

export function botMove(s: BlitzState, v: BlitzView, botId: string, ctx: GameCtx): BlitzAction | null {
  const pz = v.puzzle;
  if (v.phase !== "play" || !pz || !v.micro || !v.you || v.opensAt === null) return null;
  const now = ctx.now();
  const r = v.round;
  const type = v.micro.type;
  const m = memOf(s, botId, r, ctx);

  // Watch the flash / the arrows while they're on screen.
  if (pz.t === "count" && pz.field) m.counted = pz.field.filter(([e]) => e === pz.target).length;
  if (pz.t === "memory" && pz.seq) m.seq = pz.seq.slice();
  if (now < v.opensAt) return null;

  if (type === "tap") {
    if (now - m.lastTap < TAP_BATCH_MS) return null;
    const since = m.lastTap ? now - m.lastTap : TAP_BATCH_MS;
    m.lastTap = now;
    m.owed += (m.rate * since) / 1000;
    const n = Math.min(20, Math.floor(m.owed));
    if (n < 1) return null;
    m.owed -= n;
    return { type: "taps", r, n };
  }
  if (v.you.answered) return null;

  if (type === "clock") return now - v.phaseAt >= m.stopAt ? { type: "stop", r, t: now } : null;

  if (m.decideAt === null) m.decideAt = now + 700 + Math.round(ctx.random() * 1800) + (EXTRA_THINK[type] ?? 0);
  // Never sit it out: answer a little before time runs out even mid-think.
  if (now < m.decideAt && now < v.endsAt - 400) return null;

  const good = ctx.random() < (ACCURACY[type] ?? 0.75);

  if (pz.t === "memory") {
    const seq = m.seq ? m.seq.slice() : Array.from({ length: pz.len }, () => randInt(ctx, 4));
    if (!good) {
      const i = randInt(ctx, seq.length);
      seq[i] = (seq[i] + 1 + randInt(ctx, 3)) % 4;
    }
    return { type: "seq", r, seq };
  }
  if (pz.t === "pair") {
    const twin = good ? pz.cells.find((c, i) => pz.cells.indexOf(c) !== i) : undefined;
    if (twin !== undefined) {
      const first = pz.cells.indexOf(twin);
      return { type: "pair", r, a: first, b: pz.cells.indexOf(twin, first + 1) };
    }
    const a = randInt(ctx, pz.cells.length);
    return { type: "pair", r, a, b: wrongOf(ctx, pz.cells.length, a) };
  }

  const n = choiceCount(pz);
  const right = solve(pz, m);
  let c: number;
  if (right < 0) c = randInt(ctx, n);
  else c = good ? right : wrongOf(ctx, n, right);
  return { type: "pick", r, c };
}
