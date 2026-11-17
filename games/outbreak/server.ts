import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  ABANDON_MS,
  FLASH_R,
  FLASH_STUN_MS,
  FX_BITE,
  FX_CURE,
  FX_FLASH,
  FX_LUNGE,
  FX_PICK,
  F_CURE,
  F_FLASH,
  F_OFF,
  F_SHIELD,
  F_STUN,
  F_ZOMBIE,
  INTRO_MS,
  ITEM_CURE,
  ITEM_EVERY_MS,
  ITEM_FIRST_MS,
  ITEM_FLASH,
  ITEM_REACH,
  LUNGE_CD_MS,
  LUNGE_MS,
  MAPS,
  MAX_CURES,
  MAX_FLASHES,
  PTS_BITE,
  PTS_CURE,
  PTS_SURVIVE,
  PTS_WIPEOUT,
  ROUND_OVER_MS,
  R_S,
  R_Z,
  SHIELD_MS,
  SUB_MS,
  TICK_MS,
  TOUCH,
  TURN_MS,
  WORLD_H,
  WORLD_W,
  encodeFlags,
  encodePositions,
  freeSpot,
  inputDir,
  mapOf,
  stepPlayer,
  zombieCount,
  type MapDef,
  type Phase,
  type Snap,
} from "./shared";

// Outbreak: real-time zombie tag (Ruckus original).
//
// The server owns the world. It steps everyone with the shared movement model in
// 25ms substeps, driven by the clock, and every 50ms tick emits one compact snapshot
// event (positions + flags per seat, ~100 bytes). Full views only go out when the
// shared picture changes: phases, infections, cures, items spawning or being taken.
// Nothing is secret, so every viewer gets the same view.

// ---------- tuning ----------

/** A tick never simulates more than this many substeps (a stalled server skips ahead). */
const MAX_CATCHUP = 8;
/** Even when nothing moves, a snapshot goes out this often. */
const HEARTBEAT_MS = 1_000;
const MAX_FX = 16;
const FEED_KEEP = 8;
const STEP_S = SUB_MS / 1000;

// ---------- state ----------

interface Seat {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Steering direction (unit vector or 0). */
  ix: number;
  iy: number;
  zombie: boolean;
  /** Patient zero this round: immune to cures. */
  original: boolean;
  /** Sim times. */
  stunUntil: number;
  shieldUntil: number;
  lungeUntil: number;
  lungeReady: number;
  lx: number;
  ly: number;
  cure: boolean;
  flash: boolean;
}

export interface Item {
  id: number;
  kind: number;
  x: number;
  y: number;
}

/** k 0: a was bitten by b · k 1: b cured a · k 2: a flashed b zombies. */
export interface FeedRec {
  k: 0 | 1 | 2;
  a: number;
  b: number;
  at: number;
}

export type RoundHow = "time" | "all" | "quit";

export interface RoundRec {
  round: number;
  map: number;
  how: RoundHow;
  /** Points gained this round per seat. */
  pts: number[];
  bites: number[];
  cures: number[];
  /** Seats still human when the round ended. */
  survivors: number[];
  originals: number[];
  /** ms from the zombies waking to the end of the round. */
  ms: number;
}

export interface OBState {
  ids: string[];
  /** Host settings: rounds in the game and how long each round's hunt lasts. */
  rounds: number;
  playMs: number;
  phase: Phase;
  round: number;
  mapOrder: number[];
  map: number;
  endsAt: number;
  playAt: number;
  /** Sim clock: roundAt + steps * SUB_MS. */
  roundAt: number;
  steps: number;
  seats: Seat[];
  scores: number[];
  roundPts: number[];
  bites: number[];
  cures: number[];
  items: Item[];
  itemSeq: number;
  nextItemAt: number;
  feed: FeedRec[];
  history: RoundRec[];
  result: RoundRec | null;
  champions: string[] | null;
  aloneSince: number | null;
  lastOriginals: number[];
  /** Something public changed during the simulation (send the view). */
  dirty: boolean;
  snap: Snap;
  fx: number[][];
  sent: Snap | null;
  sentAt: number;
  quiet: boolean;
}

