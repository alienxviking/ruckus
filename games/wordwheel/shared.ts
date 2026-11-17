// Word Wheel: constants, scoring and wire types shared by server.ts and client.tsx.
// The puzzles and the word list (words.ts) are server only.

export const READY_MS = 3_000;
/** Pause between puzzles, while the missed words are on show. */
export const BETWEEN_MS = 10_000;
/** A participant gone this long no longer holds up an early finish. */
export const AWAY_MS = 30_000;
export const MIN_LEN = 4;
export const MAX_LEN = 15;
/** Bonus for a word that uses all seven letters. */
export const ALL_SEVEN_BONUS = 7;

/** True when `w` uses every one of the seven letters. */
export function usesAll(w: string, letters: string): boolean {
  for (const ch of letters) if (!w.includes(ch)) return false;
  return true;
}

/** 4 letters: 1 point; longer: its length; all seven letters: +7 on top. */
export function wordPoints(w: string, letters: string): number {
  const base = w.length <= MIN_LEN ? 1 : w.length;
  return base + (usesAll(w, letters) ? ALL_SEVEN_BONUS : 0);
}

// ---------- wire types ----------

export type WheelAction = { type: "word"; r: number; w: string } | { type: "finish"; r: number };

export interface RoundSummary {
  words: number;
  pts: number;
}

export interface MyWheel {
  /** Words found this puzzle, in the order found. */
  found: string[];
  pts: number;
  /** Points over all puzzles so far (this one included). */
  total: number;
  /** Pressed "I'm done" on this puzzle. */
  finished: boolean;
  history: RoundSummary[];
}

export interface WheelRow {
  id: string;
  words: number;
  pts: number;
  total: number;
  finished: boolean;
  /** Found an all-seven word this puzzle. */
  seven: boolean;
}

export interface WheelView {
  phase: "ready" | "play" | "between" | "over";
  /** Current puzzle, 0-based. */
  round: number;
  rounds: number;
  startsAt: number;
  endsAt: number;
  roundMs: number;
  centre: string;
  /** The six outer letters (shuffle is per viewer, on the client). */
  ring: string[];
  /** How many words this puzzle has, and the points they're worth. */
  count: number;
  maxPts: number;
  sevens: number;
  me: MyWheel | null;
  board: WheelRow[];
  /** After a puzzle ends: every answer, most common first. */
  answers: string[] | null;
}

export interface NoEvent {
  t: "no";
  w: string;
  why: "short" | "centre" | "letters" | "word" | "dup";
}
export interface OkEvent {
  t: "ok";
  w: string;
  pts: number;
  seven: boolean;
}
/** Public: someone found an all-seven word. */
export interface SevenEvent {
  t: "seven";
  id: string;
}
export type WheelEvent = NoEvent | OkEvent | SevenEvent;
