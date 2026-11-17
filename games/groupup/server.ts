import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { BANK } from "./bank";
import { config } from "./config";
import {
  AWAY_MS,
  PUZZLE_MS,
  READY_MS,
  REVEAL_MS,
  puzzleScore,
  type BoardRow,
  type Group,
  type GroupUpView,
  type GuessEvent,
  type MyRun,
  type PuzzleResult,
} from "./shared";

export type { GroupUpAction, GroupUpView, GroupUpEvent } from "./shared";

// Group Up: sixteen words hide four groups of four. Everyone gets the same seeded puzzles and
// solves at their own pace: pick four, submit, a right group locks in, a wrong one costs a
// mistake ("one away" when three of four are right). Run out of mistakes and that puzzle's
// answers are revealed. Group membership only reaches a client once that group is found or
// the puzzle is over for that player.

export interface Puzzle {
  id: string;
  words: string[];
  groups: Group[];
}

interface Run {
  idx: number;
  /** Group indexes found on the current puzzle, in order. */
  found: number[];
  mistakes: number;
  /** Wrong guesses on the current puzzle (sorted index keys), so repeats are free. */
  tried: string[];
  state: "play" | "reveal" | "done";
  startedAt: number;
  nextAt: number;
  results: PuzzleResult[];
  total: number;
  ms: number;
  awaySince: number | null;
}

export interface GroupUpState {
  phase: "ready" | "play" | "over";
  startsAt: number;
  maxMistakes: number;
  puzzles: Puzzle[];
  ids: string[];
  runs: Record<string, Run>;
}

const GAME = "Group Up";
/** How many recent puzzle ids a room remembers so it doesn't repeat them. */
const MEMORY_CAP = 100;

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** The bank, parsed once: id = hash of the sorted words, so edits elsewhere don't shift ids. */
let parsed: { id: string; groups: { title: string; words: string[] }[] }[] | null = null;
export function bank() {
  if (!parsed)
    parsed = BANK.map((lines) => {
      const groups = lines.map((line) => {
        const [title, list] = line.split(" | ");
        return { title, words: list.split(", ") };
      });
      return { id: hash(groups.flatMap((g) => g.words).sort().join(",")), groups };
    });
  return parsed;
}

/** Picks `count` puzzles not played recently in this room (memory), shuffling the tiles. */
export function pickPuzzles(count: number, random: () => number, memory: Record<string, unknown>): Puzzle[] {
  const all = bank();
  const used = new Set(Array.isArray(memory.used) ? (memory.used as unknown[]).filter((x): x is string => typeof x === "string") : []);
  let pool = all.filter((p) => !used.has(p.id));
  if (pool.length < count) {
    used.clear();
    pool = all.slice();
  }
  const chosen = shuffle(pool, random).slice(0, count);
  memory.used = [...used, ...chosen.map((p) => p.id)].slice(-MEMORY_CAP);
  return chosen.map((p) => {
    const order = shuffle(
      p.groups.flatMap((g, gi) => g.words.map((word) => ({ word, gi }))),
      random,
    );
    return {
      id: p.id,
      words: order.map((o) => o.word),
      groups: p.groups.map((g, gi) => ({
        title: g.title,
        level: gi,
        w: order.flatMap((o, i) => (o.gi === gi ? [i] : [])),
      })),
    };
  });
}

function nameOf(ctx: GameCtx, id: string): string {
  return ctx.player(id)?.name ?? "Someone";
}

/** The current puzzle is over for this run (cleared or out of mistakes / time). */
function closePuzzle(s: GroupUpState, r: Run, ctx: GameCtx) {
  const now = ctx.now();
  const ms = Math.max(0, Math.min(PUZZLE_MS, now - r.startedAt));
  const cleared = r.found.length === 4;
  const score = puzzleScore(r.found.length, cleared, r.mistakes, s.maxMistakes, ms);
  const pz = s.puzzles[r.idx];
  const groups = pz.groups.map((g, gi) => ({ title: g.title, level: g.level, words: g.w.map((i) => pz.words[i]), found: r.found.includes(gi) }));
  r.results.push({ found: r.found.length, mistakes: r.mistakes, cleared, secs: Math.round(ms / 1000), score, groups });
  r.total += score;
  r.ms += ms;
  r.state = "reveal";
  r.nextAt = now + REVEAL_MS;
}