export type OBAction = { type: "in"; x: number; y: number } | { type: "use" };

export interface OBView {
  phase: Phase;
  round: number;
  rounds: number;
  /** Length of a round's hunt (ms). */
  playMs: number;
  map: number;
  endsAt: number;
  playAt: number;
  ids: string[];
  scores: number[];
  roundPts: number[];
  bites: number[];
  cures: number[];
  /** Seats that are zombies right now, and this round's patient zeros. */
  zombies: number[];
  originals: number[];
  /** [id, kind, x, y] */
  items: [number, number, number, number][];
  feed: FeedRec[];
  result: RoundRec | null;
  history: RoundRec[];
  champions: string[] | null;
  abandonAt: number | null;
  snap: Snap;
}

// ---------- helpers ----------

const simNow = (s: OBState) => s.roundAt + s.steps * SUB_MS;
const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const mapNow = (s: OBState): MapDef => mapOf(s.map);
const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

function pushFx(s: OBState, fx: number[]) {
  if (s.fx.length < MAX_FX) s.fx.push(fx);
}

function pushFeed(s: OBState, rec: FeedRec) {
  s.feed.push(rec);
  if (s.feed.length > FEED_KEEP) s.feed.splice(0, s.feed.length - FEED_KEEP);
}

function newSeat(id: string): Seat {
  return {
    id,
    x: WORLD_W / 2,
    y: WORLD_H / 2,
    vx: 0,
    vy: 0,
    ix: 0,
    iy: 0,
    zombie: false,
    original: false,
    stunUntil: 0,
    shieldUntil: 0,
    lungeUntil: 0,
    lungeReady: 0,
    lx: 1,
    ly: 0,
    cure: false,
    flash: false,
  };
}

/** A random free spot, as far as possible (up to `want`) from the given points. */
function spotAwayFrom(map: MapDef, r: number, from: [number, number][], want: number, rnd: () => number): [number, number] {
  let best: [number, number] | null = null;
  let bestGap = -1;
  for (let k = 0; k < 50; k++) {
    const x = 30 + rnd() * (WORLD_W - 60);
    const y = 30 + rnd() * (WORLD_H - 60);
    if (!freeSpot(map, x, y, r + 6)) continue;
    let gap = Infinity;
    for (const [px, py] of from) gap = Math.min(gap, Math.hypot(px - x, py - y));
    if (gap > bestGap) {
      best = [x, y];
      bestGap = gap;
    }
    if (gap >= want) break;
  }
  if (best) return best;
  // Pathological: scan for anything free.
  for (let y = 40; y < WORLD_H; y += 40) for (let x = 40; x < WORLD_W; x += 40) if (freeSpot(map, x, y, r + 2)) return [x, y];
  return [WORLD_W / 2, WORLD_H / 2];
}

