import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  ABANDON_MS,
  CAMP_MS,
  CENTER,
  COLLAPSE_EVERY_MS,
  COUNTDOWN_MS,
  F_FLOAT,
  F_FLOAT_LOW,
  F_OFFLINE,
  FLOAT_MS,
  FLOAT_WARN_MS,
  FX_FALL,
  FX_HIT,
  FX_JUMP,
  FX_PICKUP,
  FX_SHOCK,
  FX_SINK,
  GONE,
  JUMP_CD_STEPS,
  JUMP_STEPS,
  MAX_POWERS,
  PLAYER_R,
  POWER_EVERY_MS,
  POWER_FIRST_MS,
  POWER_KINDS,
  POWER_REACH,
  REBUILD_RANGE,
  ROUND_OVER_MS,
  SHOCK_RANGE,
  SUBSTEPS,
  SUB_MS,
  TICK_MS,
  arenaRadius,
  board,
  crackStage,
  faceCentre,
  hexAt,
  hexDist,
  tileAt,
  type Board,
  type FxTuple,
  type Phase,
  type PlayerTuple,
  type PowerKind,
  type Snap,
  HIT_FX_MIN,
  encodeStick,
} from "./shared";
import {
  BRAKE_FRICTION,
  FRICTION,
  MAX_REWIND_STEPS,
  applyJump,
  integrate,
  resolveBump,
  rewindDelta,
  stampStep,
} from "./physics";

// Floor is Lava: a hex arena over lava where every tile you leave crumbles (Ruckus original).
// The server owns the physics: 3 fixed substeps of 1/60 s per 50 ms tick, driven by the clock
// (a late tick catches up instead of slowing the game down). Every tick it sends everyone a
// compact snapshot event (positions plus tile changes) and returns false; the full view, with
// the whole board as a string, only goes out on big moments (phase changes, falls). Nothing is
// secret, so every viewer gets the same view.
//
// Latency: inputs carry a number (`s`) and the sim time they are meant for (`at`, stamped by the
// client a network trip ahead). An early input waits for its substep; a late one is applied at once,
// as if on time but at most ~150 ms back (that player's own stick only; nobody else is rewound).
// The next snapshot acknowledges every input with when it takes effect and when it arrived (`a`),
// so the owner's client replays its inputs with the server's timing (predict.ts). Motion and bumps
// are shared code (physics.ts): the client predicts everyone, bumps included.

// ---------- tuning ----------

/** A bump this hard counts as a shove for knockout credit... */
const SHOVE_MIN = 45;
/** ...if the victim falls within this long. */
const KO_WINDOW_MS = 2_500;
const MAX_CATCHUP = 6;
/** An early input waits at most this many substeps (1 s) for its stamp. */
const MAX_HOLD_STEPS = 60;
const MAX_QUEUE = 16;
const HEARTBEAT_MS = 1_000;
const MAX_FX = 16;
/** Falls show at once in the snapshots; the full view (feed, scores) follows at most this often. */
const VIEW_MIN_MS = 500;
/** Collapse rings start cracking staggered over this long, so the edge crumbles in a wave. */
const COLLAPSE_STAGGER_MS = 600;

// ---------- state ----------

interface Runner {
  slot: number;
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Stick input, magnitude <= 1. Kept across rounds (a held key keeps working). */
  ix: number;
  iy: number;
  /** Last direction wanted (unit vector): a jump with no stick and no motion goes this way. */
  fx: number;
  fy: number;
  alive: boolean;
  /** Substep index of the latest take-off (-1e9 = none). */
  jumpStep: number;
  jumpQueued: boolean;
  floatUntil: number;
  /** Tile stood on (-1 = in the air / floating), and since when. */
  tile: number;
  tileSince: number;
  hitBy: number;
  hitAt: number;
  /** Newest input number received. */
  seq: number;
  /** Inputs waiting for their stamped substep. */
  queue: { k: number; jump: boolean; x: number; y: number }[];
  /** Inputs the next snapshot acknowledges: [input number, sim time it takes effect (0 = n/a), time it arrived]. */
  acks: [number, number, number][];
}

interface Power {
  kind: PowerKind;
  tile: number;
}

export interface FallRec {
  /** Slot that fell. */
  s: number;
  /** Slot that bumped them in (-1 = on their own). */
  by: number;
  at: number;
}

export interface RoundRec {
  winner: string | null;
  /** Slots in the order they fell this round. */
  order: number[];
}

