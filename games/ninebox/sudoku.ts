// Nine Box puzzle engine: grid shapes, a fast bitmask solver, a human-style logic grader and a
// seeded generator that only ever returns puzzles with exactly one solution.
//
// Grids are flat arrays of length n*n, row by row; 0 = empty, 1..n = a digit.

export type Size = 6 | 9;
export type Level = "easy" | "medium" | "hard";

export interface Shape {
  n: number;
  /** Box height and width (6×6 uses 2-row × 3-column boxes). */
  br: number;
  bc: number;
  /** Every row, column and box, as lists of cell indices. */
  units: number[][];
  /** For each cell: its row, column and box unit indexes. */
  unitsOf: number[][];
  /** For each cell: the other cells sharing a row, column or box. */
  peers: number[][];
  boxOf: number[];
}

const shapes = new Map<Size, Shape>();

export function shapeOf(size: Size): Shape {
  const hit = shapes.get(size);
  if (hit) return hit;
  const n = size;
  const br = size === 9 ? 3 : 2;
  const bc = 3;
  const units: number[][] = [];
  for (let r = 0; r < n; r++) units.push(Array.from({ length: n }, (_, c) => r * n + c));
  for (let c = 0; c < n; c++) units.push(Array.from({ length: n }, (_, r) => r * n + c));
  const boxOf: number[] = [];
  const boxes: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n);
    const c = i % n;
    const b = Math.floor(r / br) * (n / bc) + Math.floor(c / bc);
    boxOf.push(b);
    boxes[b].push(i);
  }
  units.push(...boxes);
  const unitsOf = Array.from({ length: n * n }, (_, i) => [Math.floor(i / n), n + (i % n), 2 * n + boxOf[i]]);
  const peers = Array.from({ length: n * n }, (_, i) => {
    const set = new Set<number>();
    for (const u of unitsOf[i]) for (const j of units[u]) if (j !== i) set.add(j);
    return [...set];
  });
  const sh: Shape = { n, br, bc, units, unitsOf, peers, boxOf };
  shapes.set(size, sh);
  return sh;
}

const popcount = (m: number) => {
  let c = 0;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
};
/** The digit (1..n) of a single-bit mask. */
const digitOf = (m: number) => 31 - Math.clz32(m);

/**
 * Counts solutions up to `limit` with a most-constrained-cell backtracker. With `random`, the
 * digits are tried in a random order (used to build a fresh full grid). Returns the first
 * solution found.
 */
export function solve(grid: readonly number[], sh: Shape, limit = 2, random?: () => number): { count: number; first: number[] | null } {
  const { n } = sh;
  const g = grid.slice();
  const rows = new Array(n).fill(0);
  const cols = new Array(n).fill(0);
  const boxes = new Array(n).fill(0);
  for (let i = 0; i < n * n; i++) {
    const v = g[i];
    if (!v) continue;
    const bit = 1 << v;
    const r = Math.floor(i / n);
    const c = i % n;
    const b = sh.boxOf[i];
    if (rows[r] & bit || cols[c] & bit || boxes[b] & bit) return { count: 0, first: null };
    rows[r] |= bit;
    cols[c] |= bit;
    boxes[b] |= bit;
  }
  const full = ((1 << (n + 1)) - 1) & ~1;
  let count = 0;
  let first: number[] | null = null;
  const rec = (): void => {
    let best = -1;
    let bestMask = 0;
    let bestCount = 99;
    for (let i = 0; i < n * n; i++) {
      if (g[i]) continue;
      const m = full & ~(rows[Math.floor(i / n)] | cols[i % n] | boxes[sh.boxOf[i]]);
      const k = popcount(m);
      if (k < bestCount) {
        best = i;
        bestMask = m;
        bestCount = k;
        if (k <= 1) break;
      }
    }
    if (best < 0) {
      count++;
      if (!first) first = g.slice();
      return;
    }
    if (bestCount === 0) return;
    const digits: number[] = [];
    for (let d = 1; d <= n; d++) if (bestMask & (1 << d)) digits.push(d);
    if (random)
      for (let k = digits.length - 1; k > 0; k--) {
        const j = Math.floor(random() * (k + 1));
        [digits[k], digits[j]] = [digits[j], digits[k]];
      }
    const r = Math.floor(best / n);
    const c = best % n;
    const b = sh.boxOf[best];
    for (const d of digits) {
      const bit = 1 << d;
      g[best] = d;
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
      rec();
      rows[r] &= ~bit;
      cols[c] &= ~bit;
      boxes[b] &= ~bit;
      g[best] = 0;
      if (count >= limit) return;
    }
  };
  rec();
  return { count, first };
}

