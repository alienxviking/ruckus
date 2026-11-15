import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import {
  COUNTDOWN_MS,
  DELTA,
  DIRS,
  GHOST_MS,
  GOLDEN_VALUE,
  MAX_HOLD,
  MAX_QUEUE,
  MAX_ROUNDS,
  OPPOSITE,
  REJOIN_MS,
  ROUND_MS,
  ROUND_OVER_MS,
  START_LEN,
  TICK_MS,
  WINS_NEEDED,
  isDir,
  type DeathCause,
  type Dir,
  type Phase,
  type RoundReason,
} from "./shared";

// Snake Brawl: real-time, last snake standing. The server owns the grid and moves
// every snake one cell per tick. The whole board is public, so every connection
// gets the same view; the only hidden information is each player's queued turns,
// which no other player ever sees.
//
// Latency: a turn can name the step it should land on (`at`, numbered like `tick`).
// The owner's client runs its own snake a little ahead of the server and stamps each
// turn for the step it is showing next, so the turn appears at once on their screen
// and the server applies it on exactly that step (holding it if it arrives early).
// A late turn just lands on the next step and the client corrects itself. Each player's
// view carries their own input status (`me`), which is how the client tunes its lead.
//
// Bandwidth: a plain step goes out as a tiny delta event (each snake's direction and length,
// pellets that came and went; see SnakeDelta) and tick() returns false. The full view (which
// can always render from scratch) goes out on phase changes, deaths, joins and refreshes, and
// every KEYFRAME_MS as a safety net. A client that misses a step asks for a keyframe ("sync").

const SMALL_GRID = { w: 32, h: 24 }; // up to 3 players
const LARGE_GRID = { w: 40, h: 30 }; // 4-8 players
const MAX_SNAKES = 8;
const GOLDEN_EVERY_MS = 8_000;
const GOLDEN_JITTER_MS = 1_000;
const FEED_LIMIT = 6;
/** During play a full view still goes out this often, so a client can never drift for long. */
export const KEYFRAME_MS = 3_000;
/** A viewer gets at most one requested keyframe this often. */
const SYNC_MS = 1_000;
/** Distance from the wall behind a fresh snake to its head (its tail sits 2 cells off the wall). */
const SPAWN_INSET = 5;

type Side = "L" | "R" | "T" | "B";
/**
 * Spawn slots per snake count as [side, fraction along that side]. Found by a search
 * that keeps heads spread out and guarantees nobody can crash in the first ~1.5s if
 * everyone just goes straight. Each round shuffles who gets which slot and may mirror
 * the whole layout, so nobody is stuck with the same spot.
 */
const SLOTS: Record<number, [Side, number][]> = {
  2: [["L", 0.25], ["R", 0.75]],
  3: [["L", 0.5], ["R", 0.8], ["T", 0.6]],
  4: [["L", 0.2], ["T", 0.7], ["R", 0.8], ["B", 0.3]],
  5: [["L", 0.75], ["T", 0.5], ["R", 0.35], ["B", 0.7], ["L", 0.2]],
  6: [["L", 0.25], ["T", 0.4], ["R", 0.75], ["B", 0.5], ["L", 0.8], ["T", 0.75]],
  7: [["L", 0.9], ["T", 0.6], ["R", 0.2], ["B", 0.45], ["L", 0.55], ["T", 0.15], ["R", 0.8]],
  8: [["L", 0.55], ["T", 0.3], ["R", 0.7], ["B", 0.15], ["L", 0.2], ["T", 0.55], ["R", 0.2], ["B", 0.65]],
};

/** A queued turn: applied on the first step numbered `at` or later (one per step, in order). */
export interface QueuedTurn {
  dir: Dir;
  at: number;
  /** The client's input number (0 = none given). */
  seq: number;
}