export interface LavaState {
  ids: string[];
  /** Arena radius in tiles. */
  R: number;
  /** Host settings: round wins to take the match, rounds at most, and when the edges start crumbling. */
  winsNeeded: number;
  maxRounds: number;
  collapseMs: number;
  phase: Phase;
  round: number;
  endsAt: number;
  fightAt: number;
  steps: number;
  runners: Runner[];
  /** Tile stages (0 solid, 1-3 cracking, 4 gone), by tile index. */
  tiles: number[];
  /** When each tile starts/started cracking (sim time; 0 = not cracking). */
  crackAt: number[];
  /** Tiles currently cracking (or about to). */
  cracking: number[];
  /** Tiles at this many steps from the centre or more have collapsed (R + 1 = none yet). */
  ring: number;
  powers: Power[];
  powerAt: number;
  wins: number[];
  kos: number[];
  falls: FallRec[];
  history: RoundRec[];
  lastWinner: string | null;
  champions: string[] | null;
  aloneSince: number | null;
  snap: Snap;
  /** Tile changes and effects collected since the last snapshot. */
  changes: number[];
  fx: FxTuple[];
  sent: Snap | null;
  sentAt: number;
  quiet: boolean;
  rev: number;
  /** Someone fell since the last full view, and when that view went out. */
  viewDue: boolean;
  viewAt: number;
}

/** `s` numbers the client's inputs (optional): the next snapshot acknowledges it. */
export type LavaAction = { type: "input"; x: number; y: number; s?: number; at?: number } | { type: "jump"; s?: number; at?: number };

export interface LavaView {
  phase: Phase;
  round: number;
  R: number;
  winsNeeded: number;
  maxRounds: number;
  /** Ms into a round before the outer ring starts crumbling. */
  collapseMs: number;
  endsAt: number;
  fightAt: number;
  ids: string[];
  wins: number[];
  kos: number[];
  falls: FallRec[];
  history: RoundRec[];
  lastWinner: string | null;
  champions: string[] | null;
  abandonAt: number | null;
  /** Every tile's stage as one digit per tile, at the snapshot's time. */
  board: string;
  snap: Snap;
}

// ---------- helpers ----------

const simTime = (s: LavaState) => s.fightAt + s.steps * SUB_MS;
const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const airborne = (s: LavaState, r: Runner) => s.steps - r.jumpStep < JUMP_STEPS;

function pushFx(s: LavaState, fx: FxTuple) {
  if (s.fx.length < MAX_FX) s.fx.push(fx);
}

function setTile(s: LavaState, i: number, stage: number) {
  if (s.tiles[i] === stage) return;
  s.tiles[i] = stage;
  s.changes.push(i, stage);
}

/** Start a tile cracking (no-op unless it's solid and not already about to crack). */
function crack(s: LavaState, i: number, at: number) {
  if (i < 0 || s.tiles[i] !== 0 || s.crackAt[i]) return;
  s.crackAt[i] = at;
  s.cracking.push(i);
  if (at <= simTime(s)) setTile(s, i, 1);
}

function newRunner(slot: number, id: string): Runner {
  return {
    slot,
    id,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ix: 0,
    iy: 0,
    fx: 0,
    fy: 1,
    alive: true,
    jumpStep: -1e9,
    jumpQueued: false,
    floatUntil: 0,
    tile: -1,
    tileSince: 0,
    hitBy: -1,
    hitAt: 0,
    seq: 0,
    queue: [],
    acks: [],
  };
}

/** Spawn tiles: evenly spread on the ring two steps in from the edge, in a shuffled order. */
function spawnTiles(b: Board, n: number, ctx: GameCtx): number[] {
  const ringD = Math.max(2, b.R - 2);
  const ring = b.tiles
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.d === ringD)
    .sort((p, q) => Math.atan2(p.h.y - CENTER, p.h.x - CENTER) - Math.atan2(q.h.y - CENTER, q.h.x - CENTER));
  const start = Math.floor(ctx.random() * ring.length);
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(ring[(start + Math.floor((k * ring.length) / n)) % ring.length].i);
  return out;
}

function startRound(s: LavaState, ctx: GameCtx) {
  const b = board(s.R);
  s.tiles = b.tiles.map(() => 0);
  s.crackAt = b.tiles.map(() => 0);
  s.cracking = [];
  s.ring = s.R + 1;
  const spawns = spawnTiles(b, s.runners.length, ctx);
  const order = shuffle(
    s.runners.map((r) => r.slot),
    ctx.random,
  );
  order.forEach((slot, k) => {
    const r = s.runners[slot];
    const h = b.tiles[spawns[k]];
    r.x = h.x;
    r.y = h.y;
    r.vx = 0;
    r.vy = 0;
    [r.fx, r.fy] = faceCentre(h.x, h.y);
    r.alive = true;
    r.jumpStep = -1e9;
    r.jumpQueued = false;
    r.floatUntil = 0;
    r.tile = spawns[k];
    r.tileSince = 0;
    r.hitBy = -1;
    r.hitAt = 0;
  });
  // A few holes from the start, away from everyone's spawn, so there's something to jump.
  const safe = new Set<number>();
  for (const sp of spawns) {
    safe.add(sp);
    for (const nb of b.near[sp]) {
      safe.add(nb);
      for (const nb2 of b.near[nb]) safe.add(nb2);
    }
  }
  const candidates = b.tiles
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => h.d >= 2 && h.d <= s.R - 1 && !safe.has(i))
    .map(({ i }) => i);
  const holes = shuffle(candidates, ctx.random);
  let made = 0;
  const want = s.R + 1;
  for (const i of holes) {
    if (made >= want) break;
    // No two holes side by side (each one is a single-tile gap).
    if (b.near[i].some((nb) => s.tiles[nb] === GONE)) continue;
    s.tiles[i] = GONE;
    made += 1;
  }
  s.phase = "countdown";
  s.endsAt = ctx.now() + COUNTDOWN_MS;
  s.fightAt = 0;
  s.steps = 0;
  s.powers = [];
  s.powerAt = 0;
  s.falls = [];
  s.fx = [];
  s.changes = [];
  s.lastWinner = null;
}

