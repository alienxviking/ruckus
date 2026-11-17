import type { GameCtx, GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { splitTeams, TEAMS } from "../../shared/teams";
import { config } from "./config";
import {
  ABANDON_MS,
  BASES,
  BASE_R,
  COUNTDOWN_MS,
  FLAG_DROPPED,
  FLAG_HOME,
  FLAG_REACH,
  FLAG_RETURN_MS,
  FX_CAP,
  FX_DROP,
  FX_GRAB,
  FX_POWER,
  FX_RETURN,
  FX_SPAWN,
  FX_TAG,
  MID,
  OVERTIME_MS,
  PLAYER_R,
  POWER_EVERY_MS,
  POWER_FIRST_MS,
  POWER_R,
  RESPAWN_BEHIND_MS,
  RESPAWN_MS,
  SCORED_MS,
  ST_OUT,
  ST_ON,
  ST_TURBO,
  SUBSTEPS,
  SUB_MS,
  TICK_MS,
  TOUCH,
  TURBO_MS,
  WORLD_W,
  encodePositions,
  inputDir,
  speedOf,
  stepBody,
  teamHalf,
  type FlagTuple,
  type FxTuple,
  type Phase,
  type Snap,
} from "./shared";

// Flag Raid: real-time two-team capture the flag (Ruckus original).
//
// The server owns everything: running (fixed substeps per 50 ms tick, driven by the clock so a
// late tick catches up), tags, flags and the score. Every tick it sends one compact snapshot event
// (positions, a status digit per player, both flags, the power-up, what happened) and returns
// false; the full view only goes out on big moments (tags, grabs, captures, phase changes).
// Nothing is secret, so every viewer gets the same view.

/** A tick never simulates more than this many substeps (a stalled server skips ahead). */
const MAX_CATCHUP = 8;
/** Even when nothing moves, a snapshot goes out this often. */
const HEARTBEAT_MS = 1_000;
const MAX_PENDING = 48;
/** Countdown before play resumes after a capture. */
const RELINE_MS = 2_200;
const FEED_MAX = 6;

// ---------- state ----------

interface Runner {
  slot: number;
  id: string;
  team: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ix: number;
  iy: number;
  out: boolean;
  backAt: number;
  turboUntil: number;
}

interface Flag {
  /** FLAG_HOME, FLAG_DROPPED or the carrier's slot. */
  at: number;
  x: number;
  y: number;
  /** Sim time a dropped flag goes home by itself. */
  returnAt: number;
}

export interface FeedItem {
  /** What happened: tag (a tagged by b), grab (a took team's flag), cap (a scored for team),
   * ret (team's flag went home, by b or -1 = by itself), drop. */
  k: "tag" | "grab" | "cap" | "ret" | "drop";
  a: number;
  b: number;
  team: number;
  /** Server time. */
  at: number;
}

export interface FlagState {
  ids: string[];
  team: number[];
  capsNeeded: number;
  /** Regulation time (ms). */
  timeLimit: number;
  phase: Phase;
  endsAt: number;
  /** Line-up number (frames never blend across one). */
  n: number;
  /** Server time this stretch of play started, and substeps simulated since. */
  fightAt: number;
  steps: number;
  /** Clock left (ms) when this stretch of play started; it only runs during play. */
  segLeft: number;
  clockLeft: number;
  overtime: boolean;
  score: [number, number];
  caps: number[];
  tags: number[];
  returns: number[];
  runners: Runner[];
  flags: [Flag, Flag];
  power: { x: number; y: number } | null;
  powerAt: number;
  lastCap: { slot: number; team: number } | null;
  /** Winning team when the match is over (-1 = draw). */
  winTeam: number | null;
  /** How the match ended. */
  how: "caps" | "time" | "forfeit" | null;
  feed: FeedItem[];
  goneSince: number | null;
  snap: Snap;
  pf: FxTuple[];
  sent: Snap | null;
  sentAt: number;
  quiet: boolean;
  rev: number;
}

/** x, y: stick direction (ints, -100..100). */
export type FlagAction = { type: "in"; x: number; y: number };

export interface FlagView {
  phase: Phase;
  endsAt: number;
  n: number;
  capsNeeded: number;
  timeLimit: number;
  /** While playing: server time the clock runs out (0 otherwise). */
  clockEndsAt: number;
  /** Clock left (ms) when it isn't running. */
  clockLeft: number;
  overtime: boolean;
  ids: string[];
  team: number[];
  score: [number, number];
  caps: number[];
  tags: number[];
  returns: number[];
  lastCap: { slot: number; team: number } | null;
  winTeam: number | null;
  how: "caps" | "time" | "forfeit" | null;
  feed: FeedItem[];
  abandonAt: number | null;
  snap: Snap;
}

const simTime = (s: FlagState) => s.fightAt + s.steps * SUB_MS;
const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const carrying = (s: FlagState, r: Runner) => s.flags[1 - r.team].at === r.slot;

function flagTuple(f: Flag, s: FlagState, team: number): FlagTuple {
  if (f.at === FLAG_HOME) return [FLAG_HOME, BASES[team][0], BASES[team][1]];
  if (f.at === FLAG_DROPPED) return [FLAG_DROPPED, Math.round(f.x), Math.round(f.y)];
  const r = s.runners[f.at];
  return [f.at, Math.round(r?.x ?? f.x), Math.round(r?.y ?? f.y)];
}

function pushFx(s: FlagState, fx: FxTuple) {
  if (s.pf.length < MAX_PENDING) s.pf.push(fx);
}

function pushFeed(s: FlagState, item: Omit<FeedItem, "at">, ctx: GameCtx) {
  s.feed.push({ ...item, at: ctx.now() });
  if (s.feed.length > FEED_MAX) s.feed.splice(0, s.feed.length - FEED_MAX);
}

/** Where slot i of a team of n stands at a line-up (spread across, a few rows deep). */
function lineSpot(team: number, i: number, n: number): [number, number] {
  const perRow = 6;
  const row = Math.floor(i / perRow);
  const inRow = Math.min(perRow, n - row * perRow);
  const col = i % perRow;
  const x = WORLD_W / 2 + (col - (inRow - 1) / 2) * 82;
  const depth = 210 + row * 60;
  const y = team === 0 ? MID + depth : MID - depth;
  return [x, y];
}

function spawnSpot(team: number, ctx: GameCtx): [number, number] {
  const [bx, by] = BASES[team];
  const x = bx + (ctx.random() - 0.5) * 300;
  const y = by + (team === 0 ? -1 : 1) * (BASE_R + PLAYER_R + 26 + ctx.random() * 40);
  return [x, y];
}

function lineUp(s: FlagState, ctx: GameCtx, ms: number) {
  s.n += 1;
  for (const team of [0, 1]) {
    const members = s.runners.filter((r) => r.team === team);
    members.forEach((r, i) => {
      const [x, y] = lineSpot(team, i, members.length);
      Object.assign(r, { x, y, vx: 0, vy: 0, out: false, backAt: 0, turboUntil: 0 });
    });
  }
  s.flags = [
    { at: FLAG_HOME, x: BASES[0][0], y: BASES[0][1], returnAt: 0 },
    { at: FLAG_HOME, x: BASES[1][0], y: BASES[1][1], returnAt: 0 },
  ];
  s.power = null;
  s.phase = "countdown";
  s.endsAt = ctx.now() + ms;
  s.fightAt = 0;
  s.steps = 0;
}

function dropFlag(s: FlagState, team: number, x: number, y: number, t: number) {
  const f = s.flags[team];
  const [bx, by] = BASES[team];
  // Dropped inside its own base circle (where its team can't go): it's simply home again.
  if (Math.hypot(x - bx, y - by) < BASE_R + 4) {
    Object.assign(f, { at: FLAG_HOME, x: bx, y: by, returnAt: 0 });
    pushFx(s, [FX_RETURN, team, -1]);
    return;
  }
  Object.assign(f, { at: FLAG_DROPPED, x, y, returnAt: t + FLAG_RETURN_MS });
  pushFx(s, [FX_DROP, team]);
}

function tag(s: FlagState, ctx: GameCtx, victim: Runner, by: Runner, t: number) {
  victim.out = true;
  const behind = s.score[victim.team] < s.score[1 - victim.team];
  victim.backAt = t + (behind ? RESPAWN_BEHIND_MS : RESPAWN_MS);
  victim.ix = victim.iy = 0;
  victim.vx = victim.vy = 0;
  victim.turboUntil = 0;
  s.tags[by.slot] += 1;
  pushFx(s, [FX_TAG, victim.slot, by.slot]);
  pushFeed(s, { k: "tag", a: victim.slot, b: by.slot, team: by.team }, ctx);
  const enemyFlag = 1 - victim.team;
  if (s.flags[enemyFlag].at === victim.slot) {
    dropFlag(s, enemyFlag, victim.x, victim.y, t);
    pushFeed(s, { k: "drop", a: victim.slot, b: -1, team: enemyFlag }, ctx);
  }
}

/** One fixed step at sim time `t`. Returns true when something big happened. */
function substep(s: FlagState, ctx: GameCtx, t: number): boolean {
  const live = s.phase === "play";
  const dt = SUB_MS / 1000;
  let big = false;
  for (const r of s.runners) {
    if (r.out) {
      if (live && t >= r.backAt) {
        const [x, y] = spawnSpot(r.team, ctx);
        Object.assign(r, { x, y, vx: 0, vy: 0, out: false });
        pushFx(s, [FX_SPAWN, r.slot]);
        big = true;
      }
      continue;
    }
    const carry = carrying(s, r);
    const st = r.turboUntil > t ? ST_TURBO : ST_ON;
    stepBody(r, r.ix, r.iy, dt, speedOf(st, carry), r.team, carry);
  }
  // Contacts: across teams, whoever is on the other team's ground gets tagged.
  const on = s.runners.filter((r) => !r.out);
  for (let i = 0; i < on.length; i++) {
    for (let j = i + 1; j < on.length; j++) {
      const a = on[i];
      const b = on[j];
      if (a.out || b.out) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= TOUCH) continue;
      if (live && a.team !== b.team) {
        const ha = a.y >= MID ? 0 : 1;
        const hb = b.y >= MID ? 0 : 1;
        if (ha === hb) {
          const victim = a.team === ha ? b : a;
          const tagger = victim === a ? b : a;
          tag(s, ctx, victim, tagger, t);
          big = true;
          continue;
        }
      }
      const nx = d > 1e-6 ? dx / d : 1;
      const ny = d > 1e-6 ? dy / d : 0;
      const o = (TOUCH - d) / 2;
      a.x -= nx * o;
      a.y -= ny * o;
      b.x += nx * o;
      b.y += ny * o;
    }
  }
  if (!live) return big;
  // Flags.
  for (const team of [0, 1]) {
    const f = s.flags[team];
    if (f.at === FLAG_DROPPED && t >= f.returnAt) {
      Object.assign(f, { at: FLAG_HOME, x: BASES[team][0], y: BASES[team][1], returnAt: 0 });
      pushFx(s, [FX_RETURN, team, -1]);
      pushFeed(s, { k: "ret", a: -1, b: -1, team }, ctx);
      big = true;
    }
  }
  for (const r of s.runners) {
    if (r.out) continue;
    const own = s.flags[r.team];
    const enemy = s.flags[1 - r.team];
    if (own.at === FLAG_DROPPED && Math.hypot(r.x - own.x, r.y - own.y) < FLAG_REACH) {
      Object.assign(own, { at: FLAG_HOME, x: BASES[r.team][0], y: BASES[r.team][1], returnAt: 0 });
      s.returns[r.slot] += 1;
      pushFx(s, [FX_RETURN, r.team, r.slot]);
      pushFeed(s, { k: "ret", a: -1, b: r.slot, team: r.team }, ctx);
      big = true;
    }
    if (enemy.at === FLAG_HOME || enemy.at === FLAG_DROPPED) {
      const [fx, fy] = enemy.at === FLAG_HOME ? BASES[1 - r.team] : [enemy.x, enemy.y];
      if (Math.hypot(r.x - fx, r.y - fy) < FLAG_REACH) {
        Object.assign(enemy, { at: r.slot, returnAt: 0 });
        pushFx(s, [FX_GRAB, r.slot, 1 - r.team]);
        pushFeed(s, { k: "grab", a: r.slot, b: -1, team: 1 - r.team }, ctx);
        big = true;
      }
    }
    if (enemy.at === r.slot) {
      enemy.x = r.x;
      enemy.y = r.y;
      const [bx, by] = BASES[r.team];
      if (Math.hypot(r.x - bx, r.y - by) < BASE_R) {
        capture(s, ctx, r);
        return true;
      }
    }
    if (s.power && Math.hypot(r.x - s.power.x, r.y - s.power.y) < PLAYER_R + POWER_R) {
      r.turboUntil = t + TURBO_MS;
      s.power = null;
      s.powerAt = t + POWER_EVERY_MS;
      pushFx(s, [FX_POWER, r.slot]);
      big = true;
    }
  }
  if (!s.power && t >= s.powerAt) {
    const x = 90 + ctx.random() * (WORLD_W - 180);
    const y = MID + (ctx.random() - 0.5) * 300;
    s.power = { x: Math.round(x), y: Math.round(y) };
  }
  return big;
}