/**
 * Solves like a person would. Level 1: naked and hidden singles only. Level 2 adds locked
 * candidates (pointing / claiming), naked pairs and hidden pairs. Returns true when the grid
 * gets completely filled (which also proves the solution is unique).
 */
export function logicSolve(grid: readonly number[], sh: Shape, level: 1 | 2): boolean {
  const { n, units, peers, unitsOf } = sh;
  const N = n * n;
  const g = grid.slice();
  const full = ((1 << (n + 1)) - 1) & ~1;
  const cand = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) {
    if (g[i]) continue;
    let m = full;
    for (const p of peers[i]) if (g[p]) m &= ~(1 << g[p]);
    cand[i] = m;
  }
  let left = g.reduce((t, v) => t + (v ? 0 : 1), 0);
  const place = (i: number, d: number): boolean => {
    g[i] = d;
    cand[i] = 0;
    left--;
    const bit = 1 << d;
    for (const p of peers[i]) {
      if (!g[p] && cand[p] & bit) {
        cand[p] &= ~bit;
        if (!cand[p]) return false;
      }
    }
    return true;
  };
  for (;;) {
    if (left === 0) return true;
    let progress = false;
    // Naked singles.
    for (let i = 0; i < N; i++) {
      if (g[i] || popcount(cand[i]) !== 1) continue;
      if (!place(i, digitOf(cand[i]))) return false;
      progress = true;
    }
    if (progress) continue;
    // Hidden singles.
    for (const u of units) {
      for (let d = 1; d <= n; d++) {
        const bit = 1 << d;
        let at = -1;
        let k = 0;
        for (const i of u) {
          if (g[i] === d) {
            k = 99;
            break;
          }
          if (!g[i] && cand[i] & bit) {
            at = i;
            k++;
          }
        }
        if (k === 1) {
          if (!place(at, d)) return false;
          progress = true;
        } else if (k === 0) return false;
      }
    }
    if (progress) continue;
    if (level < 2) return false;
    // Locked candidates: a digit confined to one box-line intersection.
    for (let ui = 0; ui < units.length; ui++) {
      const u = units[ui];
      for (let d = 1; d <= n; d++) {
        const bit = 1 << d;
        const spots = u.filter((i) => !g[i] && cand[i] & bit);
        if (spots.length < 2) continue;
        // Other units every spot shares (a box for a line, a line for a box).
        for (let kind = 0; kind < 3; kind++) {
          const other = unitsOf[spots[0]][kind];
          if (other === ui || !spots.every((i) => unitsOf[i][kind] === other)) continue;
          for (const j of units[other]) {
            if (!g[j] && cand[j] & bit && !u.includes(j)) {
              cand[j] &= ~bit;
              progress = true;
            }
          }
        }
      }
    }
    if (progress) continue;
    // Naked pairs.
    for (const u of units) {
      const pairs = u.filter((i) => !g[i] && popcount(cand[i]) === 2);
      for (let a = 0; a < pairs.length; a++)
        for (let b = a + 1; b < pairs.length; b++) {
          const m = cand[pairs[a]];
          if (m !== cand[pairs[b]]) continue;
          for (const j of u) {
            if (j === pairs[a] || j === pairs[b] || g[j] || !(cand[j] & m)) continue;
            cand[j] &= ~m;
            progress = true;
          }
        }
    }
    if (progress) continue;
    // Hidden pairs.
    for (const u of units) {
      const where: number[][] = [];
      for (let d = 1; d <= n; d++) where[d] = u.filter((i) => !g[i] && cand[i] & (1 << d));
      for (let d1 = 1; d1 <= n; d1++) {
        if (where[d1].length !== 2) continue;
        for (let d2 = d1 + 1; d2 <= n; d2++) {
          if (where[d2].length !== 2 || where[d2][0] !== where[d1][0] || where[d2][1] !== where[d1][1]) continue;
          const keep = (1 << d1) | (1 << d2);
          for (const i of where[d1]) {
            if (cand[i] & ~keep) {
              cand[i] &= keep;
              progress = true;
            }
          }
        }
      }
    }
    if (!progress) return false;
  }
}

