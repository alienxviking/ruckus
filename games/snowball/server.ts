import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { TEAMS, splitTeams } from "../../shared/teams";
import { config } from "./config";
import {
  ABANDON_MS,
  AMMO,
  AMMO_PILE,
  BALL_R,
  BIG_KNOCK,
  BIG_R,
  COUNTDOWN_MS,
  END_FORT,
  END_GROUND,
  END_PLAYER,
  END_TREE,
  FIELDS,
  FIELD_COUNT,
  FORT_H,
  FORT_HP,
  FX_FORT,
  FX_OUT,
  FX_PICK,
  FX_PILE,
  HIT_H,
  KNOCK,
  MAX_RANGE,
  PILE_R,
  PILE_REGROW_MS,
  PLAYER_R,
  POWER_CHARGES,
  POWER_EVERY_MS,
  POWER_FIRST_MS,
  POWER_KINDS,
  POWER_R,
  RELOAD_MS,
  ROUND_CAP_MS,
  ROUND_OVER_MS,
  SUB_MS,
  SUBSTEPS,
  SUDDEN_MS,
  THROW_CD_MS,
  TICK_MS,
  TREE_CORE,
  TREE_H,
  WORLD_H,
  WORLD_W,
  aimPoint,
  encodePositions,
  flightAt,
  fortDistance,
  fortShape,
  inputDir,
  makeFlight,
  spreadPoint,
  stepBody,
  type BallTuple,
  type EndTuple,
  type Field,
  type Flight,
  type FxTuple,
  type Phase,
  type PowerKind,
  type Snap,
} from "./shared";

// Snowball Showdown: real-time snowball fights behind melting forts (Ruckus original).
//
// The server owns everything: walking (2 fixed substeps per 50 ms tick, driven by the clock so
// a late tick catches up), every snowball's flight and what it hits. Every tick it sends one
// compact snapshot event (positions, a few status digits, new snowballs and where snowballs
// stopped) and returns false; the full view only goes out on big moments (phase changes,
// knockouts, the blizzard). A snowball's flight is a pure function of its spawn data
// (shared.ts), so clients animate arcs themselves and never need per-tick ball positions.
// Nothing is secret, so every viewer gets the same view.

/** A tick never simulates more than this many substeps (a stalled server skips ahead). */
const MAX_CATCHUP = 8;
/** Even when nothing moves, a snapshot goes out this often. */
const HEARTBEAT_MS = 1_000;
const MAX_PENDING = 48;

// ---------- state ----------

interface Kid {
  slot: number;
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Stick input, magnitude <= 1. */
  ix: number;
  iy: number;
  /** Facing (unit vector): a throw with no direction goes this way. */
  fx: number;
  fy: number;
  hp: number;
  ammo: number;
  /** Sim time the next snowball reloads (0 = not reloading). */
  reloadAt: number;
  lastThrow: number;
  power: PowerKind | null;
  charges: number;
  alive: boolean;
}

interface Ball {
  id: number;
  slot: number;
  f: Flight;
  big: boolean;
}

export interface OutRec {
  /** Slot knocked out, by whom (-1 = nobody), and when. */
  s: number;
  by: number;
  at: number;
}

export interface RoundRec {
  /** Round winner's player id, null for a draw (and always null in team mode). */
  winner: string | null;
  /** Team mode: the team (0 Red, 1 Blue) that won the round, -1 for a draw. */
  team?: number;
  /** Slots in the order they were knocked out. */
  order: number[];
}

export interface SnowState {
  /** Participants in join order; index = slot. */
  ids: string[];
  /** Team mode (Red vs Blue): the two teams' player ids; null in solo mode. */
  teams: [string[], string[]] | null;
  /** Team index per slot (-1 in solo mode). */
  team: number[];
  /** Round wins per team (team mode only). */
  teamWins: [number, number];
  /** Team mode: the team that took the last round (null = draw / none yet). */
  lastTeam: number | null;
  /** Team mode: the team that won the match (null = none / draw). */
  champTeam: number | null;
  /** Host settings: round wins to take the match, rounds at most, and hearts per round. */
  winsNeeded: number;
  maxRounds: number;
  maxHp: number;
  phase: Phase;
  round: number;
  /** Countdown / round-over deadline (0 otherwise). */
  endsAt: number;
  fightAt: number;
  /** Substeps simulated since fightAt. */
  steps: number;
  /** Index into FIELDS for this round, and the first round's (rounds rotate through them). */
  field: number;
  firstField: number;
  kids: Kid[];
  forts: number[];
  /** Sim time each snow pile is ready again (0 = ready). */
  piles: number[];
  power: { kind: PowerKind; x: number; y: number } | null;
  powerAt: number;
  balls: Ball[];
  nextBall: number;
  sudden: boolean;
  wins: number[];
  hits: number[];
  kos: number[];
  outs: OutRec[];
  history: RoundRec[];
  lastWinner: string | null;
  champions: string[] | null;
  aloneSince: number | null;
  /** The newest snapshot (also carried by the view). */
  snap: Snap;
  /** Things that happened since the last snapshot. */
  pb: BallTuple[];
  pe: EndTuple[];
  pf: FxTuple[];
  /** pb/pe store absolute times until the snapshot makes them relative. */
  sent: Snap | null;
  sentAt: number;
  quiet: boolean;
  rev: number;
}

