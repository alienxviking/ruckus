// Constants and wire types shared by Canvas Clash's server and client.
// Nothing secret lives here (the emblem catalogue is server-only, in data.ts).

// ---------- palette ----------

/** Blank board colour (index 0). Players can't paint it back. */
export const BLANK = "#f6f3ea";

/** Paint colours 1-8 (index 0 is the blank board). */
export const COLORS = [
  { hex: BLANK, name: "Blank" },
  { hex: "#26223f", name: "Ink" },
  { hex: "#b6c0d2", name: "Silver" },
  { hex: "#ef4444", name: "Red" },
  { hex: "#f97316", name: "Orange" },
  { hex: "#facc15", name: "Yellow" },
  { hex: "#22c55e", name: "Green" },
  { hex: "#3b82f6", name: "Blue" },
  { hex: "#a855f7", name: "Purple" },
] as const;
export const PAINTS = 8;

// ---------- rules ----------

export const EMBLEM = 5;
export const EMBLEM_CELLS = EMBLEM * EMBLEM;
export const PERFECT_BONUS = 5;
export const ROUNDS = 3;

export const INTRO_MS = 4_000;
export const PAINT_MS = 75_000;
export const SPOTS_MS = 3_500;
export const REVEAL_MS = 9_000;

/** Server: one pixel per COOLDOWN_MS on average, with a small burst for network jitter. */
export const COOLDOWN_MS = 180;
export const SERVER_BURST = 4;
/** Client: a touch slower and a smaller burst, so it never outruns the server. */
export const CLIENT_PACE_MS = 190;
export const CLIENT_BURST = 3;
/** Pixels per paint message (cell, colour pairs). */
export const MAX_BATCH = 8;

/** Board size for a player count. */
export function boardSize(players: number): { w: number; h: number } {
  return players >= 6 ? { w: 48, h: 36 } : { w: 40, h: 30 };
}

// ---------- wire ----------

export type Phase = "intro" | "paint" | "spots" | "reveal" | "final";

/** An emblem as shown to its owner (and to everyone after the reveal). `art` is 25 chars "1"-"8", row-major. */
export interface EmblemInfo {
  name: string;
  icon: string;
  art: string;
}

export type PixelsEvent =
  /** Accepted pixels, flat [painterIndex, cell, colour, ...]; the last one has revision `r`. */
  | { k: "px"; r: number; d: number[] }
  /** Pixels the server refused (cooldown or phase), sent only to their painter. */
  | { k: "no"; c: number[] }
  /** Full board on request (after a gap), sent only to the asker. */
  | { k: "board"; r: number; b: string }
  /** Player `i` tapped "next" during the reveal of `round` (a tiny event instead of a full view). */
  | { k: "ready"; i: number; round: number };

/** Best 5x5 match of `art` on `board` (row-major colour digits). Ties keep the first (top-left) spot. */
export function bestMatch(board: ArrayLike<number>, w: number, h: number, art: ArrayLike<number>) {
  let best = -1;
  let bx = 0;
  let by = 0;
  for (let y = 0; y + EMBLEM <= h; y++) {
    for (let x = 0; x + EMBLEM <= w; x++) {
      let n = 0;
      for (let j = 0; j < EMBLEM; j++) {
        const row = (y + j) * w + x;
        for (let i = 0; i < EMBLEM; i++) if (board[row + i] === art[j * EMBLEM + i]) n++;
      }
      if (n > best) {
        best = n;
        bx = x;
        by = y;
      }
    }
  }
  return { x: bx, y: by, n: Math.max(0, best) };
}

/** Digits string -> numbers. */
export function digits(s: string): number[] {
  const out = new Array<number>(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) - 48;
  return out;
}