/** 1 = singles are enough, 2 = needs pairs / locked candidates, 3 = beyond that. */
export function grade(grid: readonly number[], sh: Shape): 1 | 2 | 3 {
  if (logicSolve(grid, sh, 1)) return 1;
  if (logicSolve(grid, sh, 2)) return 2;
  return 3;
}

export interface Puzzle {
  size: Size;
  level: Level;
  givens: number[];
  solution: number[];
  clues: number;
  grade: 1 | 2 | 3;
}

/** Clue targets: stop removing once a puzzle is down to this many clues. */
const TARGET: Record<Size, Record<Level, number>> = {
  9: { easy: 38, medium: 28, hard: 0 },
  6: { easy: 20, medium: 14, hard: 0 },
};

/** One attempt: dig holes in a fresh full grid while the puzzle stays solvable by logic. */
function dig(size: Size, level: Level, random: () => number): Puzzle {
  const sh = shapeOf(size);
  const N = sh.n * sh.n;
  const solution = solve(new Array(N).fill(0), sh, 1, random).first!;
  const givens = solution.slice();
  const order = Array.from({ length: N }, (_, i) => i);
  for (let k = N - 1; k > 0; k--) {
    const j = Math.floor(random() * (k + 1));
    [order[k], order[j]] = [order[j], order[k]];
  }
  // Easy stays within singles; medium and hard may need the level-2 techniques.
  const maxLevel = level === "easy" ? 1 : 2;
  const target = TARGET[size][level];
  let clues = N;
  for (const i of order) {
    if (clues <= target) break;
    const v = givens[i];
    givens[i] = 0;
    // Solvable by logic alone also means the solution is unique.
    if (logicSolve(givens, sh, maxLevel)) clues--;
    else givens[i] = v;
  }
  return { size, level, givens, solution, clues, grade: grade(givens, sh) };
}

/**
 * A fresh puzzle with exactly one solution, fully determined by `random`. Hard puzzles are dug
 * as far as logic allows and we prefer ones that need more than singles (a few tries).
 */
export function makePuzzle(size: Size, level: Level, random: () => number): Puzzle {
  if (level !== "hard") return dig(size, level, random);
  let best: Puzzle | null = null;
  for (let t = 0; t < 8; t++) {
    const p = dig(size, level, random);
    if (!best || (p.grade > best.grade) || (p.grade === best.grade && p.clues < best.clues)) best = p;
    if (best.grade >= 2) break;
  }
  return best!;
}

/** Candidates for each cell of a (partial) grid: bitmask of digits that don't clash. */
export function candidates(grid: readonly number[], sh: Shape): number[] {
  const full = ((1 << (sh.n + 1)) - 1) & ~1;
  return grid.map((v, i) => {
    if (v) return 0;
    let m = full;
    for (const p of sh.peers[i]) if (grid[p]) m &= ~(1 << grid[p]);
    return m;
  });
}
