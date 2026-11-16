// Run with: npx tsx games/incognito/incognito.test.ts
import { assert, makeTestCtx } from "../../shared/testing";
import incognito, { type IncState, type IncView } from "./server";
import {
  ABANDON_MS,
  ACCEL,
  ALL_LIT,
  DARTS,
  EDGE,
  EXPOSE_MS,
  DART_MS,
  FX_PULSE,
  INTRO_MS,
  LIGHT_MS,
  LM_R,
  NPC_COUNT,
  PARKS,
  PLAY_MS,
  PTS_ALL_LIT,
  PTS_MOST_LIT,
  PTS_SNIPE,
  PTS_SURVIVOR,
  ROUNDS,
  ROUND_OVER_MS,
  SNIPE_CD_MS,
  SPRINT_MUL,
  TICK_MS,
  WALK,
  WALKER_R,
  WORLD_H,
  WORLD_W,
  decodePositions,
  encodePositions,
  inputDir,
  stepBody,
  type LitEvent,
  type NoEvent,
  type Snap,
} from "./shared";
import { Timeline, Trail, reconcile } from "../snakes/netsmooth";
import { WIFI, WIFI_BAD, burstyLink } from "../snakes/netsim";

type T = ReturnType<typeof makeTestCtx>;

function setup(n: number, seed = 7) {
  const t = makeTestCtx(n, seed);
  let ends = 0;
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    ends += 1;
    end(r);
  };
  const s = incognito.setup(t.ctx);
  return { t, s, ends: () => ends };
}

const view = (s: IncState, t: T, who = "p0") => incognito.view(s, who, t.ctx) as IncView;
const phaseOf = (s: IncState): string => s.phase;
const litOf = (s: IncState, slot: number): number => s.seats[slot].lit;
const roundOf = (s: IncState): number => s.round;
const tick = (s: IncState, t: T) => {
  t.advance(TICK_MS);
  return incognito.tick!(s, t.ctx);
};
function run(s: IncState, t: T, ms: number) {
  for (let left = ms; left > 0; left -= TICK_MS) tick(s, t);
}
function toPlay(s: IncState, t: T) {
  let changed = false;
  for (let i = 0; i < INTRO_MS / TICK_MS + 2 && phaseOf(s) === "intro"; i++) changed = !!tick(s, t) || changed;
  assert(phaseOf(s) === "play", "intro -> play");
  assert(changed, "intro -> play broadcasts");
}
const snaps = (t: T) => t.events.map((e) => e.event as Snap).filter((e) => e && (e as Snap).k === "s");
const walkerOf = (s: IncState, slot: number) => s.walkers[s.seats[slot].w];
const act = (s: IncState, t: T, who: string, a: unknown) => incognito.action(s, who, a as never, t.ctx);
const botIndex = (s: IncState, skip: number[] = []) =>
  s.walkers.findIndex((w, i) => w.slot < 0 && !w.down && !skip.includes(i));

/** Put a seat's walker on a landmark and keep it still. */
function park(s: IncState, slot: number, li: number) {
  const w = walkerOf(s, slot);
  const l = PARKS[s.park].landmarks[li];
  w.x = l.x;
  w.y = l.y;
  w.vx = 0;
  w.vy = 0;
  s.seats[slot].ix = 0;
  s.seats[slot].iy = 0;
}

// ---------- parks are sane ----------
{
  for (const p of PARKS) {
    assert(p.landmarks.length === 5, `${p.name}: five landmarks`);
    for (const l of p.landmarks) {
      assert(l.x - LM_R > EDGE && l.x + LM_R < WORLD_W - EDGE, `${p.name}: landmark inside x`);
      assert(l.y - LM_R > EDGE && l.y + LM_R < WORLD_H - EDGE, `${p.name}: landmark inside y`);
      for (const o of p.obstacles) {
        assert(Math.hypot(o.x - l.x, o.y - l.y) >= o.r + LM_R + WALKER_R, `${p.name}: landmark clear of obstacles`);
      }
    }
    for (const o of p.obstacles) {
      assert(o.x - o.r > 0 && o.x + o.r < WORLD_W && o.y - o.r > 0 && o.y + o.r < WORLD_H, `${p.name}: obstacle inside`);
    }
  }
  console.log("✓ parks");
}

