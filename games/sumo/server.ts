import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import {
  ABANDON_MS,
  CENTER,
  COUNTDOWN_MS,
  DASH_CD_MS,
  DASH_FX_MS,
  DISC_R,
  F_DASH,
  F_HEAVY,
  F_OFFLINE,
  F_TURBO,
  FX_DASH,
  FX_FALL,
  FX_HIT,
  FX_MELT,
  FX_PICKUP,
  HEAVY_MASS,
  HEAVY_SCALE,
  MAX_ROUNDS,
  POWER_EVERY_MS,
  POWER_FIRST_MS,
  POWER_INFO,
  POWER_KINDS,
  POWER_REACH,
  RINK_R,
  ROUND_OVER_MS,
  SPAWN_R,
  SUBSTEPS,
  TICK_MS,
  TURBO_CD_MS,
  WINS_NEEDED,
  rinkRadius,
  type DiscTuple,
  type FxTuple,
  type Phase,
  type PowerKind,
  type Snap,
} from "./shared";

// Ice Sumo: real-time shoving on a shrinking ice rink (Ruckus original).
// The server owns the physics: 3 fixed substeps of 1/60s per 50ms tick, driven by
// the clock (so a late tick catches up instead of slowing the game down). Every
// tick it sends everyone a compact snapshot event and returns false; the full view
// only goes out when something big happens (a phase change or someone falling in).
// Nothing is secret, so every viewer gets the same view.

// ---------- tuning ----------

const SUB_MS = TICK_MS / SUBSTEPS;
const DT = SUB_MS / 1000;
/** Acceleration at full stick (units/s²). */
const ACCEL = 1000;
/** A heavy disc is a little slower off the mark. */
const HEAVY_ACCEL = 0.8;
/** Ice friction per substep. */
const FRICTION = 0.992;
const MAX_SPEED = 480;
/** Above MAX_SPEED (after a dash or a big hit) speed bleeds off at most this fast per substep. */
const OVERSPEED_KEEP = 0.95;
/** Absolute cap so nothing can ever explode. */
const HARD_SPEED = 1_600;
const DASH_IMPULSE = 650;
/** Restitution blends from soft (slow shoves) to bouncy (real hits). */
const E_SOFT = 0.35;
const E_BOUNCY = 1.15;
const E_SOFT_BELOW = 40;
const E_BOUNCY_ABOVE = 200;
/** Impacts at least this hard are shown (sparks, shake); softer ones are just shoving. */
const HIT_FX_MIN = 140;
/** A collision this hard counts as a shove for knockout credit. */
const SHOVE_MIN = 50;
/** A fall within this long after a shove credits the shover. */
const KO_WINDOW_MS = 3_000;
/** A tick never simulates more than this many substeps (a stalled server skips ahead). */
const MAX_CATCHUP = 6;
/** Even when nothing moves, a snapshot goes out this often. */
const HEARTBEAT_MS = 1_000;
const MAX_FX = 16;
/** Once a round is decided the survivors brake to a stop (and can't slide off any more). */
const BRAKE_FRICTION = 0.93;

// ---------- state ----------

interface Disc {
  slot: number;
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Stick input, magnitude <= 1. Kept across rounds (a held key keeps working). */
  ix: number;
  iy: number;
  /** Last direction the disc wanted to go (unit vector): a dash with no stick goes this way. */
  fx: number;
  fy: number;
  alive: boolean;
  dashReadyAt: number;
  dashUntil: number;
  dashQueued: boolean;
  heavyUntil: number;
  turboUntil: number;
  /** Who last shoved this disc, and when (knockout credit). */
  hitBy: number;
  hitAt: number;
}

interface Power {
  kind: PowerKind;
  x: number;
  y: number;
}

export interface FallRec {
  /** Slot that fell. */
  s: number;
  /** Slot that shoved them (-1 = slipped off on their own). */
  by: number;
  at: number;
}