function advance(s: GroupUpState, r: Run, ctx: GameCtx) {
  r.idx += 1;
  r.found = [];
  r.mistakes = 0;
  r.tried = [];
  if (r.idx >= s.puzzles.length) {
    r.state = "done";
    return;
  }
  r.state = "play";
  r.startedAt = ctx.now();
}

function maybeEnd(s: GroupUpState, ctx: GameCtx): boolean {
  if (s.phase !== "play") return false;
  const now = ctx.now();
  const waiting = s.ids.some((id) => {
    const r = s.runs[id];
    return r.state !== "done" && (r.awaySince === null || now - r.awaySince < AWAY_MS);
  });
  if (waiting) return false;
  s.phase = "over";
  const scores: Record<string, number> = {};
  for (const id of s.ids) scores[id] = s.runs[id].total;
  const winners = topScorers(scores);
  const n = s.puzzles.length;
  const groups = (id: string) => s.runs[id].results.reduce((t, x) => t + x.found, 0);
  const misses = (id: string) => s.runs[id].results.reduce((t, x) => t + x.mistakes, 0);
  const how = (id: string) => {
    const m = misses(id);
    return `${groups(id)}/${4 * n} groups, ${m === 0 ? "no" : m} mistake${m === 1 ? "" : "s"}`;
  };
  let headline: string;
  if (s.ids.length === 1) {
    const id = s.ids[0];
    const g = groups(id);
    headline =
      g === 4 * n && misses(id) === 0
        ? `${nameOf(ctx, id)} found every group without a single mistake!`
        : `${nameOf(ctx, id)} found ${how(id)}`;
  } else if (winners.length === 1) {
    headline = `${nameOf(ctx, winners[0])} wins ${GAME} with ${scores[winners[0]]} points (${how(winners[0])})`;
  } else if (winners.length > 1) {
    headline = `${winners.map((id) => nameOf(ctx, id)).join(" & ")} tie at ${GAME} on ${scores[winners[0]]} points`;
  } else {
    headline = "Nobody found a single group this time";
  }
  ctx.end({ winners, headline, scores });
  return true;
}

function toMyRun(s: GroupUpState, r: Run): MyRun {
  const pz = s.puzzles[r.idx];
  const live = !!pz && s.phase !== "ready";
  const over = r.state !== "play";
  return {
    idx: r.idx,
    words: live && r.state !== "done" ? pz.words : [],
    found: live ? r.found.map((gi) => pz.groups[gi]) : [],
    missed: live && over ? pz.groups.filter((_, gi) => !r.found.includes(gi)) : [],
    mistakes: r.mistakes,
    state: r.state,
    startedAt: r.startedAt,
    nextAt: r.nextAt,
    results: r.results,
    total: r.total,
  };
}

