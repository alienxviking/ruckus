import { topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import { BG, H, MAX_BATCH, MAX_STROKE_ID, PALETTE, SIZES, W, type WireStroke } from "../sketch/shared";
import { PROMPTS } from "./data";
import {
  BOOK_END_MS,
  INK_POINTS,
  MAX_STEPS,
  MAX_STROKES,
  NEXT_GUARD_MS,
  PACES,
  PAGE_BLANK_MS,
  PAGE_DRAW_MS,
  PAGE_TEXT_MS,
  REACTIONS,
  cleanText,
  stepKind,
  stepMs,
  type PageKind,
} from "./shared";

// Garble: telephone with pictures. Everyone writes a prompt in their own book,
// then the books pass along: draw the words you get, describe the drawing you
// get. Nobody sees more than the page before theirs. Then every book is
// revealed page by page, people react, and the most-loved pages win.
//
// Phases: play (one step at a time) -> reveal (book by book, page by page) -> final.
// Drawings travel as stroke actions that return false: nobody watches you draw,
// so there's nothing to broadcast until the reveal.

/** How long the game waits with fewer than 2 players connected before skipping to the reveal. */
export const SOLO_GRACE_MS = 10_000;
/** Strokes one page may ever start (undo doesn't give these back): a flood guard. */
export const MAX_MADE = 2_000;
/** Points the server accepts per page, counting ones later undone: a flood guard. */
export const MAX_POINTS_IN = 40_000;
const INSPIRE_GAP_MS = 250;
const MINE_GAP_MS = 1_000;
const BOOK_GAP_MS = 200;

const COLORS: readonly string[] = [...PALETTE.map((p) => p.hex), BG];
const SIZE_SET: readonly number[] = SIZES;
const ID_RE = /^[A-Za-z0-9_-]+$/;

export type Phase = "play" | "reveal" | "final";

interface Stroke {
  id: string;
  color: string;
  size: number;
  pts: number[];
  end: boolean;
}

interface Page {
  by: string;
  kind: PageKind;
  text: string;
  strokes: Stroke[];
  /** Points on the page now (the ink used). */
  points: number;
  /** Strokes ever started and points ever received (flood guards). */
  made: number;
  pointsIn: number;
  /** Every stroke id seen on this page, so undone strokes can't be appended to. */
  ids: Record<string, true>;
  blank: boolean;
  /** A first page the game filled in because its author left it blank. */
  auto: boolean;
  /** Reactor ids, per reaction. */
  react: string[][];
}

interface Book {
  owner: string;
  pages: Page[];
}

/** A drawn stroke as the reveal needs it. */
export interface DrawStroke {
  color: string;
  size: number;
  pts: number[];
}

export interface PageView {
  by: string;
  kind: PageKind;
  text: string;
  blank: boolean;
  auto: boolean;
  /** Only on the one page a view is about (the page you respond to, or the page on stage). */
  strokes?: DrawStroke[];
}

export interface HoldView {
  /** The book you hold this step and whose it is. */
  book: number;
  owner: string;
  /** The page before yours: the only page of any book you get to see. */
  prev: PageView | null;
  /** Your text so far (text steps), so a refresh doesn't lose it. */
  draft: string;
  /** Strokes the server has on your page (draw steps). */
  ink: number;
}

export interface RevealView {
  book: number;
  owner: string;
  /** Page on stage; equal to `pages` during the book's closing beat. */
  page: number;
  pages: number;
  /** Pages before the one on stage (all of them during the closing beat), without drawings. */
  trail: PageView[];
  current: PageView | null;
  /** Reactor ids per reaction for the page on stage. */
  react: string[][];
  landedAt: number;
}

export interface FinalPage {
  by: string;
  kind: PageKind;
  text: string;
  blank: boolean;
  auto: boolean;
  /** Reaction counts. */
  r: number[];
}

export interface FinalView {
  books: { owner: string; pages: FinalPage[] }[];
  /** Reactions received. */
  scores: Record<string, number>;
  /** Fun badges per reaction: who got the most of it. */
  badges: { e: number; ids: string[]; n: number }[];
}

export interface GarbleView {
  phase: Phase;
  players: string[];
  steps: number;
  step: number;
  endsAt: number;
  phaseMs: number;
  done: string[];
  hold: HoldView | null;
  reveal: RevealView | null;
  final: FinalView | null;
  /** Set while fewer than 2 players are connected: when the game skips to the reveal. */
  soloEndsAt: number | null;
  endedEarly: boolean;
  /** Step timers [write, draw, describe] in ms (host setting). */
  times: number[];
}

export interface GarbleState {
  players: string[];
  steps: number;
  /** Step timers [write, draw, describe] in ms (host setting). */
  times: number[];
  phase: Phase;
  step: number;
  endsAt: number;
  phaseMs: number;
  done: string[];
  books: Book[];
  /** Prompt indices handed out so far (no repeats until the list runs out). */
  used: number[];
  /** Reveal position: book and page (page === pages.length is the closing beat). */
  rb: number;
  rp: number;
  landedAt: number;
  soloSince: number | null;
  endedEarly: boolean;
  scores: Record<string, number>;
  lastInspire: Record<string, number>;
  lastMine: Record<string, number>;
  lastBook: Record<string, number>;
  final: FinalView | null;
}

export type GarbleAction =
  | { type: "write"; text: string }
  | { type: "done"; text?: string }
  | { type: "edit" }
  | { type: "inspire" }
  | ({ type: "stroke" } & WireStroke)
  | { type: "undo" }
  | { type: "clear" }
  | { type: "mine" }
  | { type: "react"; e: number }
  | { type: "next" }
  | { type: "book"; b: number };

export type GarbleEvent =
  | { k: "inspire"; text: string }
  | { k: "mine"; step: number; strokes: WireStroke[] }
  | { k: "react"; e: number; by: string; b: number; p: number }
  | { k: "book"; b: number; pages: { p: number; strokes: DrawStroke[] }[] };

// ---------- helpers ----------

/** A prototype-free record: ids come from clients ("__proto__" is a valid id). */
const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

const isOn = (ctx: GameCtx, id: string) => {
  const p = ctx.player(id);
  return !!p && p.connected !== false;
};

const nameOf = (ctx: GameCtx, id: string) => ctx.player(id)?.name ?? "Someone";

/** The book player `index` holds at `step`: book b is held by players[(b + step) % n]. */
export function bookFor(n: number, index: number, step: number): number {
  return (((index - step) % n) + n) % n;
}

function newPage(by: string, kind: PageKind): Page {
  return {
    by,
    kind,
    text: "",
    strokes: [],
    points: 0,
    made: 0,
    pointsIn: 0,
    ids: dict(),
    blank: true,
    auto: false,
    react: REACTIONS.map(() => []),
  };
}

const toDraw = (st: Stroke): DrawStroke => ({ color: st.color, size: st.size, pts: st.pts });

function pageView(p: Page, withStrokes: boolean): PageView {
  const v: PageView = { by: p.by, kind: p.kind, text: p.text, blank: p.blank, auto: p.auto };
  if (withStrokes && p.kind === "draw") v.strokes = p.strokes.map(toDraw);
  return v;
}

function freshPrompt(s: GarbleState, ctx: GameCtx): string {
  const free: number[] = [];
  for (let i = 0; i < PROMPTS.length; i++) if (!s.used.includes(i)) free.push(i);
  const pool = free.length ? free : PROMPTS.map((_, i) => i);
  const i = pool[Math.floor(ctx.random() * pool.length)] ?? 0;
  if (!s.used.includes(i)) s.used.push(i);
  return PROMPTS[i];
}

/** The page player `index` is working on this step. */
function myPage(s: GarbleState, index: number): Page | undefined {
  return s.books[bookFor(s.players.length, index, s.step)]?.pages[s.step];
}

/** Everyone still connected is done (and at least one is). */
function allDone(s: GarbleState, ctx: GameCtx): boolean {
  const live = s.players.filter((id) => isOn(ctx, id));
  return live.length > 0 && live.every((id) => s.done.includes(id));
}

/** Track whether fewer than 2 participants are connected. True when that changed. */
function updateSolo(s: GarbleState, ctx: GameCtx): boolean {
  const lonely = s.phase === "play" && s.players.filter((id) => isOn(ctx, id)).length < 2;
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

// ---------- flow ----------

function startStep(s: GarbleState, ctx: GameCtx, step: number) {
  const kind = stepKind(step);
  s.phase = "play";
  s.step = step;
  s.done = [];
  s.phaseMs = stepMs(kind, s.times);
  s.endsAt = ctx.now() + s.phaseMs;
  const n = s.players.length;
  s.books.forEach((book, b) => {
    book.pages.push(newPage(s.players[(b + step) % n], kind === "draw" ? "draw" : "text"));
  });
}

/** Whatever was written or drawn so far becomes the page, even if it's blank. */
function finalizeStep(s: GarbleState, ctx: GameCtx) {
  for (const book of s.books) {
    const page = book.pages[s.step];
    if (!page) continue;
    if (page.kind === "text") {
      page.text = cleanText(page.text);
      page.blank = !page.text;
      if (s.step === 0 && page.blank) {
        // A book with no prompt goes nowhere: the game picks one.
        page.text = freshPrompt(s, ctx);
        page.auto = true;
        page.blank = false;
      }
    } else {
      page.strokes = page.strokes.filter((st) => st.pts.length > 0);
      for (const st of page.strokes) st.end = true;
      page.blank = page.strokes.length === 0;
    }
    page.ids = dict();
  }
}

function endStep(s: GarbleState, ctx: GameCtx) {
  finalizeStep(s, ctx);
  if (s.step + 1 < s.steps) startStep(s, ctx, s.step + 1);
  else startReveal(s, ctx);
}

function beatMs(s: GarbleState): number {
  const book = s.books[s.rb];
  const page = book.pages[s.rp];
  if (!page) return BOOK_END_MS;
  if (page.blank) return PAGE_BLANK_MS;
  return page.kind === "draw" ? PAGE_DRAW_MS : PAGE_TEXT_MS;
}

function land(s: GarbleState, ctx: GameCtx) {
  s.landedAt = ctx.now();
  s.phaseMs = beatMs(s);
  s.endsAt = s.landedAt + s.phaseMs;
}

function startReveal(s: GarbleState, ctx: GameCtx) {
  s.phase = "reveal";
  s.done = [];
  s.soloSince = null;
  s.rb = 0;
  s.rp = 0;
  land(s, ctx);
}

function advanceReveal(s: GarbleState, ctx: GameCtx) {
  s.rp += 1;
  if (s.rp > s.books[s.rb].pages.length) {
    s.rb += 1;
    s.rp = 0;
  }
  if (s.rb >= s.books.length) {
    finish(s, ctx);
    return;
  }
  land(s, ctx);
}

function headline(ctx: GameCtx, winners: string[], n: number, early: boolean): string {
  const tail = early ? " (ended early)" : "";
  if (!winners.length) return `Garble is done: a tough crowd with no reactions${tail}`;
  const names = winners.map((id) => nameOf(ctx, id));
  const r = `${n} reaction${n === 1 ? "" : "s"}`;
  if (names.length === 1) return `${names[0]}'s pages stole the show with ${r}${tail}`;
  const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} tie for the most-loved pages with ${r} each${tail}`;
}

function finish(s: GarbleState, ctx: GameCtx) {
  if (s.phase === "final") return;
  s.phase = "final";
  s.endsAt = 0;
  s.phaseMs = 0;
  s.done = [];
  s.soloSince = null;
  const scores = dict<number>();
  for (const id of s.players) scores[id] = s.scores[id] ?? 0;
  const perEmoji = REACTIONS.map(() => dict<number>());
  for (const book of s.books) {
    for (const page of book.pages) {
      page.react.forEach((ids, e) => {
        if (ids.length) perEmoji[e][page.by] = (perEmoji[e][page.by] ?? 0) + ids.length;
      });
    }
  }
  const badges: FinalView["badges"] = [];
  perEmoji.forEach((counts, e) => {
    const best = Math.max(0, ...s.players.map((id) => counts[id] ?? 0));
    if (best > 0) badges.push({ e, n: best, ids: s.players.filter((id) => counts[id] === best) });
  });
  s.final = {
    books: s.books.map((book) => ({
      owner: book.owner,
      pages: book.pages.map((p) => ({
        by: p.by,
        kind: p.kind,
        text: p.text,
        blank: p.blank,
        auto: p.auto,
        r: p.react.map((ids) => ids.length),
      })),
    })),
    scores,
    badges,
  };
  const winners = topScorers(scores);
  ctx.end({ winners, headline: headline(ctx, winners, winners.length ? scores[winners[0]] : 0, s.endedEarly), scores });
}

// ---------- actions ----------

function onStroke(s: GarbleState, page: Page, a: Record<string, unknown>): boolean {
  if (page.kind !== "draw") return false;
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

  let st: Stroke | undefined;
  if (page.ids[id]) {
    // Appending: usually the newest stroke, so search from the end.
    for (let i = page.strokes.length - 1; i >= 0; i--) {
      if (page.strokes[i].id === id) {
        st = page.strokes[i];
        break;
      }
    }
    if (!st || st.end) return false; // undone/cleared, or already finished
    if (n === 0 && !end) return false;
  } else if (n === 0 || page.strokes.length >= MAX_STROKES || page.made >= MAX_MADE) {
    return false;
  }
  if (page.pointsIn + n > MAX_POINTS_IN) return false;
  page.pointsIn += n;

  // Out of ink: the overflow is ignored. A stroke started with no ink left is
  // still recorded (empty) so undo stays in step with the artist's canvas.
  const room = Math.max(0, INK_POINTS - page.points);
  const add = n <= room ? (pts as number[]) : (pts as number[]).slice(0, room * 2);
  if (!st) {
    page.strokes.push({ id, color, size, pts: add.slice(), end: end === true });
    page.ids[id] = true;
    page.made += 1;
  } else {
    for (const v of add) st.pts.push(v);
    if (end) st.end = true;
  }
  page.points += add.length / 2;
  return false; // nobody watches you draw: nothing to broadcast
}

/** Send a viewer the drawings of a book they're allowed to see (revealed pages only). */
function onBook(s: GarbleState, viewerId: string, b: unknown, ctx: GameCtx): boolean {
  if (s.phase !== "reveal" && s.phase !== "final") return false;
  if (typeof b !== "number" || !Number.isInteger(b) || b < 0 || b >= s.books.length) return false;
  if (s.phase === "reveal" && b > s.rb) return false;
  const now = ctx.now();
  if (now - (s.lastBook[viewerId] ?? -Infinity) < BOOK_GAP_MS) return false;
  s.lastBook[viewerId] = now;
  const book = s.books[b];
  const upto = s.phase === "final" || b < s.rb ? book.pages.length - 1 : Math.min(s.rp, book.pages.length - 1);
  const pages: { p: number; strokes: DrawStroke[] }[] = [];
  for (let p = 0; p <= upto; p++) {
    const page = book.pages[p];
    if (page.kind === "draw" && !page.blank) pages.push({ p, strokes: page.strokes.map(toDraw) });
  }
  ctx.emit({ k: "book", b, pages } satisfies GarbleEvent, { to: viewerId });
  return false;
}

function onPlay(s: GarbleState, playerId: string, index: number, a: Record<string, unknown>, ctx: GameCtx): boolean {
  const page = myPage(s, index);
  if (!page) return false;
  const now = ctx.now();
  const open = now < s.endsAt;
  const done = s.done.includes(playerId);
  switch (a.type) {
    case "write": {
      if (!open || done || page.kind !== "text" || typeof a.text !== "string") return false;
      page.text = cleanText(a.text);
      return false; // a draft: nobody else needs to know
    }
    case "done": {
      if (!open || done) return false;
      if (a.text !== undefined) {
        if (page.kind !== "text" || typeof a.text !== "string") return false;
        page.text = cleanText(a.text);
      }
      s.done.push(playerId);
      if (allDone(s, ctx)) endStep(s, ctx);
      return true;
    }
    case "edit": {
      if (!open || !done) return false;
      s.done = s.done.filter((id) => id !== playerId);
      return true;
    }
    case "inspire": {
      if (!open || done || s.step !== 0) return false;
      if (now - (s.lastInspire[playerId] ?? -Infinity) < INSPIRE_GAP_MS) return false;
      s.lastInspire[playerId] = now;
      page.text = freshPrompt(s, ctx);
      ctx.emit({ k: "inspire", text: page.text } satisfies GarbleEvent, { to: playerId });
      return false;
    }
    case "stroke":
      if (!open || done) return false;
      return onStroke(s, page, a);
    case "undo": {
      if (!open || done || page.kind !== "draw") return false;
      const st = page.strokes.pop();
      if (st) page.points -= st.pts.length / 2;
      return false;
    }
    case "clear": {
      if (!open || done || page.kind !== "draw") return false;
      page.strokes = [];
      page.points = 0;
      return false;
    }
    case "mine": {
      // After a refresh mid-drawing: send the artist back what they had drawn.
      if (page.kind !== "draw") return false;
      if (now - (s.lastMine[playerId] ?? -Infinity) < MINE_GAP_MS) return false;
      s.lastMine[playerId] = now;
      const strokes: WireStroke[] = page.strokes.map((st) => ({
        id: st.id,
        color: st.color,
        size: st.size,
        pts: st.pts.slice(),
        end: true,
      }));
      ctx.emit({ k: "mine", step: s.step, strokes } satisfies GarbleEvent, { to: playerId });
      return false;
    }
    default:
      return false;
  }
}

function onReveal(s: GarbleState, playerId: string, a: Record<string, unknown>, ctx: GameCtx): boolean {
  const book = s.books[s.rb];
  switch (a.type) {
    case "react": {
      const e = a.e;
      if (typeof e !== "number" || !Number.isInteger(e) || e < 0 || e >= REACTIONS.length) return false;
      const page = book.pages[s.rp];
      if (!page || page.by === playerId || page.blank || page.auto) return false;
      if (page.react[e].includes(playerId)) return false;
      page.react[e].push(playerId);
      s.scores[page.by] = (s.scores[page.by] ?? 0) + 1;
      ctx.emit({ k: "react", e, by: playerId, b: s.rb, p: s.rp } satisfies GarbleEvent);
      return false; // reactions float up as events; counts ride along with the next view
    }
    case "next": {
      if (book.owner !== playerId || ctx.now() - s.landedAt < NEXT_GUARD_MS) return false;
      advanceReveal(s, ctx);
      return true;
    }
    case "book":
      return onBook(s, playerId, a.b, ctx);
    default:
      return false;
  }
}

// ---------- the game ----------

export const garble: GameDef<GarbleState, GarbleAction> = {
  id: "garble",

  setup(ctx) {
    const players = ctx.players.map((p) => p.id);
    const set = readSettings(config.settings, ctx.settings);
    const maxPages = Math.min(MAX_STEPS, Number(set.pages) || MAX_STEPS);
    const s: GarbleState = {
      players,
      steps: Math.max(1, Math.min(players.length, maxPages)),
      times: [...(PACES[String(set.pace)] ?? PACES.normal)],
      phase: "play",
      step: 0,
      endsAt: 0,
      phaseMs: 0,
      done: [],
      books: players.map((owner) => ({ owner, pages: [] })),
      used: [],
      rb: 0,
      rp: 0,
      landedAt: 0,
      soloSince: null,
      endedEarly: false,
      scores: dict(),
      lastInspire: dict(),
      lastMine: dict(),
      lastBook: dict(),
      final: null,
    };
    startStep(s, ctx, 0);
    updateSolo(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    const index = s.players.indexOf(playerId);
    if (index < 0) return false;
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as unknown as Record<string, unknown>;
    if (s.phase === "play") return onPlay(s, playerId, index, a, ctx);
    if (s.phase === "reveal") return onReveal(s, playerId, a, ctx);
    if (a.type === "book") return onBook(s, playerId, a.b, ctx);
    return false;
  },

  // Spectators may ask for a revealed book's drawings (read-only).
  spectatorAction(s, viewerId, action, ctx) {
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as Record<string, unknown>;
    if (a.type !== "book") return false;
    return onBook(s, viewerId, a.b, ctx);
  },

  tick(s, ctx) {
    const now = ctx.now();
    if (s.phase === "play") {
      const changed = updateSolo(s, ctx);
      if (s.soloSince !== null && now - s.soloSince >= SOLO_GRACE_MS) {
        // Nobody left to pass books to: show what we have.
        s.endedEarly = true;
        finalizeStep(s, ctx);
        startReveal(s, ctx);
        return true;
      }
      if (now >= s.endsAt || allDone(s, ctx)) {
        endStep(s, ctx);
        return true;
      }
      return changed;
    }
    if (s.phase === "reveal" && now >= s.endsAt) {
      advanceReveal(s, ctx);
      return true;
    }
    return false;
  },
  tickMs: 250,

  playerLeft(s, playerId, ctx) {
    if (s.phase !== "play" || !s.players.includes(playerId)) return;
    updateSolo(s, ctx);
    // Don't wait for someone who left: everyone else may already be done.
    if (allDone(s, ctx)) endStep(s, ctx);
  },

  playerReturned(s, playerId, ctx) {
    if (s.phase !== "play" || !s.players.includes(playerId)) return;
    updateSolo(s, ctx);
  },

  view(s, viewerId): GarbleView {
    const index = s.players.indexOf(viewerId);
    const v: GarbleView = {
      phase: s.phase,
      players: s.players,
      steps: s.steps,
      step: s.step,
      endsAt: s.endsAt,
      phaseMs: s.phaseMs,
      done: s.done,
      hold: null,
      reveal: null,
      final: null,
      soloEndsAt: s.soloSince === null ? null : s.soloSince + SOLO_GRACE_MS,
      endedEarly: s.endedEarly,
      times: s.times,
    };
    if (s.phase === "play" && index >= 0) {
      const b = bookFor(s.players.length, index, s.step);
      const book = s.books[b];
      const mine = book.pages[s.step];
      v.hold = {
        book: b,
        owner: book.owner,
        prev: s.step > 0 ? pageView(book.pages[s.step - 1], true) : null,
        draft: mine.kind === "text" ? mine.text : "",
        ink: mine.kind === "draw" ? mine.strokes.length : 0,
      };
    } else if (s.phase === "reveal") {
      const book = s.books[s.rb];
      const page = book.pages[s.rp];
      v.reveal = {
        book: s.rb,
        owner: book.owner,
        page: s.rp,
        pages: book.pages.length,
        trail: book.pages.slice(0, s.rp).map((p) => pageView(p, false)),
        current: page ? pageView(page, true) : null,
        react: page ? page.react : REACTIONS.map(() => []),
        landedAt: s.landedAt,
      };
    } else if (s.phase === "final") {
      v.final = s.final;
    }
    return v;
  },
};

export default garble;
