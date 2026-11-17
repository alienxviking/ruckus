// Run with: npx tsx games/puck/puck.test.ts
import { assert, makeTestCtx } from "../../shared/testing";
import puck, { type PuckState } from "./server";
import { stepPuck, type Kin, type Sweep } from "./physics";
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
  TICK_MS,
  W,
  isSnap,
  zoneRect,
  type PuckView,
  type Snap,
} from "./shared";
import type { Settings } from "../../shared/settings";

type T = ReturnType<typeof makeTestCtx>;

function setup(n: number, seed = 7, settings: Settings = {}, bots = 0) {
  const t = makeTestCtx(n, seed, settings, bots);
  const s = puck.setup(t.ctx);
  return { t, s };
}
const view = (s: PuckState, t: T, who = "p0") => puck.view(s, who, t.ctx) as PuckView;
function step(s: PuckState, t: T) {
  t.advance(TICK_MS);
  puck.tick!(s, t.ctx);
}
function run(s: PuckState, t: T, ms: number) {
  for (let left = ms; left > 0; left -= TICK_MS) step(s, t);
}
/** Run with every bot acting, like the room does, until the game ends or `ms` passes. */
function runBots(s: PuckState, t: T, ms: number) {
  for (let left = ms; left > 0 && !t.result; left -= TICK_MS) {
    for (const p of t.ctx.players) {
      if (!p.bot) continue;
      const a = puck.bot!(s, p.id, t.ctx);
      if (a) puck.action(s, p.id, a, t.ctx);
    }
    step(s, t);
  }
}

/** Put the puck where we want it, live. */
function place(s: PuckState, x: number, y: number, vx: number, vy: number) {
  s.phase = "live";
  s.endsAt = 0;
  s.puck = { x, y, vx, vy };
  s.half = y >= MID ? 0 : 1;
}

// ----- physics: no tunnelling at top speed -----
{
  const sp = SPEEDS.turbo;
  for (const speed of [400, 1200, sp.max]) {
    // Puck flying straight at a still paddle.
    const p: Kin = { x: 300, y: 300, vx: 0, vy: speed };
    const pad: Sweep = { slot: 0, x0: 300, y0: 700, x1: 300, y1: 700, r: PADDLE_R };
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      stepPuck(p, [pad], sp.max, 1, (k) => (k === 0 ? hits++ : 0));
      if (p.y > 700) break;
    }
    assert(hits >= 1 && p.y < 700, `puck at ${speed} bounced off the paddle (y=${p.y.toFixed(0)})`);
  }
  // A paddle flicked at full speed through a still puck: it must hit it, not jump past.
  const p: Kin = { x: 300, y: 600, vx: 0, vy: 0 };
  // Full speed: 30 units a substep, starting just short of the puck.
  const pad: Sweep = { slot: 0, x0: 300, y0: 600 + PADDLE_R + PUCK_R + 10, x1: 300, y1: 600 + PADDLE_R + PUCK_R - 20, r: PADDLE_R };
  let hit = 0;
  stepPuck(p, [pad], SPEEDS.normal.max, 1, (k, _s, _x, _y, power) => (k === 0 ? (hit = power) : 0));
  assert(hit > 0 && p.vy < -1000, "a fast flick hits the puck hard");
  assert(p.y <= pad.y1 - PADDLE_R - PUCK_R + 0.5, "the flicked puck ends up ahead of the paddle");
  // Paddle speed transfers into the puck.
  const q: Kin = { x: 300, y: 500, vx: 0, vy: 0 };
  stepPuck(q, [{ slot: 0, x0: 300, y0: 570, x1: 300, y1: 555, r: PADDLE_R }], 2000, 1);
  assert(q.vy < -1000, "a moving paddle sends the puck flying");
  // Walls bounce with some damping; goals score.
  const w: Kin = { x: 30, y: 300, vx: -800, vy: 0 };
  stepPuck(w, [], 2000, 1);
  assert(w.vx > 0 && w.vx < 800, "side wall bounce is damped");
  const g: Kin = { x: W / 2, y: 30, vx: 0, vy: -1500 };
  let scored = -1;
  for (let i = 0; i < 20 && scored < 0; i++) scored = stepPuck(g, [], 2000, 1);
  assert(scored === 0, "a puck into the top goal scores for the bottom team");
  const e: Kin = { x: 60, y: 30, vx: 0, vy: -1500 };
  for (let i = 0; i < 20; i++) assert(stepPuck(e, [], 2000, 1) < 0, "end wall outside the mouth is solid");
  console.log("✓ physics: sweeps, transfer, walls, goals");
}

