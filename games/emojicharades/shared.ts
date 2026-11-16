// Constants, wire types and emoji validation used by both halves of Emoji Charades.
// This file ships to browsers: no phrase lists here.

/** Most emoji in one clue. */
export const CLUE_MAX = 12;
/** Longest single emoji (UTF-16 units): covers ZWJ sequences like 🏴‍☠️ with room to spare. */
export const EMOJI_MAX_LEN = 16;
/** Longest guess kept in the feed. */
export const MAX_GUESS = 48;

export type Cat = "saying" | "story" | "thing" | "activity" | "food" | "place";

export const CATS: Record<Cat, { label: string; emoji: string }> = {
  saying: { label: "Saying", emoji: "💬" },
  story: { label: "Movie plot", emoji: "🎬" },
  thing: { label: "Thing", emoji: "🧸" },
  activity: { label: "Activity", emoji: "🏃" },
  food: { label: "Food & drink", emoji: "🍕" },
  place: { label: "Place", emoji: "📍" },
};

export const CAT_KEYS = Object.keys(CATS) as Cat[];

/**
 * Transient events (ctx.emit).
 * - clue: the clue changed (`t` turn, `v` revision). Sent to everyone except the clue-giver.
 * - close: your guess was close (private).
 */
export type CharadesEvent = { k: "clue"; t: number; v: number; e: string[] } | { k: "close"; text: string };

// One emoji: a pictograph, optional VS16 or skin tone, optionally ZWJ-joined to more.
// Regional indicators (flags) and keycaps are deliberately not accepted: they render as
// plain letters and digits on many systems, which would let a clue spell the answer.
// Built with the RegExp constructor: the TS target (ES2017) predates \p{} in regex literals.
const PIC = String.raw`\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?`;
const EMOJI_RE = new RegExp(String.raw`^${PIC}(?:\u200D${PIC})*$`, "u");

/** Emoji that are really letters or words (🅰️ 🆗 🔙 ™️ …): they'd let you spell the answer. */
const SPELLERS = new Set(
  [
    0x1f170, 0x1f171, 0x1f17e, 0x1f17f, 0x1f18e, 0x24c2, 0x2139, 0x2122, 0xa9, 0xae, 0x1f51f, 0x1f520, 0x1f521,
    0x1f522, 0x1f524, 0x1f519, 0x1f51a, 0x1f51b, 0x1f51c, 0x1f51d, 0x3297, 0x3299,
  ].concat(Array.from({ length: 0x1f19a - 0x1f191 + 1 }, (_, i) => 0x1f191 + i), [
    // Squared CJK words (🈁 🈂️ 🈷️ 🈶 🈯 🉐 🈹 🈚 🈲 🉑 🈸 🈴 🈳 🈺 🈵).
    0x1f201, 0x1f202, 0x1f237, 0x1f236, 0x1f22f, 0x1f250, 0x1f239, 0x1f21a, 0x1f232, 0x1f251, 0x1f238, 0x1f234,
    0x1f233, 0x1f23a, 0x1f235,
  ]),
);

/** True when `s` is exactly one allowed emoji. */
export function isClueEmoji(s: unknown): s is string {
  if (typeof s !== "string" || s.length === 0 || s.length > EMOJI_MAX_LEN) return false;
  if (!EMOJI_RE.test(s)) return false;
  return !SPELLERS.has(s.codePointAt(0) ?? 0);
}

/** Phrase characters a guesser sees as blanks (everything else shows: spaces, apostrophes, hyphens). */
export const isLetter = (ch: string | null) => ch !== null && ch >= "a" && ch <= "z";
