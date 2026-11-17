import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { botMove } from "./bot";
import { config } from "./config";
import { generateFresh, molePoints } from "./puzzles";
import {
  CLOCK_MAX_OFF_MS,
  CLOCK_SLACK_MS,
  CLOCK_TARGET_MS,
  FIXED_LENGTH,
  GREEN_FAST_MS,
  GREEN_SLOW_MS,
  INTRO_MS,
  LEVEL_SQUEEZE,
  MICRO_TYPES,
  PLAY_MS,
  READY_MS,
  REVERSIBLE,
  RESULT_MS,
  ROUNDS,
  SIMON_HOLD_POINTS,
  SPEED_SCALE,
  TAP_RATE,
  TWIST_READY_MS,
  WHACK_BOMB_PENALTY,
  WHACK_GRACE_MS,
  angleGap,
  finaleMult,
  fmtPoints,
  kindsFor,
  pickRange,
  rankPoints,
  spinAngle,
  type Finale,
  type MicroType,
  type Mix,
  type Pick,
  type Puzzle,
  type RecapEntry,
  type ResLine,
  type RoundResult,
  type Twist,
} from "./shared";

// Blitz: a run of microgames back to back (6, 12 or 18). Each one goes READY (title card, no
// puzzle in the view) -> PLAY (the puzzle; answers hidden) -> RESULT (everything
// revealed). Phases advance in tick() from absolute deadlines in state. Later microgames
// are harder and quicker, some carry a twist (reverse, speed up, double points), and the
// room remembers recent kinds and puzzles so back-to-back games feel different.

export type Phase = "intro" | "ready" | "play" | "result" | "final";

export type BlitzAction =
  | { type: "pick"; r: number; c: number }
  | { type: "pair"; r: number; a: number; b: number }
  | { type: "seq"; r: number; seq: number[] }
  | { type: "stop"; r: number; t: number }
  | { type: "taps"; r: number; n: number }
  | { type: "hit"; r: number }
  | { type: "whack"; r: number; i: number };

interface Answer {
  pick: Pick | null;
  /** Server time the answer arrived. */
  at: number;
  ok: boolean;
  /** Points already earned, before any rank scoring. */
  pts: number;
  /** Stop the clock: stopped ms after the start. Spin: needle angle. Green light: reaction ms. */
  v: number | null;
}

interface Current {
  type: MicroType;
  /** Points multiplier: finale (×2 / boss ×3) and the double-points twist. */
  mult: number;
  double: boolean;
  twist: Twist | null;
  boss: boolean;
  /** Difficulty 0..1. */
  level: number;
  pz: Puzzle;
  /** SECRET until RESULT. */
  answer: Pick | null;
  /** ms the puzzle is shown before answers open. */
  show: number;
  /** Green light: ms after PLAY starts when it turns green. SECRET. */
  goMs: number;
}

export interface BlitzState {
  ids: string[];
  /** Microgames in this match (host setting). */
  rounds: number;
  /** Answer-time multiplier (host setting: 1 normal, 1.5 relaxed). */
  pace: number;
  mix: Mix;
  finale: Finale;
  order: MicroType[];
  /** Twist per microgame, decided at setup. SECRET until each one's READY. */
  twists: (Twist | null)[];
  /** 1-based microgame number (0 during the intro). */
  round: number;
  phase: Phase;
  phaseAt: number;
  endsAt: number;
  /** PLAY: when answers open (after the count flash / memory show; else the PLAY start). */
  opensAt: number;
  /** PLAY: the flash/show stage is over and the view has switched to answering. */
  showOver: boolean;
  /** Green light: server time it turns green, whether that's been broadcast, and when. */
  goAt: number;
  goSent: boolean;
  goSentAt: number;
  cur: Current | null;
  answers: Record<string, Answer>;
  taps: Record<string, number>;
  /** Whack-a-mole: the moles (indexes) each player hit. */
  whacks: Record<string, number[]>;
  /** Tap frenzy: counts changed since the last broadcast. */
  tapsDirty: boolean;
  liveAt: number;
  scores: Record<string, number>;
  hits: Record<string, number>;
  last: RoundResult | null;
  recap: RecapEntry[];
  over: boolean;
}

