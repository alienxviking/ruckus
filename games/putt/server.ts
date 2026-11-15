import { shuffle, type GameCtx, type GameDef } from "../../shared/game";
import { HOLE_BY_ID, HOLES } from "./holes";
import { nearestFree, simulate, type RollEvent, type Shot } from "./physics";
import {
  AIM_MS,
  ANGLE_STEPS,
  CARD_MS,
  FIRST_AIM_MS,
  FORFEIT_MS,
  HOLES_PER_GAME,
  MAX_POWER,
  MAX_STROKES,
  PICKUP_SCORE,
  REVEAL_MS,
  STEP_MS,
  TAIL_MS,
  teeSpots,
  type Hole,
} from "./shared";

// Putt Panic: simultaneous chaos mini-golf.
//
// Everyone aims in secret, then every ball rolls at once. The server simulates the whole roll in
// one go when the AIM phase ends (fixed 1/120 s steps, all balls in lockstep) and sends the
// outcome as a replay: simplified keyframe paths per ball plus an event list (sinks, splashes,
// portal hops, knocks...). Clients animate it against a shared clock (roll.at), so every screen
// shows the same ball in the same place at the same moment.

export type Phase = "aim" | "roll" | "card" | "final";

export interface Stats {
  aces: number;
  splashes: number;
  /** Times you knocked a rival's ball (as the faster ball). */
  knocks: number;
  whacks: number;
  portals: number;
}

interface Ball {
  id: string;
  x: number;
  y: number;
  /** Holed out on this hole. */
  sunk: boolean;
  /** Hit the stroke cap and picked up (scores PICKUP_SCORE). */
  out: boolean;
  /** Strokes on this hole (penalties included). */
  strokes: number;
  locked: boolean;
  /** Pending shot (secret until the roll): a draft from dragging, or the locked one. */
  aim: { a: number; p: number } | null;
  /** Ready to move on from the scorecard. */
  ready: boolean;
  /** Score on each finished hole. */
  card: number[];
  stats: Stats;
}

export interface RollView {
  /** Server time of t = 0 of the timeline. Balls launch at REVEAL_MS; step k is at REVEAL_MS + k × STEP_MS. */
  at: number;
  /** Total length (ms), including the linger at the end. */
  dur: number;
  /** Step at which everything came to rest. */
  settle: number;
  /** Per slot, before the roll: [x, y, strokes, in play (0/1)]. */
  from: number[][];
  /** [slot, angle (tenths of a degree), power]: every shot taken. Power 0 = ran out of time. */
  shots: number[][];
  /** Per slot: keyframe segments (each flat [k, x, y, …]); empty when the ball never moved. */
  paths: number[][][];
  /** See physics.ts for the event shapes. */
  ev: RollEvent[];
  /** [slot, x, y]: where splashed balls are put back (they reappear once everything stops). */
  resp: number[][];
}

export interface FinalInfo {
  winners: string[];
  reason: "done" | "forfeit";
}

export interface PuttState {
  phase: Phase;
  /** The holes this game plays, by layout id. */
  course: string[];
  hole: number;
  /** Shot number on this hole (1-based). */
  shot: number;
  /** Server time this hole started (the windmills' clock). */
  t0: number;
  endsAt: number;
  total: number;
  balls: Ball[];
  roll: RollView | null;
  final: FinalInfo | null;
  /** Since when fewer than two golfers have been connected. */
  awaySince: number | null;
  over: boolean;
}

export interface BallView {
  id: string;
  x: number;
  y: number;
  sunk: boolean;
  out: boolean;
  strokes: number;
  locked: boolean;
  ready: boolean;
  card: number[];
  stats: Stats;
}

export interface PuttView {
  phase: Phase;
  course: string[];
  hole: number;
  shot: number;
  t0: number;
  endsAt: number;
  total: number;
  /** Balls as they are now (during ROLL: after the roll; replay `roll` to get there). */
  balls: BallView[];
  /** Your pending shot (AIM phase only). */
  aim: { a: number; p: number } | null;
  roll: RollView | null;
  final: FinalInfo | null;
  /** If not null, the game wraps up at this time unless golfers come back. */
  awayAt: number | null;
}

export type PuttAction =
  | { type: "aim"; a: number; p: number }
  | { type: "lock"; a: number; p: number }
  | { type: "ready" };

/**
 * Tiny events instead of full views for the frequent stuff: someone locked a putt in (hole h,
 * shot s), or tapped "Next hole" on hole h's scorecard. Full views go out on phase changes.
 */
export type PuttEvent = { t: "lock"; id: string; h: number; s: number } | { t: "ready"; id: string; h: number };