// ----- setup & teams -----
{
  const { t, s } = setup(2);
  const v = view(s, t);
  assert(v.ids.length === 2 && v.team[0] !== v.team[1], "1v1 on opposite sides");
  assert(v.zone.every((z) => z === "all") && v.r.every((r) => r === PADDLE_R), "1v1 paddles");
  assert(v.phase === "set" && v.target === 7 && v.speed === "normal", "defaults");
  assert(isSnap(v.snap), "view carries a snapshot");
  const s3 = setup(3, 11);
  const v3 = view(s3.s, s3.t);
  const counts = [0, 1].map((tm) => v3.team.filter((x) => x === tm).length).sort();
  assert(counts.join() === "1,2", "3 players: 2v1");
  const solo = v3.team.findIndex((tm) => v3.team.filter((x) => x === tm).length === 1);
  assert(v3.r[solo] === BIG_PADDLE_R && v3.zone[solo] === "all", "the solo side gets a big paddle");
  const s4 = setup(4, 5);
  const v4 = view(s4.s, s4.t);
  for (const tm of [0, 1]) {
    const zones = v4.zone.filter((_, i) => v4.team[i] === tm).sort();
    assert(zones.join() === "back,fwd", "2v2: a forward and a back on each side");
  }
  console.log("✓ teams: 1v1, 2v1, 2v2");
}

// ----- settings honoured -----
{
  const { t, s } = setup(2, 3, { goals: 5, speed: "turbo" });
  assert(view(s, t).target === 5 && view(s, t).speed === "turbo", "settings read");
  const bad = setup(2, 3, { goals: 99, speed: "warp" });
  assert(view(bad.s, bad.t).target === 7 && view(bad.s, bad.t).speed === "normal", "bad settings fall back");
  // Turbo really is faster.
  const sp = SPEEDS.turbo.max;
  place(s, W / 2, 300, 0, 0);
  const slot = s.team.indexOf(1);
  s.pads[slot].x = s.pads[slot].tx = W / 2;
  s.pads[slot].y = s.pads[slot].ty = 300 - 70;
  puck.action(s, s.ids[slot], { type: "m", x: W / 2, y: 480 }, t.ctx);
  step(s, t);
  assert(Math.hypot(s.puck.vx, s.puck.vy) > SPEEDS.normal.max * 0.9 && Math.hypot(s.puck.vx, s.puck.vy) <= sp + 1, "turbo puck speed");
  console.log("✓ settings: goals and speed");
}

// ----- invalid actions -----
{
  const { t, s } = setup(2);
  const before = JSON.stringify(s.pads);
  const junk: unknown[] = [null, 5, "m", [], {}, { type: "x" }, { type: "m" }, { type: "m", x: 1.5, y: 2 }, { type: "m", x: "1", y: 2 },
    { type: "m", x: NaN, y: 1 }, { type: "m", x: Infinity, y: 1 }, { type: "m", x: 1e9, y: 1 }, { type: "__proto__" }];
  for (const a of junk) puck.action(s, "p0", a as never, t.ctx);
  puck.action(s, "stranger", { type: "m", x: 10, y: 10 }, t.ctx);
  assert(JSON.stringify(s.pads) === before, "junk changes nothing");
  // A valid move is clamped into the player's own zone.
  puck.action(s, "p0", { type: "m", x: -400, y: 4000 }, t.ctx);
  const r = zoneRect(s.team[0], s.zone[0], s.r[0]);
  assert(s.pads[0].tx === r.x0 && s.pads[0].ty === r.y1, "targets clamp to the zone");
  run(s, t, 400);
  assert(s.pads[0].x >= r.x0 && s.pads[0].y <= r.y1 && s.pads[0].y >= r.y0, "paddle stays in its zone");
  console.log("✓ invalid actions rejected, zones enforced");
}

