// Run with: npx tsx games/sumo/sumo.test.ts
import { assert, makeTestCtx } from "../../shared/testing";
import sumo, { collide, type SumoState, type SumoView } from "./server";
import { newScene, pushFrame, sampleDisc, type Sample } from "./rink";
import { SumoPredictor, worldOfSnap, type PredictedContact } from "./predict";
import { Timeline } from "../snakes/netsmooth";
import { WIFI, WIFI_BAD, burstyLink, type BurstyOptions } from "../snakes/netsim";
import {
  ABANDON_MS,
  CENTER,
  COUNTDOWN_MS,
  DASH_CD_MS,
  DISC_R,
  F_HEAVY,
  F_OFFLINE,
  FX_DASH,
  FX_FALL,
  FX_HIT,
  FX_PICKUP,
  HEAVY_MASS,
  MAX_ROUNDS,
  POWER_FIRST_MS,
  POWER_INFO,
  RINK_MIN,
  RINK_R,
  ROUND_OVER_MS,
  SPAWN_R,
  TICK_MS,
  TURBO_CD_MS,
  WINS_NEEDED,
  rinkRadius,
  type Snap,
} from "./shared";

type T = ReturnType<typeof makeTestCtx>;

function setup(n: number, seed = 7) {
  const t = makeTestCtx(n, seed);
  let ends = 0;
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    ends += 1;
    end(r);
  };
  const s = sumo.setup(t.ctx);
  return { t, s, ends: () => ends };
}

const view = (s: SumoState, t: T, who = "p0") => sumo.view(s, who, t.ctx) as SumoView;

/** Advance one tick; returns tick()'s result. */
function step(s: SumoState, t: T) {
  t.advance(TICK_MS);
  return sumo.tick!(s, t.ctx);
}

/** Tick for `ms` of game time. */
function run(s: SumoState, t: T, ms: number) {
  for (let left = ms; left > 0; left -= TICK_MS) step(s, t);
}

function startFight(s: SumoState, t: T) {
  t.advance(COUNTDOWN_MS);
  assert(sumo.tick!(s, t.ctx) === true, "countdown -> fight returns true");
  assert(s.phase === "fight", "fight started");
}

/** Read through a function so TypeScript doesn't narrow across ticks. */
const phaseOf = (s: SumoState): string => s.phase;
const powerOf = (s: SumoState) => s.power;
const snaps = (t: T) => t.events.map((e) => e.event as Snap).filter((e) => e && e.k === "s");
const finite = (s: SumoState) => s.discs.every((d) => [d.x, d.y, d.vx, d.vy].every(Number.isFinite));

/** Steer disc `slot` toward (x, y) with a simple PD controller (test bot). */
function steer(s: SumoState, t: T, slot: number, x: number, y: number) {
  const d = s.discs[slot];
  let ix = (x - d.x) * 0.9 - d.vx * 0.45;
  let iy = (y - d.y) * 0.9 - d.vy * 0.45;
  const m = Math.hypot(ix, iy);
  if (m > 100) [ix, iy] = [(ix / m) * 100, (iy / m) * 100];
  sumo.action(s, s.ids[slot], { type: "input", x: Math.round(ix), y: Math.round(iy) }, t.ctx);
}

// ---------- setup & spawning ----------
{
  for (const n of [2, 5, 8]) {
    const { s, t } = setup(n);
    assert(s.phase === "countdown" && s.round === 1, "starts in countdown");
    assert(s.endsAt === t.ctx.now() + COUNTDOWN_MS, "countdown deadline");
    for (const d of s.discs) {
      const r = Math.hypot(d.x - CENTER, d.y - CENTER);
      assert(Math.abs(r - SPAWN_R) < 1e-6, "spawned on the spawn circle");
      assert(Math.abs(Math.hypot(d.fx, d.fy) - 1) < 1e-9, "facing is a unit vector");
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const gap = Math.hypot(s.discs[i].x - s.discs[j].x, s.discs[i].y - s.discs[j].y);
        assert(gap > DISC_R * 2 + 60, `discs spawn well apart (${n} players)`);
      }
    }
    const v = view(s, t);
    assert(v.snap.p.length === n && v.snap.r === RINK_R, "view carries the opening snapshot");
    const json = JSON.stringify(v);
    assert(!json.includes("undefined") && JSON.stringify(JSON.parse(json)) === json, "view is plain JSON");
    assert(JSON.stringify(view(s, t, "spectator")) === json, "spectators see the public view");
  }
}

// ---------- countdown: inputs are stored, nothing moves; dashes rejected ----------
{
  const { s, t } = setup(2);
  const x0 = s.discs[0].x;
  assert(sumo.action(s, "p0", { type: "input", x: 100, y: 0 }, t.ctx) === false, "input never re-broadcasts");
  assert(s.discs[0].ix === 1 && s.discs[0].iy === 0, "input stored during the countdown");
  assert(sumo.action(s, "p0", { type: "dash" }, t.ctx) === false && !s.discs[0].dashQueued, "no dash in countdown");
  for (let i = 0; i < 10; i++) assert(step(s, t) === false, "countdown ticks quiet");
  assert(s.discs[0].x === x0, "nothing moves in the countdown");
  assert(snaps(t).length === 0, "no snapshots during the countdown");
  t.advance(COUNTDOWN_MS);
  assert(sumo.tick!(s, t.ctx) === true && s.phase === "fight", "countdown -> fight");
  assert(view(s, t).fightAt === t.ctx.now(), "fight start in view");
  step(s, t);
  assert(s.discs[0].x > x0, "held input works the moment the fight starts");
}

// ---------- rink shrink ----------
{
  assert(rinkRadius(0) === RINK_R && rinkRadius(15_000) === RINK_R, "stable for 15s");
  assert(Math.abs(rinkRadius(35_000) - (RINK_R + RINK_MIN) / 2) < 1e-9, "halfway at 35s");
  assert(rinkRadius(55_000) === RINK_MIN, "160 at 55s");
  assert(rinkRadius(60_000) < RINK_MIN && rinkRadius(60_000) > 100, "sudden death keeps shrinking");
  assert(rinkRadius(1e9) === 0, "never negative");
  const { s, t } = setup(2);
  startFight(s, t);
  // Keep both discs safe near the centre while the clock runs.
  for (let i = 0; i < 700; i++) {
    steer(s, t, 0, CENTER - 40, CENTER);
    steer(s, t, 1, CENTER + 40, CENTER);
    step(s, t);
    const ms = t.ctx.now() - s.fightAt;
    if (ms === 15_000) assert(s.snap.r === RINK_R, "still full size at 15s");
    if (ms === 35_000) assert(Math.abs(s.snap.r - 300) <= 0.2, `shrinking at 35s (${s.snap.r})`);
    if (s.phase !== "fight") break;
  }
  assert(finite(s), "no NaN after a long fight");
}

