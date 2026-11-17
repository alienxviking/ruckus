// Word Wheel's puzzles and dictionary (server only).

import { PUZZLES, WORDS } from "./words";

export interface Puzzle {
  /** Index into the puzzle list (for "don't repeat" memory). */
  id: number;
  centre: string;
  ring: string[];
  /** Every accepted answer, most common first. */
  answers: string[];
}

let puzzles: string[] | null = null;
let words: string[] | null = null;

function lists() {
  if (!puzzles || !words) {
    puzzles = PUZZLES.split(" ").filter(Boolean);
    words = WORDS.split(" ").filter(Boolean);
  }
  return { puzzles, words };
}

export function puzzleCount(): number {
  return lists().puzzles.length;
}

/** Answers for a centre letter + ring: every listed word made only of those letters. */
export function answersFor(centre: string, ring: string[]): string[] {
  const set = new Set([centre, ...ring]);
  return lists().words.filter((w) => w.length >= 4 && w.includes(centre) && [...w].every((c) => set.has(c)));
}

export function makePuzzle(id: number, random: () => number): Puzzle {
  const code = lists().puzzles[id];
  const centre = code[0];
  // Ring order is part of the deal (same for everyone); each player can shuffle their own.
  const ring = [...code.slice(1)];
  for (let i = ring.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ring[i], ring[j]] = [ring[j], ring[i]];
  }
  return { id, centre, ring, answers: answersFor(centre, ring) };
}

/** `count` different puzzle ids, avoiding `recent` when it can. */
export function pickPuzzles(count: number, random: () => number, recent: Set<number>): number[] {
  const n = puzzleCount();
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    let id = 0;
    for (let attempt = 0; attempt < 200; attempt++) {
      id = Math.min(n - 1, Math.floor(random() * n));
      if (!out.includes(id) && (attempt >= 150 || !recent.has(id))) break;
    }
    out.push(id);
  }
  return out;
}