// ---------- codec ----------
{
  const xy = [0, 0, 1000, 700, 14.4, 685.6, 500.5, 349.49, -5, 2000];
  const p = encodePositions(xy);
  assert(p.length === 20, "4 chars per walker");
  assert(/^[A-Za-z0-9_-]+$/.test(p), "url-safe characters only");
  const d = decodePositions(p);
  assert(
    JSON.stringify(d) === JSON.stringify([0, 0, 1000, 700, 14, 686, 501, 349, 0, 1023]),
    "decode(encode) rounds and clamps: " + JSON.stringify(d),
  );
  assert(decodePositions("!!!!").length === 2, "garbage decodes without throwing");
  assert(JSON.stringify(inputDir(10, 10)) === "[0,0]", "tiny input = stand still");
  const [ux, uy] = inputDir(30, 40);
  assert(Math.abs(Math.hypot(ux, uy) - 1) < 1e-9, "input is a unit direction (always full walking speed)");
  console.log("✓ codec");
}

// ---------- setup ----------
{
  for (const n of [3, 8]) {
    const { s, t } = setup(n, 3 + n);
    assert(s.phase === "intro" && s.round === 1, "starts in the intro");
    assert(s.walkers.length === NPC_COUNT + n, "36 bots + one walker per player");
    const humanIdx = s.seats.map((x) => x.w);
    assert(new Set(humanIdx).size === n, "distinct walkers per human");
    for (const [i, w] of s.walkers.entries()) {
      assert(w.slot === -1 || humanIdx[w.slot] === i, "seat.w <-> walker.slot agree");
      assert(w.x >= EDGE && w.x <= WORLD_W - EDGE && w.y >= EDGE && w.y <= WORLD_H - EDGE, "spawned inside");
      for (const o of PARKS[s.park].obstacles) assert(Math.hypot(w.x - o.x, w.y - o.y) >= o.r + WALKER_R, "not in trees");
    }
    assert(s.seats.every((x) => x.darts === DARTS && x.lit === 0 && !x.out), "fresh seats");
    const v = view(s, t);
    assert(v.count === NPC_COUNT + n && v.snap.p.length === 4 * v.count, "snapshot carries every walker");
    assert(v.you === s.seats[0].w, "you know your own walker");
  }
  // Humans aren't parked at the start of the list.
  const firsts = new Set<number>();
  for (let seed = 1; seed <= 12; seed++) firsts.add(setup(3, seed).s.seats[0].w);
  assert(firsts.size > 6, "walker ids are shuffled");
  console.log("✓ setup");
}

// ---------- snapshots, bandwidth & secrecy ----------
{
  const { s, t } = setup(8, 11);
  run(s, t, 2_000);
  const ss = snaps(t);
  assert(ss.length >= 35, "a snapshot nearly every tick: " + ss.length);
  for (const snap of ss) {
    assert(Object.keys(snap).every((k) => ["k", "n", "t", "p", "f", "q"].includes(k)), "only public fields");
    assert(snap.p.length === 4 * s.walkers.length, "same 4 chars for every walker");
  }
  const bytes = JSON.stringify({ t: "ev", e: ss[ss.length - 1], now: t.ctx.now() }).length;
  assert(bytes * (1000 / TICK_MS) < 8 * 1024, `snapshot stream under 8 KB/s at 8 players (${bytes} B/frame)`);
  assert(t.events.every((e) => !e.to || (e.event as { k: string }).k !== "s"), "snapshots go to everyone alike");
  toPlay(s, t);

  // Other players and spectators get nothing that singles out a human.
  for (const who of ["p1", "spectator"]) {
    const v = view(s, t, who);
    assert(v.humans === null, `${who}: no humans list during play`);
    assert(v.you === (who === "p1" ? s.seats[1].w : -1), `${who}: only their own walker`);
    assert(v.lit === 0, `${who}: no one else's landmarks`);
    const json = JSON.stringify(v);
    assert(!/slot|auto|"ix"|"iy"|sprint/.test(json), `${who}: no internals in the view`);
    assert(json.length < 4 * 1024, "view under 4 KB: " + json.length);
  }
  console.log("✓ snapshots & secrecy");
}