export interface Snake {
  id: string;
  /** Cell indices (y * w + x), head first. */
  body: number[];
  /** Direction of the last move. */
  dir: Dir;
  /** Pending turns, consumed one per tick. Never sent to other players. */
  queue: QueuedTurn[];
  /** Input bookkeeping for the owner's prediction: last applied input number... */
  applied: number;
  /** ...the last one received... */
  rx: number;
  /** ...and how many ms before its step it arrived (negative = late). */
  slack: number;
  alive: boolean;
  /** Cells still to grow (the tail stays put while this is > 0). */
  grow: number;
  /** Server time of death, 0 while alive. */
  diedAt: number;
  /** Starting cells, so a player who drops during the countdown can be put back. */
  spawn: number[];
  spawnDir: Dir;
  /** Pulled off the board during the countdown because the player disconnected. */
  away: boolean;
}

export interface FeedItem {
  id: string;
  cause: DeathCause;
  /** The other snake involved (body hit or head-on), if any. */
  by: string | null;
  at: number;
}

export interface SnakeState {
  w: number;
  h: number;
  /** Participants in join order. */
  ids: string[];
  phase: Phase;
  /** Absolute deadline of the current phase (0 when final). */
  endsAt: number;
  round: number;
  roundWins: Record<string, number>;
  /** Each finished round: winner (null = draw) and why it ended. */
  history: RoundResult[];
  lastRoundWinner: string | null;
  roundReason: RoundReason | null;
  /** Longest each player has been this match. */
  best: Record<string, number>;
  /** Snakes in this round, in participant order (offline players get none). */
  snakes: Snake[];
  food: number[];
  golden: number | null;
  /** When a golden pellet appears if none is on the board. */
  goldenAt: number;
  /** Deaths this round, newest last. */
  feed: FeedItem[];
  /** Movement steps so far (clients use it to spot fresh frames). */
  tick: number;
  /** Server time of the latest step (or of the start of play). */
  stepAt: number;
  champions: string[] | null;
  /**
   * Set when a round ended with fewer than two players online: the next round waits
   * (up to REJOIN_MS) for someone to reconnect, so one page refresh can't end the match.
   */
  waitingSince: number | null;
  /** Bumped on every visible change; keys the shared view cache. */
  rev: number;
  /** When the last full view went out during play (deltas fill the gaps). */
  fullAt: number;
}

/**
 * `seq` numbers the client's inputs and `at` names the step the turn should land on
 * (both optional; without `at` the turn happens on the next step).
 */
export type SnakeAction = { type: "turn"; dir: Dir; seq?: number; at?: number } | { type: "sync" };

/**
 * One plain step, sent to everyone as an event instead of a full view.
 * Apply it to the view of step `n - 1` of round `r` (see delta.ts).
 */
export interface SnakeDelta {
  k: "d";
  r: number;
  n: number;
  /** Server time of the step (SnakeView.at). */
  at: number;
  /** For each live snake in view order: [direction index into DIRS, body cells, length]. */
  m: number[];
  /** Pellets added / removed (cell indices y * w + x). */
  fa?: number[];
  fr?: number[];
  /** Golden pellet moved (cell index) or vanished (-1). */
  g?: number;
  /** Turns applied this step: [snake index in view order, input number, ...]. */
  ap?: number[];
}

/** A player's turn reached the server: [input number, ms it arrived before its step]. Only to them. */
export interface SnakeInputEcho {
  k: "m";
  r: number;
  rx: number;
  sl: number;
}

/** A full view on request (after a missed step). Only to the one who asked. */
export interface SnakeKeyframe {
  k: "K";
  v: SnakeView;
}

export type SnakeEvent = SnakeDelta | SnakeInputEcho | SnakeKeyframe;

export interface RoundResult {
  winner: string | null;
  reason: RoundReason;
}

export interface SnakeV {
  id: string;
  /** Flat [x, y, x, y, ...], head first. Empty once a dead snake's flash is over. */
  body: number[];
  dir: Dir;
  alive: boolean;
  len: number;
  /** Server time of death (dead snakes only). */
  diedAt?: number;
}