const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const nameOf = (ctx: GameCtx, id: string) => ctx.player(id)?.name ?? "Someone";
const active = (b: Ball) => !b.sunk && !b.out;

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "Nobody";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const holeOf = (s: PuttState): Hole => HOLE_BY_ID[s.course[s.hole]] ?? HOLES[0];

// ---------- picking the course ----------

/** Six holes, ramping up through the tiers, with at least one windmill, portal and water hole. */
export function pickCourse(random: () => number): string[] {
  const has = (ids: string[], f: (h: Hole) => boolean) => ids.some((id) => f(HOLE_BY_ID[id]));
  let pick: string[] = [];
  for (let tries = 0; tries < 60; tries++) {
    pick = shuffle(HOLES, random)
      .slice(0, HOLES_PER_GAME)
      .map((h) => h.id);
    if (
      has(pick, (h) => !!h.mills?.length) &&
      has(pick, (h) => !!h.portals?.length) &&
      has(pick, (h) => !!h.water?.length) &&
      has(pick, (h) => h.tier === 1)
    )
      break;
  }
  // Stable sort by tier keeps the shuffled order within a tier.
  return pick.map((id, i) => ({ id, i, t: HOLE_BY_ID[id].tier })).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.id);
}

// ---------- holes ----------

function startHole(s: PuttState, ctx: GameCtx) {
  const hole = holeOf(s);
  const spots = shuffle(teeSpots(hole).slice(0, Math.max(1, s.balls.length)), ctx.random);
  s.balls.forEach((b, i) => {
    const [x, y] = spots[i % spots.length];
    b.x = x;
    b.y = y;
    b.sunk = false;
    b.out = false;
    b.strokes = 0;
    b.locked = false;
    b.aim = null;
    b.ready = false;
  });
  const now = ctx.now();
  s.shot = 1;
  s.t0 = now;
  s.roll = null;
  s.phase = "aim";
  s.endsAt = now + FIRST_AIM_MS;
  s.total = FIRST_AIM_MS;
}

/** Golfers who still have a ball to hit on this hole and are here to hit it. */
const shooters = (s: PuttState, ctx: GameCtx) => s.balls.filter((b) => active(b) && connected(ctx, b.id));

function startRoll(s: PuttState, ctx: GameCtx) {
  const now = ctx.now();
  const hole = holeOf(s);
  const from = s.balls.map((b) => [b.x, b.y, b.strokes, active(b) ? 1 : 0]);
  const shots: Shot[] = [];
  const shotRows: number[][] = [];
  s.balls.forEach((b, slot) => {
    // Away golfers sit the turn out (no stroke), unless they locked a shot in before they dropped.
    if (!active(b) || (!connected(ctx, b.id) && !b.locked)) return;
    // Every turn costs a stroke; dawdle past the clock without aiming and the ball just sits there.
    b.strokes += 1;
    const aim = b.aim;
    shots.push({ slot, a: aim?.a ?? 0, power: aim?.p ?? 0 });
    shotRows.push([slot, aim?.a ?? 0, aim?.p ?? 0]);
  });
  const bodies = s.balls.flatMap((b, slot) => (active(b) ? [{ slot, x: b.x, y: b.y }] : []));
  const sim = simulate(hole, bodies, shots, (now + REVEAL_MS - s.t0) / 1000);
  const paths: number[][][] = s.balls.map(() => []);
  const resp: number[][] = [];
  const rest: number[][] = [];
  for (const o of sim.bodies) {
    const b = s.balls[o.slot];
    paths[o.slot] = o.path;
    if (o.sunk) b.sunk = true;
    else if (!o.splashed) {
      b.x = o.x;
      b.y = o.y;
      rest.push([o.x, o.y]);
    }
  }
  // Splashed balls go back to where they were, or the nearest free spot if someone parked there.
  for (const o of sim.bodies) {
    if (!o.splashed) continue;
    const b = s.balls[o.slot];
    const [x, y] = nearestFree(hole, from[o.slot][0], from[o.slot][1], rest);
    b.x = x;
    b.y = y;
    b.strokes += 1;
    b.stats.splashes += 1;
    rest.push([x, y]);
    resp.push([o.slot, x, y]);
  }
  for (const e of sim.events) {
    const slot = e[0] === "knock" ? (e[4] as number) : (e[2] as number);
    const b = s.balls[slot];
    if (!b) continue;
    if (e[0] === "knock" && (e[6] as number) >= 120) b.stats.knocks += 1;
    else if (e[0] === "whack") b.stats.whacks += 1;
    else if (e[0] === "portal") b.stats.portals += 1;
  }
  const dur = Math.ceil(REVEAL_MS + sim.settle * STEP_MS + TAIL_MS);
  s.roll = { at: now, dur, settle: sim.settle, from, shots: shotRows, paths, ev: sim.events, resp };
  s.phase = "roll";
  s.endsAt = now + dur;
  s.total = dur;
  for (const b of s.balls) {
    b.locked = false;
    b.aim = null;
  }
}

