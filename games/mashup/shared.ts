// Constants and helpers used by both halves of Monster Mashup.
// This file ships to browsers: nothing secret here.

/** Logical size of ONE part (head, body or legs). A monster is three parts stacked: W x 3H. */
export const W = 600;
export const H = 400;
/** The strip at the bottom of a part that the next artist gets to see (10% of the part). */
export const GUIDE = 40;

export const PARTS = ["head", "body", "legs"] as const;
export type PartKind = (typeof PARTS)[number];
export const PART_LABEL = ["Head", "Body", "Legs"] as const;
export const PART_ICON = ["👹", "👕", "🦵"] as const;

export const ROUNDS = 2;
export const DRAW_MS = 60_000;
export const NAME_MS = 30_000;
export const VOTE_MS = 35_000;
export const RESULTS_MS = 12_000;
/** How long each monster stays on stage in the reveal show. */
export function revealMs(monsters: number): number {
  return monsters > 6 ? 4_500 : 5_500;
}
/** A monster must be on stage this long before "skip" votes count. */
export const SKIP_GUARD_MS = 1_200;

/** Points (x,y pairs) one part may hold: keeps the reveal payloads small. */
export const INK_POINTS = 1_500;
/** Strokes one part may hold at once. */
export const MAX_STROKES = 300;
/** Share of the ink after which the UI warns that it's running low. */
export const INK_LOW = 0.8;
/** Most points the guide sliver may carry. */
export const SLIVER_POINTS = 800;

/** Monsters each player names. */
export const NAMES_PER_PLAYER = 2;
export const MAX_NAME = 32;

/** Points per ⭐ vote, to every artist of the monster (never to the voter). */
export const STAR_PTS = 2;
/** Points per 🏷️ vote, to the name's author. */
export const NAME_PTS = 3;

/** A regex character-class range between two code points. */
const span = (a: number, b: number) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
// Control characters, zero-width and bidi overrides.
const JUNK_RE = new RegExp(
  `[${span(0x00, 0x1f)}${span(0x7f, 0x9f)}${span(0x200b, 0x200f)}${span(0x2028, 0x202e)}${span(0x2060, 0x206f)}${String.fromCharCode(0xfeff)}]`,
  "g",
);

/** Strip control characters, collapse whitespace, trim and cap (by code point). */
export function cleanText(input: string, max = MAX_NAME): string {
  const s = input
    .slice(0, max * 8)
    .replace(/\s+/g, " ")
    .replace(JUNK_RE, "")
    .replace(/ {2,}/g, " ")
    .trim();
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join("").trim();
}