export interface RoundRec {
  /** Round winner's player id, null for a draw. */
  winner: string | null;
  /** Slots in the order they fell this round. */
  order: number[];
}

export interface SumoState {
  /** Participants in join order; index = slot. */
  ids: string[];
  phase: Phase;
  round: number;
  /** Countdown / round-over deadline (0 otherwise). */
  endsAt: number;
  /** When this round's fight started (0 during the countdown). */
  fightAt: number;
  /** Physics substeps simulated since fightAt. */
  steps: number;
  /** Rink radius frozen when the round ended. */
  frozenR: number;
  discs: Disc[];
  power: Power | null;
  powerAt: number;
  wins: number[];
  kos: number[];
  falls: FallRec[];
  history: RoundRec[];
  lastWinner: string | null;
  champions: string[] | null;
  aloneSince: number | null;
  /** The newest snapshot (also carried by the view). */
  snap: Snap;
  /** Effects collected since the last snapshot. */
  fx: FxTuple[];
  /** Last snapshot actually sent, for skipping identical frames. */
  sent: Snap | null;
  sentAt: number;
  /** A tick was skipped since `sent` (the next frame carries q: 1). */
  quiet: boolean;
  rev: number;
}

export type SumoAction = { type: "input"; x: number; y: number } | { type: "dash" };

export interface SumoView {
  phase: Phase;
  round: number;
  endsAt: number;
  fightAt: number;
  ids: string[];
  wins: number[];
  kos: number[];
  /** Falls this round, oldest first. */
  falls: FallRec[];
  history: RoundRec[];
  /** Winner of the round that just ended (null = draw / none yet). */
  lastWinner: string | null;
  champions: string[] | null;
  /** The match ends at this time unless another player reconnects. */
  abandonAt: number | null;
  snap: Snap;
}

// ---------- helpers ----------

const radiusOf = (d: Disc, t: number) => (d.heavyUntil > t ? DISC_R * HEAVY_SCALE : DISC_R);
const massOf = (d: Disc, t: number) => (d.heavyUntil > t ? HEAVY_MASS : 1);
const simTime = (s: SumoState) => s.fightAt + s.steps * SUB_MS;
const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;

function currentRadius(s: SumoState, t: number) {
  return s.phase === "fight" ? rinkRadius(t - s.fightAt) : s.frozenR;
}

function pushFx(s: SumoState, fx: FxTuple) {
  if (s.fx.length < MAX_FX) s.fx.push(fx);
}

function newDisc(slot: number, id: string): Disc {
  return {
    slot,
    id,
    x: CENTER,
    y: CENTER,
    vx: 0,
    vy: 0,
    ix: 0,
    iy: 0,
    fx: 1,
    fy: 0,
    alive: true,
    dashReadyAt: 0,
    dashUntil: 0,
    dashQueued: false,
    heavyUntil: 0,
    turboUntil: 0,
    hitBy: -1,
    hitAt: 0,
  };
}

/** Evenly spaced on the spawn circle, in a shuffled order with a random rotation. */
function spawnDiscs(s: SumoState, ctx: GameCtx) {
  const n = s.discs.length;
  const order = shuffle(
    s.discs.map((d) => d.slot),
    ctx.random,
  );
  const spin = ctx.random() * Math.PI * 2;
  order.forEach((slot, i) => {
    const d = s.discs[slot];
    const a = spin + (i / Math.max(1, n)) * Math.PI * 2;
    d.x = CENTER + Math.cos(a) * SPAWN_R;
    d.y = CENTER + Math.sin(a) * SPAWN_R;
    d.vx = 0;
    d.vy = 0;
    d.fx = -Math.cos(a);
    d.fy = -Math.sin(a);
    d.alive = true;
    d.dashReadyAt = 0;
    d.dashUntil = 0;
    d.dashQueued = false;
    d.heavyUntil = 0;
    d.turboUntil = 0;
    d.hitBy = -1;
    d.hitAt = 0;
  });
}