// ---------- physics: acceleration, top speed, friction, determinism ----------
{
  const run1 = () => {
    const { s, t } = setup(3, 99);
    startFight(s, t);
    sumo.action(s, "p0", { type: "input", x: 60, y: -80 }, t.ctx);
    sumo.action(s, "p1", { type: "input", x: -100, y: 0 }, t.ctx);
    run(s, t, 400);
    sumo.action(s, "p1", { type: "dash" }, t.ctx);
    run(s, t, 1200);
    return JSON.stringify(s.discs) + JSON.stringify(s.snap);
  };
  assert(run1() === run1(), "physics is deterministic");

  const { s, t } = setup(2, 3);
  startFight(s, t);
  const d = s.discs[0];
  // Move p1 out of the way, park p0 at the far side and floor it across the rink.
  s.discs[1].x = CENTER;
  s.discs[1].y = CENTER - 300;
  d.x = CENTER - 400;
  d.y = CENTER;
  sumo.action(s, "p0", { type: "input", x: 100, y: 0 }, t.ctx);
  let top = 0;
  for (let i = 0; i < 16; i++) {
    step(s, t);
    top = Math.max(top, Math.hypot(d.vx, d.vy));
  }
  assert(top > 400 && top <= 480 + 1e-9, `top speed is capped near 480 (${top})`);
  sumo.action(s, "p0", { type: "input", x: 0, y: 0 }, t.ctx);
  const v0 = Math.hypot(d.vx, d.vy);
  run(s, t, 1000);
  const v1 = Math.hypot(d.vx, d.vy);
  assert(v1 < v0 * 0.7 && v1 > v0 * 0.5, `ice friction: ~0.62/s (${(v1 / v0).toFixed(3)})`);
  assert(finite(s), "no NaN");
}

// ---------- collisions: symmetry, momentum, energy sanity, mass ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  const [a, b] = s.discs;
  Object.assign(a, { x: 450, y: 500, vx: 300, vy: 40 });
  Object.assign(b, { x: 550, y: 500, vx: -300, vy: 40 });
  // Overlapping and approaching.
  a.x = 471;
  b.x = 529;
  const keBefore = 0.5 * (a.vx ** 2 + a.vy ** 2 + b.vx ** 2 + b.vy ** 2);
  const t0 = s.fightAt + 100;
  collide(s, a, b, t0);
  assert(Math.abs(a.x - 1000 + b.x) < 1e-9 && a.y === b.y, "positions stay mirrored");
  assert(Math.abs(a.vx + b.vx) < 1e-9 && Math.abs(a.vy - b.vy) < 1e-9, "velocities stay mirrored");
  assert(a.vx < 0 && b.vx > 0, "they bounce apart");
  assert(Math.abs(a.vx + b.vx) < 1e-9, "momentum conserved (equal masses)");
  assert(Math.abs(b.x - a.x - 2 * DISC_R) < 1e-9, "no overlap left");
  const keAfter = 0.5 * (a.vx ** 2 + a.vy ** 2 + b.vx ** 2 + b.vy ** 2);
  assert(
    keAfter > keBefore && keAfter < keBefore * 1.35,
    `bouncy but sane energy (${(keAfter / keBefore).toFixed(3)})`,
  );
  assert(Math.abs(Math.abs(a.vx) - 300 * 1.15) < 1e-6, "restitution 1.15 on a real hit");
  const hit = s.fx.find((f) => f[0] === FX_HIT);
  assert(hit && hit[3] > 300, "impact effect recorded");
  assert(a.hitBy === 1 && b.hitBy === 0, "both remember who shoved them");

  // A gentle shove is soft (no ping-pong when leaning on each other).
  Object.assign(a, { x: 470, y: 500, vx: 20, vy: 0 });
  Object.assign(b, { x: 529, y: 500, vx: 0, vy: 0 });
  s.fx = [];
  collide(s, a, b, t0);
  assert(b.vx > 0 && b.vx < 20 && a.vx > 0, "slow pushes barely bounce");
  assert(s.fx.length === 0, "no spark for a gentle shove");

  // Mass matters: a heavy disc ploughs through a normal one.
  Object.assign(a, { x: 470, y: 500, vx: 300, vy: 0, heavyUntil: t0 + 5000 });
  Object.assign(b, { x: 535, y: 500, vx: 0, vy: 0 });
  collide(s, a, b, t0);
  assert(a.vx > 0, "heavy disc keeps going");
  assert(b.vx > 300 * 1.2, "light disc goes flying");
  const p = a.vx * HEAVY_MASS + b.vx;
  assert(Math.abs(p - 300 * HEAVY_MASS) < 1e-6, "momentum conserved with unequal masses");
  assert(Math.abs(b.x - a.x - DISC_R * 2.25) < 1e-9, "heavy disc is bigger");

  // Exactly overlapping discs still separate cleanly.
  Object.assign(a, { x: 500, y: 500, vx: 0, vy: 0, heavyUntil: 0 });
  Object.assign(b, { x: 500, y: 500, vx: 0, vy: 0 });
  collide(s, a, b, t0);
  assert(finite(s) && Math.hypot(a.x - b.x, a.y - b.y) > 59, "coincident discs separate");
}

// ---------- snapshots: one per tick as an event, small, idle frames skipped ----------
{
  const { s, t } = setup(8);
  startFight(s, t);
  t.events.length = 0;
  // Nothing moves: only heartbeats go out.
  for (let i = 0; i < 35; i++) assert(step(s, t) === false, "fight ticks return false");
  const idle = snaps(t);
  assert(idle.length >= 1 && idle.length <= 3, `idle frames are skipped (${idle.length} in 1.75s)`);
  t.events.length = 0;
  s.ids.forEach((id, i) => sumo.action(s, id, { type: "input", x: i % 2 ? 100 : -100, y: i % 3 ? 60 : -60 }, t.ctx));
  step(s, t);
  const first = snaps(t)[0];
  assert(first && first.q === 1, "first frame after a quiet spell is flagged");
  // Every tick sends a frame: an event, or the view when someone falls in.
  let viaView = 0;
  for (let i = 0; i < 20; i++) if (step(s, t)) viaView += 1;
  const live = snaps(t);
  assert(live.length + viaView === 21, `one frame per tick while things move (${live.length}+${viaView})`);
  assert(live.length >= 15, "mostly plain snapshot events");
  assert(
    live.every((e, i) => i === 0 || (e.t - live[i - 1].t) % TICK_MS === 0),
    "frames sit on the 50ms grid",
  );
  assert(
    live.every((e) => e.p.every((d) => d.length >= 5 && d.length <= 8 && d.every(Number.isInteger))),
    "ints only",
  );
  const env = (e: Snap) => JSON.stringify({ t: "ev", e, now: e.t }).length;
  const biggest = Math.max(...live.map(env));
  assert(biggest < 380, `snapshot stays small with 8 players (${biggest} bytes)`);
  assert(biggest * (1000 / TICK_MS) < 8 * 1024, "under 8 KB/s per client");
  assert(
    t.events.every((e) => e.to === undefined && e.except === undefined),
    "snapshots go to everyone",
  );
}