function capture(s: FlagState, ctx: GameCtx, r: Runner) {
  const enemy = 1 - r.team;
  Object.assign(s.flags[enemy], { at: FLAG_HOME, x: BASES[enemy][0], y: BASES[enemy][1], returnAt: 0 });
  s.score[r.team] += 1;
  s.caps[r.slot] += 1;
  s.lastCap = { slot: r.slot, team: r.team };
  pushFx(s, [FX_CAP, r.slot, r.team]);
  pushFeed(s, { k: "cap", a: r.slot, b: -1, team: r.team }, ctx);
  s.clockLeft = Math.max(0, s.segLeft - (simTime(s) - s.fightAt));
  s.power = null;
  for (const x of s.runners) {
    x.ix = 0;
    x.iy = 0;
  }
  if (s.score[r.team] >= s.capsNeeded || s.overtime) {
    finish(s, ctx, r.team, s.overtime ? "time" : "caps");
    return;
  }
  s.phase = "scored";
  s.endsAt = ctx.now() + SCORED_MS;
}

/** Catch the simulation up with the clock. Returns true when something big happened. */
function simulate(s: FlagState, ctx: GameCtx): boolean {
  if (!s.fightAt) return false;
  const target = Math.floor(((ctx.now() - s.fightAt) * SUBSTEPS) / TICK_MS);
  let n = target - s.steps;
  if (n > MAX_CATCHUP) {
    s.steps = target - MAX_CATCHUP;
    n = MAX_CATCHUP;
  }
  let big = false;
  for (let i = 0; i < n; i++) {
    s.steps += 1;
    if (substep(s, ctx, simTime(s))) big = true;
    if (s.phase !== "play" && s.phase !== "scored") break;
  }
  return big;
}

