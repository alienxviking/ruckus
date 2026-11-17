import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  ABANDON_MS,
  ACCEL,
  ALL_LIT,
  DARTS,
  DART_MS,
  EXPOSE_MS,
  FX_PULSE,
  INTRO_MS,
  LIGHT_MS,
  LM_R,
  NPC_COUNT,
  PARKS,
  PTS_ALL_LIT,
  PTS_MOST_LIT,
  PTS_SNIPE,
  PTS_SURVIVOR,
  ROUND_OVER_MS,
  SNIPE_CD_MS,
  SPRINT_MUL,
  TICK_MS,
  WALK,
  WALKER_R,
  WORLD_H,
  WORLD_W,
  countBits,
  decodePositions,
  encodePositions,
  inputDir,
  landmarkAt,
  stepBody,
  type LitEvent,
  type NoEvent,
  type Park,
  type Phase,
  type Snap,
} from "./shared";

// Incognito: hide in a crowd of identical bots, light landmarks, snipe the other humans.
//
// The server owns everything. Every 50ms tick it moves all walkers with the same
// walking model (bots get their "input" from a simple brain, humans from their
// stick) and emits one compact snapshot event with every position. Snapshots carry
// nothing but positions, so the data can't tell humans from bots. Full views only go
// out on public changes (phases, snipes, round ends); landmark progress is private
// and travels as a tiny event to its owner.

// ---------- bot brain tuning ----------

/** Share of bot walks that head for a landmark (the humans' cover). */
const LM_CHANCE = 0.25;
/** Share of walks that turn a corner into a new walk without stopping. */
const CHAIN_CHANCE = 0.18;
/** Share of walks with a gentle curve, and the largest curve (radians at the start of a walk). */
const CURVE_CHANCE = 0.5;
const CURVE_MAX = 0.28;
const PAUSE_MIN = 500;
const PAUSE_MAX = 3_000;
const LEG_MIN = 70;
const LEG_MAX = 360;
/** A bot that stood on a landmark for LIGHT_MS fires a fake pulse this often. */
const FAKE_PULSE = 0.2;
/** A sniped bot stands there shrugging this long. */
const SHRUG_MS = 1_800;
const SPAWN_GAP = 34;
/** A tick never simulates more than this many steps (a stalled server skips ahead). */
const MAX_CATCHUP = 4;
/** Even when nothing moves, a snapshot goes out this often. */
const HEARTBEAT_MS = 1_000;
const MAX_FX = 12;
const STEP_S = TICK_MS / 1000;
const TAU = Math.PI * 2;

// ---------- state ----------

interface Walker {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The human's seat, or -1 for a bot. Secret: never leaves the server during a round. */
  slot: number;
  /** Brain: walking to (tx, ty), or paused until `until`. */
  walking: boolean;
  tx: number;
  ty: number;
  leg: number;
  curve: number;
  chain: boolean;
  until: number;
  giveUp: number;
  /** Landmark currently stood on (-1), since when (sim ms), and whether that stay already counted. */
  on: number;
  onAt: number;
  done: boolean;
  /** Sniped (a human lying on the grass for the rest of the round). */
  down: boolean;
}

interface Seat {
  id: string;
  /** This round's walker index (secret). */
  w: number;
  /** Steering direction (unit vector or 0) and sprint. */
  ix: number;
  iy: number;
  sprint: boolean;
  /** Landmarks lit this round (bit mask). */
  lit: number;
  darts: number;
  out: boolean;
  nextShotAt: number;
  /** Disconnected: the bot brain walks for them so nobody can tell (and nothing stalls). */
  auto: boolean;
}

export interface SnipeRec {
  /** Sniper's seat. */
  by: number;
  /** Target walker. */
  w: number;
  /** Seat that was hit, or -1 when the dart hit a bot. */
  hit: number;
  /** The sniper's walker (shown only for misses, while they're exposed). */
  sw: number;
  /** Sim time of the throw. */
  at: number;
}

export type RoundHow = "all" | "last" | "time" | "quit";

export interface RoundRec {
  round: number;
  park: number;
  how: RoundHow;
  /** Seats that earned the round bonus. */
  winners: number[];
  /** Points gained this round per seat (snipes + bonus). */
  pts: number[];
  /** Landmarks lit per seat (bit masks). */
  lit: number[];
  hits: number[];
  misses: number[];
  /** Walker index per seat: the big reveal. */
  humans: number[];
  /** Seats that were sniped this round. */
  out: number[];
}

