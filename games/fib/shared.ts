// Fib Finder: constants and pure text helpers shared by the server and the client.
// Nothing secret lives here (the facts and their answers are in data.ts, server-only).

export const MIN_PLAYERS = 3;
export const ROUNDS = 6;

export const WRITE_MS = 50_000;
export const PICK_MS = 30_000;
/** Each revealed option gets at most this long on screen... */
export const STEP_MS = 2_500;
/** ...and the whole walk-through (picked fibs, then the truth) is capped at this. */
export const REVEAL_CAP_MS = 14_000;
/** After the walk-through, the truth and the round's points stay up this long. */
export const HOLD_MS = 4_000;
/** Fewer than MIN_PLAYERS connected for this long ends the game. */
export const SHORT_GRACE_MS = 20_000;

export const MAX_LIE = 40;
/** Anything longer than this is rejected before any text processing. */
export const MAX_RAW = 200;
/** House decoys top the options up to at least this many. */
export const MIN_OPTIONS = 4;

export const POINTS = {
  /** Picking the real answer. */
  truth: 500,
  /** Per player who picks your fib. */
  fooled: 250,
} as const;

/** The blank in every fact prompt. */
export const BLANK = "____";

export const TRUTH_MESSAGE = "That's actually the truth! Write a fib.";
export const CLOSE_MESSAGE = "That's too close to the truth! Write a different fib.";

/** Control and invisible characters (built from char codes: literal U+2028 etc. would break regex literals in browsers). */
const span = (from: number, to: number) => String.fromCharCode(from) + "-" + String.fromCharCode(to);
const CONTROL = new RegExp(
  "[" + [span(0x00, 0x1f), span(0x7f, 0x9f), span(0x200b, 0x200f), span(0x2028, 0x202e), span(0x2060, 0x2064)].join("") +
    String.fromCharCode(0xfeff) + "]",
  "g",
);
const ALLOWED = /^[\p{L}\p{M}\p{N} '’.,&!?:\/-]+$/u;

/** Strip invisible characters, collapse whitespace, trim, and drop trailing punctuation. */
export function cleanLie(raw: string): string {
  return raw
    .replace(CONTROL, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.,!?:;]+$/u, "")
    .trim();
}

/** Why this fib can't be submitted, or null when it's fine. (The server also checks it against the truth.) */
export function lieProblem(raw: string): string | null {
  const text = cleanLie(raw);
  if (!text) return "Write a fib first.";
  if ([...text].length > MAX_LIE) return `Keep it to ${MAX_LIE} characters.`;
  if (!ALLOWED.test(text)) return "Letters, numbers and simple punctuation only.";
  if (!/[\p{L}\p{N}]/u.test(text)) return "Use at least one letter or number.";
  return null;
}

/** Comparable form: no accents, case, punctuation, spaces or leading article. */
export function normalize(input: string): string {
  const s = input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|a|an) (?=\S)/, "");
  return s.replace(/ /g, "");
}

/** The normalized text plus its likely singular forms (cubes→cube, berries→berry, leaves→leaf). */
function variants(n: string): string[] {
  const out = [n];
  if (n.length > 4 && n.endsWith("ies")) out.push(n.slice(0, -3) + "y");
  if (n.length > 4 && n.endsWith("ves")) out.push(n.slice(0, -3) + "f", n.slice(0, -3) + "fe");
  if (n.length > 3 && n.endsWith("es")) out.push(n.slice(0, -2));
  if (n.length > 2 && n.endsWith("s") && !n.endsWith("ss")) out.push(n.slice(0, -1));
  return out;
}

/** Same answer, ignoring simple plurals. Both arguments must already be normalized. */
export function sameText(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const vb = variants(b);
  return variants(a).some((v) => vb.includes(v));
}

/** Classic edit distance (inputs are short: fibs are capped at MAX_LIE). */
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

/**
 * How a fib compares with the truth: "exact" (the answer, an accepted alternative, or a
 * plural of one), "close" (one typo away from a 5+ letter answer), or null (a real fib).
 */
export function truthMatch(text: string, answers: readonly string[]): "exact" | "close" | null {
  const n = normalize(text);
  if (!n) return null;
  let close = false;
  for (const answer of answers) {
    const m = normalize(answer);
    if (!m) continue;
    if (sameText(n, m)) return "exact";
    if (m.length >= 5 && levenshtein(n, m) <= 1) close = true;
  }
  return close ? "close" : null;
}

/** Every option is shown in the same Title Case, so the truth never stands out by its typing. */
export function displayText(text: string): string {
  return cleanLie(text)
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, pre: string, ch: string) => pre + ch.toUpperCase());
}

/** Split a prompt around its blank (the blank is added at the end if a prompt lacks one). */
export function splitPrompt(prompt: string): [string, string] {
  const i = prompt.indexOf(BLANK);
  if (i < 0) return [prompt + " ", ""];
  return [prompt.slice(0, i), prompt.slice(i + BLANK.length)];
}

/** 2250 -> "2,250" (no Intl needed). */
export function formatPoints(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