// ---------- dash & cooldown, turbo ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  const d = s.discs[0];
  const [fx, fy] = [d.fx, d.fy];
  // p1 waits off to the side, out of the dash's path.
  Object.assign(s.discs[1], { x: CENTER - fy * 300, y: CENTER + fx * 300 });
  assert(sumo.action(s, "p0", { type: "dash" }, t.ctx) === false && d.dashQueued, "dash queued");
  assert(sumo.action(s, "p0", { type: "dash" }, t.ctx) === false, "second dash ignored");
  t.events.length = 0;
  step(s, t);
  const sp = Math.hypot(d.vx, d.vy);
  assert(sp > 480 && sp < 650, `dash bursts past top speed (${sp.toFixed(0)})`);
  assert((d.vx * fx + d.vy * fy) / sp > 0.99, "with no stick, dash goes where the disc faces");
  const dashFx = snaps(t)[0]?.fx?.find((f) => f[0] === FX_DASH);
  assert(dashFx && dashFx[1] === 0, "dash effect in the snapshot");
  assert((snaps(t)[0].p.find((p) => p[0] === 0)![6] ?? 0) > 20, "cooldown sent in the snapshot");
  run(s, t, 600);
  assert(Math.hypot(d.vx, d.vy) <= 480, "dash speed bleeds back to the cap");
  Object.assign(d, { x: CENTER, y: CENTER, vx: 0, vy: 0 }); // before it coasts into the water
  sumo.action(s, "p0", { type: "dash" }, t.ctx);
  assert(!d.dashQueued, "still cooling down");
  run(s, t, DASH_CD_MS);
  sumo.action(s, "p0", { type: "input", x: 0, y: -100 }, t.ctx);
  sumo.action(s, "p0", { type: "dash" }, t.ctx);
  assert(d.dashQueued, "dash ready again after 2.5s");
  const vy0 = d.vy;
  step(s, t);
  assert(d.vy < vy0 - 500, "dash follows the stick");
  // Turbo: 0.6s cooldown.
  sumo.action(s, "p0", { type: "input", x: 0, y: 0 }, t.ctx);
  Object.assign(d, { x: CENTER, y: CENTER, vx: 0, vy: 0 });
  d.turboUntil = t.ctx.now() + POWER_INFO.turbo.ms;
  run(s, t, DASH_CD_MS);
  sumo.action(s, "p0", { type: "dash" }, t.ctx);
  assert(
    d.dashReadyAt - t.ctx.now() === TURBO_CD_MS,
    `turbo cooldown ${d.dashReadyAt - t.ctx.now()} alive=${d.alive} q=${d.dashQueued} turbo=${d.turboUntil - t.ctx.now()} phase=${s.phase}`,
  );
  // A dead disc can't dash.
  d.alive = false;
  d.dashQueued = false;
  run(s, t, 1000);
  sumo.action(s, "p0", { type: "dash" }, t.ctx);
  assert(!d.dashQueued, "fallen discs can't dash");
}

// ---------- falling off: elimination, knockout credit, round end ----------
{
  const { s, t } = setup(3);
  startFight(s, t);
  const [a, b] = s.discs;
  // a slams b toward the edge.
  Object.assign(b, { x: CENTER + 380, y: CENTER, vx: 0, vy: 0 });
  Object.assign(a, { x: CENTER + 300, y: CENTER, vx: 450, vy: 0 });
  s.discs[2].x = CENTER - 200;
  s.discs[2].y = CENTER;
  t.events.length = 0;
  let changed = false;
  for (let i = 0; i < 20 && b.alive; i++) changed = step(s, t) || changed;
  assert(!b.alive, "b fell off the edge");
  assert(changed, "a fall re-sends the view");
  const v = view(s, t);
  assert(v.falls.length === 1 && v.falls[0].s === 1 && v.falls[0].by === 0, "fall credited to the shover");
  assert(v.kos[0] === 1, "knockout counted");
  assert(!v.snap.p.some((p) => p[0] === 1), "fallen disc gone from the snapshot");
  const fall =
    v.snap.fx?.find((f) => f[0] === FX_FALL) ??
    snaps(t)
      .flatMap((e) => e.fx ?? [])
      .find((f) => f[0] === FX_FALL);
  assert(fall && fall[1] === 1 && fall[6] === 0, "fall effect with the shover");
  // Can't come back this round.
  sumo.action(s, "p1", { type: "input", x: -100, y: 0 }, t.ctx);
  run(s, t, 500);
  assert(!b.alive, "no coming back this round");
  assert(s.phase === "fight", "two still on the ice");
  // Slip off alone: no credit.
  Object.assign(s.discs[2], { x: CENTER - 430, vx: -300, hitBy: -1 });
  for (let i = 0; i < 10 && phaseOf(s) === "fight"; i++) step(s, t);
  assert(phaseOf(s) === "roundOver", "one left: round over");
  const v2 = view(s, t);
  assert(v2.lastWinner !== null && v2.lastWinner === s.ids[s.discs.findIndex((d) => d.alive)], "survivor wins");
  assert(v2.falls[1].by === -1, "slipping off alone credits nobody");
  assert(v2.history[0].order.join() === "1,2", "fall order recorded");
}

// ---------- after the round is decided: the winner brakes and stays on the ice ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  const [a, b] = s.discs;
  sumo.action(s, "p0", { type: "input", x: 100, y: 0 }, t.ctx);
  Object.assign(a, { x: CENTER + 300, y: CENTER, vx: 480, vy: 0 });
  Object.assign(b, { x: CENTER - 435, y: CENTER, vx: -300, vy: 0 });
  step(s, t);
  assert(phaseOf(s) === "roundOver" && view(s, t).lastWinner === "p0", "p0 wins the round");
  assert(sumo.action(s, "p0", { type: "dash" }, t.ctx) === false && !a.dashQueued, "no dashing after the round");
  run(s, t, 1500);
  assert(a.alive && Math.hypot(a.x - CENTER, a.y - CENTER) <= RINK_R, "the winner can't slide off any more");
  assert(Math.hypot(a.vx, a.vy) < 1, "and brakes to a stop");
  assert(s.history[0].winner === "p0" && s.wins[0] === 1, "result stands");
}

// ---------- draw when the last discs fall in the same tick ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  const [a, b] = s.discs;
  Object.assign(a, { x: CENTER - 435, y: CENTER, vx: -400, vy: 0 });
  Object.assign(b, { x: CENTER + 435, y: CENTER, vx: 400, vy: 0 });
  step(s, t);
  assert(s.phase === "roundOver", "round over");
  assert(view(s, t).lastWinner === null && s.wins.every((w) => w === 0), "draw: nobody scores");
  t.advance(ROUND_OVER_MS);
  assert(sumo.tick!(s, t.ctx) === true && phaseOf(s) === "countdown" && s.round === 2, "next round");
  assert(
    s.discs.every((d) => d.alive),
    "everyone back for round 2",
  );
}

// ---------- power-ups ----------
{
  const { s, t } = setup(2, 11);
  startFight(s, t);
  run(s, t, POWER_FIRST_MS - 100);
  assert(s.power === null, "no power-up before 8s");
  run(s, t, 200);
  assert(powerOf(s) !== null, "power-up appears at 8s");
  const p = powerOf(s)!;
  assert(Math.hypot(p.x - CENTER, p.y - CENTER) < RINK_R * 0.75, "spawns well inside the rink");
  assert(s.snap.u !== 0, "power-up in the snapshot");
  const d = s.discs[0];
  Object.assign(d, { x: p.x - 10, y: p.y, vx: 0, vy: 0 });
  t.events.length = 0;
  step(s, t);
  assert(powerOf(s) === null, "picked up");
  const kind = p.kind;
  if (kind === "heavy") assert(d.heavyUntil > t.ctx.now(), "heavy applied");
  else assert(d.turboUntil > t.ctx.now(), "turbo applied");
  const pick = snaps(t)[0]?.fx?.find((f) => f[0] === FX_PICKUP);
  assert(pick && pick[1] === 0, "pickup effect");
  run(s, t, 5900);
  assert(powerOf(s) === null, "next one waits 6s");
  run(s, t, 300);
  assert(powerOf(s) !== null, "next power-up after 6s");
  // Heavy flag in snapshots, and it wears off.
  d.heavyUntil = t.ctx.now() + POWER_INFO.heavy.ms;
  d.turboUntil = 0;
  step(s, t);
  assert(((s.snap.p.find((x) => x[0] === 0)![5] ?? 0) & F_HEAVY) !== 0, "heavy flag");
  run(s, t, POWER_INFO.heavy.ms + 100);
  assert(((s.snap.p.find((x) => x[0] === 0)![5] ?? 0) & F_HEAVY) === 0, "heavy wears off");
}

