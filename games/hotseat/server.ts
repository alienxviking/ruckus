import type { GameCtx, GameDef } from "../../shared/game";
import { shuffle, topScorers } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import { QUESTIONS } from "./data";
import {
  ABANDON_MS,
  DRUM_MS,
  HOT_MAX,
  LONE_BONUS,
  PACES,
  READ_PTS,
  type HotAction,
  type HotAward,
  type HotPhase,
  type HotReveal,
  type HotView,
} from "./shared";

// Hot Seat: each round one player is in the hot seat and secretly picks their answer to a
// personal question; everyone else predicts it at the same time. A drumroll, the reveal,
// then a relaxed "talk it out" phase on the call. Right reads score 100; the hot seat
// scores for how well their friends know them.

export interface HotState {
  startedAt: number;
  ids: string[];
  /** Hot seat per round (player ids). */
  order: string[];
  qs: number[];
  round: number;
  phase: HotPhase;
  endsAt: number;
  pickMs: number;
  talkMs: number;
  answer: number | null;
  guesses: Record<string, number | null>;
  ready: Record<string, boolean>;
  score: Record<string, number>;
  reveal: HotReveal | null;
  /** Stats for awards. */
  reads: Record<string, number>;
  readOf: Record<string, { right: number; total: number }>;
  awards: HotAward[];
  lowSince: number | null;
  abandoned: boolean;
}

const MEMORY_CAP = 300;
const isHere = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const hotId = (s: HotState) => s.order[s.round];
const optCount = (s: HotState) => (QUESTIONS[s.qs[s.round]]?.length ?? 3) - 1;

function autoLaps(n: number): number {
  return n <= 3 ? 3 : n <= 6 ? 2 : 1;
}

function startRound(s: HotState, ctx: GameCtx) {
  // Skip hot seats who aren't here right now.
  while (s.round < s.order.length && !isHere(ctx, hotId(s))) s.round++;
  if (s.round >= s.order.length) return finish(s, ctx, false);
  s.phase = "pick";
  s.endsAt = ctx.now() + s.pickMs;
  s.answer = null;
  s.guesses = Object.fromEntries(s.ids.filter((id) => id !== hotId(s)).map((id) => [id, null]));
  s.ready = {};
  s.reveal = null;
  remember(s, ctx);
}

function remember(s: HotState, ctx: GameCtx) {
  const raw = Array.isArray(ctx.memory.used) ? (ctx.memory.used as unknown[]) : [];
  const used = raw.filter((x): x is number => Number.isInteger(x));
  used.push(s.qs[s.round]);
  ctx.memory.used = used.slice(-MEMORY_CAP);
}

function startDrum(s: HotState, ctx: GameCtx) {
  s.phase = "drum";
  s.endsAt = ctx.now() + DRUM_MS;
}

function startReveal(s: HotState, ctx: GameCtx) {
  const hot = hotId(s);
  const n = optCount(s);
  const counts = Array.from({ length: n }, () => 0);
  const pts: Record<string, number> = {};
  let predictors = 0;
  let right = 0;
  for (const [id, g] of Object.entries(s.guesses)) {
    pts[id] = 0;
    if (g === null) continue;
    counts[g]++;
    predictors++;
    if (s.answer !== null && g === s.answer) {
      right++;
      pts[id] = READ_PTS;
      s.reads[id] = (s.reads[id] ?? 0) + 1;
    }
  }
  let lone: string | null = null;
  if (right === 1 && predictors >= 3) {
    lone = Object.keys(s.guesses).find((id) => pts[id] > 0) ?? null;
    if (lone) pts[lone] += LONE_BONUS;
  }
  pts[hot] = s.answer !== null && predictors > 0 ? Math.round((HOT_MAX * right) / predictors) : 0;
  if (s.answer !== null && predictors > 0) {
    const r = s.readOf[hot] ?? { right: 0, total: 0 };
    s.readOf[hot] = { right: r.right + right, total: r.total + predictors };
  }
  for (const [id, p] of Object.entries(pts)) s.score[id] = (s.score[id] ?? 0) + p;
  s.reveal = { answer: s.answer, guesses: { ...s.guesses }, counts, pts, right, predictors, lone };
  s.phase = "reveal";
  s.endsAt = ctx.now() + s.talkMs;
  s.ready = {};
}