function playerName(ctx: GameCtx, id: string) {
  return ctx.player(id)?.name ?? ctx.players.find((p) => p.id === id)?.name ?? "Someone";
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function scoreRecord(s: OBState): Record<string, number> {
  return Object.fromEntries(s.ids.map((id, i) => [id, s.scores[i]]));
}

function addPts(s: OBState, slot: number, pts: number) {
  s.scores[slot] += pts;
  s.roundPts[slot] += pts;
}

// ---------- rounds ----------

function startRound(s: OBState, ctx: GameCtx, round: number) {
  const now = ctx.now();
  s.round = round;
  s.map = s.mapOrder[(round - 1) % s.mapOrder.length];
  s.phase = "intro";
  s.endsAt = now + INTRO_MS;
  s.playAt = 0;
  s.roundAt = now;
  s.steps = 0;
  const map = mapNow(s);
  const n = s.seats.length;
  // Patient zeros: online players who weren't zombies at the start of last round come first.
  const order = shuffle(
    s.seats.map((_, i) => i),
    ctx.random,
  ).sort((a, b) => {
    const rank = (i: number) => (s.lastOriginals.includes(i) ? 2 : 0) + (connected(ctx, s.ids[i]) ? 0 : 1);
    return rank(a) - rank(b);
  });
  const originals = order.slice(0, zombieCount(n));
  s.lastOriginals = originals;
  const placed: [number, number][] = [];
  for (const seat of s.seats) Object.assign(seat, newSeat(seat.id));
  for (const i of originals) {
    const seat = s.seats[i];
    seat.zombie = true;
    seat.original = true;
    [seat.x, seat.y] = spotAwayFrom(map, R_Z, placed, 400, ctx.random);
    placed.push([seat.x, seat.y]);
  }
  const zs = placed.slice();
  s.seats.forEach((seat, i) => {
    if (originals.includes(i)) return;
    // Survivors start well away from the zombies and spread out from each other.
    let best: [number, number] = [WORLD_W / 2, WORLD_H / 2];
    let bestScore = -Infinity;
    for (let k = 0; k < 40; k++) {
      const x = 30 + ctx.random() * (WORLD_W - 60);
      const y = 30 + ctx.random() * (WORLD_H - 60);
      if (!freeSpot(map, x, y, R_S + 6)) continue;
      const dz = Math.min(...zs.map(([px, py]) => Math.hypot(px - x, py - y)));
      const dp = Math.min(Infinity, ...placed.map(([px, py]) => Math.hypot(px - x, py - y)));
      const score = Math.min(dz, 320) + Math.min(dp, 70) * 2;
      if (score > bestScore) [best, bestScore] = [[x, y], score];
    }
    [seat.x, seat.y] = best;
    placed.push(best);
  });
  s.roundPts = s.seats.map(() => 0);
  s.bites = s.seats.map(() => 0);
  s.cures = s.seats.map(() => 0);
  s.items = [];
  s.nextItemAt = now + INTRO_MS + ITEM_FIRST_MS;
  s.feed = [];
  s.result = null;
  s.fx = [];
  s.sent = null;
  s.quiet = false;
}

function finishGame(s: OBState, ctx: GameCtx, quit: boolean) {
  if (s.phase === "final") return;
  s.phase = "final";
  s.endsAt = 0;
  for (const seat of s.seats) {
    seat.ix = 0;
    seat.iy = 0;
  }
  const winners = topScorers(scoreRecord(s));
  s.champions = winners;
  const names = winners.map((id) => playerName(ctx, id));
  const best = winners.length ? s.scores[s.ids.indexOf(winners[0])] : 0;
  const pts = `${best} point${best === 1 ? "" : "s"}`;
  let headline: string;
  if (!names.length) headline = quit ? "Outbreak ends early: everyone fled" : "Nobody scored: the virus wins 🦠";
  else if (quit && names.length === 1) headline = `${names[0]} wins Outbreak with ${pts}: everyone else fled`;
  else if (names.length === 1) headline = `${names[0]} outlasts the Outbreak with ${pts} 🧟`;
  else headline = `${joinNames(names)} share the Outbreak crown with ${pts} each`;
  ctx.end({ winners, headline, scores: scoreRecord(s) });
}

function finishRound(s: OBState, ctx: GameCtx, how: RoundHow) {
  if (s.phase !== "intro" && s.phase !== "play") return;
  const survivors = s.seats.flatMap((x, i) => (x.zombie ? [] : [i]));
  const originals = s.seats.flatMap((x, i) => (x.original ? [i] : []));
  if (how === "time") for (const i of survivors) addPts(s, i, PTS_SURVIVE);
  if (how === "all") for (const i of originals) addPts(s, i, PTS_WIPEOUT);
  const rec: RoundRec = {
    round: s.round,
    map: s.map,
    how,
    pts: s.roundPts.slice(),
    bites: s.bites.slice(),
    cures: s.cures.slice(),
    survivors,
    originals,
    ms: s.playAt ? Math.max(0, Math.min(s.playMs, ctx.now() - s.playAt)) : 0,
  };
  s.history.push(rec);
  s.result = rec;
  for (const seat of s.seats) {
    seat.ix = 0;
    seat.iy = 0;
    seat.lungeUntil = 0;
  }
  s.dirty = true;
  if (how === "quit" || s.round >= s.rounds) return finishGame(s, ctx, how === "quit");
  s.phase = "roundOver";
  s.endsAt = ctx.now() + ROUND_OVER_MS;
}

// ---------- simulation ----------

function spawnItem(s: OBState, ctx: GameCtx) {
  const cures = s.items.filter((i) => i.kind === ITEM_CURE).length;
  const flashes = s.items.filter((i) => i.kind === ITEM_FLASH).length;
  const kinds = [...(cures < MAX_CURES ? [ITEM_CURE] : []), ...(flashes < MAX_FLASHES ? [ITEM_FLASH] : [])];
  if (!kinds.length) return;
  const kind = kinds[Math.floor(ctx.random() * kinds.length)];
  const from: [number, number][] = [...s.seats.map((x) => [x.x, x.y] as [number, number]), ...s.items.map((i) => [i.x, i.y] as [number, number])];
  const [x, y] = spotAwayFrom(mapNow(s), 14, from, 160, ctx.random);
  s.items.push({ id: ++s.itemSeq, kind, x: Math.round(x), y: Math.round(y) });
  s.dirty = true;
}

function infect(s: OBState, victim: number, biter: number, t: number) {
  const v = s.seats[victim];
  v.zombie = true;
  v.stunUntil = t + TURN_MS;
  v.cure = false;
  v.flash = false;
  v.lungeUntil = 0;
  v.lungeReady = t + TURN_MS;
  v.vx = 0;
  v.vy = 0;
  addPts(s, biter, PTS_BITE);
  s.bites[biter] += 1;
  pushFx(s, [FX_BITE, victim, biter, Math.round(v.x), Math.round(v.y)]);
  pushFeed(s, { k: 0, a: victim, b: biter, at: Math.round(t) });
  s.dirty = true;
}

function cure(s: OBState, patient: number, medic: number, t: number) {
  const z = s.seats[patient];
  const m = s.seats[medic];
  z.zombie = false;
  z.stunUntil = 0;
  z.lungeUntil = 0;
  z.shieldUntil = t + SHIELD_MS;
  m.cure = false;
  m.shieldUntil = Math.max(m.shieldUntil, t + 500);
  addPts(s, medic, PTS_CURE);
  s.cures[medic] += 1;
  pushFx(s, [FX_CURE, patient, medic, Math.round(z.x), Math.round(z.y)]);
  pushFeed(s, { k: 1, a: patient, b: medic, at: Math.round(t) });
  s.dirty = true;
}

function interact(s: OBState, t: number) {
  // Survivors pick up items they run over (one of each kind at a time).
  s.seats.forEach((seat, i) => {
    if (seat.zombie) return;
    for (let k = 0; k < s.items.length; k++) {
      const it = s.items[k];
      if (dist2(seat.x, seat.y, it.x, it.y) > (ITEM_REACH + R_S) ** 2) continue;
      if (it.kind === ITEM_CURE ? seat.cure : seat.flash) continue;
      if (it.kind === ITEM_CURE) seat.cure = true;
      else seat.flash = true;
      s.items.splice(k, 1);
      pushFx(s, [FX_PICK, i, it.kind]);
      s.dirty = true;
      break;
    }
  });
  // Touches: a cure carrier turns a (non-original) zombie back; otherwise the zombie bites.
  for (let zi = 0; zi < s.seats.length; zi++) {
    const z = s.seats[zi];
    if (!z.zombie || t < z.stunUntil) continue;
    for (let si = 0; si < s.seats.length; si++) {
      const v = s.seats[si];
      if (v.zombie || t < v.shieldUntil) continue;
      if (dist2(z.x, z.y, v.x, v.y) > TOUCH * TOUCH) continue;
      if (v.cure && !z.original) {
        cure(s, zi, si, t);
        break; // no longer a zombie
      }
      infect(s, si, zi, t);
    }
  }
}

function stepWorld(s: OBState, t: number) {
  const map = mapNow(s);
  const moving = s.phase === "intro" || s.phase === "play";
  for (const seat of s.seats) {
    const frozen = !moving || (seat.zombie && s.phase === "intro");
    const lunging = seat.zombie && t < seat.lungeUntil;
    stepPlayer(
      seat,
      frozen ? 0 : seat.ix,
      frozen ? 0 : seat.iy,
      seat.zombie,
      lunging && !frozen ? [seat.lx, seat.ly] : null,
      seat.zombie && t < seat.stunUntil,
      STEP_S,
      map,
    );
  }
  if (s.phase === "play") interact(s, t);
}

/** Catch the world up with the clock (a late tick catches up rather than slowing the game). True = everyone's infected. */
function simulate(s: OBState, now: number): boolean {
  const target = Math.floor((now - s.roundAt) / SUB_MS);
  let n = target - s.steps;
  if (n > MAX_CATCHUP) {
    s.steps = target - MAX_CATCHUP;
    n = MAX_CATCHUP;
  }
  for (let i = 0; i < n; i++) {
    s.steps += 1;
    stepWorld(s, simNow(s));
    if (s.phase === "play" && s.seats.every((x) => x.zombie)) return true;
  }
  return false;
}

function flagsOf(s: OBState, ctx: GameCtx): number[] {
  const t = simNow(s);
  return s.seats.map(
    (x) =>
      (x.zombie ? F_ZOMBIE : 0) |
      (x.zombie && t < x.stunUntil ? F_STUN : 0) |
      (x.cure ? F_CURE : 0) |
      (x.flash ? F_FLASH : 0) |
      (!x.zombie && t < x.shieldUntil ? F_SHIELD : 0) |
      (connected(ctx, x.id) ? 0 : F_OFF),
  );
}

function makeSnap(s: OBState, ctx: GameCtx): Snap {
  const xy: number[] = [];
  for (const x of s.seats) xy.push(x.x, x.y);
  const snap: Snap = { k: "s", n: s.round, t: Math.round(simNow(s)), p: encodePositions(xy), f: encodeFlags(flagsOf(s, ctx)) };
  if (s.fx.length) {
    snap.fx = s.fx;
    s.fx = [];
  }
  return snap;
}

/** Track "fewer than two players online"; ends the game once that lasts ABANDON_MS. */
function checkAlone(s: OBState, ctx: GameCtx): boolean {
  if (s.phase === "final") return false;
  const online = s.ids.filter((id) => connected(ctx, id)).length;
  const now = ctx.now();
  if (online >= 2) {
    if (s.aloneSince === null) return false;
    s.aloneSince = null;
    return true;
  }
  if (s.aloneSince === null) {
    s.aloneSince = now;
    return true;
  }
  if (now - s.aloneSince < ABANDON_MS) return false;
  if (s.phase === "intro" || s.phase === "play") finishRound(s, ctx, "quit");
  else finishGame(s, ctx, true);
  return true;
}

function advance(s: OBState, ctx: GameCtx): boolean {
  const now = ctx.now();
  let changed = checkAlone(s, ctx);
  if (s.phase === "final") return changed;
  if (simulate(s, now)) {
    finishRound(s, ctx, "all");
    return true;
  }
  if (s.dirty) {
    s.dirty = false;
    changed = true;
  }
  switch (s.phase) {
    case "intro":
      if (now < s.endsAt) return changed;
      s.phase = "play";
      s.playAt = now;
      s.endsAt = now + s.playMs;
      return true;
    case "play":
      if (now >= s.nextItemAt) {
        s.nextItemAt = now + ITEM_EVERY_MS;
        spawnItem(s, ctx);
        if (s.dirty) {
          s.dirty = false;
          changed = true;
        }
      }
      if (now < s.endsAt) return changed;
      finishRound(s, ctx, "time");
      return true;
    case "roundOver":
      if (now < s.endsAt) return changed;
      startRound(s, ctx, s.round + 1);
      return true;
  }
  return changed;
}

// ---------- actions ----------

function readInput(a: Record<string, unknown>): [number, number] | null {
  const { x, y } = a;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < -100 || x > 100 || y < -100 || y > 100) return null;
  return inputDir(x, y);
}