// ----- a goal, the celebration, and the faceoff on the conceding side -----
{
  const { t, s } = setup(2, 9);
  run(s, t, START_MS + 100);
  assert(s.phase === "live", "live after the countdown");
  const top = s.team.indexOf(1);
  // Clear the way and fire it into the top goal.
  s.pads[top].x = s.pads[top].tx = 60;
  s.pads[top].y = s.pads[top].ty = 100;
  place(s, W / 2, 200, 0, -1500);
  s.lastTouch = s.team.indexOf(0);
  run(s, t, 400);
  let v = view(s, t);
  assert(v.score[0] === 1 && v.phase === "goal", "goal counted");
  assert(v.goals[s.team.indexOf(0)] === 1 && v.log[0].slot === s.team.indexOf(0), "scorer credited");
  run(s, t, GOAL_MS + 100);
  v = view(s, t);
  assert(v.phase === "set" && v.snap.p[1] < MID, "faceoff on the side that conceded (top)");
  run(s, t, SET_MS + 100);
  assert(view(s, t).phase === "live", "back to live");
  // Own goal: last touched by the defending side.
  const bottom = s.team.indexOf(0);
  s.pads[bottom].x = s.pads[bottom].tx = 60;
  s.pads[bottom].y = s.pads[bottom].ty = H - 100;
  place(s, W / 2, H - 200, 0, 1500);
  s.lastTouch = bottom;
  run(s, t, 400);
  v = view(s, t);
  assert(v.score[1] === 1 && v.log[1].slot === -1, "own goal scores for the other side, credited to nobody");
  console.log("✓ goals, own goals, faceoffs");
}

// ----- the 7-second rule -----
{
  const { t, s } = setup(2, 4);
  run(s, t, START_MS + 100);
  for (let i = 0; i < 2; i++) {
    s.pads[i].tx = 40;
    s.pads[i].ty = s.team[i] === 0 ? H - 40 : 40;
  }
  place(s, W / 2, MID + 200, 0, 0);
  s.halfAt = s.simAt + s.steps * SUB_MS;
  run(s, t, HALF_MS + 200);
  const v = view(s, t);
  assert(v.handed === 1 && v.snap.p[1] < MID, "puck parked in one half goes to the other side");
  console.log("✓ 7-second rule");
}

// ----- a full game to completion (scripted shots) -----
{
  const { t, s } = setup(2, 21, { goals: 5 });
  run(s, t, START_MS + 100);
  const top = s.team.indexOf(1);
  const bottom = s.team.indexOf(0);
  let guard = 0;
  while (!t.result && guard++ < 300) {
    if (s.phase === "live") {
      s.pads[top].tx = 60;
      s.pads[top].ty = 60;
      place(s, W / 2, 250, 0, -1400);
      s.lastTouch = bottom;
    }
    run(s, t, 300);
  }
  assert(t.result, "game ended");
  assert(t.result.winners.length === 1 && t.result.winners[0] === s.ids[bottom], "winner is the scoring side");
  assert(t.result.scores?.[s.ids[bottom]] === 5, "scores are goals");
  assert(/wins 5–0/.test(t.result.headline), `headline: ${t.result.headline}`);
  const v = view(s, t);
  assert(v.phase === "final" && v.champions === 0, "final view");
  const n = t.events.length;
  run(s, t, 2000);
  assert(puck.action(s, s.ids[0], { type: "m", x: 1, y: 1 }, t.ctx) === false, "no actions after the end");
  assert(t.events.length - n < 50, "quiet after the end");
  console.log("✓ full game to 5");
}