function nextRound(s: HotState, ctx: GameCtx) {
  s.round++;
  startRound(s, ctx);
}

function names(ids: string[], ctx: GameCtx): string {
  const n = ids.map((id) => ctx.player(id)?.name ?? "Someone");
  if (n.length <= 1) return n.join("");
  return `${n.slice(0, -1).join(", ")} & ${n[n.length - 1]}`;
}

function computeAwards(s: HotState): HotAward[] {
  const out: HotAward[] = [];
  const best = Math.max(0, ...Object.values(s.reads));
  if (best >= 2) {
    const ids = s.ids.filter((id) => s.reads[id] === best);
    if (ids.length <= 3) out.push({ icon: "🔮", title: "Mind reader", ids, note: `read ${best} hot seats right` });
  }
  const rated = s.ids.filter((id) => (s.readOf[id]?.total ?? 0) >= 2);
  if (rated.length >= 2) {
    const pct = (id: string) => s.readOf[id].right / s.readOf[id].total;
    const hi = Math.max(...rated.map(pct));
    const lo = Math.min(...rated.map(pct));
    if (hi > lo) {
      const open = rated.filter((id) => pct(id) === hi);
      const myst = rated.filter((id) => pct(id) === lo);
      if (open.length <= 3) out.push({ icon: "📖", title: "Open book", ids: open, note: `read right ${Math.round(hi * 100)}% of the time` });
      if (myst.length <= 3) out.push({ icon: "🕵️", title: "Total mystery", ids: myst, note: `read right ${Math.round(lo * 100)}% of the time` });
    }
  }
  return out;
}

function finish(s: HotState, ctx: GameCtx, abandoned: boolean) {
  if (s.phase === "final") return;
  s.phase = "final";
  s.abandoned = abandoned;
  s.endsAt = 0;
  s.reveal = null;
  s.lowSince = null;
  s.round = Math.min(s.round, s.order.length - 1);
  s.awards = computeAwards(s);
  const winners = topScorers(s.score);
  const top = winners.length ? s.score[winners[0]] : 0;
  let headline: string;
  if (!winners.length) headline = "Nobody read anybody. Total strangers!";
  else if (winners.length === 1) headline = `${names(winners, ctx)} knows this crew best with ${top} points`;
  else if (winners.length <= 3) headline = `${names(winners, ctx)} tie with ${top} points`;
  else headline = `${winners.length}-way tie at ${top} points`;
  if (abandoned) headline = `Not enough players left. ${headline}`;
  ctx.end({ winners, headline, scores: { ...s.score } });
}

/** Everyone who's here has picked (pick phase) or tapped Next (reveal). */
function everyoneDone(s: HotState, ctx: GameCtx): boolean {
  const hot = hotId(s);
  if (s.phase === "pick") {
    if (isHere(ctx, hot) && s.answer === null) return false;
    if (!isHere(ctx, hot) && s.answer === null) return true; // hot seat left without picking: void round
    return Object.keys(s.guesses).every((id) => !isHere(ctx, id) || s.guesses[id] !== null);
  }
  if (s.phase === "reveal") {
    const here = s.ids.filter((id) => isHere(ctx, id));
    return here.length > 0 && here.every((id) => s.ready[id]);
  }
  return false;
}

function advance(s: HotState, ctx: GameCtx) {
  if (s.phase === "pick") startDrum(s, ctx);
  else if (s.phase === "drum") startReveal(s, ctx);
  else if (s.phase === "reveal") nextRound(s, ctx);
}

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

