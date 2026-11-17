import type { GameCtx, GameDef } from "../../shared/game";
import { shuffle, topScorers } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { TEAMS, splitTeams } from "../../shared/teams";
import { config } from "./config";
import {
  BOMB_RADIUS,
  COUNTDOWN_MS,
  DASH_MS,
  DIRS,
  DX,
  DY,
  FREEZE_MS,
  MAX_HOLD,
  MAX_PAINTERS,
  QUEUE_MAX,
  PLAY_MS,
  TICK_MS,
  boardSize,
  type Dir,
  type PowerKind,
} from "./shared";

// Turf War: real-time territory painting (Ruckus original).
// Every tick each painter moves one tile in its direction (two while dashing),
// paints the tile it enters and, when it steps back onto its own turf after
// painting new ground, fills every tile it has walled off from the board edge.
//
// Latency: a turn can name the tick it should land on (`at`, numbered like `tick`).
// The owner's client runs its own painter about one network trip ahead and stamps each
// turn for the next tile boundary on its screen; the server holds an early turn until that
// tick (a late one lands on the next tick). Each player's view carries their own input
// status (`me`), from which the client learns how far ahead to run.
//
// Bandwidth: a play tick goes out as a small delta event (every painter's position and
// counters, plus only the tiles that changed hands; see TurfDelta) and tick() returns false.
// The full view (the whole board, renderable from scratch) goes out on phase changes, joins,
// refreshes and every KEYFRAME_MS. A client that misses a tick asks for a keyframe ("sync").

const SPAWN_FIRST_MS = 2_500;
const SPAWN_MIN_MS = 5_000;
const SPAWN_MAX_MS = 7_000;
const MAX_POWERS = 3;
/** Power-ups spawn at least this far (manhattan) from every painter, so never right next to one. */
const POWER_CLEARANCE = 3;
/** With fewer than two painters online for this long, the game ends. */
export const ABANDON_MS = 8_000;
/** During play a full view (the whole board) still goes out this often: a safety net for deltas. */
export const KEYFRAME_MS = 3_000;
/** A viewer gets at most one requested keyframe this often. */
const SYNC_MS = 1_000;
/** A tick that repaints more than this share of the board sends the whole board instead. */
const WHOLE_BOARD_SHARE = 0.25;

export type Phase = "countdown" | "play" | "over";
export type EndReason = "time" | "abandoned";

/** A queued turn: applied on the first step of tick `at` or later (one per step, in order). */
interface QueuedTurn {
  /** Index into DIRS. */
  d: number;
  at: number;
  /** The client's input number (0 = none given). */
  seq: number;
}

interface Painter {
  id: string;
  x: number;
  y: number;
  /** Index into DIRS. */
  dir: number;
  /** Pending turns, applied one per step. Private: never sent to other players. */
  queue: QueuedTurn[];
  /** Input bookkeeping for the owner's prediction: last applied input number, last received, and how early (ms). */
  applied: number;
  rx: number;
  slack: number;
  /** Tiles painted since this painter last stood on its own turf. */
  out: number;
  dashUntil: number;
  frozenUntil: number;
  /** Tiles owned. */
  count: number;
}

export interface PowerUp {
  x: number;
  y: number;
  kind: PowerKind;
}

export interface TurfState {
  /** Length of play in ms (host setting). */
  playMs: number;
  w: number;
  h: number;
  phase: Phase;
  /** End of the current phase (server time). Once over: when it ended. */
  endsAt: number;
  /** Owner per tile (painter index) or -1, row-major. */
  tiles: number[];
  /** Cached encoding of `tiles` for views; rebuilt lazily when `encDirty`. */
  enc: string;
  encDirty: boolean;
  painters: Painter[];
  powers: PowerUp[];
  nextSpawnAt: number;
  /** Play ticks so far (rotates who moves first, for fairness). */
  tick: number;
  /** Server time of the latest play tick (or of the start of play). */
  stepAt: number;
  /** Bumped whenever clients have something new to see. */
  seq: number;
  /** A countdown turn is waiting for the next tick to broadcast it. */
  dirty: boolean;
  /** When the game dropped below two connected painters. */
  aloneSince: number | null;
  /** When the last full view went out during play (deltas fill the gaps). */
  fullAt: number;
  winners: string[] | null;
  endReason: EndReason | null;
  /** Red vs Blue (host setting "mode"): the two teams' ids. Null in a free-for-all. */
  teams: [string[], string[]] | null;
  /** Team (0 = Red, 1 = Blue) of each painter index, or null in a free-for-all. */
  side: number[] | null;
}

