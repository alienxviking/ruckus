import game, { type OBState, type OBView } from "./server";
import { assert, makeTestCtx } from "../../shared/testing";
import {
  FLASH_R,
  F_CURE,
  F_ZOMBIE,
  INTRO_MS,
  ITEM_CURE,
  ITEM_FIRST_MS,
  ITEM_FLASH,
  LUNGE_CD_MS,
  MAPS,
  PLAY_MS,
  PTS_BITE,
  PTS_CURE,
  PTS_SURVIVE,
  PTS_WIPEOUT,
  ROUND_OVER_MS,
  R_S,
  R_Z,
  SHIELD_MS,
  TURN_MS,
  decodeFlags,
  decodePositions,
  encodePositions,
  freeSpot,
  isSnap,
  type Snap,
} from "./shared";
import { TICK_MS } from "./shared";
import { Timeline, Trail, reconcile } from "../snakes/netsmooth";
import { WIFI, WIFI_BAD, burstyLink } from "../snakes/netsim";

type T = ReturnType<typeof makeTestCtx>;

function start(n: number, seed = 7) {
  const t = makeTestCtx(n, seed);
  const s = game.setup(t.ctx);
  return { t, s };
}

/** Advance the clock in 50ms ticks; returns how many ticks asked for a view broadcast. */
function run(t: T, s: OBState, ms: number) {
  let changed = 0;
  for (let k = 0; k < ms; k += 50) {
    t.advance(50);
    if (game.tick!(s, t.ctx)) changed++;
  }
  return changed;
}

function toPlay(t: T, s: OBState) {
  run(t, s, INTRO_MS + 50);
  assert(ph(s) === "play", `expected play, got ${ph(s)}`);
}

/** Park everyone far apart in the open, standing still. */
function park(s: OBState) {
  // Ward 13 has open floor along the middle row.
  s.map = 0;
  const spots: [number, number][] = [
    [360, 270],
    [640, 270],
    [360, 430],
    [640, 430],
    [90, 350],
    [910, 350],
    [250, 290],
    [750, 290],
    [250, 410],
    [750, 410],
    [620, 350],
    [380, 350],
  ];
  s.seats.forEach((x, i) => {
    [x.x, x.y] = spots[i];
    x.vx = x.vy = x.ix = x.iy = 0;
  });
}

// Read through functions so TypeScript doesn't narrow state across ticks.
const ph = (s: OBState) => s.phase;
const rd = (s: OBState) => s.round;
const how = (s: OBState) => s.result?.how;
const zombies = (s: OBState) => s.seats.flatMap((x, i) => (x.zombie ? [i] : []));
const lastSnap = (t: T): Snap => {
  for (let i = t.events.length - 1; i >= 0; i--) if (isSnap(t.events[i].event)) return t.events[i].event as Snap;
  throw new Error("no snapshot");
};

// ---------- setup ----------
{
  for (const n of [3, 7, 8, 12]) {
    const { t, s } = start(n, n * 13);
    const z = zombies(s);
    assert(z.length === (n >= 8 ? 2 : 1), `${n} players: ${z.length} zombies`);
    assert(z.every((i) => s.seats[i].original), "patient zeros are marked");
    for (const x of s.seats) assert(freeSpot(MAPS[s.map], x.x, x.y, x.zombie ? R_Z : R_S), "everyone spawns in the open");
    // Survivors start away from the zombies.
    for (const [i, x] of s.seats.entries()) {
      if (x.zombie) continue;
      const d = Math.min(...z.map((j) => Math.hypot(s.seats[j].x - x.x, s.seats[j].y - x.y)));
      assert(d > 120, `survivor ${i} spawned ${d.toFixed(0)} from a zombie`);
    }
    const v = game.view(s, t.ids[0], t.ctx) as OBView;
    assert(v.phase === "intro" && v.zombies.length === z.length && v.items.length === 0, "intro view");
    assert(JSON.stringify(v).length < 4_000, `view is small (${JSON.stringify(v).length})`);
  }
}

// ---------- codec ----------
{
  const xy = [0, 0, 1000, 700, 12.4, 699.6, 1023, 1023];
  const back = decodePositions(encodePositions(xy));
  assert(back.join() === "0,0,1000,700,12,700,1023,1023", `positions round-trip: ${back.join()}`);
  assert(decodePositions("!!!!").length === 2, "bad characters decode without throwing");
  assert(decodeFlags("A_").join() === "0,63", "flags round-trip");
}