export interface YouLine {
  /** Your own answer this microgame (PLAY), so a refresh keeps it locked. */
  pick: Pick | null;
  answered: boolean;
  /** Tap frenzy: taps the server counted for you. */
  taps: number;
}

export interface MicroNow {
  type: MicroType;
  double: boolean;
  mult: number;
  twist: Twist | null;
  boss: boolean;
}

export interface BlitzView {
  phase: Phase;
  round: number;
  total: number;
  mix: Mix;
  finale: Finale;
  endsAt: number;
  phaseAt: number;
  phaseMs: number;
  ids: string[];
  scores: Record<string, number>;
  hits: Record<string, number>;
  /** Microgame running now (ready/play/result). */
  micro: MicroNow | null;
  opensAt: number | null;
  /** PLAY and RESULT only. */
  puzzle: Puzzle | null;
  /** PLAY: who has answered (never what). */
  answered: string[];
  /** PLAY in tap frenzy: live tap counts. */
  live: Record<string, number> | null;
  you: YouLine | null;
  /** RESULT only: the answer and everyone's outcome. */
  last: RoundResult | null;
  recap: RecapEntry[];
}

const PAIR_CELLS = 16;
/** Tap batches bigger than this are junk (15/s × 200ms is 3; leave room for lag). */
const MAX_TAP_BATCH = 20;
/** A little burst allowance on top of the 15/s cap for network jitter. */
const TAP_BURST = 3;
/** Live tap race refresh rate. */
const LIVE_MS = 300;
/** Puzzle keys the room remembers (ctx.memory), so content doesn't come round again soon. */
const SEEN_CAP = 300;
/** Chance of a twist on an ordinary microgame. */
const TWIST_CHANCE: Record<Mix, number> = { all: 0.22, brainy: 0.2, reflex: 0.2, chaos: 0.45 };

/** Null-prototype record: player ids come from clients, so "__proto__" must stay a plain key. */
function dict<T>(ids: readonly string[] = [], init?: T): Record<string, T> {
  const d = Object.create(null) as Record<string, T>;
  if (init !== undefined) for (const id of ids) d[id] = init;
  return d;
}
const plain = <T>(rec: Record<string, T>): Record<string, T> => ({ ...rec });

const has = (rec: Record<string, unknown>, id: string) => Object.prototype.hasOwnProperty.call(rec, id);
const online = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const nameOf = (ctx: GameCtx, id: string) => ctx.player(id)?.name ?? "Someone";
const isInt = (v: unknown, lo: number, hi: number): v is number =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** A list of strings kept in the room's memory for this game (repaired if junk). */
function memList(ctx: GameCtx, key: string, cap: number): string[] {
  const raw = ctx.memory?.[key];
  const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(-cap) : [];
  if (ctx.memory) ctx.memory[key] = list;
  return list;
}

/**
 * A playing order with no type twice in a row, using every type in the pool before
 * repeating. Kinds the room played last game (`recent`) go to the back of the first bag.
 */
export function buildOrder(
  random: () => number,
  rounds = ROUNDS,
  pool: readonly MicroType[] = MICRO_TYPES,
  recent: readonly string[] = [],
): MicroType[] {
  const order: MicroType[] = [];
  let first = true;
  while (order.length < rounds) {
    let bag = first
      ? [
          ...shuffle(
            pool.filter((t) => !recent.includes(t)),
            random,
          ),
          ...shuffle(
            pool.filter((t) => recent.includes(t)),
            random,
          ),
        ]
      : shuffle([...pool], random);
    first = false;
    if (order.length && bag.length > 1 && bag[0] === order[order.length - 1]) bag = [...bag.slice(1), bag[0]];
    order.push(...bag);
  }
  return order.slice(0, rounds);
}