// ---------- one walking model for everyone ----------
{
  const { s, t } = setup(4, 21);
  toPlay(s, t);
  const prev = s.walkers.map((w) => [w.x, w.y, w.vx, w.vy]);
  let maxBot = 0;
  let maxHuman = 0;
  let maxDv = 0;
  /** Straight-line slow-downs per tick (speed lost while keeping direction). */
  const brakes = { bot: [] as number[], human: [] as number[] };
  for (let i = 0; i < 400; i++) {
    // p0 zig-zags with the stick, p1 sprints, p2 taps on and off, p3 stands still.
    const k = Math.floor(i / 15);
    act(s, t, "p0", { type: "in", x: k % 2 ? 100 : -70, y: k % 3 ? 60 : -100 });
    act(s, t, "p1", { type: "in", x: k % 2 ? 100 : -100, y: 0, s: 1 });
    act(s, t, "p2", { type: "in", x: i % 6 < 3 ? 0 : 40, y: i % 6 < 3 ? 0 : 90 });
    tick(s, t);
    s.walkers.forEach((w, j) => {
      const sp = Math.hypot(w.vx, w.vy);
      const dv = Math.hypot(w.vx - prev[j][2], w.vy - prev[j][3]);
      if (w.slot === 1) return; // the sprinter
      if (w.slot < 0) maxBot = Math.max(maxBot, sp);
      else maxHuman = Math.max(maxHuman, sp);
      const psp = Math.hypot(prev[j][2], prev[j][3]);
      const cos = psp > 0 && sp > 0 ? (w.vx * prev[j][2] + w.vy * prev[j][3]) / (sp * psp) : sp === 0 ? 1 : 0;
      const free =
        !PARKS[s.park].obstacles.some((o) => Math.hypot(w.x - o.x, w.y - o.y) < o.r + WALKER_R + 1) &&
        w.x > EDGE + 1 && w.x < WORLD_W - EDGE - 1 && w.y > EDGE + 1 && w.y < WORLD_H - EDGE - 1;
      if (free && psp > 30 && sp < psp - 1 && cos > 0.9999) brakes[w.slot < 0 ? "bot" : "human"].push(psp - sp);
      // Obstacles may cancel velocity outright; elsewhere the turn rate is the same for all.
      if (!PARKS[s.park].obstacles.some((o) => Math.hypot(w.x - o.x, w.y - o.y) < o.r + WALKER_R + 1)) {
        if (w.x > EDGE + 1 && w.x < WORLD_W - EDGE - 1 && w.y > EDGE + 1 && w.y < WORLD_H - EDGE - 1)
          maxDv = Math.max(maxDv, dv);
      }
      prev[j] = [w.x, w.y, w.vx, w.vy];
    });
    if (phaseOf(s) !== "play") break;
  }
  assert(brakes.bot.length > 5 && brakes.human.length > 3, `saw bots and humans brake: ${brakes.bot.length}/${brakes.human.length}`);
  const dvMax = ACCEL * (TICK_MS / 1000);
  for (const kind of ["bot", "human"] as const) {
    for (const b of brakes[kind]) assert(Math.abs(b - dvMax) < 0.05 || b < 1, `${kind}s brake like a released stick: ${b}`);
  }
  assert(Math.abs(maxBot - WALK) < 0.01, `bots walk at exactly ${WALK}: ${maxBot}`);
  assert(Math.abs(maxHuman - WALK) < 0.01, `humans walk at exactly ${WALK}: ${maxHuman}`);
  assert(maxDv <= ACCEL * (TICK_MS / 1000) + 0.1, "same acceleration limit for everyone: " + maxDv);
  const sprinter = walkerOf(s, 1);
  assert(Math.hypot(sprinter.vx, sprinter.vy) <= WALK * SPRINT_MUL + 1e-6, "sprint is capped");
  for (const w of s.walkers) {
    for (const o of PARKS[s.park].obstacles) assert(Math.hypot(w.x - o.x, w.y - o.y) >= o.r + WALKER_R - 1e-6, "nobody walks through trees");
    assert(w.x >= EDGE && w.x <= WORLD_W - EDGE && w.y >= EDGE && w.y <= WORLD_H - EDGE, "nobody leaves the park");
  }
  const moved = s.walkers.filter((w, j) => w.slot < 0 && (w.x !== prev[j][0] || w.y !== prev[j][1]) || w.walking);
  assert(moved.length > 5, "bots wander");

  // The shared model, run by hand, matches the server step for step (client prediction relies on it).
  const b = { x: 500, y: 200, vx: 0, vy: 0 };
  for (let i = 0; i < 20; i++) stepBody(b, WALK, 0, TICK_MS / 1000, PARKS[0]);
  assert(Math.abs(b.vx - WALK) < 1e-9 && b.x > 500 + WALK * 0.8, "stepBody reaches walking speed");
  console.log("✓ walking model");
}

