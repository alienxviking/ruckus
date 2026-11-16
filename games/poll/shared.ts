// Constants and tiny helpers used by both the Poll Position server and client.
// Nothing secret lives here (polls are in data.ts, server-only).

export const ROUNDS = 8;
export const VOTE_MS = 15_000;
export const PREDICT_MS = 20_000;
export const REVEAL_MS = 11_000;
/** With fewer than two participants connected for this long, the game ends with the current scores. */
export const ABANDON_MS = 20_000;

/** Prediction score: 100 minus this much per voter you placed on the wrong answer. */
export const MISS_COST = 15;
export const PRED_MAX = 100;
/** Bonus for being the only one to pick your answer (needs this many voters). */
export const WOLF_BONUS = 50;
export const WOLF_MIN_VOTERS = 4;
/** Read the room: a correct read of the spotlight player's vote. */
export const READ_PTS = 100;
/** Read the room: the spotlight player loses this much per reader they miscounted. */
export const SELF_COST = 30;
/** Majority rules: the winning side's prediction points are multiplied by this. */
export const MAJORITY_MULT = 2;

export type PollKind = "normal" | "room" | "majority";

export const OPTION_COLORS = ["#22d3ee", "#f472b6", "#facc15", "#a78bfa"] as const;
export const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

/** Voters placed on the wrong answer: half the total absolute error (both sides sum to the same total). */
export function misplaced(pred: readonly number[], counts: readonly number[]): number {
  let err = 0;
  for (let i = 0; i < counts.length; i++) err += Math.abs((pred[i] ?? 0) - counts[i]);
  return Math.ceil(err / 2);
}

export function predPoints(miss: number): number {
  return Math.max(0, PRED_MAX - MISS_COST * miss);
}

export function selfPoints(err: number): number {
  return Math.max(0, PRED_MAX - SELF_COST * err);
}

/** An even split of `total` over `n` answers (the remainder goes to the first ones). */
export function evenSplit(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Splits "🍕 Pizza" into its emoji and label. */
export function splitOption(text: string): { emoji: string; label: string } {
  const i = text.indexOf(" ");
  if (i <= 0) return { emoji: "", label: text };
  return { emoji: text.slice(0, i), label: text.slice(i + 1) };
}
