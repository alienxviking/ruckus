import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
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
  rinkRadius,
  encodeStick,
  HIT_FX_MIN,
  type DiscTuple,
  type FxTuple,
  type Phase,
  type PowerKind,
  type Snap,
} from "./shared";
import {
  BRAKE_FRICTION,
  DASH_IMPULSE,
  FRICTION,
  MAX_REWIND_STEPS,
  SUB_MS,
  applyDash,
  integrate,
  keepOnIce,
  resolveContact,
  rewindDelta,
  stampStep,
} from "./physics";

// Ice Sumo: real-time shoving on a shrinking ice rink (Ruckus original).
// The server owns the physics: 3 fixed substeps of 1/60s per 50ms tick, driven by
// the clock (so a late tick catches up instead of slowing the game down). Every
// tick it sends everyone a compact snapshot event and returns false; the full view
// only goes out when something big happens (a phase change or someone falling in).
// Nothing is secret, so every viewer gets the same view.
//
// Latency: each input may carry a number (`s`) and the sim time it is meant for (`at`, stamped
// by the client a network trip ahead on its smoothed clock). An input that arrives early waits
// for its substep, so the server moves the disc exactly as the client already showed it; one that
// arrives late is applied at once, as if it had arrived on time but at most ~150 ms back (that
// player's own stick or dash only: nobody else is rewound), so a jittery uplink doesn't drag the
// disc off the path its owner saw. The next snapshot acknowledges every input with the sim time
// it takes effect from and when it arrived (`a`), so the client replays its inputs with exactly
// the server's timing and learns how far ahead to stamp. Motion and collisions are shared code
// (physics.ts): the client predicts the whole rink, contacts included.

// ---------- tuning ----------

/** A collision this hard counts as a shove for knockout credit. */
const SHOVE_MIN = 50;
/** A fall within this long after a shove credits the shover. */
const KO_WINDOW_MS = 3_000;
/** A tick never simulates more than this many substeps (a stalled server skips ahead). */
const MAX_CATCHUP = 6;
/** Even when nothing moves, a snapshot goes out this often. */
const HEARTBEAT_MS = 1_000;
const MAX_FX = 16;
/** An early input waits at most this many substeps (1 s) for its stamp. */
const MAX_HOLD_STEPS = 60;
const MAX_QUEUE = 16;

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
  /** Newest input number received from the owner (0 = none). */
  seq: number;
  /** Inputs waiting for their stamped substep. */
  queue: Queued[];
  /** Inputs the next snapshot acknowledges: [input number, sim time it takes effect (0 = n/a), time it arrived]. */
  acks: [number, number, number][];
}

interface Queued {
  /** Substep it takes effect in. */
  k: number;
  dash: boolean;
  x: number;
  y: number;
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
  /** Round wins that make a champion (host setting). */
  winsNeeded: number;
  /** The match ends after this many rounds even if nobody got there. */
  maxRounds: number;
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

/** `s` numbers the client's inputs (optional): the next snapshot acknowledges it. */
export type SumoAction = { type: "input"; x: number; y: number; s?: number; at?: number } | { type: "dash"; s?: number; at?: number };

export interface SumoView {
  phase: Phase;
  round: number;
  winsNeeded: number;
  maxRounds: number;
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
    seq: 0,
    queue: [],
    acks: [],
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

/** Resolve one disc-disc contact. Exported for tests. */
export function collide(s: SumoState, a: Disc, b: Disc, t: number) {
  const ra = radiusOf(a, t);
  // Push apart and bounce (physics.ts); exactly on top of each other, split along a's facing.
  const c = resolveContact(a, b, ra, radiusOf(b, t), massOf(a, t), massOf(b, t), a.fx, a.fy);
  if (!c || c.j <= 0) return; // apart, or already separating
  const { j, nx, ny } = c;
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
    const [ux, uy] = applyDash(d, d.ix, d.iy, d.fx, d.fy);
    d.fx = ux;
    d.fy = uy;
    d.dashUntil = t + DASH_FX_MS;
    pushFx(s, [FX_DASH, d.slot, Math.round(ux * 100), Math.round(uy * 100)]);
  }
  integrate(d, d.ix, d.iy, d.heavyUntil > t, friction, steer);
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
    releaseInputs(s, s.steps);
    fell += substep(s, ctx, simTime(s));
  }
  return fell;
}

// ---------- inputs ----------

function setStick(d: Disc, x: number, y: number) {
  d.ix = x;
  d.iy = y;
  const m = Math.hypot(x, y);
  if (m > 0.05) {
    d.fx = x / m;
    d.fy = y / m;
  }
}

/** Inputs whose stamped substep has come (in the order they were sent). */
function releaseInputs(s: SumoState, k: number) {
  for (const d of s.discs) {
    while (d.queue.length && d.queue[0].k <= k) {
      const q = d.queue.shift()!;
      if (q.dash) {
        if (d.alive && s.phase === "fight") d.dashQueued = true;
      } else setStick(d, q.x, q.y);
    }
  }
}

