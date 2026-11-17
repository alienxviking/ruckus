import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { customWords, readSettings } from "../../shared/settings";
import { config } from "./config";
import { PHRASES } from "./data";
import { CAT_KEYS, CLUE_MAX, MAX_GUESS, isClueEmoji, isLetter, type Cat, type CharadesEvent } from "./shared";

// Emoji Charades: one clue-giver describes a secret phrase using only emoji while
// everyone else races to guess it. Each turn runs choose -> clue -> reveal; after the
// last turn the game is "final". Clue edits travel as tiny events (ctx.emit) and the
// action returns false, so tapping emoji never re-broadcasts the whole view.

export const CHOOSE_MS = 15_000;
export const CLUE_MS = 70_000;
export const REVEAL_MS = 6_000;
/** How long the game waits for players to come back before ending with < 2 connected. */
export const SOLO_GRACE_MS = 10_000;
export const FEED_MAX = 40;
export const GUESS_GAP_MS = 150;
/** Clue edits: a token bucket (burst, refill per second) so a flood can't hog the room. */
export const CLUE_BURST = 10;
export const CLUE_RATE = 10;
/** Letter hints unlock at these fractions of the clue phase. */
export const HINT_AT = [0.4, 0.6, 0.8] as const;
/** Points: a guesser gets BASE + up to SPEED (scaled by time left) + an early bonus. */
export const GUESS_BASE = 100;
export const GUESS_SPEED = 300;
export const FIRST_BONUS = [50, 25] as const;
/** The clue-giver gets this per correct guesser, plus a bonus when everyone gets it. */
export const GIVER_EACH = 50;
export const GIVER_ALL = 50;

/** A regex character-class range between two code points. */
const span = (a: number, b: number) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
const ACCENTS_RE = new RegExp(`[${span(0x300, 0x36f)}]`, "g");
// Control characters, zero-width and bidi overrides.
const JUNK_RE = new RegExp(
  `[${span(0x00, 0x1f)}${span(0x7f, 0x9f)}${span(0x200b, 0x200f)}${span(0x2028, 0x202e)}${span(0x2060, 0x206f)}${String.fromCharCode(0xfeff)}]`,
  "g",
);
const STOP = new Set(["a", "an", "the"]);

export type Phase = "choose" | "clue" | "reveal" | "final";
export type RevealReason = "all" | "time" | "left";
export type Role = "giver" | "guesser" | "spectator";

export interface Offer {
  text: string;
  cat: Cat;
}

export type FeedItem =
  | { n: number; kind: "guess"; by: string; text: string }
  | { n: number; kind: "correct"; by: string }
  | { n: number; kind: "giving"; by: string }
  | { n: number; kind: "phrase"; by: string; text: string }
  | { n: number; kind: "left"; by: string }
  | { n: number; kind: "skip"; by: string };
type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface TurnRecord {
  turn: number;
  giver: string;
  phrase: string;
  cat: Cat;
  clue: string[];
  guessers: string[];
}

export interface CharadesState {
  game: number;
  /** Clue phase length for this game (host setting). */
  clueMs: number;
  /** The host's own phrases (offered first), or empty. */
  custom: string[];
  players: string[];
  /** Clue-giver for every turn (the shuffled order, repeated per lap). */
  order: string[];
  laps: number;
  turn: number;
  phase: Phase;
  endsAt: number;
  phaseMs: number;
  giver: string;
  options: Offer[];
  phrase: Offer | null;
  /** Indices into the phrase revealed as hints. */
  revealed: number[];
  /** Hint checkpoints passed this turn. */
  hints: number;
  clue: string[];
  clueRev: number;
  clueTokens: number;
  clueAt: number;
  guessed: string[];
  gains: Record<string, number>;
  scores: Record<string, number>;
  feed: FeedItem[];
  feedSeq: number;
  reason: RevealReason | null;
  history: TurnRecord[];
  /** Every phrase offered this game (never offered again). */
  used: string[];
  lastGuess: Record<string, number>;
  soloSince: number | null;
  endedEarly: boolean;
}

export type CharadesAction = { type: "choose"; index: number } | { type: "clue"; emoji: string[] } | { type: "guess"; text: string };