export const hotseat: GameDef<HotState, HotAction> = {
  id: "hotseat",

  setup(ctx) {
    const set = readSettings(config.settings, ctx.settings);
    const ids = ctx.players.map((p) => p.id);
    const laps = set.laps === "auto" ? autoLaps(ids.length) : Math.max(1, Math.min(3, Number(set.laps) || 1));
    const [pickMs, talkMs] = PACES[String(set.pace)] ?? PACES.normal;
    const seatOrder = shuffle(ids, ctx.random);
    const order: string[] = [];
    for (let l = 0; l < laps; l++) order.push(...seatOrder);
    const raw = ctx.memory.used;
    const used = new Set(Array.isArray(raw) ? raw.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < QUESTIONS.length) : []);
    const fresh = QUESTIONS.map((_, i) => i).filter((i) => !used.has(i));
    const deck = [...shuffle(fresh, ctx.random), ...shuffle([...used], ctx.random)];
    const zeros = () => Object.fromEntries(ids.map((id) => [id, 0]));
    const s: HotState = {
      startedAt: ctx.now(),
      ids,
      order,
      qs: order.map((_, i) => deck[i % deck.length]),
      round: 0,
      phase: "pick",
      endsAt: 0,
      pickMs,
      talkMs,
      answer: null,
      guesses: {},
      ready: {},
      score: zeros(),
      reveal: null,
      reads: zeros(),
      readOf: {},
      awards: [],
      lowSince: null,
      abandoned: false,
    };
    startRound(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.phase === "final" || !s.ids.includes(playerId)) return false;
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as Record<string, unknown>;
    if (a.type === "pick") {
      if (s.phase !== "pick" || !isInt(a.o, 0, optCount(s) - 1)) return false;
      if (playerId === hotId(s)) {
        if (s.answer === a.o) return false;
        s.answer = a.o;
      } else {
        if (s.guesses[playerId] === a.o || !(playerId in s.guesses)) return false;
        s.guesses[playerId] = a.o;
      }
      if (everyoneDone(s, ctx)) advance(s, ctx);
      return true;
    }
    if (a.type === "next") {
      if (s.phase !== "reveal" || s.ready[playerId]) return false;
      s.ready[playerId] = true;
      // The hot seat can wrap up the conversation for everyone.
      if (playerId === hotId(s) || everyoneDone(s, ctx)) advance(s, ctx);
      return true;
    }
    return false;
  },

  tick(s, ctx) {
    if (s.phase === "final") return false;
    const now = ctx.now();
    let changed = false;
    const here = s.ids.filter((id) => isHere(ctx, id)).length;
    if (here < 2) {
      if (s.lowSince === null) {
        s.lowSince = now;
        changed = true;
      } else if (now - s.lowSince >= ABANDON_MS) {
        finish(s, ctx, true);
        return true;
      }
    } else if (s.lowSince !== null) {
      s.lowSince = null;
      changed = true;
    }
    if (now >= s.endsAt || everyoneDone(s, ctx)) {
      advance(s, ctx);
      return true;
    }
    return changed;
  },
  tickMs: 250,

  view(s, viewerId, ctx): HotView {
    const final = s.phase === "final";
    const q = QUESTIONS[s.qs[s.round]] ?? ["", ""];
    const hot = hotId(s) ?? s.ids[0];
    const isHot = viewerId === hot;
    let mine: number | null = null;
    if (!final && s.ids.includes(viewerId)) mine = isHot ? s.answer : (s.guesses[viewerId] ?? null);
    return {
      game: s.startedAt,
      phase: s.phase,
      round: s.round + 1,
      rounds: s.order.length,
      hot,
      next: s.order[s.round + 1] ?? null,
      q: q[0],
      opts: q.slice(1),
      endsAt: s.endsAt,
      phaseMs: s.phase === "pick" ? s.pickMs : s.phase === "reveal" ? s.talkMs : DRUM_MS,
      seats: s.ids.map((id) => ({
        id,
        score: s.score[id] ?? 0,
        done: id === hot ? s.answer !== null : s.guesses[id] != null,
        ready: !!s.ready[id],
        away: !isHere(ctx, id),
      })),
      mine,
      reveal: s.phase === "reveal" ? s.reveal : null,
      awards: final ? s.awards : [],
      endingAt: s.lowSince !== null && !final ? s.lowSince + ABANDON_MS : null,
      abandoned: s.abandoned,
    };
  },

  playerLeft(s, _id, ctx) {
    if (s.phase === "final") return;
    if (s.lowSince === null && s.ids.filter((id) => isHere(ctx, id)).length < 2) s.lowSince = ctx.now();
  },

  playerReturned(s, _id, ctx) {
    if (s.lowSince !== null && s.ids.filter((id) => isHere(ctx, id)).length >= 2) s.lowSince = null;
  },
};

export default hotseat;