function startRound(s: SumoState, ctx: GameCtx) {
  spawnDiscs(s, ctx);
  s.phase = "countdown";
  s.endsAt = ctx.now() + COUNTDOWN_MS;
  s.fightAt = 0;
  s.steps = 0;
  s.frozenR = RINK_R;
  s.power = null;
  s.powerAt = 0;
  s.falls = [];
  s.fx = [];
  s.lastWinner = null;
}

// ---------- physics ----------

function restitution(approach: number) {
  if (approach <= E_SOFT_BELOW) return E_SOFT;
  if (approach >= E_BOUNCY_ABOVE) return E_BOUNCY;
  return E_SOFT + ((approach - E_SOFT_BELOW) / (E_BOUNCY_ABOVE - E_SOFT_BELOW)) * (E_BOUNCY - E_SOFT);
}

/** Resolve one disc-disc contact. Exported for tests. */
export function collide(s: SumoState, a: Disc, b: Disc, t: number) {
  const ra = radiusOf(a, t);
  const rb = radiusOf(b, t);
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minD = ra + rb;
  if (dist >= minD) return;
  if (dist < 1e-6) {
    // Exactly on top of each other: split along the lower slot's facing.
    dx = a.fx || 1;
    dy = a.fy;
  }
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const ima = 1 / massOf(a, t);
  const imb = 1 / massOf(b, t);
  const sum = ima + imb;
  // Push apart so they no longer overlap (lighter disc moves more).
  const overlap = minD - dist;
  a.x -= (nx * overlap * ima) / sum;
  a.y -= (ny * overlap * ima) / sum;
  b.x += (nx * overlap * imb) / sum;
  b.y += (ny * overlap * imb) / sum;
  const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vrel >= 0) return; // already separating
  const approach = -vrel;
  const j = ((1 + restitution(approach)) * approach) / sum;
  a.vx -= j * ima * nx;
  a.vy -= j * ima * ny;
  b.vx += j * imb * nx;
  b.vy += j * imb * ny;
  if (j >= SHOVE_MIN) {
    a.hitBy = b.slot;
    a.hitAt = t;
    b.hitBy = a.slot;
    b.hitAt = t;
  }
  if (j >= HIT_FX_MIN) {
    pushFx(s, [FX_HIT, Math.round(a.x + nx * ra), Math.round(a.y + ny * ra), Math.round(j), a.slot, b.slot]);
  }
}

function moveDisc(s: SumoState, d: Disc, t: number, friction: number, steer: boolean) {
  if (d.dashQueued) {
    d.dashQueued = false;
    let ux = d.ix;
    let uy = d.iy;
    let m = Math.hypot(ux, uy);
    if (m < 0.15) {
      const sp = Math.hypot(d.vx, d.vy);
      if (sp > 40) [ux, uy, m] = [d.vx, d.vy, sp];
      else [ux, uy, m] = [d.fx, d.fy, 1];
    }
    ux /= m;
    uy /= m;
    d.vx += ux * DASH_IMPULSE;
    d.vy += uy * DASH_IMPULSE;
    d.fx = ux;
    d.fy = uy;
    d.dashUntil = t + DASH_FX_MS;
    pushFx(s, [FX_DASH, d.slot, Math.round(ux * 100), Math.round(uy * 100)]);
  }
  const moving = steer && (d.ix !== 0 || d.iy !== 0);
  if (moving) {
    const a = ACCEL * (d.heavyUntil > t ? HEAVY_ACCEL : 1) * DT;
    d.vx += d.ix * a;
    d.vy += d.iy * a;
  }
  d.vx *= friction;
  d.vy *= friction;
  const sp = Math.hypot(d.vx, d.vy);
  if (sp > MAX_SPEED) {
    const k = Math.min(HARD_SPEED, Math.max(MAX_SPEED, sp * OVERSPEED_KEEP)) / sp;
    d.vx *= k;
    d.vy *= k;
  } else if (!moving && sp < 3) {
    d.vx = 0;
    d.vy = 0;
  }
  d.x += d.vx * DT;
  d.y += d.vy * DT;
}