/**
 * An input meant for substep `k`. Early: it waits for its substep. Due or late: it takes effect
 * from the next substep, plus (for at most MAX_REWIND_STEPS) the difference it would have made had
 * it arrived on time: the bounded lag compensation, for this disc only. Returns the sim time it
 * counts from (what the owner's replay uses).
 */
function stampedInput(s: SumoState, d: Disc, k: number, dash: boolean, x: number, y: number): number {
  const next = s.steps + 1;
  if (k > next && d.queue.length < MAX_QUEUE) {
    const at = Math.min(k, next + MAX_HOLD_STEPS);
    d.queue.push({ k: at, dash, x, y });
    return s.fightAt + at * SUB_MS;
  }
  // Due now (or late). Anything still queued before it goes first, in the order sent.
  for (const q of d.queue.splice(0)) {
    if (q.dash) d.dashQueued = d.alive && s.phase === "fight";
    else setStick(d, q.x, q.y);
  }
  const live = d.alive && s.phase === "fight";
  const back = live ? Math.max(0, Math.min(MAX_REWIND_STEPS, next - k)) : 0;
  const heavy = d.heavyUntil > simTime(s);
  if (dash) {
    if (!live) return s.fightAt + next * SUB_MS;
    d.dashQueued = true;
    if (back > 0) {
      // Where the dash would have carried the disc by now (the kick itself lands next substep).
      const probe = { x: 0, y: 0, vx: d.vx, vy: d.vy };
      const [ux, uy] = applyDash(probe, d.ix, d.iy, d.fx, d.fy);
      const r = rewindDelta(back, 0, 0, heavy, ux * DASH_IMPULSE, uy * DASH_IMPULSE);
      d.x += r.x;
      d.y += r.y;
    }
  } else {
    if (back > 0) {
      const r = rewindDelta(back, x - d.ix, y - d.iy, heavy);
      d.x += r.x;
      d.y += r.y;
      d.vx += r.vx;
      d.vy += r.vy;
    }
    setStick(d, x, y);
  }
  return s.fightAt + (next - back) * SUB_MS;
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
    // Trailing zeros (no flags, no cooldown) are left off: most frames, most discs.
    const tuple: DiscTuple = [d.slot, Math.round(d.x), Math.round(d.y), Math.round(d.vx), Math.round(d.vy)];
    // The stick lets clients dead-reckon this disc until the next frame (left off when centred).
    const steering = live && s.phase === "fight" && (d.ix !== 0 || d.iy !== 0);
    if (flags || cd || steering) tuple.push(flags);
    if (cd || steering) tuple.push(cd);
    if (steering) tuple.push(encodeStick(d.ix, d.iy));
    p.push(tuple);
  }
  // Inputs received since the last snapshot:
  // [slot, input number, ms from this frame to when it takes effect, ms from this frame to when it arrived].
  const acks: [number, number, number, number][] = [];
  for (const d of s.discs) {
    for (const [seq, eff, arr] of d.acks) acks.push([d.slot, seq, eff ? Math.round(eff - t) : 0, Math.round(arr - t)]);
    d.acks.length = 0;
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
  if (acks.length) snap.a = acks;
  s.fx = [];
  return snap;
}

