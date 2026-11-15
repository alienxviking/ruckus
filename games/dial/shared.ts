// Tiny constants and helpers used by both the server logic and the client UI.
// Nothing secret lives here (spectrum content is in data.ts, server-only).

export const CLUE_MS = 60_000;
export const GUESS_MS = 40_000;
export const REVEAL_MS = 7_000;
/** A participant who has been disconnected this long is skipped (clue-giver) or no longer waited for (guesser). */
export const AWAY_GRACE_MS = 8_000;
/** With fewer than two players connected for this long, the game ends with the current scores. */
export const ABANDON_MS = 20_000;

export const CLUE_MAX = 40;
export const TARGET_MIN = 4;
export const TARGET_MAX = 96;
/** Where an untouched needle sits (and what a bare "lock" commits to). */
export const DIAL_START = 50;
/**
 * Server-side floor between two needle broadcasts for one player. Honest clients
 * send about every 85ms; anything faster is stored but only re-broadcast on the
 * next tick, so a spammy client can't flood everyone else.
 */
export const DIAL_EMIT_MIN_MS = 40;

/** Scoring bands: within `d` of the target scores `pts`. Checked in order. */
export const BANDS = [
  { d: 3, pts: 4 },
  { d: 8, pts: 3 },
  { d: 14, pts: 2 },
  { d: 20, pts: 1 },
] as const;

export function pointsFor(dist: number): number {
  for (const b of BANDS) if (dist <= b.d) return b.pts;
  return 0;
}

/** A valid dial position: an integer from 0 to 100. */
export function isDialValue(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;
}

// Control characters plus invisible formatting characters that can be abused to
// hide text or flip its direction (zero-width space, bidi overrides, BOM...).
// Zero-width joiners stay: emoji sequences need them.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Normalise a clue: whitespace collapsed, invisible characters stripped, trimmed. */
export function cleanClue(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

// "62", "6 2", "62%", "#62", "62/100"... a clue has to be more than a number.
const NUMBER_ONLY = /^[\d\s.,:;%#+\-–—~/()'"!?°]*\d[\d\s.,:;%#+\-–—~/()'"!?°]*$/;

/** Why a (cleaned) clue can't be sent, or null when it's fine. */
export function clueProblem(text: string): string | null {
  if (!text) return "Type a clue first.";
  if (text.length > CLUE_MAX) return `Keep it to ${CLUE_MAX} characters.`;
  if (NUMBER_ONLY.test(text)) return "Use words, not a number!";
  return null;
}

/** Transient event: someone's needle moved. */
export interface DialEvent {
  k: "dial";
  id: string;
  v: number;
}

export function isDialEvent(e: unknown): e is DialEvent {
  if (!e || typeof e !== "object") return false;
  const x = e as Record<string, unknown>;
  return x.k === "dial" && typeof x.id === "string" && isDialValue(x.v);
}
