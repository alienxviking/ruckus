// Constants, wire types and helpers shared by Tug of War's server and client.
// Nothing secret lives here: this file ships to browsers.

// ---------- timing ----------

export const TICK_MS = 100;
/** The first countdown is longer: it shows the teams. */
export const FIRST_COUNTDOWN_MS = 5_000;
export const COUNTDOWN_MS = 3_500;
export const ROUND_MS = 30_000;
/** The last stretch of a round: every pull counts FRENZY_MULT times. */
export const FRENZY_MS = 8_000;
export const FRENZY_MULT = 1.6;
export const ROUND_OVER_MS = 4_200;
/** With a whole team gone for this long, the other team wins. */
export const ABANDON_MS = 12_000;
/** Even when nothing moves, a snapshot goes out this often. */
export const HEARTBEAT_MS = 1_000;

// ---------- the rope ----------

/** The flag starts at 0; at -LINE Red has won the round, at +LINE Blue has. */
export const LINE = 100;
/** Pulling back from your own side of the pit is up to this much stronger (at the line): enough to claw back, not enough to stall. */
export const COMEBACK = 0.3;

// ---------- challenges ----------

export const KINDS = ["mash", "type", "sums", "colour", "rhythm"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_INFO: Record<Kind, { icon: string; label: string; verb: string; blurb: string }> = {
  mash: { icon: "👊", label: "Mash", verb: "MASH!", blurb: "Hammer the PULL button. Every tap heaves." },
  type: { icon: "⌨️", label: "Type", verb: "TYPE!", blurb: "Type each word you're shown. Longer words pull harder." },
  sums: { icon: "🧮", label: "Sums", verb: "SOLVE!", blurb: "Tap the right answer. Wrong ones slip the rope back." },
  colour: { icon: "🎨", label: "Ink", verb: "INK!", blurb: "Tap the colour of the INK, not the word." },
  rhythm: { icon: "🥁", label: "Heave-ho", verb: "HEAVE!", blurb: "Tap right on the beat. Perfect timing pulls hardest." },
};

/** Rope units one correct input pulls for a team of one (a team of n pulls 1/n each, so sizes stay fair). */
export const MASH_PULL = 4.2;
export const SUMS_PULL = 22;
export const SUMS_SLIP = 10;
export const SUMS_LOCK_MS = 900;
export const COLOUR_PULL = 17;
export const COLOUR_SLIP = 8;
export const COLOUR_LOCK_MS = 700;
/** A typed word pulls this plus TYPE_PER_LETTER for each letter. */
export const TYPE_BASE = 12;
export const TYPE_PER_LETTER = 4.4;
/** Rhythm grades by how far off the beat (ms): perfect, good, ok. */
export const BEAT_MS = 560;
export const BEAT_START_MS = 700;
export const BEAT_WINDOWS = [70, 140, 230] as const;
export const BEAT_PULL = [14, 7, 2] as const;
export const BEAT_NAMES = ["PERFECT", "GOOD", "OK"] as const;
/** Mash taps a player can land per second (anything more is ignored). */
export const MASH_MAX_TPS = 16;
/** Correct answers in a row add 10% each, up to +50% (not for mashing or rhythm). */
export const STREAK_STEP = 0.1;
export const STREAK_MAX = 0.5;

export const streakMult = (streak: number) => 1 + Math.min(STREAK_MAX, Math.max(0, streak - 1) * STREAK_STEP);

/** Sim time of beat `b` in a round whose pulling started at `pullAt`. */
export const beatAt = (pullAt: number, b: number) => pullAt + BEAT_START_MS + b * BEAT_MS;

export const INKS = [
  { name: "RED", hex: "#ff4d5e" },
  { name: "BLUE", hex: "#3b9dff" },
  { name: "GREEN", hex: "#34d058" },
  { name: "YELLOW", hex: "#ffd60a" },
  { name: "PURPLE", hex: "#b26bff" },
  { name: "ORANGE", hex: "#ff8a1f" },
] as const;

/** A player's own current question. Nothing secret: answering it is the game. */
export type Prompt =
  | { k: "type"; q: number; w: string }
  | { k: "sums"; q: number; a: string; c: number[] }
  | { k: "colour"; q: number; w: number; i: number; c: number[] };

// ---------- wire format ----------

export type Phase = "countdown" | "pull" | "roundOver" | "final";

/** One frame of the rope, sent ~10 times a second while pulling (and carried in the view). */
export interface Snap {
  k: "s";
  /** Round number. */
  n: number;
  /** Server time. */
  t: number;
  /** Flag position x10 (-1000..1000; negative = Red's side). */
  p: number;
  /** Rope pulled by Red and Blue since the last frame (x10). */
  f: [number, number];
  /** Per slot, one digit 0-9: how hard that player pulled since the last frame. */
  w: string;
}

/** Private to one player: how their answer went. */
export interface AnswerEvent {
  k: "a";
  /** The question answered. */
  q: number;
  /** 1 right, 0 wrong. */
  ok: 0 | 1;
  /** Rope it moved (x10, signed toward your side = positive). */
  v: number;
  streak: number;
  /** Locked until (server time), after a wrong answer. */
  lock: number;
  next: Prompt | null;
}

/** Private to one player: grade of a rhythm tap (index into BEAT_NAMES, -1 = miss). */
export interface BeatEvent {
  k: "b";
  b: number;
  g: number;
}

export function isSnap(v: unknown): v is Snap {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<Snap>;
  return s.k === "s" && typeof s.t === "number" && typeof s.n === "number" && typeof s.p === "number" && typeof s.w === "string" && Array.isArray(s.f);
}