// ---------- intro: survivors get a head start, zombies are frozen ----------
{
  const { t, s } = start(4);
  const [z] = zombies(s);
  const sv = s.seats.findIndex((x) => !x.zombie);
  const z0 = { x: s.seats[z].x, y: s.seats[z].y };
  const s0 = { x: s.seats[sv].x, y: s.seats[sv].y };
  game.action(s, t.ids[z], { type: "in", x: 100, y: 0 }, t.ctx);
  game.action(s, t.ids[sv], { type: "in", x: 0, y: 100 }, t.ctx);
  game.action(s, t.ids[sv], { type: "in", x: 100, y: 0 }, t.ctx);
  run(t, s, 1_000);
  assert(s.seats[z].x === z0.x && s.seats[z].y === z0.y, "zombie can't move in the intro");
  assert(Math.hypot(s.seats[sv].x - s0.x, s.seats[sv].y - s0.y) > 40, "survivor runs in the intro");
  assert(game.action(s, t.ids[z], { type: "use" }, t.ctx) === false, "no lunge in the intro");
  run(t, s, INTRO_MS);
  assert(ph(s) === "play" && s.endsAt > t.ctx.now() + PLAY_MS - 2_000, "intro -> play");
  run(t, s, 500);
  assert(Math.abs(s.seats[z].x - z0.x) > 5 || Math.abs(s.seats[z].y - z0.y) > 5, "zombie wakes and moves");
  // Snapshots go out as events, with every seat.
  const snap = lastSnap(t);
  assert(snap.p.length === 16 && snap.f.length === 4, "snapshot has every seat");
  assert(JSON.stringify(snap).length < 120, `snapshot is tiny (${JSON.stringify(snap).length})`);
}

// ---------- infection ----------
{
  const { t, s } = start(4, 3);
  toPlay(t, s);
  park(s);
  const [z] = zombies(s);
  const v = s.seats.findIndex((x) => !x.zombie);
  s.seats[v].x = s.seats[z].x + 20;
  s.seats[v].y = s.seats[z].y;
  const before = s.scores[z];
  const changed = run(t, s, 50);
  assert(s.seats[v].zombie, "touch infects");
  assert(changed === 1, "an infection broadcasts the view");
  assert(s.scores[z] === before + PTS_BITE && s.bites[z] === 1, "biter scores");
  assert(s.feed.length === 1 && s.feed[0].k === 0 && s.feed[0].a === v && s.feed[0].b === z, "feed records the bite");
  const view = game.view(s, t.ids[0], t.ctx) as OBView;
  assert(view.zombies.includes(v) && view.snap.fx?.some((f) => f[0] === 0 && f[1] === v), "view carries the bite effect");
  // A fresh zombie staggers: it can't bite or move for TURN_MS.
  const third = s.seats.findIndex((x) => !x.zombie);
  park(s);
  s.seats[z].x = 100;
  s.seats[z].y = 600;
  s.seats[third].x = s.seats[v].x + 20;
  s.seats[third].y = s.seats[v].y;
  s.seats[v].stunUntil = s.roundAt + s.steps * 25 + TURN_MS;
  run(t, s, 300);
  assert(!s.seats[third].zombie, "a turning zombie can't bite");
  run(t, s, TURN_MS);
  assert(s.seats[third].zombie, "after turning it bites");
}

