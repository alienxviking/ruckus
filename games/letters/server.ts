import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { CATEGORIES } from "./data";
import {
  ANSWER_MS,
  CATEGORIES_PER_ROUND,
  LETTERS,
  MAX_ANSWER,
  MIN_PLAYERS,
  REJOIN_MS,
  RESULTS_MS,
  REVIEW_MS,
  ROUNDS,
  SHARED_POINTS,
  UNIQUE_POINTS,
  answerKey,
  autoVerdict,
  type AutoVerdict,
  type Award,
  type Cell,
  type CellStatus,
  type LettersView,
  type LiveCell,
  type Phase,
  type RoundSummary,
} from "./shared";

// Letter Rush: one letter, six categories, three rounds.
//   answer (90s, ends early when every connected player is done)
//   -> review (60s, players veto each other's answers; ends early when all say "Looks good")
//   -> results (6s) -> next round ... -> final (ctx.end).
// Per-player data lives in arrays aligned with `order` (the participants), so
// client-chosen ids are never used as object keys.

export type { LettersAction, LettersView } from "./shared";

/** Anything longer than this is not a typo, it's an attack: reject before sanitizing. */
const MAX_RAW = 400;
/** Control chars, soft hyphen, zero-width chars and bidi overrides: invisible, so only trouble. */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

export interface LettersState {
  order: string[];
  /** Letter and categories for every round, picked up front so nothing repeats. Never sent to clients. */
  plan: { letter: string; categories: string[] }[];
  phase: Phase;
  /** 0-based index into `plan`. */
  round: number;
  endsAt: number | null;
  phaseMs: number;
  /** answers[player][category] */
  answers: string[][];
  activeAt: number[];
  done: boolean[];
  doneAt: number[];
  ready: boolean[];
  /** vetoes[author][category] = indices of the players vetoing that answer. */
  vetoes: number[][][];
  /** Letter checks and duplicate keys, computed once when answers freeze. */
  auto: AutoVerdict[][];
  keys: string[][];
  scores: number[];
  /** Rounds in which each player was first to press Done. */
  firstDone: number[];
  history: RoundSummary[];
  awards: Award[];
  waiting: boolean;
  endedEarly: boolean;
}

export function cleanAnswer(raw: string): string {
  // Whitespace (tabs, newlines, odd Unicode spaces) becomes one space; then invisibles go.
  const t = raw.replace(/\s+/g, " ").replace(INVISIBLE, "").replace(/ {2,}/g, " ").trim();
  // Cap by code point so an emoji is never cut in half.
  return Array.from(t).slice(0, MAX_ANSWER).join("").trim();
}

const isConnected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected === true;

function onlineCount(s: LettersState, ctx: GameCtx): number {
  return s.order.filter((id) => isConnected(ctx, id)).length;
}

/** True when at least one participant is online and every online one has the flag set. */
function everyoneOnline(s: LettersState, ctx: GameCtx, flags: boolean[]): boolean {
  let online = 0;
  for (let k = 0; k < s.order.length; k++) {
    if (!isConnected(ctx, s.order[k])) continue;
    online++;
    if (!flags[k]) return false;
  }
  return online > 0;
}

const isCategoryIndex = (i: unknown): i is number =>
  typeof i === "number" && Number.isInteger(i) && i >= 0 && i < CATEGORIES_PER_ROUND;

function startRound(s: LettersState, ctx: GameCtx, round: number) {
  const blank = <T>(make: () => T) => s.order.map(make);
  s.round = round;
  s.phase = "answer";
  s.phaseMs = ANSWER_MS;
  s.endsAt = ctx.now() + ANSWER_MS;
  s.answers = blank(() => Array<string>(CATEGORIES_PER_ROUND).fill(""));
  s.activeAt = blank(() => 0);
  s.done = blank(() => false);
  s.doneAt = blank(() => 0);
  s.ready = blank(() => false);
  s.vetoes = blank(() => Array.from({ length: CATEGORIES_PER_ROUND }, () => [] as number[]));
  s.auto = [];
  s.keys = [];
  s.waiting = false;
}

