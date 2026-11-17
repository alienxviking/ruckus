// Hot Seat constants and view types shared by server and client (questions live in data.ts).

/** Pick time / talk-it-out time per pace setting. */
export const PACES: Record<string, [number, number]> = {
  quick: [20_000, 20_000],
  normal: [30_000, 40_000],
  relaxed: [45_000, 60_000],
};
/** Drumroll between the last pick and the reveal. */
export const DRUM_MS = 2_800;
export const ABANDON_MS = 20_000;
/** A right prediction. */
export const READ_PTS = 100;
/** The only right prediction (with 3+ predictors). */
export const LONE_BONUS = 50;
/** The hot seat scores up to this, scaled by the share of friends who read them right. */
export const HOT_MAX = 100;

export type HotPhase = "pick" | "drum" | "reveal" | "final";

export const OPTION_COLORS = ["#22d3ee", "#f472b6", "#facc15", "#a78bfa"] as const;
export const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

export interface HotSeatInfo {
  id: string;
  score: number;
  /** Picked (hot seat) / predicted (others) this round. */
  done: boolean;
  ready: boolean;
  away: boolean;
}

export interface HotReveal {
  /** The hot seat's answer (null when they never picked). */
  answer: number | null;
  /** Each predictor's guess. */
  guesses: Record<string, number | null>;
  counts: number[];
  pts: Record<string, number>;
  right: number;
  predictors: number;
  lone: string | null;
}

export interface HotAward {
  icon: string;
  title: string;
  ids: string[];
  note: string;
}

export interface HotView {
  game: number;
  phase: HotPhase;
  round: number;
  rounds: number;
  hot: string;
  /** Next hot seat (for the "up next" line). */
  next: string | null;
  q: string;
  opts: string[];
  endsAt: number;
  phaseMs: number;
  seats: HotSeatInfo[];
  /** Your pick (hot seat) or prediction (others) this round. */
  mine: number | null;
  reveal: HotReveal | null;
  awards: HotAward[];
  endingAt: number | null;
  abandoned: boolean;
}

export type HotAction = { type: "pick"; o: number } | { type: "next" };

/** Splits "🍕 Pizza" into its emoji and label. */
export function splitOption(text: string): { emoji: string; label: string } {
  const i = text.indexOf(" ");
  if (i <= 0) return { emoji: "", label: text };
  return { emoji: text.slice(0, i), label: text.slice(i + 1) };
}