// ---------- ending ----------

function teamName(team: number) {
  return TEAMS[team]?.name ?? "A";
}

function finish(s: FlagState, ctx: GameCtx, winTeam: number, how: "caps" | "time" | "forfeit") {
  if (s.phase === "final") return;
  s.phase = "final";
  s.endsAt = 0;
  s.power = null;
  s.winTeam = winTeam;
  s.how = how;
  for (const r of s.runners) {
    r.ix = 0;
    r.iy = 0;
  }
  const [a, b] = s.score;
  const line = winTeam === 1 ? `${b}–${a}` : `${a}–${b}`;
  let headline: string;
  if (winTeam < 0) headline = `Flag Raid ends level at ${a}–${b}`;
  else if (how === "forfeit") headline = `${teamName(winTeam)} team wins Flag Raid: the other side left the field`;
  else headline = `${teamName(winTeam)} team raids to victory ${line} 🚩`;
  const winners = winTeam < 0 ? [] : s.ids.filter((_, i) => s.team[i] === winTeam);
  const scores = Object.fromEntries(s.ids.map((id, i) => [id, s.caps[i] * 3 + s.tags[i] + s.returns[i]]));
  ctx.end({ winners, headline, scores });
}

/** A whole team gone for ABANDON_MS ends the match. */
function checkGone(s: FlagState, ctx: GameCtx): boolean {
  const online = [0, 1].map((team) => s.ids.some((id, i) => s.team[i] === team && connected(ctx, id)));
  const now = ctx.now();
  if (online[0] && online[1]) {
    if (s.goneSince === null) return false;
    s.goneSince = null;
    return true;
  }
  if (s.goneSince === null) {
    s.goneSince = now;
    return true;
  }
  if (now - s.goneSince < ABANDON_MS) return false;
  if (online[0] || online[1]) finish(s, ctx, online[0] ? 0 : 1, "forfeit");
  else finish(s, ctx, s.score[0] === s.score[1] ? -1 : s.score[0] > s.score[1] ? 0 : 1, "time");
  return true;
}