// ---------- physics ----------

/** Resolve one bump between two players. Exported for tests. */
export function collide(s: LavaState, a: Runner, b: Runner, t: number) {
  // Push apart and bounce (physics.ts); exactly on top of each other, split along a's facing.
  const c = resolveBump(a, b, PLAYER_R, a.fx, a.fy);
  if (!c || c.j <= 0) return;
  const { j, nx, ny } = c;
  if (j >= SHOVE_MIN) {
    a.hitBy = b.slot;
    a.hitAt = t;
    b.hitBy = a.slot;
    b.hitAt = t;
  }
  if (j >= HIT_FX_MIN) {
    pushFx(s, [FX_HIT, Math.round(a.x + nx * PLAYER_R), Math.round(a.y + ny * PLAYER_R), Math.round(j), a.slot, b.slot]);
  }
}

function moveRunner(s: LavaState, r: Runner, friction: number, steer: boolean) {
  if (r.jumpQueued && steer && s.steps - r.jumpStep >= JUMP_CD_STEPS) {
    r.jumpQueued = false;
    r.jumpStep = s.steps;
    const [ux, uy] = applyJump(r, r.ix, r.iy, r.fx, r.fy);
    r.fx = ux;
    r.fy = uy;
    pushFx(s, [FX_JUMP, r.slot, Math.round(ux * 100), Math.round(uy * 100)]);
  }
  integrate(r, r.ix, r.iy, airborne(s, r), friction, steer);
}

/** Advance every cracking tile to its stage at sim time t. */
function crackStep(s: LavaState, t: number) {
  if (!s.cracking.length) return;
  const keep: number[] = [];
  for (const i of s.cracking) {
    if (!s.crackAt[i]) continue; // rebuilt
    const stage = crackStage(t - s.crackAt[i]);
    if (stage > 0) setTile(s, i, stage);
    if (stage >= GONE) {
      s.crackAt[i] = 0;
      const p = s.powers.findIndex((pw) => pw.tile === i);
      if (p >= 0) {
        s.powers.splice(p, 1);
        pushFx(s, [FX_SINK, i]);
      }
      continue;
    }
    keep.push(i);
  }
  s.cracking = keep;
}

/** The outer rings crumble in turn once the round has run a while. */
function collapseStep(s: LavaState, ctx: GameCtx, t: number) {
  const ms = t - s.fightAt;
  if (ms < s.collapseMs) return;
  const ring = s.R - Math.floor((ms - s.collapseMs) / COLLAPSE_EVERY_MS);
  if (ring >= s.ring) return;
  s.ring = Math.max(0, ring);
  const b = board(s.R);
  b.tiles.forEach((h, i) => {
    if (h.d >= s.ring) crack(s, i, t + ctx.random() * COLLAPSE_STAGGER_MS);
  });
}

function fall(s: LavaState, r: Runner, t: number) {
  r.alive = false;
  r.jumpQueued = false;
  r.tile = -1;
  const by = r.hitBy >= 0 && t - r.hitAt <= KO_WINDOW_MS ? r.hitBy : -1;
  pushFx(s, [FX_FALL, r.slot, Math.round(r.x), Math.round(r.y), by]);
  if (by >= 0) s.kos[by] += 1;
  s.falls.push({ s: r.slot, by, at: Math.round(t) });
}

/** Floor under each player: falls, tiles left behind, and campers. Returns how many fell. */
function floorStep(s: LavaState, t: number): number {
  const b = board(s.R);
  let fell = 0;
  for (const r of s.runners) {
    if (!r.alive) continue;
    const under = tileAt(b, r.x, r.y);
    const standing = !airborne(s, r) && r.floatUntil <= t;
    if (standing && (under < 0 || s.tiles[under] === GONE)) {
      if (r.tile >= 0) crack(s, r.tile, t);
      fall(s, r, t);
      fell += 1;
      continue;
    }
    const now = standing ? under : -1;
    if (now !== r.tile) {
      if (r.tile >= 0) crack(s, r.tile, t);
      r.tile = now;
      r.tileSince = t;
    } else if (now >= 0 && t - r.tileSince >= CAMP_MS) {
      crack(s, now, t);
    }
  }
  return fell;
}