function finishRoll(s: PuttState, ctx: GameCtx) {
  s.roll = null;
  for (const b of s.balls) if (active(b) && b.strokes >= MAX_STROKES) b.out = true;
  if (shooters(s, ctx).length === 0) return endHole(s, ctx);
  s.shot += 1;
  s.phase = "aim";
  s.endsAt = ctx.now() + AIM_MS;
  s.total = AIM_MS;
}

function endHole(s: PuttState, ctx: GameCtx) {
  for (const b of s.balls) {
    // Anyone who never finished (away, or capped) takes the pick-up score.
    const score = b.sunk ? b.strokes : PICKUP_SCORE;
    if (!b.sunk) b.out = true;
    b.card.push(score);
    if (b.sunk && b.strokes === 1) b.stats.aces += 1;
    b.ready = false;
  }
  s.roll = null;
  s.phase = "card";
  s.endsAt = ctx.now() + CARD_MS;
  s.total = CARD_MS;
}

const totalOf = (b: Ball) => b.card.reduce((a, c) => a + c, 0);

function parThrough(s: PuttState, holes: number) {
  return s.course.slice(0, holes).reduce((a, id) => a + (HOLE_BY_ID[id]?.par ?? 3), 0);
}

function finish(s: PuttState, ctx: GameCtx, reason: FinalInfo["reason"], headline: string, winners: string[]) {
  if (s.over) return;
  s.over = true;
  s.phase = "final";
  s.final = { winners, reason };
  s.roll = null;
  s.awaySince = null;
  s.endsAt = 0;
  s.total = 0;
  for (const b of s.balls) {
    b.locked = false;
    b.aim = null;
  }
  const scores: Record<string, number> = {};
  for (const b of s.balls) scores[b.id] = totalOf(b);
  ctx.end({ winners, headline, scores });
}

function lowest(balls: Ball[]): Ball[] {
  if (!balls.length) return [];
  const best = Math.min(...balls.map(totalOf));
  return balls.filter((b) => totalOf(b) === best);
}

function vsPar(strokes: number, par: number) {
  const d = strokes - par;
  return d === 0 ? "level par" : d > 0 ? `${d} over par` : `${-d} under par`;
}

function finishGame(s: PuttState, ctx: GameCtx) {
  const top = lowest(s.balls);
  const par = parThrough(s, s.course.length);
  const total = top.length ? totalOf(top[0]) : 0;
  const names = top.map((b) => nameOf(ctx, b.id));
  const headline =
    top.length === 1
      ? `${names[0]} wins Putt Panic on ${total} strokes (${vsPar(total, par)})`
      : `${joinNames(names)} tie on ${total} strokes (${vsPar(total, par)})`;
  finish(
    s,
    ctx,
    "done",
    headline,
    top.map((b) => b.id),
  );
}

function forfeit(s: PuttState, ctx: GameCtx) {
  const here = s.balls.filter((b) => connected(ctx, b.id));
  if (here.length === 1) {
    return finish(s, ctx, "forfeit", `${nameOf(ctx, here[0].id)} has the course to themselves. Everyone else left`, [here[0].id]);
  }
  const top = s.balls.some((b) => b.card.length) ? lowest(s.balls) : [];
  const names = top.map((b) => nameOf(ctx, b.id));
  finish(
    s,
    ctx,
    "forfeit",
    top.length ? `Putt Panic ends as the golfers wander off. ${joinNames(names)} had the best card` : "Putt Panic ends. Everyone left",
    top.map((b) => b.id),
  );
}

/** Track whether too few golfers are around. True when that changed. */
function updateAway(s: PuttState, ctx: GameCtx): boolean {
  if (s.over) return false;
  const short = s.balls.filter((b) => connected(ctx, b.id)).length < 2;
  if (short && s.awaySince === null) {
    s.awaySince = ctx.now();
    return true;
  }
  if (!short && s.awaySince !== null) {
    s.awaySince = null;
    return true;
  }
  return false;
}

// ---------- actions ----------

function parseShot(a: Record<string, unknown>): { a: number; p: number } | null {
  const ang = a.a;
  const pow = a.p;
  if (typeof ang !== "number" || !Number.isInteger(ang) || ang < 0 || ang >= ANGLE_STEPS) return null;
  if (typeof pow !== "number" || !Number.isInteger(pow) || pow < 1 || pow > MAX_POWER) return null;
  return { a: ang, p: pow };
}