function advance(s: FlagState, ctx: GameCtx): boolean {
  const now = ctx.now();
  if (s.phase === "final") return false;
  let changed = checkGone(s, ctx);
  if ((s.phase as Phase) === "final") return true;
  switch (s.phase) {
    case "countdown":
      if (now < s.endsAt) return changed;
      s.phase = "play";
      s.fightAt = now;
      s.steps = 0;
      s.endsAt = 0;
      s.segLeft = s.clockLeft;
      s.powerAt = now + POWER_FIRST_MS;
      return true;
    case "play": {
      if (simulate(s, ctx)) changed = true;
      if ((s.phase as Phase) !== "play") return true;
      const left = s.segLeft - (simTime(s) - s.fightAt);
      if (left <= 0) {
        s.clockLeft = 0;
        const [a, b] = s.score;
        if (a !== b) {
          finish(s, ctx, a > b ? 0 : 1, "time");
          return true;
        }
        if (s.overtime) {
          finish(s, ctx, -1, "time");
          return true;
        }
        // Tied: overtime, next capture wins.
        s.overtime = true;
        s.segLeft = OVERTIME_MS;
        s.fightAt = simTime(s);
        s.steps = 0;
        return true;
      }
      return changed;
    }
    case "scored":
      simulate(s, ctx);
      if (now < s.endsAt) return changed;
      lineUp(s, ctx, RELINE_MS);
      return true;
  }
}

