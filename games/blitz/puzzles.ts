// Server-only puzzle generators. Every generator takes the game's random()
// (ctx.random) and returns what players see plus the secret answer.

import { shuffle } from "../../shared/game";
import { COUNT_SETS, FRUITS, NOT_A_SCRAMBLE, ODD_PAIRS, PAIR_POOLS, WORDS } from "./data";
import {
  CLOCK_FADE_MS,
  CLOCK_TARGET_MS,
  INKS,
  PLAY_MS,
  exprValue,
  type Expr,
  type MicroType,
  type Pick,
  type Puzzle,
} from "./shared";

export { exprValue };

export type Rand = () => number;

export interface Generated {
  pz: Puzzle;
  /** Choice/cell index, a sorted pair of cells, or an arrow sequence. Null for rank-based games. */
  answer: Pick | null;
}

/** Integer in [lo, hi]. */
export const rint = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pickOne = <T>(r: Rand, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];

/** Shuffle `answer` in with three distinct distractors; returns options and the answer's index. */
function withOptions<T>(r: Rand, answer: T, distractors: T[]): { options: T[]; index: number } {
  const options = shuffle([answer, ...distractors.slice(0, 3)], r);
  return { options, index: options.indexOf(answer) };
}

/** Up to `n` distinct positive near-miss numbers, drawn from `pool` in a random order. */
function nearMisses(r: Rand, answer: number, pool: number[], n = 3): number[] {
  const out: number[] = [];
  for (const v of shuffle(pool, r)) {
    if (out.length >= n) break;
    if (Number.isInteger(v) && v > 0 && v !== answer && !out.includes(v)) out.push(v);
  }
  // Pad with plain neighbours if the pool ran dry (tiny answers).
  for (let d = 1; out.length < n; d++) {
    for (const v of [answer + d, answer - d]) if (out.length < n && v > 0 && v !== answer && !out.includes(v)) out.push(v);
  }
  return out;
}

// ---------- 1. odd one out ----------

export function genOdd(r: Rand): Generated {
  const [a, b] = pickOne(r, ODD_PAIRS);
  const [base, odd] = r() < 0.5 ? [a, b] : [b, a];
  const cell = rint(r, 0, 24);
  const cells = Array.from({ length: 25 }, (_, i) => (i === cell ? odd : base));
  return { pz: { t: "odd", cells }, answer: cell };
}

// ---------- 2. count flash ----------

/** Scatter points on a jittered 6x4 grid so emoji never overlap. Percent coords. */
function scatter(r: Rand, n: number, cols: number, rows: number): [number, number][] {
  const slots = shuffle(
    Array.from({ length: cols * rows }, (_, i) => i),
    r,
  ).slice(0, n);
  return slots.map((i) => {
    const c = i % cols;
    const row = Math.floor(i / cols);
    const x = Math.round(((c + 0.25 + r() * 0.5) / cols) * 100);
    const y = Math.round(((row + 0.25 + r() * 0.5) / rows) * 100);
    return [x, y];
  });
}

export function genCount(r: Rand): Generated {
  const kinds = shuffle([...pickOne(r, COUNT_SETS)], r);
  const target = kinds[0];
  const n = rint(r, 4, 8);
  const n2 = rint(r, 3, 7);
  const n3 = Math.min(rint(r, 3, 7), 22 - n - n2);
  const emoji = shuffle([...Array(n).fill(kinds[0]), ...Array(n2).fill(kinds[1]), ...Array(n3).fill(kinds[2])], r) as string[];
  const pts = scatter(r, emoji.length, 6, 4);
  const field = emoji.map((e, i) => [e, pts[i][0], pts[i][1]] as [string, number, number]);
  const { options, index } = withOptions(r, n, nearMisses(r, n, [n - 2, n - 1, n + 1, n + 2]));
  return { pz: { t: "count", target, field, options }, answer: index };
}

// ---------- 3. quick maths ----------