function rebuild(s: LavaState, r: Runner) {
  const b = board(s.R);
  const [cq, cr] = hexAt(r.x, r.y);
  b.tiles.forEach((h, i) => {
    if (h.d >= s.ring || hexDist(h.q - cq, h.r - cr) > REBUILD_RANGE) return;
    s.crackAt[i] = 0;
    setTile(s, i, 0);
  });
  s.cracking = s.cracking.filter((i) => s.crackAt[i] > 0);
  // Your own tile counts from now, so the rebuilt floor isn't camping-cracked at once.
  r.tileSince = simTime(s);
}

function shock(s: LavaState, by: Runner, t: number) {
  const b = board(s.R);
  for (const r of s.runners) {
    if (!r.alive || r === by) continue;
    const [cq, cr] = hexAt(r.x, r.y);
    b.tiles.forEach((h, i) => {
      if (hexDist(h.q - cq, h.r - cr) <= SHOCK_RANGE) crack(s, i, t);
    });
  }
  pushFx(s, [FX_SHOCK, by.slot]);
}

function powerStep(s: LavaState, ctx: GameCtx, t: number) {
  const b = board(s.R);
  for (let k = s.powers.length - 1; k >= 0; k--) {
    const p = s.powers[k];
    const h = b.tiles[p.tile];
    const r = s.runners.find((x) => x.alive && Math.hypot(x.x - h.x, x.y - h.y) <= POWER_REACH);
    if (!r) continue;
    s.powers.splice(k, 1);
    pushFx(s, [FX_PICKUP, r.slot, POWER_KINDS.indexOf(p.kind), p.tile]);
    if (p.kind === "rebuild") rebuild(s, r);
    else if (p.kind === "float") r.floatUntil = t + FLOAT_MS;
    else shock(s, r, t);
  }
  // Bigger games tear the floor up faster, so power-ups come more often.
  const big = s.ids.length > 4;
  if (t < s.powerAt || s.powers.length >= MAX_POWERS + (big ? 1 : 0)) return;
  // A solid tile inside the safe zone, not right under anybody.
  const ok = b.tiles
    .map((h, i) => ({ h, i }))
    .filter(
      ({ h, i }) =>
        s.tiles[i] === 0 &&
        !s.crackAt[i] &&
        h.d < s.ring - 1 &&
        !s.powers.some((p) => p.tile === i) &&
        s.runners.every((r) => !r.alive || Math.hypot(r.x - h.x, r.y - h.y) > 90),
    );
  s.powerAt = t + (big ? POWER_EVERY_MS * 0.7 : POWER_EVERY_MS);
  if (!ok.length) return;
  const pick = ok[Math.floor(ctx.random() * ok.length)];
  s.powers.push({ kind: POWER_KINDS[Math.floor(ctx.random() * POWER_KINDS.length)], tile: pick.i });
}

/** One fixed physics step at sim time t. Returns how many players fell. */
function substep(s: LavaState, ctx: GameCtx, t: number): number {
  const decided = s.phase !== "fight";
  const live = s.runners.filter((r) => r.alive);
  for (const r of live) moveRunner(s, r, decided ? BRAKE_FRICTION : FRICTION, !decided);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      // A jumper sails over people on the ground.
      if (airborne(s, live[i]) !== airborne(s, live[j])) continue;
      collide(s, live[i], live[j], t);
    }
  }
  if (decided) return 0;
  collapseStep(s, ctx, t);
  crackStep(s, t);
  const fell = floorStep(s, t);
  powerStep(s, ctx, t);
  return fell;
}

function simulate(s: LavaState, ctx: GameCtx): number {
  if (!s.fightAt) return 0;
  const target = Math.floor(((ctx.now() - s.fightAt) * SUBSTEPS) / TICK_MS);
  let n = target - s.steps;
  if (n > MAX_CATCHUP) {
    s.steps = target - MAX_CATCHUP;
    n = MAX_CATCHUP;
  }
  let fell = 0;
  for (let i = 0; i < n; i++) {
    s.steps += 1;
    releaseInputs(s, s.steps);
    fell += substep(s, ctx, simTime(s));
  }
  return fell;
}

// ---------- inputs ----------

function setStick(r: Runner, x: number, y: number) {
  r.ix = x;
  r.iy = y;
  const m = Math.hypot(x, y);
  if (m > 0.05) {
    r.fx = x / m;
    r.fy = y / m;
  }
}

