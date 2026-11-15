// Odd One Out: constants and pure word helpers shared by the server and the client.
// Nothing secret lives here (the word list is in data.ts, which stays on the server).
// The client runs the same clue rules for live validation; the server re-checks.

export const MIN_PLAYERS = 3;
export const MAX_ROUNDS = 3;
/** Every player gives this many clues per round, in the same turn order. */
export const LAPS = 2;

export const CLUE_MS = 25_000;
export const VOTE_MS = 45_000;
/** Once everyone connected has voted, the vote closes this much later. */
export const VOTE_SETTLE_MS = 2_000;
export const GUESS_MS = 25_000;
export const REVEAL_MS = 8_000;
/** A caught odd one who is offline gets this long to come back and guess. */
export const AWAY_GUESS_MS = 8_000;
/** Fewer than MIN_PLAYERS connected for this long ends the game. */
export const SHORT_GRACE_MS = 20_000;

export const MAX_CLUE = 20;
export const MAX_GUESS = 30;
/** Anything longer than this is rejected before any text processing. */
export const MAX_RAW = 200;

export const POINTS = {
  /** The odd one survives the vote (tie, nobody voted, or the wrong person caught). */
  escape: 3,
  /** The odd one is caught but names the majority word. */
  guess: 2,
  /** The odd one is caught and misses: everyone else gets this... */
  catch: 1,
  /** ...plus this if they voted for the odd one. */
  sharpEye: 1,
} as const;

// Control and invisible formatting characters (zero-width space, bidi overrides,
// BOM...), plus "letters" that render as nothing: Hangul fillers and the
// combining grapheme joiner. A clue made of these would look blank.
const CONTROL = /[\p{Cc}\p{Cf}\u034f\u115f\u1160\u3164\uffa0\u2028\u2029]/gu;
const CLUE_CHARS = /^[\p{L}\p{M}\p{N}'\u2019-]+$/u;
const GUESS_CHARS = /^[\p{L}\p{M}\p{N}'\u2019 -]+$/u;
/** Four or more combining marks in a row is glitch text ("Zalgo") that spills over other rows. */
const MARK_PILE = /\p{M}{4,}/u;

/** Strip control/invisible characters, collapse whitespace, trim. */
export function cleanText(input: string): string {
  return input.normalize("NFC").replace(CONTROL, "").replace(/\s+/g, " ").trim();
}

// Cyrillic and Greek letters that look like Latin ones ("соffее" spelled with
// Cyrillic с, о, е), folded so look-alikes can't dodge the word checks.
const LOOKALIKE: Record<string, string> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
  і: "i", ј: "j", ѕ: "s", һ: "h", ԁ: "d", ԛ: "q", ԝ: "w", ӏ: "l", ɡ: "g", ı: "i",
  α: "a", β: "b", ε: "e", ζ: "z", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
};
const LOOKALIKE_RE = new RegExp(`[${Object.keys(LOOKALIKE).join("")}]`, "gu");

/** Comparable form: no accents, lowercase, look-alikes folded, letters and digits only. */
export function normalizeWord(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(LOOKALIKE_RE, (c) => LOOKALIKE[c] ?? c)
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** The word plus its likely singular forms (dogs→dog, berries→berry, leaves→leaf, knives→knife, buses→bus). */
function variants(n: string): string[] {
  const out = [n];
  if (n.length > 4 && n.endsWith("ies")) out.push(n.slice(0, -3) + "y");
  if (n.length > 4 && n.endsWith("ives")) out.push(n.slice(0, -3) + "fe");
  else if (n.length > 4 && n.endsWith("ves")) out.push(n.slice(0, -3) + "f");
  if (n.length > 3 && /(?:s|x|z|ch|sh|o)es$/.test(n)) out.push(n.slice(0, -2));
  if (n.length > 2 && n.endsWith("s") && !n.endsWith("ss")) out.push(n.slice(0, -1));
  return out;
}

/**
 * Does the clue give the word away? Same word (plurals included), the clue contains
 * the word, or the clue contains the word's singular ("staircase" for stairs,
 * "dartboard" for darts). Short stems (under 4 letters) are left alone.
 */
function givesAway(clue: string, word: string): boolean {
  if (!clue || !word) return false;
  if (sameWord(clue, word)) return true;
  const forms = variants(clue);
  return variants(word).some((w) => (w === word || w.length >= 4) && forms.some((c) => c.includes(w)));
}

/** Same word, ignoring simple plurals. Both arguments must already be normalized. */
export function sameWord(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const vb = variants(b);
  return variants(a).some((v) => vb.includes(v));
}

/**
 * Why this clue can't be used, or null when it's fine.
 * `myWord` is the clue-giver's own word; `earlier` are clues already given this round.
 */
export function clueProblem(raw: string, myWord: string | null, earlier: readonly string[]): string | null {
  const text = cleanText(raw);
  if (!text) return "Type a clue first.";
  if (text.includes(" ")) return "One word only.";
  if ([...text].length > MAX_CLUE) return `Keep it to ${MAX_CLUE} characters.`;
  if (!CLUE_CHARS.test(text)) return "Letters, digits, hyphens and apostrophes only.";
  if (MARK_PILE.test(text)) return "Too many accents on one letter.";
  const n = normalizeWord(text);
  if (!n) return "Use at least one letter or digit.";
  if (myWord && givesAway(n, normalizeWord(myWord))) return "That gives away your word. Try another.";
  for (const e of earlier) {
    if (sameWord(n, normalizeWord(e))) return `“${cleanText(e)}” was already said this round.`;
  }
  return null;
}

/** Why this last guess can't be sent, or null when it's fine. */
export function guessProblem(raw: string): string | null {
  const text = cleanText(raw);
  if (!text) return "Type a guess first.";
  if ([...text].length > MAX_GUESS) return `Keep it to ${MAX_GUESS} characters.`;
  if (!GUESS_CHARS.test(text)) return "Letters, digits, spaces, hyphens and apostrophes only.";
  if (MARK_PILE.test(text)) return "Too many accents on one letter.";
  if (!normalizeWord(text)) return "Use at least one letter or digit.";
  return null;
}

/** Classic edit distance (inputs are short: guesses are capped at MAX_GUESS). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Does the odd one's last guess name the majority word? Forgives plurals, and one typo on 5+ letter words. */
export function guessMatches(guess: string, word: string): boolean {
  const g = normalizeWord(guess);
  const w = normalizeWord(word);
  if (!g || !w) return false;
  if (sameWord(g, w)) return true;
  return w.length >= 5 && levenshtein(g, w) <= 1;
}