/**
 * x, y: stick direction (ints, -100..100). throw: the spot to land on (world ints; clamped to the
 * range). `s` numbers a throw so the thrower's predicted snowball can be matched or cancelled.
 */
export type SnowAction = { type: "in"; x: number; y: number } | { type: "throw"; x: number; y: number; s?: number };

export interface SnowView {
  phase: Phase;
  round: number;
  winsNeeded: number;
  maxRounds: number;
  /** Hearts each player starts a round with. */
  maxHp: number;
  endsAt: number;
  fightAt: number;
  field: number;
  ids: string[];
  /** Team mode (Red vs Blue): the two teams' player ids; null in solo mode. */
  teams: [string[], string[]] | null;
  /** Round wins per team (team mode). */
  teamWins: [number, number];
  /** Team mode: team that took the last round, and the team that won the match. */
  lastTeam: number | null;
  champTeam: number | null;
  wins: number[];
  hits: number[];
  kos: number[];
  /** Knockouts this round, oldest first. */
  outs: OutRec[];
  history: RoundRec[];
  lastWinner: string | null;
  champions: string[] | null;
  sudden: boolean;
  /** The match ends at this time unless another player reconnects. */
  abandonAt: number | null;
  snap: Snap;
}

// ---------- helpers ----------

const simTime = (s: SnowState) => s.fightAt + s.steps * SUB_MS;
const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const fieldOf = (s: SnowState): Field => FIELDS[s.field] ?? FIELDS[0];
const scratch = { x: 0, y: 0, h: 0, p: 0 };

function newKid(slot: number, id: string, maxHp: number): Kid {
  return {
    slot,
    id,
    x: WORLD_W / 2,
    y: WORLD_H / 2,
    vx: 0,
    vy: 0,
    ix: 0,
    iy: 0,
    fx: 1,
    fy: 0,
    hp: maxHp,
    ammo: AMMO,
    reloadAt: 0,
    lastThrow: 0,
    power: null,
    charges: 0,
    alive: true,
  };
}

/** Spread around the field's spawn ring, in a shuffled order with a random rotation. */
function spawnKids(s: SnowState, ctx: GameCtx) {
  const field = fieldOf(s);
  const n = s.kids.length;
  const ring = field.spawns.length;
  const order = shuffle(
    s.kids.map((k) => k.slot),
    ctx.random,
  );
  const rot = Math.floor(ctx.random() * ring);
  // Team mode: each team spreads over its own half of the ring, the two halves facing each other.
  const half = Math.floor(ring / 2);
  const spot = (slot: number, i: number) => {
    if (!s.teams) return (rot + Math.round((i * ring) / Math.max(1, n))) % ring;
    const t = s.team[slot];
    const mates = order.filter((o) => s.team[o] === t);
    const j = mates.indexOf(slot);
    const off = Math.min(half - 1, Math.round(((j + 0.5) * half) / mates.length - 0.5));
    return (rot + t * half + off) % ring;
  };
  order.forEach((slot, i) => {
    const k = s.kids[slot];
    const [x, y] = field.spawns[spot(slot, i)];
    const dx = WORLD_W / 2 - x;
    const dy = WORLD_H / 2 - y;
    const m = Math.hypot(dx, dy) || 1;
    Object.assign(k, {
      x,
      y,
      vx: 0,
      vy: 0,
      fx: dx / m,
      fy: dy / m,
      hp: s.maxHp,
      ammo: AMMO,
      reloadAt: 0,
      lastThrow: 0,
      power: null,
      charges: 0,
      alive: true,
    });
  });
}