// ---------- hostile actions ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  const before = JSON.stringify(s.discs);
  const junk: unknown[] = [
    null,
    undefined,
    42,
    "dash",
    [],
    ["input", 1, 2],
    {},
    { type: "x" },
    { type: "__proto__" },
    { type: "input" },
    { type: "input", x: "1", y: 0 },
    { type: "input", x: 1.5, y: 0 },
    { type: "input", x: 0, y: NaN },
    { type: "input", x: Infinity, y: 0 },
    { type: "input", x: 101, y: 0 },
    { type: "input", x: -1e9, y: 0 },
    { type: "input", x: 0, y: [1] },
    { type: "input", x: 0, y: { valueOf: () => 5 } },
    { type: "input", x: 1, y: 1, extra: "a".repeat(100_000) },
    { type: "dash", x: 5 }, // extra fields are fine but this one is a real dash: tested below
  ];
  for (const a of junk.slice(0, -2)) {
    assert(sumo.action(s, "p0", a as never, t.ctx) === false, `rejects ${JSON.stringify(a)?.slice(0, 40)}`);
  }
  assert(JSON.stringify(s.discs) === before, "junk changed nothing");
  assert(sumo.action(s, "nobody", { type: "dash" }, t.ctx) === false, "strangers rejected");
  assert(sumo.action(s, "spectator", { type: "input", x: 100, y: 0 }, t.ctx) === false, "spectators rejected");
  assert(JSON.stringify(s.discs) === before, "strangers changed nothing");
  // A long diagonal is clamped to length 1.
  sumo.action(s, "p0", { type: "input", x: 100, y: 100 }, t.ctx);
  assert(Math.abs(Math.hypot(s.discs[0].ix, s.discs[0].iy) - 1) < 1e-9, "magnitude clamped");
  // After the end, nothing is accepted.
  s.phase = "final";
  assert(sumo.action(s, "p0", { type: "input", x: 0, y: 0 }, t.ctx) === false, "final ignores input");
  assert(s.discs[0].ix !== 0, "final input ignored");
}

// ---------- a full match to the end (one skilful player) ----------
{
  const { s, t, ends } = setup(4, 5);
  let guard = 0;
  while (s.phase !== "final" && guard++ < 20_000) {
    // p2 hugs the centre; everybody else stands still and gets eaten by the shrinking rink.
    if (s.phase === "fight" || s.phase === "countdown") steer(s, t, 2, CENTER, CENTER);
    step(s, t);
    assert(finite(s), "no NaN in a full match");
  }
  assert(s.phase === "final", "match finished");
  assert(ends() === 1 && t.result, "ctx.end called once");
  assert(t.result.winners.length === 1 && t.result.winners[0] === "p2", "p2 is champion");
  assert(t.result.headline === "Player2 is the Ice Sumo champion", t.result.headline);
  assert(t.result.scores?.p2 === WINS_NEEDED && s.round === WINS_NEEDED, "3 straight round wins");
  const v = view(s, t);
  assert(v.champions?.join() === "p2" && v.history.length === WINS_NEEDED, "final view");
  // Ticks after the end keep things settling but never end again.
  for (let i = 0; i < 40; i++) assert(step(s, t) === false, "final ticks are quiet");
  assert(ends() === 1, "still one end");
}

// ---------- seven draws: no winners ----------
{
  const { s, t, ends } = setup(2, 8);
  let guard = 0;
  while (s.phase !== "final" && guard++ < 40_000) step(s, t);
  assert(s.history.length === MAX_ROUNDS && s.history.every((h) => h.winner === null), "seven draws");
  assert(ends() === 1 && t.result!.winners.length === 0, "nobody wins");
  assert(/draw/.test(t.result!.headline), t.result!.headline);
}

// ---------- tie after seven rounds ----------
{
  const { s, t } = setup(3, 9);
  s.round = MAX_ROUNDS;
  s.wins = [2, 2, 1];
  startFight(s, t);
  // Everyone off at once.
  s.discs.forEach((d, i) =>
    Object.assign(d, {
      x: CENTER + Math.cos(i * 2) * 438,
      y: CENTER + Math.sin(i * 2) * 438,
      vx: Math.cos(i * 2) * 400,
      vy: Math.sin(i * 2) * 400,
    }),
  );
  step(s, t);
  assert(s.phase === "final", "seventh round ends the match");
  assert(t.result!.winners.join() === "p0,p1", "tie on round wins shares the crown");
  assert(/share/.test(t.result!.headline), t.result!.headline);
}

// ---------- 8 players, random chaos: never breaks, always ends ----------
{
  const { s, t, ends } = setup(8, 1234);
  let rnd = 77;
  const r = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let guard = 0;
  let hits = 0;
  while (s.phase !== "final" && guard++ < 60_000) {
    for (let i = 0; i < 8; i++) {
      if (r() < 0.1)
        sumo.action(
          s,
          `p${i}`,
          { type: "input", x: Math.round(r() * 200 - 100), y: Math.round(r() * 200 - 100) },
          t.ctx,
        );
      if (r() < 0.02) sumo.action(s, `p${i}`, { type: "dash" }, t.ctx);
    }
    t.events.length = 0;
    step(s, t);
    hits += snaps(t).reduce((n, e) => n + (e.fx?.filter((f) => f[0] === FX_HIT).length ?? 0), 0);
    assert(finite(s), "no NaN in chaos");
    for (const d of s.discs) assert(Math.hypot(d.vx, d.vy) <= 1600, "speed hard cap");
  }
  assert(s.phase === "final" && ends() === 1, "chaos match ends");
  assert(hits > 0, "collisions happened");
}

