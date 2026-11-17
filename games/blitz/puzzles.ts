// Server-only puzzle generators. Every generator takes the game's random()
// (ctx.random) and a difficulty `level` from 0 (first microgame) to 1 (the finale),
// and returns what players see plus the secret answer.

import { shuffle } from "../../shared/game";
import { CATEGORIES, COUNT_SETS, FRUITS, NOT_A_SCRAMBLE, ODD_PAIRS, PAIR_POOLS, RHYMES, SPELLINGS, WORDS } from "./data";
import {
  CLOCK_FADE_MS,
  CLOCK_TARGET_MS,
  COUNT_SHOW_MS,
  INKS,
  MEMO_LEAD_MS,
  MEMO_STEP_MS,
  PLAY_MS,
  exprValue,
  fmtTime,
  nextFits,
  type Expr,
  type MicroType,
  type Pick,
  type Puzzle,
} from "./shared";

export { exprValue };

export type Rand = () => number;

export interface Generated {
  pz: Puzzle;
  /** Choice/cell index, a sorted pair of cells, or an arrow sequence. Null for rank-based games; -1 = "don't tap". */
  answer: Pick | null;
  /** Identifies the content (a word, a sum...) so a room doesn't see it again soon. */
  key?: string;
  /** How long the puzzle is shown before answers open (count flash, memory...). */
  show?: number;
  /** Green light: ms after the start of PLAY when it turns green. Secret until then. */
  goMs?: number;
}

