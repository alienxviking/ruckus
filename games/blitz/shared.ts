// Constants and types used by both the Blitz server and client (no secrets here).

export const MICRO_TYPES = [
  "odd",
  "count",
  "math",
  "ink",
  "clock",
  "bigger",
  "memory",
  "tap",
  "pair",
  "arrows",
  "anagram",
  "fruit",
] as const;
export type MicroType = (typeof MICRO_TYPES)[number];

/** Microgames per match, and how many at the end count double. */
export const ROUNDS = 12;
export const DOUBLE_LAST = 3;

export const INTRO_MS = 3_000;
export const READY_MS = 1_800;
export const RESULT_MS = 2_500;

/** Length of each microgame's PLAY phase. */
export const PLAY_MS: Record<MicroType, number> = {
  odd: 6_000,
  count: 7_000,
  math: 6_000,
  ink: 5_000,
  clock: 8_000,
  bigger: 6_000,
  memory: 8_000,
  tap: 5_000,
  pair: 7_000,
  arrows: 6_000,
  anagram: 7_000,
  fruit: 8_000,
};

/** Count flash: the field shows this long, then hides and the options appear. */
export const COUNT_SHOW_MS = 2_000;
/** Memory: a short lead-in, then one arrow per step (visible for MEMO_ON_MS of it). */
export const MEMO_LEAD_MS = 300;
export const MEMO_STEP_MS = 600;
export const MEMO_ON_MS = 450;

/** Stop the clock: target time, when the counter fades out, and how far off still scores. */
export const CLOCK_TARGET_MS = 5_000;
export const CLOCK_FADE_MS = 1_500;
export const CLOCK_MAX_OFF_MS = 1_500;
/** The server trusts a client's tap time at most this far into the past. */
export const CLOCK_SLACK_MS = 1_500;

/** Tap frenzy: taps per second the server will count, and how often clients send batches. */
export const TAP_RATE = 15;
export const TAP_BATCH_MS = 200;

/** Rank-based microgames (stop the clock, tap frenzy) pay out by rank; ties share a rank. */
export const RANK_POINTS = [200, 150, 100, 75, 50, 40, 30, 25, 20, 15, 10, 5] as const;
export const rankPoints = (rank: number) => RANK_POINTS[Math.min(rank, RANK_POINTS.length) - 1] ?? 0;

export const RANKED: readonly MicroType[] = ["clock", "tap"];

export interface MicroMeta {
  icon: string;
  title: string;
  how: string;
  /** The microgame's own colour for its title card and highlights. */
  color: string;
}

export const META: Record<MicroType, MicroMeta> = {
  odd: { icon: "🔍", title: "Odd one out", how: "Tap the one emoji that's different", color: "#f472b6" },
  count: { icon: "🐟", title: "Count flash", how: "Count fast: the picture vanishes in 2 seconds", color: "#38bdf8" },
  math: { icon: "➗", title: "Quick maths", how: "Solve it. Faster answers score more", color: "#fbbf24" },
  ink: { icon: "🎨", title: "Ink colour", how: "Tap the colour of the INK, not the word", color: "#a78bfa" },
  clock: { icon: "⏱️", title: "Stop the clock", how: "Stop at exactly 5.00s. The timer fades out fast", color: "#fb7185" },
  bigger: { icon: "⚖️", title: "Bigger", how: "Tap whichever is bigger", color: "#34d399" },
  memory: { icon: "🧠", title: "Memory", how: "Watch the arrows, then repeat them", color: "#c084fc" },
  tap: { icon: "👆", title: "Tap frenzy", how: "Tap as fast as you can for 5 seconds", color: "#fb923c" },
  pair: { icon: "🧦", title: "Find the pair", how: "One emoji appears twice. Tap both", color: "#2dd4bf" },
  arrows: { icon: "🧭", title: "Majority", how: "Which way do most arrows point?", color: "#60a5fa" },
  anagram: { icon: "🔤", title: "Anagram", how: "Unscramble the letters", color: "#facc15" },
  fruit: { icon: "🍉", title: "Fruit maths", how: "Work out what the fruit is worth", color: "#4ade80" },
};