/**
 * `seq` numbers the client's inputs and `at` names the tick the turn should land on
 * (both optional; without `at` the turn happens on the next step).
 */
export type TurfAction = { type: "turn"; dir: Dir; seq?: number; at?: number } | { type: "sync" };

/**
 * One play tick, sent to everyone as an event instead of a full view.
 * Apply it to the view of tick `n - 1` (see delta.ts).
 */
export interface TurfDelta {
  k: "d";
  n: number;
  /** Server time of the tick (TurfView.at) and the view's change counter. */
  at: number;
  seq: number;
  /** Every painter, in order: [x, y, dir, tiles owned, open-loop length, ...]. */
  p: number[];
  /** Tiles that changed hands: 3 characters each (index in base 64, then the owner as in `tiles`). */
  c?: string;
  /** The whole board instead (after a big fill). */
  b?: string;
  /** Dash / freeze timers that changed: [painter, dashUntil, frozenUntil, ...]. */
  dz?: number[];
  /** Power-ups on the board, when they changed. */
  pw?: PowerUp[];
  /** Turns applied this tick: [painter, input number, ...]. */
  ap?: number[];
}

/** A player's turn reached the server: [input number, ms it arrived before its tick]. Only to them. */
export interface TurfInputEcho {
  k: "m";
  rx: number;
  sl: number;
  /** Countdown aims apply at once: this input number is also the last applied. */
  ap?: number;
}

/** A full view on request (after a missed tick). Only to the one who asked. */
export interface TurfKeyframe {
  k: "K";
  v: TurfView;
}

export type TurfWire = TurfDelta | TurfInputEcho | TurfKeyframe;

/** URL- and JSON-safe base 64 digits for tile indices. */
export const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Compact painter, to keep each tick's view small. */
export type PainterTuple = [
  id: string,
  x: number,
  y: number,
  dir: number,
  tiles: number,
  /** Length of the painter's open loop (0 = standing on / just left its turf). */
  out: number,
  dashUntil: number,
  frozenUntil: number,
];

export interface TurfView {
  phase: Phase;
  /** Full length of play (ms), for the timer bar. */
  playMs: number;
  w: number;
  h: number;
  endsAt: number;
  /** w*h chars, row-major: "." empty, "0"-"7" = index into `players`. */
  tiles: string;
  players: PainterTuple[];
  powers: PowerUp[];
  /** The viewer's painter index, -1 for spectators. */
  you: number;
  seq: number;
  /** Movement steps so far (clients interpolate between consecutive ones). */
  tick: number;
  /** Server time of tick `tick` (play only): lets the owner's client run its painter ahead. */
  at?: number;
  /** The game ends early at this time unless another painter reconnects (omitted when not). */
  abandonAt?: number | null;
  /** Set once the game is over. */
  winners?: string[] | null;
  endReason?: EndReason | null;
  /** Red vs Blue: the two teams' ids (omitted in a free-for-all). Teammates share their turf. */
  teams?: [string[], string[]];
  /**
   * The viewer's own input status (painters only, until the end):
   * [last applied input, last received input, ms it arrived before its tick].
   */
  me?: [number, number, number];
}

/** `tick` is the movement step that caused it, so clients can show it when that step is on screen. */
export type TurfEvent =
  | { type: "capture"; by: number; n: number; x: number; y: number; tick: number }
  | { type: "power"; by: number; kind: PowerKind; x: number; y: number; n: number; tick: number };

// ---------- board helpers (exported for tests) ----------

/** Set a tile's owner, keeping tile counts and the view cache in sync. */
export function paint(s: TurfState, i: number, owner: number): boolean {
  const prev = s.tiles[i];
  if (prev === owner) return false;
  if (prev >= 0) s.painters[prev].count -= 1;
  s.tiles[i] = owner;
  if (owner >= 0) s.painters[owner].count += 1;
  s.encDirty = true;
  changedTiles(s).add(i);
  return true;
}

/**
 * Does tile owner `o` count as painter `me`'s own turf? In a free-for-all only their own tiles do;
 * in Red vs Blue every teammate's tile does too (teammates share one territory).
 */
export function friendly(s: TurfState, o: number, me: number): boolean {
  if (o === me) return true;
  return !!s.side && o >= 0 && s.side[o] === s.side[me];
}

/** Tiles owned by painter `me` plus (in Red vs Blue) all their teammates. */
function turfCount(s: TurfState, me: number): number {
  if (!s.side) return s.painters[me].count;
  let n = 0;
  s.painters.forEach((p, i) => {
    if (s.side![i] === s.side![me]) n += p.count;
  });
  return n;
}