// ---------- cures ----------
{
  const { t, s } = start(4, 5);
  toPlay(t, s);
  park(s);
  const [z] = zombies(s);
  const [a, b] = s.seats.flatMap((x, i) => (x.zombie ? [] : [i]));
  // a becomes an ordinary zombie, b carries a cure.
  s.seats[a].zombie = true;
  s.seats[b].cure = true;
  s.seats[b].x = s.seats[a].x + 22;
  s.seats[b].y = s.seats[a].y;
  run(t, s, 50);
  assert(!s.seats[a].zombie && !s.seats[b].zombie, "cure turns a zombie back");
  assert(!s.seats[b].cure, "cure is single use");
  assert(s.scores[b] === PTS_CURE && s.cures[b] === 1, "medic scores");
  assert(s.feed.some((f) => f.k === 1 && f.a === a && f.b === b), "feed records the cure");
  const fl = decodeFlags(lastSnap(t).f);
  assert(!(fl[a] & F_ZOMBIE), "snapshot shows the cure");
  // The cured are shielded briefly.
  s.seats[a].x = s.seats[z].x + 20;
  s.seats[a].y = s.seats[z].y;
  run(t, s, 100);
  assert(!s.seats[a].zombie, "shield protects the freshly cured");
  run(t, s, SHIELD_MS);
  assert(s.seats[a].zombie, "shield wears off");
  // Patient zero is immune: the carrier is bitten instead.
  park(s);
  s.seats[b].cure = true;
  s.seats[b].x = s.seats[z].x + 20;
  s.seats[b].y = s.seats[z].y;
  run(t, s, 50);
  assert(s.seats[z].zombie && s.seats[b].zombie && !s.seats[b].cure, "cures don't work on patient zero");
}

// ---------- flash & lunge ----------
{
  const { t, s } = start(5, 9);
  toPlay(t, s);
  park(s);
  const [z] = zombies(s);
  const sv = s.seats.flatMap((x, i) => (x.zombie ? [] : [i]));
  const user = sv[0];
  assert(game.action(s, t.ids[user], { type: "use" }, t.ctx) === false, "no flash without one");
  s.seats[user].flash = true;
  s.seats[z].x = s.seats[user].x + FLASH_R - 30;
  s.seats[z].y = s.seats[user].y;
  assert(game.action(s, t.ids[user], { type: "use" }, t.ctx) === true, "flash works");
  assert(!s.seats[user].flash, "flash is used up");
  const zx = s.seats[z].x;
  game.action(s, t.ids[z], { type: "in", x: -100, y: 0 }, t.ctx);
  // A stunned zombie can't move or bite, even touching someone.
  s.seats[sv[1]].x = s.seats[z].x + 5;
  s.seats[sv[1]].y = s.seats[z].y + 18;
  run(t, s, 1_000);
  assert(s.seats[z].x === zx || Math.abs(s.seats[z].x - zx) < 1, "stunned zombie stands still");
  assert(!s.seats[sv[1]].zombie, "stunned zombie can't bite");
  assert(game.action(s, t.ids[z], { type: "use" }, t.ctx) === false, "stunned zombie can't lunge");
  // Lunge after the stun, then a cooldown.
  game.action(s, t.ids[z], { type: "in", x: 0, y: 0 }, t.ctx);
  run(t, s, 1_500);
  park(s);
  [s.seats[z].x, s.seats[z].y] = [330, 270];
  game.action(s, t.ids[z], { type: "in", x: 100, y: 0 }, t.ctx);
  run(t, s, 100);
  const x0 = s.seats[z].x;
  assert(game.action(s, t.ids[z], { type: "use" }, t.ctx) === false, "lunge goes out in the snapshot, not the view");
  assert(s.seats[z].lungeUntil > 0, "lunge started");
  run(t, s, 300);
  assert(s.seats[z].x - x0 > 70, `lunge covers ground (${(s.seats[z].x - x0).toFixed(0)})`);
  assert(t.events.some((e) => isSnap(e.event) && (e.event as Snap).fx?.some((f) => f[0] === 4 && f[1] === z)), "lunge effect sent");
  const until = s.seats[z].lungeUntil;
  game.action(s, t.ids[z], { type: "use" }, t.ctx);
  assert(s.seats[z].lungeUntil === until, "lunge has a cooldown");
  run(t, s, LUNGE_CD_MS);
  game.action(s, t.ids[z], { type: "use" }, t.ctx);
  assert(s.seats[z].lungeUntil > until, "lunge recharges");
  // Survivors' USE without a flash does nothing.
  assert(game.action(s, t.ids[sv[2]], { type: "use" }, t.ctx) === false, "no-op use");
}