export interface CharadesView {
  game: number;
  phase: Phase;
  turn: number;
  turns: number;
  laps: number;
  giver: string;
  /** Who gives the next clue: the next one still connected (null on the last turn). */
  next: string | null;
  endsAt: number;
  phaseMs: number;
  role: Role;
  guessed: boolean;
  /** The three phrases on offer: only the clue-giver, only while choosing. */
  options: Offer[] | null;
  /** The phrase, for those who know it: the giver, correct guessers, everyone once revealed. */
  phrase: string | null;
  /** The category is public from the moment the phrase is picked. */
  cat: Cat | null;
  /** Clue phase: one cell per character; null = hidden letter. */
  mask: (string | null)[] | null;
  clue: string[];
  clueRev: number;
  correct: string[];
  gains: Record<string, number>;
  scores: Record<string, number>;
  players: string[];
  feed: FeedItem[];
  reason: RevealReason | null;
  history: TurnRecord[];
  soloEndsAt: number | null;
  endedEarly: boolean;
}

// ---------- text helpers ----------

/** Strip control characters, collapse whitespace, trim and cap (by code point). */
export function cleanText(input: string, max: number): string {
  const s = input.replace(JUNK_RE, "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : Array.from(s).slice(0, max).join("").trim();
}

/** Significant words: no accents, case, punctuation or articles ("The Dentist’s office!" -> dentists, office). */
export function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(ACCENTS_RE, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w));
}

/** Comparison form: the significant words run together. */
export const keyOf = (text: string) => words(text).join("");

/**
 * Edit distance counting a swap of neighbours as one edit (optimal string alignment),
 * giving up (returning cap + 1) once it must exceed `cap`.
 */
export function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** Typos forgiven on a correct guess: one for 12+ letters, two for 20+. */
const typos = (len: number) => (len >= 20 ? 2 : len >= 12 ? 1 : 0);

export type Verdict = "correct" | "close" | "wrong";

export function judge(guess: string, answer: string): Verdict {
  const g = keyOf(guess);
  const a = keyOf(answer);
  if (!g || !a) return "wrong";
  const closeCap = Math.max(2, Math.floor(a.length * 0.3));
  const d = editDistance(g, a, Math.max(closeCap, typos(a.length)));
  if (d <= typos(a.length)) return "correct";
  if (d <= closeCap && a.length >= 4) return "close";
  if (g.length > a.length && g.includes(a)) return "close";
  // Got half the important words of a longer phrase.
  const big = words(answer).filter((w) => w.length >= 3);
  if (big.length >= 2) {
    const mine = new Set(words(guess));
    const hit = big.filter((w) => mine.has(w)).length;
    if (hit * 2 >= big.length) return "close";
  }
  return "wrong";
}

export function maskOf(phrase: string, revealed: number[]): (string | null)[] {
  return Array.from(phrase, (ch, i) => (isLetter(ch) ? (revealed.includes(i) ? ch : null) : ch));
}

// ---------- state helpers ----------

/** A prototype-free record: player ids come from clients ("__proto__" is a valid id). */
const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

const isOn = (ctx: GameCtx, id: string) => {
  const p = ctx.player(id);
  return !!p && p.connected !== false;
};

const nameOf = (ctx: GameCtx, id: string) => ctx.player(id)?.name ?? "Someone";

function pushFeed(s: CharadesState, item: Without<FeedItem, "n">) {
  s.feed.push({ ...item, n: ++s.feedSeq } as FeedItem);
  if (s.feed.length > FEED_MAX) s.feed.splice(0, s.feed.length - FEED_MAX);
}

/**
 * A host phrase in the game's phrase format (lowercase letters, spaces, apostrophes and
 * hyphens), or null when it can't be used (digits, or too few letters).
 */