/** Ink colours: always shown with their names, never as swatches alone. */
export const INKS = [
  { name: "Red", hex: "#f43f5e" },
  { name: "Blue", hex: "#3b82f6" },
  { name: "Green", hex: "#22c55e" },
  { name: "Yellow", hex: "#facc15" },
  { name: "Purple", hex: "#a855f7" },
  { name: "Orange", hex: "#f97316" },
] as const;

/** Directions: 0 up, 1 right, 2 down, 3 left. */
export const DIR_NAMES = ["Up", "Right", "Down", "Left"] as const;
/** Colours for the majority-arrows field (noise only, never meaningful). */
export const ARROW_COLORS = ["#f472b6", "#38bdf8", "#facc15", "#4ade80"] as const;

/** A number shape for "Bigger": a fraction, a power, or plain text like "0.35" or "13 × 4". */
export type Expr = { k: "frac"; n: number; d: number } | { k: "pow"; b: number; e: number } | { k: "txt"; s: string };

/** The numeric value of a "Bigger" expression. */
export function exprValue(e: Expr): number {
  if (e.k === "frac") return e.n / e.d;
  if (e.k === "pow") return Math.pow(e.b, e.e);
  const s = e.s;
  let m = /^(\d+) × (\d+)$/.exec(s);
  if (m) return Number(m[1]) * Number(m[2]);
  m = /^(\d+)% of (\d+)$/.exec(s);
  if (m) return (Number(m[1]) * Number(m[2])) / 100;
  return Number(s);
}

/** What PLAY and RESULT show of a microgame. Never contains the answer itself. */
export type Puzzle =
  | { t: "odd"; cells: string[] }
  | {
      t: "count";
      target: string;
      /** [emoji, x%, y%]; only while the flash is showing (and again in RESULT). */
      field: [string, number, number][] | null;
      /** Only once the flash is over. */
      options: number[] | null;
    }
  | { t: "math"; text: string; options: number[] }
  | { t: "ink"; word: number; ink: number; options: number[] }
  | { t: "clock"; target: number; fade: number }
  | { t: "bigger"; items: [Expr, Expr] }
  | {
      t: "memory";
      /** The arrows, only while they're being shown (and again in RESULT). */
      seq: number[] | null;
      len: number;
    }
  | { t: "tap"; secs: number }
  | { t: "pair"; cells: string[] }
  /** [direction, x%, y%, colour index] */
  | { t: "arrows"; arrows: [number, number, number, number][] }
  | { t: "anagram"; letters: string; options: string[] }
  | { t: "fruit"; lines: { l: string[]; r: number }[]; ask: string[]; options: number[] };

/** A player's answer: a choice/cell index, a pair of cells, or an arrow sequence. */
export type Pick = number | number[];

export interface ResLine {
  id: string;
  /** true = scored, false = tried and missed, null = didn't answer. */
  ok: boolean | null;
  pts: number;
  pick: Pick | null;
  /** Stop the clock: the stopped time in ms. Tap frenzy: taps counted. */
  v: number | null;
  /** Rank-based microgames only. */
  rank: number | null;
  /** Answered in ms after answering opened (choice games). */
  ms: number | null;
}

export interface RoundResult {
  type: MicroType;
  double: boolean;
  /** The right answer (null for rank-based microgames). */
  answer: Pick | null;
  res: ResLine[];
}

export interface RecapEntry {
  type: MicroType;
  double: boolean;
  /** Who scored most in that microgame (empty when nobody scored). */
  best: string[];
  pts: number;
}

export function fmtPoints(n: number): string {
  return n.toLocaleString("en-US");
}

/** "4.97s" */
export function fmtSecs(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(2)}s`;
}