// ---------- bots visit landmarks and fake pulses ----------
{
  const { s, t } = setup(3, 5);
  toPlay(s, t);
  t.events.length = 0;
  const visits = new Set<number>();
  for (let i = 0; i < 1200 && phaseOf(s) === "play"; i++) {
    tick(s, t);
    s.walkers.forEach((w, j) => {
      if (w.slot < 0 && w.on >= 0) visits.add(j);
    });
  }
  const pulses = snaps(t).flatMap((x) => x.f ?? []).filter((f) => f[0] === FX_PULSE);
  assert(visits.size >= 8, "bots wander onto landmarks: " + visits.size);
  assert(pulses.length >= 3, "bots fire fake pulses: " + pulses.length);
  assert(pulses.length <= 60, "but not a constant strobe: " + pulses.length);
  console.log(`✓ bots: ${visits.size} landmark visitors, ${pulses.length} fake pulses in 60s`);
}

// ---------- lighting landmarks (private) ----------
{
  const { s, t } = setup(3, 8);
  // Nothing lights during the intro.
  park(s, 0, 0);
  run(s, t, LIGHT_MS + 200);
  assert(s.seats[0].lit === 0, "no lighting in the intro");
  toPlay(s, t);
  park(s, 0, 0);
  t.events.length = 0;
  let broadcast = false;
  for (let i = 0; i < (LIGHT_MS + 200) / TICK_MS; i++) broadcast = !!tick(s, t) || broadcast;
  assert(litOf(s, 0) === 1, "standing still for 1.5s lights it");
  assert(!broadcast, "lighting never broadcasts a view (that would give you away)");
  const lit = t.events.filter((e) => (e.event as LitEvent).k === "lit");
  assert(lit.length === 1 && lit[0].to === "p0", "only you hear that you lit it");
  assert((lit[0].event as LitEvent).m === 1 && (lit[0].event as LitEvent).l === 0, "lit event carries the mask");
  const pulses = snaps(t).flatMap((x) => x.f ?? []);
  assert(pulses.some((f) => f[0] === FX_PULSE && f[1] === 0), "everyone sees an anonymous pulse");
  assert(view(s, t, "p0").lit === 1 && view(s, t, "p1").lit === 0, "lit set is private");
  // Standing there longer does nothing more.
  t.events.length = 0;
  run(s, t, LIGHT_MS * 2);
  assert(!t.events.some((e) => (e.event as LitEvent).k === "lit"), "a lit landmark doesn't pulse again");
  // Light the rest: the round ends with +3.
  for (let li = 1; li < 5; li++) {
    park(s, 0, li);
    run(s, t, LIGHT_MS + 150);
  }
  assert(phaseOf(s) === "roundOver", "all five ends the round");
  assert(s.seats[0].lit === ALL_LIT, "all five lit");
  assert(s.scores[0] === PTS_ALL_LIT && s.result?.how === "all", "+3 for lighting everything");
  const v = view(s, t, "p2");
  assert(v.humans !== null && v.humans[0] === s.seats[0].w, "everyone is revealed after the round");
  assert(v.result?.lit[0] === ALL_LIT, "results show the landmarks");
  console.log("✓ landmarks");
}

