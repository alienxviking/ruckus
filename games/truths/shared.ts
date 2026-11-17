// Truth Bombs constants, text helpers and view types (shared by server and client).

export const WRITE_MS = 300_000;
export const TALK_MS = 90_000;
export const DRUM_MS = 2_600;
export const REVEAL_MS = 30_000;
export const ABANDON_MS = 20_000;
export const MAX_LEN = 100;
export const MIN_LEN = 3;
/** Spotting the lie. */
export const SPOT_PTS = 100;
/** Per friend fooled by your lie. */
export const FOOL_PTS = 50;

export type TruthPhase = "write" | "vote" | "drum" | "reveal" | "final";

export const STATEMENT_COLORS = ["#22d3ee", "#a78bfa", "#facc15"] as const;

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

/** Strips invisible characters, collapses whitespace, trims and caps the length. */
export function cleanStatement(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return [...raw.slice(0, MAX_LEN * 4).replace(CONTROL, "").replace(/\s+/g, " ").trim()].slice(0, MAX_LEN).join("").trim();
}

/** Why this set can't be locked in, or null when it's ready. */
export function setProblem(s: readonly string[], lie: number): string | null {
  const c = s.map(cleanStatement);
  if (c.some((x) => [...x].length < MIN_LEN)) return "Write all three statements.";
  if (new Set(c.map((x) => x.toLowerCase())).size < 3) return "Make the three statements different.";
  if (!(lie >= 0 && lie <= 2)) return "Mark which one is the lie.";
  return null;
}

export interface TruthDraft {
  s: [string, string, string];
  lie: number;
  done: boolean;
}

export interface TruthSeat {
  id: string;
  score: number;
  /** Write: locked in. Vote: voted. Reveal: ready. */
  done: boolean;
  away: boolean;
  /** Has a set in this game (will present / presented). */
  writer: boolean;
}

export interface TruthReveal {
  lie: number;
  votes: Record<string, number | null>;
  pts: Record<string, number>;
  fooled: number;
  spotted: number;
}

export interface TruthAward {
  icon: string;
  title: string;
  ids: string[];
  note: string;
}

export interface TruthView {
  game: number;
  phase: TruthPhase;
  endsAt: number;
  phaseMs: number;
  seats: TruthSeat[];
  /** Write phase: your own draft (only yours). */
  draft: TruthDraft | null;
  /** Presenting order position (1-based) and how many sets. */
  turn: number;
  turns: number;
  presenter: string | null;
  statements: string[];
  /** Your vote this turn (statement index). */
  myVote: number | null;
  reveal: TruthReveal | null;
  awards: TruthAward[];
  endingAt: number | null;
  abandoned: boolean;
}

export type TruthAction =
  | { type: "save"; s: string[]; lie: number; done: boolean }
  | { type: "vote"; o: number }
  | { type: "reveal" }
  | { type: "next" };