export interface IncState {
  ids: string[];
  /** Rounds in the game and the play time of each (host settings). */
  rounds: number;
  playMs: number;
  phase: Phase;
  round: number;
  parkOrder: number[];
  park: number;
  /** Intro / play / round-over deadline (0 in the final). */
  endsAt: number;
  /** When this round's play phase started (0 during the intro). */
  playAt: number;
  /** Sim clock: roundAt + steps * TICK_MS. */
  roundAt: number;
  steps: number;
  walkers: Walker[];
  seats: Seat[];
  scores: number[];
  roundPts: number[];
  snipes: SnipeRec[];
  history: RoundRec[];
  result: RoundRec | null;
  champions: string[] | null;
  aloneSince: number | null;
  /** The newest snapshot (also carried by the view). */
  snap: Snap;
  fx: number[][];
  sent: Snap | null;
  sentAt: number;
  quiet: boolean;
}

export type IncAction = { type: "in"; x: number; y: number; s?: 0 | 1 } | { type: "snipe"; w: number };

export interface IncView {
  phase: Phase;
  round: number;
  rounds: number;
  /** Play time of a round (ms). */
  playMs: number;
  park: number;
  endsAt: number;
  playAt: number;
  ids: string[];
  scores: number[];
  roundPts: number[];
  darts: number[];
  /** Snipes this round, oldest first. `sw` is -1 unless the sniper is still exposed. */
  snipes: SnipeRec[];
  /** Number of walkers this round. */
  count: number;
  /** Your walker (-1 for spectators). */
  you: number;
  /** Your lit landmarks (bit mask). */
  lit: number;
  /** When your next dart is ready (server time). */
  shotAt: number;
  /** Walker per seat: only once you're out, and for everyone after the round. */
  humans: number[] | null;
  /** The round that just ended (round over / final). */
  result: RoundRec | null;
  history: RoundRec[];
  champions: string[] | null;
  /** The game ends at this time unless another player reconnects. */
  abandonAt: number | null;
  snap: Snap;
}

// ---------- helpers ----------

const simNow = (s: IncState) => s.roundAt + s.steps * TICK_MS;
const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const parkOf = (s: IncState): Park => PARKS[s.park] ?? PARKS[0];

/** Does a walker fit at (x, y) without touching an obstacle (plus `pad`)? */
function freeSpot(park: Park, x: number, y: number, pad: number) {
  for (const o of park.obstacles) {
    const r = o.r + pad;
    if ((x - o.x) ** 2 + (y - o.y) ** 2 < r * r) return false;
  }
  return true;
}

/** Can a walker go from A to B in a straight line without brushing an obstacle? */
function clearPath(park: Park, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  for (const o of park.obstacles) {
    const k = Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.y - ay) * dy) / len2));
    const px = ax + dx * k - o.x;
    const py = ay + dy * k - o.y;
    const r = o.r + WALKER_R + 6;
    if (px * px + py * py < r * r) return false;
  }
  return true;
}

function pushFx(s: IncState, fx: number[]) {
  if (s.fx.length < MAX_FX) s.fx.push(fx);
}

function newWalker(slot: number): Walker {
  return {
    x: WORLD_W / 2,
    y: WORLD_H / 2,
    vx: 0,
    vy: 0,
    slot,
    walking: false,
    tx: 0,
    ty: 0,
    leg: 1,
    curve: 0,
    chain: false,
    until: 0,
    giveUp: 0,
    on: -1,
    onAt: 0,
    done: false,
    down: false,
  };
}

/** Scatter everyone over the park: off obstacles, off landmarks, not on top of each other. */
function spawn(s: IncState, rnd: () => number) {
  const park = parkOf(s);
  const placed: [number, number][] = [];
  for (const w of s.walkers) {
    let best: [number, number] | null = null;
    let bestGap = -1;
    for (let k = 0; k < 60; k++) {
      const x = 40 + rnd() * (WORLD_W - 80);
      const y = 40 + rnd() * (WORLD_H - 80);
      if (!freeSpot(park, x, y, WALKER_R + 12)) continue;
      if (park.landmarks.some((l) => Math.hypot(l.x - x, l.y - y) < LM_R + 16)) continue;
      let gap = Infinity;
      for (const [px, py] of placed) gap = Math.min(gap, Math.hypot(px - x, py - y));
      if (gap > bestGap) {
        best = [x, y];
        bestGap = gap;
      }
      if (gap >= SPAWN_GAP) break;
    }
    const [x, y] = best ?? [40 + rnd() * 80, 40 + rnd() * 80];
    placed.push([x, y]);
    w.x = x;
    w.y = y;
  }
}

// ---------- the bot brain (also walks for disconnected humans) ----------

