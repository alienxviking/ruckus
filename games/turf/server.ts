import type { GameCtx, GameDef } from "../../shared/game";
import { shuffle, topScorers } from "../../shared/game";
import {
  BOMB_RADIUS,
  COUNTDOWN_MS,
  DASH_MS,
  DIRS,
  DX,
  DY,
  FREEZE_MS,
  MAX_PAINTERS,
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

const SPAWN_FIRST_MS = 2_500;
const SPAWN_MIN_MS = 5_000;
const SPAWN_MAX_MS = 7_000;
const MAX_POWERS = 3;
/** Power-ups spawn at least this far (manhattan) from every painter, so never right next to one. */
const POWER_CLEARANCE = 3;
/** With fewer than two painters online for this long, the game ends. */
export const ABANDON_MS = 8_000;
const QUEUE_MAX = 2;

export type Phase = "countdown" | "play" | "over";
export type EndReason = "time" | "abandoned";

interface Painter {
  id: string;
  x: number;
  y: number;
  /** Index into DIRS. */
  dir: number;
  /** Pending turns, applied one per step. Private: never sent to clients. */
  queue: number[];
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
  /** Bumped whenever clients have something new to see. */
  seq: number;
  /** A countdown turn is waiting for the next tick to broadcast it. */
  dirty: boolean;
  /** When the game dropped below two connected painters. */
  aloneSince: number | null;
  winners: string[] | null;
  endReason: EndReason | null;
}

export type TurfAction = { type: "turn"; dir: Dir };

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
  /** The game ends early at this time unless another painter reconnects. */
  abandonAt: number | null;
  winners: string[] | null;
  endReason: EndReason | null;
}

export type TurfEvent =
  | { type: "capture"; by: number; n: number; x: number; y: number }
  | { type: "power"; by: number; kind: PowerKind; x: number; y: number; n: number };

// ---------- board helpers (exported for tests) ----------

/** Set a tile's owner, keeping tile counts and the view cache in sync. */
export function paint(s: TurfState, i: number, owner: number): boolean {
  const prev = s.tiles[i];
  if (prev === owner) return false;
  if (prev >= 0) s.painters[prev].count -= 1;
  s.tiles[i] = owner;
  if (owner >= 0) s.painters[owner].count += 1;
  s.encDirty = true;
  return true;
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
    if (open[i] === 0 && tiles[i] !== me) {
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
  if (reachable === size - s.painters[me].count) return null;

  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < size; i++) {
    if (open[i] === 0 && tiles[i] !== me) {
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
    ctx.emit({ type: "capture", by: idx, n: got.n, x: round1(got.x), y: round1(got.y) } satisfies TurfEvent);
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
      if (j !== idx) q.frozenUntil = Math.max(q.frozenUntil, now + FREEZE_MS);
    });
  } else {
    for (let dy = -BOMB_RADIUS; dy <= BOMB_RADIUS; dy++) {
      for (let dx = -BOMB_RADIUS; dx <= BOMB_RADIUS; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > BOMB_RADIUS) continue;
        const x = p.x + dx;
        const y = p.y + dy;
        if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
        if (paint(s, y * s.w + x, idx)) n += 1;
      }
    }
    // The blast may have closed a loop; either way the painter now stands on its turf.
    p.out = 0;
    capture(s, idx, ctx);
  }
  ctx.emit({ type: "power", by: idx, kind: pw.kind, x: pw.x, y: pw.y, n } satisfies TurfEvent);
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
  const fresh = s.tiles[i] !== idx;
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
      if (p.queue.length) {
        p.dir = p.queue.shift()!;
        changed = true;
      }
      continue;
    }
    const steps = now < p.dashUntil ? 2 : 1;
    for (let st = 0; st < steps; st++) {
      if (p.queue.length) {
        p.dir = p.queue.shift()!;
        changed = true;
      }
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
  if (reason === "abandoned" && stayed.length === 1) {
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

// ---------- the game definition ----------

export const turf: GameDef<TurfState, TurfAction> = {
  id: "turf",
  tickMs: TICK_MS,

  setup(ctx) {
    const roster = ctx.players.slice(0, MAX_PAINTERS);
    const { w, h } = boardSize(roster.length);
    const spots = shuffle(homeSpots(roster.length, w, h), ctx.random);
    const s: TurfState = {
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
        out: 0,
        dashUntil: 0,
        frozenUntil: 0,
        count: 0,
      })),
      powers: [],
      nextSpawnAt: 0,
      tick: 0,
      seq: 0,
      dirty: false,
      aloneSince: null,
      winners: null,
      endReason: null,
    };
    // 3x3 home patch for everyone.
    s.painters.forEach((p, i) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) paint(s, (p.y + dy) * w + p.x + dx, i);
      }
    });
    return s;
  },

  action(s, playerId, action) {
    if (s.phase === "over") return false;
    const idx = s.painters.findIndex((p) => p.id === playerId);
    if (idx === -1) return false;
    const a: unknown = action;
    if (typeof a !== "object" || a === null || Array.isArray(a)) return false;
    const { type, dir } = a as { type?: unknown; dir?: unknown };
    if (type !== "turn" || typeof dir !== "string" || dir.length > 5) return false;
    const d = (DIRS as readonly string[]).indexOf(dir);
    if (d === -1) return false;
    const p = s.painters[idx];

    if (s.phase === "countdown") {
      // Aim before the start; the next tick broadcasts it.
      p.queue = [];
      if (p.dir !== d) {
        p.dir = d;
        s.dirty = true;
      }
      return false;
    }

    // Play: queue it for the next steps (reversals allowed; this is not a snake).
    const last = p.queue.length ? p.queue[p.queue.length - 1] : p.dir;
    if (d === last) return false;
    if (p.queue.length < QUEUE_MAX) p.queue.push(d);
    else if (p.queue[0] === d) p.queue.length = 1;
    else p.queue[QUEUE_MAX - 1] = d;
    // Nothing visible changed yet: the next tick moves and broadcasts.
    return false;
  },

  tick(s, ctx) {
    if (isOver(s)) return false;
    const now = ctx.now();
    let changed = checkAbandon(s, ctx, now);
    if (!isOver(s)) {
      if (s.phase === "countdown") {
        if (now >= s.endsAt) {
          s.phase = "play";
          s.endsAt = now + PLAY_MS;
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
  },

  view(s, viewerId): TurfView {
    return {
      phase: s.phase,
      w: s.w,
      h: s.h,
      endsAt: s.endsAt,
      tiles: encodeTiles(s),
      players: s.painters.map((p): PainterTuple => [p.id, p.x, p.y, p.dir, p.count, p.out, p.dashUntil, p.frozenUntil]),
      powers: s.powers.map((q) => ({ x: q.x, y: q.y, kind: q.kind })),
      you: s.painters.findIndex((p) => p.id === viewerId),
      seq: s.seq,
      abandonAt: s.aloneSince === null ? null : s.aloneSince + ABANDON_MS,
      winners: s.winners,
      endReason: s.endReason,
    };
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
