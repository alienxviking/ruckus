import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { WORDS } from "./data";
import {
  BG,
  H,
  MAX_BATCH,
  MAX_GUESS,
  MAX_POINTS,
  MAX_STROKE_ID,
  PALETTE,
  SIZES,
  W,
  type Level,
  type SketchEvent,
  type WireStroke,
} from "./shared";

// Sketch Storm: one artist draws a secret word while everyone else races to guess it.
// Each turn runs choose -> draw -> reveal; after the last turn the game is "final".
// Strokes travel as transient events (ctx.emit) rather than in the view: views are
// re-sent to everyone on every guess, and a drawing can be tens of KB.

export const CHOOSE_MS = 12_000;
export const DRAW_MS = 80_000;
export const REVEAL_MS = 5_000;
/** How long the game waits for players to come back before ending with < 2 connected. */
export const SOLO_GRACE_MS = 10_000;
export const FEED_MAX = 40;
export const SYNC_GAP_MS = 1_000;
export const GUESS_GAP_MS = 150;
/** Strokes an artist may start in one turn (undo/clear don't give these back). */
export const MAX_STROKES = 2_000;
/** Points the server will accept per turn, counting ones later undone (flood guard). */
export const MAX_POINTS_IN = 150_000;

const COLORS: readonly string[] = [...PALETTE.map((p) => p.hex), BG];
const SIZE_SET: readonly number[] = SIZES;
const LEVELS: Level[] = ["easy", "medium", "hard"];
const ID_RE = /^[A-Za-z0-9_-]+$/;
/** A regex character-class range between two code points. */
const span = (a: number, b: number) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
// Combining marks left behind by NFD normalisation (the accents).
const ACCENTS_RE = new RegExp(`[${span(0x300, 0x36f)}]`, "g");
// Control characters, zero-width and bidi overrides.
const JUNK_RE = new RegExp(
  `[${span(0x00, 0x1f)}${span(0x7f, 0x9f)}${span(0x200b, 0x200f)}${span(0x2028, 0x202e)}${span(0x2060, 0x206f)}${String.fromCharCode(0xfeff)}]`,
  "g",
);

export type Phase = "choose" | "draw" | "reveal" | "final";
export type RevealReason = "all" | "time" | "left";
export type Role = "artist" | "guesser" | "spectator";

export interface Offer {
  word: string;
  level: Level;
}

export type FeedItem =
  | { n: number; kind: "guess"; by: string; text: string }
  | { n: number; kind: "correct"; by: string }
  | { n: number; kind: "drawing"; by: string }
  | { n: number; kind: "word"; by: string; text: string }
  | { n: number; kind: "left"; by: string }
  | { n: number; kind: "skip"; by: string };
type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface TurnRecord {
  turn: number;
  artist: string;
  word: string;
  guessers: string[];
}

interface Stroke {
  id: string;
  color: string;
  size: number;
  pts: number[];
  end: boolean;
}

export interface SketchState {
  /** Identifies this game (clients keep one component across "Play again"). */
  game: number;
  /** Participants in join order. */
  players: string[];
  /** Artist for every turn (the shuffled order, repeated per lap). */
  order: string[];
  laps: number;
  turn: number;
  phase: Phase;
  endsAt: number;
  phaseMs: number;
  artist: string;
  options: Offer[];
  word: string | null;
  /** Indices into `word` revealed as hints. */
  revealed: number[];
  /** Hint checkpoints passed this turn (0..2). */
  hints: number;
  /** Who guessed this turn, in order. */
  guessed: string[];
  gains: Record<string, number>;
  scores: Record<string, number>;
  feed: FeedItem[];
  feedSeq: number;
  reason: RevealReason | null;
  history: TurnRecord[];
  /** Every word offered this game (never offered again). */
  used: string[];
  strokes: Stroke[];
  strokesRev: number;
  pointCount: number;
  strokeIds: Record<string, true>;
  strokesMade: number;
  pointsIn: number;
  lastSync: Record<string, number>;
  lastGuess: Record<string, number>;
  soloSince: number | null;
  endedEarly: boolean;
}

export type SketchAction =
  | { type: "choose"; index: number }
  | { type: "guess"; text: string }
  | ({ type: "stroke" } & WireStroke)
  | { type: "undo" }
  | { type: "clear" }
  | { type: "sync" };

