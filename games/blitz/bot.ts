// Practice bots for Blitz. A bot only reads its own view (what a human in its seat sees):
// it memorises the count flash, the memory arrows, the number flash and the "what's
// missing" line-up while they're shown, "thinks" for a human-ish moment, then answers.
// Word games use the same word lists a well-read human would know. Medium skill: right
// most of the time, never instant, and it falls for a twist now and then.

import type { GameCtx } from "../../shared/game";
import { CATEGORIES, RHYMES, SPELLINGS } from "./data";
import type { BlitzAction, BlitzState, BlitzView } from "./server";
import {
  CLOCK_TARGET_MS,
  TAP_BATCH_MS,
  exprValue,
  fmtTime,
  nextFits,
  pickRange,
  type MicroType,
  type Puzzle,
} from "./shared";

interface BotMem {
  round: number;
  /** When the bot submits its answer (null until answers open). */
  decideAt: number | null;
  /** Count flash: how many targets the bot counted while the field was showing. */
  counted: number | null;
  /** Memory: the arrows the bot watched. */
  seq: number[] | null;
  /** Number flash / what's missing: what the bot saw during the show. */
  saw: string | null;
  sawSet: string[] | null;
  /** Stop the clock: the moment the bot will press stop. */
  stopAt: number;
  /** Tap frenzy: taps per second for this round, and the last batch time. */
  rate: number;
  lastTap: number;
  owed: number;
  /** Green light: when the bot first saw green; and a planned false start (ms after the start) or null. */
  sawGo: number | null;
  jumpAt: number | null;
  react: number;
  /** Whack-a-mole: per mole, ms after it pops up that the bot whacks it (null = misses it). */
  whackPlan: (number | null)[] | null;
  whacked: number[];
  /** Spin stop: ms after the start the bot will stop (null until planned). */
  spinAt: number | null;
  /** Simon says: the bot decided to keep its hands off. */
  hold: boolean;
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
  simon: 0.75,
  gone: 0.65,
  shade: 0.75,
  lines: 0.75,
  digits: 0.65,
  spell: 0.7,
  rhyme: 0.75,
  dice: 0.75,
  next: 0.65,
  time: 0.7,
  spot: 0.7,
  flank: 0.8,
  notin: 0.8,
};
/** Extra think time (ms) for the chewier ones. */
const EXTRA_THINK: Partial<Record<MicroType, number>> = {
  bigger: 700,
  fruit: 1200,
  anagram: 800,
  pair: 600,
  memory: 400,
  spell: 600,
  next: 1000,
  time: 600,
  spot: 900,
  dice: 500,
  rhyme: 400,
  notin: 300,
};
/** Reflex games get a shorter think. */
const QUICK: readonly MicroType[] = ["simon", "flank", "shade", "lines", "ink"];

const CORRECT_SPELLINGS = new Set(SPELLINGS.map((w) => w[0]));

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
      saw: null,
      sawSet: null,
      // Usually within a few tenths of 5.00s, sometimes further out.
      stopAt: CLOCK_TARGET_MS + Math.round((ctx.random() + ctx.random() - 1) * 600),
      rate: 7 + ctx.random() * 5,
      lastTap: 0,
      owed: 0,
      sawGo: null,
      jumpAt: ctx.random() < 0.08 ? 400 + Math.round(ctx.random() * 2000) : null,
      react: 230 + Math.round(ctx.random() * 300),
      whackPlan: null,
      whacked: [],
      spinAt: null,
      hold: false,
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

/** The next number of a short sequence, by the first rule that fits. */
export const nextOf = (seq: number[]): number | null => nextFits(seq)[0] ?? null;

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
    case "simon":
      return pz.lead === "Simon says:" ? pz.ask : -1;
    case "gone":
      if (!m.sawSet || !pz.left || !pz.options) return -1;
      return pz.options.findIndex((o) => m.sawSet!.includes(o) && !pz.left!.includes(o));
    case "shade": {
      const pick = pz.ask === "dark" ? Math.min(...pz.cells) : Math.max(...pz.cells);
      return pz.cells.indexOf(pick);
    }
    case "lines": {
      const lens = pz.lines.map(([l]) => l);
      return lens.indexOf(pz.ask === "long" ? Math.max(...lens) : Math.min(...lens));
    }
    case "digits":
      return m.saw === null || !pz.options ? -1 : pz.options.indexOf(m.saw);
    case "spell":
      return pz.options.findIndex((o) => CORRECT_SPELLINGS.has(o));
    case "rhyme": {
      const g = RHYMES.find((x) => x.words.includes(pz.word));
      return g ? pz.options.findIndex((o) => o !== pz.word && g.words.includes(o)) : -1;
    }
    case "dice": {
      const [a, b] = pz.hands.map((h) => h.reduce((x, y) => x + y, 0));
      return a > b ? 0 : 1;
    }
    case "next": {
      const n = nextOf(pz.seq);
      return n === null ? -1 : pz.options.indexOf(n);
    }
    case "time":
      return pz.options.indexOf(fmtTime(pz.h, pz.m));
    case "spot":
      return pz.a.findIndex((e, i) => e !== pz.b[i]);
    case "flank":
      return pz.arrows[Math.floor(pz.arrows.length / 2)];
    case "notin": {
      const cat = CATEGORIES.find((c) => c.ask === pz.ask);
      return cat ? pz.options.findIndex((o) => !cat.members.includes(o)) : -1;
    }
    default:
      return -1;
  }
}