export function genMath(r: Rand): Generated {
  const kind = rint(r, 0, 2);
  let text: string;
  let ans: number;
  let pool: number[];
  if (kind === 0) {
    const a = rint(r, 12, 59);
    const b = rint(r, 11, 49);
    ans = a + b;
    text = `${a} + ${b}`;
    pool = [ans + 10, ans - 10, ans + 1, ans - 1, ans + 2, ans - 2, ans + 9, ans - 9, ans + 11, ans - 11];
  } else if (kind === 1) {
    const a = rint(r, 31, 99);
    const b = rint(r, 11, a - 6);
    ans = a - b;
    text = `${a} − ${b}`;
    pool = [ans + 10, ans - 10, ans + 1, ans - 1, ans + 2, ans - 2, ans + 9, ans - 9, ans + 11, ans - 11];
  } else {
    const a = rint(r, 3, 9);
    const b = rint(r, 4, 12);
    ans = a * b;
    text = `${a} × ${b}`;
    pool = [ans + a, ans - a, ans + b, ans - b, ans + 1, ans - 1, ans + 2, ans - 2, ans + 10, ans - 10];
  }
  // Always include at least one "off by a little" so it can't be guessed from the last digit alone.
  const close = nearMisses(r, ans, [ans + 1, ans - 1, ans + 2, ans - 2], 1);
  const rest = nearMisses(
    r,
    ans,
    pool.filter((v) => !close.includes(v)),
    2,
  );
  const { options, index } = withOptions(r, ans, [...close, ...rest]);
  return { pz: { t: "math", text, options }, answer: index };
}

// ---------- 4. ink colour ----------

export function genInk(r: Rand): Generated {
  const all = INKS.map((_, i) => i);
  const [ink, word, ...others] = shuffle(all, r);
  // The word's own colour is always an option: that's the trap.
  const { options, index } = withOptions(r, ink, [word, ...others.slice(0, 2)]);
  return { pz: { t: "ink", word, ink, options }, answer: index };
}

// ---------- 5. stop the clock ----------

export function genClock(): Generated {
  return { pz: { t: "clock", target: CLOCK_TARGET_MS, fade: CLOCK_FADE_MS }, answer: null };
}

// ---------- 6. bigger ----------

const POWERS: [number, number][] = [];
for (let b = 2; b <= 12; b++) {
  for (let e = 2; e <= 10; e++) {
    const v = Math.pow(b, e);
    if (v <= 1100 && v >= 8) POWERS.push([b, e]);
  }
}

function bigFrac(r: Rand): [Expr, Expr] {
  for (let i = 0; i < 200; i++) {
    const b = rint(r, 3, 12);
    const d = rint(r, 3, 12);
    if (b === d) continue;
    const a = rint(r, 1, b - 1);
    const c = rint(r, 1, d - 1);
    const diff = Math.abs(a / b - c / d);
    if (diff < 0.015 || diff > 0.12) continue;
    return [
      { k: "frac", n: a, d: b },
      { k: "frac", n: c, d },
    ];
  }
  return [
    { k: "frac", n: 7, d: 9 },
    { k: "frac", n: 4, d: 5 },
  ];
}

function bigPow(r: Rand): [Expr, Expr] {
  for (let i = 0; i < 300; i++) {
    const [b1, e1] = pickOne(r, POWERS);
    const [b2, e2] = pickOne(r, POWERS);
    if (b1 === b2) continue;
    const v1 = Math.pow(b1, e1);
    const v2 = Math.pow(b2, e2);
    if (v1 === v2 || Math.max(v1, v2) / Math.min(v1, v2) > 1.6) continue;
    return [
      { k: "pow", b: b1, e: e1 },
      { k: "pow", b: b2, e: e2 },
    ];
  }
  return [
    { k: "pow", b: 2, e: 5 },
    { k: "pow", b: 5, e: 2 },
  ];
}