function startRound(s: SnowState, ctx: GameCtx) {
  s.field = (s.firstField + s.round - 1) % FIELD_COUNT;
  const field = fieldOf(s);
  spawnKids(s, ctx);
  s.phase = "countdown";
  s.endsAt = ctx.now() + COUNTDOWN_MS;
  s.fightAt = 0;
  s.steps = 0;
  s.forts = field.forts.map(() => FORT_HP);
  s.piles = field.piles.map(() => 0);
  s.power = null;
  s.powerAt = 0;
  s.balls = [];
  s.sudden = false;
  s.outs = [];
  s.pb = [];
  s.pe = [];
  s.pf = [];
  s.lastWinner = null;
  s.lastTeam = null;
}

/** Same team (team mode only): teammates' snowballs fly straight through each other. */
const allies = (s: SnowState, a: number, b: number) => s.team[a] >= 0 && s.team[a] === s.team[b];

/** Teams (or solo players) with someone still standing. */
function sidesLeft(s: SnowState): number {
  if (!s.teams) return s.kids.filter((k) => k.alive).length;
  return new Set(s.kids.filter((k) => k.alive).map((k) => s.team[k.slot])).size;
}

function pushFx(s: SnowState, fx: FxTuple) {
  if (s.pf.length < MAX_PENDING) s.pf.push(fx);
}

// ---------- simulation ----------

function knockOut(s: SnowState, k: Kid, by: number, t: number) {
  k.alive = false;
  k.ix = 0;
  k.iy = 0;
  k.vx *= 0.4;
  k.vy *= 0.4;
  if (by >= 0 && by !== k.slot) s.kos[by] += 1;
  s.outs.push({ s: k.slot, by, at: Math.round(t) });
  pushFx(s, [FX_OUT, k.slot, by]);
}

/** Does snowball `b` hit something at sim time `t`? Returns true when it stopped. */
function ballStep(s: SnowState, b: Ball, t: number, live: boolean): boolean {
  const field = fieldOf(s);
  const at = flightAt(b.f, t, scratch);
  const br = b.big ? BIG_R : BALL_R;
  const end = (what: number, which: number) => {
    if (s.pe.length < MAX_PENDING) s.pe.push([b.id, Math.round(t), what, which]);
    return true;
  };
  if (at.h < HIT_H) {
    for (const k of s.kids) {
      if (!k.alive || k.slot === b.slot || allies(s, k.slot, b.slot)) continue;
      const dx = k.x - at.x;
      const dy = k.y - at.y;
      if (dx * dx + dy * dy > (PLAYER_R + br) ** 2) continue;
      // Knocked back along the throw.
      const ux = b.f.tx - b.f.x0;
      const uy = b.f.ty - b.f.y0;
      const m = Math.hypot(ux, uy) || 1;
      const push = b.big ? BIG_KNOCK : KNOCK;
      k.vx += (ux / m) * push;
      k.vy += (uy / m) * push;
      if (live) {
        k.hp = Math.max(0, k.hp - (b.big ? 2 : 1));
        s.hits[b.slot] += 1;
        if (k.hp <= 0) knockOut(s, k, b.slot, t);
      }
      return end(END_PLAYER, k.slot);
    }
  }
  if (at.h < FORT_H) {
    for (let i = 0; i < field.forts.length; i++) {
      const shape = fortShape(field.forts[i], s.forts[i]);
      if (!shape || fortDistance(shape, at.x, at.y) > br) continue;
      s.forts[i] = Math.max(0, s.forts[i] - (b.big ? 3 : 1));
      if (s.forts[i] === 0) pushFx(s, [FX_FORT, i]);
      return end(END_FORT, i);
    }
  }
  if (at.h < TREE_H) {
    for (let i = 0; i < field.trees.length; i++) {
      const tr = field.trees[i];
      const lim = tr.r * TREE_CORE + br;
      if ((tr.x - at.x) ** 2 + (tr.y - at.y) ** 2 <= lim * lim) return end(END_TREE, i);
    }
  }
  if (at.p >= 1) return end(END_GROUND, -1);
  return false;
}