function toReview(s: LettersState, ctx: GameCtx) {
  let first = -1;
  for (let k = 0; k < s.order.length; k++) {
    if (s.done[k] && (first < 0 || s.doneAt[k] < s.doneAt[first])) first = k;
  }
  if (first >= 0) s.firstDone[first] += 1;
  const { letter } = s.plan[s.round];
  s.auto = s.answers.map((row) => row.map((text) => autoVerdict(text, letter)));
  s.keys = s.answers.map((row) => row.map((text) => answerKey(text)));
  s.phase = "review";
  s.phaseMs = REVIEW_MS;
  s.endsAt = ctx.now() + REVIEW_MS;
  s.ready = s.order.map(() => false);
}

/**
 * Score the current round as it stands. An answer is rejected once its vetoes reach
 * half of the other online participants (rounded up, minimum 1). Valid answers score
 * 10, or 5 when another player gave the same (still valid) answer.
 */
function judge(s: LettersState, ctx: GameCtx): { cells: Cell[][]; need: number[] } {
  const online = s.order.map((id) => isConnected(ctx, id));
  const onlineTotal = online.filter(Boolean).length;
  const need = online.map((on) => Math.max(1, Math.ceil((onlineTotal - (on ? 1 : 0)) / 2)));
  const cells = s.plan[s.round].categories.map((_, ci) => {
    const row: Cell[] = s.order.map((_, k) => {
      const auto = s.auto[k][ci];
      const vetoes = s.vetoes[k][ci].length;
      const status: CellStatus = auto !== "ok" ? auto : vetoes >= need[k] ? "vetoed" : "unique";
      return { text: s.answers[k][ci], status, points: 0, vetoes, same: [] };
    });
    const valid = row.map((c) => c.status === "unique");
    row.forEach((cell, k) => {
      if (!valid[k]) return;
      cell.same = row.flatMap((_, j) => (j !== k && valid[j] && s.keys[j][ci] === s.keys[k][ci] ? [j] : []));
      cell.status = cell.same.length ? "shared" : "unique";
      cell.points = cell.same.length ? SHARED_POINTS : UNIQUE_POINTS;
    });
    return row;
  });
  return { cells, need };
}

function toResults(s: LettersState, ctx: GameCtx) {
  const { cells } = judge(s, ctx);
  const points = s.order.map((_, k) => cells.reduce((sum, row) => sum + row[k].points, 0));
  points.forEach((p, k) => (s.scores[k] += p));
  const { letter, categories } = s.plan[s.round];
  s.history.push({ round: s.round + 1, letter, categories, cells, points });
  s.phase = "results";
  s.phaseMs = RESULTS_MS;
  s.endsAt = ctx.now() + RESULTS_MS;
}

function afterResults(s: LettersState, ctx: GameCtx) {
  if (s.round + 1 >= ROUNDS) return finish(s, ctx, false);
  if (onlineCount(s, ctx) >= MIN_PLAYERS) return startRound(s, ctx, s.round + 1);
  if (!s.waiting) {
    // Give dropped players a moment to come back before calling it.
    s.waiting = true;
    s.phaseMs = REJOIN_MS;
    s.endsAt = ctx.now() + REJOIN_MS;
    return;
  }
  finish(s, ctx, true);
}

