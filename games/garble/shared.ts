// Constants and helpers used by both halves of Garble.
// This file ships to browsers: no prompt lists or other secrets here.

/** Longest prompt or description (code points). */
export const MAX_TEXT = 80;
/** Points (x,y pairs) one drawing may hold: about 8,000 numbers, so reveal views stay small. */
export const INK_POINTS = 4_000;
/** Strokes one drawing may hold at once. */
export const MAX_STROKES = 600;
/** Share of the ink after which the UI warns that it's running low. */
export const INK_LOW = 0.8;
/** Most steps (pages per book), step 0 included, so big groups don't drag on. */
export const MAX_STEPS = 8;

export const WRITE_MS = 40_000;
export const DRAW_MS = 70_000;
export const DESCRIBE_MS = 35_000;

/** Reveal pacing: how long each page stays up before the next one lands. */
export const PAGE_TEXT_MS = 4_000;
export const PAGE_DRAW_MS = 6_000;
export const PAGE_BLANK_MS = 2_500;
/** The "that's the book" beat after a book's last page. */
export const BOOK_END_MS = 5_000;
/** A page must be up this long before its book's author can skip it. */
export const NEXT_GUARD_MS = 700;

export const REACTIONS = ["😂", "🔥", "😮", "❤️"] as const;
export const REACTION_NAMES = ["Laugh", "Fire", "Wow", "Love"] as const;
export const BADGE_NAMES = ["Funniest pages", "Hottest pages", "Most jaw-dropping", "Most loved"] as const;

export type StepKind = "write" | "draw" | "describe";
export type PageKind = "text" | "draw";

/** Step 0 writes the prompt, then drawing and describing alternate. */
export function stepKind(step: number): StepKind {
  return step === 0 ? "write" : step % 2 === 1 ? "draw" : "describe";
}

export function stepMs(kind: StepKind): number {
  return kind === "write" ? WRITE_MS : kind === "draw" ? DRAW_MS : DESCRIBE_MS;
}

export const STEP_ICON: Record<StepKind, string> = { write: "✍️", draw: "🎨", describe: "💬" };

/** A regex character-class range between two code points. */
const span = (a: number, b: number) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
// Control characters, zero-width and bidi overrides.
const JUNK_RE = new RegExp(
  `[${span(0x00, 0x1f)}${span(0x7f, 0x9f)}${span(0x200b, 0x200f)}${span(0x2028, 0x202e)}${span(0x2060, 0x206f)}${String.fromCharCode(0xfeff)}]`,
  "g",
);

/** Strip control characters, collapse whitespace, trim and cap (by code point). */
export function cleanText(input: string, max = MAX_TEXT): string {
  // Tabs and newlines become spaces before the other control characters go.
  const s = input
    .slice(0, max * 8)
    .replace(/\s+/g, " ")
    .replace(JUNK_RE, "")
    .replace(/ {2,}/g, " ")
    .trim();
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join("").trim();
}
