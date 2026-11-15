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

/**
 * Two players can't compete fairly: the clue-giver scores what the only guesser
 * scores, so every game would tie (and any uneven split would reward sabotage).
 * So a two-player game is co-op: the pair plays for one team score.
 */
export const TEAM_PLAYERS = 2;

/** How a two-player team did: half the maximum (or better) wins. */
export function teamVerdict(score: number, goal: number, max: number): { won: boolean; title: string } {
  if (score >= max) return { won: true, title: "Perfect sync!" };
  if (score >= goal + (max - goal) / 2) return { won: true, title: "Mind readers!" };
  if (score >= goal) return { won: true, title: "In sync!" };
  return { won: false, title: "Out of tune" };
}

/** A valid dial position: an integer from 0 to 100. */
export function isDialValue(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;
}

// Characters a clue may not carry: control characters, invisible formatting
// characters that can hide text or flip its direction (zero-width space, bidi
// overrides, BOM...), and blank "letters" that render as nothing (Hangul fillers,
// the Braille blank, the combining grapheme joiner). Zero-width (non-)joiners and
// tag characters stay: emoji sequences, flags and some scripts need them.
const INVISIBLE = /[\p{Cc}\u034f\u115f\u1160\u3164\uffa0\u2800]|(?![\u200c\u200d\u{e0020}-\u{e007f}])\p{Cf}/gu;
/** Combining marks beyond three on one character are glitch text ("Zalgo"): trimmed. */
const MARK_PILE = /(\p{M}{3})\p{M}+/gu;
/** Something that actually shows up on screen: a letter, number, symbol/emoji or punctuation. */
const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u;

/** Normalise a clue: whitespace collapsed, invisible characters stripped, mark piles trimmed. */
export function cleanClue(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(INVISIBLE, "")
    .replace(MARK_PILE, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const NUMERIC = /^[\p{Nd}\s.,:;%#+\-–—~/()'"!?°]+$/u;

/** Value of any Unicode decimal digit (they come in runs of ten, 0 to 9). */
function digitValue(d: string): number {
  let cp = d.codePointAt(0) ?? 0;
  let steps = 0;
  while (steps < 60 && /\p{Nd}/u.test(String.fromCodePoint(cp - 1))) {
    cp -= 1;
    steps += 1;
  }
  return steps % 10;
}

/**
 * True when the clue is nothing but one dial position, 0 to 100: "62", "6 2", "62%",
 * "#62/100", "62.5", "６２", "٦٢", "6️⃣2️⃣". Real titles and numbers outside the dial
 * ("1917", "1984", "300", "911", "24/7", "007") are fine clues.
 */
export function isBareDialNumber(text: string): boolean {
  let t = text.normalize("NFKC").replace(/[\ufe0f\u20e3]/gu, "");
  if (!/\p{Nd}/u.test(t) || !NUMERIC.test(t)) return false;
  t = t.replace(/\p{Nd}/gu, (d) => String(digitValue(d)));
  t = t.replace(/\/\s*100\s*$/, ""); // "62/100"
  const core = t
    .replace(/[^\d.,]/g, "")
    .replace(/,(\d{3})(?!\d)/g, "$1") // thousands separator: "1,000"
    .replace(/^[.,]+|[.,]+$/g, "");
  if (!/^(?:0|[1-9]\d{0,2})(?:[.,]\d+)?$/.test(core)) return false;
  return Number.parseFloat(core.replace(",", ".")) <= 100;
}

/** Why a (cleaned) clue can't be sent, or null when it's fine. */
export function clueProblem(text: string): string | null {
  if (!text) return "Type a clue first.";
  if (text.length > CLUE_MAX) return `Keep it to ${CLUE_MAX} characters.`;
  if (!VISIBLE.test(text)) return "Use at least one letter, number or emoji.";
  if (isBareDialNumber(text)) return "Not just a number: use words!";
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