function keepOnIce(d: Disc, r: number) {
  const dx = d.x - CENTER;
  const dy = d.y - CENTER;
  const dist = Math.hypot(dx, dy);
  const lim = Math.max(0, r - 4);
  if (dist <= lim || dist === 0) return;
  const nx = dx / dist;
  const ny = dy / dist;
  d.x = CENTER + nx * lim;
  d.y = CENTER + ny * lim;
  const out = d.vx * nx + d.vy * ny;
  if (out > 0) {
    d.vx -= out * nx;
    d.vy -= out * ny;
  }
}

/** Off the edge? Records the fall (and knockout credit while the round is live). */
function checkFall(s: SumoState, d: Disc, t: number, r: number): boolean {
  if (Math.hypot(d.x - CENTER, d.y - CENTER) <= r && r > 0) return false;
  d.alive = false;
  d.dashQueued = false;
  const by = d.hitBy >= 0 && t - d.hitAt <= KO_WINDOW_MS ? d.hitBy : -1;
  pushFx(s, [FX_FALL, d.slot, Math.round(d.x), Math.round(d.y), Math.round(d.vx), Math.round(d.vy), by]);
  if (s.phase !== "fight") return false;
  if (by >= 0) s.kos[by] += 1;
  s.falls.push({ s: d.slot, by, at: Math.round(t) });
  return true;
}

function powerStep(s: SumoState, ctx: GameCtx, t: number, r: number) {
  if (s.phase !== "fight") return;
  const p = s.power;
  if (p) {
    if (Math.hypot(p.x - CENTER, p.y - CENTER) > r - 12) {
      // The edge caught up with it.
      pushFx(s, [FX_MELT, Math.round(p.x), Math.round(p.y)]);
      s.power = null;
      s.powerAt = t + POWER_EVERY_MS / 2;
      return;
    }
    for (const d of s.discs) {
      if (!d.alive || Math.hypot(d.x - p.x, d.y - p.y) > radiusOf(d, t) + POWER_REACH) continue;
      if (p.kind === "heavy") d.heavyUntil = t + POWER_INFO.heavy.ms;
      else d.turboUntil = t + POWER_INFO.turbo.ms;
      pushFx(s, [FX_PICKUP, d.slot, POWER_KINDS.indexOf(p.kind)]);
      s.power = null;
      s.powerAt = t + POWER_EVERY_MS;
      return;
    }
    return;
  }
  if (t < s.powerAt) return;
  // Somewhere comfortably inside where the rink will be a few seconds from now, away from discs.
  const reach = Math.max(0, Math.min(r, rinkRadius(t + POWER_EVERY_MS - s.fightAt)) * 0.72);
  if (reach < 30) return;
  for (let i = 0; i < 12; i++) {
    const a = ctx.random() * Math.PI * 2;
    const rr = Math.sqrt(ctx.random()) * reach;
    const x = CENTER + Math.cos(a) * rr;
    const y = CENTER + Math.sin(a) * rr;
    const clear = s.discs.every((d) => !d.alive || Math.hypot(d.x - x, d.y - y) > radiusOf(d, t) + POWER_REACH + 40);
    if (!clear && i < 11) continue;
    s.power = { kind: POWER_KINDS[ctx.random() < 0.5 ? 0 : 1], x, y };
    return;
  }
}

/** One fixed physics step at sim time `t`. Returns how many discs fell (counted ones). */
function substep(s: SumoState, ctx: GameCtx, t: number): number {
  const decided = s.phase !== "fight";
  const live = s.discs.filter((d) => d.alive);
  for (const d of live) moveDisc(s, d, t, decided ? BRAKE_FRICTION : FRICTION, !decided);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) collide(s, live[i], live[j], t);
  }
  const r = currentRadius(s, t);
  if (decided) {
    // The round winner teeters on the edge instead of falling in after winning.
    for (const d of live) keepOnIce(d, r);
    return 0;
  }
  let fell = 0;
  for (const d of live) if (checkFall(s, d, t, r)) fell += 1;
  powerStep(s, ctx, t, r);
  return fell;
}