// ---------- disconnects ----------
{
  // Mid-fight: input zeroed, disc stays and can still be shoved off.
  const { s, t, ends } = setup(3);
  startFight(s, t);
  sumo.action(s, "p1", { type: "input", x: 100, y: 0 }, t.ctx);
  t.ctx.players[1].connected = false;
  sumo.playerLeft!(s, "p1", t.ctx);
  assert(s.discs[1].ix === 0 && s.discs[1].alive, "offline disc stays, input zeroed");
  assert(((s.snap.p.find((p) => p[0] === 1)![5] ?? 0) & F_OFFLINE) !== 0, "offline flag");
  assert(s.aloneSince === null, "two still online");
  // Down to one online: the match waits 10s, then ends with the last player standing.
  t.ctx.players[2].connected = false;
  sumo.playerLeft!(s, "p2", t.ctx);
  assert(s.aloneSince !== null && view(s, t).abandonAt === s.aloneSince + ABANDON_MS, "abandon timer shown");
  run(s, t, 4000);
  // p2 comes back in time: timer cancelled.
  t.ctx.players[2].connected = true;
  sumo.playerReturned!(s, "p2", t.ctx);
  assert(s.aloneSince === null && view(s, t).abandonAt === null, "reconnect cancels the timer");
  t.ctx.players[2].connected = false;
  sumo.playerLeft!(s, "p2", t.ctx);
  for (let i = 0; i < ABANDON_MS / TICK_MS + 2 && s.phase !== "final"; i++) step(s, t);
  assert(s.phase === "final" && ends() === 1, "ends after 10s alone");
  assert(t.result!.winners.join() === "p0" && /everyone else left/.test(t.result!.headline), t.result!.headline);
}
{
  // During the countdown and between rounds: the game never stalls.
  const { s, t, ends } = setup(2);
  t.ctx.players[1].connected = false;
  sumo.playerLeft!(s, "p1", t.ctx);
  startFight(s, t);
  assert(s.discs[1].alive, "offline player's disc is on the ice");
  run(s, t, 3000);
  t.ctx.players[1].connected = true;
  sumo.playerReturned!(s, "p1", t.ctx);
  assert(s.aloneSince === null, "back");
  sumo.action(s, "p1", { type: "input", x: 50, y: 0 }, t.ctx);
  assert(s.discs[1].ix === 0.5, "returning player steers again");
  // Everyone leaves: ends as abandoned with no ctx.end stall.
  t.ctx.players[0].connected = false;
  t.ctx.players[1].connected = false;
  sumo.playerLeft!(s, "p0", t.ctx);
  sumo.playerLeft!(s, "p1", t.ctx);
  run(s, t, ABANDON_MS + 200);
  assert(s.phase === "final" && ends() === 1, "empty room ends");
  assert(/everyone left/.test(t.result!.headline), t.result!.headline);
}
{
  // Leaving during the round-over break: next round still starts.
  const { s, t } = setup(3);
  startFight(s, t);
  Object.assign(s.discs[0], { x: CENTER + 435, vx: 300 });
  Object.assign(s.discs[1], { x: CENTER - 435, vx: -300 });
  step(s, t);
  assert(s.phase === "roundOver", "round over");
  t.ctx.players[0].connected = false;
  sumo.playerLeft!(s, "p0", t.ctx);
  run(s, t, ROUND_OVER_MS);
  assert(phaseOf(s) === "countdown" && s.round === 2 && s.discs[0].alive, "next round starts anyway");
}

// ---------- client playback: smooth at 60fps despite network jitter ----------
{
  for (const [jitter, latency, tickJitter] of [
    [0, 30, 0],
    [70, 80, 15],
  ]) {
    const { s, t } = setup(2, 3);
    startFight(s, t);
    const T0 = t.ctx.now();
    Object.assign(s.discs[1], { x: CENTER, y: CENTER });
    let rnd = 99;
    const r = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const sent: { snap: Snap; at: number }[] = [{ snap: s.snap, at: latency }];
    let lastAt = 0;
    for (let i = 0; i < 160; i++) {
      // p0 chases a point running round a circle; the frames reach the client late and unevenly.
      const a = ((i * TICK_MS) / 1000) * 1.6;
      steer(s, t, 0, CENTER + Math.cos(a) * 200, CENTER + Math.sin(a) * 200);
      t.advance(TICK_MS + Math.round((r() - 0.5) * tickJitter));
      t.events.length = 0;
      const out = sumo.tick!(s, t.ctx) ? [s.snap] : snaps(t);
      for (const snap of out) {
        lastAt = Math.max(lastAt, snap.t - T0 + latency + r() * jitter);
        sent.push({ snap, at: lastAt });
      }
    }
    const sc = newScene();
    const o: Sample = { x: 0, y: 0, vx: 0, vy: 0, flags: 0, cd: 0, cdAt: 0 };
    const pos: [number, number][] = [];
    let k = 0;
    for (let now = latency; now < lastAt; now += 1000 / 60) {
      while (k < sent.length && sent[k].at <= now) pushFrame(sc, sent[k].snap, sent[k++].at);
      const rt = sc.clock.tick(now);
      if (sampleDisc(sc.frames, 0, rt, o)) pos.push([o.x, o.y]);
    }
    const steps = pos.slice(90).map((p, i, all) => (i ? Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) : 0));
    steps.shift();
    const mean = steps.reduce((x, y) => x + y, 0) / steps.length;
    const worst = Math.max(...steps.slice(1).map((v, i) => Math.abs(v - steps[i])));
    assert(
      steps.length > 300 && mean > 4,
      `the disc keeps circling (${steps.length} frames, ${mean.toFixed(2)}/frame)`,
    );
    assert(
      steps.every((v) => v > mean * 0.5),
      `no stalls at 60fps (jitter ${jitter}ms)`,
    );
    assert(
      worst < mean * 0.25,
      `even motion frame to frame (jitter ${jitter}ms: worst change ${(worst / mean).toFixed(3)})`,
    );
  }
}

// ---------- input acknowledgements in snapshots; compact disc tuples ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  step(s, t);
  t.events.length = 0;
  const before = s.steps;
  sumo.action(s, "p0", { type: "input", x: 100, y: 0, s: 7 }, t.ctx);
  assert(sumo.action(s, "p0", { type: "input", x: 1, y: 0, s: 1.5 }, t.ctx) === false && s.discs[0].seq === 7, "bad input numbers rejected");
  assert(sumo.action(s, "p0", { type: "input", x: 1, y: 0, s: "8" } as never, t.ctx) === false, "string input number rejected");
  step(s, t);
  const f = snaps(t)[0];
  const ack = f?.a?.find((a) => a[0] === 0);
  assert(ack && ack[1] === 7, "the next snapshot acknowledges the input");
  assert(f.t + ack[2] === Math.round(s.fightAt + (before + 1) * (TICK_MS / 3)), "with the sim time it took effect from");
  t.events.length = 0;
  step(s, t);
  assert(!snaps(t)[0]?.a, "acknowledged once");
  // Even a still disc gets its acknowledgement out (identical frames are otherwise skipped).
  sumo.action(s, "p0", { type: "input", x: 0, y: 0, s: 8 }, t.ctx);
  run(s, t, 2000);
  t.events.length = 0;
  sumo.action(s, "p1", { type: "input", x: 0, y: 0, s: 3 }, t.ctx);
  step(s, t);
  assert(snaps(t)[0]?.a?.[0]?.[1] === 3, "acks beat the idle-frame skip");
  // A refused dash is acknowledged too (so the client stops predicting it).
  s.discs[0].dashReadyAt = t.ctx.now() + 5_000;
  t.events.length = 0;
  sumo.action(s, "p0", { type: "dash", s: 9 }, t.ctx);
  step(s, t);
  assert(!s.discs[0].dashQueued && snaps(t)[0]?.a?.some((a) => a[0] === 0 && a[1] === 9), "refused dash acknowledged");
  // Most discs need only five numbers.
  assert(s.snap.p.some((d) => d.length === 5) || snaps(t)[0]?.p.some((d) => d.length === 5), "trailing zeros left off");
}

// ---------- your disc's prediction against the real server, over a simulated network ----------
interface NetStats {
  /** How far each snapshot moved your predicted disc (units), once the lead had settled. */
  corr: number[];
  /** Velocity gained toward a new stick direction within 20ms of moving the stick (units/s). */
  response: number[];
  lead: number;
}