/** One fixed step at sim time `t`. */
function substep(s: SnowState, ctx: GameCtx, t: number) {
  const field = fieldOf(s);
  const live = s.phase === "fight";
  const dt = SUB_MS / 1000;
  for (const k of s.kids) {
    const steer = k.alive && s.phase !== "final";
    stepBody(k, steer ? k.ix : 0, steer ? k.iy : 0, dt, field, s.forts);
    if (!k.alive) continue;
    // Reload.
    if (k.ammo >= AMMO) k.reloadAt = 0;
    else if (k.reloadAt === 0) k.reloadAt = t + RELOAD_MS;
    else if (t >= k.reloadAt) {
      k.ammo += 1;
      k.reloadAt = k.ammo < AMMO ? t + RELOAD_MS : 0;
    }
    if (!live) continue;
    // Snow piles.
    field.piles.forEach(([px, py], i) => {
      if (s.piles[i] > t || k.ammo >= AMMO_PILE) return;
      if ((k.x - px) ** 2 + (k.y - py) ** 2 > (PILE_R + PLAYER_R) ** 2) return;
      k.ammo = AMMO_PILE;
      k.reloadAt = 0;
      s.piles[i] = t + PILE_REGROW_MS;
      pushFx(s, [FX_PILE, k.slot, i]);
    });
    // Power-up.
    const p = s.power;
    if (p && (k.x - p.x) ** 2 + (k.y - p.y) ** 2 <= (PLAYER_R + POWER_R) ** 2) {
      k.power = p.kind;
      k.charges = POWER_CHARGES;
      pushFx(s, [FX_PICK, k.slot, POWER_KINDS.indexOf(p.kind)]);
      s.power = null;
      s.powerAt = t + POWER_EVERY_MS;
    }
  }
  // Players shoulder each other apart (no shoving physics: it's a snowball fight).
  const alive = s.kids.filter((k) => k.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = PLAYER_R * 2;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const ny = d > 1e-6 ? dy / d : 0;
      const o = (min - d) / 2;
      a.x -= nx * o;
      a.y -= ny * o;
      b.x += nx * o;
      b.y += ny * o;
    }
  }
  s.balls = s.balls.filter((b) => !ballStep(s, b, t, live));
  if (live) powerStep(s, ctx, t);
}

function powerStep(s: SnowState, ctx: GameCtx, t: number) {
  if (s.power || t < s.powerAt) return;
  const field = fieldOf(s);
  for (let i = 0; i < 16; i++) {
    const x = 120 + ctx.random() * (WORLD_W - 240);
    const y = 90 + ctx.random() * (WORLD_H - 180);
    const blocked =
      field.trees.some((tr) => Math.hypot(tr.x - x, tr.y - y) < tr.r + 30) ||
      field.forts.some((f, fi) => {
        const sh = fortShape(f, s.forts[fi]);
        return !!sh && fortDistance(sh, x, y) < 34;
      }) ||
      field.piles.some(([px, py]) => Math.hypot(px - x, py - y) < PILE_R + 30) ||
      s.kids.some((k) => k.alive && Math.hypot(k.x - x, k.y - y) < 90);
    if (blocked && i < 15) continue;
    s.power = { kind: POWER_KINDS[ctx.random() < 0.5 ? 0 : 1], x: Math.round(x), y: Math.round(y) };
    return;
  }
}

/** Catch the simulation up with the clock. */
function simulate(s: SnowState, ctx: GameCtx) {
  if (!s.fightAt) return;
  const target = Math.floor(((ctx.now() - s.fightAt) * SUBSTEPS) / TICK_MS);
  let n = target - s.steps;
  if (n > MAX_CATCHUP) {
    s.steps = target - MAX_CATCHUP;
    n = MAX_CATCHUP;
  }
  for (let i = 0; i < n; i++) {
    s.steps += 1;
    substep(s, ctx, simTime(s));
    if (s.phase === "fight" && sidesLeft(s) <= 1) break;
  }
}

// ---------- snapshots ----------

function powerDigit(k: Kid) {
  if (!k.power || k.charges <= 0) return 0;
  return (k.power === "big" ? 0 : 3) + Math.min(3, k.charges);
}