/** Catch the physics up with the clock. Returns how many discs fell. */
function simulate(s: SumoState, ctx: GameCtx): number {
  if (!s.fightAt) return 0; // the match ended before a fight started
  const target = Math.floor(((ctx.now() - s.fightAt) * SUBSTEPS) / TICK_MS);
  let n = target - s.steps;
  if (n > MAX_CATCHUP) {
    s.steps = target - MAX_CATCHUP;
    n = MAX_CATCHUP;
  }
  let fell = 0;
  for (let i = 0; i < n; i++) {
    s.steps += 1;
    fell += substep(s, ctx, simTime(s));
  }
  return fell;
}

// ---------- snapshots ----------

function makeSnap(s: SumoState, ctx: GameCtx): Snap {
  const live = s.phase === "fight" || s.phase === "roundOver" || s.phase === "final";
  const t = live && s.fightAt ? simTime(s) : ctx.now();
  const now = ctx.now();
  const p: DiscTuple[] = [];
  for (const d of s.discs) {
    if (!d.alive) continue;
    let flags = 0;
    if (d.heavyUntil > t) flags |= F_HEAVY;
    if (d.turboUntil > t) flags |= F_TURBO;
    if (d.dashUntil > t) flags |= F_DASH;
    if (!connected(ctx, d.id)) flags |= F_OFFLINE;
    const cd = Math.max(0, Math.min(99, Math.ceil((d.dashReadyAt - now) / 100)));
    p.push([d.slot, Math.round(d.x), Math.round(d.y), Math.round(d.vx), Math.round(d.vy), flags, cd]);
  }
  const snap: Snap = {
    k: "s",
    n: s.round,
    t: Math.round(t),
    r: Math.round(currentRadius(s, t) * 10) / 10,
    p,
    u: s.power ? [POWER_KINDS.indexOf(s.power.kind), Math.round(s.power.x), Math.round(s.power.y)] : 0,
  };
  if (s.fx.length) snap.fx = s.fx;
  s.fx = [];
  return snap;
}