export interface SketchView {
  game: number;
  phase: Phase;
  turn: number;
  turns: number;
  laps: number;
  artist: string;
  /** Who draws next: the next artist still connected (null on the last turn). */
  next: string | null;
  endsAt: number;
  phaseMs: number;
  role: Role;
  /** The viewer guessed the word this turn. */
  guessed: boolean;
  /** The three words on offer: only the artist, only while choosing. */
  options: Offer[] | null;
  /** The word, for those who know it: the artist, correct guessers, everyone once revealed. */
  word: string | null;
  /** Draw phase: one cell per character; null = hidden letter, " " / "-" separators. */
  mask: (string | null)[] | null;
  /** Players who guessed this turn, in order. */
  correct: string[];
  gains: Record<string, number>;
  scores: Record<string, number>;
  players: string[];
  feed: FeedItem[];
  strokesRev: number;
  strokeCount: number;
  reason: RevealReason | null;
  history: TurnRecord[];
  /** Set while fewer than 2 players are connected: when the game gives up. */
  soloEndsAt: number | null;
  endedEarly: boolean;
}

// ---------- text helpers ----------

/** Strip control characters, collapse whitespace, trim and cap (by code point). */
export function cleanText(input: string, max: number): string {
  const s = input.replace(JUNK_RE, "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : Array.from(s).slice(0, max).join("").trim();
}

/** Comparison form: no accents, case, punctuation or spaces ("Ice-Cream!" -> "icecream"). */
export function compact(text: string): string {
  return text
    .normalize("NFD")
    .replace(ACCENTS_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** True when a and b are exactly one insertion, deletion or substitution apart. */
export function oneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  if (a.length > b.length) [a, b] = [b, a];
  if (b.length - a.length > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.length === b.length ? a.slice(i + 1) === b.slice(i + 1) : a.slice(i) === b.slice(i + 1);
}

const isLetter = (ch: string) => ch >= "a" && ch <= "z";

function letterIndices(word: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < word.length; i++) if (isLetter(word[i])) out.push(i);
  return out;
}

export function maskOf(word: string, revealed: number[]): (string | null)[] {
  return Array.from(word, (ch, i) => (isLetter(ch) ? (revealed.includes(i) ? ch : null) : ch));
}

// ---------- state helpers ----------

/** A prototype-free record: player and stroke ids come from clients ("__proto__" is a valid id). */
const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

const isOn = (ctx: GameCtx, id: string) => {
  const p = ctx.player(id);
  return !!p && p.connected !== false;
};

const nameOf = (ctx: GameCtx, id: string) => ctx.player(id)?.name ?? "Someone";

function pushFeed(s: SketchState, item: Without<FeedItem, "n">) {
  s.feed.push({ ...item, n: ++s.feedSeq } as FeedItem);
  if (s.feed.length > FEED_MAX) s.feed.splice(0, s.feed.length - FEED_MAX);
}

function pickOptions(s: SketchState, ctx: GameCtx): Offer[] {
  const out: Offer[] = [];
  const free = (level: Level) =>
    WORDS[level].filter((w) => !s.used.includes(w) && !out.some((o) => o.word === w));
  for (const want of LEVELS) {
    // One of each difficulty when possible; otherwise borrow from another level.
    let level = want;
    let pool = free(want);
    for (const other of LEVELS) {
      if (pool.length) break;
      level = other;
      pool = free(other);
    }
    if (pool.length) out.push({ word: pool[Math.floor(ctx.random() * pool.length)], level });
  }
  if (!out.length) {
    // Every word has been used (cannot happen with the current list sizes): allow repeats.
    for (const level of LEVELS) out.push({ word: WORDS[level][Math.floor(ctx.random() * WORDS[level].length)], level });
  }
  for (const o of out) s.used.push(o.word);
  return out;
}

function resetCanvas(s: SketchState) {
  s.strokes = [];
  s.strokesRev += 1;
  s.pointCount = 0;
  s.strokeIds = dict();
  s.strokesMade = 0;
  s.pointsIn = 0;
}

/** Start turn `index`, skipping artists who are away. Finishes the game after the last turn. */
function startTurn(s: SketchState, ctx: GameCtx, index: number) {
  for (let i = index; i < s.order.length; i++) {
    const artist = s.order[i];
    if (!isOn(ctx, artist)) {
      pushFeed(s, { kind: "skip", by: artist });
      continue;
    }
    s.turn = i;
    s.artist = artist;
    s.phase = "choose";
    s.phaseMs = CHOOSE_MS;
    s.endsAt = ctx.now() + CHOOSE_MS;
    s.options = pickOptions(s, ctx);
    s.word = null;
    s.revealed = [];
    s.hints = 0;
    s.guessed = [];
    s.gains = dict();
    s.reason = null;
    resetCanvas(s);
    return;
  }
  finish(s, ctx, false);
}

function beginDraw(s: SketchState, ctx: GameCtx, index: number) {
  const offer = s.options[index] ?? s.options[0];
  s.word = offer.word;
  s.phase = "draw";
  s.phaseMs = DRAW_MS;
  s.endsAt = ctx.now() + DRAW_MS;
  s.revealed = [];
  s.hints = 0;
  pushFeed(s, { kind: "drawing", by: s.artist });
}

function beginReveal(s: SketchState, ctx: GameCtx, reason: RevealReason) {
  const drew = s.phase === "draw";
  s.phase = "reveal";
  s.phaseMs = REVEAL_MS;
  s.endsAt = ctx.now() + REVEAL_MS;
  s.reason = reason;
  if (reason === "left") pushFeed(s, { kind: "left", by: s.artist });
  if (drew && s.word) {
    pushFeed(s, { kind: "word", by: s.artist, text: s.word });
    s.history.push({ turn: s.turn, artist: s.artist, word: s.word, guessers: s.guessed.slice() });
  }
}

function headline(s: SketchState, ctx: GameCtx, winners: string[]): string {
  if (!winners.length) return s.endedEarly ? "Sketch Storm ended early with no points scored" : "Nobody scored in Sketch Storm";
  const pts = s.scores[winners[0]] ?? 0;
  const names = winners.map((id) => nameOf(ctx, id));
  const early = s.endedEarly ? " (ended early)" : "";
  if (names.length === 1) return `${names[0]} wins Sketch Storm with ${pts} pts${early}`;
  const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} tie for the win with ${pts} pts${early}`;
}

function finish(s: SketchState, ctx: GameCtx, early: boolean) {
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

/** Guessers still connected (the artist never counts). */
function liveGuessers(s: SketchState, ctx: GameCtx) {
  return s.players.filter((id) => id !== s.artist && isOn(ctx, id));
}

function everyoneGuessed(s: SketchState, ctx: GameCtx) {
  const live = liveGuessers(s, ctx);
  return live.length > 0 && live.every((id) => s.guessed.includes(id));
}

/** Track whether fewer than 2 participants are connected. True when that changed. */
function updateSolo(s: SketchState, ctx: GameCtx): boolean {
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

/** Reveal one random hidden letter, keeping at most a third of the letters visible. */
function revealHint(s: SketchState, ctx: GameCtx): boolean {
  if (!s.word) return false;
  const letters = letterIndices(s.word);
  if (s.revealed.length >= Math.floor(letters.length / 3)) return false;
  const hidden = letters.filter((i) => !s.revealed.includes(i));
  if (!hidden.length) return false;
  s.revealed.push(hidden[Math.floor(ctx.random() * hidden.length)]);
  return true;
}

// ---------- actions ----------

function onGuess(s: SketchState, playerId: string, text: unknown, ctx: GameCtx): boolean {
  if (s.phase !== "draw" || !s.word || playerId === s.artist || s.guessed.includes(playerId)) return false;
  if (typeof text !== "string") return false;
  const clean = cleanText(text.slice(0, 400), MAX_GUESS);
  if (!clean) return false;
  const now = ctx.now();
  if (now - (s.lastGuess[playerId] ?? -Infinity) < GUESS_GAP_MS) return false;
  s.lastGuess[playerId] = now;

  const guess = compact(clean);
  const answer = compact(s.word);
  if (guess === answer) {
    const left = Math.min(1, Math.max(0, (s.endsAt - now) / DRAW_MS));
    const bonus = s.guessed.length === 0 ? 50 : s.guessed.length === 1 ? 25 : 0;
    const pts = 100 + Math.round(300 * left) + bonus;
    s.scores[playerId] = (s.scores[playerId] ?? 0) + pts;
    s.gains[playerId] = (s.gains[playerId] ?? 0) + pts;
    s.scores[s.artist] = (s.scores[s.artist] ?? 0) + 60;
    s.gains[s.artist] = (s.gains[s.artist] ?? 0) + 60;
    s.guessed.push(playerId);
    pushFeed(s, { kind: "correct", by: playerId });
    if (everyoneGuessed(s, ctx)) beginReveal(s, ctx, "all");
    return true;
  }
  // Near misses (and guesses that contain the answer) stay private: showing them would leak the word.
  if ((answer.length >= 5 && oneEdit(guess, answer)) || (guess.length > answer.length && guess.includes(answer))) {
    ctx.emit({ k: "close", text: clean } satisfies SketchEvent, { to: playerId });
    return false;
  }
  pushFeed(s, { kind: "guess", by: playerId, text: clean });
  return true;
}

function onStroke(s: SketchState, playerId: string, a: Record<string, unknown>, ctx: GameCtx): boolean {
  if (s.phase !== "draw" || playerId !== s.artist) return false;
  const { id, color, size, pts, end } = a;
  if (typeof id !== "string" || id.length < 1 || id.length > MAX_STROKE_ID || !ID_RE.test(id)) return false;
  if (typeof color !== "string" || !COLORS.includes(color)) return false;
  if (typeof size !== "number" || !SIZE_SET.includes(size)) return false;
  if (end !== undefined && typeof end !== "boolean") return false;
  if (!Array.isArray(pts) || pts.length > MAX_BATCH || pts.length % 2 !== 0) return false;
  for (let i = 0; i < pts.length; i++) {
    const v: unknown = pts[i];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > (i % 2 === 0 ? W : H)) return false;
  }
  const n = pts.length / 2;

  let index = -1;
  if (s.strokeIds[id]) {
    // Appending: usually the newest stroke, so search from the end.
    for (let i = s.strokes.length - 1; i >= 0; i--) {
      if (s.strokes[i].id === id) {
        index = i;
        break;
      }
    }
    if (index < 0 || s.strokes[index].end) return false; // undone/cleared, or already finished
    if (n === 0 && !end) return false;
  } else if (n === 0 || s.strokesMade >= MAX_STROKES) {
    return false;
  }
  if (s.pointsIn + n > MAX_POINTS_IN) return false;
  s.pointsIn += n;

  // The canvas holds at most MAX_POINTS points; ignore the overflow.
  const room = Math.max(0, MAX_POINTS - s.pointCount);
  const add = n <= room ? (pts as number[]) : (pts as number[]).slice(0, room * 2);
  if (index < 0) {
    if (!add.length) return false;
    s.strokes.push({ id, color, size, pts: add.slice(), end: end === true });
    s.strokeIds[id] = true;
    s.strokesMade += 1;
    index = s.strokes.length - 1;
  } else {
    if (!add.length && !end) return false;
    const st = s.strokes[index];
    for (const v of add) st.pts.push(v);
    if (end) st.end = true;
  }
  s.pointCount += add.length / 2;

  const st = s.strokes[index];
  const ev: Extract<SketchEvent, { k: "stroke" }> = {
    k: "stroke",
    t: s.turn,
    rev: s.strokesRev,
    i: index,
    id,
    color: st.color,
    size: st.size,
    pts: add,
  };
  if (end) ev.end = true;
  ctx.emit(ev, { except: playerId });
  return false; // strokes travel as events; no full re-broadcast
}

function onSync(s: SketchState, playerId: string, ctx: GameCtx): boolean {
  const now = ctx.now();
  if (now - (s.lastSync[playerId] ?? -Infinity) < SYNC_GAP_MS) return false;
  s.lastSync[playerId] = now;
  const strokes: WireStroke[] = s.strokes.map((st) => ({
    id: st.id,
    color: st.color,
    size: st.size,
    pts: st.pts.slice(),
    end: st.end,
  }));
  ctx.emit({ k: "sync", t: s.turn, rev: s.strokesRev, strokes } satisfies SketchEvent, { to: playerId });
  return false;
}

// ---------- the game ----------

export const sketch: GameDef<SketchState, SketchAction> = {
  id: "sketch",

  setup(ctx) {
    const players = ctx.players.map((p) => p.id);
    const laps = players.length <= 3 ? 2 : 1;
    const lap = shuffle(players, ctx.random);
    const order: string[] = [];
    for (let i = 0; i < laps; i++) order.push(...lap);
    const scores = dict<number>();
    for (const id of players) scores[id] = 0;
    const s: SketchState = {
      game: ctx.now(),
      players,
      order,
      laps,
      turn: -1,
      phase: "choose",
      endsAt: 0,
      phaseMs: CHOOSE_MS,
      artist: order[0] ?? "",
      options: [],
      word: null,
      revealed: [],
      hints: 0,
      guessed: [],
      gains: dict(),
      scores,
      feed: [],
      feedSeq: 0,
      reason: null,
      history: [],
      used: [],
      strokes: [],
      strokesRev: 0,
      pointCount: 0,
      strokeIds: dict(),
      strokesMade: 0,
      pointsIn: 0,
      lastSync: dict(),
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
        if (s.phase !== "choose" || playerId !== s.artist) return false;
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= s.options.length) return false;
        beginDraw(s, ctx, index);
        return true;
      }
      case "guess":
        return onGuess(s, playerId, a.text, ctx);
      case "stroke":
        return onStroke(s, playerId, a, ctx);
      case "undo": {
        if (s.phase !== "draw" || playerId !== s.artist || !s.strokes.length) return false;
        const st = s.strokes.pop()!;
        s.pointCount -= st.pts.length / 2;
        s.strokesRev += 1;
        ctx.emit({ k: "undo", t: s.turn, rev: s.strokesRev, id: st.id } satisfies SketchEvent);
        return true;
      }
      case "clear": {
        if (s.phase !== "draw" || playerId !== s.artist || !s.strokes.length) return false;
        s.strokes = [];
        s.pointCount = 0;
        s.strokesRev += 1;
        ctx.emit({ k: "clear", t: s.turn, rev: s.strokesRev } satisfies SketchEvent);
        return true;
      }
      case "sync":
        return onSync(s, playerId, ctx);
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
      beginDraw(s, ctx, 0); // the artist ran out of time: take the first word
      return true;
    }
    if (s.phase === "draw") {
      if (now >= s.endsAt) {
        beginReveal(s, ctx, "time");
        return true;
      }
      const elapsed = DRAW_MS - (s.endsAt - now);
      while (s.hints < 2 && elapsed >= DRAW_MS * (s.hints === 0 ? 0.5 : 0.75)) {
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
    if (playerId === s.artist && (s.phase === "choose" || s.phase === "draw")) {
      beginReveal(s, ctx, "left");
    } else if (s.phase === "draw" && everyoneGuessed(s, ctx)) {
      beginReveal(s, ctx, "all"); // don't wait for someone who left
    }
    updateSolo(s, ctx);
  },

  playerReturned(s, playerId, ctx) {
    if (s.phase === "final" || !s.players.includes(playerId)) return;
    updateSolo(s, ctx);
  },

  view(s, viewerId, ctx): SketchView {
    const playing = s.players.includes(viewerId);
    const role: Role = !playing ? "spectator" : viewerId === s.artist ? "artist" : "guesser";
    const guessed = s.guessed.includes(viewerId);
    const knows =
      s.phase === "reveal" || s.phase === "final" || (s.phase === "draw" && (role === "artist" || guessed));
    return {
      game: s.game,
      phase: s.phase,
      turn: s.turn,
      turns: s.order.length,
      laps: s.laps,
      artist: s.artist,
      next: s.phase === "final" ? null : (s.order.slice(s.turn + 1).find((id) => isOn(ctx, id)) ?? null),
      endsAt: s.endsAt,
      phaseMs: s.phaseMs,
      role,
      guessed,
      options: s.phase === "choose" && role === "artist" ? s.options.map((o) => ({ ...o })) : null,
      word: knows ? s.word : null,
      mask: s.phase === "draw" && s.word ? maskOf(s.word, s.revealed) : null,
      correct: s.guessed,
      gains: s.gains,
      scores: s.scores,
      players: s.players,
      feed: s.feed,
      strokesRev: s.strokesRev,
      strokeCount: s.strokes.length,
      reason: s.phase === "reveal" ? s.reason : null,
      history: s.history,
      soloEndsAt: s.soloSince === null ? null : s.soloSince + SOLO_GRACE_MS,
      endedEarly: s.endedEarly,
    };
  },
};

export default sketch;