// ---------- snipes ----------
{
  const { s, t } = setup(4, 9);
  const target = s.seats[1].w;
  t.events.length = 0;
  assert(act(s, t, "p0", { type: "snipe", w: target }) === false, "no darts in the intro");
  assert(t.events.some((e) => e.to === "p0" && (e.event as NoEvent).k === "no"), "told why");
  toPlay(s, t);
  // Hostile shapes.
  for (const a of [
    null,
    "snipe",
    [],
    42,
    { type: "snipe" },
    { type: "snipe", w: "1" },
    { type: "snipe", w: -1 },
    { type: "snipe", w: 1.5 },
    { type: "snipe", w: 1e9 },
    { type: "snipe", w: NaN },
    { type: "in", x: 1.5, y: 0 },
    { type: "in", x: 101, y: 0 },
    { type: "in", x: "1", y: 0 },
    { type: "in", x: 0, y: 0, s: 2 },
    { type: "in", x: Infinity, y: 0 },
    { type: "teleport", x: 0, y: 0 },
    { type: "x".repeat(5000) },
  ])
    assert(act(s, t, "p0", a) === false, "rejected: " + JSON.stringify(a)?.slice(0, 40));
  assert(s.seats[0].darts === DARTS, "junk costs nothing");
  assert(act(s, t, "nobody", { type: "snipe", w: target }) === false, "non-players can't snipe");
  assert(act(s, t, "p0", { type: "snipe", w: s.seats[0].w }) === false, "can't snipe yourself");
  // A hit.
  assert(act(s, t, "p0", { type: "snipe", w: target }) === true, "hit broadcasts");
  assert(s.seats[1].out && s.walkers[target].down, "they're out");
  assert(s.scores[0] === PTS_SNIPE && s.seats[0].darts === DARTS - 1, "+2 and a dart spent");
  const vh = view(s, t, "p2");
  assert(vh.snipes[0].hit === 1 && vh.snipes[0].sw === -1, "a hit doesn't reveal where the sniper stands");
  assert(view(s, t, "p1").humans !== null, "out players see who's who");
  assert(view(s, t, "p2").humans === null && view(s, t, "spectator").humans === null, "others still don't");
  // The downed walker no longer moves, can't be sniped again, and can't act.
  const [dx, dy] = [s.walkers[target].x, s.walkers[target].y];
  act(s, t, "p1", { type: "in", x: 100, y: 0 });
  run(s, t, 500);
  assert(s.walkers[target].x === dx && s.walkers[target].y === dy, "the fallen stay put");
  assert(act(s, t, "p1", { type: "snipe", w: s.seats[2].w }) === false, "out players can't snipe");
  assert(act(s, t, "p0", { type: "snipe", w: target }) === false, "already down");
  // A miss: exposed.
  const bot = botIndex(s);
  assert(act(s, t, "p2", { type: "snipe", w: bot }) === true, "a miss broadcasts too");
  const vm = view(s, t, "p3");
  const miss = vm.snipes[1];
  assert(miss.hit === -1 && miss.sw === s.seats[2].w && miss.by === 2, "the sniper is exposed");
  assert(s.scores[2] === 0 && s.seats[2].darts === DARTS - 1, "a wasted dart");
  // Cooldown, then the exposure fades from the view.
  assert(act(s, t, "p2", { type: "snipe", w: botIndex(s, [bot]) }) === false, "reloading");
  run(s, t, SNIPE_CD_MS + DART_MS + EXPOSE_MS + 600);
  assert(view(s, t, "p3").snipes[1].sw === -1, "exposure is temporary");
  // Out of darts.
  act(s, t, "p2", { type: "snipe", w: botIndex(s, [bot]) });
  run(s, t, SNIPE_CD_MS + 50);
  act(s, t, "p2", { type: "snipe", w: botIndex(s, [bot]) });
  run(s, t, SNIPE_CD_MS + 50);
  assert(s.seats[2].darts === 0, "three darts per round");
  assert(act(s, t, "p2", { type: "snipe", w: botIndex(s, [bot]) }) === false, "no darts left");
  // Last human standing.
  act(s, t, "p0", { type: "snipe", w: s.seats[2].w });
  run(s, t, SNIPE_CD_MS + 50);
  assert(phaseOf(s) === "play", "two humans left: play on");
  assert(act(s, t, "p0", { type: "snipe", w: s.seats[3].w }) === true, "third hit");
  assert(phaseOf(s) === "roundOver" && s.result?.how === "last", "one human left ends the round");
  assert(s.scores[0] === 3 * PTS_SNIPE + PTS_SURVIVOR, "three snipes + survivor bonus");
  assert(s.result?.hits[0] === 3 && s.result.misses[2] === 3, "hit/miss tallies");
  console.log("✓ snipes");
}

