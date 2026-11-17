import { pick, shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import { QUESTIONS } from "./data";
import {
  ABANDON_MS,
  CATEGORIES,
  INTRO_MS,
  REVEAL_MS,
  fmt,
  speedPoints,
  streakBonus,
  type Category,
  type Difficulty,
} from "./shared";

// Trivia Rush: everyone answers the same multiple-choice question at once.
// intro (3s) -> [question (15s, ends early once every connected player is in) -> reveal (5s)] x10 -> final.
// Per-player data lives in arrays indexed by seat (position in `ids`), never in id-keyed objects.

export type Phase = "intro" | "question" | "reveal" | "final";

/** A question picked for this game. `order[i]` is the bank choice shown at position i. */
interface Picked {
  id: number;
  order: number[];
  /** Shown position of the correct choice. Secret until the reveal. */
  answer: number;
}

interface Stat {
  score: number;
  streak: number;
  bestStreak: number;
  correct: number;
  fastestMs: number | null;
}

export interface Outcome {
  choice: number | null;
  correct: boolean;
  /** Total points gained this question (speed points + streak bonus). */
  points: number;
  bonus: number;
  streak: number;
  /** Length of the streak this answer broke (0 if none). */
  lost: number;
  /** How long they took to lock in, measured by the server. */
  ms: number | null;
}

export interface TriviaState {
  phase: Phase;
  ids: string[];
  qs: Picked[];
  /** Time to answer each question (host setting). */
  questionMs: number;
  round: number;
  startedAt: number;
  endsAt: number;
  answers: ({ choice: number; ms: number } | null)[];
  stats: Stat[];
  outcomes: Outcome[] | null;
  rank: number[];
  prevRank: number[];
  /** Seats that answered each asked question correctly. */
  history: number[][];
  /** When the last participant disconnected (null while anyone is connected). */
  emptySince: number | null;
}

export type TriviaAction = { type: "answer"; choice: number; q: number };

export interface PublicQuestion {
  text: string;
  choices: string[];
  cat: Category;
  diff: Difficulty;
}

export interface PlayerLine {
  id: string;
  score: number;
  rank: number;
  prevRank: number;
  streak: number;
  bestStreak: number;
  correct: number;
  fastestMs: number | null;
  /** Locked in for the current question (question phase only; never says what). */
  answered: boolean;
  /** This question's result (reveal phase only). */
  outcome: Outcome | null;
}

export interface RecapItem {
  text: string;
  cat: Category;
  answer: string;
  correct: string[];
}

export interface TriviaView {
  phase: Phase;
  /** 1-based number of the current (or upcoming) question. */
  qNum: number;
  total: number;
  endsAt: number;
  phaseMs: number;
  /** Time to answer each question. */
  questionMs: number;
  question: PublicQuestion | null;
  /** Correct choice, only during the reveal. */
  answer: number | null;
  /** The viewer's own locked-in choice. */
  myChoice: number | null;
  players: PlayerLine[];
  /** Questions revealed so far (accuracy denominator). */
  asked: number;
  recap: RecapItem[] | null;
  you: boolean;
}

const PHASE_MS: Record<Exclude<Phase, "question">, number> = { intro: INTRO_MS, reveal: REVEAL_MS, final: 0 };

/** Difficulty ramp across a game: warm up easy, finish hard. */
const RAMP: Difficulty[] = ["easy", "easy", "easy", "medium", "medium", "medium", "medium", "hard", "hard", "hard"];

const BY_CAT: Record<string, number[]> = {};
QUESTIONS.forEach((qq, i) => (BY_CAT[qq.cat] ??= []).push(i));

function pickQuestions(random: () => number, total: number): Picked[] {
  // One question per category, so a game spans 10 different categories.
  const cats = shuffle([...CATEGORIES], random).filter((c) => BY_CAT[c]?.length);
  const used = new Set<number>();
  const out: Picked[] = [];
  for (let i = 0; i < total; i++) {
    const pool = BY_CAT[cats[i % cats.length]] ?? [];
    const fresh = pool.filter((id) => !used.has(id));
    const wanted = fresh.filter((id) => QUESTIONS[id].diff === RAMP[Math.floor((i * RAMP.length) / total)]);
    const any = QUESTIONS.map((_, id) => id).filter((id) => !used.has(id));
    const choices = wanted.length ? wanted : fresh.length ? fresh : any;
    if (!choices.length) break;
    const id = pick(choices, random);
    used.add(id);
    const order = shuffle([0, 1, 2, 3], random);
    out.push({ id, order, answer: order.indexOf(QUESTIONS[id].answer) });
  }
  return out;
}

function ranks(scores: number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s).length);
}

const isConnected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;

