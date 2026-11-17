// Group Up: constants, scoring and wire types shared by server.ts and client.tsx.
// The puzzle bank (bank.ts) is server-only; clients only ever see groups once they're found
// (or once that puzzle is over for them).

export const READY_MS = 3_000;
/** A puzzle's backstop clock. */
export const PUZZLE_MS = 6 * 60_000;
/** After a puzzle, its answers stay up this long (or until you tap Next). */
export const REVEAL_MS = 15_000;
/** A participant gone this long no longer holds up the end of the game. */
export const AWAY_MS = 45_000;

export const GROUP_POINTS = 100;
export const SPARE_POINTS = 40;
export const SPEED_POINTS = 60;
/** Full speed bonus when a puzzle is cleared within this. */
export const FAST_MS = 60_000;

/**
 * One puzzle's score: 100 a group found; clearing all four adds 40 for each mistake you had
 * left and up to 60 for speed (full within a minute, nothing at the 6-minute limit).
 */
export function puzzleScore(found: number, cleared: boolean, mistakes: number, max: number, ms: number): number {
  let s = GROUP_POINTS * found;
  if (cleared) {
    s += SPARE_POINTS * Math.max(0, max - mistakes);
    s += Math.round(SPEED_POINTS * Math.max(0, Math.min(1, (PUZZLE_MS - ms) / (PUZZLE_MS - FAST_MS))));
  }
  return s;
}

/** Difficulty colours, easiest first: lime, cyan, orange, pink. */
export const LEVEL_COLORS = ["#c6f432", "#4ce0ff", "#ffa94d", "#ff6fb5"] as const;
export const LEVEL_NAMES = ["Chill", "Warm", "Spicy", "Sneaky"] as const;

// ---------- wire types ----------

export type GroupUpAction = { type: "guess"; p: number; w: number[] } | { type: "next"; p: number };

export interface Group {
  title: string;
  level: number;
  /** Indexes into the puzzle's 16 words. */
  w: number[];
}

export interface PuzzleResult {
  found: number;
  mistakes: number;
  cleared: boolean;
  secs: number;
  score: number;
  /** The answers (the puzzle is over for this player), easiest first. */
  groups: { title: string; level: number; words: string[]; found: boolean }[];
}

export interface MyRun {
  /** Index of the puzzle on screen (n when done). */
  idx: number;
  /** The puzzle's 16 words (empty when done or during the countdown). */
  words: string[];
  /** Groups found, in the order you found them. */
  found: Group[];
  /** Once this puzzle is over for you: the groups you missed. */
  missed: Group[];
  mistakes: number;
  state: "play" | "reveal" | "done";
  startedAt: number;
  /** Reveal ends (auto-next) at this time. */
  nextAt: number;
  results: PuzzleResult[];
  total: number;
}

export interface BoardRow {
  id: string;
  idx: number;
  /** Groups found on the current puzzle, and over the game. */
  found: number;
  totalFound: number;
  mistakes: number;
  total: number;
  done: boolean;
  /** Seconds used over finished puzzles. */
  secs: number;
}

export interface GroupUpView {
  phase: "ready" | "play" | "over";
  startsAt: number;
  n: number;
  maxMistakes: number;
  board: BoardRow[];
  me: MyRun | null;
  watch: { id: string; run: MyRun } | null;
}

/** Private feedback on a wrong guess. */
export interface GuessEvent {
  t: "wrong" | "away" | "dupe";
}
export type GroupUpEvent = GuessEvent;