/** Same picture as the last frame sent (nothing moved, nothing happened)? */
function sameFrame(a: Snap, b: Snap) {
  if (b.fx || a.r !== b.r || a.p.length !== b.p.length) return false;
  if (a.u === 0 ? b.u !== 0 : b.u === 0 || a.u[0] !== b.u[0] || a.u[1] !== b.u[1] || a.u[2] !== b.u[2]) return false;
  for (let i = 0; i < a.p.length; i++) {
    const x = a.p[i];
    const y = b.p[i];
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

function winsRecord(s: SumoState): Record<string, number> {
  return Object.fromEntries(s.ids.map((id, i) => [id, s.wins[i]]));
}

function finishMatch(s: SumoState, ctx: GameCtx, winners: string[], how: "won" | "forfeit" | "abandoned") {
  if (s.phase === "final") return;
  if (s.phase === "fight") s.frozenR = currentRadius(s, simTime(s));
  s.phase = "final";
  s.endsAt = 0;
  s.power = null;
  s.champions = winners.slice();
  for (const d of s.discs) d.dashQueued = false;
  const names = winners.map((id) => playerName(ctx, id));
  let headline: string;
  if (how === "abandoned") headline = "Ice Sumo is over: everyone left the rink";
  else if (how === "forfeit" && names.length === 1)
    headline = `${names[0]} is the Ice Sumo champion: everyone else left`;
  else if (!names.length) headline = "Ice Sumo ends in a draw: nobody won a round";
  else if (names.length === 1) headline = `${names[0]} is the Ice Sumo champion`;
  else headline = `${joinNames(names)} share the Ice Sumo crown`;
  ctx.end({ winners: winners.slice(), headline, scores: winsRecord(s) });
}

function finishRound(s: SumoState, ctx: GameCtx, winner: Disc | null) {
  const now = ctx.now();
  s.frozenR = currentRadius(s, simTime(s));
  s.lastWinner = winner ? winner.id : null;
  s.history.push({ winner: s.lastWinner, order: s.falls.map((f) => f.s) });
  s.power = null;
  if (winner) s.wins[winner.slot] += 1;
  if (winner && s.wins[winner.slot] >= WINS_NEEDED) return finishMatch(s, ctx, [winner.id], "won");
  if (s.round >= MAX_ROUNDS) return finishMatch(s, ctx, topScorers(winsRecord(s)), "won");
  s.phase = "roundOver";
  s.endsAt = now + ROUND_OVER_MS;
}

function checkRoundEnd(s: SumoState, ctx: GameCtx): boolean {
  if (s.phase !== "fight") return false;
  const alive = s.discs.filter((d) => d.alive);
  if (alive.length > 1) return false;
  finishRound(s, ctx, alive[0] ?? null);
  return true;
}

/** Track "fewer than two players online"; ends the match once that lasts ABANDON_MS. */
function checkAlone(s: SumoState, ctx: GameCtx): boolean {
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

function advance(s: SumoState, ctx: GameCtx): boolean {
  const now = ctx.now();
  if (s.phase === "final") {
    // The discs brake to a stop (visual only; ticks stop shortly after the end).
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
      return true;
    case "fight":
      if (simulate(s, ctx) > 0) changed = true;
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

function buildView(s: SumoState): SumoView {
  return {
    phase: s.phase,
    round: s.round,
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
    snap: s.snap,
  };
}

/** Everyone sees the same thing, so a view is built once per change. */
const viewCache = new WeakMap<SumoState, { rev: number; snap: Snap; view: SumoView }>();

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

// ---------- game definition ----------

export const sumo: GameDef<SumoState, SumoAction> = {
  id: "sumo",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const s: SumoState = {
      ids,
      phase: "countdown",
      round: 1,
      endsAt: 0,
      fightAt: 0,
      steps: 0,
      frozenR: RINK_R,
      discs: ids.map((id, slot) => newDisc(slot, id)),
      power: null,
      powerAt: 0,
      wins: ids.map(() => 0),
      kos: ids.map(() => 0),
      falls: [],
      history: [],
      lastWinner: null,
      champions: null,
      aloneSince: null,
      snap: { k: "s", n: 1, t: ctx.now(), r: RINK_R, p: [], u: 0 },
      fx: [],
      sent: null,
      sentAt: 0,
      quiet: false,
      rev: 0,
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
    const d = s.discs[slot];
    const rec = a as Record<string, unknown>;
    if (rec.type === "input") {
      const v = readInput(rec);
      if (!v) return false;
      [d.ix, d.iy] = v;
      const m = Math.hypot(v[0], v[1]);
      if (m > 0.05) {
        d.fx = v[0] / m;
        d.fy = v[1] / m;
      }
      return false; // shows up in the next snapshot
    }
    if (rec.type === "dash") {
      if (s.phase !== "fight") return false;
      const now = ctx.now();
      if (!d.alive || d.dashQueued || now < d.dashReadyAt) return false;
      d.dashQueued = true;
      d.dashReadyAt = now + (d.turboUntil > now ? TURBO_CD_MS : DASH_CD_MS);
      return false;
    }
    return false;
  },

  tick(s, ctx) {
    if (advance(s, ctx)) {
      // Big moment: the view (with a fresh snapshot) goes to everyone instead of an event.
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
    const d = s.discs[slot];
    d.ix = 0;
    d.iy = 0;
    d.dashQueued = false;
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

export default sumo;
