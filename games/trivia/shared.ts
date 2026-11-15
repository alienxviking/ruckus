// Constants shared by the Trivia Rush server and client. Nothing secret lives here.

export const TOTAL_QUESTIONS = 10;
export const INTRO_MS = 3_000;
export const QUESTION_MS = 15_000;
export const REVEAL_MS = 5_000;
/** If every participant is disconnected for this long, the game ends. */
export const ABANDON_MS = 30_000;

export const BASE_POINTS = 500;
export const SPEED_POINTS = 500;
export const STREAK_STEP = 100;
export const STREAK_CAP = 300;

export const CATEGORIES = [
  "Science",
  "Space",
  "Geography",
  "History",
  "Nature & Animals",
  "Food & Drink",
  "Sports",
  "Technology",
  "Language & Words",
  "Art & Music",
  "Maths & Logic",
  "Film & Books",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const CATEGORY_EMOJI: Record<Category, string> = {
  Science: "🔬",
  Space: "🚀",
  Geography: "🌍",
  History: "🏛️",
  "Nature & Animals": "🐾",
  "Food & Drink": "🍜",
  Sports: "⚽",
  Technology: "💻",
  "Language & Words": "🔤",
  "Art & Music": "🎨",
  "Maths & Logic": "🧮",
  "Film & Books": "🎬",
};

export const LETTERS = ["A", "B", "C", "D"] as const;

/** Base points for a correct answer locked in `ms` after the question opened. */
export function speedPoints(ms: number): number {
  const frac = Math.min(1, Math.max(0, (QUESTION_MS - ms) / QUESTION_MS));
  return BASE_POINTS + Math.round(SPEED_POINTS * frac);
}

/** Bonus for a streak of `streak` correct answers in a row (counting this one). */
export function streakBonus(streak: number): number {
  return Math.min(STREAK_CAP, STREAK_STEP * Math.max(0, streak - 1));
}

/** 12345 -> "12,345" without relying on Intl (runs on Workers and in tests alike). */
export function fmt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
