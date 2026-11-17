import { topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import { distancesTo, isWord, makePuzzle, neighbours, nextStep, type Puzzle } from "./dict";
import {
  AWAY_MS,
  BETWEEN_MS,
  PLANS,
  READY_MS,
  countedSteps,
  limitFor,
  oneApart,
  raceScore,
  type BoardRow,
  type Difficulty,
  type LadderView,
  type MyRun,
  type NoEvent,
  type PuzzleResult,
} from "./shared";

export type { LadderAction, LadderView, LadderEvent } from "./shared";

// Word Ladder (Ruckus original take on the classic word puzzle).
// Everyone gets the same seeded set of puzzles and races through them at their own pace:
// change one letter per step, every step a real word, reach the goal. Fewest steps over all
// the ladders wins (time breaks ties); a hint plays a step for you and adds one, giving up
// counts as the shortest route plus five.

interface Run {
  idx: number;
  ladder: string[];
  startedAt: number;
  hints: number;
  results: PuzzleResult[];
  /** Counted steps and ms used over finished ladders. */
  total: number;
  ms: number;
  done: boolean;
  /** When they disconnected (null = here). */
  awaySince: number | null;
}

export interface LadderState {
  phase: "ready" | "play" | "over";
  startsAt: number;
  puzzles: Puzzle[];
  ids: string[];
  runs: Record<string, Run>;
}

const GAME = "Word Ladder";
const WORD_RE = /^[a-z]{4,5}$/;

function nameOf(ctx: GameCtx, id: string): string {
  return ctx.player(id)?.name ?? "Someone";
}

function finishPuzzle(s: LadderState, run: Run, ok: boolean, ctx: GameCtx) {
  const pz = s.puzzles[run.idx];
  const now = ctx.now();
  const limit = limitFor(pz.par);
  const used = Math.max(0, Math.min(limit, now - run.startedAt));
  const steps = run.ladder.length - 1;
  const counted = countedSteps(ok, steps, pz.par, run.hints);
  run.results.push({
    ok,
    steps,
    counted,
    par: pz.par,
    hints: run.hints,
    secs: Math.round(used / 1000),
    best: pz.best,
    mine: run.ladder.slice(),
  });
  run.total += counted;
  run.ms += used;
  run.idx += 1;
  run.hints = 0;
  if (run.idx >= s.puzzles.length) {
    run.done = true;
    run.ladder = [];
  } else {
    run.ladder = [s.puzzles[run.idx].start];
    run.startedAt = now + BETWEEN_MS;
  }
}

/** The run can take a move on puzzle p right now. */
function live(s: LadderState, run: Run | undefined, p: unknown, ctx: GameCtx): run is Run {
  return (
    !!run && s.phase === "play" && !run.done && p === run.idx && ctx.now() >= run.startedAt
  );
}

function maybeEnd(s: LadderState, ctx: GameCtx): boolean {
  if (s.phase !== "play") return false;
  const now = ctx.now();
  const waiting = s.ids.some((id) => {
    const r = s.runs[id];
    return !r.done && (r.awaySince === null || now - r.awaySince < AWAY_MS);
  });
  if (waiting) return false;
  s.phase = "over";
  const n = s.puzzles.length;
  const best = s.puzzles.reduce((t, p) => t + p.par, 0);
  const limitMs = s.puzzles.reduce((t, p) => t + limitFor(p.par), 0);
  // Ladders someone never got to (they left) count as given up.
  for (const id of s.ids) {
    const r = s.runs[id];
    if (r.done) continue;
    for (let i = r.idx; i < n; i++) r.total += countedSteps(false, 0, s.puzzles[i].par, 0);
    r.ms = limitMs;
  }
  const scores: Record<string, number> = {};
  for (const id of s.ids) scores[id] = raceScore(s.runs[id].total, best, n, s.runs[id].ms, limitMs);
  const anySolved = s.ids.some((id) => s.runs[id].results.some((r) => r.ok));
  const winners = anySolved ? topScorers(scores) : [];
  const steps = (id: string) => s.runs[id].total;
  let headline: string;
  if (s.ids.length === 1) {
    const id = s.ids[0];
    headline = `${nameOf(ctx, id)} climbed ${n} ladder${n === 1 ? "" : "s"} in ${steps(id)} steps (shortest possible: ${best})`;
  } else if (winners.length === 1) {
    headline = `${nameOf(ctx, winners[0])} wins ${GAME} in ${steps(winners[0])} steps (shortest possible: ${best})`;
  } else if (winners.length > 1) {
    headline = `${winners.map((id) => nameOf(ctx, id)).join(" & ")} tie at ${GAME} on ${steps(winners[0])} steps`;
  } else {
    headline = `Nobody climbed a ladder this time`;
  }
  ctx.end({ winners, headline, scores });
  return true;
}

function toMyRun(s: LadderState, r: Run): MyRun {
  const pz = s.puzzles[Math.min(r.idx, s.puzzles.length - 1)];
  const limit = limitFor(pz.par);
  return {
    idx: r.idx,
    ladder: r.ladder,
    goal: r.done ? "" : pz.goal,
    par: r.done ? 0 : pz.par,
    away: r.done || !r.ladder.length ? 0 : (distancesTo(pz.goal).get(r.ladder[r.ladder.length - 1]) ?? 0),
    startedAt: r.startedAt,
    endsAt: r.startedAt + limit,
    limit,
    hints: r.hints,
    results: r.results,
    total: r.total,
    bestTotal: r.results.reduce((t, x) => t + x.par, 0),
    done: r.done,
  };
}

// ---------- practice bot ----------

const botPlans = new WeakMap<LadderState, Map<string, { key: string; at: number }>>();

/** Medium bot: mostly walks a shortest path, sometimes wanders a step, at a human pace. */
function botMove(s: LadderState, botId: string, ctx: GameCtx) {
  const run = s.runs[botId];
  if (!run || s.phase !== "play" || run.done) return null;
  const now = ctx.now();
  if (now < run.startedAt) return null;
  let plans = botPlans.get(s);
  if (!plans) botPlans.set(s, (plans = new Map()));
  const key = `${run.idx}:${run.ladder.length}`;
  const plan = plans.get(botId);
  if (!plan || plan.key !== key) {
    // Thinking time per step: a few seconds, longer on the first look at a puzzle.
    const first = run.ladder.length === 1 ? 3500 : 0;
    plans.set(botId, { key, at: now + first + 3500 + ctx.random() * 5500 });
    return null;
  }
  if (now < plan.at) return null;
  const pz = s.puzzles[run.idx];
  const cur = run.ladder[run.ladder.length - 1];
  const dist = distancesTo(pz.goal);
  const d = dist.get(cur) ?? 99;
  const fresh = neighbours(cur).filter((x) => !run.ladder.includes(x));
  const better = fresh.filter((x) => dist.get(x) === d - 1);
  const sideways = fresh.filter((x) => dist.get(x) === d);
  // Stuck far from home after wandering: back up.
  if (run.ladder.length > pz.par + 4 && run.ladder.length > 1) return { type: "undo", p: run.idx };
  const pool = better.length && (ctx.random() < 0.7 || !sideways.length) ? better : sideways.length ? sideways : better;
  if (!pool.length) return run.ladder.length > 1 ? { type: "undo", p: run.idx } : { type: "skip", p: run.idx };
  return { type: "step", p: run.idx, w: pool[Math.floor(ctx.random() * pool.length) % pool.length] };
}

// ---------- the game ----------

export const ladder: GameDef<LadderState, unknown> = {
  id: "ladder",

  setup(ctx) {
    const set = readSettings(config.settings, ctx.settings);
    const diff = (["easy", "normal", "hard"].includes(String(set.level)) ? set.level : "normal") as Difficulty;
    const count = Math.max(1, Math.min(8, Number(set.puzzles) || 5));
    const avoid = new Set<string>();
    const puzzles = PLANS[diff].slice(0, count).map(([len, par]) => {
      const pz = makePuzzle(len, par, ctx.random, avoid);
      for (const w of pz.best) avoid.add(w);
      return pz;
    });
    const startsAt = ctx.now() + READY_MS;
    const ids = ctx.players.map((p) => p.id);
    const runs: Record<string, Run> = {};
    for (const id of ids) {
      runs[id] = {
        idx: 0,
        ladder: [puzzles[0].start],
        startedAt: startsAt,
        hints: 0,
        results: [],
        total: 0,
        ms: 0,
        done: false,
        awaySince: ctx.player(id)?.connected === false ? ctx.now() : null,
      };
    }
    return { phase: "ready", startsAt, puzzles, ids, runs };
  },

  action(s, playerId, raw, ctx) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
    const a = raw as Record<string, unknown>;
    const run = s.runs[playerId];
    if (!live(s, run, a.p, ctx)) return false;
    const pz = s.puzzles[run.idx];
    const cur = run.ladder[run.ladder.length - 1];

    switch (a.type) {
      case "step": {
        if (typeof a.w !== "string" || a.w.length > 8) return false;
        const w = a.w.toLowerCase();
        const no = (why: NoEvent["why"]) => {
          ctx.emit({ t: "no", w, why } satisfies NoEvent, { to: playerId });
          return false;
        };
        if (!WORD_RE.test(w) || !oneApart(cur, w)) return no("shape");
        if (run.ladder.includes(w)) return no("used");
        if (!isWord(w)) return no("word");
        run.ladder.push(w);
        if (w === pz.goal) finishPuzzle(s, run, true, ctx);
        maybeEnd(s, ctx);
        return true;
      }
      case "undo": {
        if (run.ladder.length <= 1) return false;
        run.ladder.pop();
        return true;
      }
      case "hint": {
        const next = nextStep(cur, pz.goal);
        if (!next) return false;
        // The hint's word may already be on the ladder (you looped): cut back to it instead.
        const at = run.ladder.indexOf(next);
        if (at >= 0) run.ladder.length = at + 1;
        else run.ladder.push(next);
        run.hints += 1;
        if (next === pz.goal) finishPuzzle(s, run, true, ctx);
        maybeEnd(s, ctx);
        return true;
      }
      case "skip": {
        finishPuzzle(s, run, false, ctx);
        maybeEnd(s, ctx);
        return true;
      }
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
      if (run.done) continue;
      const limit = limitFor(s.puzzles[run.idx].par);
      if (now >= run.startedAt + limit) {
        finishPuzzle(s, run, false, ctx);
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

  view(s, viewerId): LadderView {
    const board: BoardRow[] = s.ids.map((id) => {
      const r = s.runs[id];
      return {
        id,
        total: r.total,
        secs: Math.round(r.ms / 1000),
        idx: r.idx,
        steps: Math.max(0, r.ladder.length - 1),
        solved: r.results.filter((x) => x.ok).length,
        done: r.done,
      };
    });
    const mine = s.runs[viewerId];
    let watch: LadderView["watch"] = null;
    if (!mine && s.ids.length) {
      // Spectators follow whoever leads (furthest along, then fewest steps).
      const lead = s.ids
        .slice()
        .sort((a, b) => s.runs[b].idx - s.runs[a].idx || s.runs[a].total - s.runs[b].total)[0];
      watch = { id: lead, run: toMyRun(s, s.runs[lead]) };
    }
    return {
      phase: s.phase,
      startsAt: s.startsAt,
      n: s.puzzles.length,
      lens: s.puzzles.map((p) => p.start.length),
      board,
      me: mine ? toMyRun(s, mine) : null,
      watch,
    };
  },
};

export default ladder;
