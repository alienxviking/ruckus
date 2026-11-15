import type { GameCtx, GameDef } from "../../shared/game";
import { makePuzzle } from "./puzzles";
import {
  AUTO_MS,
  AWAY_MS,
  BOOM_MS,
  FLIGHT_MS,
  FUSE_MAX_MS,
  FUSE_MIN_MS,
  HECKLES,
  LIVES,
  ONE_LIFE_FROM,
  PENALTY_MS,
  READY_FIRST_MS,
  READY_MS,
  checkAnswer,
  type Puzzle,
  type PuzzleType,
} from "./shared";

// Hot Potato. One potato per round with a hidden fuse (fuseAt, server-only and
// never in a view or event until it has gone off). The holder solves a micro
// puzzle to arm a throw, then throws it at someone. Explosions are resolved
// against fuseAt itself, so tick latency never changes who loses: if the fuse
// ran out while the potato was in the air, the thrower loses.
//
// Network: a throw is one broadcast (the flight carries from/to/at/lands and
// the catcher's next puzzle, which opens on landing), so landing needs no
// message. tick() only broadcasts on phase changes, booms and auto-throws.

export type Phase = "ready" | "live" | "boom" | "over";

/** Seconds a client may be ahead of the server when it reveals a puzzle. */
const OPEN_SLACK_MS = 150;
/** Heckles: at most HECKLE_BURST per HECKLE_WINDOW_MS, and HECKLE_GAP_MS apart. */
const HECKLE_BURST = 4;
const HECKLE_WINDOW_MS = 3_000;
const HECKLE_GAP_MS = 250;

interface Seat {
  id: string;
  lives: number;
  /** Round they were knocked out in (null = still in). */
  outRound: number | null;
  throws: number;
  wrong: number;
  /** Fastest correct solve, ms after the puzzle showed. */
  best: number | null;
  /** Booms they outlived. */
  survived: number;
  /** Lives lost (in hand or mid-air). */
  booms: number;
  midair: number;
}

export interface Flight {
  from: string;
  to: string;
  at: number;
  lands: number;
  /** Throw number within the round (1, 2, ...). */
  pass: number;
}

interface Held {
  n: number;
  pz: Puzzle;
  /** The puzzle shows (and can be answered) from here: landing, or after a penalty. */
  openAt: number;
}

export interface Boom {
  victim: string;
  midair: boolean;
  /** Mid-air only: the throw that blew up and how far along it was (0..1). */
  from: string | null;
  to: string | null;
  frac: number;
  /** The victim's lives after the boom. */
  lives: number;
  out: boolean;
  /** Revealed only after it went off. */
  fuseMs: number;
  passes: number;
  at: number;
}

export interface PotatoState {
  phase: Phase;
  round: number;
  maxLives: number;
  seats: Seat[];
  holder: string | null;
  /** Who threw it to the holder (can't be thrown straight back unless 2 are left). */
  lastFrom: string | null;
  flight: Flight | null;
  passes: number;
  armed: boolean;
  /** Server time the holder armed (sim scripts use it; never in a view). */
  armedAt: number | null;
  held: Held | null;
  pzNo: number;
  lastType: PuzzleType | null;
  /** When the current round went live (sparks heat up from here). */
  liveAt: number;
  /** Deadline of the ready / boom phase. */
  endsAt: number;
  /** SECRET. When the potato goes off. Never sent anywhere before it does. */
  fuseAt: number;
  /** Disconnected holder: their throw goes automatically at this time. */
  autoAt: number | null;
  boom: Boom | null;
  /** Since when fewer than two survivors are connected. */
  awaySince: number | null;
  winner: string | null;
  over: boolean;
  /** Knocked-out players, first out first. */
  outOrder: string[];
  /** Recent heckle times per sender (rate limiting only). */
  heckles: Record<string, number[]>;
}

export type PotatoAction =
  | { type: "solve"; n: number; a: number | number[] }
  | { type: "throw"; to: string }
  | { type: "heckle"; e: number };

export interface SeatView {
  id: string;
  lives: number;
  out: boolean;
}

export interface StatLine {
  id: string;
  throws: number;
  wrong: number;
  best: number | null;
  survived: number;
  outRound: number | null;
  lives: number;
}

