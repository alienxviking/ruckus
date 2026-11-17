// Nine Box: constants, scoring and wire types shared by server.ts and client.tsx.
// The solution never goes to clients while the game is on.

import type { Level, Size } from "./sudoku";

export type { Level, Size } from "./sudoku";

export const READY_MS = 3_000;
/** A participant gone this long no longer holds up the end of the game. */
export const AWAY_MS = 60_000;

/** Expected solve time (the speed bonus is full at half of it) and the hard time limit. */
export const PAR_MS: Record<Size, Record<Level, number>> = {
  9: { easy: 8 * 60_000, medium: 12 * 60_000, hard: 18 * 60_000 },
  6: { easy: 2 * 60_000, medium: 3 * 60_000, hard: 5 * 60_000 },
};
export const LIMIT_MS: Record<Size, Record<Level, number>> = {
  9: { easy: 20 * 60_000, medium: 30 * 60_000, hard: 45 * 60_000 },
  6: { easy: 8 * 60_000, medium: 10 * 60_000, hard: 15 * 60_000 },
};

export const SOLVE_POINTS = 600;
export const SPEED_POINTS = 400;
export const MISTAKE_COST = 50;
/** A solved grid never scores below this; an unsolved one at most PARTIAL_POINTS. */
export const SOLVED_FLOOR = 350;
export const PARTIAL_POINTS = 300;

/**
 * Score (higher is better): solving is worth 600, plus up to 400 for speed (full marks at half
 * the par time, nothing at the time limit), minus 50 a mistake, never below 350. An unsolved
 * grid scores up to 300 for the share of empty cells you filled.
 */
export function score(solved: boolean, ms: number, mistakes: number, filledShare: number, par: number, limit: number): number {
  if (!solved) return Math.round(PARTIAL_POINTS * Math.max(0, Math.min(1, filledShare)));
  const fast = par / 2;
  const speed = Math.max(0, Math.min(1, (limit - ms) / Math.max(1, limit - fast)));
  return Math.max(SOLVED_FLOOR, Math.round(SOLVE_POINTS + SPEED_POINTS * speed - MISTAKE_COST * mistakes));
}

export const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const LEVEL_NAME: Record<Level, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

// ---------- wire types ----------

export type NineboxAction = { type: "place"; i: number; v: number } | { type: "quit" };

export type RunStatus = "play" | "solved" | "out" | "quit" | "time";

export interface MyBoard {
  /** n*n digits, "0" = empty: the clues plus your correct entries. */
  cells: string;
  mistakes: number;
  status: RunStatus;
  /** Time used (ms) once finished. */
  ms: number;
}

export interface BoardRow {
  id: string;
  /** Share of the empty cells filled, 0..100. */
  pct: number;
  mistakes: number;
  status: RunStatus;
  /** Seconds used, once finished. */
  secs: number;
}

export interface NineboxView {
  phase: "ready" | "play" | "over";
  size: Size;
  level: Level;
  startsAt: number;
  endsAt: number;
  /** 0 = no mistake limit. */
  maxMistakes: number;
  /** n*n digits ("0" = empty). Hidden ("") during the countdown. */
  givens: string;
  board: BoardRow[];
  me: MyBoard | null;
  /** Spectators follow the leader. */
  watch: { id: string; run: MyBoard } | null;
  /** Only once the game is over. */
  solution?: string;
}

/** Private: a wrong number (it counts as a mistake). */
export interface BadEvent {
  t: "bad";
  i: number;
  v: number;
}
export type NineboxEvent = BadEvent;