function sumoNet(up: number, down: number, jitter: number, seed: number): NetStats {
  const { s, t } = setup(2, seed);
  startFight(s, t);
  Object.assign(s.discs[0], { x: CENTER, y: CENTER + 60, vx: 0, vy: 0 });
  const pred = new SumoPredictor();
  // The client's clock reads server time minus the quickest one-way trip (like the renderer's).
  pred.attachClock({ ready: true, serverNow: (perf) => perf - down });
  let rnd = seed * 7919 + 13;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  const toServer: { at: number; a: unknown }[] = [];
  const toClient: { at: number; snap: Snap }[] = [];
  let lastAt = 0;
  const deliver = (snap: Snap) => {
    lastAt = Math.max(lastAt, t.ctx.now() + down + rand() * jitter);
    toClient.push({ at: lastAt, snap: JSON.parse(JSON.stringify(snap)) });
  };
  deliver(s.snap);
  const stats: NetStats = { corr: [], response: [], lead: 0 };
  const k = { x: 0, y: 0, vx: 0, vy: 0 };
  const k2 = { x: 0, y: 0, vx: 0, vy: 0 };
  const probes: { at: number; v0: [number, number]; dir: [number, number] }[] = [];
  const t0 = t.ctx.now();
  let nextTick = t0 + TICK_MS;
  let nextInput = t0 + 100;
  let target: [number, number] = [CENTER, CENTER];
  for (let now = t0; now < t0 + 5_000; now += 1) {
    t.advance(now - t.ctx.now());
    while (toServer.length && toServer[0].at <= now) sumo.action(s, "p0", toServer.shift()!.a as never, t.ctx);
    if (now >= nextTick) {
      nextTick += TICK_MS;
      t.events.length = 0;
      if (sumo.tick!(s, t.ctx)) deliver(s.snap);
      for (const e of snaps(t)) deliver(e);
    }
    const T = now - down + pred.lead();
    while (toClient.length && toClient[0].at <= now) {
      const { snap } = toClient.shift()!;
      // As rink.tsx: what was shown, then the acknowledgements and the new snapshot together.
      const had = pred.predict(T, k);
      for (const a of snap.a ?? []) if (a[0] === 0) pred.ack(a[1], snap.t + a[2], a[3] === undefined ? undefined : snap.t + a[3]);
      const d = snap.p.find((p) => p[0] === 0);
      if (!d) continue;
      pred.setBase({ n: snap.n, t: snap.t, x: d[1], y: d[2], vx: d[3], vy: d[4], heavy: false, r: snap.r });
      if (had && pred.predict(T, k2) && now - t0 > 1_500) stats.corr.push(Math.hypot(k.x - k2.x, k.y - k2.y));
    }
    for (let i = probes.length - 1; i >= 0; i--) {
      if (now - probes[i].at < 20) continue;
      pred.predict(now - down + pred.lead(), k);
      const [dx, dy] = probes[i].dir;
      stats.response.push((k.vx - probes[i].v0[0]) * dx + (k.vy - probes[i].v0[1]) * dy);
      probes.splice(i, 1);
    }
    if (now >= nextInput) {
      // Steer (from what you see: your predicted disc) toward a fresh point near the centre.
      nextInput = now + 150 + Math.floor(rand() * 200);
      if (rand() < 0.4) {
        const a = rand() * Math.PI * 2;
        target = [CENTER + Math.cos(a) * 120, CENTER + Math.sin(a) * 120];
      }
      if (!pred.predict(now - down + pred.lead(), k)) continue;
      let ix = (target[0] - k.x) * 0.9 - k.vx * 0.45;
      let iy = (target[1] - k.y) * 0.9 - k.vy * 0.45;
      const m = Math.hypot(ix, iy) || 1;
      [ix, iy] = [Math.round((ix / m) * 100), Math.round((iy / m) * 100)];
      const seq = pred.recordInput(ix, iy, now);
      toServer.push({ at: now + up, a: { type: "input", x: ix, y: iy, s: seq, at: pred.stamp(seq) } });
      if (now - t0 > 1_500) probes.push({ at: now, v0: [k.vx, k.vy], dir: [ix / 100, iy / 100] });
    }
  }
  assert(s.discs.every((d) => d.alive) && s.phase === "fight", "nobody fell during the run");
  stats.lead = pred.lead();
  return stats;
}

for (const [up, down, jitter] of [
  [50, 50, 0],
  [25, 75, 10],
  [75, 75, 30],
] as const) {
  const r = sumoNet(up, down, jitter, 5);
  const label = `sumo net up=${up} down=${down} jitter=${jitter}`;
  const mean = r.corr.reduce((a, b) => a + b, 0) / r.corr.length;
  const max = Math.max(...r.corr);
  const resp = Math.min(...r.response);
  if (process.env.NET_VERBOSE) console.log(label, { mean: mean.toFixed(2), max: max.toFixed(2), resp: resp.toFixed(1), lead: r.lead.toFixed(0), n: r.corr.length });
  assert(r.corr.length > 40 && r.response.length > 6, `${label}: enough samples`);
  // A disc is 72 units across; corrections are a few units and get blended out anyway.
  assert(mean < 1.5 && max < 8, `${label}: snapshots barely move your disc (mean ${mean.toFixed(2)}, max ${max.toFixed(2)})`);
  // 20ms of a full stick is ~20 units/s: your disc answers at once, not a round trip later.
  assert(resp > 8, `${label}: your disc answers the stick at once (${resp.toFixed(1)} units/s after 20ms)`);
  const rtt = up + down;
  // Stamps aim 60 ms short of the slowest arrivals (the server counts a late one back up to 150 ms).
  assert(r.lead > rtt - 60 - 5 && r.lead < rtt + jitter - 60 + 15, `${label}: lead ~ one round trip less 60 ms (${r.lead.toFixed(0)})`);
}