function computeAwards(s: LettersState): Award[] {
  const tally = (status: CellStatus) =>
    s.order.map((_, k) =>
      s.history.reduce((sum, r) => sum + r.cells.reduce((n, row) => n + (row[k].status === status ? 1 : 0), 0), 0),
    );
  const awards: Award[] = [];
  const give = (icon: string, title: string, counts: number[], detail: (n: number) => string) => {
    const best = Math.max(0, ...counts);
    if (best <= 0) return;
    const players = counts.flatMap((n, k) => (n === best ? [k] : []));
    // A big tie isn't an award, it's a participation trophy (a 2-player tie is still fun).
    if (players.length > 3 || (players.length === s.order.length && players.length > 2)) return;
    awards.push({ icon, title, players, detail: detail(best) });
  };
  give("🦄", "Most original", tally("unique"), (n) => plural(n, "unique answer"));
  give("⚡", "Quickest pencil", s.firstDone, (n) => `Done first ${n === 1 ? "once" : `${n} times`}`);
  give("🤝", "Great minds", tally("shared"), (n) => plural(n, "shared answer"));
  give("🙈", "Most vetoed", tally("vetoed"), (n) => `${plural(n, "answer")} vetoed`);
  return awards;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function headline(s: LettersState, ctx: GameCtx, winners: string[], early: boolean): string {
  const name = (id: string) => ctx.player(id)?.name ?? "Someone";
  if (winners.length === 0) {
    return early ? "Letter Rush ended early before anyone scored" : "Nobody scored. The alphabet wins this one";
  }
  const top = s.scores[s.order.indexOf(winners[0])];
  if (winners.length > 1) {
    const who = winners.length > 3 ? `A ${winners.length}-way tie` : joinNames(winners.map(name));
    return `${who} ${winners.length > 3 ? "on" : "tie on"} ${top} points${early ? " (ended early)" : ""}`;
  }
  const w = name(winners[0]);
  if (early) return `${w} wins a shortened Letter Rush with ${top} points`;
  const rest = s.order.flatMap((id, k) => (id === winners[0] ? [] : [{ id, pts: s.scores[k] }]));
  const runnerUp = Math.max(...rest.map((r) => r.pts));
  const margin = top - runnerUp;
  if (rest.length > 0 && margin <= 10) {
    const chasers = rest.filter((r) => r.pts === runnerUp).map((r) => name(r.id));
    const who = chasers.length > 2 ? "the pack" : joinNames(chasers);
    return `${w} edges out ${who} by ${plural(margin, "point")}`;
  }
  return `${w} wins Letter Rush with ${top} points`;
}

function finish(s: LettersState, ctx: GameCtx, early: boolean) {
  if (s.phase === "final") return;
  s.phase = "final";
  s.endsAt = null;
  s.waiting = false;
  s.endedEarly = early;
  s.awards = computeAwards(s);
  const scores = Object.fromEntries(s.order.map((id, k) => [id, s.scores[k]]));
  const winners = topScorers(scores);
  ctx.end({ winners, headline: headline(s, ctx, winners, early), scores });
}

function liveBoard(s: LettersState, ctx: GameCtx, you: number): LiveCell[][] {
  const { cells, need } = judge(s, ctx);
  return cells.map((row, ci) =>
    row.map((cell, k) => ({
      ...cell,
      need: need[k],
      mine: you >= 0 && s.vetoes[k][ci].includes(you),
      canVeto: you >= 0 && k !== you && s.auto[k][ci] === "ok",
    })),
  );
}

export const letters: GameDef<LettersState, unknown> = {
  id: "letters",

  setup(ctx) {
    const order = ctx.players.map((p) => p.id);
    const letters = shuffle([...LETTERS], ctx.random).slice(0, ROUNDS);
    const cats = shuffle([...CATEGORIES], ctx.random);
    const plan = letters.map((letter, r) => ({
      letter,
      categories: cats.slice(r * CATEGORIES_PER_ROUND, (r + 1) * CATEGORIES_PER_ROUND),
    }));
    const s: LettersState = {
      order,
      plan,
      phase: "answer",
      round: 0,
      endsAt: null,
      phaseMs: ANSWER_MS,
      answers: [],
      activeAt: [],
      done: [],
      doneAt: [],
      ready: [],
      vetoes: [],
      auto: [],
      keys: [],
      scores: order.map(() => 0),
      firstDone: order.map(() => 0),
      history: [],
      awards: [],
      waiting: false,
      endedEarly: false,
    };
    startRound(s, ctx, 0);
    return s;
  },

  action(s, playerId, raw, ctx) {
    if (s.phase === "final") return false;
    const k = s.order.indexOf(playerId);
    if (k < 0) return false;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const a = raw as Record<string, unknown>;
    const now = ctx.now();
    const open = s.endsAt !== null && now < s.endsAt;

    switch (a.type) {
      case "answer": {
        if (s.phase !== "answer" || !open || s.done[k]) return false;
        if (!isCategoryIndex(a.i) || typeof a.text !== "string" || a.text.length > MAX_RAW) return false;
        const text = cleanAnswer(a.text);
        if (text === s.answers[k][a.i]) return false;
        s.answers[k][a.i] = text;
        s.activeAt[k] = now;
        return true;
      }
      case "done": {
        if (s.phase !== "answer" || !open || s.done[k]) return false;
        s.done[k] = true;
        s.doneAt[k] = now;
        if (everyoneOnline(s, ctx, s.done)) toReview(s, ctx);
        return true;
      }
      case "undone": {
        if (s.phase !== "answer" || !open || !s.done[k]) return false;
        s.done[k] = false;
        s.doneAt[k] = 0;
        return true;
      }
      case "veto": {
        if (s.phase !== "review" || !open || typeof a.player !== "string" || !isCategoryIndex(a.i)) return false;
        const author = s.order.indexOf(a.player);
        if (author < 0 || author === k || s.auto[author][a.i] !== "ok") return false;
        const voters = s.vetoes[author][a.i];
        const at = voters.indexOf(k);
        if (at >= 0) voters.splice(at, 1);
        else voters.push(k);
        return true;
      }
      case "ready": {
        if (s.phase !== "review" || !open || s.ready[k]) return false;
        s.ready[k] = true;
        if (everyoneOnline(s, ctx, s.ready)) toResults(s, ctx);
        return true;
      }
      case "unready": {
        if (s.phase !== "review" || !open || !s.ready[k]) return false;
        s.ready[k] = false;
        return true;
      }
      default:
        return false;
    }
  },

  tick(s, ctx) {
    const due = s.endsAt !== null && ctx.now() >= s.endsAt;
    switch (s.phase) {
      case "answer":
        if (!due && !everyoneOnline(s, ctx, s.done)) return false;
        toReview(s, ctx);
        return true;
      case "review":
        if (!due && !everyoneOnline(s, ctx, s.ready)) return false;
        toResults(s, ctx);
        return true;
      case "results":
        if (s.waiting && onlineCount(s, ctx) >= MIN_PLAYERS) {
          startRound(s, ctx, s.round + 1);
          return true;
        }
        if (!due) return false;
        afterResults(s, ctx);
        return true;
      default:
        return false;
    }
  },
  tickMs: 250,

  view(s, viewerId, ctx): LettersView {
    const you = s.order.indexOf(viewerId);
    const { letter, categories } = s.plan[s.round];
    const v: LettersView = {
      phase: s.phase,
      round: s.round + 1,
      rounds: ROUNDS,
      letter,
      categories,
      endsAt: s.endsAt,
      phaseMs: s.phaseMs,
      order: s.order,
      you,
      status: s.order.map((_, k) => ({ done: s.done[k], ready: s.ready[k], activeAt: s.activeAt[k] })),
      scores: s.scores,
      mine: null,
      board: null,
      recap: null,
      history: null,
      awards: null,
      waiting: s.waiting,
      endedEarly: s.endedEarly,
    };
    // Answering: each player sees only their own answers. Everything is public from review on.
    if (s.phase === "answer") v.mine = you >= 0 ? s.answers[you] : null;
    else if (s.phase === "review") v.board = liveBoard(s, ctx, you);
    else if (s.phase === "results") v.recap = s.history[s.history.length - 1] ?? null;
    else {
      v.history = s.history;
      v.awards = s.awards;
    }
    return v;
  },

  playerLeft(s, _id, ctx) {
    // The one player everyone was waiting on may have just left.
    if (s.phase === "answer" && everyoneOnline(s, ctx, s.done)) toReview(s, ctx);
    else if (s.phase === "review" && everyoneOnline(s, ctx, s.ready)) toResults(s, ctx);
  },

  playerReturned(s, _id, ctx) {
    if (s.phase === "results" && s.waiting && onlineCount(s, ctx) >= MIN_PLAYERS) startRound(s, ctx, s.round + 1);
  },
};

export default letters;