/** Same picture as the last frame sent (nothing moved, nothing happened)? */
function sameFrame(a: Snap, b: Snap) {
  if (b.fx || b.a || a.r !== b.r || a.p.length !== b.p.length) return false;
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
  if (winner && s.wins[winner.slot] >= s.winsNeeded) return finishMatch(s, ctx, [winner.id], "won");
  if (s.round >= s.maxRounds) return finishMatch(s, ctx, topScorers(winsRecord(s)), "won");
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
    winsNeeded: s.winsNeeded,
    maxRounds: s.maxRounds,
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

// ---------- practice bot ----------

interface BotMem {
  /** Next time this bot reconsiders its stick. */
  next: number;
  /** Last stick it sent (a dash goes along the stick). */
  sx: number;
  sy: number;
  /** It decided to dash on the following decision (after aiming the stick). */
  dashNext: boolean;
}

const botMem = new WeakMap<SumoState, Map<string, BotMem>>();

/** Medium-skill bot: keeps off the edge, chases the nearest rival or the power-up, dashes when lined up. */
function botMove(s: SumoState, botId: string, ctx: GameCtx): SumoAction | null {
  const view = sumo.view(s, botId, ctx) as SumoView;
  if (view.phase !== "fight") return null;
  const slot = view.ids.indexOf(botId);
  const me = view.snap.p.find((p) => p[0] === slot);
  if (!me) return null;
  let mems = botMem.get(s);
  if (!mems) botMem.set(s, (mems = new Map()));
  let mem = mems.get(botId);
  if (!mem) mems.set(botId, (mem = { next: 0, sx: 0, sy: 0, dashNext: false }));
  const now = ctx.now();
  if (now < mem.next) return null;
  mem.next = now + 140 + ctx.random() * 160;

  const [, x, y, vx, vy, , cd = 0] = me;
  const r = view.snap.r;
  const stick = (dx: number, dy: number): SumoAction => {
    const m = Math.hypot(dx, dy) || 1;
    const jitter = (ctx.random() - 0.5) * 0.3;
    const ax = dx / m - (dy / m) * jitter;
    const ay = dy / m + (dx / m) * jitter;
    const k = 100 / (Math.hypot(ax, ay) || 1);
    mem.sx = Math.round(ax * k);
    mem.sy = Math.round(ay * k);
    return { type: "input", x: mem.sx, y: mem.sy };
  };

  // Where momentum takes it shortly: too close to the edge means get back to the middle first.
  const px = x + vx * 0.4;
  const py = y + vy * 0.4;
  if (Math.hypot(px - CENTER, py - CENTER) > r - DISC_R * 1.5 - 25) {
    mem.dashNext = false;
    return stick(CENTER - px, CENTER - py);
  }

  if (mem.dashNext) {
    mem.dashNext = false;
    // Only if the dash (along the stick) still won't carry it off the ice.
    const len = Math.hypot(mem.sx, mem.sy) || 1;
    const ex = x + (mem.sx / len) * 160;
    const ey = y + (mem.sy / len) * 160;
    if (cd === 0 && Math.hypot(ex - CENTER, ey - CENTER) < r - 30) return { type: "dash" };
  }

  // Nearest rival, led a little by its velocity.
  let best: { x: number; y: number; d: number } | null = null;
  for (const p of view.snap.p) {
    if (p[0] === slot) continue;
    const tx = p[1] + p[3] * 0.25;
    const ty = p[2] + p[4] * 0.25;
    const d = Math.hypot(tx - x, ty - y);
    if (!best || d < best.d) best = { x: tx, y: ty, d };
  }
  const u = view.snap.u;
  if (u !== 0) {
    const d = Math.hypot(u[1] - x, u[2] - y);
    if (!best || d < best.d * 0.8) return stick(u[1] - x, u[2] - y);
  }
  if (!best) return stick(CENTER - x, CENTER - y);
  // Come at the rival from the middle's side, so the shove sends it outward.
  const ox = best.x - CENTER;
  const oy = best.y - CENTER;
  const om = Math.hypot(ox, oy) || 1;
  const aimX = best.x - (ox / om) * (best.d > 160 ? 60 : 0);
  const aimY = best.y - (oy / om) * (best.d > 160 ? 60 : 0);
  if (best.d < 190 && cd === 0 && ctx.random() < 0.45) mem.dashNext = true;
  return stick(aimX - x, aimY - y);
}

// ---------- game definition ----------

export const sumo: GameDef<SumoState, SumoAction> = {
  id: "sumo",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const winsNeeded = Number(readSettings(config.settings, ctx.settings).wins);
    const s: SumoState = {
      ids,
      winsNeeded,
      // First to 3 means at most 7 rounds (the default), first to 5 at most 11.
      maxRounds: winsNeeded * 2 + 1,
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
    const seq = rec.s;
    if (seq !== undefined && !(typeof seq === "number" && Number.isInteger(seq) && seq > 0 && seq <= 2 ** 31)) return false;
    const at = rec.at;
    if (at !== undefined && !(typeof at === "number" && Number.isFinite(at))) return false;
    const live = s.phase === "fight" && s.fightAt > 0;
    // The substep the input is meant for: as stamped, else the next one (older clients).
    const k = live && typeof at === "number" ? stampStep(at, s.fightAt) : s.steps + 1;
    const now = ctx.now();
    /** Acknowledge the input number with the sim time it counts from (0: not in a fight). */
    const ack = (from: number) => {
      if (typeof seq !== "number") return;
      d.seq = seq;
      if (d.acks.length < 32) d.acks.push([seq, from, now]);
    };
    if (rec.type === "input") {
      const v = readInput(rec);
      if (!v) return false;
      if (live) ack(stampedInput(s, d, k, false, v[0], v[1]));
      else {
        setStick(d, v[0], v[1]);
        ack(0);
      }
      return false; // shows up in the next snapshot
    }
    if (rec.type === "dash") {
      // Acknowledged even when refused (as of the next substep, already in the past for the
      // client's replay), so the client stops predicting it.
      const refused = s.fightAt + (s.steps + 1) * SUB_MS;
      if (!live) {
        ack(s.fightAt ? refused : 0);
        return false;
      }
      if (!d.alive || d.dashQueued || d.queue.some((q) => q.dash) || now < d.dashReadyAt) {
        ack(refused);
        return false;
      }
      d.dashReadyAt = now + (d.turboUntil > now ? TURBO_CD_MS : DASH_CD_MS);
      ack(stampedInput(s, d, k, true, 0, 0));
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

  bot(s, botId, ctx) {
    return botMove(s, botId, ctx);
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