export interface PotatoView {
  phase: Phase;
  round: number;
  maxLives: number;
  seats: SeatView[];
  holder: string | null;
  lastFrom: string | null;
  flight: Flight | null;
  passes: number;
  armed: boolean;
  /** Round start (live) for the heat; ready/boom deadline in endsAt. */
  liveAt: number;
  endsAt: number | null;
  readyMs: number;
  autoAt: number | null;
  boom: Boom | null;
  winner: string | null;
  outOrder: string[];
  /** Game ends at this time unless more survivors reconnect. */
  awayEndsAt: number | null;
  /** The holder's own puzzle (nobody else's view has it). */
  held: Held | null;
  /** Final stats, once the game is over. */
  stats: StatLine[] | null;
}

// ---------- helpers ----------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const seatOf = (s: PotatoState, id: string) => s.seats.find((x) => x.id === id);
const alive = (s: PotatoState) => s.seats.filter((x) => x.lives > 0);
const isAway = (ctx: GameCtx, id: string) => ctx.player(id)?.connected === false;
const nameOf = (ctx: GameCtx, id: string) => ctx.player(id)?.name ?? "Someone";

function canTarget(s: PotatoState, from: string, to: string): boolean {
  if (to === from) return false;
  const t = seatOf(s, to);
  if (!t || t.lives <= 0) return false;
  return to !== s.lastFrom || alive(s).length <= 2;
}

function newPuzzle(s: PotatoState, ctx: GameCtx, openAt: number) {
  const pz = makePuzzle(ctx.random, s.lastType);
  s.lastType = pz.t;
  s.pzNo += 1;
  s.held = { n: s.pzNo, pz, openAt };
}

function startReady(s: PotatoState, ctx: GameCtx, ms: number) {
  const now = ctx.now();
  const survivors = alive(s);
  s.round += 1;
  s.phase = "ready";
  s.holder = survivors[Math.floor(ctx.random() * survivors.length)].id;
  s.lastFrom = null;
  s.flight = null;
  s.passes = 0;
  s.armed = false;
  s.armedAt = null;
  s.held = null;
  s.autoAt = null;
  s.boom = null;
  s.endsAt = now + ms;
  s.liveAt = s.endsAt;
}

function startLive(s: PotatoState, ctx: GameCtx) {
  const now = ctx.now();
  s.phase = "live";
  s.liveAt = now;
  s.fuseAt = now + FUSE_MIN_MS + Math.floor(ctx.random() * (FUSE_MAX_MS - FUSE_MIN_MS + 1));
  newPuzzle(s, ctx, now);
}

function doThrow(s: PotatoState, from: string, to: string, ctx: GameCtx) {
  const now = ctx.now();
  s.passes += 1;
  s.flight = { from, to, at: now, lands: now + FLIGHT_MS, pass: s.passes };
  s.lastFrom = from;
  s.holder = to;
  s.armed = false;
  s.armedAt = null;
  s.autoAt = null;
  newPuzzle(s, ctx, s.flight.lands);
}

/** The fuse ran out: whoever had it at fuseAt (or threw it, if it was mid-air) loses a life. */
function explode(s: PotatoState, ctx: GameCtx) {
  const f = s.flight;
  const midair = !!f && s.fuseAt < f.lands;
  const victimId = midair ? f.from : s.holder!;
  const v = seatOf(s, victimId)!;
  v.lives = Math.max(0, v.lives - 1);
  v.booms += 1;
  if (midair) v.midair += 1;
  for (const x of s.seats) if (x.lives > 0 && x !== v) x.survived += 1;
  const out = v.lives === 0;
  if (out) {
    v.outRound = s.round;
    s.outOrder.push(v.id);
  }
  s.boom = {
    victim: v.id,
    midair,
    from: midair ? f.from : null,
    to: midair ? f.to : null,
    frac: midair ? Math.min(1, Math.max(0, (s.fuseAt - f.at) / (f.lands - f.at))) : 1,
    lives: v.lives,
    out,
    fuseMs: s.fuseAt - s.liveAt,
    passes: s.passes,
    at: s.fuseAt,
  };
  s.phase = "boom";
  s.holder = null;
  s.flight = null;
  s.armed = false;
  s.armedAt = null;
  s.held = null;
  s.autoAt = null;
  s.endsAt = ctx.now() + BOOM_MS;
}

/** Resolve the fuse if it has run out. True when it just went off. */
function settle(s: PotatoState, ctx: GameCtx): boolean {
  if (s.phase !== "live" || ctx.now() < s.fuseAt) return false;
  explode(s, ctx);
  return true;
}

function scoreRecord(s: PotatoState) {
  return Object.fromEntries(s.seats.map((x) => [x.id, x.survived]));
}