// ---------- doors: survivors fit, zombies don't ----------
{
  for (const [mi, m] of MAPS.entries()) {
    assert(m.doors.length >= 3, `${m.name} has doors`);
    for (const d of m.doors) {
      const [x, y, w, h] = d;
      const horiz = w > h;
      const { t, s } = start(3, 11);
      toPlay(t, s);
      s.map = mi;
      const [z] = zombies(s);
      const sv = s.seats.findIndex((q) => !q.zombie);
      const other = s.seats.findIndex((q, i) => !q.zombie && i !== sv);
      // Park the third player out of the way.
      s.seats[other].x = 5_000;
      for (const [slot, r] of [
        [sv, R_S],
        [z, R_Z],
      ] as const) {
        const seat = s.seats[slot];
        seat.x = horiz ? x + w / 2 : x - r - 4;
        seat.y = horiz ? y - r - 4 : y + h / 2;
        seat.vx = seat.vy = 0;
      }
      // Keep them apart so nobody gets bitten: zombie goes through a moment later.
      s.seats[z].x += horiz ? 0 : -60;
      s.seats[z].y += horiz ? -60 : 0;
      for (const slot of [sv, z]) game.action(s, t.ids[slot], { type: "in", x: horiz ? 0 : 100, y: horiz ? 100 : 0 }, t.ctx);
      run(t, s, 900);
      const passed = (slot: number) => (horiz ? s.seats[slot].y > y + h : s.seats[slot].x > x + w);
      assert(passed(sv), `${m.name}: survivor fits through door ${d.join(",")}`);
      assert(!passed(z), `${m.name}: zombie is blocked by door ${d.join(",")}`);
    }
  }
}

// ---------- items ----------
{
  const { t, s } = start(4, 21);
  toPlay(t, s);
  run(t, s, ITEM_FIRST_MS + 100);
  assert(s.items.length === 1, "first item spawns");
  run(t, s, 60_000);
  if (ph(s) === "play") {
    assert(s.items.filter((i) => i.kind === ITEM_CURE).length <= 2, "cure cap");
    assert(s.items.filter((i) => i.kind === ITEM_FLASH).length <= 2, "flash cap");
  }
  const { t: t2, s: s2 } = start(4, 22);
  toPlay(t2, s2);
  park(s2);
  const sv = s2.seats.findIndex((x) => !x.zombie);
  s2.items.push({ id: 99, kind: ITEM_CURE, x: Math.round(s2.seats[sv].x + 10), y: Math.round(s2.seats[sv].y) });
  assert(run(t2, s2, 50) === 1, "pickup broadcasts");
  assert(s2.seats[sv].cure && !s2.items.some((i) => i.id === 99), "survivor picks up the cure");
  assert(decodeFlags(s2.snap.f)[sv] & F_CURE, "snapshot shows the carried cure");
  // A zombie can't pick things up; a carrier can't take a second cure.
  const [z] = zombies(s2);
  s2.items.push({ id: 100, kind: ITEM_CURE, x: Math.round(s2.seats[z].x), y: Math.round(s2.seats[z].y) });
  s2.items.push({ id: 101, kind: ITEM_CURE, x: Math.round(s2.seats[sv].x), y: Math.round(s2.seats[sv].y) });
  run(t2, s2, 50);
  assert(s2.items.some((i) => i.id === 100) && s2.items.some((i) => i.id === 101), "no pickups for zombies or doubles");
}