/** Choose the next walk. `corner` = continuing straight on from a walk without stopping. */
function pickLeg(s: IncState, w: Walker, t: number, rnd: () => number, corner = false): boolean {
  const park = parkOf(s);
  let tx = 0;
  let ty = 0;
  let ok = false;
  let toLandmark = false;
  if (!corner && rnd() < LM_CHANCE) {
    const n = park.landmarks.length;
    const start = Math.floor(rnd() * n);
    for (let k = 0; k < n && !ok; k++) {
      const l = park.landmarks[(start + k) % n];
      const a = rnd() * TAU;
      const r = Math.sqrt(rnd()) * LM_R * 0.55;
      tx = l.x + Math.cos(a) * r;
      ty = l.y + Math.sin(a) * r;
      const d = Math.hypot(tx - w.x, ty - w.y);
      if (d > 24 && d < 560 && clearPath(park, w.x, w.y, tx, ty)) ok = toLandmark = true;
    }
  }
  for (let k = 0; k < 14 && !ok; k++) {
    const a = rnd() * TAU;
    const d = LEG_MIN + rnd() * (LEG_MAX - LEG_MIN);
    tx = w.x + Math.cos(a) * d;
    ty = w.y + Math.sin(a) * d;
    if (tx < 30 || tx > WORLD_W - 30 || ty < 30 || ty > WORLD_H - 30) continue;
    if (!freeSpot(park, tx, ty, WALKER_R + 8) || !clearPath(park, w.x, w.y, tx, ty)) continue;
    ok = true;
  }
  if (!ok) return false;
  w.walking = true;
  w.tx = tx;
  w.ty = ty;
  w.leg = Math.max(1, Math.hypot(tx - w.x, ty - w.y));
  w.curve = rnd() < CURVE_CHANCE ? (rnd() * 2 - 1) * CURVE_MAX : 0;
  w.chain = !toLandmark && rnd() < CHAIN_CHANCE;
  w.giveUp = t + (w.leg / WALK) * 1000 + 2_500;
  return true;
}

/** What velocity a bot wants this step. Same limits as a human's stick: walk or stand. */
function brain(s: IncState, w: Walker, t: number, rnd: () => number): [number, number] {
  if (!w.walking) {
    if (t < w.until) return [0, 0];
    if (!pickLeg(s, w, t, rnd)) {
      w.until = t + 400;
      return [0, 0];
    }
  }
  let dx = w.tx - w.x;
  let dy = w.ty - w.y;
  let d = Math.hypot(dx, dy);
  if (w.chain && d < 12) {
    // Turn the corner into a fresh walk without stopping.
    if (pickLeg(s, w, t, rnd, true)) {
      dx = w.tx - w.x;
      dy = w.ty - w.y;
      d = Math.hypot(dx, dy);
    } else w.chain = false;
  }
  const speed = Math.hypot(w.vx, w.vy);
  if ((!w.chain && d < 10 && speed < 1) || t > w.giveUp) {
    w.walking = false;
    w.until = t + PAUSE_MIN + rnd() * (PAUSE_MAX - PAUSE_MIN);
    return [0, 0];
  }
  // Let go of the stick just in time to stop on the spot, exactly like a human does
  // (so bots brake with the same full deceleration as a released key).
  if (!w.chain && d <= stoppingDistance(speed) + speed * STEP_S * 0.5) return [0, 0];
  const a = Math.atan2(dy, dx) + w.curve * Math.min(1, d / w.leg);
  return [Math.cos(a) * WALK, Math.sin(a) * WALK];
}

/** How far a walker at `speed` still travels after letting go (at the tick rate). */
function stoppingDistance(speed: number) {
  const dv = ACCEL * STEP_S;
  let d = 0;
  for (let v = speed - dv; v > 0; v -= dv) d += v * STEP_S;
  return d;
}

// ---------- simulation ----------

/** Landmark bookkeeping for one walker: lights it for a human, maybe a fake pulse for a bot. */
function landmarkStep(s: IncState, ctx: GameCtx, w: Walker, t: number) {
  const li = landmarkAt(parkOf(s), w.x, w.y);
  if (li !== w.on) {
    w.on = li;
    w.onAt = t;
    w.done = false;
    return;
  }
  if (li < 0 || w.done || t - w.onAt < LIGHT_MS) return;
  w.done = true;
  const seat = w.slot >= 0 ? s.seats[w.slot] : null;
  if (seat && !seat.auto) {
    const bit = 1 << li;
    if (seat.lit & bit) return;
    seat.lit |= bit;
    pushFx(s, [FX_PULSE, li]);
    ctx.emit({ k: "lit", n: s.round, l: li, m: seat.lit } satisfies LitEvent, { to: seat.id });
    if (seat.lit === ALL_LIT) finishRound(s, ctx, "all", [w.slot]);
  } else if (ctx.random() < FAKE_PULSE) {
    pushFx(s, [FX_PULSE, li]);
  }
}

