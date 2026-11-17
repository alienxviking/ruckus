// The question shape and a compact helper for writing them (choices written correct-first).
import type { Category, Difficulty } from "./shared";

export interface Question {
  q: string;
  choices: [string, string, string, string];
  answer: number;
  cat: Category;
  diff: Difficulty;
}

export function q(cat: Category, diff: Difficulty, text: string, right: string, w1: string, w2: string, w3: string): Question {
  return { q: text, choices: [right, w1, w2, w3], answer: 0, cat, diff };
}
