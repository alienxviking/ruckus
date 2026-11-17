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
  "green",
  "simon",
  "gone",
  "shade",
  "lines",
  "digits",
  "spell",
  "rhyme",
  "dice",
  "next",
  "time",
  "spin",
  "whack",
  "spot",
  "flank",
  "notin",
] as const;
export type MicroType = (typeof MICRO_TYPES)[number];

/** Microgames per match (default), and how many at the end count double. */
export const ROUNDS = 12;
export const DOUBLE_LAST = 3;

export const INTRO_MS = 3_000;
export const READY_MS = 1_800;
/** Extra READY time when a twist or the boss round is announced, so the card can be read. */
export const TWIST_READY_MS = 1_000;
export const RESULT_MS = 2_500;

/** Length of each microgame's PLAY phase (before pace, difficulty and twists). */
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
  green: 5_200,
  simon: 4_000,
  gone: 6_500,
  shade: 5_000,
  lines: 5_000,
  digits: 6_000,
  spell: 6_000,
  rhyme: 6_000,
  dice: 5_500,
  next: 7_000,
  time: 6_000,
  spin: 5_000,
  whack: 5_000,
  spot: 6_500,
  flank: 4_500,
  notin: 6_000,
};

/** Microgames with a fixed length: pace, difficulty and the speed twist never change them. */
export const FIXED_LENGTH: readonly MicroType[] = ["clock", "tap", "green", "spin", "whack", "simon"];

/** Later microgames get up to this much less answering time (at difficulty 1). */
export const LEVEL_SQUEEZE = 0.15;

/** Count flash: the field shows this long (less at higher difficulty), then hides and the options appear. */
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

/** Green light: reactions this fast (incl. network) score the full 200; this slow scores 100. */
export const GREEN_FAST_MS = 300;
export const GREEN_SLOW_MS = 1_000;

/** Whack-a-mole: a hit still counts this long after the mole ducks (network grace). */
export const WHACK_GRACE_MS = 300;
export const WHACK_BOMB_PENALTY = 60;

/** Simon says: holding still when Simon didn't say it scores this (before multipliers). */
export const SIMON_HOLD_POINTS = 150;

/** Rank-based microgames (stop the clock, tap frenzy) pay out by rank; ties share a rank. */
export const RANK_POINTS = [200, 150, 100, 75, 50, 40, 30, 25, 20, 15, 10, 5] as const;
export const rankPoints = (rank: number) => RANK_POINTS[Math.min(rank, RANK_POINTS.length) - 1] ?? 0;

export const RANKED: readonly MicroType[] = ["clock", "tap"];

export type MicroGroup = "brainy" | "reflex";

export interface MicroMeta {
  icon: string;
  title: string;
  how: string;
  /** The microgame's own colour for its title card and highlights. */
  color: string;
  group: MicroGroup;
}