function onlineSeats(s: TriviaState, ctx: GameCtx): number[] {
  return s.ids.flatMap((id, i) => (isConnected(ctx, id) ? [i] : []));
}

function everyoneIn(s: TriviaState, ctx: GameCtx): boolean {
  const online = onlineSeats(s, ctx);
  return online.length > 0 && online.every((i) => s.answers[i] !== null);
}

function startQuestion(s: TriviaState, ctx: GameCtx, round: number) {
  s.phase = "question";
  s.round = round;
  s.answers = s.ids.map(() => null);
  s.outcomes = null;
  s.startedAt = ctx.now();
  s.endsAt = s.startedAt + s.questionMs;
}

function reveal(s: TriviaState, ctx: GameCtx) {
  const correctAt = s.qs[s.round].answer;
  s.prevRank = ranks(s.stats.map((st) => st.score));
  s.outcomes = s.stats.map((st, i): Outcome => {
    const a = s.answers[i];
    if (a && a.choice === correctAt) {
      st.streak += 1;
      st.bestStreak = Math.max(st.bestStreak, st.streak);
      st.correct += 1;
      st.fastestMs = st.fastestMs === null ? a.ms : Math.min(st.fastestMs, a.ms);
      const bonus = streakBonus(st.streak);
      const points = speedPoints(a.ms, s.questionMs) + bonus;
      st.score += points;
      return { choice: a.choice, correct: true, points, bonus, streak: st.streak, lost: 0, ms: a.ms };
    }
    const lost = st.streak;
    st.streak = 0;
    return { choice: a ? a.choice : null, correct: false, points: 0, bonus: 0, streak: 0, lost, ms: a ? a.ms : null };
  });
  s.rank = ranks(s.stats.map((st) => st.score));
  s.history.push(s.outcomes.flatMap((o, i) => (o.correct ? [i] : [])));
  s.phase = "reveal";
  s.endsAt = ctx.now() + REVEAL_MS;
}

function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function headline(s: TriviaState, ctx: GameCtx, winners: string[], abandoned: boolean): string {
  const name = (id: string) => ctx.player(id)?.name ?? "Someone";
  const asked = s.history.length;
  const prefix = abandoned ? "Everyone left. " : "";
  if (!winners.length) {
    return abandoned ? "Trivia Rush ended: everyone left" : "Nobody scored. The questions win this time!";
  }
  const top = s.stats[s.ids.indexOf(winners[0])];
  const pts = `${fmt(top.score)} points`;
  if (s.ids.length === 1) return `${prefix}${name(winners[0])} finished with ${pts} (${top.correct}/${asked} correct)`;
  if (winners.length === 1) return `${prefix}${name(winners[0])} wins Trivia Rush with ${pts}`;
  if (winners.length <= 3) return `${prefix}${listNames(winners.map(name))} tie for the win on ${pts}`;
  return `${prefix}${winners.length}-way tie for the win on ${pts}`;
}

function finish(s: TriviaState, ctx: GameCtx, abandoned = false) {
  if (s.phase === "final") return;
  s.phase = "final";
  s.endsAt = 0;
  s.outcomes = null;
  const scores: Record<string, number> = Object.fromEntries(s.ids.map((id, i) => [id, s.stats[i].score]));
  const winners = topScorers(scores);
  ctx.end({ winners, headline: headline(s, ctx, winners, abandoned), scores });
}

/** Move on from the current phase once its timer has run out. */
function advance(s: TriviaState, ctx: GameCtx) {
  if (s.phase === "intro") startQuestion(s, ctx, 0);
  else if (s.phase === "question") reveal(s, ctx);
  else if (s.phase === "reveal") {
    if (s.round + 1 >= s.qs.length) finish(s, ctx);
    else startQuestion(s, ctx, s.round + 1);
  }
}