/** Integer in [lo, hi]. */
export const rint = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pickOne = <T>(r: Rand, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
/** Linear step from a (level 0) to b (level 1), rounded. */
const lerp = (a: number, b: number, level: number) => Math.round(a + (b - a) * Math.min(1, Math.max(0, level)));

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

// ---------- odd one out ----------

/** Grid side for the odd-one-out grid at this difficulty. */
export const oddSide = (level: number) => (level < 0.34 ? 4 : level < 0.67 ? 5 : 6);

export function genOdd(r: Rand, level = 0): Generated {
  const [a, b] = pickOne(r, ODD_PAIRS);
  const [base, odd] = r() < 0.5 ? [a, b] : [b, a];
  const n = oddSide(level) ** 2;
  const cell = rint(r, 0, n - 1);
  const cells = Array.from({ length: n }, (_, i) => (i === cell ? odd : base));
  return { pz: { t: "odd", cells }, answer: cell, key: `odd:${a}${b}` };
}

// ---------- count flash ----------

/** Scatter points on a jittered grid so emoji never overlap. Percent coords. */
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

export function genCount(r: Rand, level = 0): Generated {
  const kinds = shuffle([...pickOne(r, COUNT_SETS)], r);
  const target = kinds[0];
  const more = lerp(0, 3, level);
  const n = rint(r, 4, 8 + more);
  const n2 = rint(r, 3, 7);
  const n3 = Math.max(1, Math.min(rint(r, 3, 7), 24 - n - n2));
  const emoji = shuffle([...Array(n).fill(kinds[0]), ...Array(n2).fill(kinds[1]), ...Array(n3).fill(kinds[2])], r) as string[];
  const pts = scatter(r, emoji.length, 6, 4);
  const field = emoji.map((e, i) => [e, pts[i][0], pts[i][1]] as [string, number, number]);
  const { options, index } = withOptions(r, n, nearMisses(r, n, [n - 2, n - 1, n + 1, n + 2]));
  return { pz: { t: "count", target, field, options }, answer: index, show: COUNT_SHOW_MS - lerp(0, 500, level) };
}

// ---------- quick maths ----------

export function genMath(r: Rand, level = 0): Generated {
  const kind = rint(r, 0, 2);
  let text: string;
  let ans: number;
  let pool: number[];
  if (kind === 0) {
    const a = rint(r, 12, 59 + lerp(0, 40, level));
    const b = rint(r, 11, 49 + lerp(0, 40, level));
    ans = a + b;
    text = `${a} + ${b}`;
    pool = [ans + 10, ans - 10, ans + 1, ans - 1, ans + 2, ans - 2, ans + 9, ans - 9, ans + 11, ans - 11];
  } else if (kind === 1) {
    const a = rint(r, 31, 99 + lerp(0, 60, level));
    const b = rint(r, 11, a - 6);
    ans = a - b;
    text = `${a} − ${b}`;
    pool = [ans + 10, ans - 10, ans + 1, ans - 1, ans + 2, ans - 2, ans + 9, ans - 9, ans + 11, ans - 11];
  } else {
    const a = rint(r, 3, 9 + lerp(0, 3, level));
    const b = rint(r, 4, 12 + lerp(0, 3, level));
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
  return { pz: { t: "math", text, options }, answer: index, key: `math:${text}` };
}

// ---------- ink colour ----------

export function genInk(r: Rand): Generated {
  const all = INKS.map((_, i) => i);
  const [ink, word, ...others] = shuffle(all, r);
  // The word's own colour is always an option: that's the trap.
  const { options, index } = withOptions(r, ink, [word, ...others.slice(0, 2)]);
  return { pz: { t: "ink", word, ink, options }, answer: index };
}

// ---------- stop the clock ----------

export function genClock(): Generated {
  return { pz: { t: "clock", target: CLOCK_TARGET_MS, fade: CLOCK_FADE_MS }, answer: null };
}

// ---------- bigger ----------

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
  return { pz: { t: "bigger", items }, answer, key: `big:${JSON.stringify(items)}` };
}

// ---------- memory ----------

export function genMemory(r: Rand, level = 0): Generated {
  const len = 4 + Math.min(2, Math.floor(level * 3));
  const seq: number[] = [];
  while (seq.length < len) {
    const d = rint(r, 0, 3);
    // Never three of the same in a row: it reads as a glitch, not a pattern.
    if (seq.length >= 2 && seq[seq.length - 1] === d && seq[seq.length - 2] === d) continue;
    seq.push(d);
  }
  return { pz: { t: "memory", seq, len }, answer: seq.slice(), show: MEMO_LEAD_MS + len * MEMO_STEP_MS };
}

// ---------- tap frenzy ----------

export function genTap(): Generated {
  return { pz: { t: "tap", secs: PLAY_MS.tap / 1000 }, answer: null };
}

// ---------- find the pair ----------

export function genPair(r: Rand): Generated {
  const pool = shuffle([...pickOne(r, PAIR_POOLS)], r).slice(0, 15);
  const twin = pool[rint(r, 0, 14)];
  const cells = shuffle([...pool, twin], r);
  const answer = cells.flatMap((e, i) => (e === twin ? [i] : []));
  return { pz: { t: "pair", cells }, answer };
}

// ---------- majority arrows ----------

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

// ---------- anagram ----------

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

export function genAnagram(r: Rand, level = 0): Generated {
  // Five letters early on, mostly six later.
  const len = r() < 0.15 + level * 0.7 ? 6 : 5;
  const word = pickOne(
    r,
    WORDS.filter((w) => w.length === len),
  );
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
  return { pz: { t: "anagram", letters, options }, answer: index, key: `ana:${word}` };
}

// ---------- fruit maths ----------

export function genFruit(r: Rand, level = 0): Generated {
  const [x, y] = shuffle([...FRUITS], r);
  const a = rint(r, 2, 9 + lerp(0, 3, level));
  let b = rint(r, 1, 9 + lerp(0, 3, level));
  if (b === a) b = a === 9 ? 1 : a + 1;
  const triple = r() < 0.4;
  const lines = [triple ? { l: [x, x, x], r: 3 * a } : { l: [x, x], r: 2 * a }, { l: [x, y], r: a + b }];
  const roll = r();
  const [ask, ans] = roll < 0.5 - level * 0.3 ? [[y], b] : roll < 0.75 ? [[y, y], 2 * b] : [[x, y, y], a + 2 * b];
  const { options, index } = withOptions(
    r,
    ans,
    nearMisses(r, ans, [ans + 1, ans - 1, ans + 2, ans - 2, a, a + b, 2 * a, ans + a]),
  );
  return { pz: { t: "fruit", lines, ask, options }, answer: index };
}

// ---------- green light ----------

/** Decoy colours for the green light (never green, never the resting red). */
const DECOY_INKS = [1, 3, 4, 5];

export function genGreen(r: Rand, level = 0): Generated {
  const goMs = rint(r, 1_200, 3_400);
  // From the middle of the match on, a fake flash of another colour tempts early taps.
  const decoy: [number, number] | null =
    level > 0.3 && r() < 0.65 ? [rint(r, 500, goMs - 500), pickOne(r, DECOY_INKS)] : null;
  return { pz: { t: "green", go: null, decoy }, answer: null, goMs };
}

// ---------- simon says ----------

/** Leads that are NOT Simon: the later the microgame, the sneakier. */
const NOT_SIMON_EASY = ["", "Quick,"];
const NOT_SIMON_SNEAKY = ["Simone says:", "Simon's cat says:", "Sam says:", "Someone says:", "Simon wants you to"];
export const SIMON_SAYS = "Simon says:";

export function genSimon(r: Rand, level = 0): Generated {
  const says = r() < 0.5;
  const lead = says ? SIMON_SAYS : pickOne(r, level < 0.34 ? NOT_SIMON_EASY : [...NOT_SIMON_EASY, ...NOT_SIMON_SNEAKY, ...NOT_SIMON_SNEAKY]);
  const style: "ink" | "emoji" = r() < 0.5 ? "ink" : "emoji";
  const options =
    style === "ink"
      ? shuffle(
          INKS.map((k) => k.name),
          r,
        ).slice(0, 4)
      : shuffle([...pickOne(r, PAIR_POOLS)], r).slice(0, 4);
  const ask = rint(r, 0, 3);
  return { pz: { t: "simon", lead, ask, style, options }, answer: says ? ask : -1 };
}

// ---------- what's missing ----------

export function genGone(r: Rand, level = 0): Generated {
  const pool = shuffle([...pickOne(r, PAIR_POOLS)], r);
  const n = 5 + Math.min(2, Math.floor(level * 3));
  const shown = pool.slice(0, n);
  const missing = shown[rint(r, 0, n - 1)];
  const left = shuffle(
    shown.filter((e) => e !== missing),
    r,
  );
  // Distractors were never on screen, so the leftovers can't give the answer away.
  const { options, index } = withOptions(r, missing, pool.slice(n, n + 3));
  return {
    pz: { t: "gone", shown, left, options },
    answer: index,
    show: 2_300 - lerp(0, 600, level),
  };
}

// ---------- shades ----------

export const shadeSide = (level: number) => (level < 0.4 ? 3 : level < 0.8 ? 4 : 5);

export function genShade(r: Rand, level = 0): Generated {
  const side = shadeSide(level);
  const n = side * side;
  const ask: "dark" | "light" = r() < 0.5 ? "dark" : "light";
  const delta = lerp(14, 6, level);
  const hue = rint(r, 0, 359);
  const cells = Array.from({ length: n }, () => rint(r, 40, 64));
  const cell = rint(r, 0, n - 1);
  const others = cells.filter((_, i) => i !== cell);
  cells[cell] = ask === "dark" ? Math.min(...others) - delta : Math.max(...others) + delta;
  return { pz: { t: "shade", ask, hue, cells }, answer: cell };
}

// ---------- long lines ----------

export function genLines(r: Rand, level = 0): Generated {
  const ask: "long" | "short" = r() < 0.5 ? "long" : "short";
  const gap = lerp(12, 5, level);
  const lens: number[] = [];
  if (ask === "long") {
    const top = rint(r, 72, 92);
    lens.push(top);
    for (let i = 0; i < 3; i++) lens.push(rint(r, top - gap - 16, top - gap));
  } else {
    const low = rint(r, 30, 45);
    lens.push(low);
    for (let i = 0; i < 3; i++) lens.push(rint(r, low + gap, low + gap + 16));
  }
  const order = shuffle([0, 1, 2, 3], r);
  // Ragged left edges so you can't just compare the right-hand ends.
  const lines = order.map((i) => [lens[i], rint(r, 0, 100 - lens[i])] as [number, number]);
  return { pz: { t: "lines", ask, lines }, answer: order.indexOf(0) };
}

// ---------- number flash ----------

export function genDigits(r: Rand, level = 0): Generated {
  const len = 4 + Math.min(3, Math.floor(level * 4));
  let num = String(rint(r, 1, 9));
  while (num.length < len) {
    const d = String(rint(r, 0, 9));
    if (d === num[num.length - 1] && r() < 0.7) continue; // fewer "77"s: they make swaps invisible
    num += d;
  }
  const variants = new Set<string>();
  for (let i = 0; i < 200 && variants.size < 3; i++) {
    const ch = num.split("");
    const k = rint(r, 0, len - 1);
    if (r() < 0.55 && k < len - 1) {
      [ch[k], ch[k + 1]] = [ch[k + 1], ch[k]];
    } else {
      const v = (Number(ch[k]) + (r() < 0.5 ? 1 : 9)) % 10;
      if (k === 0 && v === 0) continue;
      ch[k] = String(v);
    }
    const s = ch.join("");
    if (s !== num && s[0] !== "0") variants.add(s);
  }
  const { options, index } = withOptions(r, num, [...variants]);
  return {
    pz: { t: "digits", num, len, options },
    answer: index,
    key: `dig:${num}`,
    show: 1_300 + len * 150 - lerp(0, 300, level),
  };
}

// ---------- spell check ----------

export function genSpell(r: Rand): Generated {
  const [word, ...wrong] = pickOne(r, SPELLINGS);
  const { options, index } = withOptions(r, word, shuffle(wrong, r));
  return { pz: { t: "spell", options }, answer: index, key: `spell:${word}` };
}

// ---------- rhyme time ----------

export function genRhyme(r: Rand, level = 0): Generated {
  const g = pickOne(
    r,
    RHYMES.filter((x) => x.words.length >= 2),
  );
  const [word, rhyme] = shuffle([...g.words], r);
  const others = shuffle(
    RHYMES.filter((x) => x !== g).flatMap((x) => x.words),
    r,
  );
  // Later on, slip in a word that looks like it rhymes but doesn't.
  const trap = level > 0.3 && g.traps.length ? [pickOne(r, g.traps)] : [];
  const { options, index } = withOptions(r, rhyme, [...trap, ...others].slice(0, 3));
  return { pz: { t: "rhyme", word, options }, answer: index, key: `rhyme:${word}` };
}

// ---------- dice duel ----------

export function genDice(r: Rand, level = 0): Generated {
  const n = level < 0.5 ? 3 : 4;
  const maxGap = level < 0.5 ? 3 : 2;
  const roll = () => Array.from({ length: n }, () => rint(r, 1, 6));
  const sum = (h: number[]) => h.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 500; i++) {
    const a = roll();
    const b = roll();
    const gap = Math.abs(sum(a) - sum(b));
    if (gap < 1 || gap > maxGap) continue;
    return { pz: { t: "dice", hands: [a, b] }, answer: sum(a) > sum(b) ? 0 : 1 };
  }
  return { pz: { t: "dice", hands: [[6, 5, 1], [4, 4, 3]] }, answer: 0 };
}