export const META: Record<MicroType, MicroMeta> = {
  odd: { icon: "🔍", title: "Odd one out", how: "Tap the one emoji that's different", color: "#f472b6", group: "reflex" },
  count: { icon: "🐟", title: "Count flash", how: "Count fast: the picture vanishes in 2 seconds", color: "#38bdf8", group: "brainy" },
  math: { icon: "➗", title: "Quick maths", how: "Solve it. Faster answers score more", color: "#fbbf24", group: "brainy" },
  ink: { icon: "🎨", title: "Ink colour", how: "Tap the colour of the INK, not the word", color: "#a78bfa", group: "reflex" },
  clock: { icon: "⏱️", title: "Stop the clock", how: "Stop at exactly 5.00s. The timer fades out fast", color: "#fb7185", group: "reflex" },
  bigger: { icon: "⚖️", title: "Bigger", how: "Tap whichever is bigger", color: "#34d399", group: "brainy" },
  memory: { icon: "🧠", title: "Memory", how: "Watch the arrows, then repeat them", color: "#c084fc", group: "brainy" },
  tap: { icon: "👆", title: "Tap frenzy", how: "Tap as fast as you can for 5 seconds", color: "#fb923c", group: "reflex" },
  pair: { icon: "🧦", title: "Find the pair", how: "One emoji appears twice. Tap both", color: "#2dd4bf", group: "reflex" },
  arrows: { icon: "🧭", title: "Majority", how: "Which way do most arrows point?", color: "#60a5fa", group: "reflex" },
  anagram: { icon: "🔤", title: "Anagram", how: "Unscramble the letters", color: "#facc15", group: "brainy" },
  fruit: { icon: "🍉", title: "Fruit maths", how: "Work out what the fruit is worth", color: "#4ade80", group: "brainy" },
  green: { icon: "🚦", title: "Green light", how: "Wait for GREEN, then tap. Too early and you're out", color: "#22c55e", group: "reflex" },
  simon: { icon: "🗣️", title: "Simon says", how: "Only tap if Simon says so. Otherwise, hands off!", color: "#f59e0b", group: "reflex" },
  gone: { icon: "🕳️", title: "What's missing?", how: "Remember the emoji. One will vanish", color: "#e879f9", group: "brainy" },
  shade: { icon: "🔲", title: "Shades", how: "Find the darkest (or lightest) square", color: "#94a3b8", group: "reflex" },
  lines: { icon: "📏", title: "Long lines", how: "Tap the longest (or shortest) line", color: "#f97316", group: "reflex" },
  digits: { icon: "🔢", title: "Number flash", how: "Remember the number. It vanishes fast", color: "#818cf8", group: "brainy" },
  spell: { icon: "📝", title: "Spell check", how: "Tap the one that's spelled right", color: "#10b981", group: "brainy" },
  rhyme: { icon: "🎵", title: "Rhyme time", how: "Tap the word that rhymes", color: "#ec4899", group: "brainy" },
  dice: { icon: "🎲", title: "Dice duel", how: "Which hand of dice adds up to more?", color: "#ef4444", group: "brainy" },
  next: { icon: "🔮", title: "What's next?", how: "Spot the pattern, pick the next number", color: "#a3e635", group: "brainy" },
  time: { icon: "🕰️", title: "What time?", how: "Read the clock. Watch the short hand!", color: "#0ea5e9", group: "brainy" },
  spin: { icon: "🎯", title: "Spin stop", how: "Stop the needle inside the green zone", color: "#14b8a6", group: "reflex" },
  whack: { icon: "🔨", title: "Whack-a-mole", how: "Whack the moles. Never the bombs!", color: "#d97706", group: "reflex" },
  spot: { icon: "👀", title: "Spot the difference", how: "One square differs between the two grids. Tap it", color: "#f43f5e", group: "reflex" },
  flank: { icon: "🏹", title: "Middle arrow", how: "Which way does the MIDDLE arrow point?", color: "#06b6d4", group: "reflex" },
  notin: { icon: "🙅", title: "Odd word out", how: "Tap the one that doesn't belong", color: "#eab308", group: "brainy" },
};

// ---------- host options ----------

export type Mix = "all" | "brainy" | "reflex" | "chaos";
export type Finale = "double" | "boss" | "none";

/** Which microgames a mix draws from. */
export function kindsFor(mix: Mix): MicroType[] {
  if (mix === "brainy" || mix === "reflex") return MICRO_TYPES.filter((t) => META[t].group === mix);
  return [...MICRO_TYPES];
}

/** Points multiplier from the finale setting alone (twists can add a ×2 elsewhere). */
export function finaleMult(round: number, rounds: number, finale: Finale): number {
  if (finale === "double") return round > rounds - DOUBLE_LAST ? 2 : 1;
  if (finale === "boss") return round === rounds ? 3 : 1;
  return 1;
}

// ---------- twists ----------

export type Twist = "reverse" | "speed" | "double";

export const TWISTS: Record<Twist, { icon: string; title: string; how: string; color: string }> = {
  reverse: { icon: "🔄", title: "Reverse!", how: "Tap a WRONG answer. The right one is the trap", color: "#f43f5e" },
  speed: { icon: "⚡", title: "Speed up!", how: "Way less time on the clock", color: "#facc15" },
  double: { icon: "💎", title: "Double points!", how: "This one is worth ×2", color: "#38bdf8" },
};
/** The speed twist's answering-time multiplier. */
export const SPEED_SCALE = 0.6;

/** Microgames that make sense backwards ("tap a wrong answer"). */
export const REVERSIBLE: readonly MicroType[] = [
  "math", "ink", "bigger", "arrows", "lines", "dice", "rhyme", "spell", "flank", "time", "count", "fruit", "next", "anagram", "notin", "digits",
];

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

/** Spin stop: the needle's angle (degrees, 0 = top, clockwise) `ms` after it starts. */
export function spinAngle(pz: { start: number; period: number; dir: 1 | -1 }, ms: number): number {
  const a = pz.start + pz.dir * 360 * (ms / pz.period);
  return ((a % 360) + 360) % 360;
}
/** Smallest distance between two angles in degrees (0-180). */
export function angleGap(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}

