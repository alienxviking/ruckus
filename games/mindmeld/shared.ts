// Mind Meld: constants, types and pure helpers shared by server and client.
// Everything here ships to browsers, so it must never hold secrets.

export const MAX_ROUNDS = 8;
export const MAX_WORD = 24;
export const FIRST_ROUND_MS = 40_000;
export const ROUND_MS = 60_000;
export const REVEAL_MS = 5_000;

export type Phase = "writing" | "reveal" | "melded" | "failed";
/** Why the game ended (null while it's still running). */
export type EndReason = "meld" | "rounds" | "players";

export interface RoundEntry {
  id: string;
  /** What they wrote, or null for a blank. */
  word: string | null;
  /** Blank because they were offline at the reveal: doesn't block a meld. */
  away: boolean;
  /** Matching group: 0 = biggest group of 2+, 1 = next, ...; -1 = unique or blank. */
  group: number;
  /** How many words (including this one) matched it; 0 for a blank. */
  size: number;
}

export interface RoundRecord {
  round: number;
  /** One entry per participant, in seat order. */
  entries: RoundEntry[];
  /** Size of the biggest group of matching words. */
  sync: number;
  /** How many entries count towards a meld (everyone except offline blanks). */
  total: number;
  melded: boolean;
}

/** Transient events sent with ctx.emit (only ever to one player). */
export type MmEvent = { kind: "error"; msg: string };

export function isMmEvent(e: unknown): e is MmEvent {
  if (!e || typeof e !== "object") return false;
  const ev = e as { kind?: unknown; msg?: unknown };
  return ev.kind === "error" && typeof ev.msg === "string";
}

// ---------- words ----------

const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁯﻿]/g;
const WORD_CHARS = /^[\p{L}\p{M}' -]+$/u;

/** Tidy raw input: unify apostrophes/dashes, drop control + invisible chars, collapse spaces. */
export function cleanWord(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[\t\n\r\v\f]/g, " ")
    .replace(INVISIBLE, "")
    .replace(/[‘’ʼʹ`´′]/g, "'")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Why a cleaned word can't be played (ignoring earlier rounds), or null when it's fine. */
export function wordProblem(word: string): string | null {
  if (!word) return "Type a word first.";
  if (word.length > MAX_WORD) return `Keep it to ${MAX_WORD} characters or fewer.`;
  if (!WORD_CHARS.test(word)) return "Letters only (spaces, hyphens and apostrophes are fine).";
  if (!/\p{L}/u.test(word)) return "Your word needs at least one letter.";
  return null;
}

/**
 * The comparison key: two words "match" when their keys are equal.
 * Lowercase, strip accents and punctuation, ignore spacing ("ice-cream" =
 * "ice cream" = "icecream") and a leading "the/a/an", then a simple singular:
 * drop a trailing "s" when longer than 3 letters and not "-ss"
 * (plus "-sses/-shes/-ches/-xes/-zzes" lose "es", and "-ie" ~ "-y",
 * so "glasses" = "glass", "berries" = "berry", "cookies" = "cookie").
 */
export function matchKey(word: string): string {
  let w = word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .replace(/ı/g, "i")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{M}]+/gu, " ")
    .trim()
    .replace(/^(the|a|an) (?=\S)/, "")
    .replace(/ /g, "");
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) {
    w = /(ss|sh|ch|x|zz)es$/.test(w) ? w.slice(0, -2) : w.slice(0, -1);
  }
  if (w.length > 3 && w.endsWith("ie")) w = w.slice(0, -2) + "y";
  return w;
}

/** The earlier word (and its round) that `key` collides with, if any. */
export function findUsed(key: string, history: readonly RoundRecord[]): { word: string; round: number } | null {
  for (const r of history) {
    for (const e of r.entries) {
      if (e.word !== null && matchKey(e.word) === key) return { word: e.word, round: r.round };
    }
  }
  return null;
}

export type WordCheck = { ok: true; word: string; key: string } | { ok: false; msg: string };

/** Full validation of a submission against the rules and every revealed word. */
export function checkWord(raw: string, history: readonly RoundRecord[]): WordCheck {
  const word = cleanWord(raw);
  const problem = wordProblem(word);
  if (problem) return { ok: false, msg: problem };
  const key = matchKey(word);
  const used = findUsed(key, history);
  if (used) {
    const same = used.word.toLowerCase() === word.toLowerCase();
    return {
      ok: false,
      msg: same
        ? `“${used.word}” was already played in round ${used.round}. Find a new word!`
        : `“${word}” is too close to “${used.word}” from round ${used.round}.`,
    };
  }
  return { ok: true, word, key };
}

/** The closest a game got: most matching words, then the best ratio, then the earliest. */
export function bestRound(history: readonly RoundRecord[]): RoundRecord | null {
  let best: RoundRecord | null = null;
  for (const r of history) {
    if (
      !best ||
      r.sync > best.sync ||
      (r.sync === best.sync && r.sync * best.total > best.sync * r.total)
    ) {
      best = r;
    }
  }
  return best;
}

/** The word everyone agreed on (first player's spelling, lowercased). */
export function meldWord(r: RoundRecord): string {
  const e = r.entries.find((x) => x.group === 0 && x.word !== null) ?? r.entries.find((x) => x.word !== null);
  return (e?.word ?? "").toLowerCase();
}

// ---------- ratings ----------

export const RATINGS = [
  { label: "Impossible?!", rounds: "1", max: 1 },
  { label: "Telepathic", rounds: "2", max: 2 },
  { label: "Great minds", rounds: "3–4", max: 4 },
  { label: "Getting there", rounds: "5–6", max: 6 },
  { label: "Phew!", rounds: "7–8", max: MAX_ROUNDS },
] as const;

export function rating(rounds: number): string {
  return (RATINGS.find((r) => rounds <= r.max) ?? RATINGS[RATINGS.length - 1]).label;
}