function applyUse(s: OBState, slot: number): boolean {
  if (s.phase !== "play") return false;
  const seat = s.seats[slot];
  const t = simNow(s);
  if (seat.zombie) {
    if (t < seat.stunUntil || t < seat.lungeReady) return false;
    let [dx, dy] = [seat.ix, seat.iy];
    if (dx === 0 && dy === 0) {
      const m = Math.hypot(seat.vx, seat.vy);
      [dx, dy] = m > 1 ? [seat.vx / m, seat.vy / m] : [seat.lx, seat.ly];
    }
    seat.lx = dx;
    seat.ly = dy;
    seat.lungeUntil = t + LUNGE_MS;
    seat.lungeReady = t + LUNGE_CD_MS;
    pushFx(s, [FX_LUNGE, slot, Math.round(dx * 100), Math.round(dy * 100)]);
    return false; // shows up in the next snapshot
  }
  if (!seat.flash) return false;
  seat.flash = false;
  let hit = 0;
  for (const z of s.seats) {
    if (!z.zombie || dist2(z.x, z.y, seat.x, seat.y) > FLASH_R * FLASH_R) continue;
    z.stunUntil = Math.max(z.stunUntil, t + FLASH_STUN_MS);
    z.lungeUntil = 0;
    hit++;
  }
  pushFx(s, [FX_FLASH, slot, Math.round(seat.x), Math.round(seat.y)]);
  pushFeed(s, { k: 2, a: slot, b: hit, at: Math.round(t) });
  return true;
}