/** Every simple rule a number sequence fits, and the next number each predicts. */
export function nextFits(seq: number[]): number[] {
  const out: number[] = [];
  const d = seq.slice(1).map((v, i) => v - seq[i]);
  const last = seq[seq.length - 1];
  if (d.every((x) => x === d[0])) out.push(last + d[0]);
  if (seq.every((v) => v !== 0)) {
    const q = seq[1] / seq[0];
    if (Number.isInteger(q) && seq.every((v, i) => i === 0 || v === seq[i - 1] * q)) out.push(last * q);
  }
  if (seq.length >= 3 && seq.every((v, i) => i < 2 || v === seq[i - 1] + seq[i - 2])) out.push(last + seq[seq.length - 2]);
  const dd = d.slice(1).map((v, i) => v - d[i]);
  if (dd.length && dd.every((x) => x === dd[0])) out.push(last + d[d.length - 1] + dd[0]);
  if (d.length >= 3 && d.every((x, i) => x === d[i % 2])) out.push(last + d[d.length % 2]);
  return out;
}

/** Analogue clock text, "3:05". */
export const fmtTime = (h: number, m: number) => `${h}:${String(m).padStart(2, "0")}`;

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
  | { t: "fruit"; lines: { l: string[]; r: number }[]; ask: string[]; options: number[] }
  /**
   * Green light. `go` is the server time it turned green (null until it has). `decoy` is a
   * harmless flash of another colour [ms after the start, ink index] that tempts early taps.
   */
  | { t: "green"; go: number | null; decoy: [number, number] | null }
  /** Simon says: tap options[ask], but only when `lead` is exactly "Simon says:". `style` picks how the options look. */
  | { t: "simon"; lead: string; ask: number; style: "ink" | "emoji"; options: string[] }
  /** What's missing: `shown` during the show, then `left` (one gone, shuffled) and options. */
  | { t: "gone"; shown: string[] | null; left: string[] | null; options: string[] | null }
  /** Shades: lightness % per cell of one hue. */
  | { t: "shade"; ask: "dark" | "light"; hue: number; cells: number[] }
  /** Lines: [length %, left offset %] per line. */
  | { t: "lines"; ask: "long" | "short"; lines: [number, number][] }
  | { t: "digits"; num: string | null; len: number; options: string[] | null }
  | { t: "spell"; options: string[] }
  | { t: "rhyme"; word: string; options: string[] }
  | { t: "dice"; hands: [number[], number[]] }
  | { t: "next"; seq: number[]; options: number[] }
  | { t: "time"; h: number; m: number; options: string[] }
  /** Spin stop: needle start angle, ms per turn, direction; zone centre and width in degrees. */
  | { t: "spin"; start: number; period: number; dir: 1 | -1; zone: number; width: number }
  /** Whack-a-mole: [hole, up ms, down ms, 1 = bomb] measured from the start of PLAY. */
  | { t: "whack"; holes: number; moles: [number, number, number, 0 | 1][] }
  /** Spot the difference: two square grids, one cell differs. */
  | { t: "spot"; a: string[]; b: string[] }
  /** Middle arrow: a row of directions; the middle one is asked about. */
  | { t: "flank"; arrows: number[] }
  /** Odd word out: "Which is NOT {ask}?" options are "emoji Name". */
  | { t: "notin"; ask: string; options: string[] };

/** Choices accepted by "pick" for a puzzle (exclusive upper bound; 0 = not a pick game). */
export function pickRange(pz: Puzzle): number {
  switch (pz.t) {
    case "odd":
    case "shade":
      return pz.cells.length;
    case "spot":
      return pz.a.length;
    case "bigger":
    case "dice":
      return 2;
    case "arrows":
    case "flank":
    case "simon":
      return 4;
    case "lines":
      return pz.lines.length;
    case "count":
    case "math":
    case "ink":
    case "anagram":
    case "fruit":
    case "gone":
    case "digits":
    case "spell":
    case "rhyme":
    case "next":
    case "time":
    case "notin":
      return pz.options?.length ?? 0;
    default:
      return 0;
  }
}

/** A player's answer: a choice/cell index, a pair of cells, or an arrow sequence. */
export type Pick = number | number[];

export interface ResLine {
  id: string;
  /** true = scored, false = tried and missed, null = didn't answer. */
  ok: boolean | null;
  pts: number;
  pick: Pick | null;
  /** Stop the clock: stopped ms. Tap frenzy: taps. Spin: needle angle. Whack: moles hit. */
  v: number | null;
  /** Rank-based microgames only. */
  rank: number | null;
  /** Answered in ms after answering opened (choice games); green light: reaction time. */
  ms: number | null;
}

export interface RoundResult {
  type: MicroType;
  double: boolean;
  /** Points multiplier (1, 2 or 3). */
  mult: number;
  twist: Twist | null;
  /** The right answer (null for rank-based microgames; -1 = "don't tap" in Simon says). */
  answer: Pick | null;
  res: ResLine[];
}

export interface RecapEntry {
  type: MicroType;
  double: boolean;
  mult: number;
  twist: Twist | null;
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