function allLocked(s: PuttState, ctx: GameCtx) {
  const live = shooters(s, ctx);
  return live.length > 0 && live.every((b) => b.locked);
}

function allReady(s: PuttState, ctx: GameCtx) {
  const here = s.balls.filter((b) => connected(ctx, b.id));
  return here.length > 0 && here.every((b) => b.ready);
}

function nextHole(s: PuttState, ctx: GameCtx) {
  if (s.hole + 1 >= s.course.length) return finishGame(s, ctx);
  s.hole += 1;
  startHole(s, ctx);
}

// ---------- the game ----------

export const putt: GameDef<PuttState, PuttAction> = {
  id: "putt",

  setup(ctx) {
    const s: PuttState = {
      phase: "aim",
      course: pickCourse(ctx.random),
      hole: 0,
      shot: 1,
      t0: ctx.now(),
      endsAt: 0,
      total: 0,
      balls: ctx.players.map((p) => ({
        id: p.id,
        x: 0,
        y: 0,
        sunk: false,
        out: false,
        strokes: 0,
        locked: false,
        aim: null,
        ready: false,
        card: [],
        stats: { aces: 0, splashes: 0, knocks: 0, whacks: 0, portals: 0 },
      })),
      roll: null,
      final: null,
      awaySince: null,
      over: false,
    };
    startHole(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.over) return false;
    const ball = s.balls.find((b) => b.id === playerId);
    if (!ball || !action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as unknown as Record<string, unknown>;
    if (a.type === "ready") {
      if (s.phase !== "card" || ball.ready) return false;
      ball.ready = true;
      if (allReady(s, ctx)) {
        nextHole(s, ctx);
        return true;
      }
      ctx.emit({ t: "ready", id: ball.id, h: s.hole } satisfies PuttEvent);
      return false;
    }
    if (s.phase !== "aim" || !active(ball) || ball.locked) return false;
    if (a.type === "aim") {
      const shot = parseShot(a);
      // Only you can see your pending shot, and your screen already shows it: no broadcast.
      if (shot) ball.aim = shot;
      return false;
    }
    if (a.type === "lock") {
      const shot = parseShot(a);
      if (!shot) return false;
      ball.aim = shot;
      ball.locked = true;
      if (allLocked(s, ctx)) {
        startRoll(s, ctx);
        return true;
      }
      // Everyone just needs to know a putt is locked in (the aim stays secret): a tiny event will do.
      ctx.emit({ t: "lock", id: ball.id, h: s.hole, s: s.shot } satisfies PuttEvent);
      return false;
    }
    return false;
  },

  tick(s, ctx) {
    if (s.over) return false;
    const now = ctx.now();
    let changed = updateAway(s, ctx);
    if (s.awaySince !== null && now >= s.awaySince + FORFEIT_MS && s.phase !== "roll") {
      forfeit(s, ctx);
      return true;
    }
    if (s.phase === "aim") {
      if (shooters(s, ctx).length === 0) {
        endHole(s, ctx);
        changed = true;
      } else if (now >= s.endsAt || allLocked(s, ctx)) {
        startRoll(s, ctx);
        changed = true;
      }
    } else if (s.phase === "roll" && now >= s.endsAt) {
      finishRoll(s, ctx);
      changed = true;
    } else if (s.phase === "card" && (now >= s.endsAt || allReady(s, ctx))) {
      nextHole(s, ctx);
      changed = true;
    }
    return changed;
  },
  tickMs: 200,

  playerLeft(s, _id, ctx) {
    updateAway(s, ctx);
  },

  playerReturned(s, _id, ctx) {
    updateAway(s, ctx);
  },

  view(s, viewerId): PuttView {
    const mine = s.balls.find((b) => b.id === viewerId);
    return {
      phase: s.phase,
      course: s.course,
      hole: s.hole,
      shot: s.shot,
      t0: s.t0,
      endsAt: s.endsAt,
      total: s.total,
      balls: s.balls.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        sunk: b.sunk,
        out: b.out,
        strokes: b.strokes,
        locked: b.locked,
        ready: b.ready,
        card: b.card,
        stats: b.stats,
      })),
      aim: s.phase === "aim" && mine?.aim ? { ...mine.aim } : null,
      roll: s.phase === "roll" ? s.roll : null,
      final: s.final,
      awayAt: s.awaySince === null || s.over ? null : s.awaySince + FORFEIT_MS,
    };
  },
};

export default putt;
