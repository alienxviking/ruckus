import { topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import { makePuzzle, pickPuzzles, type Puzzle } from "./dict";
import {
  AWAY_MS,
  BETWEEN_MS,
  MAX_LEN,
  MIN_LEN,
  READY_MS,
  usesAll,
  wordPoints,
  type MyWheel,
  type NoEvent,
  type OkEvent,
  type SevenEvent,
  type WheelRow,
  type WheelView,
} from "./shared";

export type { WheelAction, WheelView, WheelEvent } from "./shared";

// Word Wheel (a Ruckus original on the classic letter-wheel puzzle). Seven letters, one in
// the middle that every word must use. Everyone plays the same wheel against the same clock;
// the board shows counts and points, never words. Missed words are revealed at the end.

interface Seat {
  /** Words found, per puzzle. */
  found: string[][];
  pts: number[];
  finished: boolean;
  awaySince: number | null;
}

export interface WheelState {
  phase: "ready" | "play" | "between" | "over";
  round: number;
  puzzles: Puzzle[];
  roundMs: number;
  /** Current puzzle's clock (or, between puzzles, when the next one starts). */
  startsAt: number;
  endsAt: number;
  ids: string[];
  seats: Record<string, Seat>;
}

const GAME = "Word Wheel";
const RECENT_MAX = 120;

function nameOf(ctx: GameCtx, id: string): string {
  return ctx.player(id)?.name ?? "Someone";
}

const letters = (pz: Puzzle) => pz.centre + pz.ring.join("");
const sum = (a: number[]) => a.reduce((t, x) => t + x, 0);

function endRound(s: WheelState, ctx: GameCtx) {
  const now = ctx.now();
  if (s.round + 1 >= s.puzzles.length) {
    s.phase = "over";
    s.endsAt = now;
    const scores: Record<string, number> = {};
    const words = (id: string) => sum(s.seats[id].found.map((f) => f.length));
    for (const id of s.ids) scores[id] = sum(s.seats[id].pts);
    const winners = topScorers(scores);
    let headline: string;
    if (s.ids.length === 1) {
      const id = s.ids[0];
      headline = words(id)
        ? `${nameOf(ctx, id)} found ${words(id)} word${words(id) === 1 ? "" : "s"} for ${scores[id]} points`
        : `${nameOf(ctx, id)} didn't find a word this time`;
    } else if (winners.length === 1) {
      headline = `${nameOf(ctx, winners[0])} wins ${GAME} with ${scores[winners[0]]} points (${words(winners[0])} words)`;
    } else if (winners.length > 1) {
      headline = `${winners.map((id) => nameOf(ctx, id)).join(" & ")} tie at ${GAME} on ${scores[winners[0]]} points`;
    } else {
      headline = "Nobody found a word this time";
    }
    ctx.end({ winners, headline, scores });
    return;
  }
  s.phase = "between";
  s.startsAt = now + BETWEEN_MS;
  s.endsAt = s.startsAt + s.roundMs;
}

/** Everyone still here (bots aside) has pressed "I'm done". */
function allFinished(s: WheelState, ctx: GameCtx): boolean {
  const now = ctx.now();
  const blocking = s.ids.filter((id) => {
    const seat = s.seats[id];
    if (ctx.player(id)?.bot) return false;
    return seat.awaySince === null || now - seat.awaySince < AWAY_MS;
  });
  return blocking.length > 0 && blocking.every((id) => s.seats[id].finished);
}

// ---------- practice bot ----------

const botPlans = new WeakMap<WheelState, Map<string, { key: string; at: number }>>();

/**
 * A human-paced word finder: every 5-12 seconds (slowing down as the easy ones run out) it
 * plays a word it hasn't found, leaning hard towards the commonest ones.
 */
function botMove(s: WheelState, botId: string, ctx: GameCtx) {
  const seat = s.seats[botId];
  if (!seat || s.phase !== "play") return null;
  const now = ctx.now();
  if (now < s.startsAt) return null;
  let plans = botPlans.get(s);
  if (!plans) botPlans.set(s, (plans = new Map()));
  const found = seat.found[s.round];
  const key = `${s.round}:${found.length}`;
  const plan = plans.get(botId);
  if (!plan || plan.key !== key) {
    const first = found.length === 0 ? 3000 : 0;
    plans.set(botId, { key, at: now + first + (5000 + ctx.random() * 7000) * (1 + found.length / 18) });
    return null;
  }
  if (now < plan.at) return null;
  plan.at = now + 4000;
  const left = s.puzzles[s.round].answers.filter((w) => !found.includes(w));
  if (!left.length) return null;
  const r = ctx.random();
  return { type: "word", r: s.round, w: left[Math.min(left.length - 1, Math.floor(r * r * r * left.length))] };
}

// ---------- the game ----------

export const wordwheel: GameDef<WheelState, unknown> = {
  id: "wordwheel",

  setup(ctx) {
    const set = readSettings(config.settings, ctx.settings);
    const rounds = [1, 2, 3].includes(Number(set.rounds)) ? Number(set.rounds) : 1;
    const roundMs = [120, 180, 300].includes(Number(set.time)) ? Number(set.time) * 1000 : 180_000;
    const mem = ctx.memory as { recent?: unknown };
    const recent = Array.isArray(mem.recent) ? (mem.recent.filter((x) => typeof x === "number") as number[]) : [];
    const ids = pickPuzzles(rounds, ctx.random, new Set(recent));
    mem.recent = [...recent, ...ids].slice(-RECENT_MAX);
    const puzzles = ids.map((id) => makePuzzle(id, ctx.random));
    const startsAt = ctx.now() + READY_MS;
    const players = ctx.players.map((p) => p.id);
    const seats: Record<string, Seat> = {};
    for (const id of players) {
      seats[id] = {
        found: puzzles.map(() => []),
        pts: puzzles.map(() => 0),
        finished: false,
        awaySince: ctx.player(id)?.connected === false ? ctx.now() : null,
      };
    }
    return { phase: "ready", round: 0, puzzles, roundMs, startsAt, endsAt: startsAt + roundMs, ids: players, seats };
  },

  action(s, playerId, raw, ctx) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
    const a = raw as Record<string, unknown>;
    const seat = s.seats[playerId];
    if (!seat || s.phase !== "play" || a.r !== s.round || ctx.now() < s.startsAt) return false;
    const pz = s.puzzles[s.round];

    if (a.type === "word") {
      if (typeof a.w !== "string" || a.w.length > MAX_LEN * 2) return false;
      if (seat.finished) return false;
      const w = a.w.toLowerCase().trim();
      const no = (why: NoEvent["why"]) => {
        ctx.emit({ t: "no", w: w.slice(0, MAX_LEN), why } satisfies NoEvent, { to: playerId });
        return false;
      };
      if (!/^[a-z]+$/.test(w) || w.length > MAX_LEN) return no("letters");
      const all = letters(pz);
      if (![...w].every((c) => all.includes(c))) return no("letters");
      if (w.length < MIN_LEN) return no("short");
      if (!w.includes(pz.centre)) return no("centre");
      const found = seat.found[s.round];
      if (found.includes(w)) return no("dup");
      if (!pz.answers.includes(w)) return no("word");
      const pts = wordPoints(w, all);
      found.push(w);
      seat.pts[s.round] += pts;
      const seven = usesAll(w, all);
      ctx.emit({ t: "ok", w, pts, seven } satisfies OkEvent, { to: playerId });
      if (seven) ctx.emit({ t: "seven", id: playerId } satisfies SevenEvent, { except: playerId });
      return true;
    }
    if (a.type === "finish") {
      if (seat.finished) return false;
      seat.finished = true;
      if (allFinished(s, ctx)) endRound(s, ctx);
      return true;
    }
    return false;
  },

  tick(s, ctx) {
    const now = ctx.now();
    if (s.phase === "ready" || s.phase === "between") {
      if (now < s.startsAt) return false;
      if (s.phase === "between") {
        s.round += 1;
        for (const id of s.ids) s.seats[id].finished = false;
      }
      s.phase = "play";
      return true;
    }
    if (s.phase === "play" && (now >= s.endsAt || allFinished(s, ctx))) {
      endRound(s, ctx);
      return true;
    }
    return false;
  },
  tickMs: 250,

  playerLeft(s, playerId, ctx) {
    const seat = s.seats[playerId];
    if (seat && seat.awaySince === null) seat.awaySince = ctx.now();
  },

  playerReturned(s, playerId) {
    const seat = s.seats[playerId];
    if (seat) seat.awaySince = null;
  },

  bot(s, botId, ctx) {
    return botMove(s, botId, ctx);
  },

  view(s, viewerId): WheelView {
    const pz = s.puzzles[s.round];
    const all = letters(pz);
    const r = s.round;
    const board: WheelRow[] = s.ids.map((id) => {
      const seat = s.seats[id];
      return {
        id,
        words: seat.found[r].length,
        pts: seat.pts[r],
        total: sum(seat.pts),
        finished: seat.finished,
        seven: seat.found[r].some((w) => usesAll(w, all)),
      };
    });
    const seat = s.seats[viewerId];
    const me: MyWheel | null = seat
      ? {
          found: seat.found[r],
          pts: seat.pts[r],
          total: sum(seat.pts),
          finished: seat.finished,
          history: s.puzzles.slice(0, s.phase === "play" || s.phase === "ready" ? r : r + 1).map((_, i) => ({ words: seat.found[i].length, pts: seat.pts[i] })),
        }
      : null;
    const ended = s.phase === "between" || s.phase === "over";
    return {
      phase: s.phase,
      round: r,
      rounds: s.puzzles.length,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      roundMs: s.roundMs,
      centre: pz.centre,
      ring: pz.ring,
      count: pz.answers.length,
      maxPts: sum(pz.answers.map((w) => wordPoints(w, all))),
      sevens: pz.answers.filter((w) => usesAll(w, all)).length,
      me,
      board,
      answers: ended ? pz.answers : null,
    };
  },
};

export default wordwheel;