function stepWorld(s: IncState, ctx: GameCtx, t: number) {
  const park = parkOf(s);
  const moving = s.phase === "intro" || s.phase === "play";
  for (const w of s.walkers) {
    if (w.down) continue;
    let wx = 0;
    let wy = 0;
    if (moving) {
      const seat = w.slot >= 0 ? s.seats[w.slot] : null;
      if (seat && !seat.auto) {
        const sp = seat.sprint ? WALK * SPRINT_MUL : WALK;
        wx = seat.ix * sp;
        wy = seat.iy * sp;
      } else [wx, wy] = brain(s, w, t, ctx.random);
    }
    stepBody(w, wx, wy, STEP_S, park);
  }
  if (s.phase !== "play") return;
  for (const w of s.walkers) {
    if (w.down) continue;
    landmarkStep(s, ctx, w, t);
    if (s.phase !== "play") return; // someone just lit their fifth landmark
  }
}

/** Catch the walkers up with the clock. */
function simulate(s: IncState, ctx: GameCtx) {
  const target = Math.floor((ctx.now() - s.roundAt) / TICK_MS);
  let n = target - s.steps;
  if (n > MAX_CATCHUP) {
    s.steps = target - MAX_CATCHUP;
    n = MAX_CATCHUP;
  }
  for (let i = 0; i < n; i++) {
    s.steps += 1;
    stepWorld(s, ctx, simNow(s));
  }
}

function makeSnap(s: IncState): Snap {
  const xy = new Array<number>(s.walkers.length * 2);
  s.walkers.forEach((w, i) => {
    xy[i * 2] = w.x;
    xy[i * 2 + 1] = w.y;
  });
  const snap: Snap = { k: "s", n: s.round, t: Math.round(simNow(s)), p: encodePositions(xy) };
  if (s.fx.length) {
    snap.f = s.fx;
    s.fx = [];
  }
  return snap;
}

// ---------- rounds ----------

function startRound(s: IncState, ctx: GameCtx, round: number) {
  const now = ctx.now();
  s.round = round;
  s.park = s.parkOrder[(round - 1) % s.parkOrder.length];
  s.phase = "intro";
  s.endsAt = now + INTRO_MS;
  s.playAt = 0;
  s.roundAt = now;
  s.steps = 0;
  // Fresh, shuffled walker ids every round: index i means nothing from one round to the next.
  const who = shuffle(
    [...s.seats.map((_, i) => i), ...Array.from({ length: NPC_COUNT }, () => -1)],
    ctx.random,
  );
  s.walkers = who.map((slot) => newWalker(slot));
  s.walkers.forEach((w, i) => {
    if (w.slot >= 0) s.seats[w.slot].w = i;
    // Everyone starts standing; bots set off at different moments.
    w.until = now + ctx.random() * 1_800;
  });
  spawn(s, ctx.random);
  for (const seat of s.seats) {
    seat.ix = 0;
    seat.iy = 0;
    seat.sprint = false;
    seat.lit = 0;
    seat.darts = DARTS;
    seat.out = false;
    seat.nextShotAt = 0;
    seat.auto = !connected(ctx, seat.id);
  }
  s.roundPts = s.seats.map(() => 0);
  s.snipes = [];
  s.result = null;
  s.fx = [];
  s.sent = null;
  s.quiet = false;
}