/** Inputs whose stamped substep has come (in the order they were sent). */
function releaseInputs(s: LavaState, k: number) {
  for (const r of s.runners) {
    while (r.queue.length && r.queue[0].k <= k) {
      const q = r.queue.shift()!;
      if (q.jump) r.jumpQueued = r.alive && s.phase === "fight";
      else setStick(r, q.x, q.y);
    }
  }
}

/**
 * An input meant for substep `k`. Early: it waits for its substep. Due or late: it takes effect
 * from the next substep, plus (stick only, at most MAX_REWIND_STEPS) the difference it would have
 * made had it arrived on time. Returns the sim time it counts from.
 */
function stampedInput(s: LavaState, r: Runner, k: number, jump: boolean, x: number, y: number): number {
  const next = s.steps + 1;
  if (k > next && r.queue.length < MAX_QUEUE) {
    const at = Math.min(k, next + MAX_HOLD_STEPS);
    r.queue.push({ k: at, jump, x, y });
    return s.fightAt + at * SUB_MS;
  }
  for (const q of r.queue.splice(0)) {
    if (q.jump) r.jumpQueued = r.alive && s.phase === "fight";
    else setStick(r, q.x, q.y);
  }
  if (jump) {
    r.jumpQueued = r.alive && s.phase === "fight";
    return s.fightAt + next * SUB_MS;
  }
  const live = r.alive && s.phase === "fight";
  const back = live ? Math.max(0, Math.min(MAX_REWIND_STEPS, next - k)) : 0;
  if (back > 0) {
    const d = rewindDelta(back, x - r.ix, y - r.iy, airborne(s, r));
    r.x += d.x;
    r.y += d.y;
    r.vx += d.vx;
    r.vy += d.vy;
  }
  setStick(r, x, y);
  return s.fightAt + (next - back) * SUB_MS;
}

// ---------- snapshots ----------

function makeSnap(s: LavaState, ctx: GameCtx): Snap {
  const t = s.fightAt ? simTime(s) : ctx.now();
  const p: PlayerTuple[] = [];
  for (const r of s.runners) {
    if (!r.alive) continue;
    let flags = 0;
    if (r.floatUntil > t) flags |= F_FLOAT;
    if (r.floatUntil > t && r.floatUntil - t < FLOAT_WARN_MS) flags |= F_FLOAT_LOW;
    if (!connected(ctx, r.id)) flags |= F_OFFLINE;
    const cd = s.fightAt ? Math.max(0, Math.min(JUMP_CD_STEPS, r.jumpStep + JUMP_CD_STEPS - s.steps)) : 0;
    const tuple: PlayerTuple = [r.slot, Math.round(r.x), Math.round(r.y), Math.round(r.vx), Math.round(r.vy)];
    // The stick lets clients dead-reckon this player until the next frame (left off when centred).
    const steering = s.phase === "fight" && (r.ix !== 0 || r.iy !== 0);
    if (flags || cd || steering) tuple.push(flags);
    if (cd || steering) tuple.push(cd);
    if (steering) tuple.push(encodeStick(r.ix, r.iy));
    p.push(tuple);
  }
  // [slot, input number, ms from this frame to when it takes effect, ms from this frame to when it arrived]
  const acks: [number, number, number, number][] = [];
  for (const r of s.runners) {
    for (const [seq, eff, arr] of r.acks) acks.push([r.slot, seq, eff ? Math.round(eff - t) : 0, Math.round(arr - t)]);
    r.acks.length = 0;
  }
  const snap: Snap = {
    k: "s",
    n: s.round,
    t: Math.round(t),
    p,
    u: s.powers.map((pw) => [POWER_KINDS.indexOf(pw.kind), pw.tile]),
  };
  if (s.changes.length) snap.c = s.changes;
  if (s.fx.length) snap.fx = s.fx;
  if (acks.length) snap.a = acks;
  s.changes = [];
  s.fx = [];
  return snap;
}

function sameFrame(a: Snap, b: Snap) {
  if (b.fx || b.a || b.c || a.p.length !== b.p.length || a.u.length !== b.u.length) return false;
  for (let i = 0; i < a.u.length; i++) if (a.u[i][0] !== b.u[i][0] || a.u[i][1] !== b.u[i][1]) return false;
  for (let i = 0; i < a.p.length; i++) {
    const x = a.p[i];
    const y = b.p[i];
    if (x.length !== y.length) return false;
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return false;
  }
  return true;
}

// ---------- match flow ----------