function finish(s: PotatoState, ctx: GameCtx) {
  s.phase = "over";
  s.over = true;
  s.awaySince = null;
  s.holder = null;
  s.flight = null;
  s.held = null;
  const left = alive(s);
  s.winner = left.length === 1 ? left[0].id : null;
  if (s.winner) {
    const w = seatOf(s, s.winner)!;
    const hearts = w.lives === s.maxLives && s.maxLives > 1 ? " without a scratch" : "";
    ctx.end({
      winners: [s.winner],
      headline: `🥔 ${nameOf(ctx, s.winner)} is the last one standing in Hot Potato${hearts}`,
      scores: scoreRecord(s),
    });
  } else {
    ctx.end({ winners: [], headline: "Hot Potato ended with nobody left standing", scores: scoreRecord(s) });
  }
}

/** Fewer than two connected survivors for too long: whoever's still here wins. */
function abandon(s: PotatoState, ctx: GameCtx) {
  const here = alive(s).filter((x) => !isAway(ctx, x.id));
  s.phase = "over";
  s.over = true;
  s.awaySince = null;
  s.holder = null;
  s.flight = null;
  s.held = null;
  s.boom = null;
  s.winner = here.length === 1 ? here[0].id : null;
  if (s.winner) {
    ctx.end({
      winners: [s.winner],
      headline: `🥔 ${nameOf(ctx, s.winner)} wins Hot Potato: everyone else left`,
      scores: scoreRecord(s),
    });
  } else {
    ctx.end({ winners: [], headline: "Hot Potato ended: the players left", scores: scoreRecord(s) });
  }
}

/** Track "fewer than two connected survivors". True when that changed. */
function updateAway(s: PotatoState, ctx: GameCtx): boolean {
  const left = alive(s);
  const short = left.length >= 2 && left.filter((x) => !isAway(ctx, x.id)).length < 2;
  if (short && s.awaySince === null) {
    s.awaySince = ctx.now();
    return true;
  }
  if (!short && s.awaySince !== null) {
    s.awaySince = null;
    return true;
  }
  return false;
}

/** Pick a throw target for a disconnected holder: anyone legal, connected players first. */
function autoTarget(s: PotatoState, from: string, ctx: GameCtx): string | null {
  const legal = s.seats.filter((x) => canTarget(s, from, x.id));
  const here = legal.filter((x) => !isAway(ctx, x.id));
  const pool = here.length ? here : legal;
  if (!pool.length) return null;
  return pool[Math.floor(ctx.random() * pool.length)].id;
}

/** A disconnected holder auto-throws AUTO_MS after the potato reached them. True when visible state changed. */
function updateAuto(s: PotatoState, ctx: GameCtx): boolean {
  if (s.phase !== "live" || !s.holder) return false;
  const holder = s.holder;
  if (!isAway(ctx, holder)) {
    if (s.autoAt === null) return false;
    s.autoAt = null;
    return true;
  }
  const now = ctx.now();
  if (s.autoAt === null) {
    s.autoAt = Math.max(now, s.flight?.lands ?? now) + AUTO_MS;
    return true;
  }
  if (now < s.autoAt) return false;
  const to = autoTarget(s, holder, ctx);
  if (!to) return false;
  doThrow(s, holder, to, ctx);
  return true;
}

function heckle(s: PotatoState, from: string, e: unknown, ctx: GameCtx): false {
  if (typeof e !== "number" || !Number.isInteger(e) || e < 0 || e >= HECKLES.length) return false;
  const now = ctx.now();
  const recent = (s.heckles[from] ?? []).filter((t) => now - t < HECKLE_WINDOW_MS);
  if (recent.length >= HECKLE_BURST || (recent.length && now - recent[recent.length - 1] < HECKLE_GAP_MS)) {
    s.heckles[from] = recent;
    return false;
  }
  recent.push(now);
  s.heckles[from] = recent;
  // The sender already shows their own heckle locally.
  ctx.emit({ k: "h", f: from, e }, { except: from });
  return false;
}

// ---------- the game ----------