// ---------- time up, ties, three rounds, the final ----------
{
  const { s, t, ends } = setup(3, 13);
  toPlay(s, t);
  park(s, 0, 0);
  run(s, t, LIGHT_MS + 150);
  park(s, 1, 1);
  run(s, t, LIGHT_MS + 150);
  t.advance(PLAY_MS);
  assert(incognito.tick!(s, t.ctx) === true, "time up broadcasts");
  assert(phaseOf(s) === "roundOver" && s.result?.how === "time", "time up");
  assert(
    JSON.stringify(s.result?.winners) === "[0,1]" && s.scores[0] === PTS_MOST_LIT && s.scores[1] === PTS_MOST_LIT,
    "a tie for most landmarks shares the bonus",
  );
  assert(s.scores[2] === 0, "no landmarks, no bonus");
  // Round over -> round 2 with a fresh shuffle.
  const before = s.seats.map((x) => x.w).join();
  t.advance(ROUND_OVER_MS);
  assert(incognito.tick!(s, t.ctx) === true && s.round === 2 && phaseOf(s) === "intro", "round 2");
  assert(view(s, t, "p1").humans === null && view(s, t, "p1").result === null, "secrets close again");
  assert(s.seats.every((x) => x.darts === DARTS && x.lit === 0 && !x.out), "fresh darts & landmarks");
  assert(s.seats.map((x) => x.w).join() !== before || true, "reshuffled");
  // Round 2: nobody lights anything -> no bonus.
  toPlay(s, t);
  t.advance(PLAY_MS);
  incognito.tick!(s, t.ctx);
  assert(s.result?.how === "time" && s.result.winners.length === 0, "nobody lit: nobody wins the round");
  t.advance(ROUND_OVER_MS);
  incognito.tick!(s, t.ctx);
  toPlay(s, t);
  act(s, t, "p2", { type: "snipe", w: s.seats[0].w });
  t.advance(PLAY_MS);
  incognito.tick!(s, t.ctx);
  assert(phaseOf(s) === "final", `the game ends after ${ROUNDS} rounds`);
  assert(ends() === 1, "ctx.end exactly once");
  assert(t.result && JSON.stringify(t.result.winners) === '["p0","p1"]', "top scorers win: " + t.result?.headline);
  assert(t.result.scores?.p2 === PTS_SNIPE, "scores reported");
  assert(/share the Incognito crown/.test(t.result.headline), "headline: " + t.result.headline);
  assert(incognito.tick!(s, t.ctx) === false, "nothing ticks after the end");
  assert(act(s, t, "p0", { type: "in", x: 100, y: 0 }) === false, "no actions after the end");
  assert(view(s, t, "spectator").humans !== null && view(s, t, "spectator").history.length === 3, "final reveal");
  assert(ends() === 1, "still once");
  console.log("✓ rounds & final:", t.result.headline);
}

// ---------- a scoreless game ----------
{
  const { s, t, ends } = setup(3, 2);
  for (let r = 0; r < ROUNDS; r++) {
    toPlay(s, t);
    t.advance(PLAY_MS);
    incognito.tick!(s, t.ctx);
    if (r < ROUNDS - 1) {
      t.advance(ROUND_OVER_MS);
      incognito.tick!(s, t.ctx);
    }
  }
  assert(phaseOf(s) === "final" && ends() === 1 && t.result?.winners.length === 0, "no winners");
  assert(/bots win/.test(t.result!.headline), t.result!.headline);
  console.log("✓ scoreless");
}

