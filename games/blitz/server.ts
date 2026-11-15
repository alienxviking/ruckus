import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { generate } from "./puzzles";
import {
  CLOCK_MAX_OFF_MS,
  CLOCK_SLACK_MS,
  CLOCK_TARGET_MS,
  COUNT_SHOW_MS,
  DOUBLE_LAST,
  INTRO_MS,
  MEMO_LEAD_MS,
  MEMO_STEP_MS,
  MICRO_TYPES,
  PLAY_MS,
  READY_MS,
  RESULT_MS,
  ROUNDS,
  TAP_RATE,
  fmtPoints,
  rankPoints,
  type MicroType,
  type Pick,
  type Puzzle,
  type RecapEntry,
  type ResLine,
  type RoundResult,
} from "./shared";

// Blitz: twelve microgames back to back. Each one goes READY (title card, no
// puzzle in the view) -> PLAY (the puzzle; answers hidden) -> RESULT (everything
// revealed). Phases advance in tick() from absolute deadlines in state.

export type Phase = "intro" | "ready" | "play" | "result" | "final";

export type BlitzAction =
  | { type: "pick"; r: number; c: number }
  | { type: "pair"; r: number; a: number; b: number }
  | { type: "seq"; r: number; seq: number[] }
  | { type: "stop"; r: number; t: number }
  | { type: "taps"; r: number; n: number };

interface Answer {
  pick: Pick | null;
  /** Server time the answer arrived. */
  at: number;
  ok: boolean;
  /** Points already earned (choice games), before any rank scoring. */
  pts: number;
  /** Stop the clock: stopped time in ms after the start. */
  v: number | null;
}

interface Current {
  type: MicroType;
  double: boolean;
  pz: Puzzle;
  /** SECRET until RESULT. */
  answer: Pick | null;
}