/** Twists a microgame can carry. Reverse is weighted up: it's the funniest. */
function twistsFor(type: MicroType): Twist[] {
  const out: Twist[] = ["double"];
  if (REVERSIBLE.includes(type)) out.push("reverse", "reverse", "reverse");
  if (!FIXED_LENGTH.includes(type)) out.push("speed");
  return out;
}

/** Which microgames get a twist: never the first, never two in a row, never on a finale round. */
export function planTwists(random: () => number, order: MicroType[], finale: Finale, mix: Mix): (Twist | null)[] {
  const rounds = order.length;
  const out: (Twist | null)[] = order.map(() => null);
  const eligible = (i: number) => i >= 1 && finaleMult(i + 1, rounds, finale) === 1;
  const pickFor = (i: number) => {
    const opts = twistsFor(order[i]);
    return opts[Math.floor(random() * opts.length)];
  };
  for (let i = 0; i < rounds; i++) {
    if (eligible(i) && !out[i - 1] && random() < TWIST_CHANCE[mix]) out[i] = pickFor(i);
  }
  // Every match of 6+ has at least one surprise.
  if (rounds >= 6 && !out.some(Boolean)) {
    const can = order.map((_, i) => i).filter(eligible);
    if (can.length) {
      const i = can[Math.floor(random() * can.length)];
      out[i] = pickFor(i);
    }
  }
  return out;
}

/** Difficulty of a microgame: 0 for the first, 1 for the last (chaos starts harder; the boss is maxed). */
export function levelOf(round: number, rounds: number, mix: Mix, boss: boolean): number {
  if (boss) return 1;
  const base = rounds > 1 ? (round - 1) / (rounds - 1) : 0;
  return Math.min(1, base + (mix === "chaos" ? 0.25 : 0));
}

/** PLAY length for a microgame (show + answering window). */
export function playLength(cur: Pick2<Current, "type" | "show" | "level" | "twist">, pace: number): number {
  const base = PLAY_MS[cur.type];
  if (FIXED_LENGTH.includes(cur.type)) return base;
  const scale = pace * (1 - LEVEL_SQUEEZE * cur.level) * (cur.twist === "speed" ? SPEED_SCALE : 1);
  return cur.show + Math.round((base - cur.show) * scale);
}
type Pick2<T, K extends keyof T> = { [P in K]: T[P] };

function toReady(s: BlitzState, ctx: GameCtx) {
  s.round += 1;
  const type = s.order[s.round - 1];
  const twist = s.twists[s.round - 1] ?? null;
  const boss = s.finale === "boss" && s.round === s.rounds;
  const level = levelOf(s.round, s.rounds, s.mix, boss);
  const g = generateFresh(type, ctx.random, level, memList(ctx, "seen", SEEN_CAP), SEEN_CAP);
  const mult = finaleMult(s.round, s.rounds, s.finale) * (twist === "double" ? 2 : 1);
  s.cur = {
    type,
    mult,
    double: mult > 1,
    twist,
    boss,
    level,
    pz: g.pz,
    answer: g.answer,
    show: g.show ?? 0,
    goMs: g.goMs ?? 0,
  };
  s.phase = "ready";
  s.phaseAt = ctx.now();
  s.endsAt = s.phaseAt + READY_MS + (twist || boss ? TWIST_READY_MS : 0);
  s.answers = dict();
  s.taps = dict();
  s.whacks = dict();
  s.last = null;
}

function toPlay(s: BlitzState, ctx: GameCtx) {
  const cur = s.cur!;
  const now = ctx.now();
  s.phase = "play";
  s.phaseAt = now;
  s.endsAt = now + playLength(cur, s.pace);
  s.opensAt = now + cur.show;
  s.showOver = s.opensAt <= now;
  s.goAt = now + cur.goMs;
  s.goSent = false;
  s.goSentAt = 0;
  s.answers = dict();
  s.taps = dict(s.ids, 0);
  s.whacks = dict();
  s.tapsDirty = false;
  s.liveAt = now;
}