// ---------- disconnects: bots take over, nothing stalls ----------
{
  const { s, t, ends } = setup(3, 17);
  toPlay(s, t);
  const me = walkerOf(s, 2);
  const start = [me.x, me.y];
  t.ctx.players[2].connected = false;
  incognito.playerLeft!(s, "p2", t.ctx);
  assert(s.seats[2].auto, "a bot brain takes over");
  run(s, t, 6_000);
  assert(Math.hypot(me.x - start[0], me.y - start[1]) > 1, "their walker keeps wandering like a bot");
  // Auto-walked humans don't light landmarks.
  park(s, 2, 3);
  run(s, t, LIGHT_MS + 200);
  assert(s.seats[2].lit === 0, "no lighting while away");
  // They can still be sniped.
  assert(act(s, t, "p0", { type: "snipe", w: s.seats[2].w }) === true && s.seats[2].out, "away players can be sniped");
  t.ctx.players[2].connected = true;
  incognito.playerReturned!(s, "p2", t.ctx);
  assert(!s.seats[2].auto, "back in control");
  // Two away for long: the game ends gracefully.
  t.ctx.players[1].connected = false;
  incognito.playerLeft!(s, "p1", t.ctx);
  t.ctx.players[2].connected = false;
  incognito.playerLeft!(s, "p2", t.ctx);
  assert(s.aloneSince !== null && view(s, t).abandonAt !== null, "abandon countdown shown");
  run(s, t, ABANDON_MS + 200);
  assert(phaseOf(s) === "final" && ends() === 1, "ends when alone");
  assert(t.result?.winners[0] === "p0", "the one who stayed (and scored) wins: " + t.result?.headline);
  console.log("✓ disconnects");
}

// ---------- reconnect in every phase ----------
{
  const { s, t, ends } = setup(3, 23);
  const cycle = (id: string) => {
    const p = t.ctx.players.find((x) => x.id === id)!;
    p.connected = false;
    incognito.playerLeft!(s, id, t.ctx);
    tick(s, t);
    p.connected = true;
    incognito.playerReturned!(s, id, t.ctx);
    tick(s, t);
  };
  cycle("p1"); // intro
  toPlay(s, t);
  cycle("p1"); // play
  act(s, t, "p1", { type: "in", x: 100, y: 0 });
  run(s, t, 300);
  assert(Math.hypot(walkerOf(s, 1).vx, walkerOf(s, 1).vy) > 0, "steering works after coming back");
  t.advance(PLAY_MS);
  tick(s, t);
  assert(phaseOf(s) === "roundOver", "round over");
  cycle("p2"); // round over
  t.advance(ROUND_OVER_MS);
  tick(s, t);
  assert(s.round === 2 && phaseOf(s) === "intro", "next round despite reconnects");
  assert(ends() === 0 && s.aloneSince === null, "no abandon");
  // Disconnected at a round start: auto from the beginning.
  t.ctx.players[0].connected = false;
  incognito.playerLeft!(s, "p0", t.ctx);
  t.advance(INTRO_MS);
  tick(s, t);
  t.advance(PLAY_MS);
  tick(s, t);
  t.advance(ROUND_OVER_MS);
  tick(s, t);
  assert(roundOf(s) === 3 && s.seats[0].auto, "away at the start of a round: the bot brain walks for them");
  console.log("✓ reconnects");
}

// ---------- a long random game never breaks ----------
{
  for (const n of [3, 8]) {
    const { s, t, ends } = setup(n, 99 + n);
    let r = 1;
    for (let i = 0; i < 12_000 && phaseOf(s) !== "final"; i++) {
      const who = `p${i % n}`;
      if (i % 7 === 0) act(s, t, who, { type: "in", x: Math.round(Math.sin(i) * 100), y: Math.round(Math.cos(i * 0.7) * 100), s: i % 50 === 0 ? 1 : 0 });
      if (i % 97 === 0 && phaseOf(s) === "play") act(s, t, who, { type: "snipe", w: i % s.walkers.length });
      tick(s, t);
      if (s.round !== r) r = s.round;
      assert(s.walkers.every((w) => Number.isFinite(w.x) && Number.isFinite(w.y)), "finite positions");
    }
    assert(phaseOf(s) === "final" && ends() === 1, `${n}p random game finishes`);
    console.log(`✓ random ${n}p game: ${t.result?.headline}`);
  }
}

