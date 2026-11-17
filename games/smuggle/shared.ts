// Word Smuggler constants shared by server and client (nothing secret here; cards live in data.ts).

export const TURN_MS = 60_000;
/** The "up next" screen starts the turn by itself after this long. */
export const READY_MS = 45_000;
/** Each team gets at least this many turns, even with small teams. */
export const MIN_TEAM_TURNS = 3;
/** With fewer than two players connected for this long, the game ends. */
export const ABANDON_MS = 20_000;
/** Points: a smuggled word, and the cost of a buzz. */
export const GOT_PTS = 1;
export const BUZZ_COST = 1;
/** Resolved words kept in the on-screen log for one turn. */
export const LOG_MAX = 40;

export type SmugglePhase = "ready" | "turn" | "final";
export type SmuggleRole = "describer" | "guesser" | "buzzer" | "watch";
export type SmuggleResult = "got" | "skip" | "buzz" | "time";

export interface SmuggleLogEntry {
  w: string;
  r: SmuggleResult;
  /** Who buzzed (for "buzz"). */
  by?: string;
}

export interface SmuggleTurnSummary {
  team: number;
  describer: string;
  log: SmuggleLogEntry[];
  /** Net points this turn. */
  pts: number;
}

export interface SmuggleAward {
  icon: string;
  title: string;
  ids: string[];
  note: string;
}

export interface SmuggleView {
  game: number;
  phase: SmugglePhase;
  /** 1-based turn number and total turns. */
  turn: number;
  turns: number;
  /** Describing team (0/1) and describer this turn (or next, in "ready"). */
  team: number;
  describer: string;
  endsAt: number;
  phaseMs: number;
  teams: [string[], string[]];
  score: [number, number];
  role: SmuggleRole;
  /** The live card: only for the describer and the opposing team, only during a turn. */
  card: { n: number; w: string; ban: string[] } | null;
  /** Card number (everyone gets it, so guessers can animate a new card). */
  cardNo: number;
  /** Words resolved so far this turn. */
  log: SmuggleLogEntry[];
  /** The previous turn, for the "up next" screen. */
  last: SmuggleTurnSummary | null;
  away: string[];
  custom: boolean;
  awards: SmuggleAward[];
  winner: number | null;
  endingAt: number | null;
  abandoned: boolean;
}

export type SmuggleAction =
  | { type: "start" }
  | { type: "got"; n: number }
  | { type: "skip"; n: number }
  | { type: "buzz"; n: number };

/** One-shot events for sound and flashes. */
export type SmuggleEvent =
  | { k: "got"; w: string }
  | { k: "skip"; w: string }
  | { k: "buzz"; w: string; by: string }
  | { k: "start" }
  | { k: "time" };
