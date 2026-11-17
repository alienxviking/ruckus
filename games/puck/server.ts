import type { GameCtx, GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { TEAMS, splitTeams } from "../../shared/teams";
import { config } from "./config";
import { stepPaddle, stepPuck, type Kin, type Sweep } from "./physics";
import {
  ABANDON_MS,
  BIG_PADDLE_R,
  GOAL_MS,
  H,
  HALF_MS,
  MID,
  PADDLE_R,
  PUCK_R,
  SET_MS,
  SPEEDS,
  START_MS,
  SUB_MS,
  SUBSTEPS,
  TICK_MS,
  W,
  halfOf,
  homeOf,
  zoneRect,
  type GoalRec,
  type Phase,
  type PuckAction,
  type PuckView,
  type Snap,
  type SpeedKey,
  type Zone,
} from "./shared";

// Puck: real-time air hockey, 1v1, 2v1 or 2v2 (Ruckus original).
//
// The server owns the physics: SUBSTEPS fixed substeps per 50 ms tick, driven by the clock so a
// late tick catches up. Paddles chase the spot their owner points at (at most PADDLE_MAX), and the
// puck is swept against each paddle's motion every substep (physics.ts, shared with the client).
// Every tick one compact snapshot event goes out (skipped while nothing moves, with a heartbeat);
// the full view only on big moments (goals, faceoffs, the end). Nothing is secret.

const MAX_CATCHUP = 15;
const HEARTBEAT_MS = 1_000;

interface Pad {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

export interface PuckState {
  ids: string[];
  team: number[];
  zone: Zone[];
  r: number[];
  pads: Pad[];
  puck: Kin;
  phase: Phase;
  endsAt: number;
  /** Faceoff number (snapshots of different faceoffs are never blended). */
  n: number;
  simAt: number;
  steps: number;
  score: [number, number];
  target: number;
  speed: SpeedKey;
  goals: number[];
  log: GoalRec[];
  lastTouch: number;
  /** Half the puck is in, and the sim time it got there. */
  half: number;
  halfAt: number;
  /** Team that gets the next faceoff. */
  faceTeam: number;
  handed: number | null;
  champions: number | null;
  /** Per team: since when nobody on it is connected (null = someone is). */
  emptySince: (number | null)[];
  snap: Snap;
  sent: Snap | null;
  sentAt: number;
  quiet: boolean;
  rev: number;
}

const simTime = (s: PuckState) => s.simAt + s.steps * SUB_MS;
const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const isInt = (v: unknown, lim: number): v is number => typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= lim;

function rectOf(s: PuckState, slot: number) {
  return zoneRect(s.team[slot], s.zone[slot], s.r[slot]);
}

function sendHome(s: PuckState, slot: number) {
  const [hx, hy] = homeOf(s.team[slot], s.zone[slot]);
  s.pads[slot].tx = hx;
  s.pads[slot].ty = hy;
}

/** Puck on `team`'s side, still; the next phase is the faceoff freeze. */
function faceoff(s: PuckState, ctx: GameCtx, team: number, ms: number) {
  s.n += 1;
  const jitter = (ctx.random() - 0.5) * 160;
  s.puck = { x: Math.round(W / 2 + jitter), y: team === 0 ? MID + 170 : MID - 170, vx: 0, vy: 0 };
  s.lastTouch = -1;
  s.phase = "set";
  s.endsAt = ctx.now() + ms;
  s.half = team;
  s.halfAt = simTime(s);
  // Nobody may start parked on the puck.
  s.pads.forEach((p, slot) => {
    const R = s.r[slot] + PUCK_R + 4;
    const dx = p.x - s.puck.x;
    const dy = p.y - s.puck.y;
    const d = Math.hypot(dx, dy);
    if (d < R) {
      const [hx, hy] = homeOf(s.team[slot], s.zone[slot]);
      p.x = p.tx = hx;
      p.y = p.ty = hy;
    }
  });
}

function teamName(s: PuckState, ctx: GameCtx, team: number) {
  const names = s.ids.filter((_, i) => s.team[i] === team).map((id) => ctx.player(id)?.name ?? "Someone");
  return names.length <= 1 ? (names[0] ?? TEAMS[team].name) : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function finish(s: PuckState, ctx: GameCtx, team: number, how: "won" | "forfeit" | "abandoned") {
  if (s.phase === "final") return;
  s.phase = "final";
  s.endsAt = 0;
  s.champions = team;
  s.rev += 1;
  for (let i = 0; i < s.pads.length; i++) sendHome(s, i);
  const [a, b] = s.score;
  const line = team === 0 ? `${a}–${b}` : `${b}–${a}`;
  const winners = team < 0 ? [] : s.ids.filter((_, i) => s.team[i] === team);
  const plural = winners.length > 1;
  let headline: string;
  if (team < 0) headline = `Puck ends level at ${a}–${b}: everyone left the table`;
  else if (how === "won") headline = `${teamName(s, ctx, team)} ${plural ? "win" : "wins"} ${line} 🏒`;
  else headline = `${teamName(s, ctx, team)} ${plural ? "win" : "wins"} ${line}: the other side left the table`;
  ctx.end({ winners, headline, scores: Object.fromEntries(s.ids.map((id, i) => [id, s.goals[i]])) });
}

function scoreGoal(s: PuckState, ctx: GameCtx, team: number) {
  s.score[team] += 1;
  const last = s.lastTouch;
  const credited = last >= 0 && s.team[last] === team ? last : -1;
  if (credited >= 0) s.goals[credited] += 1;
  s.log.push({ team, slot: credited, last });
  if (s.log.length > 40) s.log.shift();
  s.puck.vx = 0;
  s.puck.vy = 0;
  s.puck.y = team === 0 ? -PUCK_R - 6 : H + PUCK_R + 6;
  s.faceTeam = 1 - team;
  s.handed = null;
  s.rev += 1;
  if (s.score[team] >= s.target) return finish(s, ctx, team, "won");
  s.phase = "goal";
  s.endsAt = ctx.now() + GOAL_MS;
}

const sweeps: Sweep[] = [];

function substep(s: PuckState, ctx: GameCtx) {
  sweeps.length = 0;
  s.pads.forEach((p, slot) => {
    const [x1, y1] = stepPaddle(p.x, p.y, p.tx, p.ty, rectOf(s, slot));
    sweeps.push({ slot, x0: p.x, y0: p.y, x1, y1, r: s.r[slot] });
    p.x = x1;
    p.y = y1;
  });
  if (s.phase !== "live") return;
  const sp = SPEEDS[s.speed];
  const scored = stepPuck(s.puck, sweeps, sp.max, sp.friction, (kind, slot) => {
    if (slot >= 0) s.lastTouch = slot;
  });
  if (scored >= 0) return scoreGoal(s, ctx, scored);
  const t = simTime(s);
  const half = halfOf(s.puck.y);
  if (half !== s.half) {
    s.half = half;
    s.halfAt = t;
  } else if (t - s.halfAt >= HALF_MS) {
    // Sat in one half too long: the other side gets it.
    s.handed = 1 - half;
    s.rev += 1;
    faceoff(s, ctx, 1 - half, SET_MS);
  }
}

function simulate(s: PuckState, ctx: GameCtx) {
  const target = Math.floor(((ctx.now() - s.simAt) * SUBSTEPS) / TICK_MS);
  let n = target - s.steps;
  if (n > MAX_CATCHUP) {
    s.steps = target - MAX_CATCHUP;
    n = MAX_CATCHUP;
  }
  for (let i = 0; i < n; i++) {
    s.steps += 1;
    const was = s.phase;
    substep(s, ctx);
    if (s.phase !== was) {
      // Goal or faceoff: the rest of this tick's substeps just move paddles.
      s.steps = Math.max(s.steps, target);
      break;
    }
  }
}

/** Track sides with nobody connected; a side empty for ABANDON_MS forfeits. */
function checkEmpty(s: PuckState, ctx: GameCtx): boolean {
  const now = ctx.now();
  let changed = false;
  const empty = [0, 1].map((team) => !s.ids.some((id, i) => s.team[i] === team && connected(ctx, id)));
  for (const team of [0, 1]) {
    const want = empty[team] ? (s.emptySince[team] ?? now) : null;
    if (want !== s.emptySince[team]) {
      s.emptySince[team] = want;
      changed = true;
    }
  }
  if (empty[0] && empty[1]) {
    const since = Math.max(s.emptySince[0] ?? now, s.emptySince[1] ?? now);
    if (now - since >= ABANDON_MS) {
      const [a, b] = s.score;
      finish(s, ctx, a > b ? 0 : b > a ? 1 : -1, "abandoned");
      return true;
    }
    return changed;
  }
  for (const team of [0, 1]) {
    const since = s.emptySince[team];
    if (since !== null && now - since >= ABANDON_MS) {
      finish(s, ctx, 1 - team, "forfeit");
      return true;
    }
  }
  return changed;
}

function advance(s: PuckState, ctx: GameCtx): boolean {
  if (s.phase === "final") {
    simulate(s, ctx);
    return false;
  }
  let changed = checkEmpty(s, ctx);
  if ((s.phase as Phase) === "final") return true;
  const now = ctx.now();
  const before = s.rev;
  if (s.phase === "set" && now >= s.endsAt) {
    s.phase = "live";
    s.endsAt = 0;
    s.half = halfOf(s.puck.y);
    s.halfAt = simTime(s);
    changed = true;
  } else if (s.phase === "goal" && now >= s.endsAt) {
    faceoff(s, ctx, s.faceTeam, SET_MS);
    changed = true;
  }
  simulate(s, ctx);
  return changed || s.rev !== before;
}

function makeSnap(s: PuckState): Snap {
  const p = s.puck;
  const d: number[] = [];
  for (const q of s.pads) d.push(Math.round(q.x), Math.round(q.y));
  return {
    k: "s",
    n: s.n,
    t: Math.round(simTime(s)),
    p: [Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy)],
    d,
    l: s.lastTouch,
    h: Math.round(s.halfAt),
  };
}

function sameFrame(a: Snap, b: Snap) {
  return a.n === b.n && a.l === b.l && a.h === b.h && a.p.join() === b.p.join() && a.d.join() === b.d.join();
}

function buildView(s: PuckState): PuckView {
  const since = s.phase === "final" ? null : [s.emptySince[0], s.emptySince[1]].filter((v): v is number => v !== null);
  return {
    phase: s.phase,
    endsAt: s.endsAt,
    ids: s.ids.slice(),
    team: s.team.slice(),
    zone: s.zone.slice(),
    r: s.r.slice(),
    score: [s.score[0], s.score[1]],
    target: s.target,
    speed: s.speed,
    goals: s.goals.slice(),
    log: s.log.slice(-12),
    champions: s.champions,
    handed: s.handed,
    abandonAt: since && since.length ? Math.min(...since) + ABANDON_MS : null,
    snap: s.snap,
  };
}

const viewCache = new WeakMap<PuckState, { rev: number; snap: Snap; view: PuckView }>();

// ---------- practice bots ----------
// A bot reads only what everyone sees (the puck and paddles). It re-plans every ~150-250 ms (a
// human-ish reaction time) from where the puck will be a moment later, guards its goal when the
// puck comes at it, and otherwise gets behind the puck and drives it at the far goal with some aim
// error. Its paddle moves at about half the top speed a human flick reaches.

interface BotMem {
  plan: number;
  gx: number;
  gy: number;
  aim: number;
  x: number;
  y: number;
}
const BOT_SPEED = 1_500;
const botMemory = new WeakMap<PuckState, Map<string, BotMem>>();

function botAction(s: PuckState, botId: string, ctx: GameCtx): PuckAction | null {
  const slot = s.ids.indexOf(botId);
  if (slot < 0 || s.phase === "final") return null;
  let mems = botMemory.get(s);
  if (!mems) botMemory.set(s, (mems = new Map()));
  let m = mems.get(botId);
  const pad = s.pads[slot];
  if (!m) mems.set(botId, (m = { plan: 0, gx: pad.x, gy: pad.y, aim: 0, x: -1, y: -1 }));
  const now = ctx.now();
  const team = s.team[slot];
  // Work in "my frame": my goal at the bottom.
  const fx = (x: number) => (team === 0 ? x : W - x);
  const fy = (y: number) => (team === 0 ? y : H - y);
  const fv = (v: number) => (team === 0 ? v : -v);
  if (now >= m.plan) {
    m.plan = now + 150 + ctx.random() * 110;
    const [hx, hy] = homeOf(0, s.zone[slot]);
    const look = 0.06 + ctx.random() * 0.06;
    const px = fx(s.puck.x) + fv(s.puck.vx) * look;
    const py = fy(s.puck.y) + fv(s.puck.vy) * look;
    const vy = fv(s.puck.vy);
    const vx = fv(s.puck.vx);
    const mx = fx(pad.x);
    const my = fy(pad.y);
    const R = s.r[slot] + PUCK_R;
    let gx = hx;
    let gy = hy;
    if (s.phase === "live") {
      if (py > MID - 10) {
        if (vy > 350 && py > my - 20) {
          // Coming at my goal and I'm not behind it: drop back on the goal line.
          gx = W / 2 + (px - W / 2) * 0.55;
          gy = H - 80;
        } else {
          if (ctx.random() < 0.3) m.aim = (ctx.random() - 0.5) * 2;
          const tx = W / 2 + m.aim * 150;
          const dx = tx - px;
          const dy = 0 - py;
          const d = Math.hypot(dx, dy) || 1;
          const ux = dx / d;
          const uy = dy / d;
          const behind = (mx - px) * ux + (my - py) * uy < -R * 0.5;
          if (behind) {
            gx = px + ux * 60;
            gy = py + uy * 60;
          } else {
            // Get round behind it (sideways first, so I don't knock it into my own goal).
            const side = mx < px ? -1 : 1;
            gx = px - ux * (R + 40) + side * (R + 10) * 0.6;
            gy = py - uy * (R + 40);
          }
        }
      } else if (vy > 0) {
        // On its way over: meet it in front of my goal.
        const tt = Math.max(0, (H - 170 - py) / Math.max(1, vy));
        let ix = px + vx * Math.min(tt, 0.8);
        // Fold bounces off the side walls.
        const span = W - 2 * PUCK_R;
        ix = ((ix - PUCK_R) % (2 * span) + 2 * span) % (2 * span);
        ix = PUCK_R + (ix > span ? 2 * span - ix : ix);
        gx = W / 2 + (ix - W / 2) * 0.8;
        gy = H - 170;
      } else {
        gx = W / 2 + (px - W / 2) * 0.4;
        gy = hy;
      }
    } else {
      gx = W / 2 + (fx(s.puck.x) - W / 2) * 0.3;
    }
    m.gx = gx + (ctx.random() - 0.5) * 24;
    m.gy = gy + (ctx.random() - 0.5) * 24;
  }
  // Step toward the plan at bot speed (in world terms).
  const wx = team === 0 ? m.gx : W - m.gx;
  const wy = team === 0 ? m.gy : H - m.gy;
  const dx = wx - pad.x;
  const dy = wy - pad.y;
  const d = Math.hypot(dx, dy);
  const max = (BOT_SPEED * TICK_MS) / 1000;
  const k = d > max ? max / d : 1;
  const x = Math.round(pad.x + dx * k);
  const y = Math.round(pad.y + dy * k);
  if (x === m.x && y === m.y) return null;
  m.x = x;
  m.y = y;
  return { type: "m", x, y };
}

// ---------- game definition ----------

export const puck: GameDef<PuckState, PuckAction> = {
  id: "puck",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const set = readSettings(config.settings, ctx.settings);
    const [a, b] = splitTeams(ids, ctx.random);
    // The bigger side (if any) is random: bottom or top.
    const flip = ctx.random() < 0.5;
    const sides = flip ? [b, a] : [a, b];
    const team = ids.map((id) => (sides[0].includes(id) ? 0 : 1));
    const zone: Zone[] = ids.map((id, i) => {
      const mates = sides[team[i]];
      if (mates.length < 2) return "all";
      return mates.indexOf(id) === 0 ? "fwd" : "back";
    });
    const r = ids.map((_, i) => (sides[team[i]].length === 1 && sides[1 - team[i]].length > 1 ? BIG_PADDLE_R : PADDLE_R));
    const pads: Pad[] = ids.map((_, i) => {
      const [x, y] = homeOf(team[i], zone[i]);
      return { x, y, tx: x, ty: y };
    });
    const speed: SpeedKey = set.speed === "turbo" ? "turbo" : "normal";
    const now = ctx.now();
    const s: PuckState = {
      ids,
      team,
      zone,
      r,
      pads,
      puck: { x: W / 2, y: MID, vx: 0, vy: 0 },
      phase: "set",
      endsAt: 0,
      n: 0,
      simAt: now,
      steps: 0,
      score: [0, 0],
      target: Number(set.goals) || 7,
      speed,
      goals: ids.map(() => 0),
      log: [],
      lastTouch: -1,
      half: 0,
      halfAt: now,
      faceTeam: 0,
      handed: null,
      champions: null,
      emptySince: [null, null],
      snap: { k: "s", n: 0, t: now, p: [0, 0, 0, 0], d: [], l: -1, h: now },
      sent: null,
      sentAt: 0,
      quiet: false,
      rev: 0,
    };
    faceoff(s, ctx, ctx.random() < 0.5 ? 0 : 1, START_MS);
    s.snap = makeSnap(s);
    return s;
  },

  action(s, playerId, action) {
    if (s.phase === "final") return false;
    const a: unknown = action;
    if (!a || typeof a !== "object" || Array.isArray(a)) return false;
    const slot = s.ids.indexOf(playerId);
    if (slot < 0) return false;
    const rec = a as Record<string, unknown>;
    if (rec.type !== "m" || !isInt(rec.x, 5_000) || !isInt(rec.y, 5_000)) return false;
    const rect = rectOf(s, slot);
    s.pads[slot].tx = Math.max(rect.x0, Math.min(rect.x1, rec.x));
    s.pads[slot].ty = Math.max(rect.y0, Math.min(rect.y1, rec.y));
    return false; // shows up in the next snapshot
  },

  tick(s, ctx) {
    if (advance(s, ctx)) {
      s.rev += 1;
      s.snap = makeSnap(s);
      s.sent = s.snap;
      s.sentAt = ctx.now();
      s.quiet = false;
      return true;
    }
    const snap = makeSnap(s);
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
    sendHome(s, slot);
    checkEmpty(s, ctx);
    s.rev += 1;
  },

  playerReturned(s, playerId, ctx) {
    if (s.ids.indexOf(playerId) < 0) return;
    checkEmpty(s, ctx);
    s.rev += 1;
  },
};

export default puck;