export const potato: GameDef<PotatoState, unknown> = {
  id: "potato",

  setup(ctx) {
    const maxLives = ctx.players.length >= ONE_LIFE_FROM ? 1 : LIVES;
    const s: PotatoState = {
      phase: "ready",
      round: 0,
      maxLives,
      seats: ctx.players.map((p) => ({
        id: p.id,
        lives: maxLives,
        outRound: null,
        throws: 0,
        wrong: 0,
        best: null,
        survived: 0,
        booms: 0,
        midair: 0,
      })),
      holder: null,
      lastFrom: null,
      flight: null,
      passes: 0,
      armed: false,
      armedAt: null,
      held: null,
      pzNo: 0,
      lastType: null,
      liveAt: 0,
      endsAt: 0,
      fuseAt: Number.MAX_SAFE_INTEGER,
      autoAt: null,
      boom: null,
      awaySince: null,
      winner: null,
      over: false,
      outOrder: [],
      heckles: {},
    };
    startReady(s, ctx, READY_FIRST_MS);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.over) return false;
    const me = seatOf(s, playerId);
    if (!me || !isObj(action)) return false;
    const a = action;
    // Knocked-out players heckle; survivors are busy.
    if (a.type === "heckle") return me.lives > 0 ? false : heckle(s, playerId, a.e, ctx);
    if (s.phase !== "live" || (a.type !== "solve" && a.type !== "throw")) return false;
    // The fuse wins any race: if it's already out, this action comes too late.
    if (settle(s, ctx)) return true;
    if (s.holder !== playerId) return false;
    const now = ctx.now();

    if (a.type === "solve") {
      const held = s.held;
      if (s.armed || !held || a.n !== held.n || now < held.openAt - OPEN_SLACK_MS) return false;
      const verdict = checkAnswer(held.pz, a.a);
      if (verdict === null) return false;
      if (verdict) {
        s.armed = true;
        s.armedAt = now;
        s.held = null;
        const ms = Math.max(0, now - held.openAt);
        me.best = me.best === null ? ms : Math.min(me.best, ms);
      } else {
        me.wrong += 1;
        newPuzzle(s, ctx, now + PENALTY_MS);
      }
      return true;
    }

    // throw
    if (!s.armed || typeof a.to !== "string" || !canTarget(s, playerId, a.to)) return false;
    me.throws += 1;
    doThrow(s, playerId, a.to, ctx);
    return true;
  },

  // Spectators can only heckle: an emitted event, no game state touched.
  spectatorAction(s, viewerId, action, ctx) {
    if (s.over || !isObj(action) || action.type !== "heckle") return false;
    if (seatOf(s, viewerId)) return false;
    return heckle(s, viewerId, action.e, ctx);
  },

  tick(s, ctx) {
    if (s.over) return false;
    const now = ctx.now();
    const changed = updateAway(s, ctx);
    if (s.awaySince !== null && now >= s.awaySince + AWAY_MS) {
      abandon(s, ctx);
      return true;
    }
    switch (s.phase) {
      case "ready":
        if (now < s.endsAt) return changed;
        startLive(s, ctx);
        return true;
      case "live":
        if (settle(s, ctx)) return true;
        return updateAuto(s, ctx) || changed;
      case "boom":
        if (now < s.endsAt) return changed;
        if (alive(s).length <= 1) finish(s, ctx);
        else startReady(s, ctx, READY_MS);
        return true;
      default:
        return changed;
    }
  },
  // Fast enough that a BOOM lands on time; ticks only broadcast when something happened.
  tickMs: 100,

  playerLeft(s, _id, ctx) {
    if (s.over) return;
    updateAway(s, ctx);
    updateAuto(s, ctx);
  },

  playerReturned(s, _id, ctx) {
    if (s.over) return;
    updateAway(s, ctx);
    updateAuto(s, ctx);
  },

  view(s, viewerId): PotatoView {
    const mine = s.phase === "live" && s.holder === viewerId ? s.held : null;
    return {
      phase: s.phase,
      round: s.round,
      maxLives: s.maxLives,
      seats: s.seats.map((x) => ({ id: x.id, lives: x.lives, out: x.lives <= 0 })),
      holder: s.holder,
      lastFrom: s.lastFrom,
      flight: s.phase === "live" ? s.flight : null,
      passes: s.passes,
      armed: s.armed,
      liveAt: s.liveAt,
      endsAt: s.phase === "ready" || s.phase === "boom" ? s.endsAt : null,
      readyMs: s.round === 1 ? READY_FIRST_MS : READY_MS,
      autoAt: s.autoAt,
      boom: s.boom,
      winner: s.winner,
      outOrder: s.outOrder,
      awayEndsAt: s.awaySince === null ? null : s.awaySince + AWAY_MS,
      held: mine ? { n: mine.n, pz: mine.pz, openAt: mine.openAt } : null,
      stats: s.over
        ? s.seats.map((x) => ({
            id: x.id,
            throws: x.throws,
            wrong: x.wrong,
            best: x.best,
            survived: x.survived,
            outRound: x.outRound,
            lives: x.lives,
          }))
        : null,
    };
  },
};

export default potato;