// ---------- a duel over a jittery, bursty link (what the live server sees from Wi-Fi) ----------
// Two networked players, each with its own bursty uplink and downlink; player 0's screen is drawn
// the way rink.tsx draws it: the whole rink predicted to the present (stamped inputs, the others
// dead-reckoned, contacts resolved), new snapshots blended in. Player 0 wanders and charges,
// player 1 hunts player 0. Checked: your disc's raw prediction rarely needs correcting, nothing
// lurches on screen, and when the server has the two discs collide, they touch on screen too.
function sumoDuel(link: BurstyOptions, seed: number, secs = 16) {
  const { s, t } = setup(2, seed);
  startFight(s, t);
  Object.assign(s.discs[0], { x: CENTER - 120, y: CENTER, vx: 0, vy: 0 });
  Object.assign(s.discs[1], { x: CENTER + 120, y: CENTER, vx: 0, vy: 0 });
  const data = { reduced: true, mySlot: 0, colors: [], names: [], avatars: [], steerable: true, accent: "", view: view(s, t) };
  const players = [0, 1].map((slot) => {
    const pred = new SumoPredictor();
    const sc = newScene();
    pred.attachClock(sc.clock);
    return { slot, pred, sc, up: burstyLink(seed * 10 + slot, link), down: burstyLink(seed * 10 + 5 + slot, link), inbox: [] as { at: number; snap: Snap }[], last: null as Snap | null };
  });
  const toServer: { at: number; slot: number; a: unknown }[] = [];
  let rnd = seed * 7919 + 13;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  const k = { x: 0, y: 0, vx: 0, vy: 0 };
  const raw = (p: (typeof players)[0], T: number) => {
    const out: (typeof k | undefined)[] = [];
    if (!p.sc.worldBase) return null;
    p.pred.predictWorld(T, p.sc.worldBase, p.slot, out);
    return out[p.slot] ?? null;
  };
  const t0 = t.ctx.now();
  let nextTick = t0 + TICK_MS;
  const nextInput = [t0 + 100, t0 + 150];
  let nextFrame = t0;
  let rt = -Infinity;
  let corrections = 0;
  const shown: { p: number; me: [number, number] | null; ot: [number, number] | null }[] = [];
  const hits: number[] = [];
  for (let now = t0; now < t0 + secs * 1_000; now += 1) {
    t.advance(now - t.ctx.now());
    while (toServer.length && toServer[0].at <= now) {
      const m = toServer.shift()!;
      sumo.action(s, t.ids[m.slot], m.a as never, t.ctx);
    }
    if (now >= nextTick) {
      nextTick += TICK_MS;
      t.events.length = 0;
      if (sumo.tick!(s, t.ctx)) for (const p of players) p.inbox.push({ at: p.down.send(now), snap: JSON.parse(JSON.stringify(s.snap)) });
      for (const e of snaps(t)) for (const p of players) p.inbox.push({ at: p.down.send(now), snap: JSON.parse(JSON.stringify(e)) });
      // This test is about motion and contacts, not falling in: a disc near the edge goes back to the middle.
      for (const d of s.discs) if (!d.alive || Math.hypot(d.x - CENTER, d.y - CENTER) > 300) Object.assign(d, { alive: true, x: CENTER, y: CENTER, vx: 0, vy: 0 });
    }
    for (const p of players) {
      while (p.inbox.length && p.inbox[0].at <= now) {
        const snap = p.inbox.shift()!.snap;
        p.last = snap;
        const T = p.sc.clock.serverNow(now) + p.pred.lead(now);
        const before = p.slot === 0 ? raw(p, T) : null;
        pushFrame(p.sc, snap, now, { pred: p.pred, slot: p.slot, data });
        const after = before ? raw(p, T) : null;
        if (before && after && now - t0 > 2_500 && Math.hypot(after.x - before.x, after.y - before.y) > 2) corrections += 1;
        if (p.slot === 0) for (const e of snap.fx ?? []) if (e[0] === FX_HIT) hits.push(now);
      }
      if (now < nextInput[p.slot] || !p.last || !p.pred.base) continue;
      nextInput[p.slot] = now + 160 + Math.floor(rand() * 220);
      if (!p.pred.predict(p.sc.clock.serverNow(now) + p.pred.lead(now), k)) continue;
      const other = p.last.p.find((d) => d[0] !== p.slot);
      let [tx, ty] = [CENTER + (rand() - 0.5) * 280, CENTER + (rand() - 0.5) * 280];
      if (other && (p.slot === 1 || rand() < 0.35)) [tx, ty] = [other[1], other[2]];
      if (Math.hypot(k.x - CENTER, k.y - CENTER) > 220) [tx, ty] = [CENTER, CENTER];
      let ix = (tx - k.x) * 0.9 - k.vx * 0.3;
      let iy = (ty - k.y) * 0.9 - k.vy * 0.3;
      const m = Math.hypot(ix, iy) || 1;
      [ix, iy] = [Math.round((ix / m) * 100), Math.round((iy / m) * 100)];
      const seq = p.pred.recordInput(ix, iy, now);
      toServer.push({ at: p.up.send(now), slot: p.slot, a: { type: "input", x: ix, y: iy, s: seq, at: p.pred.stamp(seq) } });
      toServer.sort((a, b) => a.at - b.at);
    }
    if (now >= nextFrame) {
      // Player 0's screen (rink.tsx drawScene, present mode).
      nextFrame += 1000 / 60;
      const { sc, pred } = players[0];
      sc.clock.play(now, sc.frames);
      if (!sc.worldBase || !sc.clock.ready) continue;
      rt = Math.max(rt, sc.clock.serverNow(now) + pred.lead(now));
      pred.predictWorld(rt, sc.worldBase, 0, sc.world);
      sc.corr.step(1000 / 60);
      for (const sp of sc.springs) sp?.step(1000 / 60);
      const w0 = sc.world[0];
      const w1 = sc.world[1];
      const me: [number, number] | null = w0 ? [w0.x + sc.corr.x, w0.y + sc.corr.y] : null;
      const ot: [number, number] | null = w1 ? [w1.x + (sc.springs[1]?.x ?? 0), w1.y + (sc.springs[1]?.y ?? 0)] : null;
      if (me && ot) {
        // As drawn (rink.tsx): your disc never sinks into another one.
        const dd = Math.hypot(me[0] - ot[0], me[1] - ot[1]);
        if (dd < 2 * DISC_R && dd > 1e-3) {
          me[0] = ot[0] + ((me[0] - ot[0]) / dd) * 2 * DISC_R;
          me[1] = ot[1] + ((me[1] - ot[1]) / dd) * 2 * DISC_R;
        }
      }
      if (now - t0 > 2_500) shown.push({ p: now, me, ot });
    }
  }
  const span = (shown[shown.length - 1].p - shown[0].p) / 1000;
  const lurch: number[] = [];
  for (let i = 2; i < shown.length; i++) {
    const [a, b, c] = [shown[i - 2].me, shown[i - 1].me, shown[i].me];
    if (!a || !b || !c || Math.hypot(c[0] - b[0], c[1] - b[1]) > 150) continue;
    lurch.push(Math.hypot(c[0] - 2 * b[0] + a[0], c[1] - 2 * b[1] + a[1]));
  }
  lurch.sort((x, y) => x - y);
  // Each server hit: how close the two discs came on screen around when it reached player 0.
  const gaps: number[] = [];
  let deepest = 0;
  for (const h of hits) {
    if (h - t0 < 3_000) continue;
    let best = Infinity;
    for (const f of shown) {
      if (f.p < h - 1_200 || f.p > h + 400 || !f.me || !f.ot) continue;
      best = Math.min(best, Math.hypot(f.me[0] - f.ot[0], f.me[1] - f.ot[1]) - 2 * DISC_R);
    }
    if (Number.isFinite(best)) gaps.push(Math.abs(best));
  }
  for (const f of shown) if (f.me && f.ot) deepest = Math.max(deepest, 2 * DISC_R - Math.hypot(f.me[0] - f.ot[0], f.me[1] - f.ot[1]));
  gaps.sort((x, y) => x - y);
  return {
    corrPerS: corrections / span,
    p95: lurch[Math.floor(lurch.length * 0.95)],
    lurchesPerS: lurch.filter((v) => v > 3).length / span,
    hits: gaps.length,
    gapP50: gaps[Math.floor(gaps.length / 2)] ?? 0,
    deepest,
  };
}

for (const [name, link, seed, lim] of [
  ["wifi", WIFI, 31, { corr: 3, p95: 2, lurch: 2.5, gap: 40, hits: 3 }],
  ["wifi", WIFI, 32, { corr: 3, p95: 2, lurch: 2.5, gap: 40, hits: 3 }],
  ["bad wifi", WIFI_BAD, 33, { corr: 4.5, p95: 2.5, lurch: 3, gap: Infinity, hits: 1 }],
] as const) {
  const r = sumoDuel(link, seed);
  const label = `sumo duel ${name} #${seed}`;
  if (process.env.NET_VERBOSE) console.log(label, Object.fromEntries(Object.entries(r).map(([k2, v]) => [k2, +v.toFixed(2)])));
  assert(r.corrPerS < lim.corr, `${label}: your disc's prediction rarely needs correcting (${r.corrPerS.toFixed(2)}/s)`);
  assert(r.p95 < lim.p95 && r.lurchesPerS < lim.lurch, `${label}: your disc moves smoothly (p95 ${r.p95.toFixed(2)}, ${r.lurchesPerS.toFixed(2)} lurches/s)`);
  assert(r.hits >= lim.hits, `${label}: they collided (${r.hits})`);
  assert(r.gapP50 < lim.gap, `${label}: server hits touch on screen (median gap ${r.gapP50.toFixed(1)})`);
  assert(r.deepest < 45, `${label}: discs never sink far into each other on screen (${r.deepest.toFixed(1)})`);
}