// ---------- frames ----------

function makeSnap(s: FlagState, ctx: GameCtx): Snap {
  const t = s.fightAt ? simTime(s) : ctx.now();
  const xy: number[] = [];
  let st = "";
  for (const r of s.runners) {
    xy.push(r.x, r.y);
    st += r.out ? ST_OUT : r.turboUntil > t ? ST_TURBO : ST_ON;
  }
  const snap: Snap = {
    k: "s",
    n: s.n,
    t: Math.round(t),
    p: encodePositions(xy),
    s: st,
    g: [flagTuple(s.flags[0], s, 0), flagTuple(s.flags[1], s, 1)],
  };
  if (s.power) snap.u = [s.power.x, s.power.y];
  if (s.pf.length) snap.f = s.pf;
  s.pf = [];
  return snap;
}

function sameFrame(a: Snap, b: Snap) {
  if (b.f) return false;
  if (a.p !== b.p || a.s !== b.s || a.n !== b.n) return false;
  if (a.g.join("|") !== b.g.join("|")) return false;
  return (a.u ? a.u.join(",") : "") === (b.u ? b.u.join(",") : "");
}

function buildView(s: FlagState): FlagView {
  return {
    phase: s.phase,
    endsAt: s.endsAt,
    n: s.n,
    capsNeeded: s.capsNeeded,
    timeLimit: s.timeLimit,
    clockEndsAt: s.phase === "play" ? s.fightAt + s.segLeft : 0,
    clockLeft: s.clockLeft,
    overtime: s.overtime,
    ids: s.ids.slice(),
    team: s.team.slice(),
    score: [s.score[0], s.score[1]],
    caps: s.caps.slice(),
    tags: s.tags.slice(),
    returns: s.returns.slice(),
    lastCap: s.lastCap ? { ...s.lastCap } : null,
    winTeam: s.winTeam,
    how: s.how,
    feed: s.feed.map((f) => ({ ...f })),
    abandonAt: s.goneSince === null || s.phase === "final" ? null : s.goneSince + ABANDON_MS,
    snap: s.snap,
  };
}

const viewCache = new WeakMap<FlagState, { rev: number; snap: Snap; view: FlagView }>();

const isInt = (v: unknown, lim: number): v is number => typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= lim;

// ---------- practice bots ----------
// A bot sees what everyone sees (positions, flags, the power-up). Half of each team's bots are
// raiders (go for the flag, swerve around defenders, run it home), the rest defenders (hang back
// in their half and chase raiders). Anyone near their own stolen flag chases the carrier. Bots
// re-plan a few times a second with some wobble, so a quick juke beats them.

interface BotMem {
  move: number;
  x: number;
  y: number;
  /** Previous positions of everyone (to lead a chase). */
  px: number[];
  py: number[];
  side: number;
}
const botMemory = new WeakMap<FlagState, Map<string, BotMem>>();

