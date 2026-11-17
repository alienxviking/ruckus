// Memory Pairs: constants and wire types shared by server.ts and client.tsx.
// Face-down cards' faces never leave the server: views only carry faces that are showing.

export const FACES = [
  "🦊", "🐙", "🦄", "🐢", "🌵", "🍉", "🍩", "🚀", "🎈", "🌈", "⚡", "🍄", "🐝", "🦋", "🌻", "🍒",
  "🎲", "🎸", "🧩", "🪐", "🐳", "🦜", "🍋", "🧁", "🛸", "🎯", "🦀", "🐞", "🍭", "🔮", "🦖", "🌙",
] as const;

export type BoardChoice = "small" | "normal" | "large";
/** Cards on the board by size. */
export const BOARD_CARDS: Record<BoardChoice, number> = { small: 16, normal: 24, large: 36 };

/** How long two cards that don't match stay face up. */
export const SHOW_MS = 1_200;
export const TURN_MS = 15_000;
/** A disconnected player's turn is skipped after this. */
export const AWAY_MS = 2_500;
/** Solo games end after this however far you got. */
export const SOLO_MS = 6 * 60_000;
/** With nobody connected for this long, the game ends. */
export const ABANDON_MS = 30_000;

/** Solo scoring. */
export const PAIR_POINTS = 100;
export const MISS_COST = 10;
export const SECOND_COST = 1;
export const MIN_PAIR_POINTS = 10;

/** Solo score: points per pair, minus wrong guesses and seconds, never below 10 per pair found. */
export function soloScore(pairs: number, misses: number, secs: number): number {
  return Math.max(pairs * MIN_PAIR_POINTS, pairs * PAIR_POINTS - misses * MISS_COST - secs * SECOND_COST);
}

export type PairsAction = { type: "flip"; i: number };

export interface LastMove {
  seat: number;
  a: number;
  b: number;
  match: boolean;
  /** Turn-pair number, as an animation key. */
  n: number;
}

export interface PairsView {
  n: number;
  /** Per card: face index if showing (face up or claimed), -1 if face down. */
  faces: number[];
  /** Per card: seat that claimed it, -1 if unclaimed. */
  owner: number[];
  /** Face-up unclaimed cards (0–2), in flip order. */
  up: number[];
  seats: string[];
  scores: number[];
  turn: number;
  phase: "pick" | "show" | "over";
  /** Turn deadline (multiplayer), null when not counting. */
  endsAt: number | null;
  turnMs: number;
  /** Total cards turned over / wrong pairs, per seat. */
  flips: number[];
  misses: number[];
  startedAt: number;
  /** Solo: the game's hard stop. */
  soloEndsAt: number | null;
  last: LastMove | null;
  solo: boolean;
  /** Final solo score once over. */
  final: number | null;
  /** Solo: seconds the run took, once over. */
  secs: number | null;
  you: number;
}