// ---------- full game: rounds, scoring, end ----------
{
  const { t, s } = start(5, 31);
  const firstZ = zombies(s);
  // Round 1 runs out the clock: survivors score.
  toPlay(t, s);
  park(s);
  run(t, s, PLAY_MS + 100);
  assert(ph(s) === "roundOver" && how(s) === "time", "time runs out");
  for (const i of s.result?.survivors ?? []) assert(s.scores[i] >= PTS_SURVIVE, "survivors score");
  const r1 = s.scores.slice();
  run(t, s, ROUND_OVER_MS + 100);
  assert(ph(s) === "intro" && rd(s) === 2, "round 2 starts");
  const z2 = zombies(s);
  assert(z2.every((i) => !firstZ.includes(i)), "a different patient zero");
  assert(s.seats.every((x) => !x.cure && !x.flash) && s.items.length === 0, "fresh round");
  // Round 2: total infection ends the round early with a wipeout bonus.
  toPlay(t, s);
  park(s);
  const [z] = z2;
  for (const x of s.seats) if (!x.zombie) [x.x, x.y] = [s.seats[z].x + 15, s.seats[z].y + 10];
  run(t, s, 100);
  assert(ph(s) === "roundOver" && how(s) === "all", "total infection ends the round");
  assert(s.scores[z] === r1[z] + PTS_BITE * 4 + PTS_WIPEOUT, `wipeout bonus (${s.scores[z]} vs ${r1[z]})`);
  run(t, s, ROUND_OVER_MS + 100);
  assert(rd(s) === 3, "round 3");
  toPlay(t, s);
  run(t, s, PLAY_MS + 100);
  assert(ph(s) === "final", "game over after 3 rounds");
  assert(t.result !== null, "ctx.end called");
  const best = Math.max(...s.scores);
  const winners = s.ids.filter((_, i) => s.scores[i] === best);
  assert(t.result.winners.join() === winners.join(), "winners are the top scorers");
  assert(t.result.headline.includes("Player"), `headline names someone: ${t.result.headline}`);
  assert(game.action(s, t.ids[0], { type: "in", x: 100, y: 0 }, t.ctx) === false, "no actions after the end");
  assert(game.tick!(s, t.ctx) === false, "ticks idle after the end");
  const v = game.view(s, "spectator", t.ctx) as OBView;
  assert(v.phase === "final" && v.history.length === 3 && v.champions?.length, "final view");
}

// ---------- hostile actions ----------
{
  const { t, s } = start(3, 41);
  toPlay(t, s);
  const before = JSON.stringify(s);
  const junk: unknown[] = [
    null,
    42,
    "in",
    [],
    {},
    { type: "x" },
    { type: "__proto__" },
    { type: "in" },
    { type: "in", x: "1", y: 0 },
    { type: "in", x: 1.5, y: 0 },
    { type: "in", x: 101, y: 0 },
    { type: "in", x: Infinity, y: 0 },
    { type: "in", x: Number.NaN, y: 0 },
    { type: "in", x: [1], y: 0 },
    { type: "use", extra: "a".repeat(10_000) },
  ];
  const sv = s.seats.findIndex((x) => !x.zombie);
  for (const a of junk) assert(game.action(s, t.ids[sv], a as never, t.ctx) === false, `rejects ${JSON.stringify(a)?.slice(0, 40)}`);
  assert(game.action(s, "stranger", { type: "in", x: 100, y: 0 }, t.ctx) === false, "spectators can't act");
  assert(JSON.stringify(s) === before, "junk changes nothing");
  // Small inputs mean stand still.
  game.action(s, t.ids[sv], { type: "in", x: 10, y: 10 }, t.ctx);
  assert(s.seats[sv].ix === 0 && s.seats[sv].iy === 0, "deadzone");
}

// ---------- disconnects ----------
{
  const { t, s } = start(3, 51);
  toPlay(t, s);
  const sv = s.seats.findIndex((x) => !x.zombie);
  game.action(s, t.ids[sv], { type: "in", x: 100, y: 0 }, t.ctx);
  t.ctx.players[sv].connected = false;
  game.playerLeft!(s, t.ids[sv], t.ctx);
  assert(s.seats[sv].ix === 0, "a dropped player stops");
  run(t, s, 100);
  assert(decodeFlags(s.snap.f)[sv] & 32, "snapshot marks them offline");
  t.ctx.players[sv].connected = true;
  game.playerReturned!(s, t.ids[sv], t.ctx);
  // Two drop: the game ends after the grace period.
  for (const i of [0, 1]) {
    t.ctx.players[i].connected = false;
    game.playerLeft!(s, t.ids[i], t.ctx);
  }
  assert((game.view(s, t.ids[2], t.ctx) as OBView).abandonAt !== null, "abandon countdown shown");
  run(t, s, 5_000);
  t.ctx.players[0].connected = true;
  game.playerReturned!(s, t.ids[0], t.ctx);
  run(t, s, 100);
  assert(s.aloneSince === null && ph(s) !== "final", "a return cancels the countdown");
  t.ctx.players[0].connected = false;
  game.playerLeft!(s, t.ids[0], t.ctx);
  run(t, s, 10_500);
  assert(ph(s) === "final" && t.result !== null, "abandoned game ends");
  // Disconnects in the round-over pause and intro don't stall anything.
  const { t: t2, s: s2 } = start(4, 52);
  t2.ctx.players[1].connected = false;
  game.playerLeft!(s2, t2.ids[1], t2.ctx);
  toPlay(t2, s2);
  run(t2, s2, PLAY_MS + 100);
  assert(ph(s2) === "roundOver", "round ends with someone offline");
  run(t2, s2, ROUND_OVER_MS + 100);
  assert(ph(s2) === "intro" && rd(s2) === 2, "next round starts");
  assert(!s2.seats[1].original, "an offline player isn't made patient zero");
}