function playerName(ctx: GameCtx, id: string) {
  return ctx.player(id)?.name ?? ctx.players.find((p) => p.id === id)?.name ?? "Someone";
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function scoreRecord(s: IncState): Record<string, number> {
  return Object.fromEntries(s.ids.map((id, i) => [id, s.scores[i]]));
}

function finishGame(s: IncState, ctx: GameCtx, quit: boolean) {
  if (s.phase === "final") return;
  s.phase = "final";
  s.endsAt = 0;
  for (const seat of s.seats) {
    seat.ix = 0;
    seat.iy = 0;
    seat.sprint = false;
  }
  const winners = topScorers(scoreRecord(s));
  s.champions = winners;
  const names = winners.map((id) => playerName(ctx, id));
  const best = winners.length ? s.scores[s.ids.indexOf(winners[0])] : 0;
  const pts = `${best} point${best === 1 ? "" : "s"}`;
  let headline: string;
  if (!names.length) headline = quit ? "Incognito ends early: everyone slipped away" : "Nobody scored: the bots win Incognito 🤖";
  else if (quit && names.length === 1) headline = `${names[0]} wins Incognito with ${pts}: everyone else left`;
  else if (names.length === 1) headline = `${names[0]} wins Incognito with ${pts}`;
  else headline = `${joinNames(names)} share the Incognito crown with ${pts} each`;
  ctx.end({ winners, headline, scores: scoreRecord(s) });
}

/** Close the current round, award bonuses, and move on (round over or the final). */
function finishRound(s: IncState, ctx: GameCtx, how: RoundHow, bonusTo: number[]) {
  if (s.phase !== "intro" && s.phase !== "play") return;
  const bonus = how === "all" ? PTS_ALL_LIT : how === "last" ? PTS_SURVIVOR : how === "time" ? PTS_MOST_LIT : 0;
  for (const slot of bonusTo) {
    s.scores[slot] += bonus;
    s.roundPts[slot] += bonus;
  }
  const rec: RoundRec = {
    round: s.round,
    park: s.park,
    how,
    winners: bonus ? bonusTo.slice() : [],
    pts: s.roundPts.slice(),
    lit: s.seats.map((x) => x.lit),
    hits: s.seats.map((_, i) => s.snipes.filter((r) => r.by === i && r.hit >= 0).length),
    misses: s.seats.map((_, i) => s.snipes.filter((r) => r.by === i && r.hit < 0).length),
    humans: s.seats.map((x) => x.w),
    out: s.seats.flatMap((x, i) => (x.out ? [i] : [])),
  };
  s.history.push(rec);
  s.result = rec;
  for (const seat of s.seats) {
    seat.ix = 0;
    seat.iy = 0;
    seat.sprint = false;
  }
  if (how === "quit" || s.round >= s.rounds) return finishGame(s, ctx, how === "quit");
  s.phase = "roundOver";
  s.endsAt = ctx.now() + ROUND_OVER_MS;
}

/** Time's up: the unsniped humans with the most landmarks share the bonus. */
function timeUp(s: IncState, ctx: GameCtx) {
  const alive = s.seats.flatMap((x, i) => (x.out ? [] : [i]));
  const best = Math.max(0, ...alive.map((i) => countBits(s.seats[i].lit)));
  finishRound(s, ctx, "time", best > 0 ? alive.filter((i) => countBits(s.seats[i].lit) === best) : []);
}

/** Track "fewer than two players online"; ends the game once that lasts ABANDON_MS. */
function checkAlone(s: IncState, ctx: GameCtx): boolean {
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
  if (s.phase === "intro" || s.phase === "play") finishRound(s, ctx, "quit", []);
  else finishGame(s, ctx, true);
  return true;
}

function advance(s: IncState, ctx: GameCtx): boolean {
  const now = ctx.now();
  const changed = checkAlone(s, ctx);
  if (s.phase === "final") return changed;
  const before = s.phase;
  simulate(s, ctx);
  if (s.phase !== before) return true; // someone lit all five
  switch (s.phase) {
    case "intro":
      if (now < s.endsAt) return changed;
      s.phase = "play";
      s.playAt = now;
      s.endsAt = now + s.playMs;
      return true;
    case "play":
      if (now < s.endsAt) return changed;
      timeUp(s, ctx);
      return true;
    case "roundOver":
      if (now < s.endsAt) return changed;
      startRound(s, ctx, s.round + 1);
      return true;
  }
  return changed;
}

// ---------- validation ----------

function readInput(a: Record<string, unknown>): [number, number, boolean] | null {
  const { x, y, s } = a;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < -100 || x > 100 || y < -100 || y > 100) return null;
  if (s !== undefined && s !== 0 && s !== 1) return null;
  const [dx, dy] = inputDir(x, y);
  return [dx, dy, s === 1];
}

function deny(ctx: GameCtx, to: string, w: number, why: string): false {
  ctx.emit({ k: "no", w, why } satisfies NoEvent, { to });
  return false;
}