export function normalizePhrase(raw: string): string | null {
  if (/[0-9]/.test(raw)) return null;
  const p = raw
    .normalize("NFD")
    .replace(ACCENTS_RE, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (p.match(/[a-z]/g)?.length ?? 0) >= 3 ? p : null;
}

/** Three phrases from three different categories, never offered before this game. */
function pickOptions(s: CharadesState, ctx: GameCtx): Offer[] {
  const cats = shuffle(CAT_KEYS, ctx.random);
  const out: Offer[] = [];
  // The host's own phrases come first; built-in ones top up when they run out.
  const mine = shuffle(
    s.custom.filter((p) => !s.used.includes(p)),
    ctx.random,
  );
  for (const text of mine.slice(0, 3)) out.push({ text, cat: "custom" });
  for (const cat of cats) {
    if (out.length >= 3) break;
    const pool = PHRASES[cat].filter((p) => !s.used.includes(p));
    if (pool.length) out.push({ text: pool[Math.floor(ctx.random() * pool.length)], cat });
  }
  while (out.length < 3) {
    // Everything used (cannot happen with the current list sizes): allow repeats.
    const cat = cats[out.length % cats.length];
    out.push({ text: PHRASES[cat][Math.floor(ctx.random() * PHRASES[cat].length)], cat });
  }
  for (const o of out) s.used.push(o.text);
  return out;
}

/** Start turn `index`, skipping clue-givers who are away. Finishes the game after the last turn. */
function startTurn(s: CharadesState, ctx: GameCtx, index: number) {
  for (let i = index; i < s.order.length; i++) {
    const giver = s.order[i];
    if (!isOn(ctx, giver)) {
      pushFeed(s, { kind: "skip", by: giver });
      continue;
    }
    s.turn = i;
    s.giver = giver;
    s.phase = "choose";
    s.phaseMs = CHOOSE_MS;
    s.endsAt = ctx.now() + CHOOSE_MS;
    s.options = pickOptions(s, ctx);
    s.phrase = null;
    s.revealed = [];
    s.hints = 0;
    s.clue = [];
    s.clueRev += 1;
    s.clueTokens = CLUE_BURST;
    s.clueAt = ctx.now();
    s.guessed = [];
    s.gains = dict();
    s.reason = null;
    return;
  }
  finish(s, ctx, false);
}

function beginClue(s: CharadesState, ctx: GameCtx, index: number) {
  s.phrase = s.options[index] ?? s.options[0];
  s.phase = "clue";
  s.phaseMs = s.clueMs;
  s.endsAt = ctx.now() + s.clueMs;
  s.revealed = [];
  s.hints = 0;
  pushFeed(s, { kind: "giving", by: s.giver });
}

function beginReveal(s: CharadesState, ctx: GameCtx, reason: RevealReason) {
  const clued = s.phase === "clue";
  s.phase = "reveal";
  s.phaseMs = REVEAL_MS;
  s.endsAt = ctx.now() + REVEAL_MS;
  s.reason = reason;
  if (reason === "left") pushFeed(s, { kind: "left", by: s.giver });
  if (clued && s.phrase) {
    if (reason === "all" && s.guessed.length > 1) award(s, s.giver, GIVER_ALL);
    pushFeed(s, { kind: "phrase", by: s.giver, text: s.phrase.text });
    s.history.push({
      turn: s.turn,
      giver: s.giver,
      phrase: s.phrase.text,
      cat: s.phrase.cat,
      clue: s.clue.slice(),
      guessers: s.guessed.slice(),
    });
  }
}

function award(s: CharadesState, id: string, pts: number) {
  s.scores[id] = (s.scores[id] ?? 0) + pts;
  s.gains[id] = (s.gains[id] ?? 0) + pts;
}

function headline(s: CharadesState, ctx: GameCtx, winners: string[]): string {
  const early = s.endedEarly ? " (ended early)" : "";
  if (!winners.length) return s.endedEarly ? "Emoji Charades ended early with no points scored" : "Nobody cracked a single clue 🤷";
  const pts = s.scores[winners[0]] ?? 0;
  const names = winners.map((id) => nameOf(ctx, id));
  if (names.length === 1) return `${names[0]} wins Emoji Charades with ${pts} pts 🎬${early}`;
  const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} tie for the win with ${pts} pts${early}`;
}

function finish(s: CharadesState, ctx: GameCtx, early: boolean) {
  if (s.phase === "final") return;
  s.phase = "final";
  s.phaseMs = 0;
  s.endsAt = 0;
  s.endedEarly = early;
  s.soloSince = null;
  const scores = dict<number>();
  for (const id of s.players) scores[id] = s.scores[id] ?? 0;
  const winners = topScorers(scores);
  ctx.end({ winners, headline: headline(s, ctx, winners), scores });
}

function liveGuessers(s: CharadesState, ctx: GameCtx) {
  return s.players.filter((id) => id !== s.giver && isOn(ctx, id));
}

function everyoneGuessed(s: CharadesState, ctx: GameCtx) {
  const live = liveGuessers(s, ctx);
  return live.length > 0 && live.every((id) => s.guessed.includes(id));
}

function updateSolo(s: CharadesState, ctx: GameCtx): boolean {
  const lonely = s.players.filter((id) => isOn(ctx, id)).length < 2;
  if (lonely && s.soloSince === null) {
    s.soloSince = ctx.now();
    return true;
  }
  if (!lonely && s.soloSince !== null) {
    s.soloSince = null;
    return true;
  }
  return false;
}

/** Reveal a few random hidden letters (about a tenth each time), keeping at most a third visible. */
function revealHint(s: CharadesState, ctx: GameCtx): boolean {
  if (!s.phrase) return false;
  const text = s.phrase.text;
  const letters: number[] = [];
  for (let i = 0; i < text.length; i++) if (isLetter(text[i])) letters.push(i);
  const room = Math.floor(letters.length / 3) - s.revealed.length;
  let n = Math.min(room, Math.max(1, Math.round(letters.length / 10)));
  let changed = false;
  while (n-- > 0) {
    const hidden = letters.filter((i) => !s.revealed.includes(i));
    if (!hidden.length) break;
    s.revealed.push(hidden[Math.floor(ctx.random() * hidden.length)]);
    changed = true;
  }
  return changed;
}

// ---------- actions ----------

function onGuess(s: CharadesState, playerId: string, text: unknown, ctx: GameCtx): boolean {
  if (s.phase !== "clue" || !s.phrase || playerId === s.giver || s.guessed.includes(playerId)) return false;
  if (typeof text !== "string") return false;
  const clean = cleanText(text.slice(0, 400), MAX_GUESS);
  if (!clean) return false;
  const now = ctx.now();
  if (now >= s.endsAt) return false;
  if (now - (s.lastGuess[playerId] ?? -Infinity) < GUESS_GAP_MS) return false;
  s.lastGuess[playerId] = now;

  const verdict = judge(clean, s.phrase.text);
  if (verdict === "correct") {
    const left = Math.min(1, Math.max(0, (s.endsAt - now) / s.clueMs));
    const pts = GUESS_BASE + Math.round(GUESS_SPEED * left) + (FIRST_BONUS[s.guessed.length] ?? 0);
    award(s, playerId, pts);
    award(s, s.giver, GIVER_EACH);
    s.guessed.push(playerId);
    pushFeed(s, { kind: "correct", by: playerId });
    if (everyoneGuessed(s, ctx)) beginReveal(s, ctx, "all");
    return true;
  }
  // Near misses stay private: showing them would hand the answer to everyone else.
  if (verdict === "close") {
    ctx.emit({ k: "close", text: clean } satisfies CharadesEvent, { to: playerId });
    return false;
  }
  pushFeed(s, { kind: "guess", by: playerId, text: clean });
  return true;
}

function onClue(s: CharadesState, playerId: string, emoji: unknown, ctx: GameCtx): boolean {
  if (s.phase !== "clue" || playerId !== s.giver) return false;
  if (!Array.isArray(emoji) || emoji.length > CLUE_MAX) return false;
  for (const e of emoji) if (!isClueEmoji(e)) return false;
  const next = emoji as string[];
  if (next.length === s.clue.length && next.every((e, i) => e === s.clue[i])) return false;
  const now = ctx.now();
  s.clueTokens = Math.min(CLUE_BURST, s.clueTokens + ((now - s.clueAt) / 1000) * CLUE_RATE);
  s.clueAt = now;
  if (s.clueTokens < 1) return false;
  s.clueTokens -= 1;
  s.clue = next.slice();
  s.clueRev += 1;
  ctx.emit({ k: "clue", t: s.turn, v: s.clueRev, e: s.clue } satisfies CharadesEvent, { except: playerId });
  return false; // clue edits travel as events; the next view carries the latest clue too
}

// ---------- the game ----------

export const emojicharades: GameDef<CharadesState, CharadesAction> = {
  id: "emojicharades",

  setup(ctx) {
    const players = ctx.players.map((p) => p.id);
    const set = readSettings(config.settings, ctx.settings);
    const laps = Number(set.laps) > 0 ? Number(set.laps) : players.length <= 4 ? 2 : 1;
    const custom = [...new Set((customWords(config.settings, ctx.settings, "words") ?? []).map(normalizePhrase).filter((p): p is string => !!p))];
    const lap = shuffle(players, ctx.random);
    const order: string[] = [];
    for (let i = 0; i < laps; i++) order.push(...lap);
    const scores = dict<number>();
    for (const id of players) scores[id] = 0;
    const s: CharadesState = {
      game: ctx.now(),
      clueMs: (Number(set.clue) || CLUE_MS / 1000) * 1000,
      custom,
      players,
      order,
      laps,
      turn: -1,
      phase: "choose",
      endsAt: 0,
      phaseMs: CHOOSE_MS,
      giver: order[0] ?? "",
      options: [],
      phrase: null,
      revealed: [],
      hints: 0,
      clue: [],
      clueRev: 0,
      clueTokens: CLUE_BURST,
      clueAt: ctx.now(),
      guessed: [],
      gains: dict(),
      scores,
      feed: [],
      feedSeq: 0,
      reason: null,
      history: [],
      used: [],
      lastGuess: dict(),
      soloSince: null,
      endedEarly: false,
    };
    startTurn(s, ctx, 0);
    if (s.phase !== "final") updateSolo(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.phase === "final" || !s.players.includes(playerId)) return false;
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as unknown as Record<string, unknown>;
    switch (a.type) {
      case "choose": {
        const index = a.index;
        if (s.phase !== "choose" || playerId !== s.giver) return false;
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= s.options.length) return false;
        beginClue(s, ctx, index);
        return true;
      }
      case "clue":
        return onClue(s, playerId, a.emoji, ctx);
      case "guess":
        return onGuess(s, playerId, a.text, ctx);
      default:
        return false;
    }
  },

  tick(s, ctx) {
    if (s.phase === "final") return false;
    const now = ctx.now();
    let changed = updateSolo(s, ctx);
    if (s.soloSince !== null && now - s.soloSince >= SOLO_GRACE_MS) {
      finish(s, ctx, true);
      return true;
    }
    if (s.phase === "choose" && now >= s.endsAt) {
      beginClue(s, ctx, 0); // out of time: take the first phrase
      return true;
    }
    if (s.phase === "clue") {
      if (now >= s.endsAt) {
        beginReveal(s, ctx, "time");
        return true;
      }
      const elapsed = s.clueMs - (s.endsAt - now);
      while (s.hints < HINT_AT.length && elapsed >= s.clueMs * HINT_AT[s.hints]) {
        s.hints += 1;
        if (revealHint(s, ctx)) changed = true;
      }
      return changed;
    }
    if (s.phase === "reveal" && now >= s.endsAt) {
      startTurn(s, ctx, s.turn + 1);
      return true;
    }
    return changed;
  },
  tickMs: 250,

  playerLeft(s, playerId, ctx) {
    if (s.phase === "final" || !s.players.includes(playerId)) return;
    if (playerId === s.giver && (s.phase === "choose" || s.phase === "clue")) {
      beginReveal(s, ctx, "left");
    } else if (s.phase === "clue" && everyoneGuessed(s, ctx)) {
      beginReveal(s, ctx, "all");
    }
    updateSolo(s, ctx);
  },

  playerReturned(s, playerId, ctx) {
    if (s.phase === "final" || !s.players.includes(playerId)) return;
    updateSolo(s, ctx);
  },

  view(s, viewerId, ctx): CharadesView {
    const playing = s.players.includes(viewerId);
    const role: Role = !playing ? "spectator" : viewerId === s.giver ? "giver" : "guesser";
    const guessed = s.guessed.includes(viewerId);
    const knows = s.phase === "reveal" || s.phase === "final" || (s.phase === "clue" && (role === "giver" || guessed));
    const live = s.phase === "clue" || s.phase === "reveal";
    return {
      game: s.game,
      phase: s.phase,
      turn: s.turn,
      turns: s.order.length,
      laps: s.laps,
      giver: s.giver,
      next: s.phase === "final" ? null : (s.order.slice(s.turn + 1).find((id) => isOn(ctx, id)) ?? null),
      endsAt: s.endsAt,
      phaseMs: s.phaseMs,
      role,
      guessed,
      options: s.phase === "choose" && role === "giver" ? s.options.map((o) => ({ ...o })) : null,
      phrase: knows && s.phrase ? s.phrase.text : null,
      cat: live && s.phrase ? s.phrase.cat : null,
      mask: s.phase === "clue" && s.phrase ? maskOf(s.phrase.text, s.revealed) : null,
      clue: live ? s.clue : [],
      clueRev: s.clueRev,
      correct: s.guessed,
      gains: s.gains,
      scores: s.scores,
      players: s.players,
      feed: s.feed,
      reason: s.phase === "reveal" ? s.reason : null,
      history: s.history,
      soloEndsAt: s.soloSince === null ? null : s.soloSince + SOLO_GRACE_MS,
      endedEarly: s.endedEarly,
    };
  },
};

export default emojicharades;
