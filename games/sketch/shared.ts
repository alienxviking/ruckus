// Constants and wire types used by both halves of Sketch Storm.
// This file ships to browsers: no word lists or other secrets here.

/** Logical canvas size. Every stroke coordinate is an integer in [0, W] x [0, H]. */
export const W = 1000;
export const H = 750;
/** Canvas background; the eraser paints with it. */
export const BG = "#ffffff";

export const PALETTE = [
  { hex: "#1c1c1e", name: "Black" },
  { hex: "#8e8e93", name: "Grey" },
  { hex: "#e5383b", name: "Red" },
  { hex: "#f77f00", name: "Orange" },
  { hex: "#ffd60a", name: "Yellow" },
  { hex: "#2fb344", name: "Green" },
  { hex: "#4cc9f0", name: "Sky blue" },
  { hex: "#1d4ed8", name: "Blue" },
  { hex: "#7b2cbf", name: "Purple" },
  { hex: "#ff70a6", name: "Pink" },
  { hex: "#8b5a2b", name: "Brown" },
  { hex: "#ffcba4", name: "Peach" },
] as const;

export const SIZES = [4, 9, 18, 36] as const;
export const SIZE_NAMES = ["Fine", "Medium", "Thick", "Huge"] as const;

/** Most numbers (x and y each count) in one stroke action. */
export const MAX_BATCH = 600;
/** Most points (x,y pairs) on one canvas; anything beyond is ignored. */
export const MAX_POINTS = 40_000;
export const MAX_STROKE_ID = 16;
/** Longest guess shown in the feed. */
export const MAX_GUESS = 40;

/** "custom" marks a word from the host's own list. */
export type Level = "easy" | "medium" | "hard" | "custom";
/** The levels our own word list comes in. */
export type BuiltinLevel = Exclude<Level, "custom">;

export interface WireStroke {
  id: string;
  color: string;
  size: number;
  pts: number[];
  end?: boolean;
}

/**
 * Transient events (ctx.emit). `t` is the turn, `rev` the canvas revision:
 * it bumps on undo, clear and every new turn, so clients can spot gaps.
 */
export type SketchEvent =
  | ({ k: "stroke"; t: number; rev: number; i: number } & WireStroke)
  | { k: "undo"; t: number; rev: number; id: string }
  | { k: "clear"; t: number; rev: number }
  | { k: "sync"; t: number; rev: number; strokes: WireStroke[] }
  | { k: "close"; text: string };