function snipe(s: IncState, slot: number, w: unknown, ctx: GameCtx): boolean {
  if (typeof w !== "number" || !Number.isInteger(w) || w < 0 || w >= s.walkers.length) return false;
  const seat = s.seats[slot];
  const id = s.ids[slot];
  if (s.phase === "intro") return deny(ctx, id, w, "Darts unlock when the round starts");
  if (s.phase !== "play") return false;
  if (seat.out) return deny(ctx, id, w, "You're out this round");
  if (seat.darts <= 0) return deny(ctx, id, w, "No darts left this round");
  const now = ctx.now();
  if (now < seat.nextShotAt) return deny(ctx, id, w, "Reloading…");
  if (w === seat.w) return deny(ctx, id, w, "That's you!");
  const target = s.walkers[w];
  if (target.down) return deny(ctx, id, w, "They're already down");
  seat.darts -= 1;
  seat.nextShotAt = now + SNIPE_CD_MS;
  const at = Math.round(simNow(s));
  if (target.slot >= 0) {
    // A human! They drop where they stand and are out for the round.
    target.down = true;
    target.walking = false;
    target.vx = 0;
    target.vy = 0;
    const victim = s.seats[target.slot];
    victim.out = true;
    victim.ix = 0;
    victim.iy = 0;
    s.scores[slot] += PTS_SNIPE;
    s.roundPts[slot] += PTS_SNIPE;
    s.snipes.push({ by: slot, w, hit: target.slot, sw: seat.w, at });
    const alive = s.seats.flatMap((x, i) => (x.out ? [] : [i]));
    if (alive.length <= 1) finishRound(s, ctx, "last", alive);
  } else {
    // Just a bot: it stops and shrugs, and the sniper gives themselves away.
    target.walking = false;
    target.until = at + SHRUG_MS;
    target.chain = false;
    s.snipes.push({ by: slot, w, hit: -1, sw: seat.w, at });
  }
  return true;
}

// ---------- practice bot ----------
//
// A bot *player* (not one of the crowd): it walks like the crowd does, lights the landmarks it
// still needs, and darts walkers that gave themselves away in public: a sniper lit up after a
// miss, a walker standing on a landmark as it pulses, or someone sprinting. It only reads its
// own view (the same positions and pulses everyone gets).

interface BotMem {
  round: number;
  lastSnap: Snap | null;
  prev: number[] | null;
  prevT: number;
  /** Suspicion per walker index (this round). */
  sus: Map<number, number>;
  /** Walkers known to be down. */
  down: Set<number>;
  snipesSeen: number;
  walking: boolean;
  tx: number;
  ty: number;
  until: number;
  giveUp: number;
  onLandmark: boolean;
  /** Last stick sent. */
  ix: number;
  iy: number;
  /** A dart it has decided to throw, once it has "noticed" (reaction time). */
  aim: { w: number; at: number } | null;
}

const botMem = new WeakMap<IncState, Map<string, BotMem>>();

function botPickLeg(m: BotMem, park: Park, x: number, y: number, lit: number, now: number, rnd: () => number) {
  m.onLandmark = false;
  let ok = false;
  if (rnd() < 0.4) {
    const todo = park.landmarks.flatMap((l, i) => (lit & (1 << i) ? [] : [l]));
    const l = todo.length ? todo[Math.floor(rnd() * todo.length)] : null;
    if (l && clearPath(park, x, y, l.x, l.y)) {
      const a = rnd() * TAU;
      const r = Math.sqrt(rnd()) * LM_R * 0.45;
      m.tx = l.x + Math.cos(a) * r;
      m.ty = l.y + Math.sin(a) * r;
      ok = m.onLandmark = true;
    }
  }
  for (let k = 0; k < 14 && !ok; k++) {
    const a = rnd() * TAU;
    const d = LEG_MIN + rnd() * (LEG_MAX - LEG_MIN);
    const tx = x + Math.cos(a) * d;
    const ty = y + Math.sin(a) * d;
    if (tx < 30 || tx > WORLD_W - 30 || ty < 30 || ty > WORLD_H - 30) continue;
    if (!freeSpot(park, tx, ty, WALKER_R + 8) || !clearPath(park, x, y, tx, ty)) continue;
    m.tx = tx;
    m.ty = ty;
    ok = true;
  }
  if (!ok) {
    m.until = now + 400;
    return;
  }
  m.walking = true;
  m.giveUp = now + (Math.hypot(m.tx - x, m.ty - y) / WALK) * 1000 + 2_500;
}

