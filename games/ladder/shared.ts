// Word Ladder: constants, scoring and wire types shared by server.ts and client.tsx.
// The dictionary itself (words.ts) is server-only.

export const READY_MS = 3_000;
/** Pause between puzzles, while your result and the par ladder are on screen. */
export const BETWEEN_MS = 3_000;
/** A participant gone this long no longer holds up the end of the game. */
export const AWAY_MS = 30_000;

/** It's a race for the fewest steps. A hint plays a step for you and adds this many on top. */
export const HINT_EXTRA = 1;
/** A ladder you give up on (or run out of time on) counts as the shortest route plus this. */
export const MISS_EXTRA = 5;

export type Difficulty = "easy" | "normal" | "hard";

/** [word length, optimal steps] for each puzzle, by difficulty. Games use the first `count`. */
export const PLANS: Record<Difficulty, [number, number][]> = {
  easy: [[4, 3], [4, 3], [4, 4], [5, 3], [4, 4], [5, 4], [4, 4], [5, 4]],
  normal: [[4, 3], [4, 4], [5, 4], [4, 5], [5, 5], [4, 6], [5, 5], [5, 6]],
  hard: [[4, 5], [5, 5], [4, 6], [5, 6], [4, 7], [5, 6], [5, 7], [4, 7]],
};

/** Time allowed for a puzzle whose shortest route takes `par` steps (generous: it's a backstop). */
export const limitFor = (par: number) => 60_000 + 20_000 * par;

/** Steps a finished ladder counts for in the race. */
export function countedSteps(ok: boolean, steps: number, par: number, hints: number): number {
  return ok ? steps + HINT_EXTRA * hints : par + MISS_EXTRA;
}

/**
 * The game's score (higher is better, for the room and the daily challenge): fewest counted
 * steps first, time only breaks ties. 10 points per step under (best possible + 10 a ladder),
 * plus up to 9 for speed, so a step always outweighs any amount of time.
 */
export function raceScore(counted: number, best: number, ladders: number, ms: number, limitMs: number): number {
  const steps = Math.max(0, 10 * (best + 10 * ladders - counted));
  const speed = Math.round(9 * Math.max(0, Math.min(1, 1 - ms / Math.max(1, limitMs))));
  return steps + speed;
}

/** True when a and b (same length) differ in exactly one position. */
export function oneApart(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return false;
  return d === 1;
}

// ---------- wire types ----------

export type LadderAction =
  | { type: "step"; p: number; w: string }
  | { type: "undo"; p: number }
  | { type: "hint"; p: number }
  | { type: "skip"; p: number };

export interface PuzzleResult {
  /** Solved (else timed out or skipped). */
  ok: boolean;
  /** Steps you climbed, and what the ladder counts for in the race (hints and misses add). */
  steps: number;
  counted: number;
  /** The shortest possible route. */
  par: number;
  hints: number;
  /** Seconds taken. */
  secs: number;
  /** One best ladder, start to goal. */
  best: string[];
  /** Your ladder (start to wherever you got). */
  mine: string[];
}

export interface MyRun {
  /** Index of the current puzzle (= results.length); n when done. */
  idx: number;
  /** Words so far on the current puzzle, start first. */
  ladder: string[];
  goal: string;
  par: number;
  /** Fewest steps left from the current word to the goal. */
  away: number;
  /** When the current puzzle's clock started (may be in the future: the between-puzzles pause). */
  startedAt: number;
  endsAt: number;
  limit: number;
  hints: number;
  results: PuzzleResult[];
  /** Counted steps over finished ladders, and the shortest possible total for them. */
  total: number;
  bestTotal: number;
  done: boolean;
}

export interface BoardRow {
  id: string;
  /** Counted steps over finished ladders (fewest wins), and seconds used. */
  total: number;
  secs: number;
  /** Puzzle they're on (n = done). */
  idx: number;
  /** Steps on their current ladder. */
  steps: number;
  solved: number;
  done: boolean;
}

export interface LadderView {
  phase: "ready" | "play" | "over";
  startsAt: number;
  /** Puzzles in this game. */
  n: number;
  /** Word length per puzzle (so everyone sees what's coming). */
  lens: number[];
  board: BoardRow[];
  /** The viewer's own run (null for spectators). */
  me: MyRun | null;
  /** Spectators follow the leader: their run, or null. */
  watch: { id: string; run: MyRun } | null;
}

/** Private: the server refused a step. */
export interface NoEvent {
  t: "no";
  w: string;
  why: "word" | "used" | "shape";
}
export type LadderEvent = NoEvent;
