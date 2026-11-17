// Code Word: constants, scoring, the marking rule and wire types shared by server.ts and
// client.tsx. The word lists (words.ts) are server only.

export const READY_MS = 3_000;
/** Pause between words, while your result (and the answer) is on screen. */
export const BETWEEN_MS = 4_000;
/** Backstop clock per word, so nobody can hold the race up forever. */
export const WORD_MS = 240_000;
/** A participant gone this long no longer holds up the end of the game. */
export const AWAY_MS = 30_000;
export const MAX_GUESSES = 6;
export const LEN = 5;

/** Points for cracking a word in `used` guesses: 600 for one, down to 100 for six. */
export const crackPoints = (used: number) => 100 * (MAX_GUESSES + 1 - used);
/** Speed bonus: up to 50, melting away over the first two minutes of the word. */
export const SPEED_MAX = 50;
export const SPEED_MS = 120_000;
export function speedBonus(ms: number): number {
  return Math.round(SPEED_MAX * Math.max(0, Math.min(1, 1 - ms / SPEED_MS)));
}
export function wordScore(ok: boolean, used: number, ms: number): number {
  return ok ? crackPoints(used) + speedBonus(ms) : 0;
}

/**
 * Marks a guess against the answer: "2" right letter right spot, "1" in the word somewhere
 * else, "0" not in it (or every copy of it is already accounted for). Repeated letters are
 * handled like a person would: exact matches claim their copies first, then left to right.
 */
export function markGuess(guess: string, answer: string): string {
  const out = Array<string>(guess.length).fill("0");
  const left = new Map<string, number>();
  for (let i = 0; i < answer.length; i++) {
    if (guess[i] === answer[i]) out[i] = "2";
    else left.set(answer[i], (left.get(answer[i]) ?? 0) + 1);
  }
  for (let i = 0; i < guess.length; i++) {
    if (out[i] === "2") continue;
    const n = left.get(guess[i]) ?? 0;
    if (n > 0) {
      out[i] = "1";
      left.set(guess[i], n - 1);
    }
  }
  return out.join("");
}

const ORD = ["1st", "2nd", "3rd", "4th", "5th"];

/**
 * Hard mode: every hint revealed so far must be used. Returns why `w` breaks the rule, or
 * null when it's fine. (Greens stay put; yellows and greens must be in the word as often
 * as they've been shown.)
 */
export function hardProblem(w: string, guesses: string[], marks: string[]): string | null {
  const need = new Map<string, number>();
  for (let g = 0; g < guesses.length; g++) {
    const guess = guesses[g];
    const mark = marks[g];
    const seen = new Map<string, number>();
    for (let i = 0; i < guess.length; i++) {
      if (mark[i] === "2" && w[i] !== guess[i]) return `${ORD[i]} letter must be ${guess[i].toUpperCase()}`;
      if (mark[i] !== "0") seen.set(guess[i], (seen.get(guess[i]) ?? 0) + 1);
    }
    for (const [ch, n] of seen) need.set(ch, Math.max(need.get(ch) ?? 0, n));
  }
  for (const [ch, n] of need) {
    let have = 0;
    for (const c of w) if (c === ch) have++;
    if (have < n) return n > 1 ? `Use ${n} ${ch.toUpperCase()}s` : `Your guess must use ${ch.toUpperCase()}`;
  }
  return null;
}

// ---------- wire types ----------

export type CodeAction = { type: "guess"; p: number; w: string } | { type: "giveup"; p: number };

export interface WordResult {
  ok: boolean;
  /** Guesses used. */
  used: number;
  secs: number;
  pts: number;
  /** The secret word (only ever sent to you once you've finished it). */
  answer: string;
  guesses: string[];
  marks: string[];
}

export interface MyRun {
  /** Current word (= results.length); n when done. */
  idx: number;
  guesses: string[];
  marks: string[];
  /** When this word's clock starts (in the future during the between-words pause). */
  startedAt: number;
  endsAt: number;
  results: WordResult[];
  total: number;
  done: boolean;
}

export interface BoardRow {
  id: string;
  idx: number;
  /** Colour patterns of their current word's guesses (never letters). */
  rows: string[];
  total: number;
  /** Per finished word: cracked, and in how many guesses. */
  past: { ok: boolean; used: number }[];
  done: boolean;
}

export interface CodeView {
  phase: "ready" | "play" | "over";
  startsAt: number;
  /** Words in this game. */
  n: number;
  hard: boolean;
  board: BoardRow[];
  /** The viewer's own run (null for spectators). */
  me: MyRun | null;
}

/** Private: the server refused a guess. */
export interface NoEvent {
  t: "no";
  w: string;
  why: "len" | "word" | "hard" | "used";
  /** Hard mode: which hint was ignored. */
  msg?: string;
}
export type CodeEvent = NoEvent;
