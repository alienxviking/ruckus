// Server-only micro-puzzle generators. Each one takes ctx.random and is tuned
// to be read in a glance on a phone: 1-3 seconds for a sharp player.

import { shuffle } from "../../shared/game";
import { ARROW_LEN, INKS, PUZZLE_TYPES, type Puzzle, type PuzzleType } from "./shared";

type Rand = () => number;

const rint = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pickOne = <T>(r: Rand, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];

/**
 * Odd one out: look-alike pairs that are still clearly different at 28px.
 * Every emoji is Unicode 9 or older so it renders everywhere. Either side
 * can be the odd one.
 */
export const ODD_PAIRS: readonly (readonly [string, string])[] = `
  🐶/🐱 🍎/🍅 🙈/🙉 🦁/🐯 🍩/🍪 ⚽/🏀 🍋/🍊 🐸/🐢 😀/😡 🍓/🍒 🐝/🐞 👻/💀
  🍕/🌮 🐧/🐦 🔥/💧 ⭐/🌙 🌻/🌼 🐮/🐷 🐭/🐹 🌲/🌵 🙂/🙃 🐳/🐬 🚗/🚕 🎈/🎁
  🍔/🍟 🐼/🐨 😎/🤓 🦊/🐺 🍉/🥝 🐙/🦀 🍌/🌽 🎃/🍊
`
  .trim()
  .split(/\s+/)
  .map((p) => p.split("/") as [string, string]);

/** Offsets for the two wrong options: always near misses, never guessable by position. */
const SUM_MISSES: readonly [number, number][] = [
  [-1, 1],
  [1, 2],
  [-2, -1],
  [-1, 2],
  [-2, 1],
  [1, 10],
  [-10, -1],
  [-1, 10],
];

export function genSum(r: Rand): Puzzle {
  let a: number;
  let b: number;
  let op: "+" | "-";
  const roll = r();
  if (roll < 0.55) {
    op = "+";
    a = rint(r, 2, 9);
    b = rint(r, 2, 9);
  } else if (roll < 0.75) {
    op = "+";
    a = rint(r, 11, 19);
    b = rint(r, 2, 8);
  } else {
    op = "-";
    a = rint(r, 11, 19);
    b = rint(r, 2, 9);
  }
  const ans = op === "+" ? a + b : a - b;
  // Off-by-ten traps only make sense for two-digit answers (they catch last-digit guessing).
  const misses = SUM_MISSES.filter(([x, y]) => ans + x >= 0 && ans + y >= 0 && (ans >= 13 || (Math.abs(x) < 10 && Math.abs(y) < 10)));
  const [x, y] = pickOne(r, misses);
  const opts = [ans, ans + x, ans + y].sort((p, q) => p - q);
  return { t: "sum", a, b, op, opts };
}

export function genOdd(r: Rand): Puzzle {
  const [p, q] = pickOne(r, ODD_PAIRS);
  const [base, odd] = r() < 0.5 ? [p, q] : [q, p];
  const at = rint(r, 0, 8);
  return { t: "odd", cells: Array.from({ length: 9 }, (_, i) => (i === at ? odd : base)) };
}

export function genArrows(r: Rand): Puzzle {
  const seq: number[] = [];
  while (seq.length < ARROW_LEN) {
    const d = rint(r, 0, 3);
    // Never three the same: it reads like a glitch, not a pattern.
    if (seq.length === 2 && seq[0] === d && seq[1] === d) continue;
    seq.push(d);
  }
  return { t: "arrows", seq };
}

export function genInk(r: Rand): Puzzle {
  const [ink, word, other] = shuffle(
    INKS.map((_, i) => i),
    r,
  );
  // The word's own colour is always an option: that's the trap.
  return { t: "ink", word, ink, opts: shuffle([ink, word, other], r) };
}

const GEN: Record<PuzzleType, (r: Rand) => Puzzle> = { sum: genSum, odd: genOdd, arrows: genArrows, ink: genInk };

/** A fresh puzzle, never the same kind twice in a row. */
export function makePuzzle(r: Rand, last: PuzzleType | null): Puzzle {
  const type = pickOne(
    r,
    PUZZLE_TYPES.filter((t) => t !== last),
  );
  return GEN[type](r);
}