function botAction(s: FlagState, botId: string, ctx: GameCtx): FlagAction | null {
  const slot = s.ids.indexOf(botId);
  if (slot < 0 || s.phase === "final") return null;
  const r = s.runners[slot];
  let mems = botMemory.get(s);
  if (!mems) botMemory.set(s, (mems = new Map()));
  let m = mems.get(botId);
  if (!m) mems.set(botId, (m = { move: 0, x: 0, y: 0, px: [], py: [], side: ctx.random() < 0.5 ? -1 : 1 }));
  const walk = (x: number, y: number): FlagAction | null => {
    if (x === m.x && y === m.y) return null;
    m.x = x;
    m.y = y;
    return { type: "in", x, y };
  };
  if (s.phase !== "play" || r.out) return walk(0, 0);
  const now = ctx.now();
  if (now < m.move) return null;
  const gap = 200 + ctx.random() * 160;
  m.move = now + gap;
  // Everyone's velocity estimate from the last plan.
  const vel = (o: Runner): [number, number] => {
    const px = m.px[o.slot];
    const py = m.py[o.slot];
    if (px === undefined || py === undefined) return [0, 0];
    return [((o.x - px) / gap) * 1000, ((o.y - py) / gap) * 1000];
  };
  const remember = () => {
    m.px = s.runners.map((o) => o.x);
    m.py = s.runners.map((o) => o.y);
  };

  const team = r.team;
  const foe = 1 - team;
  const mates = s.runners.filter((o) => o.team === team);
  const myIndex = mates.indexOf(r);
  const raider = mates.length === 1 || myIndex % 2 === 0;
  const own = s.flags[team];
  const enemyFlag = s.flags[foe];
  const enemies = s.runners.filter((o) => o.team === foe && !o.out);
  const carryingNow = enemyFlag.at === slot;

  let gx: number;
  let gy: number;
  let avoid = false;
  const ownCarrier = own.at >= 0 ? s.runners[own.at] : null;
  const ownTaken = !!ownCarrier || own.at === FLAG_DROPPED;
  const distTo = (x: number, y: number) => Math.hypot(x - r.x, y - r.y);

  if (carryingNow) {
    [gx, gy] = BASES[team];
    avoid = true;
  } else if (ownTaken && (!raider || (ownCarrier ? distTo(ownCarrier.x, ownCarrier.y) < 260 : distTo(own.x, own.y) < 300))) {
    if (ownCarrier) {
      const [vx, vy] = vel(ownCarrier);
      const lead = Math.min(0.5, distTo(ownCarrier.x, ownCarrier.y) / 400);
      gx = ownCarrier.x + vx * lead;
      gy = ownCarrier.y + vy * lead;
    } else [gx, gy] = [own.x, own.y];
  } else if (raider) {
    if (enemyFlag.at >= 0) {
      // A teammate has it: run alongside, between them and the chasers.
      const c = s.runners[enemyFlag.at];
      gx = c.x + m.side * 60;
      gy = c.y + (team === 0 ? 70 : -70);
    } else {
      [gx, gy] = enemyFlag.at === FLAG_HOME ? BASES[foe] : [enemyFlag.x, enemyFlag.y];
      avoid = true;
    }
    if (s.power && distTo(s.power.x, s.power.y) < 180) [gx, gy] = [s.power.x, s.power.y];
  } else {
    // Defender: chase the nearest raider on our side, else guard the way to our flag.
    let best: Runner | null = null;
    let bd = Infinity;
    for (const e of enemies) {
      if (!teamHalf(team, e.y)) continue;
      const d = distTo(e.x, e.y) - (enemyFlag.at === e.slot || own.at === e.slot ? 200 : 0);
      if (d < bd) [bd, best] = [d, e];
    }
    if (best) {
      const [vx, vy] = vel(best);
      const lead = Math.min(0.45, distTo(best.x, best.y) / 450);
      gx = best.x + vx * lead;
      gy = best.y + vy * lead;
    } else {
      const [bx, by] = BASES[team];
      let nx = WORLD_W / 2;
      let nd = Infinity;
      for (const e of enemies) {
        const d = Math.abs(e.y - MID);
        if (d < nd) [nd, nx] = [d, e.x];
      }
      gx = bx + (nx - bx) * 0.6 + m.side * 30 * (myIndex % 3);
      gy = by + (MID - by) * 0.5;
    }
    // Never chase into enemy ground (that's how defenders get tagged).
    gy = team === 0 ? Math.max(MID + PLAYER_R + 4, gy) : Math.min(MID - PLAYER_R - 4, gy);
  }

  let dx = gx - r.x;
  let dy = gy - r.y;
  let d = Math.hypot(dx, dy);
  if (d < 10) {
    remember();
    return walk(0, 0);
  }
  dx /= d;
  dy /= d;
  if (avoid && !teamHalf(team, r.y)) {
    // On their ground: swerve around defenders.
    for (const e of enemies) {
      if (!teamHalf(foe, e.y)) continue;
      const ex = r.x - e.x;
      const ey = r.y - e.y;
      const ed = Math.hypot(ex, ey);
      if (ed > 170 || ed < 1) continue;
      const w = ((170 - ed) / 170) * 1.6;
      dx += (ex / ed) * w;
      dy += (ey / ed) * w;
    }
  } else if (avoid && carryingNow) {
    for (const e of enemies) {
      const ed = Math.hypot(r.x - e.x, r.y - e.y);
      if (ed > 120 || ed < 1 || !teamHalf(foe, r.y)) continue;
      dx += ((r.x - e.x) / ed) * 0.8;
      dy += ((r.y - e.y) / ed) * 0.8;
    }
  }
  // Human wobble.
  const ang = (ctx.random() - 0.5) * 0.5;
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  [dx, dy] = [dx * c - dy * sn, dx * sn + dy * c];
  d = Math.hypot(dx, dy) || 1;
  if (ctx.random() < 0.08) m.side = -m.side;
  remember();
  return walk(Math.round((dx / d) * 100), Math.round((dy / d) * 100));
}