/** Competition ranking (1, 1, 3...) of `metric` where `better(a, b)` is true when a beats b. */
function rank(ids: string[], metric: Record<string, number>, better: (a: number, b: number) => boolean): Record<string, number> {
  const out = dict<number>();
  for (const id of ids) out[id] = 1 + ids.filter((o) => better(metric[o], metric[id])).length;
  return out;
}

function toResult(s: BlitzState, ctx: GameCtx) {
  const cur = s.cur!;
  const mult = cur.mult;
  const res: ResLine[] = [];

  if (cur.type === "clock") {
    // Ranked by distance to the target in centiseconds (what the screen shows), within the cap.
    const off = dict<number>();
    const eligible: string[] = [];
    for (const id of s.ids) {
      const a = s.answers[id];
      if (!a || a.v === null) continue;
      off[id] = Math.round(Math.abs(a.v - CLOCK_TARGET_MS) / 10);
      if (off[id] * 10 <= CLOCK_MAX_OFF_MS) eligible.push(id);
    }
    const ranks = rank(eligible, off, (a, b) => a < b);
    for (const id of s.ids) {
      const a = has(s.answers, id) ? s.answers[id] : null;
      const r = has(ranks, id) ? ranks[id] : null;
      res.push({ id, ok: a ? r !== null : null, pts: r ? rankPoints(r) * mult : 0, pick: null, v: a?.v ?? null, rank: r, ms: null });
    }
  } else if (cur.type === "tap") {
    const eligible = s.ids.filter((id) => (s.taps[id] ?? 0) > 0);
    const ranks = rank(eligible, s.taps, (a, b) => a > b);
    for (const id of s.ids) {
      const n = s.taps[id] ?? 0;
      const r = has(ranks, id) ? ranks[id] : null;
      res.push({ id, ok: n > 0 ? true : null, pts: r ? rankPoints(r) * mult : 0, pick: null, v: n, rank: r, ms: null });
    }
  } else if (cur.pz.t === "whack") {
    const moles = cur.pz.moles;
    const total = moles.filter((m) => !m[3]).length;
    for (const id of s.ids) {
      const hit = has(s.whacks, id) ? s.whacks[id] : [];
      const good = hit.filter((i) => !moles[i][3]).length;
      const bombs = hit.length - good;
      const base = good >= total ? 200 : good * molePoints(total);
      const pts = Math.max(0, base - bombs * WHACK_BOMB_PENALTY) * mult;
      res.push({ id, ok: pts > 0 ? true : hit.length ? false : null, pts, pick: hit.slice(), v: good, rank: null, ms: null });
    }
  } else if (cur.type === "simon" && cur.answer === -1) {
    // Simon didn't say: everyone still here who kept their hands off scores.
    for (const id of s.ids) {
      const a = has(s.answers, id) ? s.answers[id] : null;
      const held = !a && online(ctx, id);
      res.push({
        id,
        ok: a ? false : held ? true : null,
        pts: held ? SIMON_HOLD_POINTS * mult : 0,
        pick: a ? a.pick : null,
        v: null,
        rank: null,
        ms: a ? Math.max(0, a.at - s.opensAt) : null,
      });
    }
  } else {
    for (const id of s.ids) {
      const a = has(s.answers, id) ? s.answers[id] : null;
      res.push({
        id,
        ok: a ? a.ok : null,
        pts: a ? a.pts : 0,
        pick: a ? a.pick : null,
        v: a ? a.v : null,
        rank: null,
        ms: a ? (cur.type === "green" ? a.v : Math.max(0, a.at - s.opensAt)) : null,
      });
    }
  }

  for (const line of res) {
    s.scores[line.id] = (s.scores[line.id] ?? 0) + line.pts;
    if (line.pts > 0) s.hits[line.id] = (s.hits[line.id] ?? 0) + 1;
  }
  const top = Math.max(0, ...res.map((l) => l.pts));
  s.recap.push({
    type: cur.type,
    double: cur.double,
    mult,
    twist: cur.twist,
    best: top > 0 ? res.filter((l) => l.pts === top).map((l) => l.id) : [],
    pts: top,
  });
  s.last = { type: cur.type, double: cur.double, mult, twist: cur.twist, answer: cur.answer, res };
  s.phase = "result";
  s.phaseAt = ctx.now();
  s.endsAt = s.phaseAt + RESULT_MS;
  s.tapsDirty = false;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function finish(s: BlitzState, ctx: GameCtx) {
  s.phase = "final";
  s.over = true;
  s.cur = null;
  s.phaseAt = ctx.now();
  s.endsAt = s.phaseAt;
  const scores = plain(s.scores);
  const winners = topScorers(scores);
  const best = winners.length ? scores[winners[0]] : 0;
  let headline: string;
  if (!winners.length) headline = "Blitz is over and nobody scored a point";
  else if (s.ids.length === 1) headline = `${nameOf(ctx, winners[0])} scored ${fmtPoints(best)} in a Blitz practice run`;
  else if (winners.length === 1) headline = `${nameOf(ctx, winners[0])} wins Blitz with ${fmtPoints(best)} points`;
  else headline = `${joinNames(winners.map((id) => nameOf(ctx, id)))} tie for the Blitz crown at ${fmtPoints(best)}`;
  ctx.end({ winners, headline, scores });
}

/** Microgames that always run their full time (nothing to "finish" early). */
const FULL_TIME: readonly MicroType[] = ["tap", "whack"];

/** Every connected player has answered. */
function allAnswered(s: BlitzState, ctx: GameCtx): boolean {
  if (!s.cur || FULL_TIME.includes(s.cur.type)) return false;
  const here = s.ids.filter((id) => online(ctx, id));
  return here.length > 0 && here.every((id) => has(s.answers, id));
}

/** 100 for a right answer plus up to 100 more for speed, times the multiplier. */
function speedPoints(s: BlitzState, at: number): number {
  const window = Math.max(1, s.endsAt - s.opensAt);
  const frac = Math.min(1, Math.max(0, (s.endsAt - at) / window));
  return (100 + Math.round(100 * frac)) * (s.cur?.mult ?? 1);
}

/** Green light: 200 for a reaction (incl. network) under GREEN_FAST_MS, down to 100 at GREEN_SLOW_MS. */
export function greenPoints(rt: number): number {
  const frac = Math.min(1, Math.max(0, (GREEN_SLOW_MS - rt) / (GREEN_SLOW_MS - GREEN_FAST_MS)));
  return 100 + Math.round(100 * frac);
}

/** Spin stop: 100 for landing in the zone plus up to 100 for how central. */
export function spinPoints(gap: number, width: number): number {
  const half = width / 2;
  if (gap > half) return 0;
  return 100 + Math.round(100 * (1 - gap / half));
}

function samePick(a: Pick, b: Pick | null): boolean {
  if (b === null) return false;
  if (typeof a === "number" || typeof b === "number") return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function record(s: BlitzState, id: string, pick: Pick, at: number) {
  const cur = s.cur!;
  const ok =
    cur.answer !== null &&
    (cur.twist === "reverse" && typeof pick === "number" ? pick !== cur.answer : samePick(pick, cur.answer));
  s.answers[id] = { pick, at, ok, pts: ok ? speedPoints(s, at) : 0, v: null };
}

/** A client's stop time, trusted only within a short window before it arrived and never before the start. */
function stopTime(s: BlitzState, now: number, t: number): number {
  return Math.max(s.phaseAt, Math.min(now, Math.max(now - CLOCK_SLACK_MS, t)));
}

export const blitz: GameDef<BlitzState, BlitzAction> = {
  id: "blitz",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const now = ctx.now();
    const set = readSettings(config.settings, ctx.settings);
    const rounds = set.rounds as number;
    const mix = set.mix as Mix;
    const finale = set.finale as Finale;
    // Kinds played last game go to the back of the queue, so the next match opens differently.
    const recent = memList(ctx, "kinds", MICRO_TYPES.length);
    const order = buildOrder(ctx.random, rounds, kindsFor(mix), recent);
    if (ctx.memory) ctx.memory.kinds = [...new Set(order)];
    return {
      ids,
      rounds,
      pace: set.pace === "relaxed" ? 1.5 : 1,
      mix,
      finale,
      order,
      twists: planTwists(ctx.random, order, finale, mix),
      round: 0,
      phase: "intro",
      phaseAt: now,
      endsAt: now + INTRO_MS,
      opensAt: now,
      showOver: true,
      goAt: 0,
      goSent: false,
      goSentAt: 0,
      cur: null,
      answers: dict(),
      taps: dict(),
      whacks: dict(),
      tapsDirty: false,
      liveAt: now,
      scores: dict(ids, 0),
      hits: dict(ids, 0),
      last: null,
      recap: [],
      over: false,
    };
  },

  action(s, playerId, action, ctx) {
    if (s.over || s.phase !== "play" || !s.cur) return false;
    if (!s.ids.includes(playerId)) return false;
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as Record<string, unknown>;
    if (a.r !== s.round) return false;
    const now = ctx.now();
    if (now >= s.endsAt || now < s.opensAt) return false;
    const cur = s.cur;
    const type = cur.type;

    if (a.type === "taps") {
      if (type !== "tap" || !isInt(a.n, 1, MAX_TAP_BATCH)) return false;
      const allowed = Math.min(
        Math.floor((TAP_RATE * PLAY_MS.tap) / 1000),
        Math.floor((TAP_RATE * (now - s.phaseAt)) / 1000) + TAP_BURST,
      );
      const before = s.taps[playerId] ?? 0;
      const after = Math.min(before + a.n, Math.max(before, allowed));
      if (after !== before) {
        s.taps[playerId] = after;
        s.tapsDirty = true;
      }
      // The live race goes out with the next tick; never one broadcast per batch.
      return false;
    }

    if (a.type === "whack") {
      if (cur.pz.t !== "whack" || !isInt(a.i, 0, cur.pz.moles.length - 1)) return false;
      const [, up, down] = cur.pz.moles[a.i];
      const t = now - s.opensAt;
      if (t < up || t > down + WHACK_GRACE_MS) return false;
      const mine = has(s.whacks, playerId) ? s.whacks[playerId] : (s.whacks[playerId] = []);
      if (!mine.includes(a.i)) mine.push(a.i);
      // Scored at the end; your own screen already shows the bonk.
      return false;
    }

    if (has(s.answers, playerId)) return false; // one answer per microgame

    switch (a.type) {
      case "pick": {
        const range = pickRange(cur.pz);
        if (range === 0 || !isInt(a.c, 0, range - 1)) return false;
        record(s, playerId, a.c, now);
        break;
      }
      case "pair": {
        if (type !== "pair" || !isInt(a.a, 0, PAIR_CELLS - 1) || !isInt(a.b, 0, PAIR_CELLS - 1) || a.a === a.b) return false;
        record(s, playerId, [Math.min(a.a, a.b), Math.max(a.a, a.b)], now);
        break;
      }
      case "seq": {
        if (cur.pz.t !== "memory") return false;
        const seq = a.seq;
        if (!Array.isArray(seq) || seq.length !== cur.pz.len || !seq.every((d) => isInt(d, 0, 3))) return false;
        record(s, playerId, seq.slice() as number[], now);
        break;
      }
      case "stop": {
        if (typeof a.t !== "number" || !Number.isFinite(a.t)) return false;
        const t = stopTime(s, now, a.t);
        if (type === "clock") {
          s.answers[playerId] = { pick: null, at: now, ok: false, pts: 0, v: t - s.phaseAt };
        } else if (cur.pz.t === "spin") {
          const angle = spinAngle(cur.pz, t - s.opensAt);
          const pts = spinPoints(angleGap(angle, cur.pz.zone), cur.pz.width);
          s.answers[playerId] = { pick: null, at: now, ok: pts > 0, pts: pts * cur.mult, v: Math.round(angle) };
        } else return false;
        break;
      }
      case "hit": {
        if (type !== "green") return false;
        // Before the green went out, nobody could have seen it: a false start.
        const rt = s.goSent ? now - s.goSentAt : null;
        s.answers[playerId] = {
          pick: null,
          at: now,
          ok: rt !== null,
          pts: rt !== null ? greenPoints(rt) * cur.mult : 0,
          v: rt,
        };
        break;
      }
      default:
        return false;
    }

    if (allAnswered(s, ctx)) toResult(s, ctx);
    return true;
  },

  tick(s, ctx) {
    if (s.over) return false;
    const now = ctx.now();
    if (s.phase === "play") {
      if (now >= s.endsAt || allAnswered(s, ctx)) {
        toResult(s, ctx);
        return true;
      }
      let changed = false;
      if (!s.showOver && now >= s.opensAt) {
        s.showOver = true;
        changed = true;
      }
      if (s.cur?.type === "green" && !s.goSent && now >= s.goAt) {
        s.goSent = true;
        s.goSentAt = now;
        changed = true;
      }
      if (s.tapsDirty && now - s.liveAt >= LIVE_MS) {
        s.tapsDirty = false;
        s.liveAt = now;
        changed = true;
      }
      return changed;
    }
    if (now < s.endsAt) return false;
    if (s.phase === "intro") toReady(s, ctx);
    else if (s.phase === "ready") toPlay(s, ctx);
    else if (s.phase === "result") {
      if (s.round >= s.rounds) finish(s, ctx);
      else toReady(s, ctx);
    }
    return true;
  },
  tickMs: 100,

  view(s, viewerId): BlitzView {
    const cur = s.cur;
    const playing = s.phase === "play";
    let puzzle: Puzzle | null = null;
    if (cur && (playing || s.phase === "result")) {
      const pz = cur.pz;
      puzzle = pz;
      if (playing) {
        if (pz.t === "count") puzzle = s.showOver ? { ...pz, field: null } : { ...pz, options: null };
        else if (pz.t === "memory" && s.showOver) puzzle = { ...pz, seq: null };
        else if (pz.t === "gone") puzzle = s.showOver ? { ...pz, shown: null } : { ...pz, left: null, options: null };
        else if (pz.t === "digits") puzzle = s.showOver ? { ...pz, num: null } : { ...pz, options: null };
        else if (pz.t === "green") puzzle = { ...pz, go: s.goSent ? s.goSentAt : null };
      } else if (pz.t === "green") puzzle = { ...pz, go: s.goSent ? s.goSentAt : s.goAt };
    }
    const isPlayer = s.ids.includes(viewerId);
    const mine = isPlayer && playing && has(s.answers, viewerId) ? s.answers[viewerId] : null;
    return {
      phase: s.phase,
      round: s.round,
      total: s.rounds,
      mix: s.mix,
      finale: s.finale,
      endsAt: s.endsAt,
      phaseAt: s.phaseAt,
      phaseMs: s.endsAt - s.phaseAt,
      ids: s.ids,
      scores: plain(s.scores),
      hits: plain(s.hits),
      micro:
        cur && s.phase !== "final"
          ? { type: cur.type, double: cur.double, mult: cur.mult, twist: cur.twist, boss: cur.boss }
          : null,
      opensAt: playing ? s.opensAt : null,
      puzzle,
      answered: playing ? s.ids.filter((id) => has(s.answers, id)) : [],
      live: playing && cur?.type === "tap" ? plain(s.taps) : null,
      you: isPlayer
        ? { pick: mine?.pick ?? null, answered: !!mine, taps: playing && cur?.type === "tap" ? (s.taps[viewerId] ?? 0) : 0 }
        : null,
      last: s.phase === "result" ? s.last : null,
      recap: s.recap,
    };
  },
};

blitz.bot = (s, botId, ctx) => {
  if (s.over || s.phase !== "play") return null;
  return botMove(s, blitz.view(s, botId, ctx) as BlitzView, botId, ctx);
};

export default blitz;
