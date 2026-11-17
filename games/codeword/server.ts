import { topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import { answerList, isGuessWord, pickAnswers } from "./dict";
import {
  AWAY_MS,
  BETWEEN_MS,
  LEN,
  MAX_GUESSES,
  READY_MS,
  WORD_MS,
  hardProblem,
  markGuess,
  wordScore,
  type BoardRow,
  type CodeView,
  type MyRun,
  type NoEvent,
  type WordResult,
} from "./shared";

export type { CodeAction, CodeView, CodeEvent } from "./shared";

// Code Word (a Ruckus original on the classic deduction game). Everyone races through the
// same secret five-letter words at their own pace: six guesses each, every guess coloured
// letter by letter. The server keeps the answers; a player only sees one after finishing it.

interface Run {
  idx: number;
  guesses: string[];
  marks: string[];
  startedAt: number;
  results: WordResult[];
  total: number;
  done: boolean;
  awaySince: number | null;
}

export interface CodeState {
  phase: "ready" | "play" | "over";
  startsAt: number;
  answers: string[];
  hard: boolean;
  ids: string[];
  runs: Record<string, Run>;
}

const GAME = "Code Word";
const RECENT_MAX = 300;

function nameOf(ctx: GameCtx, id: string): string {
  return ctx.player(id)?.name ?? "Someone";
}

function finishWord(s: CodeState, run: Run, ok: boolean, ctx: GameCtx) {
  const now = ctx.now();
  const used = Math.max(0, Math.min(WORD_MS, now - run.startedAt));
  const pts = wordScore(ok, run.guesses.length, used);
  run.results.push({
    ok,
    used: run.guesses.length,
    secs: Math.round(used / 1000),
    pts,
    answer: s.answers[run.idx],
    guesses: run.guesses,
    marks: run.marks,
  });
  run.total += pts;
  run.idx += 1;
  run.guesses = [];
  run.marks = [];
  if (run.idx >= s.answers.length) run.done = true;
  else run.startedAt = now + BETWEEN_MS;
}

function live(s: CodeState, run: Run | undefined, p: unknown, ctx: GameCtx): run is Run {
  return !!run && s.phase === "play" && !run.done && p === run.idx && ctx.now() >= run.startedAt;
}

function maybeEnd(s: CodeState, ctx: GameCtx): boolean {
  if (s.phase !== "play") return false;
  const now = ctx.now();
  const waiting = s.ids.some((id) => {
    const r = s.runs[id];
    return !r.done && (r.awaySince === null || now - r.awaySince < AWAY_MS);
  });
  if (waiting) return false;
  s.phase = "over";
  const n = s.answers.length;
  const scores: Record<string, number> = {};
  for (const id of s.ids) scores[id] = s.runs[id].total;
  const cracked = (id: string) => s.runs[id].results.filter((r) => r.ok).length;
  const winners = topScorers(scores);
  const of = `${n} word${n === 1 ? "" : "s"}`;
  let headline: string;
  if (s.ids.length === 1) {
    const id = s.ids[0];
    headline =
      cracked(id) > 0
        ? `${nameOf(ctx, id)} cracked ${cracked(id)} of ${of} for ${scores[id]} points`
        : `${nameOf(ctx, id)} didn't crack the code this time`;
  } else if (winners.length === 1) {
    const w = winners[0];
    headline = `${nameOf(ctx, w)} wins ${GAME} with ${scores[w]} points (${cracked(w)}/${n} cracked)`;
  } else if (winners.length > 1) {
    headline = `${winners.map((id) => nameOf(ctx, id)).join(" & ")} tie at ${GAME} on ${scores[winners[0]]} points`;
  } else {
    headline = "Nobody cracked a code word this time";
  }
  ctx.end({ winners, headline, scores });
  return true;
}

function toMyRun(s: CodeState, r: Run): MyRun {
  return {
    idx: r.idx,
    guesses: r.guesses,
    marks: r.marks,
    startedAt: r.startedAt,
    endsAt: r.startedAt + WORD_MS,
    results: r.results,
    total: r.total,
    done: r.done,
  };
}

// ---------- practice bot ----------

const botPlans = new WeakMap<CodeState, Map<string, { key: string; at: number }>>();
const OPENERS = ["crane", "slate", "trace", "stare", "raise", "arise", "least", "later", "heart", "point", "round", "story"];

/** Words still possible given what the bot has seen (its own colours, like a human). */
function consistent(words: string[], guesses: string[], marks: string[]): string[] {
  return words.filter((w) => guesses.every((g, i) => markGuess(g, w) === marks[i]));
}

/**
 * Medium bot: opens with a solid word, then guesses an everyday word that fits its hints,
 * but sometimes only respects the greens (a looser, human-ish guess). Thinks for a while.
 */
function botMove(s: CodeState, botId: string, ctx: GameCtx) {
  const run = s.runs[botId];
  if (!run || s.phase !== "play" || run.done) return null;
  const now = ctx.now();
  if (now < run.startedAt) return null;
  let plans = botPlans.get(s);
  if (!plans) botPlans.set(s, (plans = new Map()));
  const key = `${run.idx}:${run.guesses.length}`;
  const plan = plans.get(botId);
  if (!plan || plan.key !== key) {
    const first = run.guesses.length === 0 ? 2500 : 0;
    plans.set(botId, { key, at: now + first + 8000 + ctx.random() * 10000 });
    return null;
  }
  if (now < plan.at) return null;
  // Retry soon if this guess gets refused for some reason.
  plan.at = now + 3000;
  const pick = (arr: string[]) => arr[Math.min(arr.length - 1, Math.floor(ctx.random() * arr.length))];
  if (run.guesses.length === 0) return { type: "guess", p: run.idx, w: pick(OPENERS) };
  const all = answerList();
  const fits = consistent(all, run.guesses, run.marks).filter((w) => !run.guesses.includes(w));
  if (!s.hard && run.guesses.length < 4 && ctx.random() < 0.3) {
    const greensOnly = all.filter(
      (w) => !run.guesses.includes(w) && run.guesses.every((g, i) => [...g].every((ch, j) => run.marks[i][j] !== "2" || w[j] === ch)),
    );
    if (greensOnly.length) return { type: "guess", p: run.idx, w: pick(greensOnly) };
  }
  if (fits.length) return { type: "guess", p: run.idx, w: pick(fits) };
  return { type: "giveup", p: run.idx };
}

// ---------- the game ----------

export const codeword: GameDef<CodeState, unknown> = {
  id: "codeword",

  setup(ctx) {
    const set = readSettings(config.settings, ctx.settings);
    const count = [1, 3, 5].includes(Number(set.words)) ? Number(set.words) : 3;
    const hard = set.hard === "on";
    const mem = ctx.memory as { recent?: unknown };
    const recent = Array.isArray(mem.recent) ? (mem.recent.filter((x) => typeof x === "string") as string[]) : [];
    const answers = pickAnswers(count, ctx.random, new Set(recent));
    mem.recent = [...recent, ...answers].slice(-RECENT_MAX);
    const startsAt = ctx.now() + READY_MS;
    const ids = ctx.players.map((p) => p.id);
    const runs: Record<string, Run> = {};
    for (const id of ids) {
      runs[id] = {
        idx: 0,
        guesses: [],
        marks: [],
        startedAt: startsAt,
        results: [],
        total: 0,
        done: false,
        awaySince: ctx.player(id)?.connected === false ? ctx.now() : null,
      };
    }
    return { phase: "ready", startsAt, answers, hard, ids, runs };
  },

  action(s, playerId, raw, ctx) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
    const a = raw as Record<string, unknown>;
    const run = s.runs[playerId];
    if (!live(s, run, a.p, ctx)) return false;
    const answer = s.answers[run.idx];

    if (a.type === "guess") {
      if (typeof a.w !== "string" || a.w.length > 12) return false;
      const w = a.w.toLowerCase();
      const no = (why: NoEvent["why"], msg?: string) => {
        ctx.emit({ t: "no", w, why, msg } satisfies NoEvent, { to: playerId });
        return false;
      };
      if (w.length !== LEN || !/^[a-z]+$/.test(w)) return no("len");
      if (!isGuessWord(w)) return no("word");
      if (run.guesses.includes(w)) return no("used");
      if (s.hard) {
        const why = hardProblem(w, run.guesses, run.marks);
        if (why) return no("hard", why);
      }
      run.guesses = [...run.guesses, w];
      run.marks = [...run.marks, markGuess(w, answer)];
      if (w === answer) finishWord(s, run, true, ctx);
      else if (run.guesses.length >= MAX_GUESSES) finishWord(s, run, false, ctx);
      maybeEnd(s, ctx);
      return true;
    }
    if (a.type === "giveup") {
      finishWord(s, run, false, ctx);
      maybeEnd(s, ctx);
      return true;
    }
    return false;
  },

  tick(s, ctx) {
    if (s.phase === "over") return false;
    const now = ctx.now();
    let changed = false;
    if (s.phase === "ready") {
      if (now < s.startsAt) return false;
      s.phase = "play";
      changed = true;
    }
    for (const id of s.ids) {
      const run = s.runs[id];
      if (!run.done && now >= run.startedAt + WORD_MS) {
        finishWord(s, run, false, ctx);
        changed = true;
      }
    }
    return maybeEnd(s, ctx) || changed;
  },
  tickMs: 250,

  playerLeft(s, playerId, ctx) {
    const run = s.runs[playerId];
    if (run && run.awaySince === null) run.awaySince = ctx.now();
  },

  playerReturned(s, playerId) {
    const run = s.runs[playerId];
    if (run) run.awaySince = null;
  },

  bot(s, botId, ctx) {
    return botMove(s, botId, ctx);
  },

  view(s, viewerId): CodeView {
    const board: BoardRow[] = s.ids.map((id) => {
      const r = s.runs[id];
      return {
        id,
        idx: r.idx,
        rows: r.marks,
        total: r.total,
        past: r.results.map((x) => ({ ok: x.ok, used: x.used })),
        done: r.done,
      };
    });
    const mine = s.runs[viewerId];
    return {
      phase: s.phase,
      startsAt: s.startsAt,
      n: s.answers.length,
      hard: s.hard,
      board,
      me: mine ? toMyRun(s, mine) : null,
    };
  },
};

export default codeword;