// ---------- game definition ----------

export const flags: GameDef<FlagState, FlagAction> = {
  id: "flags",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const set = readSettings(config.settings, ctx.settings);
    const [red] = splitTeams(ids, ctx.random);
    const team = ids.map((id) => (red.includes(id) ? 0 : 1));
    const timeLimit = (set.minutes as number) * 60_000;
    const s: FlagState = {
      ids,
      team,
      capsNeeded: set.caps as number,
      timeLimit,
      phase: "countdown",
      endsAt: 0,
      n: 0,
      fightAt: 0,
      steps: 0,
      segLeft: timeLimit,
      clockLeft: timeLimit,
      overtime: false,
      score: [0, 0],
      caps: ids.map(() => 0),
      tags: ids.map(() => 0),
      returns: ids.map(() => 0),
      runners: ids.map((id, slot) => ({
        slot,
        id,
        team: team[slot],
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        ix: 0,
        iy: 0,
        out: false,
        backAt: 0,
        turboUntil: 0,
      })),
      flags: [
        { at: FLAG_HOME, x: BASES[0][0], y: BASES[0][1], returnAt: 0 },
        { at: FLAG_HOME, x: BASES[1][0], y: BASES[1][1], returnAt: 0 },
      ],
      power: null,
      powerAt: 0,
      lastCap: null,
      winTeam: null,
      how: null,
      feed: [],
      goneSince: null,
      snap: { k: "s", n: 0, t: ctx.now(), p: "", s: "", g: [[-1, 0, 0], [-1, 0, 0]] },
      pf: [],
      sent: null,
      sentAt: 0,
      quiet: false,
      rev: 0,
    };
    lineUp(s, ctx, COUNTDOWN_MS);
    s.snap = makeSnap(s, ctx);
    return s;
  },

  action(s, playerId, action) {
    if (s.phase === "final") return false;
    const a: unknown = action;
    if (!a || typeof a !== "object" || Array.isArray(a)) return false;
    const slot = s.ids.indexOf(playerId);
    if (slot < 0) return false;
    const rec = a as Record<string, unknown>;
    if (rec.type !== "in" || !isInt(rec.x, 100) || !isInt(rec.y, 100)) return false;
    const r = s.runners[slot];
    const [ix, iy] = inputDir(rec.x, rec.y);
    r.ix = ix;
    r.iy = iy;
    return false; // shows up in the next snapshot
  },

  tick(s, ctx) {
    if (advance(s, ctx)) {
      s.rev += 1;
      s.snap = makeSnap(s, ctx);
      s.sent = s.snap;
      s.sentAt = ctx.now();
      s.quiet = false;
      return true;
    }
    if (s.phase === "countdown" || s.phase === "final") return false;
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
    checkGone(s, ctx);
    s.rev += 1;
  },

  playerReturned(s, playerId, ctx) {
    if (s.ids.indexOf(playerId) < 0) return;
    checkGone(s, ctx);
    s.rev += 1;
  },
};

export default flags;