// ---------- the predicted rink resolves contacts the way the server does ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  Object.assign(s.discs[0], { x: CENTER - 150, y: CENTER, vx: 300, vy: 0, ix: 1, iy: 0 });
  Object.assign(s.discs[1], { x: CENTER + 50, y: CENTER + 20, vx: -200, vy: 0, ix: -1, iy: 0 });
  step(s, t);
  const w = worldOfSnap(s.snap);
  const pred = new SumoPredictor();
  const out: ({ x: number; y: number; vx: number; vy: number } | undefined)[] = [];
  const contacts: PredictedContact[] = [];
  pred.predictWorld(s.snap.t + 300, w, -1, out, contacts);
  run(s, t, 300);
  assert(contacts.length > 0 && contacts[0].j > 100, "the prediction sees the collision coming");
  for (const slot of [0, 1]) {
    const d = s.discs[slot];
    const e = Math.hypot(out[slot]!.x - d.x, out[slot]!.y - d.y);
    assert(e < 6, `predicted disc ${slot} ends where the server puts it after the hit (${e.toFixed(1)})`);
  }
}

// ---------- stamped inputs: early ones wait for their substep, late ones count back (bounded) ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  Object.assign(s.discs[0], { x: CENTER, y: CENTER, vx: 0, vy: 0, ix: 0, iy: 0 });
  step(s, t);
  const sim = (k: number) => s.fightAt + k * (TICK_MS / 3);
  // Early: meant for 2 substeps from now. Nothing happens until then.
  sumo.action(s, "p0", { type: "input", x: 100, y: 0, s: 1, at: Math.round(sim(s.steps + 2)) }, t.ctx);
  const stick = () => s.discs[0].ix as number;
  const queued = () => s.discs[0].queue.length as number;
  assert(stick() === 0 && queued() === 1, "an early input waits");
  step(s, t);
  assert(stick() === 1 && queued() === 0, "...and lands on its substep");
  // Its acknowledgement says when it took effect and when it arrived.
  const a = (s.snap.a ?? []).find((x) => x[1] === 1);
  assert(a && typeof a[3] === "number", "acknowledged with its arrival time");
  // Late by 100 ms: applied at once, as if on time (the disc is already moving the new way).
  const before = { ...s.discs[0] };
  sumo.action(s, "p0", { type: "input", x: 0, y: 100, s: 2, at: Math.round(sim(s.steps + 1) - 100) }, t.ctx);
  assert(s.discs[0].iy === 1 && s.discs[0].vy > before.vy + 50, `a late input counts back (vy ${s.discs[0].vy.toFixed(0)})`);
  // Late by a whole second: counted back at most ~150 ms.
  const vy = s.discs[0].vy;
  sumo.action(s, "p0", { type: "input", x: 0, y: -100, s: 3, at: Math.round(sim(s.steps + 1) - 1_000) }, t.ctx);
  // (The stick swung from +1 to -1: at most 150 ms of a 2x full-stick difference.)
  assert(vy - s.discs[0].vy < 2 * 1000 * 0.16, `rewind is bounded (${(vy - s.discs[0].vy).toFixed(0)} units/s)`);
  // Absurd stamps are refused or clamped.
  assert(sumo.action(s, "p0", { type: "input", x: 0, y: 0, s: 4, at: Number.NaN }, t.ctx) === false, "a NaN stamp is refused");
  sumo.action(s, "p0", { type: "input", x: 50, y: 0, s: 5, at: Math.round(sim(s.steps + 1) + 60_000) }, t.ctx);
  assert(s.discs[0].queue[0].k <= s.steps + 1 + 60, "a stamp far ahead is held at most a second");
}

// ---------- dash: predicted at once; a refused one disappears once acknowledged ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  Object.assign(s.discs[0], { x: CENTER - 150, y: CENTER, vx: 0, vy: 0, fx: 1, fy: 0 });
  step(s, t);
  const pred = new SumoPredictor();
  pred.attachClock({ ready: true, serverNow: (perf) => perf });
  const base = () => {
    const d = s.snap.p.find((p) => p[0] === 0)!;
    return { n: s.snap.n, t: s.snap.t, x: d[1], y: d[2], vx: d[3], vy: d[4], heavy: false, r: s.snap.r };
  };
  pred.setBase(base());
  const k = { x: 0, y: 0, vx: 0, vy: 0 };
  const now = t.ctx.now();
  const seq = pred.recordDash(now);
  pred.predict(now + pred.lead() + 20, k);
  assert(k.vx > 600, `the dash shows at once (${k.vx.toFixed(0)} units/s)`);
  assert(pred.dashLeft(now, DASH_CD_MS) > DASH_CD_MS - 10, "and the recharge starts at once");
  // The server refuses it (still cooling down) and says so; the next replay drops it.
  s.discs[0].dashReadyAt = now + 5_000;
  sumo.action(s, "p0", { type: "dash", s: seq, at: pred.stamp(seq) }, t.ctx);
  t.events.length = 0;
  step(s, t);
  const f = snaps(t)[0] ?? s.snap;
  for (const a of f.a ?? []) if (a[0] === 0) pred.ack(a[1], f.t + a[2], a[3] === undefined ? undefined : f.t + a[3]);
  pred.setBase(base());
  pred.predict(t.ctx.now() + pred.lead(), k);
  assert(Math.abs(k.vx) < 1, `a refused dash vanishes from the replay (${k.vx.toFixed(1)})`);
}

// ---------- the first guess at the lead comes from the room's measured round trip ----------
{
  const pred = new SumoPredictor();
  assert(pred.lead() === 80, "no measurement yet: a typical phone round trip");
  let rtt: number | null = null;
  pred.attachRtt(() => rtt);
  assert(pred.lead() === 80, "still unmeasured");
  rtt = 140;
  assert(pred.lead() === 140 - TICK_MS / 2, `measured: one round trip less the backdated half tick (${pred.lead()})`);
  rtt = 0;
  assert(pred.lead() === 0, "the simulator's zero round trip");
  // Once the server acknowledges an input, its own timing wins.
  pred.attachClock({ ready: true, serverNow: (p) => p });
  const seq = pred.recordInput(100, 0, 1_000);
  pred.ack(seq, 1_000 + 66);
  assert(pred.lead() === 66, `acknowledged timing takes over (${pred.lead()})`);
}

// ---------- adaptive playback delay ----------
{
  // Frames every TICK_MS arriving `late(i)` ms after the quickest delivery.
  const feed = (late: (i: number) => number) => {
    const c = new Timeline({ period: TICK_MS, start: 100, min: TICK_MS + 15, max: 650 });
    for (let i = 0; i < 400; i++) c.observe(i * TICK_MS, 5_000 + i * TICK_MS + late(i));
    return c;
  };
  const steady = feed((i) => i % 5);
  assert(steady.goal >= TICK_MS + 15 && steady.goal <= TICK_MS + 40, `low jitter: short delay (${steady.goal})`);
  const rough = feed((i) => ((i * 37) % 90) * 9);
  assert(rough.goal === 650, `heavy jitter: capped (${rough.goal})`);
  const mid = feed((i) => ((i * 13) % 30) * 4);
  assert(mid.goal > 150 && mid.goal < 200, `some jitter: in between (${mid.goal})`);
}

console.log("✓ sumo tests passed");