// ----- 2v2 winners are the whole team -----
{
  const { t, s } = setup(4, 8, { goals: 5 });
  run(s, t, START_MS + 100);
  let guard = 0;
  while (!t.result && guard++ < 300) {
    if (s.phase === "live") {
      s.pads.forEach((p, i) => {
        if (s.team[i] === 1) {
          p.tx = 40;
          p.ty = 40;
        }
      });
      place(s, W / 2, 250, 0, -1400);
    }
    run(s, t, 300);
  }
  assert(t.result && t.result.winners.length === 2, "both teammates win");
  assert(t.result.winners.every((id) => s.team[s.ids.indexOf(id)] === 0), "winners are team 0");
  console.log("✓ 2v2 team win");
}

// ----- bots finish games -----
for (const [n, bots] of [
  [2, 2],
  [4, 4],
  [3, 3],
] as const) {
  const { t, s } = setup(n, 13 + n, { goals: 5 }, bots);
  runBots(s, t, 15 * 60_000);
  assert(t.result, `${n} bots finish a game (score ${s.score.join("-")})`);
  const ms = (s.steps * SUB_MS) / 1000;
  console.log(`✓ ${n} bots finished ${s.score.join("–")} in ${ms.toFixed(0)}s of play`);
}
// A bot beats a do-nothing human now and then, and the human side never wins by standing still.
{
  const { t, s } = setup(2, 31, { goals: 5 }, 1);
  runBots(s, t, 15 * 60_000);
  assert(t.result && t.result.winners[0] === "bot-0", "a bot beats an idle player");
  console.log("✓ bot beats an idle player");
}

// ----- leaving doesn't soft-lock -----
{
  const { t, s } = setup(2, 2);
  run(s, t, START_MS + 100);
  t.ctx.players[1].connected = false;
  puck.playerLeft!(s, "p1", t.ctx);
  const home = s.pads[1];
  assert(view(s, t).abandonAt !== null, "abandon countdown shown");
  run(s, t, 3000);
  t.ctx.players[1].connected = true;
  puck.playerReturned!(s, "p1", t.ctx);
  assert(view(s, t).abandonAt === null, "returning cancels it");
  t.ctx.players[1].connected = false;
  puck.playerLeft!(s, "p1", t.ctx);
  run(s, t, ABANDON_MS + 500);
  assert(t.result && t.result.winners.join() === "p0", "the side left behind wins by forfeit");
  assert(Math.abs(home.y - home.ty) < 2, "the absent paddle went home");
  // In 2v2 one leaver doesn't end anything.
  const g = setup(4, 6);
  run(g.s, g.t, START_MS + 100);
  g.t.ctx.players[0].connected = false;
  puck.playerLeft!(g.s, "p0", g.t.ctx);
  run(g.s, g.t, ABANDON_MS + 500);
  assert(!g.t.result, "a team with someone left plays on");
  // Everyone gone: ends anyway.
  for (const p of g.t.ctx.players) {
    p.connected = false;
    puck.playerLeft!(g.s, p.id, g.t.ctx);
  }
  run(g.s, g.t, ABANDON_MS + 500);
  assert((g.t.result as { winners: string[] } | null)?.winners.length === 0, "an empty table ends as a draw at 0-0");
  console.log("✓ leaving and returning");
}

// ----- traffic: identical frames are skipped, snapshots are small -----
{
  const { t, s } = setup(2, 1);
  run(s, t, START_MS + 500);
  const before = t.events.length;
  run(s, t, 3000);
  const snaps = t.events.slice(before).map((e) => e.event).filter(isSnap) as Snap[];
  assert(snaps.length <= 8, `still table sends only heartbeats (${snaps.length})`);
  for (const sn of snaps) assert(JSON.stringify(sn).length < 200, "small snapshot");
  console.log("✓ quiet table is quiet");
}

console.log("✓ puck: all tests passed");