/** Tiles repainted since the last delta (bookkeeping for the wire, so kept out of TurfState). */
const changes = new WeakMap<TurfState, Set<number>>();
function changedTiles(s: TurfState): Set<number> {
  let set = changes.get(s);
  if (!set) changes.set(s, (set = new Set()));
  return set;
}
/** When each viewer last got a keyframe they asked for. */
const syncs = new WeakMap<TurfState, Map<string, number>>();

const tileChar = (o: number) => (o < 0 ? "." : String.fromCharCode(48 + o));

/** What a delta has to compare against, taken before a tick. */
interface Before {
  phase: Phase;
  tick: number;
  alone: number | null;
  powers: string;
  timers: number[];
  applied: number[];
}

const powersKey = (s: TurfState) => s.powers.map((q) => `${q.x},${q.y},${q.kind}`).join(";");

function beforeTick(s: TurfState): Before {
  return {
    phase: s.phase,
    tick: s.tick,
    alone: s.aloneSince,
    powers: powersKey(s),
    timers: s.painters.flatMap((p) => [p.dashUntil, p.frozenUntil]),
    applied: s.painters.map((p) => p.applied),
  };
}

/** The delta for a plain play tick (null when the tick needs a full view). */
export function makeDelta(s: TurfState, b: Before): TurfDelta | null {
  if (s.phase !== "play" || b.phase !== "play" || s.tick !== b.tick + 1 || s.aloneSince !== b.alone) return null;
  const d: TurfDelta = {
    k: "d",
    n: s.tick,
    at: s.stepAt,
    seq: s.seq,
    p: s.painters.flatMap((p) => [p.x, p.y, p.dir, p.count, p.out]),
  };
  const set = changedTiles(s);
  if (set.size > s.tiles.length * WHOLE_BOARD_SHARE) d.b = encodeTiles(s);
  else if (set.size) {
    let c = "";
    for (const i of set) c += B64[i >> 6] + B64[i & 63] + tileChar(s.tiles[i]);
    d.c = c;
  }
  const dz: number[] = [];
  const ap: number[] = [];
  s.painters.forEach((p, i) => {
    if (p.dashUntil !== b.timers[2 * i] || p.frozenUntil !== b.timers[2 * i + 1]) dz.push(i, p.dashUntil, p.frozenUntil);
    if (p.applied !== b.applied[i]) ap.push(i, p.applied);
  });
  if (dz.length) d.dz = dz;
  if (ap.length) d.ap = ap;
  if (powersKey(s) !== b.powers) d.pw = s.powers.map((q) => ({ x: q.x, y: q.y, kind: q.kind }));
  return d;
}

/** A client missed a tick: send it the full view as an event (at most once a second each). */
function sendKeyframe(s: TurfState, viewerId: string, ctx: GameCtx): false {
  let seen = syncs.get(s);
  if (!seen) syncs.set(s, (seen = new Map()));
  const now = ctx.now();
  if (now - (seen.get(viewerId) ?? -Infinity) < SYNC_MS) return false;
  seen.set(viewerId, now);
  ctx.emit({ k: "K", v: turf.view(s, viewerId, ctx) as TurfView } satisfies TurfWire, { to: viewerId });
  return false;
}

/**
 * Give `me` every tile that is not theirs and cannot reach the board edge
 * without crossing their tiles. Flood-fills from the border over non-owned tiles;
 * whatever the flood can't reach is enclosed. Returns the capture (or null).
 */