function playerName(ctx: GameCtx, id: string) {
  return ctx.player(id)?.name ?? ctx.players.find((p) => p.id === id)?.name ?? "Someone";
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function winsRecord(s: LavaState): Record<string, number> {
  return Object.fromEntries(s.ids.map((id, i) => [id, s.wins[i]]));
}

function finishMatch(s: LavaState, ctx: GameCtx, winners: string[], how: "won" | "forfeit" | "abandoned") {
  if (s.phase === "final") return;
  s.phase = "final";
  s.endsAt = 0;
  s.powers = [];
  s.champions = winners.slice();
  for (const r of s.runners) r.jumpQueued = false;
  const names = winners.map((id) => playerName(ctx, id));
  let headline: string;
  if (how === "abandoned") headline = "Floor is Lava is over: everyone left the arena";
  else if (how === "forfeit" && names.length === 1) headline = `${names[0]} survives the lava: everyone else left`;
  else if (!names.length) headline = "The lava wins: nobody took a round";
  else if (names.length === 1) headline = `${names[0]} is the last one standing on the lava`;
  else headline = `${joinNames(names)} share the lava crown`;
  ctx.end({ winners: winners.slice(), headline, scores: winsRecord(s) });
}

function finishRound(s: LavaState, ctx: GameCtx, winner: Runner | null) {
  s.lastWinner = winner ? winner.id : null;
  s.history.push({ winner: s.lastWinner, order: s.falls.map((f) => f.s) });
  s.powers = [];
  if (winner) s.wins[winner.slot] += 1;
  if (winner && s.wins[winner.slot] >= s.winsNeeded) return finishMatch(s, ctx, [winner.id], "won");
  if (s.round >= s.maxRounds) return finishMatch(s, ctx, topScorers(winsRecord(s)), "won");
  s.phase = "roundOver";
  s.endsAt = ctx.now() + ROUND_OVER_MS;
}

function checkRoundEnd(s: LavaState, ctx: GameCtx): boolean {
  if (s.phase !== "fight") return false;
  const alive = s.runners.filter((r) => r.alive);
  if (alive.length > 1) return false;
  finishRound(s, ctx, alive[0] ?? null);
  return true;
}

function checkAlone(s: LavaState, ctx: GameCtx): boolean {
  const online = s.ids.filter((id) => connected(ctx, id));
  const now = ctx.now();
  if (online.length >= 2) {
    if (s.aloneSince === null) return false;
    s.aloneSince = null;
    return true;
  }
  if (s.aloneSince === null) {
    s.aloneSince = now;
    return true;
  }
  if (now - s.aloneSince < ABANDON_MS) return false;
  if (online.length === 1) finishMatch(s, ctx, online, "forfeit");
  else finishMatch(s, ctx, topScorers(winsRecord(s)), "abandoned");
  return true;
}

function advance(s: LavaState, ctx: GameCtx): boolean {
  const now = ctx.now();
  if (s.phase === "final") {
    simulate(s, ctx);
    return false;
  }
  let changed = checkAlone(s, ctx);
  switch (s.phase) {
    case "countdown":
      if (now < s.endsAt) return changed;
      s.phase = "fight";
      s.fightAt = now;
      s.steps = 0;
      s.endsAt = 0;
      s.powerAt = now + POWER_FIRST_MS;
      for (const r of s.runners) r.tileSince = now;
      return true;
    case "fight":
      if (simulate(s, ctx) > 0) s.viewDue = true;
      if (checkRoundEnd(s, ctx)) changed = true;
      return changed;
    case "roundOver":
      simulate(s, ctx);
      if (now < s.endsAt) return changed;
      s.round += 1;
      startRound(s, ctx);
      return true;
  }
}

// ---------- view ----------

function buildView(s: LavaState): LavaView {
  return {
    phase: s.phase,
    round: s.round,
    R: s.R,
    winsNeeded: s.winsNeeded,
    maxRounds: s.maxRounds,
    collapseMs: s.collapseMs,
    endsAt: s.endsAt,
    fightAt: s.fightAt,
    ids: s.ids.slice(),
    wins: s.wins.slice(),
    kos: s.kos.slice(),
    falls: s.falls.map((f) => ({ ...f })),
    history: s.history.map((h) => ({ winner: h.winner, order: h.order.slice() })),
    lastWinner: s.lastWinner,
    champions: s.champions ? s.champions.slice() : null,
    abandonAt: s.aloneSince === null || s.phase === "final" ? null : s.aloneSince + ABANDON_MS,
    board: s.tiles.join(""),
    snap: s.snap,
  };
}

const viewCache = new WeakMap<LavaState, { rev: number; snap: Snap; view: LavaView }>();

// ---------- action validation ----------

function readInput(a: Record<string, unknown>): [number, number] | null {
  const { x, y } = a;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < -100 || x > 100 || y < -100 || y > 100) return null;
  const m = Math.hypot(x, y);
  const k = m > 100 ? 100 / m : 1;
  return [(x * k) / 100, (y * k) / 100];
}

// ---------- practice bots ----------
// A bot reads only what everyone sees (positions, tile stages, power-ups, the crumble timer) and
// steers like a person would: a fresh look every 150-350 ms, aim a bit off, jump single gaps.

