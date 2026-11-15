// Letter Rush: constants, view/action types and the pure text rules.
// Both halves import this file (the client uses it for the live "starts with B ✓" hint),
// so nothing secret may live here.

export const ROUNDS = 3;
export const CATEGORIES_PER_ROUND = 6;
export const ANSWER_MS = 90_000;
export const REVIEW_MS = 60_000;
export const RESULTS_MS = 6_000;
/** Between rounds, how long to hold on for players to reconnect when too few are online. */
export const REJOIN_MS = 20_000;
export const MIN_PLAYERS = 2;
export const MAX_ANSWER = 40;
export const UNIQUE_POINTS = 10;
export const SHARED_POINTS = 5;
/** A player counts as "typing…" for this long after their last edit reached the server. */
export const TYPING_MS = 2_500;

/** Letters that work for nearly every category (never Q U V X Y Z). */
export const LETTERS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
  "K", "L", "M", "N", "O", "P", "R", "S", "T", "W",
] as const;

export type Phase = "answer" | "review" | "results" | "final";

/** What the automatic checks say about an answer before anyone votes. */
export type AutoVerdict = "ok" | "blank" | "letter" | "short";

/** Final word on an answer: scoring ones first, then the reasons it scored nothing. */
export type CellStatus = "unique" | "shared" | "vetoed" | "blank" | "letter" | "short";

export interface Cell {
  text: string;
  status: CellStatus;
  points: number;
  vetoes: number;
  /** Indices (into `order`) of other players with the same valid answer. */
  same: number[];
}

/** A review-board cell, as seen by one viewer while vetoes are still open. */
export interface LiveCell extends Cell {
  /** Vetoes needed to reject this answer right now. */
  need: number;
  /** The viewer has vetoed it. */
  mine: boolean;
  /** The viewer may toggle a veto on it. */
  canVeto: boolean;
}

export interface RoundSummary {
  round: number;
  letter: string;
  categories: string[];
  /** cells[category][player index in `order`] */
  cells: Cell[][];
  /** Points scored this round, by player index. */
  points: number[];
}

export interface PlayerStatus {
  done: boolean;
  ready: boolean;
  /** Server time of their last answer edit (0 = none yet). Drives "typing…". */
  activeAt: number;
}

export interface Award {
  icon: string;
  title: string;
  /** Player indices (into `order`). */
  players: number[];
  detail: string;
}

export interface LettersView {
  phase: Phase;
  /** 1-based. */
  round: number;
  rounds: number;
  letter: string;
  categories: string[];
  endsAt: number | null;
  /** Full length of the current phase, for the timer bar. */
  phaseMs: number;
  /** Participant ids. Every per-player array in this view follows this order. */
  order: string[];
  /** The viewer's index in `order`, or -1 for spectators. */
  you: number;
  status: PlayerStatus[];
  /** Running totals. */
  scores: number[];
  /** The viewer's own answers (answer phase only; null for spectators). */
  mine: string[] | null;
  /** Live review board, [category][player] (review phase only). */
  board: LiveCell[][] | null;
  /** The round that just finished (results phase only). */
  recap: RoundSummary | null;
  /** Every round played (final phase only). */
  history: RoundSummary[] | null;
  awards: Award[] | null;
  /** Too few players online: the next round waits for someone to come back. */
  waiting: boolean;
  /** The game stopped before all rounds were played. */
  endedEarly: boolean;
}

export type LettersAction =
  | { type: "answer"; i: number; text: string }
  | { type: "done" }
  | { type: "undone" }
  | { type: "veto"; player: string; i: number }
  | { type: "ready" }
  | { type: "unready" };

// ---------- text rules (shared so the client's live hint matches the server exactly) ----------

const LEADING_JUNK = /^[^\p{L}\p{N}]+/u;
const ARTICLE = /^(the|an|a)\s+/;

/** Lowercase with accents stripped: "Crème Brûlée" -> "creme brulee". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Splits off what the letter rule ignores: leading punctuation and one leading
 * article. `core` is folded (lowercase, no accents) and is what must start with the letter.
 */
export function splitArticle(text: string): { article: string | null; core: string } {
  const t = fold(text).replace(LEADING_JUNK, "");
  const m = ARTICLE.exec(t);
  if (m) {
    const rest = t.slice(m[0].length).replace(LEADING_JUNK, "");
    if (rest) return { article: m[1], core: rest };
  }
  return { article: null, core: t };
}

export function answerCore(text: string): string {
  return splitArticle(text).core;
}

export function autoVerdict(text: string, letter: string): AutoVerdict {
  if (!text.trim()) return "blank";
  const core = answerCore(text);
  if (!core.startsWith(letter.toLowerCase())) return "letter";
  if (core.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return "short";
  return "ok";
}

/**
 * Key for spotting duplicate answers: lowercase, no accents or punctuation, no
 * leading article, spaces ignored and a simple plural folded, so "The Cats",
 * "cat" and "C.A.T.s" all collide, as do "Ice cream" and "icecream".
 */
export function answerKey(text: string): string {
  let t = fold(text)
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = /^(?:the|an|a) (?=\S)/.exec(t);
  if (m) t = t.slice(m[0].length);
  t = t.replace(/ /g, "");
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  return t;
}