export const groupup: GameDef<GroupUpState, unknown> = {
  id: "groupup",

  setup(ctx) {
    const set = readSettings(config.settings, ctx.settings);
    const count = [1, 2, 3].includes(Number(set.puzzles)) ? Number(set.puzzles) : 1;
    const maxMistakes = [3, 4, 5].includes(Number(set.mistakes)) ? Number(set.mistakes) : 4;
    const puzzles = pickPuzzles(count, ctx.random, ctx.memory);
    const startsAt = ctx.now() + READY_MS;
    const ids = ctx.players.map((p) => p.id);
    const runs: Record<string, Run> = {};
    for (const id of ids)
      runs[id] = {
        idx: 0,
        found: [],
        mistakes: 0,
        tried: [],
        state: "play",
        startedAt: startsAt,
        nextAt: 0,
        results: [],
        total: 0,
        ms: 0,
        awaySince: ctx.player(id)?.connected === false ? ctx.now() : null,
      };
    return { phase: "ready", startsAt, maxMistakes, puzzles, ids, runs };
  },

  action(s, playerId, raw, ctx) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
    const a = raw as Record<string, unknown>;
    const r = s.runs[playerId];
    if (!r || s.phase !== "play" || a.p !== r.idx || r.state === "done") return false;
    if (a.type === "next") {
      if (r.state !== "reveal") return false;
      advance(s, r, ctx);
      maybeEnd(s, ctx);
      return true;
    }
    if (a.type !== "guess" || r.state !== "play") return false;
    const w = a.w;
    if (!Array.isArray(w) || w.length !== 4) return false;
    if (!w.every((x) => typeof x === "number" && Number.isInteger(x) && x >= 0 && x < 16)) return false;
    const pick = [...new Set(w as number[])].sort((x, y) => x - y);
    if (pick.length !== 4) return false;
    const pz = s.puzzles[r.idx];
    // Words already locked in can't be picked again.
    if (pick.some((i) => r.found.some((gi) => pz.groups[gi].w.includes(i)))) return false;
    const key = pick.join(",");
    const say = (t: GuessEvent["t"]) => ctx.emit({ t } satisfies GuessEvent, { to: playerId });
    if (r.tried.includes(key)) {
      say("dupe");
      return false;
    }
    const hit = pz.groups.findIndex((g) => pick.every((i) => g.w.includes(i)));
    if (hit >= 0) {
      r.found.push(hit);
      if (r.found.length === 4) closePuzzle(s, r, ctx);
      return true;
    }
    r.tried.push(key);
    r.mistakes += 1;
    const best = Math.max(...pz.groups.map((g) => pick.filter((i) => g.w.includes(i)).length));
    say(best === 3 ? "away" : "wrong");
    if (r.mistakes >= s.maxMistakes) closePuzzle(s, r, ctx);
    return true;
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
      const r = s.runs[id];
      if (r.state === "play" && now >= r.startedAt + PUZZLE_MS) {
        closePuzzle(s, r, ctx);
        changed = true;
      } else if (r.state === "reveal" && now >= r.nextAt) {
        advance(s, r, ctx);
        changed = true;
      }
    }
    return maybeEnd(s, ctx) || changed;
  },
  tickMs: 500,

  playerLeft(s, playerId, ctx) {
    const r = s.runs[playerId];
    if (r && r.awaySince === null) r.awaySince = ctx.now();
  },

  playerReturned(s, playerId) {
    const r = s.runs[playerId];
    if (r) r.awaySince = null;
  },

  view(s, viewerId): GroupUpView {
    const board: BoardRow[] = s.ids.map((id) => {
      const r = s.runs[id];
      return {
        id,
        idx: r.idx,
        found: r.found.length,
        totalFound: r.results.reduce((t, x) => t + x.found, 0) + (r.state === "play" ? r.found.length : 0),
        mistakes: r.mistakes,
        total: r.total,
        done: r.state === "done",
        secs: Math.round(r.ms / 1000),
      };
    });
    const mine = s.runs[viewerId];
    let watch: GroupUpView["watch"] = null;
    if (!mine && s.ids.length && s.phase !== "ready") {
      const score = (id: string) => s.runs[id].total + 100 * s.runs[id].found.length;
      const lead = s.ids.slice().sort((a, b) => score(b) - score(a))[0];
      watch = { id: lead, run: toMyRun(s, s.runs[lead]) };
    }
    return {
      phase: s.phase,
      startsAt: s.startsAt,
      n: s.puzzles.length,
      maxMistakes: s.maxMistakes,
      board,
      me: mine ? toMyRun(s, mine) : null,
      watch,
    };
  },
};

export default groupup;