interface BotMem {
  next: number;
  x: number;
  y: number;
}

const botMemory = new WeakMap<LavaState, Map<string, BotMem>>();
const BOT_DIRS = Array.from({ length: 16 }, (_, k) => [Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8)] as const);
const BOT_LOOK = [
  [18, 1.2],
  [40, 1],
  [75, 0.8],
  [120, 0.5],
] as const;

/** How good it is to be standing at (x, y) soon. */
function botTileScore(s: LavaState, b: Board, x: number, y: number, edgeSoon: boolean): number {
  const i = tileAt(b, x, y);
  if (i < 0 || s.tiles[i] === GONE) return -100;
  const h = b.tiles[i];
  let v = -h.d * (edgeSoon ? 4 : 1);
  if (s.tiles[i] > 0) v -= 25 + s.tiles[i] * 10;
  // Open floor beats a lonely tile with holes all round.
  for (const nb of b.near[i]) if (s.tiles[nb] === 0) v += 4;
  if (h.d >= s.ring || (edgeSoon && h.d >= s.ring - 1)) v -= 45;
  if (s.powers.some((p) => p.tile === i)) v += 12;
  return v;
}

function botAction(s: LavaState, botId: string, ctx: GameCtx): LavaAction | null {
  const slot = s.ids.indexOf(botId);
  if (slot < 0 || s.phase === "final") return null;
  const r = s.runners[slot];
  let mems = botMemory.get(s);
  if (!mems) botMemory.set(s, (mems = new Map()));
  let m = mems.get(botId);
  if (!m) mems.set(botId, (m = { next: 0, x: 0, y: 0 }));
  const send = (x: number, y: number): LavaAction | null => {
    if (x === m.x && y === m.y) return null;
    m.x = x;
    m.y = y;
    return { type: "input", x, y };
  };
  if (s.phase !== "fight" || !r.alive || !s.fightAt) return send(0, 0);
  const now = ctx.now();
  const b = board(s.R);
  const t = simTime(s);
  const edgeSoon = t - s.fightAt > s.collapseMs - 2_500;
  const sp = Math.hypot(r.vx, r.vy);

  // Jump a single gap right ahead (the way the stick points, which is where a jump goes)
  // when there's floor on the other side.
  const ready = s.steps - r.jumpStep >= JUMP_CD_STEPS && !airborne(s, r) && !r.jumpQueued && r.floatUntil <= t;
  const stick = Math.hypot(r.ix, r.iy);
  if (ready && sp > 60 && stick > 0.5 && (r.vx * r.ix + r.vy * r.iy) / (sp * stick) > 0.6) {
    const ux = r.ix / stick;
    const uy = r.iy / stick;
    const near = tileAt(b, r.x + ux * 38, r.y + uy * 38);
    const far = botTileScore(s, b, r.x + ux * 115, r.y + uy * 115, edgeSoon);
    if ((near < 0 || s.tiles[near] === GONE) && far > -60) return { type: "jump" };
  }
  if (now < m.next) return null;
  m.next = now + 120 + ctx.random() * 160;

  // Score 16 directions by the floor along them, favouring the way we're already going.
  let best = -Infinity;
  let bx = 0;
  let by = 0;
  const target = s.powers.length ? b.tiles[s.powers[0].tile] : null;
  // Plan from where momentum is already carrying us.
  const ox = r.x + r.vx * 0.2;
  const oy = r.y + r.vy * 0.2;
  const rivals = s.runners.filter((o) => o.alive && o !== r);
  for (const [dx, dy] of BOT_DIRS) {
    let v = 0;
    for (const [dist, w] of BOT_LOOK) {
      const px = ox + dx * dist;
      const py = oy + dy * dist;
      v += w * botTileScore(s, b, px, py, edgeSoon);
      // Crowds mean bumps, and bumps mean lava.
      for (const o of rivals) if (Math.hypot(o.x - px, o.y - py) < 70) v -= 12 * w;
    }
    v += (dx * m.x + dy * m.y) / 100 * 8;
    if (target) {
      const tx = target.x - r.x;
      const ty = target.y - r.y;
      const tm = Math.hypot(tx, ty);
      if (tm < 260 && tm > 1) v += ((dx * tx + dy * ty) / tm) * 10;
    }
    v += ctx.random() * 8;
    if (v > best) {
      best = v;
      bx = dx;
      by = dy;
    }
  }
  // Slightly off aim, like a thumb on a stick.
  const wobble = (ctx.random() - 0.5) * 0.3;
  const c = Math.cos(wobble);
  const sn = Math.sin(wobble);
  return send(Math.round((bx * c - by * sn) * 100), Math.round((bx * sn + by * c) * 100));
}

// ---------- game definition ----------