function botMove(s: IncState, botId: string, ctx: GameCtx): IncAction | null {
  const v = incognito.view(s, botId, ctx) as IncView;
  if ((v.phase !== "intro" && v.phase !== "play") || v.you < 0) return null;
  const slot = v.ids.indexOf(botId);
  if (v.snipes.some((r) => r.hit === slot)) return null; // darted: out for the round
  let mems = botMem.get(s);
  if (!mems) botMem.set(s, (mems = new Map()));
  let m = mems.get(botId);
  const now = ctx.now();
  if (!m || m.round !== v.round) {
    m = {
      round: v.round,
      lastSnap: null,
      prev: null,
      prevT: 0,
      sus: new Map(),
      down: new Set(),
      snipesSeen: 0,
      walking: false,
      tx: 0,
      ty: 0,
      until: now + ctx.random() * 1_800,
      giveUp: 0,
      onLandmark: false,
      ix: 0,
      iy: 0,
      aim: null,
    };
    mems.set(botId, m);
  }
  const park = PARKS[v.park] ?? PARKS[0];
  const pos = decodePositions(v.snap.p);
  const bump = (w: number, by: number) => {
    if (w !== v.you && !m.down.has(w)) m.sus.set(w, (m.sus.get(w) ?? 0) + by);
  };

  // ----- watch the crowd -----
  if (m.lastSnap !== v.snap && v.snap.n === v.round) {
    m.lastSnap = v.snap;
    const dt = v.snap.t - m.prevT;
    if (m.prev && m.prev.length === pos.length && dt > 0 && dt <= 400) {
      for (let i = 0; i * 2 < pos.length; i++) {
        const sp = (Math.hypot(pos[i * 2] - m.prev[i * 2], pos[i * 2 + 1] - m.prev[i * 2 + 1]) * 1000) / dt;
        // Nobody but a sprinting human goes this fast.
        if (sp > WALK * 1.35) bump(i, 0.4);
      }
    }
    // Memory fades: in a crowd this big it's easy to lose track of who did what.
    if (m.prev && dt > 0) for (const [w, k] of m.sus) if (k > 0) m.sus.set(w, k * Math.pow(0.97, dt / 1000));
    m.prev = pos;
    m.prevT = v.snap.t;
    for (const f of v.snap.f ?? []) {
      if (f[0] !== FX_PULSE) continue;
      const l = park.landmarks[f[1]];
      if (!l) continue;
      for (let i = 0; i * 2 < pos.length; i++) {
        if (Math.hypot(pos[i * 2] - l.x, pos[i * 2 + 1] - l.y) <= LM_R + 4) bump(i, 1.1);
      }
    }
  }
  for (; m.snipesSeen < v.snipes.length; m.snipesSeen++) {
    const r = v.snipes[m.snipesSeen];
    if (r.hit >= 0) m.down.add(r.w);
    else {
      m.sus.set(r.w, -99); // the dart showed it's just a bot
      if (r.sw >= 0) bump(r.sw, 5); // a missed sniper lit up: that one's human
    }
    if (m.aim?.w === r.w) m.aim = null;
  }

  // ----- dart -----
  if (v.phase === "play" && (v.darts[slot] ?? 0) > 0) {
    if (m.aim && now >= m.aim.at && now >= v.shotAt) {
      let w = m.aim.w;
      m.aim = null;
      // Sometimes it mixes the suspect up with a walker right next to them.
      if (ctx.random() < 0.3) {
        let near = -1;
        let nd = 40;
        for (let i = 0; i * 2 < pos.length; i++) {
          const d = Math.hypot(pos[i * 2] - pos[w * 2], pos[i * 2 + 1] - pos[w * 2 + 1]);
          if (i !== w && i !== v.you && !m.down.has(i) && d < nd) [near, nd] = [i, d];
        }
        if (near >= 0) w = near;
      }
      if (!m.down.has(w)) return { type: "snipe", w };
    }
    if (!m.aim) {
      let best = -1;
      let score = 0;
      for (const [w, k] of m.sus) {
        if (k > score && !m.down.has(w)) [best, score] = [w, k];
      }
      const late = v.endsAt - now < 20_000;
      if (best >= 0 && score >= (late ? 1.5 : 3)) m.aim = { w: best, at: now + 1_000 + ctx.random() * 2_000 };
    }
  }

  // ----- walk like the crowd -----
  const x = pos[v.you * 2];
  const y = pos[v.you * 2 + 1];
  if (x === undefined || y === undefined) return null;
  let ix = 0;
  let iy = 0;
  if (!m.walking) {
    if (now >= m.until) botPickLeg(m, park, x, y, v.lit, now, ctx.random);
  }
  if (m.walking) {
    const dx = m.tx - x;
    const dy = m.ty - y;
    const d = Math.hypot(dx, dy);
    if (d < 7 || now > m.giveUp) {
      m.walking = false;
      // On a landmark, stay long enough to light it.
      m.until = now + (m.onLandmark ? LIGHT_MS + 300 : 0) + PAUSE_MIN + ctx.random() * (PAUSE_MAX - PAUSE_MIN);
    } else {
      ix = Math.round((dx / d) * 100);
      iy = Math.round((dy / d) * 100);
    }
  }
  if (ix === m.ix && iy === m.iy) return null;
  m.ix = ix;
  m.iy = iy;
  return { type: "in", x: ix, y: iy };
}