// ---------- practice bots ----------
// A bot only uses what everyone sees (positions, who's a zombie, flags, items). Survivors run
// from the nearest zombies toward open floor and grab items; zombies chase the nearest human
// and lunge when close. A fresh look every 150-300 ms, and a random detour when stuck on a wall.

interface BotMem {
  next: number;
  x: number;
  y: number;
  /** Progress check: where it was a moment ago, and a detour direction until `detourUntil`. */
  px: number;
  py: number;
  checkAt: number;
  dx: number;
  dy: number;
  detourUntil: number;
}

const botMemory = new WeakMap<OBState, Map<string, BotMem>>();
const BOT_DIRS = Array.from({ length: 16 }, (_, k) => [Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8)] as const);

/** Can a body of radius r stand at (x, y)? Doors only stop zombies. */
function botClear(map: MapDef, x: number, y: number, r: number, zombie: boolean): boolean {
  if (x < r || y < r || x > WORLD_W - r || y > WORLD_H - r) return false;
  const hits = (rc: [number, number, number, number]) => {
    const cx = Math.max(rc[0], Math.min(rc[0] + rc[2], x));
    const cy = Math.max(rc[1], Math.min(rc[1] + rc[3], y));
    return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
  };
  if (map.walls.some(hits)) return false;
  return !(zombie && map.doors.some(hits));
}