// ---------- what's next ----------

/** A short sequence with a clear rule, plus the "obvious but wrong" continuations. */
function sequence(r: Rand, level: number): { seq: number[]; ans: number; traps: number[] } {
  const kinds = ["up", "down", "double"];
  if (level > 0.25) kinds.push("gaps", "squares");
  if (level > 0.55) kinds.push("fib", "alt", "triple");
  const kind = pickOne(r, kinds);
  switch (kind) {
    case "down": {
      const d = rint(r, 3, 9 + lerp(0, 4, level));
      const a = rint(r, 5 * d, 5 * d + 30);
      const seq = [a, a - d, a - 2 * d, a - 3 * d];
      return { seq, ans: a - 4 * d, traps: [a - 4 * d + 1, a - 4 * d - 1, a - 5 * d] };
    }
    case "double": {
      const a = rint(r, 1, 6);
      const seq = [a, a * 2, a * 4, a * 8];
      return { seq, ans: a * 16, traps: [a * 8 + a * 4, a * 12, a * 16 + 2] };
    }
    case "triple": {
      const a = rint(r, 1, 3);
      const seq = [a, a * 3, a * 9, a * 27];
      return { seq, ans: a * 81, traps: [a * 54, a * 27 + a * 18, a * 81 - 3] };
    }
    case "gaps": {
      const a = rint(r, 1, 12);
      const s = rint(r, 1, 2);
      const seq = [a, a + s, a + 2 * s + 1, a + 3 * s + 3];
      // Gaps grow by one: s, s+1, s+2, then s+3.
      const ans = seq[3] + s + 3;
      return { seq, ans, traps: [seq[3] + s + 2, ans + 1, ans - 2] };
    }
    case "squares": {
      const k = rint(r, 1, 5);
      const seq = [k * k, (k + 1) ** 2, (k + 2) ** 2, (k + 3) ** 2];
      const ans = (k + 4) ** 2;
      return { seq, ans, traps: [seq[3] + (seq[3] - seq[2]), ans + 1, ans - 1] };
    }
    case "fib": {
      const a = rint(r, 1, 4);
      const b = rint(r, a, a + 4);
      const seq = [a, b, a + b, a + 2 * b, 2 * a + 3 * b];
      const ans = seq[3] + seq[4];
      return { seq, ans, traps: [seq[4] + (seq[4] - seq[3]), ans + 1, ans - 2] };
    }
    case "alt": {
      const up = rint(r, 4, 9);
      const down = rint(r, 1, up - 2);
      const a = rint(r, 2, 15);
      const seq = [a, a + up, a + up - down, a + 2 * up - down, a + 2 * up - 2 * down];
      const ans = seq[4] + up;
      return { seq, ans, traps: [seq[4] - down, ans + 1, ans - 1] };
    }
    default: {
      const d = rint(r, 2, 9 + lerp(0, 4, level));
      const a = rint(r, 1, 20);
      const seq = [a, a + d, a + 2 * d, a + 3 * d];
      return { seq, ans: a + 4 * d, traps: [a + 4 * d + 1, a + 4 * d - 1, a + 5 * d] };
    }
  }
}