export function fillEnclosed(s: TurfState, me: number): { n: number; x: number; y: number } | null {
  const { w, h, tiles } = s;
  const size = w * h;
  const open = new Uint8Array(size);
  const stack: number[] = [];
  let reachable = 0;
  const visit = (i: number) => {
    if (open[i] === 0 && !friendly(s, tiles[i], me)) {
      open[i] = 1;
      reachable += 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    visit(x);
    visit(size - w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    visit(y * w);
    visit(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < size - w) visit(i + w);
  }
  // Everything not mine was reachable: nothing enclosed.
  if (reachable === size - turfCount(s, me)) return null;

  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < size; i++) {
    if (open[i] === 0 && !friendly(s, tiles[i], me)) {
      paint(s, i, me);
      n += 1;
      sx += i % w;
      sy += Math.floor(i / w);
    }
  }
  return n ? { n, x: sx / n, y: sy / n } : null;
}

export function encodeTiles(s: TurfState): string {
  if (s.encDirty) {
    const chars: string[] = new Array(s.tiles.length);
    for (let i = 0; i < s.tiles.length; i++) chars[i] = s.tiles[i] < 0 ? "." : String.fromCharCode(48 + s.tiles[i]);
    s.enc = chars.join("");
    s.encDirty = false;
  }
  return s.enc;
}

/** Spread-out home spots on a ring around the centre, each facing inwards. */
export function homeSpots(n: number, w: number, h: number): { x: number; y: number; dir: number }[] {
  const count = Math.max(1, n);
  const r = n === 2 ? 0.25 : 0.3;
  const start = n === 2 ? Math.PI : -Math.PI / 2 + Math.PI / count;
  const round3 = (v: number) => Math.round(v * 1000) / 1000; // kills float noise so mirrored spots stay mirrored
  return Array.from({ length: n }, (_, i) => {
    const a = start + (2 * Math.PI * i) / count;
    const fx = round3(0.5 + r * Math.cos(a));
    const fy = round3(0.5 + r * Math.sin(a));
    const x = clamp(Math.round(fx * (w - 1)), 1, w - 2);
    const y = clamp(Math.round(fy * (h - 1)), 1, h - 2);
    const dx = (w - 1) / 2 - x;
    const dy = (h - 1) / 2 - y;
    const dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 1 : 3) : dy >= 0 ? 2 : 0;
    return { x, y, dir };
  });
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** A non-negative integer small enough to be a tick or input number. */
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2 ** 31;

/** Apply the painter's next turn if it is due on tick `tick`. True when the heading changed. */
function popTurn(p: Painter, tick: number): boolean {
  const q = p.queue[0];
  if (!q || q.at > tick) return false;
  p.queue.shift();
  p.dir = q.d;
  if (q.seq) p.applied = q.seq;
  return true;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** (A function, so TypeScript doesn't keep a stale narrowing of `phase` across calls that end the game.) */
function isOver(s: TurfState) {
  return s.phase === "over";
}

function online(s: TurfState, ctx: GameCtx): Painter[] {
  return s.painters.filter((p) => ctx.player(p.id)?.connected !== false);
}

function nameOf(ctx: GameCtx, id: string) {
  return ctx.player(id)?.name ?? "Someone";
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

// ---------- game flow ----------

function capture(s: TurfState, idx: number, ctx: GameCtx) {
  const got = fillEnclosed(s, idx);
  if (got) {
    ctx.emit({ type: "capture", by: idx, n: got.n, x: round1(got.x), y: round1(got.y), tick: s.tick } satisfies TurfEvent);
  }
}

/** `stepPainted` = the step onto the power-up already painted that tile (counts towards a bomb). */
function collect(s: TurfState, idx: number, pw: PowerUp, ctx: GameCtx, now: number, stepPainted: boolean) {
  const p = s.painters[idx];
  let n = stepPainted ? 1 : 0;
  if (pw.kind === "dash") {
    p.dashUntil = Math.max(p.dashUntil, now) + DASH_MS;
  } else if (pw.kind === "freeze") {
    s.painters.forEach((q, j) => {
      if (j !== idx && !friendly(s, j, idx)) q.frozenUntil = Math.max(q.frozenUntil, now + FREEZE_MS);
    });
  } else {
    for (let dy = -BOMB_RADIUS; dy <= BOMB_RADIUS; dy++) {
      for (let dx = -BOMB_RADIUS; dx <= BOMB_RADIUS; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > BOMB_RADIUS) continue;
        const x = p.x + dx;
        const y = p.y + dy;
        if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
        const i = y * s.w + x;
        // Teammates' turf is already ours: leave it as it is.
        if (!friendly(s, s.tiles[i], idx) && paint(s, i, idx)) n += 1;
      }
    }
    // The blast may have closed a loop; either way the painter now stands on its turf.
    p.out = 0;
    capture(s, idx, ctx);
  }
  ctx.emit({ type: "power", by: idx, kind: pw.kind, x: pw.x, y: pw.y, n, tick: s.tick } satisfies TurfEvent);
}

/** Move one tile in the painter's direction. False when a wall is in the way. */
function step(s: TurfState, idx: number, ctx: GameCtx, now: number): boolean {
  const p = s.painters[idx];
  const nx = p.x + DX[p.dir];
  const ny = p.y + DY[p.dir];
  if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) return false;
  p.x = nx;
  p.y = ny;
  const i = ny * s.w + nx;
  const fresh = !friendly(s, s.tiles[i], idx);
  if (!fresh) {
    if (p.out > 0) {
      p.out = 0;
      capture(s, idx, ctx);
    }
  } else {
    paint(s, i, idx);
    p.out += 1;
  }
  const k = s.powers.findIndex((q) => q.x === nx && q.y === ny);
  if (k !== -1) collect(s, idx, s.powers.splice(k, 1)[0], ctx, now, fresh);
  return true;
}

function movePainters(s: TurfState, ctx: GameCtx, now: number): boolean {
  let changed = false;
  const n = s.painters.length;
  const first = n ? s.tick % n : 0; // rotate who moves first so tile races are fair
  for (let k = 0; k < n; k++) {
    const idx = (first + k) % n;
    const p = s.painters[idx];
    if (ctx.player(p.id)?.connected === false) continue; // away painters wait in place
    if (now < p.frozenUntil) {
      // Frozen painters can still aim.
      if (popTurn(p, s.tick)) changed = true;
      continue;
    }
    const steps = now < p.dashUntil ? 2 : 1;
    for (let st = 0; st < steps; st++) {
      if (popTurn(p, s.tick)) changed = true;
      if (step(s, idx, ctx, now)) changed = true;
    }
  }
  return changed;
}

function spawnPower(s: TurfState, ctx: GameCtx): boolean {
  if (s.powers.length >= MAX_POWERS) return false;
  for (let tries = 0; tries < 40; tries++) {
    const x = Math.min(s.w - 1, Math.floor(ctx.random() * s.w));
    const y = Math.min(s.h - 1, Math.floor(ctx.random() * s.h));
    if (s.powers.some((q) => q.x === x && q.y === y)) continue;
    if (s.painters.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < POWER_CLEARANCE)) continue;
    const r = ctx.random();
    const kind: PowerKind = r < 0.4 ? "dash" : r < 0.75 ? "bomb" : "freeze";
    s.powers.push({ x, y, kind });
    return true;
  }
  return false;
}

/** Track the "fewer than two painters online" timer. True when the view changed. */
function checkAbandon(s: TurfState, ctx: GameCtx, now: number): boolean {
  if (online(s, ctx).length >= 2) {
    if (s.aloneSince === null) return false;
    s.aloneSince = null;
    return true;
  }
  if (s.aloneSince === null) {
    s.aloneSince = now;
    return true;
  }
  if (now - s.aloneSince >= ABANDON_MS) {
    finish(s, ctx, "abandoned");
    return true;
  }
  return false;
}

function finish(s: TurfState, ctx: GameCtx, reason: EndReason) {
  if (s.phase === "over") return;
  s.phase = "over";
  s.endsAt = ctx.now();
  s.powers = [];
  s.aloneSince = null;
  for (const p of s.painters) {
    p.queue = [];
    p.out = 0;
    p.dashUntil = 0;
    p.frozenUntil = 0;
  }

  const total = s.w * s.h;
  const pct = (n: number) => Math.round((100 * n) / total);
  const scores: Record<string, number> = {};
  for (const p of s.painters) scores[p.id] = p.count;

  let winners: string[];
  let headline: string;
  const stayed = online(s, ctx);
  if (s.teams && s.side) {
    // Red vs Blue: the team with more ground wins, and every member shares the win.
    const totals = [0, 0];
    s.painters.forEach((p, i) => (totals[s.side![i]] += p.count));
    const left = reason === "abandoned" ? ", the other team left" : "";
    if (totals[0] === totals[1]) {
      winners = totals[0] > 0 ? s.painters.map((p) => p.id) : [];
      headline = totals[0] > 0 ? `Red and Blue tie! ${totals[0]} tiles each` : "Turf War ends with a blank map";
    } else {
      const t = totals[0] > totals[1] ? 0 : 1;
      winners = s.teams[t].slice();
      headline = `${TEAMS[t].name} team wins with ${totals[t]} tiles to ${totals[1 - t]}${left}`;
    }
  } else if (reason === "abandoned" && stayed.length === 1) {
    winners = [stayed[0].id];
    headline = `${nameOf(ctx, stayed[0].id)} wins Turf War, everyone else left`;
  } else {
    winners = topScorers(scores);
    const share = winners.length ? pct(scores[winners[0]]) : 0;
    const names = joinNames(winners.map((id) => nameOf(ctx, id)));
    if (winners.length === 0) headline = "Turf War ends with a blank map";
    else if (winners.length === 1) headline = `${names} wins Turf War with ${share}% of the map`;
    else headline = `${names} tie for the turf with ${share}% of the map each`;
  }
  s.winners = winners;
  s.endReason = reason;
  ctx.end({ winners, headline, scores });
}

/** One tick of game flow. True when something players can see changed. */
function advanceTick(s: TurfState, ctx: GameCtx): boolean {
  if (isOver(s)) return false;
  const now = ctx.now();
  let changed = checkAbandon(s, ctx, now);
  if (!isOver(s)) {
    if (s.phase === "countdown") {
      if (now >= s.endsAt) {
        s.phase = "play";
        s.endsAt = now + s.playMs;
        s.stepAt = now;
        s.nextSpawnAt = now + SPAWN_FIRST_MS;
        changed = true;
      } else if (s.dirty) {
        changed = true;
      }
    } else if (now >= s.endsAt) {
      finish(s, ctx, "time");
      changed = true;
    } else {
      s.tick += 1;
      s.stepAt = now;
      if (movePainters(s, ctx, now)) changed = true;
      if (now >= s.nextSpawnAt) {
        if (spawnPower(s, ctx)) changed = true;
        s.nextSpawnAt = now + SPAWN_MIN_MS + Math.floor(ctx.random() * (SPAWN_MAX_MS - SPAWN_MIN_MS));
      }
    }
  }
  s.dirty = false;
  if (changed) s.seq += 1;
  return changed;
}

// ---------- practice bot ----------

/** One straight run of a bot's plan. */
interface Leg {
  d: number;
  n: number;
}

interface BotMind {
  legs: Leg[];
  /** Where the current leg began. */
  sx: number;
  sy: number;
  /** Last position and when it last changed (to notice being stuck). */
  lx: number;
  ly: number;
  movedAt: number;
  /** Don't steer again before this (human-ish reaction). */
  nextAt: number;
}

const botMinds = new WeakMap<TurfState, Map<string, BotMind>>();

const inBounds = (s: TurfState, x: number, y: number) => x >= 0 && y >= 0 && x < s.w && y < s.h;

/** A rectangle loop out of its own turf: out, across, back, and home again. */
function loopPlan(s: TurfState, p: Painter, ctx: GameCtx): Leg[] | null {
  const span = Math.max(4, Math.round(Math.min(s.w, s.h) / 4));
  for (let tries = 0; tries < 8; tries++) {
    const d1 = Math.floor(ctx.random() * 4);
    const d2 = (d1 + (ctx.random() < 0.5 ? 1 : 3)) % 4;
    const a = 3 + Math.floor(ctx.random() * span);
    const b = 3 + Math.floor(ctx.random() * span);
    const fx = p.x + DX[d1] * a;
    const fy = p.y + DY[d1] * a;
    if (!inBounds(s, fx, fy) || !inBounds(s, fx + DX[d2] * b, fy + DY[d2] * b)) continue;
    return [
      { d: d1, n: a },
      { d: d2, n: b },
      { d: (d1 + 2) % 4, n: a },
      { d: (d2 + 2) % 4, n: b },
    ];
  }
  return null;
}

/** Straight back to the nearest tile of its own (to close an open loop). */
function homePlan(s: TurfState, me: number, p: Painter): Leg[] | null {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < s.tiles.length; i++) {
    if (!friendly(s, s.tiles[i], me)) continue;
    const d = Math.abs((i % s.w) - p.x) + Math.abs(Math.floor(i / s.w) - p.y);
    if (d > 0 && d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return null;
  const dx = (best % s.w) - p.x;
  const dy = Math.floor(best / s.w) - p.y;
  const legs: Leg[] = [];
  if (dx) legs.push({ d: dx > 0 ? 1 : 3, n: Math.abs(dx) });
  if (dy) legs.push({ d: dy > 0 ? 2 : 0, n: Math.abs(dy) });
  return legs;
}

/**
 * A medium painter: draws rectangular loops out of its own turf (longer on bigger maps),
 * heads home when a plan breaks, and turns away from walls. Uses only public board info.
 */
function botSteer(s: TurfState, botId: string, ctx: GameCtx): TurfAction | null {
  if (s.phase !== "play") return null;
  const me = s.painters.findIndex((q) => q.id === botId);
  if (me < 0) return null;
  const p = s.painters[me];
  const now = ctx.now();
  let minds = botMinds.get(s);
  if (!minds) botMinds.set(s, (minds = new Map()));
  let m = minds.get(botId);
  if (!m) {
    m = { legs: [], sx: p.x, sy: p.y, lx: p.x, ly: p.y, movedAt: now, nextAt: now + 300 + ctx.random() * 500 };
    minds.set(botId, m);
  }
  if (p.x !== m.lx || p.y !== m.ly) {
    m.lx = p.x;
    m.ly = p.y;
    m.movedAt = now;
  }
  if (now < m.nextAt || now < p.frozenUntil) return null;

  const leg = m.legs[0];
  const blocked = !inBounds(s, p.x + DX[p.dir], p.y + DY[p.dir]);
  const stuck = now - m.movedAt > 1_000;
  const done = leg && (p.x - m.sx) * DX[leg.d] + (p.y - m.sy) * DY[leg.d] >= leg.n;
  if (leg && !done && !blocked && !stuck) {
    // Mid-leg: make sure we're heading the right way (a turn may not have landed yet).
    return p.dir === leg.d || p.queue.length ? null : { type: "turn", dir: DIRS[leg.d] };
  }
  if (done) m.legs.shift();
  if (!m.legs.length || blocked || stuck) {
    const onTurf = friendly(s, s.tiles[p.y * s.w + p.x], me);
    m.legs = (onTurf || p.out === 0 ? loopPlan(s, p, ctx) : homePlan(s, me, p)) ?? homePlan(s, me, p) ?? [];
    if (!m.legs.length) {
      // Nowhere sensible: any open direction.
      const open = [0, 1, 2, 3].filter((d) => inBounds(s, p.x + DX[d], p.y + DY[d]));
      m.legs = [{ d: open[Math.floor(ctx.random() * open.length)] ?? 0, n: 3 }];
    }
  }
  const next = m.legs[0];
  m.sx = p.x;
  m.sy = p.y;
  m.movedAt = now;
  // A little reaction delay before the next decision, like a person on the arrow keys.
  m.nextAt = now + 60 + ctx.random() * 120;
  return next.d === p.dir ? null : { type: "turn", dir: DIRS[next.d] };
}

// ---------- the game definition ----------

export const turf: GameDef<TurfState, TurfAction> = {
  id: "turf",
  tickMs: TICK_MS,

  setup(ctx) {
    const roster = ctx.players.slice(0, MAX_PAINTERS);
    const set = readSettings(config.settings, ctx.settings);
    const { w, h } = boardSize(roster.length, String(set.map));
    const ids = roster.map((p) => p.id);
    const teams = set.mode === "teams" && ids.length >= 2 ? splitTeams(ids, ctx.random) : null;
    const side = teams ? ids.map((id) => (teams[0].includes(id) ? 0 : 1)) : null;
    let spots = shuffle(homeSpots(roster.length, w, h), ctx.random);
    if (side) {
      // Teammates start side by side: Red on one arc of the ring, Blue on the other.
      const ring = homeSpots(roster.length, w, h);
      const turn = Math.floor(ctx.random() * ring.length);
      const order = ring.map((_, k) => ring[(k + turn) % ring.length]);
      const next = [0, teams![0].length];
      spots = side.map((t) => order[next[t]++]);
    }
    const s: TurfState = {
      playMs: Number(set.seconds) * 1000 || PLAY_MS,
      w,
      h,
      phase: "countdown",
      endsAt: ctx.now() + COUNTDOWN_MS,
      tiles: new Array<number>(w * h).fill(-1),
      enc: "",
      encDirty: true,
      painters: roster.map((p, i) => ({
        id: p.id,
        x: spots[i].x,
        y: spots[i].y,
        dir: spots[i].dir,
        queue: [],
        applied: 0,
        rx: 0,
        slack: 0,
        out: 0,
        dashUntil: 0,
        frozenUntil: 0,
        count: 0,
      })),
      powers: [],
      nextSpawnAt: 0,
      tick: 0,
      stepAt: 0,
      seq: 0,
      dirty: false,
      aloneSince: null,
      fullAt: 0,
      winners: null,
      endReason: null,
      teams,
      side,
    };
    // 3x3 home patch for everyone.
    s.painters.forEach((p, i) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) paint(s, (p.y + dy) * w + p.x + dx, i);
      }
    });
    return s;
  },

  action(s, playerId, action, ctx) {
    const a: unknown = action;
    if (typeof a !== "object" || a === null || Array.isArray(a)) return false;
    if ((a as { type?: unknown }).type === "sync") return sendKeyframe(s, playerId, ctx);
    if (s.phase === "over") return false;
    const idx = s.painters.findIndex((p) => p.id === playerId);
    if (idx === -1) return false;
    const { type, dir, seq, at } = a as { type?: unknown; dir?: unknown; seq?: unknown; at?: unknown };
    if (type !== "turn" || typeof dir !== "string" || dir.length > 5) return false;
    if (seq !== undefined && !isCount(seq)) return false;
    if (at !== undefined && !isCount(at)) return false;
    const d = (DIRS as readonly string[]).indexOf(dir);
    if (d === -1) return false;
    const p = s.painters[idx];
    const n = typeof seq === "number" ? seq : 0;

    if (s.phase === "countdown") {
      // Aim before the start (applied at once); the next tick broadcasts it.
      p.queue = [];
      if (n) {
        p.rx = n;
        p.applied = n;
        p.slack = 0;
        ctx.emit({ k: "m", rx: n, sl: 0, ap: n } satisfies TurfWire, { to: playerId });
      }
      if (p.dir !== d) {
        p.dir = d;
        s.dirty = true;
      }
      return false;
    }

    // Play: queue it for the tick it asks for (never far ahead), else the next steps.
    const when = typeof at === "number" ? Math.min(at, s.tick + 1 + MAX_HOLD) : 0;
    if (n) {
      p.rx = n;
      p.slack = when > 0 ? clamp(Math.round(s.stepAt + (when - s.tick) * TICK_MS - ctx.now()), -999, 999) : 0;
      ctx.emit({ k: "m", rx: p.rx, sl: p.slack } satisfies TurfWire, { to: playerId });
    }
    // Reversals allowed; this is not a snake.
    const last = p.queue.length ? p.queue[p.queue.length - 1].d : p.dir;
    if (d === last) return false;
    const turn: QueuedTurn = { d, at: when, seq: n };
    if (p.queue.length < QUEUE_MAX) p.queue.push(turn);
    else if (p.queue[0].d === d) p.queue.length = 1;
    else p.queue[QUEUE_MAX - 1] = turn;
    // Nothing visible changed yet: the next tick moves and broadcasts.
    return false;
  },

  tick(s, ctx) {
    const b = beforeTick(s);
    const changed = advanceTick(s, ctx);
    const now = ctx.now();
    // A plain play tick: everyone gets a small delta instead of the whole board.
    const d = now - s.fullAt < KEYFRAME_MS ? makeDelta(s, b) : null;
    changedTiles(s).clear();
    if (d) {
      ctx.emit(d satisfies TurfWire);
      return false;
    }
    if (s.phase === "play" && b.phase === "play") {
      s.fullAt = now;
      return true; // a keyframe
    }
    if (changed) s.fullAt = now;
    return changed;
  },

  bot(s, botId, ctx) {
    return botSteer(s, botId, ctx);
  },

  spectatorAction(s, viewerId, action, ctx) {
    const a: unknown = action;
    if (!a || typeof a !== "object" || (a as { type?: unknown }).type !== "sync") return false;
    return sendKeyframe(s, viewerId, ctx);
  },

  view(s, viewerId): TurfView {
    const you = s.painters.findIndex((p) => p.id === viewerId);
    const v: TurfView = {
      phase: s.phase,
      playMs: s.playMs,
      w: s.w,
      h: s.h,
      endsAt: s.endsAt,
      tiles: encodeTiles(s),
      players: s.painters.map((p): PainterTuple => [p.id, p.x, p.y, p.dir, p.count, p.out, p.dashUntil, p.frozenUntil]),
      powers: s.powers.map((q) => ({ x: q.x, y: q.y, kind: q.kind })),
      you,
      seq: s.seq,
      tick: s.tick,
    };
    // Optional fields only when they say something (this view goes out ~8 times a second).
    if (s.phase === "play") v.at = s.stepAt;
    if (s.aloneSince !== null) v.abandonAt = s.aloneSince + ABANDON_MS;
    if (s.winners) v.winners = s.winners;
    if (s.endReason) v.endReason = s.endReason;
    if (s.teams) v.teams = s.teams;
    if (you >= 0 && s.phase !== "over") {
      const p = s.painters[you];
      v.me = [p.applied, p.rx, p.slack];
    }
    return v;
  },

  playerLeft(s, playerId, ctx) {
    const p = s.painters.find((q) => q.id === playerId);
    if (!p || s.phase === "over") return;
    p.queue = [];
    checkAbandon(s, ctx, ctx.now());
    s.seq += 1;
  },

  playerReturned(s, playerId, ctx) {
    const p = s.painters.find((q) => q.id === playerId);
    if (!p || s.phase === "over") return;
    checkAbandon(s, ctx, ctx.now());
    s.seq += 1;
  },
};

export default turf;