function choiceCount(pz: Puzzle): number {
  return pickRange(pz) || 4;
}

/** Spin stop: the first time (≥ `after` ms) the needle points at the zone centre. */
function spinHit(pz: Extract<Puzzle, { t: "spin" }>, after: number): number {
  const turn = ((((pz.zone - pz.start) * pz.dir) % 360) + 360) % 360;
  let t = (turn / 360) * pz.period;
  while (t < after) t += pz.period;
  return t;
}

export function botMove(s: BlitzState, v: BlitzView, botId: string, ctx: GameCtx): BlitzAction | null {
  const pz = v.puzzle;
  if (v.phase !== "play" || !pz || !v.micro || !v.you || v.opensAt === null) return null;
  const now = ctx.now();
  const r = v.round;
  const type = v.micro.type;
  const m = memOf(s, botId, r, ctx);

  // Watch the flash / the arrows / the number while they're on screen.
  if (pz.t === "count" && pz.field) m.counted = pz.field.filter(([e]) => e === pz.target).length;
  if (pz.t === "memory" && pz.seq) m.seq = pz.seq.slice();
  if (pz.t === "digits" && pz.num) m.saw = pz.num;
  if (pz.t === "gone" && pz.shown) m.sawSet = pz.shown.slice();
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

  if (pz.t === "whack") {
    // Each mole: usually whacked a beat after it pops up; bombs almost always left alone.
    m.whackPlan ??= pz.moles.map(([, up, down, bomb]) =>
      ctx.random() < (bomb ? 0.08 : 0.72) ? Math.min(down - up - 50, 260 + Math.round(ctx.random() * 260)) : null,
    );
    const t = now - v.opensAt;
    const i = pz.moles.findIndex(([, up, down], k) => {
      const after = m.whackPlan![k];
      return after !== null && !m.whacked.includes(k) && t >= up + after && t <= down;
    });
    if (i < 0) return null;
    m.whacked.push(i);
    return { type: "whack", r, i };
  }

  if (v.you.answered || m.hold) return null;

  if (type === "clock") return now - v.phaseAt >= m.stopAt ? { type: "stop", r, t: now } : null;

  if (pz.t === "green") {
    if (pz.go === null) return m.jumpAt !== null && now - v.phaseAt >= m.jumpAt ? { type: "hit", r } : null;
    m.sawGo ??= now;
    return now - m.sawGo >= m.react ? { type: "hit", r } : null;
  }

  if (pz.t === "spin") {
    if (m.spinAt === null) {
      const aim = spinHit(pz, 700 + randInt(ctx, 900));
      m.spinAt = aim + Math.round((ctx.random() + ctx.random() - 1) * pz.period * 0.06);
    }
    const at = v.opensAt + m.spinAt;
    return now >= at ? { type: "stop", r, t: at } : null;
  }

  if (m.decideAt === null) {
    const think = QUICK.includes(type) ? 450 + Math.round(ctx.random() * 900) : 700 + Math.round(ctx.random() * 1800);
    m.decideAt = now + think + (EXTRA_THINK[type] ?? 0);
  }
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
  if (pz.t === "simon" && right < 0) {
    // Simon didn't say: a good bot keeps still for the rest of the round.
    if (good) {
      m.hold = true;
      return null;
    }
    return { type: "pick", r, c: randInt(ctx, n) };
  }
  // Reverse: "right" for the bot means any wrong answer; a slip means tapping the real one.
  const reverse = v.micro.twist === "reverse";
  let c: number;
  if (right < 0) c = randInt(ctx, n);
  else if (reverse) c = good ? wrongOf(ctx, n, right) : right;
  else c = good ? right : wrongOf(ctx, n, right);
  return { type: "pick", r, c };
}