export function genNext(r: Rand, level = 0): Generated {
  // Only sequences with one sensible reading: every rule that fits must agree.
  let made = sequence(r, level);
  for (let i = 0; i < 50 && !nextFits(made.seq).every((v) => v === made.ans); i++) made = sequence(r, level);
  const { seq, ans, traps } = made;
  const { options, index } = withOptions(r, ans, nearMisses(r, ans, [...traps, ans + 2, ans - 2]));
  return { pz: { t: "next", seq, options }, answer: index, key: `next:${seq.join(",")}` };
}

// ---------- what time ----------

export function genTime(r: Rand, level = 0): Generated {
  const step = level < 0.34 ? 30 : level < 0.67 ? 15 : 5;
  const h = rint(r, 1, 12);
  const m = rint(r, 0, 60 / step - 1) * step;
  const right = fmtTime(h, m);
  // Classic misreadings: hands swapped, the hour hand read as the next hour, and a nearby minute.
  const swapH = m === 0 ? 12 : m / 5;
  const swapM = (h % 12) * 5;
  const pool = [
    fmtTime(swapH, swapM),
    fmtTime((h % 12) + 1, m),
    fmtTime(h === 1 ? 12 : h - 1, m),
    fmtTime(h, (m + step) % 60),
    fmtTime(h, (m + 60 - 5) % 60),
    fmtTime(h, (m + 30) % 60),
  ];
  const distractors = [...new Set(pool.filter((t) => t !== right))];
  // The swapped-hands trap first (when it is a real misreading), then the rest at random.
  const picked = [...distractors.slice(0, 1), ...shuffle(distractors.slice(1), r)].slice(0, 3);
  const { options, index } = withOptions(r, right, picked);
  return { pz: { t: "time", h, m, options }, answer: index, key: `time:${right}` };
}