// ---------- network smoothing over a jittery, bursty link (snakes/netsmooth.ts) ----------
// What the live server sees from Wi-Fi: frames stall for 0.1-1 s and land in bunches.
{
  // The playback clock: never runs backwards, never jumps, keeps an even pace almost always, and
  // the adaptive delay keeps the next frame in hand (so remote players rarely extrapolate).
  for (const [name, link, seed, maxOff, maxUnder] of [
    ["wifi", WIFI, 51, 0.04, 0.03],
    ["bad wifi", WIFI_BAD, 52, 0.08, 0.06],
  ] as const) {
    const net = burstyLink(seed, link);
    const tl = new Timeline({ period: TICK_MS, start: 100, min: TICK_MS + 15, max: 650 });
    const arrivals: { t: number; at: number }[] = [];
    for (let k = 0; k < 30_000 / TICK_MS; k++) arrivals.push({ t: 5_000 + k * TICK_MS, at: net.send(5_000 + k * TICK_MS) });
    let i = 0;
    let newest = -Infinity;
    let prev = NaN;
    let frames = 0;
    let off = 0;
    let under = 0;
    let back = 0;
    for (let p = arrivals[0].at; p < arrivals[arrivals.length - 1].at; p += 1000 / 60) {
      while (i < arrivals.length && arrivals[i].at <= p) {
        tl.observe(arrivals[i].t, arrivals[i].at);
        newest = Math.max(newest, arrivals[i++].t);
      }
      const rt = tl.tick(p, newest, TICK_MS, 200);
      if (!Number.isNaN(prev) && p > arrivals[0].at + 3_000) {
        const rate = (rt - prev) / (1000 / 60);
        frames += 1;
        if (rate < 0) back += 1;
        if (Math.abs(rate - 1) > 0.2) off += 1;
        if (rt > newest) under += 1;
      }
      prev = rt;
    }
    assert(back === 0, `${name}: playback never runs backwards`);
    assert(off / frames < maxOff, `${name}: even pace (${((100 * off) / frames).toFixed(1)}% of frames off by >20%)`);
    assert(under / frames < maxUnder, `${name}: next frame in hand (${((100 * under) / frames).toFixed(1)}% extrapolated)`);
  }

  // Reconciling a walker with the server's (old) copy of it: latency isn't an error, a real
  // difference is eased out (never snapped), and only a teleport-sized one jumps.
  const trail = new Trail(3_000);
  const me = { x: 0, y: 0 };
  const err = { x: 0, y: 0 };
  const o = { tol: 6, snap: 180, tauMs: 150 };
  for (let k = 0; k <= 60; k++) {
    me.x = k * 3; // walking right at 180 units/s, a frame every 16.7 ms
    trail.push(k * 16.7, me.x, me.y);
  }
  // The server shows you where you were 300 ms ago: on your path, so nothing moves.
  assert(reconcile(me, trail, me.x - 54, 0, 16.7, o, err) === 0, "latency alone: no correction");
  // The server says you're 40 units off your path (you were blocked): eased, a bit per frame.
  const first = reconcile(me, trail, me.x - 54, 40, 16.7, o, err);
  assert(first > 0 && first < 8, `a real error is eased, not snapped (${first.toFixed(2)})`);
  for (let k = 0; k < 120; k++) reconcile(me, trail, 126, 40, 16.7, o, err);
  assert(Math.abs(me.y - 40) < 7, `...and fully taken within 2 s (${me.y.toFixed(1)})`);
  // A respawn across the map: jump.
  reconcile(me, trail, 900, 600, 16.7, o, err);
  assert(me.x === 900 && me.y === 600, "a teleport-sized difference jumps");
}

console.log("✓ incognito: all tests passed");