// ---------- game definition ----------

export const incognito: GameDef<IncState, IncAction> = {
  id: "incognito",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const set = readSettings(config.settings, ctx.settings);
    const s: IncState = {
      ids,
      rounds: Number(set.rounds),
      playMs: Number(set.time),
      phase: "intro",
      round: 1,
      parkOrder: shuffle(
        PARKS.map((_, i) => i),
        ctx.random,
      ),
      park: 0,
      endsAt: 0,
      playAt: 0,
      roundAt: 0,
      steps: 0,
      walkers: [],
      seats: ids.map((id) => ({
        id,
        w: -1,
        ix: 0,
        iy: 0,
        sprint: false,
        lit: 0,
        darts: DARTS,
        out: false,
        nextShotAt: 0,
        auto: false,
      })),
      scores: ids.map(() => 0),
      roundPts: ids.map(() => 0),
      snipes: [],
      history: [],
      result: null,
      champions: null,
      aloneSince: null,
      snap: { k: "s", n: 1, t: ctx.now(), p: "" },
      fx: [],
      sent: null,
      sentAt: 0,
      quiet: false,
    };
    startRound(s, ctx, 1);
    s.snap = makeSnap(s);
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
      [seat.ix, seat.iy, seat.sprint] = v;
      return false; // shows up in the next snapshot
    }
    if (rec.type === "snipe") return snipe(s, slot, rec.w, ctx);
    return false;
  },

  tick(s, ctx) {
    if (s.phase === "final") {
      // The crowd comes to a stop for the last reveal (cosmetic; ticks stop soon after the end).
      simulate(s, ctx);
    } else if (advance(s, ctx)) {
      // Something public happened: the view (with a fresh snapshot) goes to everyone.
      s.snap = makeSnap(s);
      s.sent = s.snap;
      s.sentAt = ctx.now();
      s.quiet = false;
      return true;
    }
    const snap = makeSnap(s);
    s.snap = snap;
    const now = ctx.now();
    if (s.sent && s.sent.n === snap.n && s.sent.p === snap.p && !snap.f && now - s.sentAt < HEARTBEAT_MS) {
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

  view(s, viewerId) {
    const slot = s.ids.indexOf(viewerId);
    const seat = slot >= 0 ? s.seats[slot] : null;
    const reveal = s.phase === "roundOver" || s.phase === "final";
    const t = simNow(s);
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.rounds,
      playMs: s.playMs,
      park: s.park,
      endsAt: s.endsAt,
      playAt: s.playAt,
      ids: s.ids,
      scores: s.scores,
      roundPts: s.roundPts,
      darts: s.seats.map((x) => x.darts),
      snipes: s.snipes.map((r) => ({
        by: r.by,
        w: r.w,
        hit: r.hit,
        // Where a careless sniper stands is public only while they're lit up.
        sw: r.hit < 0 && (reveal || t - r.at < DART_MS + EXPOSE_MS + 500) ? r.sw : -1,
        at: r.at,
      })),
      count: s.walkers.length,
      you: seat ? seat.w : -1,
      lit: seat ? seat.lit : 0,
      shotAt: seat ? seat.nextShotAt : 0,
      humans: reveal || (seat?.out && s.phase === "play") ? s.seats.map((x) => x.w) : null,
      result: s.result,
      history: s.history,
      champions: s.champions,
      abandonAt: s.aloneSince === null || s.phase === "final" ? null : s.aloneSince + ABANDON_MS,
      snap: s.snap,
    } satisfies IncView;
  },

  bot(s, botId, ctx) {
    return botMove(s, botId, ctx);
  },

  playerLeft(s, playerId, ctx) {
    const slot = s.ids.indexOf(playerId);
    if (slot < 0) return;
    const seat = s.seats[slot];
    seat.ix = 0;
    seat.iy = 0;
    seat.sprint = false;
    if (!seat.auto && s.phase !== "final") {
      // The bot brain takes over their walker, from a standstill.
      seat.auto = true;
      const w = s.walkers[seat.w];
      if (w) {
        w.walking = false;
        w.until = simNow(s) + 300 + ctx.random() * 1_200;
      }
    }
    checkAlone(s, ctx);
  },

  playerReturned(s, playerId, ctx) {
    const slot = s.ids.indexOf(playerId);
    if (slot < 0) return;
    const seat = s.seats[slot];
    seat.auto = false;
    seat.ix = 0;
    seat.iy = 0;
    seat.sprint = false;
    checkAlone(s, ctx);
  },
};

export default incognito;