export interface BlitzState {
  ids: string[];
  order: MicroType[];
  /** 1-based microgame number (0 during the intro). */
  round: number;
  phase: Phase;
  phaseAt: number;
  endsAt: number;
  /** PLAY: when answers open (after the count flash / memory show; else the PLAY start). */
  opensAt: number;
  /** PLAY: the flash/show stage is over and the view has switched to answering. */
  showOver: boolean;
  cur: Current | null;
  answers: Record<string, Answer>;
  taps: Record<string, number>;
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

export interface BlitzView {
  phase: Phase;
  round: number;
  total: number;
  endsAt: number;
  phaseAt: number;
  phaseMs: number;
  ids: string[];
  scores: Record<string, number>;
  hits: Record<string, number>;
  /** Microgame running now (ready/play/result). */
  micro: { type: MicroType; double: boolean } | null;
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

/** Choices accepted by "pick" per microgame (exclusive upper bound). */
const PICK_RANGE: Partial<Record<MicroType, number>> = {
  odd: 25,
  count: 4,
  math: 4,
  ink: 4,
  bigger: 2,
  arrows: 4,
  anagram: 4,
  fruit: 4,
};
const PAIR_CELLS = 16;
/** Tap batches bigger than this are junk (15/s × 200ms is 3; leave room for lag). */
const MAX_TAP_BATCH = 20;
/** A little burst allowance on top of the 15/s cap for network jitter. */
const TAP_BURST = 3;
/** Live tap race refresh rate. */
const LIVE_MS = 300;

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

export function isDouble(round: number) {
  return round > ROUNDS - DOUBLE_LAST;
}

/** A playing order with no type twice in a row, using every type before repeating. */
export function buildOrder(random: () => number, rounds = ROUNDS): MicroType[] {
  const order: MicroType[] = [];
  while (order.length < rounds) {
    let bag = shuffle([...MICRO_TYPES], random);
    if (order.length && bag[0] === order[order.length - 1]) bag = [...bag.slice(1), bag[0]];
    order.push(...bag);
  }
  return order.slice(0, rounds);
}

function showMs(cur: Current): number {
  if (cur.type === "count") return COUNT_SHOW_MS;
  if (cur.type === "memory" && cur.pz.t === "memory") return MEMO_LEAD_MS + cur.pz.len * MEMO_STEP_MS;
  return 0;
}

function toReady(s: BlitzState, ctx: GameCtx) {
  s.round += 1;
  const type = s.order[s.round - 1];
  const g = generate(type, ctx.random);
  s.cur = { type, double: isDouble(s.round), pz: g.pz, answer: g.answer };
  s.phase = "ready";
  s.phaseAt = ctx.now();
  s.endsAt = s.phaseAt + READY_MS;
  s.answers = dict();
  s.taps = dict();
  s.last = null;
}

function toPlay(s: BlitzState, ctx: GameCtx) {
  const cur = s.cur!;
  const now = ctx.now();
  s.phase = "play";
  s.phaseAt = now;
  s.endsAt = now + PLAY_MS[cur.type];
  s.opensAt = now + showMs(cur);
  s.showOver = s.opensAt <= now;
  s.answers = dict();
  s.taps = dict(s.ids, 0);
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
  const mult = cur.double ? 2 : 1;
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
      res.push({
        id,
        ok: a ? r !== null : null,
        pts: r ? rankPoints(r) * mult : 0,
        pick: null,
        v: a?.v ?? null,
        rank: r,
        ms: null,
      });
    }
  } else if (cur.type === "tap") {
    const eligible = s.ids.filter((id) => (s.taps[id] ?? 0) > 0);
    const ranks = rank(eligible, s.taps, (a, b) => a > b);
    for (const id of s.ids) {
      const n = s.taps[id] ?? 0;
      const r = has(ranks, id) ? ranks[id] : null;
      res.push({ id, ok: n > 0 ? true : null, pts: r ? rankPoints(r) * mult : 0, pick: null, v: n, rank: r, ms: null });
    }
  } else {
    for (const id of s.ids) {
      const a = has(s.answers, id) ? s.answers[id] : null;
      res.push({
        id,
        ok: a ? a.ok : null,
        pts: a ? a.pts : 0,
        pick: a ? a.pick : null,
        v: null,
        rank: null,
        ms: a ? Math.max(0, a.at - s.opensAt) : null,
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
    best: top > 0 ? res.filter((l) => l.pts === top).map((l) => l.id) : [],
    pts: top,
  });
  s.last = { type: cur.type, double: cur.double, answer: cur.answer, res };
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

/** Every connected player has answered (tap frenzy always runs the full time). */
function allAnswered(s: BlitzState, ctx: GameCtx): boolean {
  if (!s.cur || s.cur.type === "tap") return false;
  const here = s.ids.filter((id) => online(ctx, id));
  return here.length > 0 && here.every((id) => has(s.answers, id));
}

/** 100 for a right answer plus up to 100 more for speed; doubled at the end. */
function speedPoints(s: BlitzState, at: number): number {
  const window = Math.max(1, s.endsAt - s.opensAt);
  const frac = Math.min(1, Math.max(0, (s.endsAt - at) / window));
  return (100 + Math.round(100 * frac)) * (s.cur?.double ? 2 : 1);
}

function samePick(a: Pick, b: Pick | null): boolean {
  if (b === null) return false;
  if (typeof a === "number" || typeof b === "number") return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function record(s: BlitzState, id: string, pick: Pick | null, at: number, v: number | null = null) {
  const ok = pick !== null && s.cur!.answer !== null && samePick(pick, s.cur!.answer);
  s.answers[id] = { pick, at, ok, pts: ok ? speedPoints(s, at) : 0, v };
}

export const blitz: GameDef<BlitzState, BlitzAction> = {
  id: "blitz",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const now = ctx.now();
    return {
      ids,
      order: buildOrder(ctx.random),
      round: 0,
      phase: "intro",
      phaseAt: now,
      endsAt: now + INTRO_MS,
      opensAt: now,
      showOver: true,
      cur: null,
      answers: dict(),
      taps: dict(),
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
    const type = s.cur.type;

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

    if (has(s.answers, playerId)) return false; // one answer per microgame

    switch (a.type) {
      case "pick": {
        const range = PICK_RANGE[type];
        if (range === undefined || !isInt(a.c, 0, range - 1)) return false;
        record(s, playerId, a.c, now);
        break;
      }
      case "pair": {
        if (type !== "pair" || !isInt(a.a, 0, PAIR_CELLS - 1) || !isInt(a.b, 0, PAIR_CELLS - 1) || a.a === a.b) return false;
        record(s, playerId, [Math.min(a.a, a.b), Math.max(a.a, a.b)], now);
        break;
      }
      case "seq": {
        if (type !== "memory" || s.cur.pz.t !== "memory") return false;
        const seq = a.seq;
        if (!Array.isArray(seq) || seq.length !== s.cur.pz.len || !seq.every((d) => isInt(d, 0, 3))) return false;
        record(s, playerId, seq.slice() as number[], now);
        break;
      }
      case "stop": {
        if (type !== "clock" || typeof a.t !== "number" || !Number.isFinite(a.t)) return false;
        // Trust the client's tap time only within a short window before it arrived, and never before the start.
        const t = Math.max(s.phaseAt, Math.min(now, Math.max(now - CLOCK_SLACK_MS, a.t)));
        s.answers[playerId] = { pick: null, at: now, ok: false, pts: 0, v: t - s.phaseAt };
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
      if (s.round >= ROUNDS) finish(s, ctx);
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
      puzzle = cur.pz;
      if (playing && cur.pz.t === "count") {
        puzzle = s.showOver ? { ...cur.pz, field: null } : { ...cur.pz, options: null };
      } else if (playing && cur.pz.t === "memory" && s.showOver) {
        puzzle = { ...cur.pz, seq: null };
      }
    }
    const isPlayer = s.ids.includes(viewerId);
    const mine = isPlayer && playing && has(s.answers, viewerId) ? s.answers[viewerId] : null;
    return {
      phase: s.phase,
      round: s.round,
      total: ROUNDS,
      endsAt: s.endsAt,
      phaseAt: s.phaseAt,
      phaseMs: s.endsAt - s.phaseAt,
      ids: s.ids,
      scores: plain(s.scores),
      hits: plain(s.hits),
      micro: cur && s.phase !== "final" ? { type: cur.type, double: cur.double } : null,
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

export default blitz;