function makeSnap(s: SnowState, ctx: GameCtx): Snap {
  const t = s.fightAt ? simTime(s) : ctx.now();
  const xy: number[] = [];
  let st = "";
  for (const k of s.kids) {
    xy.push(k.x, k.y);
    st += `${k.hp}${Math.min(9, k.ammo)}${powerDigit(k)}`;
  }
  const snap: Snap = {
    k: "s",
    n: s.round,
    t: Math.round(t),
    p: encodePositions(xy),
    s: st,
    w: s.forts.map((h) => Math.max(0, Math.min(9, h))).join(""),
    c: s.piles.map((r) => (r <= t ? "1" : "0")).join(""),
  };
  if (s.power) snap.u = [POWER_KINDS.indexOf(s.power.kind), s.power.x, s.power.y];
  if (s.pb.length) snap.b = s.pb.map((b) => [b[0], b[1], b[2], b[3], b[4], b[5], b[6] - snap.t, b[7], b[8]]);
  if (s.pe.length) snap.e = s.pe.map((e) => [e[0], e[1] - snap.t, e[2], e[3]]);
  if (s.pf.length) snap.f = s.pf;
  s.pb = [];
  s.pe = [];
  s.pf = [];
  return snap;
}

/** Same picture as the last frame sent (nothing moved, nothing happened)? */
function sameFrame(a: Snap, b: Snap) {
  if (b.b || b.e || b.f) return false;
  if (a.p !== b.p || a.s !== b.s || a.w !== b.w || a.c !== b.c) return false;
  const ua = a.u ? a.u.join(",") : "";
  const ub = b.u ? b.u.join(",") : "";
  return ua === ub;
}

// ---------- match flow ----------