function publicQuestion(p: Picked): PublicQuestion {
  const src = QUESTIONS[p.id];
  return { text: src.q, choices: p.order.map((i) => src.choices[i]), cat: src.cat, diff: src.diff };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const trivia: GameDef<TriviaState, unknown> = {
  id: "trivia",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const now = ctx.now();
    const set = readSettings(config.settings, ctx.settings);
    return {
      phase: "intro",
      ids,
      qs: pickQuestions(ctx.random, Number(set.questions)),
      questionMs: Number(set.seconds) * 1000,
      round: 0,
      startedAt: now,
      endsAt: now + INTRO_MS,
      answers: ids.map(() => null),
      stats: ids.map(() => ({ score: 0, streak: 0, bestStreak: 0, correct: 0, fastestMs: null })),
      outcomes: null,
      rank: ids.map(() => 1),
      prevRank: ids.map(() => 1),
      history: [],
      emptySince: null,
    };
  },

  action(s, playerId, a, ctx) {
    if (s.phase !== "question" || !isRecord(a) || a.type !== "answer") return false;
    const { choice, q } = a;
    if (typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice > 3) return false;
    if (typeof q !== "number" || q !== s.round + 1) return false; // stale or future question
    const seat = s.ids.indexOf(playerId);
    if (seat === -1 || s.answers[seat] !== null) return false; // spectator, or already locked in
    const now = ctx.now();
    if (now >= s.endsAt) return false; // too late; tick() is about to reveal
    s.answers[seat] = { choice: choice | 0, ms: Math.max(0, now - s.startedAt) };
    if (everyoneIn(s, ctx)) reveal(s, ctx);
    return true;
  },

  tick(s, ctx) {
    if (s.phase === "final") return false;
    const now = ctx.now();
    if (onlineSeats(s, ctx).length === 0) {
      if (s.emptySince === null) s.emptySince = now;
      if (now - s.emptySince >= ABANDON_MS) {
        finish(s, ctx, true);
        return true;
      }
    } else {
      s.emptySince = null;
    }
    if (s.phase === "question" && everyoneIn(s, ctx)) {
      reveal(s, ctx);
      return true;
    }
    if (now < s.endsAt) return false;
    advance(s, ctx);
    return true;
  },
  tickMs: 200,

  playerLeft(s, _id, ctx) {
    if (s.phase === "final") return;
    if (onlineSeats(s, ctx).length === 0) {
      if (s.emptySince === null) s.emptySince = ctx.now();
      return;
    }
    // The leaver may have been the last one we were waiting for.
    if (s.phase === "question" && everyoneIn(s, ctx)) reveal(s, ctx);
  },

  playerReturned(s) {
    s.emptySince = null;
  },

  view(s, viewerId): TriviaView {
    const seat = s.ids.indexOf(viewerId);
    const live = s.phase === "question" || s.phase === "reveal";
    const revealing = s.phase === "reveal";
    const current = s.qs[s.round];
    return {
      phase: s.phase,
      qNum: Math.min(s.round + 1, s.qs.length),
      total: s.qs.length,
      endsAt: s.endsAt,
      phaseMs: s.phase === "question" ? s.questionMs : PHASE_MS[s.phase],
      questionMs: s.questionMs,
      question: live && current ? publicQuestion(current) : null,
      answer: revealing && current ? current.answer : null,
      myChoice: live && seat !== -1 ? (s.answers[seat]?.choice ?? null) : null,
      players: s.ids.map((id, i) => {
        const st = s.stats[i];
        return {
          id,
          score: st.score,
          rank: s.rank[i],
          prevRank: s.prevRank[i],
          streak: st.streak,
          bestStreak: st.bestStreak,
          correct: st.correct,
          fastestMs: st.fastestMs,
          answered: s.phase === "question" && s.answers[i] !== null,
          outcome: revealing && s.outcomes ? s.outcomes[i] : null,
        };
      }),
      asked: s.history.length,
      recap:
        s.phase === "final"
          ? s.history.map((seats, qi) => {
              const src = QUESTIONS[s.qs[qi].id];
              return { text: src.q, cat: src.cat, answer: src.choices[src.answer], correct: seats.map((i) => s.ids[i]) };
            })
          : null,
      you: seat !== -1,
    };
  },
};

/**
 * Practice bot. It can't see the answer: it "knows" a question with a chance that falls with
 * difficulty (like a decent pub-quiz player) and otherwise guesses, and it takes 2.5-9 s to
 * lock in (a bit quicker when it knows). Each question's decision is made once and remembered.
 */
const botPlans = new WeakMap<TriviaState, Map<string, { q: number; at: number; choice: number }>>();
const KNOWS: Record<Difficulty, number> = { easy: 0.8, medium: 0.6, hard: 0.4 };

trivia.bot = (s, botId, ctx) => {
  if (s.phase !== "question") return null;
  const seat = s.ids.indexOf(botId);
  if (seat === -1 || s.answers[seat] !== null) return null;
  let plans = botPlans.get(s);
  if (!plans) botPlans.set(s, (plans = new Map()));
  const q = s.round + 1;
  let plan = plans.get(botId);
  if (!plan || plan.q !== q) {
    const p = s.qs[s.round];
    const knows = ctx.random() < KNOWS[QUESTIONS[p.id].diff];
    const choice = knows ? p.answer : Math.floor(ctx.random() * 4);
    const window = Math.min(s.questionMs - 1_000, (knows ? 6_000 : 9_000) - 2_500);
    plan = { q, at: s.startedAt + 2_500 + Math.round(ctx.random() * window * 0.9), choice };
    plans.set(botId, plan);
  }
  if (ctx.now() < plan.at) return null;
  return { type: "answer", choice: plan.choice, q };
};

export default trivia;