export interface SnakeView {
  phase: Phase;
  endsAt: number;
  w: number;
  h: number;
  round: number;
  tick: number;
  roundWins: Record<string, number>;
  history: RoundResult[];
  lastRoundWinner: string | null;
  roundReason: RoundReason | null;
  best: Record<string, number>;
  snakes: SnakeV[];
  /** Flat [x, y, x, y, ...]. */
  food: number[];
  golden: [number, number] | null;
  feed: FeedItem[];
  /** Match winners (final phase only). */
  champions?: string[];
  /** True while round over is held open waiting for a disconnected player (endsAt = give-up time). */
  waiting: boolean;
  /** Server time of the step `tick` (play only): lets the owner's client run its snake ahead. */
  at?: number;
  /**
   * The viewer's own input status (players with a snake, countdown and play only):
   * [last applied input, last received input, ms it arrived before its step].
   */
  me?: [number, number, number];
}

// ---------- helpers ----------

const lenOf = (sn: Snake) => sn.body.length + sn.grow;
/** A non-negative integer small enough to be a step or input number. */
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2 ** 31;

function onlineIds(s: SnakeState, ctx: GameCtx) {
  return s.ids.filter((id) => ctx.player(id)?.connected !== false);
}

function goldenDelay(ctx: GameCtx) {
  return GOLDEN_EVERY_MS + Math.round((ctx.random() * 2 - 1) * GOLDEN_JITTER_MS);
}

/** 1 = taken by a live snake, food or the golden pellet. */
function occupancy(s: SnakeState): Uint8Array {
  const m = new Uint8Array(s.w * s.h);
  for (const sn of s.snakes) if (sn.alive) for (const c of sn.body) m[c] = 1;
  for (const c of s.food) m[c] = 1;
  if (s.golden !== null) m[s.golden] = 1;
  return m;
}

function randomEmpty(s: SnakeState, ctx: GameCtx, blocked: Uint8Array): number {
  const n = s.w * s.h;
  for (let i = 0; i < 40; i++) {
    const c = Math.min(n - 1, Math.floor(ctx.random() * n));
    if (!blocked[c]) return c;
  }
  const free: number[] = [];
  for (let c = 0; c < n; c++) if (!blocked[c]) free.push(c);
  return free.length ? free[Math.min(free.length - 1, Math.floor(ctx.random() * free.length))] : -1;
}

/** Keep at least (snakes + 3) normal pellets on the board. */
function topUpFood(s: SnakeState, ctx: GameCtx, blocked = occupancy(s)) {
  const target = s.snakes.length + 3;
  while (s.food.length < target) {
    const c = randomEmpty(s, ctx, blocked);
    if (c < 0) break;
    s.food.push(c);
    blocked[c] = 1;
  }
}

/**
 * Starting bodies (cell indices, head first) and headings for `n` snakes on a w×h board,
 * optionally mirrored. Pure, exported for tests.
 */
export function spawnLayout(w: number, h: number, n: number, flipX: boolean, flipY: boolean) {
  const slots = SLOTS[Math.min(MAX_SNAKES, Math.max(2, n))].slice(0, Math.max(0, n));
  return slots.map(([side, f]) => {
    const vertical = side === "T" || side === "B";
    let x = vertical ? Math.round(f * (w - 1)) : side === "L" ? SPAWN_INSET : w - 1 - SPAWN_INSET;
    let y = !vertical ? Math.round(f * (h - 1)) : side === "T" ? SPAWN_INSET : h - 1 - SPAWN_INSET;
    let dir: Dir = side === "L" ? "right" : side === "R" ? "left" : side === "T" ? "down" : "up";
    if (flipX) {
      x = w - 1 - x;
      if (dir === "left" || dir === "right") dir = OPPOSITE[dir];
    }
    if (flipY) {
      y = h - 1 - y;
      if (dir === "up" || dir === "down") dir = OPPOSITE[dir];
    }
    const [dx, dy] = DELTA[dir];
    const body = Array.from({ length: START_LEN }, (_, i) => (y - dy * i) * w + (x - dx * i));
    return { body, dir };
  });
}