// ---------- traffic: quiet when nothing moves, small at 12 players ----------
{
  const { t, s } = start(12, 61);
  toPlay(t, s);
  park(s);
  const sv = s.seats.flatMap((x, i) => (x.zombie ? [] : [i]));
  for (const [k, i] of sv.entries()) game.action(s, t.ids[i], { type: "in", x: k % 2 ? 100 : -100, y: 30 }, t.ctx);
  t.events.length = 0;
  run(t, s, 2_000);
  const snaps = t.events.filter((e) => isSnap(e.event));
  const bytes = snaps.reduce((n, e) => n + JSON.stringify(e.event).length, 0);
  assert(snaps.length >= 35, `20 Hz snapshots (${snaps.length})`);
  assert(bytes / 2 < 4_000, `snapshot traffic at 12 players: ${(bytes / 2).toFixed(0)} B/s`);
  const v = game.view(s, t.ids[0], t.ctx);
  assert(JSON.stringify(v).length < 4_000, `view at 12 players: ${JSON.stringify(v).length} B`);
  // Round over: everyone stops, snapshots fall to a heartbeat.
  run(t, s, PLAY_MS);
  run(t, s, 500);
  t.events.length = 0;
  run(t, s, 2_000);
  const quiet = t.events.filter((e) => isSnap(e.event)).length;
  assert(quiet <= 3, `heartbeat only when still (${quiet})`);
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

// ---------- host settings: 2 short rounds ----------
{
  const t = makeTestCtx(3, 9, { rounds: 2, playSec: 45 });
  const s = game.setup(t.ctx);
  const v = game.view(s, t.ids[0], t.ctx) as OBView;
  assert(v.rounds === 2 && v.playMs === 45_000, "settings in the view");
  toPlay(t, s);
  park(s);
  assert(Math.abs(s.endsAt - t.ctx.now() - 45_000) <= 100, "45 s round");
  run(t, s, 45_000 + 100);
  assert(ph(s) === "roundOver" && how(s) === "time", "round 1 ends at 45 s");
  run(t, s, ROUND_OVER_MS + 100);
  toPlay(t, s);
  park(s);
  run(t, s, 45_000 + 100);
  assert(ph(s) === "final" && t.result !== null, "game over after 2 rounds");
  const d = start(3);
  const vd = game.view(d.s, d.t.ids[0], d.t.ctx) as OBView;
  assert(vd.rounds === 3 && vd.playMs === PLAY_MS, "defaults = classic");
}

// ---------- practice bots: all-bot games and bots with a human finish ----------
for (const n of [2, 4, 8]) {
  const t = makeTestCtx(n, n * 5, {}, n);
  const s = game.setup(t.ctx);
  let acts = 0;
  for (let i = 0; i < 20 * 60 * 10 && !t.result; i++) {
    t.advance(TICK_MS);
    game.tick!(s, t.ctx);
    for (const id of t.ids) {
      const a = game.bot!(s, id, t.ctx);
      if (a) {
        acts++;
        game.action(s, id, a, t.ctx);
      }
    }
  }
  assert(t.result, `all-bot game ends (${n} bots)`);
  assert(acts > 100, "bots move");
}
{
  const t = makeTestCtx(4, 21, {}, 3);
  const s = game.setup(t.ctx);
  for (let i = 0; i < 20 * 60 * 10 && !t.result; i++) {
    t.advance(TICK_MS);
    game.tick!(s, t.ctx);
    for (const id of t.ids.slice(1)) {
      const a = game.bot!(s, id, t.ctx);
      if (a) game.action(s, id, a, t.ctx);
    }
  }
  assert(t.result, "a game with one idle human and bots ends");
  assert(s.history.some((h) => h.bites.some((b) => b > 0)), "bot zombies bite someone");
}

console.log("✓ outbreak: all tests passed");