export const lava: GameDef<LavaState, LavaAction> = {
  id: "lava",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const R = arenaRadius(ids.length);
    const set = readSettings(config.settings, ctx.settings);
    const winsNeeded = set.wins as number;
    const s: LavaState = {
      ids,
      R,
      winsNeeded,
      // 3 wins -> 7 rounds at most (the original match length).
      maxRounds: winsNeeded * 2 + 1,
      collapseMs: set.crumble as number,
      phase: "countdown",
      round: 1,
      endsAt: 0,
      fightAt: 0,
      steps: 0,
      runners: ids.map((id, slot) => newRunner(slot, id)),
      tiles: [],
      crackAt: [],
      cracking: [],
      ring: R + 1,
      powers: [],
      powerAt: 0,
      wins: ids.map(() => 0),
      kos: ids.map(() => 0),
      falls: [],
      history: [],
      lastWinner: null,
      champions: null,
      aloneSince: null,
      snap: { k: "s", n: 1, t: ctx.now(), p: [], u: [] },
      changes: [],
      fx: [],
      sent: null,
      sentAt: 0,
      quiet: false,
      rev: 0,
      viewDue: false,
      viewAt: 0,
    };
    startRound(s, ctx);
    s.snap = makeSnap(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.phase === "final") return false;
    const a: unknown = action;
    if (!a || typeof a !== "object" || Array.isArray(a)) return false;
    const slot = s.ids.indexOf(playerId);
    if (slot < 0) return false;
    const r = s.runners[slot];
    const rec = a as Record<string, unknown>;
    const seq = rec.s;
    if (seq !== undefined && !(typeof seq === "number" && Number.isInteger(seq) && seq > 0 && seq <= 2 ** 31)) return false;
    const at = rec.at;
    if (at !== undefined && !(typeof at === "number" && Number.isFinite(at))) return false;
    const live = s.phase === "fight" && s.fightAt > 0;
    // The substep it is meant for: as stamped, else the next one (older clients).
    const k = live && typeof at === "number" ? stampStep(at, s.fightAt) : s.steps + 1;
    const now = ctx.now();
    const ack = (from: number) => {
      if (typeof seq !== "number") return;
      r.seq = seq;
      if (r.acks.length < 32) r.acks.push([seq, from, now]);
    };
    if (rec.type === "input") {
      const v = readInput(rec);
      if (!v) return false;
      if (live) ack(stampedInput(s, r, k, false, v[0], v[1]));
      else {
        setStick(r, v[0], v[1]);
        ack(0);
      }
      return false;
    }
    if (rec.type === "jump") {
      // Acknowledged even when refused (as of the next substep), so the client stops predicting it.
      const refused = s.fightAt ? s.fightAt + (s.steps + 1) * SUB_MS : 0;
      if (!live || !r.alive || r.jumpQueued || r.queue.some((q) => q.jump)) {
        ack(refused);
        return false;
      }
      // A press up to 3 substeps before the cooldown is over waits for it (clocks differ a hair).
      const steps = Math.max(Math.floor(((now - s.fightAt) * SUBSTEPS) / TICK_MS), k - 1);
      if (steps + 3 < r.jumpStep + JUMP_CD_STEPS) {
        ack(refused);
        return false;
      }
      ack(stampedInput(s, r, k, true, 0, 0));
      return false;
    }
    return false;
  },

  tick(s, ctx) {
    const big = advance(s, ctx);
    if (big || (s.viewDue && ctx.now() - s.viewAt >= VIEW_MIN_MS)) {
      // The view (with a fresh snapshot) goes to everyone instead of an event.
      s.viewDue = false;
      s.viewAt = ctx.now();
      s.rev += 1;
      s.snap = makeSnap(s, ctx);
      s.sent = s.snap;
      s.sentAt = ctx.now();
      s.quiet = false;
      return true;
    }
    if (s.phase === "countdown") return false;
    const snap = makeSnap(s, ctx);
    s.snap = snap;
    const now = ctx.now();
    if (s.sent && sameFrame(s.sent, snap) && now - s.sentAt < HEARTBEAT_MS) {
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
    const hit = viewCache.get(s);
    if (hit && hit.rev === s.rev && hit.snap === s.snap) return hit.view;
    const view = buildView(s);
    viewCache.set(s, { rev: s.rev, snap: s.snap, view });
    return view;
  },

  playerLeft(s, playerId, ctx) {
    const slot = s.ids.indexOf(playerId);
    if (slot < 0) return;
    const r = s.runners[slot];
    r.ix = 0;
    r.iy = 0;
    r.jumpQueued = false;
    checkAlone(s, ctx);
    s.snap = makeSnap(s, ctx);
    s.rev += 1;
  },

  playerReturned(s, playerId, ctx) {
    if (s.ids.indexOf(playerId) < 0) return;
    checkAlone(s, ctx);
    s.snap = makeSnap(s, ctx);
    s.rev += 1;
  },
};

export default lava;