/** Fresh board for the current round: snakes for `ids`, food, countdown. */
function startRound(s: SnakeState, ctx: GameCtx, ids: string[]) {
  const playing = ids.slice(0, MAX_SNAKES);
  const order = shuffle(playing, ctx.random);
  const spawns = spawnLayout(s.w, s.h, playing.length, ctx.random() < 0.5, ctx.random() < 0.5);
  const made = new Map<string, Snake>();
  order.forEach((id, i) => {
    const { body, dir } = spawns[i];
    made.set(id, {
      id,
      body,
      dir,
      queue: [],
      applied: 0,
      rx: 0,
      slack: 0,
      alive: true,
      grow: 0,
      diedAt: 0,
      spawn: body.slice(),
      spawnDir: dir,
      away: false,
    });
  });
  s.snakes = s.ids.flatMap((id) => made.get(id) ?? []);
  s.food = [];
  s.golden = null;
  s.goldenAt = 0;
  s.feed = [];
  s.phase = "countdown";
  s.endsAt = ctx.now() + COUNTDOWN_MS;
  // No free snack straight ahead of anyone's nose.
  const blocked = occupancy(s);
  for (const sn of s.snakes) {
    const [dx, dy] = DELTA[sn.dir];
    for (let k = 1; k <= 2; k++) {
      const x = (sn.body[0] % s.w) + dx * k;
      const y = Math.floor(sn.body[0] / s.w) + dy * k;
      if (x >= 0 && y >= 0 && x < s.w && y < s.h) blocked[y * s.w + x] = 1;
    }
  }
  topUpFood(s, ctx, blocked);
}

function kill(s: SnakeState, sn: Snake, cause: DeathCause, by: string | null, now: number) {
  sn.alive = false;
  sn.diedAt = now;
  sn.queue = [];
  s.feed.push({ id: sn.id, cause, by, at: now });
  if (s.feed.length > FEED_LIMIT) s.feed.splice(0, s.feed.length - FEED_LIMIT);
}

/** Dead snakes burst into food: every second body cell becomes a pellet. */
function dropFood(s: SnakeState, dead: Snake[]) {
  if (!dead.length) return;
  const blocked = occupancy(s);
  for (const sn of dead) {
    for (let j = 0; j < sn.body.length; j += 2) {
      const c = sn.body[j];
      if (blocked[c]) continue;
      s.food.push(c);
      blocked[c] = 1;
    }
  }
}