// ---------- spin stop ----------

export function genSpin(r: Rand, level = 0): Generated {
  const period = lerp(2_400, 1_400, level) + rint(r, -100, 100);
  const width = lerp(56, 30, level);
  const zone = rint(r, 0, 359);
  const start = (zone + rint(r, 120, 240)) % 360;
  const dir: 1 | -1 = r() < 0.5 ? 1 : -1;
  return { pz: { t: "spin", start, period, dir, zone, width }, answer: null };
}

// ---------- whack-a-mole ----------

export const WHACK_HOLES = 9;

export function genWhack(r: Rand, level = 0): Generated {
  const moles = 7 + Math.min(2, Math.floor(level * 3));
  const bombs = 1 + Math.min(2, Math.floor(level * 3));
  const upFor = lerp(950, 600, level);
  const total = moles + bombs;
  const begin = 300;
  const end = PLAY_MS.whack - upFor - 150;
  const step = (end - begin) / total;
  const kinds = [0, ...shuffle([...Array<0>(moles - 1).fill(0), ...Array<1>(bombs).fill(1)], r)] as (0 | 1)[];
  const out: [number, number, number, 0 | 1][] = [];
  for (let i = 0; i < total; i++) {
    const up = Math.round(begin + i * step + r() * step * 0.5);
    const down = up + upFor;
    // A hole that's free for the whole time this one is up (and not the last one used).
    const busy = new Set(out.filter(([, u, d]) => u < down + 150 && d + 150 > up).map(([h]) => h));
    if (out.length) busy.add(out[out.length - 1][0]);
    const free = Array.from({ length: WHACK_HOLES }, (_, h) => h).filter((h) => !busy.has(h));
    out.push([pickOne(r, free), up, down, kinds[i]]);
  }
  return { pz: { t: "whack", holes: WHACK_HOLES, moles: out }, answer: null };
}