function botAction(s: OBState, botId: string, ctx: GameCtx): OBAction | null {
  const slot = s.ids.indexOf(botId);
  if (slot < 0) return null;
  const me = s.seats[slot];
  let mems = botMemory.get(s);
  if (!mems) botMemory.set(s, (mems = new Map()));
  let m = mems.get(botId);
  if (!m) mems.set(botId, (m = { next: 0, x: 0, y: 0, px: me.x, py: me.y, checkAt: 0, dx: 0, dy: 0, detourUntil: 0 }));
  const steer = (x: number, y: number): OBAction | null => {
    if (x === m.x && y === m.y) return null;
    m.x = x;
    m.y = y;
    return { type: "in", x, y };
  };
  if (s.phase !== "intro" && s.phase !== "play") return steer(0, 0);
  const now = ctx.now();
  const t = simNow(s);
  const map = mapNow(s);
  const zombie = me.zombie;
  if (zombie && s.phase === "intro") return steer(0, 0);
  const rivals = s.seats
    .map((o, i) => ({ o, i, d: Math.hypot(o.x - me.x, o.y - me.y) }))
    .filter(({ i }) => i !== slot);

  if (s.phase === "play") {
    if (zombie) {
      // Lunge at a close human roughly ahead.
      const prey = rivals.filter(({ o }) => !o.zombie && t >= o.shieldUntil).sort((a, b) => a.d - b.d)[0];
      if (prey && prey.d < 115 && t >= me.lungeReady && t >= me.stunUntil && (me.ix || me.iy)) {
        const ahead = ((prey.o.x - me.x) * me.ix + (prey.o.y - me.y) * me.iy) / (prey.d || 1);
        if (ahead > 0.8 && ctx.random() < 0.35) return { type: "use" };
      }
    } else if (me.flash) {
      // Flash when a zombie that can move is right on top of us.
      const close = rivals.some(({ o, d }) => o.zombie && t >= o.stunUntil && d < 85);
      if (close && ctx.random() < 0.4) return { type: "use" };
    }
  }
  if (now < m.next) return null;
  m.next = now + 150 + ctx.random() * 150;

  // Stuck against a wall? Take a short random detour.
  if (now >= m.checkAt) {
    const moved = Math.hypot(me.x - m.px, me.y - m.py);
    if ((m.x || m.y) && moved < 25 && now >= m.detourUntil) {
      const [dx, dy] = BOT_DIRS[Math.floor(ctx.random() * BOT_DIRS.length)];
      m.dx = dx;
      m.dy = dy;
      m.detourUntil = now + 500 + ctx.random() * 600;
    }
    m.px = me.x;
    m.py = me.y;
    m.checkAt = now + 900;
  }
  if (now < m.detourUntil && botClear(map, me.x + m.dx * 30, me.y + m.dy * 30, zombie ? R_Z : R_S, zombie)) {
    return steer(Math.round(m.dx * 100), Math.round(m.dy * 100));
  }

  const r = zombie ? R_Z : R_S;
  // Who to chase (zombie: nearest human; survivor with a cure: a nearby curable zombie).
  let goal: { x: number; y: number } | null = null;
  if (zombie) {
    const prey = rivals.filter(({ o }) => !o.zombie).sort((a, b) => a.d - b.d)[0];
    if (prey) goal = prey.o;
  } else {
    const patient = me.cure ? rivals.filter(({ o, d }) => o.zombie && !o.original && d < 220).sort((a, b) => a.d - b.d)[0] : undefined;
    if (patient) goal = patient.o;
    else {
      const item = s.items
        .filter((it) => (it.kind === ITEM_CURE ? !me.cure : !me.flash))
        .map((it) => ({ it, d: Math.hypot(it.x - me.x, it.y - me.y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (item && item.d < 300) goal = item.it;
    }
  }
  const threats = zombie ? [] : rivals.filter(({ o, d }) => o.zombie && d < 380 && !(me.cure && !o.original && d < 220));
  let best = -Infinity;
  let bx = 0;
  let by = 0;
  for (const [dx, dy] of BOT_DIRS) {
    const ax = me.x + dx * 28;
    const ay = me.y + dy * 28;
    if (!botClear(map, ax, ay, r, zombie)) continue;
    const fx = me.x + dx * 70;
    const fy = me.y + dy * 70;
    let v = botClear(map, fx, fy, r, zombie) ? 10 : 0;
    if (goal) v += (Math.hypot(goal.x - me.x, goal.y - me.y) - Math.hypot(goal.x - fx, goal.y - fy)) * 0.6;
    for (const { o, d } of threats) v += ((Math.hypot(o.x - fx, o.y - fy) - d) * 160) / Math.max(60, d);
    // Corners are traps: drift back toward the middle a little.
    v -= (Math.abs(fx - WORLD_W / 2) / WORLD_W + Math.abs(fy - WORLD_H / 2) / WORLD_H) * (threats.length ? 25 : 6);
    v += (dx * m.x + dy * m.y) * 0.05 + ctx.random() * 6;
    if (v > best) {
      best = v;
      bx = dx;
      by = dy;
    }
  }
  if (best === -Infinity) return steer(0, 0);
  // Calm survivors with nowhere to be amble rather than stand still (and not every look).
  if (!zombie && !goal && !threats.length && ctx.random() < 0.3) return null;
  return steer(Math.round(bx * 100), Math.round(by * 100));
}

// ---------- game definition ----------

export const outbreak: GameDef<OBState, OBAction> = {
  id: "outbreak",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const set = readSettings(config.settings, ctx.settings);
    const s: OBState = {
      ids,
      rounds: set.rounds as number,
      playMs: (set.playSec as number) * 1000,
      phase: "intro",
      round: 1,
      mapOrder: shuffle(
        MAPS.map((_, i) => i),
        ctx.random,
      ),
      map: 0,
      endsAt: 0,
      playAt: 0,
      roundAt: 0,
      steps: 0,
      seats: ids.map((id) => newSeat(id)),
      scores: ids.map(() => 0),
      roundPts: ids.map(() => 0),
      bites: ids.map(() => 0),
      cures: ids.map(() => 0),
      items: [],
      itemSeq: 0,
      nextItemAt: 0,
      feed: [],
      history: [],
      result: null,
      champions: null,
      aloneSince: null,
      lastOriginals: [],
      dirty: false,
      snap: { k: "s", n: 1, t: ctx.now(), p: "", f: "" },
      fx: [],
      sent: null,
      sentAt: 0,
      quiet: false,
    };
    startRound(s, ctx, 1);
    s.snap = makeSnap(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.phase === "final") return false;
    const a: unknown = action;
    if (!a || typeof a !== "object" || Array.isArray(a)) return false;
    const slot = s.ids.indexOf(playerId);
    if (slot < 0) return false;
    const rec = a as Record<string, unknown>;
    if (rec.type === "in") {
      const v = readInput(rec);
      if (!v) return false;
      const seat = s.seats[slot];
      [seat.ix, seat.iy] = v;
      return false; // shows up in the next snapshot
    }
    if (rec.type === "use") {
      if (!applyUse(s, slot)) return false;
      s.snap = makeSnap(s, ctx);
      s.sent = s.snap;
      s.sentAt = ctx.now();
      return true;
    }
    return false;
  },

  tick(s, ctx) {
    if (s.phase === "final") return false;
    if (advance(s, ctx)) {
      // Something public happened: the view (with a fresh snapshot) goes to everyone.
      s.snap = makeSnap(s, ctx);
      s.sent = s.snap;
      s.sentAt = ctx.now();
      s.quiet = false;
      return true;
    }
    const snap = makeSnap(s, ctx);
    s.snap = snap;
    const now = ctx.now();
    if (s.sent && s.sent.n === snap.n && s.sent.p === snap.p && s.sent.f === snap.f && !snap.fx && now - s.sentAt < HEARTBEAT_MS) {
      s.quiet = true;
      return false;
    }
    if (s.quiet) snap.q = 1;
    s.quiet = false;
    s.sent = snap;
    s.sentAt = now;
    ctx.emit(snap);
    return false;
  },
  tickMs: TICK_MS,

  bot(s, botId, ctx) {
    return botAction(s, botId, ctx);
  },

  view(s) {
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.rounds,
      playMs: s.playMs,
      map: s.map,
      endsAt: s.endsAt,
      playAt: s.playAt,
      ids: s.ids,
      scores: s.scores,
      roundPts: s.roundPts,
      bites: s.bites,
      cures: s.cures,
      zombies: s.seats.flatMap((x, i) => (x.zombie ? [i] : [])),
      originals: s.seats.flatMap((x, i) => (x.original ? [i] : [])),
      items: s.items.map((i) => [i.id, i.kind, i.x, i.y] as [number, number, number, number]),
      feed: s.feed,
      result: s.result,
      history: s.history,
      champions: s.champions,
      abandonAt: s.aloneSince === null || s.phase === "final" ? null : s.aloneSince + ABANDON_MS,
      snap: s.snap,
    } satisfies OBView;
  },

  playerLeft(s, playerId, ctx) {
    const slot = s.ids.indexOf(playerId);
    if (slot < 0) return;
    s.seats[slot].ix = 0;
    s.seats[slot].iy = 0;
    checkAlone(s, ctx);
  },

  playerReturned(s, playerId, ctx) {
    const slot = s.ids.indexOf(playerId);
    if (slot < 0) return;
    s.seats[slot].ix = 0;
    s.seats[slot].iy = 0;
    checkAlone(s, ctx);
  },
};

export default outbreak;