/** One movement step. All snakes move at once and collisions are resolved together. */
function step(s: SnakeState, ctx: GameCtx) {
  const now = ctx.now();
  const { w, h } = s;
  s.tick += 1;
  s.stepAt = now;
  const live = s.snakes.filter((sn) => sn.alive);
  for (const sn of live) {
    // One turn per step, in order; a turn aimed at a later step waits for it.
    const turn = sn.queue[0];
    if (turn && turn.at <= s.tick) {
      sn.queue.shift();
      sn.dir = turn.dir;
      if (turn.seq) sn.applied = turn.seq;
    }
  }

  // Cells that stay occupied through this move: every live body, minus tails that move away.
  const owner = new Int8Array(w * h); // snake index + 1, 0 = free
  live.forEach((sn, i) => {
    const keep = sn.grow > 0 ? sn.body.length : sn.body.length - 1;
    for (let j = 0; j < keep; j++) owner[sn.body[j]] = i + 1;
  });

  const next = live.map((sn) => {
    const [dx, dy] = DELTA[sn.dir];
    const x = (sn.body[0] % w) + dx;
    const y = Math.floor(sn.body[0] / w) + dy;
    return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x;
  });

  const deaths: { sn: Snake; cause: DeathCause; by: string | null }[] = [];
  live.forEach((sn, i) => {
    const c = next[i];
    if (c < 0) {
      deaths.push({ sn, cause: "wall", by: null });
      return;
    }
    const rival = live.find((_, k) => k !== i && next[k] === c);
    if (rival) {
      deaths.push({ sn, cause: "head", by: rival.id });
      return;
    }
    const o = owner[c];
    if (!o) return;
    const hit = live[o - 1];
    if (hit === sn) {
      deaths.push({ sn, cause: "self", by: null });
      return;
    }
    // Two heads swapping cells is a head-on crash as well.
    const swap = hit.body[0] === c && next[o - 1] === sn.body[0];
    deaths.push({ sn, cause: swap ? "head" : "snake", by: hit.id });
  });
  for (const d of deaths) kill(s, d.sn, d.cause, d.by, now);

  live.forEach((sn, i) => {
    if (!sn.alive) return;
    sn.body.unshift(next[i]);
    if (sn.grow > 0) sn.grow -= 1;
    else sn.body.pop();
  });

  for (const sn of live) {
    if (!sn.alive) continue;
    const head = sn.body[0];
    const fi = s.food.indexOf(head);
    if (fi !== -1) {
      s.food.splice(fi, 1);
      sn.grow += 1;
    }
    if (s.golden === head) {
      s.golden = null;
      sn.grow += GOLDEN_VALUE;
      s.goldenAt = now + goldenDelay(ctx);
    }
    s.best[sn.id] = Math.max(s.best[sn.id] ?? 0, lenOf(sn));
  }

  dropFood(s, deaths.map((d) => d.sn));
  topUpFood(s, ctx);
  if (s.golden === null && now >= s.goldenAt) {
    const c = randomEmpty(s, ctx, occupancy(s));
    if (c >= 0) s.golden = c;
    s.goldenAt = now + goldenDelay(ctx);
  }
}

