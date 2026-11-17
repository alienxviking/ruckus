// Word Ladder: constants, scoring and wire types shared by server.ts and client.tsx.
// The dictionary itself (words.ts) is server-only.

export const READY_MS = 3_000;
/** Pause between puzzles, while your result and the par ladder are on screen. */
export const BETWEEN_MS = 3_000;
/** A participant gone this long no longer holds up the end of the game. */
export const AWAY_MS = 30_000;

export const BASE_POINTS = 100;
export const SPEED_POINTS = 50;
export const EXTRA_STEP_COST = 20;
export const HINT_COST = 30;
export const MIN_SOLVED_POINTS = 10;

export type Difficulty = "easy" | "normal" | "hard";

/** [word length, optimal steps] for each puzzle, by difficulty. Games use the first `count`. */
export const PLANS: Record<Difficulty, [number, number][]> = {
  easy: [[4, 3], [4, 3], [4, 4], [5, 3], [4, 4], [5, 4], [4, 4], [5, 4]],
  normal: [[4, 3], [4, 4], [5, 4], [4, 5], [5, 5], [4, 6], [5, 5], [5, 6]],
  hard: [[4, 5], [5, 5], [4, 6], [5, 6], [4, 7], [5, 6], [5, 7], [4, 7]],
};

/** Time allowed for a puzzle whose best solution takes `par` steps. */
export const limitFor = (par: number) => 30_000 + 15_000 * par;

/** Points for a finished puzzle. */
export function puzzlePoints(solved: boolean, steps: number, par: number, hints: number, msLeft: number, limit: number): number {
  if (!solved) return 0;
  const speed = Math.round(SPEED_POINTS * Math.max(0, Math.min(1, msLeft / limit)));
  const raw = BASE_POINTS + speed - EXTRA_STEP_COST * Math.max(0, steps - par) - HINT_COST * hints;
  return Math.max(MIN_SOLVED_POINTS, raw);
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
  /** Steps taken (solved) / par. */
  steps: number;
  par: number;
  hints: number;
  pts: number;
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
  score: number;
  done: boolean;
}

export interface BoardRow {
  id: string;
  score: number;
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