function playerName(ctx: GameCtx, id: string) {
  return ctx.player(id)?.name ?? ctx.players.find((p) => p.id === id)?.name ?? "Someone";
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function winsRecord(s: SnowState): Record<string, number> {
  return Object.fromEntries(s.ids.map((id, i) => [id, s.wins[i]]));
}

function teamHeadline(s: SnowState, team: number | null, how: "won" | "forfeit" | "abandoned") {
  const [r, b] = s.teamWins;
  if (how === "abandoned") return "Snowball Showdown is over: everyone went inside";
  if (team === null) return `${TEAMS[0].name} and ${TEAMS[1].name} draw the Showdown ${r}–${b}`;
  const other = TEAMS[1 - team].name;
  if (how === "forfeit") return `${TEAMS[team].name} team wins! ${other} went home`;
  const score = team === 0 ? `${r}–${b}` : `${b}–${r}`;
  return `${TEAMS[team].name} team wins ${score}! ❄️`;
}

/** Team mode: the whole team takes the match (team null = draw). */
function finishTeamMatch(s: SnowState, ctx: GameCtx, team: number | null, how: "won" | "forfeit" | "abandoned") {
  if (s.phase === "final" || !s.teams) return;
  s.champTeam = team;
  const winners = team === null ? [] : s.teams[team].slice();
  endMatch(s, ctx, winners, teamHeadline(s, team, how));
}

function endMatch(s: SnowState, ctx: GameCtx, winners: string[], headline: string) {
  s.phase = "final";
  s.endsAt = 0;
  s.power = null;
  s.champions = winners.slice();
  for (const k of s.kids) {
    k.ix = 0;
    k.iy = 0;
  }
  ctx.end({ winners: winners.slice(), headline, scores: winsRecord(s) });
}

/** Team with more round wins, or null when level. */
function leadingTeam(s: SnowState): number | null {
  const [r, b] = s.teamWins;
  return r === b ? null : r > b ? 0 : 1;
}

function finishMatch(s: SnowState, ctx: GameCtx, winners: string[], how: "won" | "forfeit" | "abandoned") {
  if (s.phase === "final") return;
  const names = winners.map((id) => playerName(ctx, id));
  let headline: string;
  if (how === "abandoned") headline = "Snowball Showdown is over: everyone went inside";
  else if (how === "forfeit" && names.length === 1) headline = `${names[0]} wins the Showdown: everyone else went home`;
  else if (!names.length) headline = "Snowball Showdown ends in a draw: nobody won a round";
  else if (names.length === 1) headline = `${names[0]} is the Snowball champion ❄️`;
  else headline = `${joinNames(names)} share the Snowball crown`;
  endMatch(s, ctx, winners, headline);
}

function finishTeamRound(s: SnowState, ctx: GameCtx, team: number | null) {
  s.lastWinner = null;
  s.lastTeam = team;
  s.history.push({ winner: null, team: team ?? -1, order: s.outs.map((o) => o.s) });
  s.power = null;
  if (team !== null && s.teams) {
    s.teamWins[team] += 1;
    // Every member banks the round win (they're the per-player scores).
    for (const k of s.kids) if (s.team[k.slot] === team) s.wins[k.slot] += 1;
    if (s.teamWins[team] >= s.winsNeeded) return finishTeamMatch(s, ctx, team, "won");
  }
  if (s.round >= s.maxRounds) return finishTeamMatch(s, ctx, leadingTeam(s), "won");
  s.phase = "roundOver";
  s.endsAt = ctx.now() + ROUND_OVER_MS;
}

function finishRound(s: SnowState, ctx: GameCtx, winner: Kid | null) {
  s.lastWinner = winner ? winner.id : null;
  s.history.push({ winner: s.lastWinner, order: s.outs.map((o) => o.s) });
  s.power = null;
  if (winner) s.wins[winner.slot] += 1;
  if (winner && s.wins[winner.slot] >= s.winsNeeded) return finishMatch(s, ctx, [winner.id], "won");
  if (s.round >= s.maxRounds) return finishMatch(s, ctx, topScorers(winsRecord(s)), "won");
  s.phase = "roundOver";
  s.endsAt = ctx.now() + ROUND_OVER_MS;
}

/** Track "fewer than two players online"; ends the match once that lasts ABANDON_MS. */
function checkAlone(s: SnowState, ctx: GameCtx): boolean {
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
  if (s.teams) {
    if (online.length === 1) finishTeamMatch(s, ctx, s.team[s.ids.indexOf(online[0])], "forfeit");
    else finishTeamMatch(s, ctx, leadingTeam(s), "abandoned");
  } else if (online.length === 1) finishMatch(s, ctx, online, "forfeit");
  else finishMatch(s, ctx, topScorers(winsRecord(s)), "abandoned");
  return true;
}

function advance(s: SnowState, ctx: GameCtx): boolean {
  const now = ctx.now();
  if (s.phase === "final") {
    simulate(s, ctx); // snowballs in the air land (visual only)
    return false;
  }
  let changed = checkAlone(s, ctx);
  if ((s.phase as Phase) === "final") return true;
  switch (s.phase) {
    case "countdown":
      if (now < s.endsAt) return changed;
      s.phase = "fight";
      s.fightAt = now;
      s.steps = 0;
      s.endsAt = 0;
      s.powerAt = now + POWER_FIRST_MS;
      return true;
    case "fight": {
      const outsBefore = s.outs.length;
      simulate(s, ctx);
      if (s.outs.length !== outsBefore) changed = true;
      const alive = s.kids.filter((k) => k.alive);
      if (sidesLeft(s) <= 1) {
        if (s.teams) finishTeamRound(s, ctx, alive.length ? s.team[alive[0].slot] : null);
        else finishRound(s, ctx, alive[0] ?? null);
        return true;
      }
      const ms = simTime(s) - s.fightAt;
      if (!s.sudden && ms >= SUDDEN_MS) {
        s.sudden = true;
        for (const k of alive) k.hp = Math.min(k.hp, 1);
        changed = true;
      }
      if (ms >= ROUND_CAP_MS) {
        if (s.teams) finishTeamRound(s, ctx, null);
        else finishRound(s, ctx, null);
        return true;
      }
      return changed;
    }
    case "roundOver":
      simulate(s, ctx);
      if (now < s.endsAt) return changed;
      s.round += 1;
      startRound(s, ctx);
      return true;
  }
}

// ---------- view ----------

function buildView(s: SnowState): SnowView {
  return {
    phase: s.phase,
    round: s.round,
    winsNeeded: s.winsNeeded,
    maxRounds: s.maxRounds,
    maxHp: s.maxHp,
    endsAt: s.endsAt,
    fightAt: s.fightAt,
    field: s.field,
    ids: s.ids.slice(),
    teams: s.teams ? [s.teams[0].slice(), s.teams[1].slice()] : null,
    teamWins: [s.teamWins[0], s.teamWins[1]],
    lastTeam: s.lastTeam,
    champTeam: s.champTeam,
    wins: s.wins.slice(),
    hits: s.hits.slice(),
    kos: s.kos.slice(),
    outs: s.outs.map((o) => ({ ...o })),
    history: s.history.map((h) => ({ ...h, order: h.order.slice() })),
    lastWinner: s.lastWinner,
    champions: s.champions ? s.champions.slice() : null,
    sudden: s.sudden,
    abandonAt: s.aloneSince === null || s.phase === "final" ? null : s.aloneSince + ABANDON_MS,
    snap: s.snap,
  };
}

/** Everyone sees the same thing, so a view is built once per change. */
const viewCache = new WeakMap<SnowState, { rev: number; snap: Snap; view: SnowView }>();

// ---------- validation ----------

const isInt = (v: unknown, lim: number): v is number => typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= lim;

function refuse(ctx: GameCtx, playerId: string, seq: unknown) {
  if (typeof seq === "number") ctx.emit({ k: "no", s: seq }, { to: playerId });
}

// ---------- practice bots ----------
// A bot only uses what everyone sees (positions, hearts, ammo, piles, the power-up). It picks the
// nearest rival, keeps a throwing distance while strafing, restocks at piles, and throws every
// second or so with a rough lead and some wobble: beatable, but it fights back.

interface BotMem {
  /** Next time it re-plans its walk, and next time it may throw. */
  move: number;
  shot: number;
  /** Strafe side (+1 / -1), flipped now and then. */
  side: number;
  x: number;
  y: number;
}

const botMemory = new WeakMap<SnowState, Map<string, BotMem>>();

function botAction(s: SnowState, botId: string, ctx: GameCtx): SnowAction | null {
  const slot = s.ids.indexOf(botId);
  if (slot < 0 || s.phase === "final") return null;
  const k = s.kids[slot];
  let mems = botMemory.get(s);
  if (!mems) botMemory.set(s, (mems = new Map()));
  let m = mems.get(botId);
  if (!m) mems.set(botId, (m = { move: 0, shot: 0, side: 1, x: 0, y: 0 }));
  const walk = (x: number, y: number): SnowAction | null => {
    if (x === m.x && y === m.y) return null;
    m.x = x;
    m.y = y;
    return { type: "in", x, y };
  };
  if (s.phase !== "fight" || !k.alive) {
    m.shot = 0;
    return walk(0, 0);
  }
  const now = ctx.now();
  const t = simTime(s);
  // First throw of a round comes after a short "where is everyone" beat.
  if (!m.shot) m.shot = now + 900 + ctx.random() * 900;
  let target: Kid | null = null;
  let best = Infinity;
  for (const o of s.kids) {
    if (!o.alive || o === k || allies(s, o.slot, k.slot)) continue;
    const d = Math.hypot(o.x - k.x, o.y - k.y);
    if (d < best) {
      best = d;
      target = o;
    }
  }
  if (!target) return walk(0, 0);

  // Throw: lead the target a little (flight time from shared.ts), aim off by a bit.
  if (now >= m.shot && k.ammo > 0 && t - k.lastThrow >= THROW_CD_MS && best <= MAX_RANGE + 40) {
    m.shot = now + 650 + ctx.random() * 900;
    const f = makeFlight(k.x, k.y, target.x, target.y, 0);
    const lead = (f.T / 1000) * (0.4 + ctx.random() * 0.5);
    const miss = 18 + best * 0.06;
    const x = target.x + target.vx * lead + (ctx.random() - 0.5) * 2 * miss;
    const y = target.y + target.vy * lead + (ctx.random() - 0.5) * 2 * miss;
    return { type: "throw", x: Math.round(Math.max(0, Math.min(WORLD_W, x))), y: Math.round(Math.max(0, Math.min(WORLD_H, y))) };
  }
  if (now < m.move) return null;
  m.move = now + 220 + ctx.random() * 280;
  if (ctx.random() < 0.12) m.side = -m.side;

  // Where to go: a ready pile when low on snow, a nearby power-up, else a fighting distance.
  const field = fieldOf(s);
  let gx: number;
  let gy: number;
  let pile = -1;
  let pileD = Infinity;
  if (k.ammo <= 1) {
    field.piles.forEach(([px, py], i) => {
      const d = Math.hypot(px - k.x, py - k.y);
      if (s.piles[i] <= t && d < pileD) {
        pileD = d;
        pile = i;
      }
    });
  }
  const pw = s.power && Math.hypot(s.power.x - k.x, s.power.y - k.y) < 260 ? s.power : null;
  if (pile >= 0 && pileD < 450) [gx, gy] = field.piles[pile];
  else if (pw) [gx, gy] = [pw.x, pw.y];
  else {
    const dx = (target.x - k.x) / (best || 1);
    const dy = (target.y - k.y) / (best || 1);
    const want = s.sudden ? 330 : 270;
    const close = best > want + 60 ? 1 : best < want - 60 ? -1 : 0;
    gx = k.x + dx * close * 120 - dy * m.side * 90;
    gy = k.y + dy * close * 120 + dx * m.side * 90;
  }
  // Keep off the walls of the field.
  gx = Math.max(70, Math.min(WORLD_W - 70, gx));
  gy = Math.max(70, Math.min(WORLD_H - 70, gy));
  const mx = gx - k.x;
  const my = gy - k.y;
  const md = Math.hypot(mx, my);
  if (md < 12) return walk(0, 0);
  return walk(Math.round((mx / md) * 100), Math.round((my / md) * 100));
}

// ---------- game definition ----------

export const snowball: GameDef<SnowState, SnowAction> = {
  id: "snowball",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const first = Math.floor(ctx.random() * FIELD_COUNT);
    const set = readSettings(config.settings, ctx.settings);
    const winsNeeded = set.wins as number;
    const maxHp = set.hearts as number;
    const teams = set.mode === "teams" && ids.length >= 2 ? splitTeams(ids, ctx.random) : null;
    const s: SnowState = {
      ids,
      teams,
      team: ids.map((id) => (teams ? (teams[0].includes(id) ? 0 : 1) : -1)),
      teamWins: [0, 0],
      lastTeam: null,
      champTeam: null,
      winsNeeded,
      // 3 wins -> 7 rounds at most (the original match length).
      maxRounds: winsNeeded * 2 + 1,
      maxHp,
      phase: "countdown",
      round: 1,
      endsAt: 0,
      fightAt: 0,
      steps: 0,
      field: first,
      firstField: first,
      kids: ids.map((id, slot) => newKid(slot, id, maxHp)),
      forts: [],
      piles: [],
      power: null,
      powerAt: 0,
      balls: [],
      nextBall: 1,
      sudden: false,
      wins: ids.map(() => 0),
      hits: ids.map(() => 0),
      kos: ids.map(() => 0),
      outs: [],
      history: [],
      lastWinner: null,
      champions: null,
      aloneSince: null,
      snap: { k: "s", n: 1, t: ctx.now(), p: "", s: "", w: "", c: "" },
      pb: [],
      pe: [],
      pf: [],
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
    const k = s.kids[slot];
    const rec = a as Record<string, unknown>;
    if (rec.type === "in") {
      if (!isInt(rec.x, 100) || !isInt(rec.y, 100)) return false;
      const [ix, iy] = inputDir(rec.x, rec.y);
      k.ix = ix;
      k.iy = iy;
      const m = Math.hypot(ix, iy);
      if (m > 0.05) {
        k.fx = ix / m;
        k.fy = iy / m;
      }
      return false; // shows up in the next snapshot
    }
    if (rec.type === "throw") {
      const seq = rec.s;
      if (seq !== undefined && !(isInt(seq, 2 ** 31) && seq > 0)) return false;
      if (!isInt(rec.x, 5_000) || !isInt(rec.y, 5_000)) return refuse(ctx, playerId, seq), false;
      const t = simTime(s);
      if (s.phase !== "fight" || !k.alive || k.ammo <= 0 || t - k.lastThrow < THROW_CD_MS - SUB_MS) {
        refuse(ctx, playerId, seq);
        return false;
      }
      const x0 = Math.round(k.x);
      const y0 = Math.round(k.y);
      const [tx, ty] = aimPoint(x0, y0, rec.x, rec.y, k.fx, k.fy);
      const big = k.power === "big" && k.charges > 0;
      const triple = k.power === "triple" && k.charges > 0;
      const targets: [number, number][] = [[tx, ty]];
      if (triple) targets.push(spreadPoint(x0, y0, tx, ty, -1), spreadPoint(x0, y0, tx, ty, 1));
      for (const [bx, by] of targets) {
        const id = s.nextBall++;
        s.balls.push({ id, slot, f: makeFlight(x0, y0, bx, by, t), big });
        if (s.pb.length < MAX_PENDING) s.pb.push([id, slot, x0, y0, bx, by, t, big ? 1 : 0, typeof seq === "number" ? seq : 0]);
      }
      if (big || triple) {
        k.charges -= 1;
        if (k.charges <= 0) k.power = null;
      }
      k.ammo -= 1;
      k.lastThrow = t;
      const m = Math.hypot(tx - x0, ty - y0);
      if (m > 0) {
        k.fx = (tx - x0) / m;
        k.fy = (ty - y0) / m;
      }
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
    const k = s.kids[slot];
    k.ix = 0;
    k.iy = 0;
    checkAlone(s, ctx);
    s.rev += 1;
  },

  playerReturned(s, playerId, ctx) {
    if (s.ids.indexOf(playerId) < 0) return;
    checkAlone(s, ctx);
    s.rev += 1;
  },
};

export default snowball;