function playerName(ctx: GameCtx, id: string) {
  return ctx.player(id)?.name ?? ctx.players.find((p) => p.id === id)?.name ?? "Someone";
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function finishMatch(s: SnakeState, ctx: GameCtx, winners: string[], how: "won" | "forfeit" | "abandoned") {
  if (s.phase === "final") return;
  s.phase = "final";
  s.endsAt = 0;
  s.champions = winners.slice();
  for (const sn of s.snakes) sn.queue = [];
  const names = winners.map((id) => playerName(ctx, id));
  const best = winners.length ? (s.roundWins[winners[0]] ?? 0) : 0;
  const rest = Math.max(0, ...s.ids.filter((id) => !winners.includes(id)).map((id) => s.roundWins[id] ?? 0));
  let headline: string;
  if (how === "forfeit") headline = `${joinNames(names)} wins Snake Brawl: everyone else left`;
  else if (how === "abandoned") headline = "Snake Brawl is over: everyone left the arena";
  else if (!winners.length) headline = "Snake Brawl ends in a draw: nobody took a round";
  else if (winners.length === 1) headline = `${names[0]} wins Snake Brawl ${best}–${rest}`;
  else headline = `${joinNames(names)} tie Snake Brawl with ${best} round${best === 1 ? "" : "s"} each`;
  ctx.end({ winners: winners.slice(), headline, scores: { ...s.roundWins } });
}

function finishRound(s: SnakeState, ctx: GameCtx, winner: string | null, reason: RoundReason) {
  s.lastRoundWinner = winner;
  s.roundReason = reason;
  s.history.push({ winner, reason });
  for (const sn of s.snakes) sn.queue = [];
  if (winner) s.roundWins[winner] = (s.roundWins[winner] ?? 0) + 1;
  if (winner && s.roundWins[winner] >= WINS_NEEDED) return finishMatch(s, ctx, [winner], "won");
  if (s.round >= MAX_ROUNDS) return finishMatch(s, ctx, topScorers(s.roundWins), "won");
  s.phase = "roundOver";
  s.endsAt = ctx.now() + ROUND_OVER_MS;
}

/** Ends the round if at most one snake is left or time is up (longest snake wins, ties draw). */
function checkRoundEnd(s: SnakeState, ctx: GameCtx) {
  if (s.phase !== "play") return;
  const alive = s.snakes.filter((sn) => sn.alive);
  if (alive.length <= 1) {
    finishRound(s, ctx, alive.length ? alive[0].id : null, alive.length ? "last" : "crash");
    return;
  }
  if (ctx.now() < s.endsAt) return;
  const best = Math.max(...alive.map(lenOf));
  const top = alive.filter((sn) => lenOf(sn) === best);
  if (top.length === 1) finishRound(s, ctx, top[0].id, "time");
  else finishRound(s, ctx, null, "tie");
}

function nextRound(s: SnakeState, ctx: GameCtx) {
  const ids = onlineIds(s, ctx);
  if (ids.length < 2 && s.waitingSince === null) {
    // Someone dropped (maybe just a refresh): hold the break open for them.
    s.waitingSince = ctx.now();
    s.endsAt = ctx.now() + REJOIN_MS;
    return;
  }
  s.waitingSince = null;
  if (ids.length === 1) return finishMatch(s, ctx, ids, "forfeit");
  if (ids.length === 0) return finishMatch(s, ctx, topScorers(s.roundWins), "abandoned");
  s.round += 1;
  startRound(s, ctx, ids);
}

function advance(s: SnakeState, ctx: GameCtx): boolean {
  const now = ctx.now();
  switch (s.phase) {
    case "countdown":
      if (now < s.endsAt) return false;
      s.phase = "play";
      s.endsAt = now + ROUND_MS;
      s.stepAt = now;
      s.goldenAt = now + goldenDelay(ctx);
      // Anyone who dropped during the countdown forfeits this round.
      checkRoundEnd(s, ctx);
      return true;
    case "play":
      step(s, ctx);
      checkRoundEnd(s, ctx);
      return true;
    case "roundOver":
      if (s.waitingSince !== null) {
        // Carry on the moment two players are back; give up when the grace runs out.
        if (onlineIds(s, ctx).length < 2 && now < s.endsAt) return false;
      } else if (now < s.endsAt) return false;
      nextRound(s, ctx);
      return true;
    default:
      return false;
  }
}

// ---------- view ----------

function flatCells(s: SnakeState, cells: number[]): number[] {
  const out = new Array<number>(cells.length * 2);
  for (let i = 0; i < cells.length; i++) {
    out[2 * i] = cells[i] % s.w;
    out[2 * i + 1] = Math.floor(cells[i] / s.w);
  }
  return out;
}

/** The public view (identical for every viewer). Exported for tests. */
export function buildView(s: SnakeState, now: number): SnakeView {
  return {
    phase: s.phase,
    endsAt: s.endsAt,
    w: s.w,
    h: s.h,
    round: s.round,
    tick: s.tick,
    roundWins: { ...s.roundWins },
    history: s.history.map((r) => ({ ...r })),
    lastRoundWinner: s.lastRoundWinner,
    roundReason: s.roundReason,
    best: { ...s.best },
    // A snake pulled off during the countdown isn't part of this round (its player sits it out).
    snakes: s.snakes
      .filter((sn) => !sn.away)
      .map((sn) => ({
        id: sn.id,
        body: sn.alive || now - sn.diedAt < GHOST_MS ? flatCells(s, sn.body) : [],
        dir: sn.dir,
        alive: sn.alive,
        len: lenOf(sn),
        ...(sn.alive ? null : { diedAt: sn.diedAt }),
      })),
    food: flatCells(s, s.food),
    golden: s.golden === null ? null : [s.golden % s.w, Math.floor(s.golden / s.w)],
    feed: s.feed.map((f) => ({ ...f })),
    ...(s.champions ? { champions: s.champions.slice() } : null),
    waiting: s.waitingSince !== null,
    ...(s.phase === "play" ? { at: s.stepAt } : null),
  };
}

/** Every viewer sees the same thing, so build the view once per change. */
const viewCache = new WeakMap<SnakeState, { rev: number; view: SnakeView }>();
/** When each viewer last got a keyframe they asked for (not game state, so not in SnakeState). */
const syncs = new WeakMap<SnakeState, Map<string, number>>();

/** Snapshot of what a delta has to describe, taken before a tick. */
interface Before {
  round: number;
  phase: Phase;
  tick: number;
  food: number[];
  golden: number | null;
  feed: number;
  applied: number[];
}

function beforeTick(s: SnakeState): Before {
  return {
    round: s.round,
    phase: s.phase,
    tick: s.tick,
    food: s.food.slice(),
    golden: s.golden,
    feed: s.feed.length,
    applied: s.snakes.map((sn) => sn.applied),
  };
}

/** The delta for a plain step (null when the step needs a full view: a phase change or a death). */
export function makeDelta(s: SnakeState, b: Before): SnakeDelta | null {
  if (s.phase !== "play" || b.phase !== "play" || s.round !== b.round || s.tick !== b.tick + 1) return null;
  if (s.feed.length !== b.feed || s.feed.some((f) => f.at === s.stepAt)) return null;
  const shown = s.snakes.filter((sn) => !sn.away);
  const m: number[] = [];
  const ap: number[] = [];
  shown.forEach((sn, i) => {
    if (!sn.alive) return;
    m.push(DIRS.indexOf(sn.dir), sn.body.length, lenOf(sn));
    const was = b.applied[s.snakes.indexOf(sn)];
    if (sn.applied !== was) ap.push(i, sn.applied);
  });
  const d: SnakeDelta = { k: "d", r: s.round, n: s.tick, at: s.stepAt, m };
  const had = new Set(b.food);
  const now = new Set(s.food);
  const fa = s.food.filter((c) => !had.has(c));
  const fr = b.food.filter((c) => !now.has(c));
  if (fa.length) d.fa = fa;
  if (fr.length) d.fr = fr;
  if (s.golden !== b.golden) d.g = s.golden ?? -1;
  if (ap.length) d.ap = ap;
  return d;
}

// ---------- game definition ----------

/** A client missed a step: send it the full view as an event (at most once a second each). */
function sendKeyframe(s: SnakeState, viewerId: string, ctx: GameCtx): false {
  let seen = syncs.get(s);
  if (!seen) syncs.set(s, (seen = new Map()));
  const now = ctx.now();
  if (now - (seen.get(viewerId) ?? -Infinity) < SYNC_MS) return false;
  seen.set(viewerId, now);
  ctx.emit({ k: "K", v: snakes.view(s, viewerId, ctx) as SnakeView } satisfies SnakeEvent, { to: viewerId });
  return false;
}

export const snakes: GameDef<SnakeState, SnakeAction> = {
  id: "snakes",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const grid = ids.length <= 3 ? SMALL_GRID : LARGE_GRID;
    const s: SnakeState = {
      w: grid.w,
      h: grid.h,
      ids,
      phase: "countdown",
      endsAt: 0,
      round: 1,
      roundWins: Object.fromEntries(ids.map((id) => [id, 0])),
      history: [],
      lastRoundWinner: null,
      roundReason: null,
      best: Object.fromEntries(ids.map((id) => [id, START_LEN])),
      snakes: [],
      food: [],
      golden: null,
      goldenAt: 0,
      feed: [],
      tick: 0,
      stepAt: 0,
      champions: null,
      waitingSince: null,
      rev: 0,
      fullAt: 0,
    };
    const ready = onlineIds(s, ctx);
    startRound(s, ctx, ready.length >= 2 ? ready : ids);
    return s;
  },

  action(s, playerId, action, ctx) {
    const a: unknown = action;
    if (!a || typeof a !== "object" || Array.isArray(a)) return false;
    if ((a as { type?: unknown }).type === "sync") return sendKeyframe(s, playerId, ctx);
    if (s.phase !== "countdown" && s.phase !== "play") return false;
    const { type, dir, seq, at } = a as { type?: unknown; dir?: unknown; seq?: unknown; at?: unknown };
    if (type !== "turn" || !isDir(dir)) return false;
    if (seq !== undefined && !isCount(seq)) return false;
    if (at !== undefined && !isCount(at)) return false;
    const sn = s.snakes.find((x) => x.id === playerId);
    if (!sn || !sn.alive) return false;
    // The step this turn lands on: never one that already happened, never far ahead.
    const when = s.phase === "play" && typeof at === "number" ? Math.min(at, s.tick + 1 + MAX_HOLD) : 0;
    if (typeof seq === "number" && seq > 0) {
      sn.rx = seq;
      // How early it arrived for the step it asked for (the client learns its timing from this).
      sn.slack = when > 0 ? Math.max(-999, Math.min(999, Math.round(s.stepAt + (when - s.tick) * TICK_MS - ctx.now()))) : 0;
      ctx.emit({ k: "m", r: s.round, rx: sn.rx, sl: sn.slack } satisfies SnakeEvent, { to: playerId });
    }
    if (sn.queue.length >= MAX_QUEUE) return false;
    const last = sn.queue.length ? sn.queue[sn.queue.length - 1].dir : sn.dir;
    if (dir === last || dir === OPPOSITE[last]) return false;
    sn.queue.push({ dir, at: when, seq: typeof seq === "number" ? seq : 0 });
    // Queued turns are invisible until the next tick moves the snake: no broadcast needed.
    return false;
  },

  tick(s, ctx) {
    const b = beforeTick(s);
    const changed = advance(s, ctx);
    if (!changed) return false;
    s.rev += 1;
    // A plain step: everyone gets a tiny delta instead of the full view.
    const d = ctx.now() - s.fullAt < KEYFRAME_MS ? makeDelta(s, b) : null;
    if (d) {
      ctx.emit(d satisfies SnakeEvent);
      return false;
    }
    s.fullAt = ctx.now();
    return true;
  },
  tickMs: TICK_MS,

  spectatorAction(s, viewerId, action, ctx) {
    const a: unknown = action;
    if (!a || typeof a !== "object" || (a as { type?: unknown }).type !== "sync") return false;
    return sendKeyframe(s, viewerId, ctx);
  },

  view(s, viewerId, ctx) {
    const hit = viewCache.get(s);
    let view: SnakeView;
    if (hit && hit.rev === s.rev) view = hit.view;
    else {
      view = buildView(s, ctx.now());
      viewCache.set(s, { rev: s.rev, view });
    }
    // Everyone shares one view; a player also gets their own input status (tiny, and only theirs).
    if (s.phase !== "countdown" && s.phase !== "play") return view;
    const sn = s.snakes.find((x) => x.id === viewerId);
    if (!sn || sn.away) return view;
    return { ...view, me: [sn.applied, sn.rx, sn.slack] };
  },

  playerLeft(s, playerId, ctx) {
    const sn = s.snakes.find((x) => x.id === playerId);
    if (!sn || !sn.alive) return;
    if (s.phase === "countdown") {
      // The round hasn't started: lift the snake off the board; it comes back if they do.
      sn.alive = false;
      sn.away = true;
      sn.queue = [];
      sn.diedAt = ctx.now();
      s.rev += 1;
      return;
    }
    if (s.phase !== "play") return;
    kill(s, sn, "left", null, ctx.now());
    dropFood(s, [sn]);
    checkRoundEnd(s, ctx);
    s.rev += 1;
  },

  playerReturned(s, playerId) {
    if (s.phase !== "countdown") return; // otherwise they get a snake next round (the tick notices a waiting break)
    const sn = s.snakes.find((x) => x.id === playerId);
    if (!sn || sn.alive || !sn.away) return;
    const blocked = occupancy(s);
    if (sn.spawn.some((c) => blocked[c])) return;
    sn.body = sn.spawn.slice();
    sn.dir = sn.spawnDir;
    sn.queue = [];
    sn.grow = 0;
    sn.alive = true;
    sn.away = false;
    sn.diedAt = 0;
    s.rev += 1;
  },
};

export default snakes;