function fmtDecimal(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function bigDecimal(r: Rand): [Expr, Expr] {
  for (let i = 0; i < 200; i++) {
    const d = pickOne(r, [3, 6, 7, 8, 9, 11, 12]);
    const n = rint(r, 1, d - 1);
    const v = n / d;
    const delta = ((r() < 0.5 ? -1 : 1) * rint(r, 1, 5)) / 100;
    const dec = Math.round((v + delta) * 100) / 100;
    if (dec <= 0 || dec >= 1 || Math.abs(dec - v) < 0.004) continue;
    return [
      { k: "frac", n, d },
      { k: "txt", s: fmtDecimal(dec) },
    ];
  }
  return [
    { k: "frac", n: 1, d: 3 },
    { k: "txt", s: "0.3" },
  ];
}

function bigProduct(r: Rand): [Expr, Expr] {
  for (let i = 0; i < 200; i++) {
    const a = rint(r, 6, 19);
    const b = rint(r, 3, 9);
    const c = rint(r, 3, 9);
    if (c === b) continue;
    const d = Math.round((a * b) / c) + rint(r, -1, 1);
    if (d < 3 || d === a) continue;
    const gap = Math.abs(a * b - c * d);
    if (gap < 1 || gap > 8) continue;
    return [
      { k: "txt", s: `${a} × ${b}` },
      { k: "txt", s: `${c} × ${d}` },
    ];
  }
  return [
    { k: "txt", s: "13 × 4" },
    { k: "txt", s: "7 × 8" },
  ];
}

function bigPercent(r: Rand): [Expr, Expr] {
  const pcts = [10, 20, 25, 30, 40, 50, 60, 75, 80];
  const bases = [20, 40, 60, 80, 120, 160, 200, 240];
  for (let i = 0; i < 300; i++) {
    const p1 = pickOne(r, pcts);
    const p2 = pickOne(r, pcts);
    const b1 = pickOne(r, bases);
    const b2 = pickOne(r, bases);
    if (p1 === p2 || b1 === b2) continue;
    const v1 = (p1 * b1) / 100;
    const v2 = (p2 * b2) / 100;
    if (v1 === v2 || Math.abs(v1 - v2) > Math.max(v1, v2) * 0.25) continue;
    return [
      { k: "txt", s: `${p1}% of ${b1}` },
      { k: "txt", s: `${p2}% of ${b2}` },
    ];
  }
  return [
    { k: "txt", s: "30% of 80" },
    { k: "txt", s: "50% of 40" },
  ];
}

export function genBigger(r: Rand): Generated {
  const makers = [bigFrac, bigPow, bigDecimal, bigProduct, bigPercent];
  const pair = pickOne(r, makers)(r);
  const items = shuffle(pair, r) as [Expr, Expr];
  const answer = exprValue(items[0]) > exprValue(items[1]) ? 0 : 1;
  return { pz: { t: "bigger", items }, answer };
}

// ---------- 7. memory ----------

export function genMemory(r: Rand): Generated {
  const len = rint(r, 4, 5);
  const seq: number[] = [];
  while (seq.length < len) {
    const d = rint(r, 0, 3);
    // Never three of the same in a row: it reads as a glitch, not a pattern.
    if (seq.length >= 2 && seq[seq.length - 1] === d && seq[seq.length - 2] === d) continue;
    seq.push(d);
  }
  return { pz: { t: "memory", seq, len }, answer: seq.slice() };
}

// ---------- 8. tap frenzy ----------

export function genTap(): Generated {
  return { pz: { t: "tap", secs: PLAY_MS.tap / 1000 }, answer: null };
}

// ---------- 9. find the pair ----------

export function genPair(r: Rand): Generated {
  const pool = shuffle([...pickOne(r, PAIR_POOLS)], r).slice(0, 15);
  const twin = pool[rint(r, 0, 14)];
  const cells = shuffle([...pool, twin], r);
  const answer = cells.flatMap((e, i) => (e === twin ? [i] : []));
  return { pz: { t: "pair", cells }, answer };
}

// ---------- 10. majority arrows ----------

/** Counts per direction: a clear winner, but the runner-up is never far behind. */
export function majorityCounts(r: Rand, total = 30): { counts: number[]; major: number } {
  const major = rint(r, 0, 3);
  for (let i = 0; i < 500; i++) {
    const m = rint(r, 10, 12);
    const rest = total - m;
    const a = rint(r, 3, m - 2);
    const b = rint(r, 3, m - 2);
    const c = rest - a - b;
    if (c < 3 || c > m - 2) continue;
    const second = Math.max(a, b, c);
    if (second < m - 4) continue;
    const others = shuffle([a, b, c], r);
    const counts = [0, 0, 0, 0];
    counts[major] = m;
    let k = 0;
    for (let d = 0; d < 4; d++) if (d !== major) counts[d] = others[k++];
    return { counts, major };
  }
  const rest = [7, 6, 6];
  let k = 0;
  return { counts: [0, 1, 2, 3].map((d) => (d === major ? 11 : rest[k++])), major };
}

export function genArrows(r: Rand): Generated {
  const { counts, major } = majorityCounts(r);
  const dirs = shuffle(
    counts.flatMap((n, d) => Array<number>(n).fill(d)),
    r,
  );
  const pts = scatter(r, dirs.length, 6, 5);
  const arrows = dirs.map((d, i) => [d, pts[i][0], pts[i][1], rint(r, 0, 3)] as [number, number, number, number]);
  return { pz: { t: "arrows", arrows }, answer: major };
}

// ---------- 11. anagram ----------

const sorted = (w: string) => w.split("").sort().join("");

/** Letters two words share (as multisets). */
function overlap(a: string, b: string): number {
  const left = a.split("");
  let n = 0;
  for (const ch of b) {
    const i = left.indexOf(ch);
    if (i !== -1) {
      left.splice(i, 1);
      n++;
    }
  }
  return n;
}

export function scramble(r: Rand, word: string): string {
  let best = word;
  let bestFixed = Infinity;
  for (let i = 0; i < 60; i++) {
    const s = shuffle(word.split(""), r).join("");
    if (NOT_A_SCRAMBLE.has(s)) continue;
    const fixed = s.split("").filter((ch, j) => ch === word[j]).length;
    if (fixed < bestFixed) {
      best = s;
      bestFixed = fixed;
    }
    if (fixed <= 1) break;
  }
  if (best === word) best = word.slice(1) + word[0]; // pathological fallback; never a list word
  return best;
}

export function genAnagram(r: Rand): Generated {
  const word = pickOne(r, WORDS);
  const letters = scramble(r, word);
  const key = sorted(word);
  // Distractors: same length, lots of shared letters, but not an anagram of the answer.
  const near = WORDS.filter((w) => w.length === word.length && sorted(w) !== key)
    .map((w) => ({ w, o: overlap(word, w) + r() * 0.5 }))
    .sort((a, b) => b.o - a.o)
    .slice(0, 7)
    .map((x) => x.w);
  const distractors = shuffle(near, r).slice(0, 3);
  const { options, index } = withOptions(r, word, distractors);
  return { pz: { t: "anagram", letters, options }, answer: index };
}

// ---------- 12. fruit maths ----------

export function genFruit(r: Rand): Generated {
  const [x, y] = shuffle([...FRUITS], r);
  const a = rint(r, 2, 9);
  let b = rint(r, 1, 9);
  if (b === a) b = a === 9 ? 1 : a + 1;
  const triple = r() < 0.4;
  const lines = [triple ? { l: [x, x, x], r: 3 * a } : { l: [x, x], r: 2 * a }, { l: [x, y], r: a + b }];
  const roll = r();
  const [ask, ans] = roll < 0.5 ? [[y], b] : roll < 0.75 ? [[y, y], 2 * b] : [[x, y, y], a + 2 * b];
  const { options, index } = withOptions(
    r,
    ans,
    nearMisses(r, ans, [ans + 1, ans - 1, ans + 2, ans - 2, a, a + b, 2 * a, ans + a]),
  );
  return { pz: { t: "fruit", lines, ask, options }, answer: index };
}

export function generate(type: MicroType, r: Rand): Generated {
  switch (type) {
    case "odd":
      return genOdd(r);
    case "count":
      return genCount(r);
    case "math":
      return genMath(r);
    case "ink":
      return genInk(r);
    case "clock":
      return genClock();
    case "bigger":
      return genBigger(r);
    case "memory":
      return genMemory(r);
    case "tap":
      return genTap();
    case "pair":
      return genPair(r);
    case "arrows":
      return genArrows(r);
    case "anagram":
      return genAnagram(r);
    case "fruit":
      return genFruit(r);
  }
}
