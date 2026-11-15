// Constants, puzzle shapes and the answer checker, used by both the Hot Potato
// server and client. Nothing secret lives here: the fuse is server-only state.

/** A throw is in the air this long. */
export const FLIGHT_MS = 500;
/** A wrong answer costs this long before the next puzzle shows. */
export const PENALTY_MS = 600;
/** A disconnected holder's puzzle "solves itself" after this long. */
export const AUTO_MS = 3_000;
/** Ready beat before each round (the first one is a little longer). */
export const READY_FIRST_MS = 3_200;
export const READY_MS = 2_000;
/** How long the BOOM is on screen before the next round. */
export const BOOM_MS = 3_200;
/** Hidden fuse length range per round. */
export const FUSE_MIN_MS = 12_000;
export const FUSE_MAX_MS = 30_000;
/**
 * The sparks grow over this long, purely from time since the round started.
 * It says nothing about the fuse: every round heats up at the same rate.
 */
export const HEAT_FULL_MS = 30_000;
/** Fewer than two connected survivors for this long ends the game. */
export const AWAY_MS = 20_000;
/** Lives per player (one life from this many players up). */
export const LIVES = 2;
export const ONE_LIFE_FROM = 9;

export const PUZZLE_TYPES = ["sum", "odd", "arrows", "ink"] as const;
export type PuzzleType = (typeof PUZZLE_TYPES)[number];

/** Ink colours, always shown with their names. */
export const INKS = [
  { name: "Red", hex: "#f43f5e" },
  { name: "Blue", hex: "#3b82f6" },
  { name: "Green", hex: "#22c55e" },
  { name: "Yellow", hex: "#facc15" },
  { name: "Purple", hex: "#a855f7" },
] as const;

/** 0 up, 1 right, 2 down, 3 left. */
export const DIR_NAMES = ["Up", "Right", "Down", "Left"] as const;
export const DIR_GLYPHS = ["↑", "→", "↓", "←"] as const;
export const ARROW_LEN = 3;

/** Heckles that spectators and knocked-out players can throw. */
export const HECKLES = ["😂", "😱", "🔥", "💣", "👏", "🤡"] as const;

/**
 * What the holder sees. Every puzzle is self-evident (the answer follows from
 * what's shown), so the client can grade a tap instantly; the server grades it
 * again with the same function.
 */
export type Puzzle =
  | { t: "sum"; a: number; b: number; op: "+" | "-"; opts: number[] }
  | { t: "odd"; cells: string[] }
  | { t: "arrows"; seq: number[] }
  | { t: "ink"; word: number; ink: number; opts: number[] };

export const PUZZLE_META: Record<PuzzleType, { icon: string; how: string }> = {
  sum: { icon: "➕", how: "Quick sum!" },
  odd: { icon: "🔍", how: "Tap the odd one out!" },
  arrows: { icon: "🕹️", how: "Repeat the arrows!" },
  ink: { icon: "🎨", how: "Tap the INK colour!" },
};

export function sumValue(pz: Extract<Puzzle, { t: "sum" }>): number {
  return pz.op === "+" ? pz.a + pz.b : pz.a - pz.b;
}

/** The odd cell: the one emoji that appears exactly once. */
export function oddCell(cells: string[]): number {
  return cells.findIndex((c) => cells.indexOf(c) === cells.lastIndexOf(c));
}

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * Grade an answer. true = right, false = a well-formed wrong answer (costs the
 * penalty), null = malformed (ignored).
 * Arrows take the sequence typed so far: a correct but unfinished prefix is null.
 */
export function checkAnswer(pz: Puzzle, a: unknown): boolean | null {
  switch (pz.t) {
    case "sum":
      if (!isInt(a, 0, pz.opts.length - 1)) return null;
      return pz.opts[a] === sumValue(pz);
    case "ink":
      if (!isInt(a, 0, pz.opts.length - 1)) return null;
      return pz.opts[a] === pz.ink;
    case "odd":
      if (!isInt(a, 0, pz.cells.length - 1)) return null;
      return a === oddCell(pz.cells);
    case "arrows": {
      if (!Array.isArray(a) || a.length < 1 || a.length > pz.seq.length) return null;
      if (!a.every((d) => isInt(d, 0, 3))) return null;
      const ok = a.every((d, i) => d === pz.seq[i]);
      if (!ok) return false;
      return a.length === pz.seq.length ? true : null;
    }
  }
}
