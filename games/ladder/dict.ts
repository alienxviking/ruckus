// Word Ladder's word graph (server only). Two words are linked when they differ in exactly
// one letter. Puzzles are drawn from COMMON words only, with a goal exactly `par` steps away
// both through common words and through every accepted word (so no obscure shortcut exists).

import { COMMON4, COMMON5, EXTRA4, EXTRA5 } from "./words";

interface Lexicon {
  len: number;
  common: string[];
  commonSet: Set<string>;
  accept: Set<string>;
  /** "c_t" style wildcard pattern -> accepted words matching it. */
  buckets: Map<string, string[]>;
}

const lexicons = new Map<number, Lexicon>();

function build(len: number): Lexicon {
  const common = (len === 4 ? COMMON4 : COMMON5).split(" ").filter(Boolean);
  const extra = (len === 4 ? EXTRA4 : EXTRA5).split(" ").filter(Boolean);
  const all = [...common, ...extra];
  const buckets = new Map<string, string[]>();
  for (const w of all) {
    for (let i = 0; i < len; i++) {
      const k = w.slice(0, i) + "_" + w.slice(i + 1);
      const b = buckets.get(k);
      if (b) b.push(w);
      else buckets.set(k, [w]);
    }
  }
  return { len, common, commonSet: new Set(common), accept: new Set(all), buckets };
}

export function lexicon(len: number): Lexicon {
  let lx = lexicons.get(len);
  if (!lx) lexicons.set(len, (lx = build(len)));
  return lx;
}

export function isWord(w: string): boolean {
  return (w.length === 4 || w.length === 5) && lexicon(w.length).accept.has(w);
}

/** Accepted words one letter away (common ones only when `commonOnly`). Deterministic order. */
export function neighbours(w: string, commonOnly = false): string[] {
  const lx = lexicon(w.length);
  const out: string[] = [];
  for (let i = 0; i < w.length; i++) {
    for (const x of lx.buckets.get(w.slice(0, i) + "_" + w.slice(i + 1)) ?? []) {
      if (x !== w && (!commonOnly || lx.commonSet.has(x))) out.push(x);
    }
  }
  return out;
}

/** Breadth-first distances (and parents) from `from`. */
export function bfs(from: string, commonOnly = false): { dist: Map<string, number>; parent: Map<string, string> } {
  const dist = new Map<string, number>([[from, 0]]);
  const parent = new Map<string, string>();
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const w = queue[qi];
    const d = dist.get(w)!;
    for (const x of neighbours(w, commonOnly)) {
      if (dist.has(x)) continue;
      dist.set(x, d + 1);
      parent.set(x, w);
      queue.push(x);
    }
  }
  return { dist, parent };
}

/** Distances to `goal` over every accepted word, cached (a game reuses a handful of goals). */
const toGoal = new Map<string, Map<string, number>>();
export function distancesTo(goal: string): Map<string, number> {
  let d = toGoal.get(goal);
  if (!d) {
    if (toGoal.size > 64) toGoal.clear();
    d = bfs(goal).dist;
    toGoal.set(goal, d);
  }
  return d;
}

/**
 * The next word on a shortest ladder from `from` to `goal`, preferring common words
 * (a hint should look familiar). Null if `from` can't reach the goal.
 */
export function nextStep(from: string, goal: string): string | null {
  const dist = distancesTo(goal);
  const d = dist.get(from);
  if (d === undefined || d === 0) return null;
  const options = neighbours(from).filter((x) => dist.get(x) === d - 1);
  const lx = lexicon(from.length);
  return options.find((x) => lx.commonSet.has(x)) ?? options[0] ?? null;
}

export interface Puzzle {
  start: string;
  goal: string;
  par: number;
  /** One shortest ladder through common words, start to goal. */
  best: string[];
}

/**
 * A puzzle of `len`-letter words whose shortest solution is exactly `par` steps, chosen
 * with `random` alone (so a seeded random gives the same puzzle everywhere). Words in
 * `avoid` aren't used as start or goal. Falls back to a shorter par if it must.
 */
export function makePuzzle(len: number, par: number, random: () => number, avoid: Set<string> = new Set()): Puzzle {
  const lx = lexicon(len);
  for (let want = par; want >= 2; want--) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const start = lx.common[Math.min(lx.common.length - 1, Math.floor(random() * lx.common.length))];
      if (avoid.has(start)) continue;
      const viaCommon = bfs(start, true);
      const goals = lx.common.filter((w) => viaCommon.dist.get(w) === want && !avoid.has(w));
      if (goals.length === 0) continue;
      const goal = goals[Math.min(goals.length - 1, Math.floor(random() * goals.length))];
      // No shortcut through rarer words: the par must hold for everything we accept.
      if (bfs(start).dist.get(goal) !== want) continue;
      const best = [goal];
      for (let w = goal; w !== start; ) {
        w = viaCommon.parent.get(w)!;
        best.unshift(w);
      }
      return { start, goal, par: want, best };
    }
  }
  // Unreachable with the shipped dictionary: a one-step puzzle always exists.
  const start = lx.common[0];
  const goal = neighbours(start, true)[0];
  return { start, goal, par: 1, best: [start, goal] };
}