/** Points per mole so a clean sweep is worth 200. */
export const molePoints = (moles: number) => Math.floor(200 / Math.max(1, moles));

// ---------- spot the difference ----------

export function genSpot(r: Rand, level = 0): Generated {
  const side = level < 0.5 ? 3 : 4;
  const n = side * side;
  const pool = shuffle([...pickOne(r, PAIR_POOLS)], r);
  const a = pool.slice(0, n);
  const b = a.slice();
  const cell = rint(r, 0, n - 1);
  // Late on, the swap is a look-alike when one exists.
  const twin = level > 0.5 ? ODD_PAIRS.find(([x, y]) => (x === a[cell] && !a.includes(y)) || (y === a[cell] && !a.includes(x))) : undefined;
  b[cell] = twin ? (twin[0] === a[cell] ? twin[1] : twin[0]) : pool[n];
  // Either grid can hold the original.
  const [left, right] = r() < 0.5 ? [a, b] : [b, a];
  return { pz: { t: "spot", a: left, b: right }, answer: cell };
}

// ---------- middle arrow ----------

export function genFlank(r: Rand, level = 0): Generated {
  const len = level < 0.5 ? 5 : 7;
  const mid = rint(r, 0, 3);
  const congruent = r() < lerp(30, 12, level) / 100;
  let arrows: number[];
  if (congruent) arrows = Array<number>(len).fill(mid);
  else if (level > 0.6 && r() < 0.5) {
    // A messy mix, but never so many of the middle one that it's a giveaway.
    arrows = Array.from({ length: len }, () => pickOne(r, [0, 1, 2, 3].filter((d) => d !== mid)));
  } else {
    const other = r() < 0.6 ? (mid + 2) % 4 : (mid + pickOne(r, [1, 3])) % 4;
    arrows = Array<number>(len).fill(other);
  }
  arrows[Math.floor(len / 2)] = mid;
  return { pz: { t: "flank", arrows }, answer: mid };
}

// ---------- odd word out ----------

export function genNotin(r: Rand, level = 0): Generated {
  const cat = pickOne(
    r,
    CATEGORIES.filter((c) => !c.hard || level > 0.3),
  );
  const members = shuffle([...cat.members], r).slice(0, 3);
  const impostor = pickOne(r, cat.impostors);
  const { options, index } = withOptions(r, impostor, members);
  return { pz: { t: "notin", ask: cat.ask, options }, answer: index, key: `notin:${cat.ask}:${impostor}` };
}

export function generate(type: MicroType, r: Rand, level = 0): Generated {
  switch (type) {
    case "odd":
      return genOdd(r, level);
    case "count":
      return genCount(r, level);
    case "math":
      return genMath(r, level);
    case "ink":
      return genInk(r);
    case "clock":
      return genClock();
    case "bigger":
      return genBigger(r);
    case "memory":
      return genMemory(r, level);
    case "tap":
      return genTap();
    case "pair":
      return genPair(r);
    case "arrows":
      return genArrows(r);
    case "anagram":
      return genAnagram(r, level);
    case "fruit":
      return genFruit(r, level);
    case "green":
      return genGreen(r, level);
    case "simon":
      return genSimon(r, level);
    case "gone":
      return genGone(r, level);
    case "shade":
      return genShade(r, level);
    case "lines":
      return genLines(r, level);
    case "digits":
      return genDigits(r, level);
    case "spell":
      return genSpell(r);
    case "rhyme":
      return genRhyme(r, level);
    case "dice":
      return genDice(r, level);
    case "next":
      return genNext(r, level);
    case "time":
      return genTime(r, level);
    case "spin":
      return genSpin(r, level);
    case "whack":
      return genWhack(r, level);
    case "spot":
      return genSpot(r, level);
    case "flank":
      return genFlank(r, level);
    case "notin":
      return genNotin(r, level);
  }
}

/**
 * Generate a puzzle the room hasn't seen lately: retries a few times while the
 * content key is in `seen`, then records the key it settled on.
 */
export function generateFresh(type: MicroType, r: Rand, level: number, seen: string[], cap = 300): Generated {
  let g = generate(type, r, level);
  for (let i = 0; i < 20 && g.key && seen.includes(g.key); i++) g = generate(type, r, level);
  if (g.key) {
    seen.push(g.key);
    if (seen.length > cap) seen.splice(0, seen.length - cap);
  }
  return g;
}
