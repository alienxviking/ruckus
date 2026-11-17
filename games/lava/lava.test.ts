// Run with: npx tsx games/lava/lava.test.ts
import { assert, makeTestCtx } from "../../shared/testing";
import lava, { collide, type LavaState, type LavaView } from "./server";
import { LavaPredictor, worldOfSnap, type PredictedContact } from "./predict";
import { CORR_MS, CORR_SNAP } from "./arena";
import { Spring2D, Timeline } from "../snakes/netsmooth";
import { WIFI, WIFI_BAD, burstyLink, type BurstyOptions } from "../snakes/netsim";
import {
  ABANDON_MS,
  CAMP_MS,
  CENTER,
  COLLAPSE_EVERY_MS,
  COLLAPSE_START_MS,
  COUNTDOWN_MS,
  CRACK_STAGE_MS,
  FLOAT_MS,
  FX_FALL,
  FX_HIT,
  FX_JUMP,
  FX_PICKUP,
  FX_SHOCK,
  GONE,
  JUMP_CD_MS,
  JUMP_MS,
  MAX_ROUNDS,
  POWER_FIRST_MS,
  ROUND_OVER_MS,
  SUB_MS,
  TICK_MS,
  TILE,
  WINS_NEEDED,
  board,
  hexDist,
  tileAt,
  tileOf,
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
  const s = lava.setup(t.ctx);
  return { t, s, ends: () => ends };
}

const view = (s: LavaState, t: T, who = "p0") => lava.view(s, who, t.ctx) as LavaView;
const step = (s: LavaState, t: T) => {
  t.advance(TICK_MS);
  return lava.tick!(s, t.ctx);
};
const run = (s: LavaState, t: T, ms: number) => {
  for (let left = ms; left > 0; left -= TICK_MS) step(s, t);
};
function startFight(s: LavaState, t: T) {
  t.advance(COUNTDOWN_MS);
  assert(lava.tick!(s, t.ctx) === true, "countdown -> fight returns true");
  assert(s.phase === "fight", "fight started");
}
const phaseOf = (s: LavaState): string => s.phase;
const snaps = (t: T) => t.events.map((e) => e.event as Snap).filter((e) => e && e.k === "s");
const simT = (s: LavaState) => s.fightAt + s.steps * SUB_MS;
const input = (s: LavaState, t: T, slot: number, x: number, y: number) =>
  lava.action(s, s.ids[slot], { type: "input", x, y }, t.ctx);

/** A clean floor (no holes, nothing cracking). */
function clearFloor(s: LavaState) {
  s.tiles = s.tiles.map(() => 0);
  s.crackAt = s.crackAt.map(() => 0);
  s.cracking = [];
  s.powers = [];
  s.powerAt = Infinity;
}

/** Put a player at the centre of tile (q, r), standing still. */
function place(s: LavaState, slot: number, q: number, r: number) {
  const b = board(s.R);
  const i = tileOf(b, q, r);
  assert(i >= 0, "placed on the arena");
  const p = s.runners[slot];
  p.x = b.tiles[i].x;
  p.y = b.tiles[i].y;
  p.vx = 0;
  p.vy = 0;
  p.tile = i;
  p.tileSince = simT(s);
  return i;
}

/** Keep bystanders out of the story: their floor stays solid and they never count as camping. */
function fidget(s: LavaState, _t: T, slots: number[]) {
  const b = board(s.R);
  for (const slot of slots) {
    const r = s.runners[slot];
    if (!r.alive) continue;
    const i = tileAt(b, r.x, r.y);
    for (const j of i >= 0 ? [i, ...b.near[i]] : []) {
      s.tiles[j] = 0;
      s.crackAt[j] = 0;
    }
    s.cracking = s.cracking.filter((j) => s.crackAt[j] > 0);
    r.tileSince = simT(s);
  }
}

// ---------- hex grid ----------
{
  for (const R of [6, 7]) {
    const b = board(R);
    assert(b.tiles.length === 3 * R * (R + 1) + 1, `hex count for R=${R}`);
    assert(b.tiles.length >= 120 && b.tiles.length <= 180, "120-180 tiles");
    b.tiles.forEach((h, i) => {
      assert(tileAt(b, h.x, h.y) === i, "tile centre maps to itself");
      for (let a = 0; a < 6; a++) {
        const x = h.x + Math.cos(a + 0.3) * TILE * 0.8;
        const y = h.y + Math.sin(a + 0.3) * TILE * 0.8;
        const j = tileAt(b, x, y);
        assert(j === i || (j >= 0 ? hexDist(b.tiles[j].q - h.q, b.tiles[j].r - h.r) === 1 : h.d === R), "near points land on the tile or a neighbour");
      }
      assert(b.near[i].length === (h.d === R ? (h.q === 0 || h.r === 0 || h.q + h.r === 0 ? 3 : 4) : 6) || h.d < R, "neighbours");
    });
    assert(tileAt(b, CENTER + b.halfW + 50, CENTER) === -1, "off the arena = -1");
  }
}

// ---------- setup & spawning ----------
{
  for (const n of [2, 4, 5, 8]) {
    const { s, t } = setup(n);
    const b = board(s.R);
    assert(s.R === (n <= 4 ? 6 : 7), "arena radius by player count");
    assert(s.phase === "countdown" && s.round === 1 && s.endsAt === t.ctx.now() + COUNTDOWN_MS, "starts in countdown");
    const holes = s.tiles.filter((x) => x === GONE).length;
    assert(holes > 0 && holes <= s.R + 1, `a few holes (${holes})`);
    for (const r of s.runners) {
      const i = tileAt(b, r.x, r.y);
      assert(i >= 0 && s.tiles[i] === 0, "spawn on a solid tile");
      for (const nb of b.near[i]) assert(s.tiles[nb] === 0, "no hole next to a spawn");
    }
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        assert(Math.hypot(s.runners[i].x - s.runners[j].x, s.runners[i].y - s.runners[j].y) > TILE * 2, "spawns apart");
    const v = view(s, t);
    assert(v.board.length === b.tiles.length && v.snap.p.length === n, "view carries the board and snapshot");
    const json = JSON.stringify(v);
    assert(!json.includes("undefined") && JSON.stringify(JSON.parse(json)) === json, "view is plain JSON");
    assert(json.length < 4_000, `view is small (${json.length} B)`);
    assert(JSON.stringify(view(s, t, "spectator")) === json, "spectators see the public view");
  }
}

// ---------- countdown: inputs stored, nothing moves, jumps refused ----------
{
  const { s, t } = setup(2);
  const x0 = s.runners[0].x;
  assert(input(s, t, 0, 100, 0) === false, "input never re-broadcasts");
  assert(s.runners[0].ix === 1, "input stored in the countdown");
  assert(lava.action(s, "p0", { type: "jump" }, t.ctx) === false && !s.runners[0].jumpQueued, "no jump in countdown");
  for (let i = 0; i < 10; i++) assert(step(s, t) === false, "countdown ticks quiet");
  assert(s.runners[0].x === x0 && snaps(t).length === 0, "nothing moves, no snapshots");
  startFight(s, t);
  step(s, t);
  assert(s.runners[0].x > x0, "held input works the moment the fight starts");
}

// ---------- stepping off a tile cracks it; it falls 0.9 s later through 3 stages ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  clearFloor(s);
  const start = place(s, 0, 0, 0);
  place(s, 1, -4, 4);
  input(s, t, 0, 100, 0);
  const seen = new Set<number>();
  let fellAt = 0;
  for (let i = 0; i < 40 && !fellAt; i++) {
    step(s, t);
    if (i % 4 === 0) fidget(s, t, [1]);
    if (s.tiles[start] > 0) seen.add(s.tiles[start]);
    if (s.tiles[start] === GONE) fellAt = simT(s);
  }
  assert(seen.has(1) && seen.has(2) && seen.has(3) && seen.has(GONE), "crack stages 1-3, then gone");
  const startedAt = s.crackAt[start];
  assert(startedAt === 0, "crack timer cleared once fallen");
  const deltas = snaps(t).flatMap((sn) => sn.c ?? []);
  const forStart: number[] = [];
  for (let k = 0; k < deltas.length; k += 2) if (deltas[k] === start) forStart.push(deltas[k + 1]);
  assert(forStart.join() === "1,2,3,4", `snapshots carry tile deltas (${forStart})`);
  const v = view(s, t);
  assert(v.board[start] === String(GONE), "view board shows the hole");
  assert(s.runners[0].alive, "runner kept going");
}

// ---------- camping: 1.2 s on one tile cracks it, then you fall; round ends ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  clearFloor(s);
  const i0 = place(s, 0, 0, 0);
  place(s, 1, 3, -3);
  let crackedAt = 0;
  let fell = false;
  t.events.length = 0;
  for (let k = 0; k < 60 && !fell; k++) {
    fidget(s, t, [1]);
    const changed = step(s, t);
    if (!crackedAt && s.crackAt[i0]) crackedAt = s.crackAt[i0] - s.fightAt;
    if (!s.runners[0].alive) {
      fell = true;
      assert(changed === true, "a fall re-broadcasts the view");
    }
  }
  assert(crackedAt >= CAMP_MS - TICK_MS && crackedAt <= CAMP_MS + TICK_MS, `camping cracks at ~1.2s (${crackedAt})`);
  assert(fell, "camper falls in");
  assert(phaseOf(s) === "roundOver" && s.lastWinner === "p1" && s.wins[1] === 1, "last one standing takes the round");
  assert(s.history.length === 1 && s.history[0].order[0] === 0, "history records the fall order");
  const fx = snaps(t).flatMap((sn) => sn.fx ?? []);
  assert(s.snap.fx?.some((e) => e[0] === FX_FALL && e[1] === 0) || fx.some((e) => e[0] === FX_FALL), "fall effect sent");
  const v = view(s, t);
  assert(v.falls.length === 1 && v.falls[0].by === -1, "fell on their own");
  // Round over: frozen floor, then the next round.
  const tilesBefore = s.tiles.join("");
  run(s, t, ROUND_OVER_MS - 100);
  assert(phaseOf(s) === "roundOver" && s.tiles.join("") === tilesBefore, "floor frozen while the round is decided");
  run(s, t, 200);
  assert(phaseOf(s) === "countdown" && s.round === 2 && s.runners.every((r) => r.alive), "next round respawns everyone");
  assert(s.tiles.filter((x) => x !== 0 && x !== GONE).length === 0, "fresh floor");
}

// ---------- jump: clears one missing tile, never two; cooldown; airborne doesn't crack ----------
function gapRun(jump: boolean, gaps: number) {
  const { s, t } = setup(2);
  startFight(s, t);
  clearFloor(s);
  place(s, 1, -3, 5);
  // Holes along the row r = 0 at q = 1..gaps; run from q = -3 to the right.
  const b = board(s.R);
  for (let g = 1; g <= gaps; g++) s.tiles[tileOf(b, g, 0)] = GONE;
  // Row r=0 drifts in y with q; aim along the axial direction (1, 0) -> world (1.5, sqrt3/2) normalised.
  place(s, 0, -3, 0);
  const dir = [1.5, Math.sqrt(3) / 2];
  const m = Math.hypot(dir[0], dir[1]);
  input(s, t, 0, Math.round((dir[0] / m) * 100), Math.round((dir[1] / m) * 100));
  let jumped = false;
  for (let k = 0; k < 70; k++) {
    step(s, t);
    if (k % 4 === 0) fidget(s, t, [1]);
    const p = s.runners[0];
    if (!p.alive) break;
    const [hq] = [1];
    const hole = b.tiles[tileOf(b, hq, 0)];
    if (jump && !jumped && Math.hypot(p.x - hole.x, p.y - hole.y) < TILE * 1.45) {
      assert(lava.action(s, "p0", { type: "jump" }, t.ctx) === false, "jump returns false");
      jumped = true;
    }
  }
  return { s, t };
}
{
  const { s: fallS } = gapRun(false, 1);
  assert(!fallS.runners[0].alive, "running into a hole without jumping = lava");
  const { s, t } = gapRun(true, 1);
  assert(s.runners[0].alive, "a jump clears one missing tile");
  assert(snaps(t).some((sn) => sn.fx?.some((e) => e[0] === FX_JUMP && e[1] === 0)), "jump effect sent");
  const { s: two } = gapRun(true, 2);
  assert(!two.runners[0].alive, "a jump can't clear two missing tiles");
}
{
  const { s, t } = setup(2);
  startFight(s, t);
  clearFloor(s);
  const i0 = place(s, 0, 0, 0);
  place(s, 1, 4, -4);
  lava.action(s, "p0", { type: "jump", s: 5 }, t.ctx);
  step(s, t);
  const p = s.runners[0];
  assert(s.steps - p.jumpStep < 6 && !p.jumpQueued, "jump taken off");
  assert(s.crackAt[i0] > 0, "jumping off a tile cracks it");
  // Airborne over the cracking tile: no fall even when it goes.
  assert(lava.action(s, "p0", { type: "jump" }, t.ctx) === false && !p.jumpQueued, "no second jump during cooldown");
  const sn = s.snap;
  const mine = sn.p.find((x) => x[0] === 0)!;
  assert(mine.length === 7 && (mine[6] ?? 0) > 0, "snapshot carries the jump cooldown");
  assert(sn.a?.some((a) => a[0] === 0 && a[1] === 5), "jump acknowledged");
  run(s, t, JUMP_MS - 100);
  assert(p.alive, "still in the air");
  run(s, t, 1_200);
  assert(!p.alive, "landed on the tile that fell meanwhile -> lava");
  // Cooldown: ready again after JUMP_CD_MS.
  const { s: s2, t: t2 } = setup(2);
  startFight(s2, t2);
  clearFloor(s2);
  place(s2, 0, 0, 0);
  place(s2, 1, 4, -4);
  lava.action(s2, "p0", { type: "jump" }, t2.ctx);
  step(s2, t2);
  const j0 = s2.runners[0].jumpStep;
  for (let ms = 0; ms < JUMP_CD_MS - 150; ms += TICK_MS) {
    lava.action(s2, "p0", { type: "jump" }, t2.ctx);
    fidget(s2, t2, [0, 1]);
    step(s2, t2);
  }
  assert(s2.runners[0].jumpStep === j0, "cooldown holds");
  for (let ms = 0; ms < 300; ms += TICK_MS) {
    fidget(s2, t2, [0, 1]);
    step(s2, t2);
  }
  lava.action(s2, "p0", { type: "jump" }, t2.ctx);
  step(s2, t2);
  assert(s2.runners[0].jumpStep > j0, "jump ready again after the cooldown");
}

// ---------- bumps ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  const a = s.runners[0];
  const b = s.runners[1];
  Object.assign(a, { x: 500, y: 600, vx: 220, vy: 0 });
  Object.assign(b, { x: 530, y: 600, vx: -40, vy: 0 });
  collide(s, a, b, simT(s));
  assert(b.vx > 150 && a.vx < 40, "a bump passes momentum on");
  assert(Math.hypot(a.x - b.x, a.y - b.y) >= 39.99, "pushed apart");
  assert(a.hitBy === 1 && b.hitBy === 0, "shove credit both ways");
  assert(s.fx.some((e) => e[0] === FX_HIT), "hard bump shown");
  // Knocked into the lava: knockout credit.
  clearFloor(s);
  const bd = board(s.R);
  place(s, 0, 0, 0);
  place(s, 1, 1, 0);
  s.tiles[tileOf(bd, 2, 0)] = GONE;
  s.tiles[tileOf(bd, 3, 0)] = GONE;
  s.tiles[tileOf(bd, 3, -1)] = GONE;
  s.tiles[tileOf(bd, 2, 1)] = GONE;
  s.tiles[tileOf(bd, 2, -1)] = GONE;
  const dir = [1.5, Math.sqrt(3) / 2];
  input(s, t, 0, Math.round((dir[0] / Math.hypot(dir[0], dir[1])) * 100), Math.round((dir[1] / Math.hypot(dir[0], dir[1])) * 100));
  s.runners[0].vx = 260;
  s.runners[0].vy = 150;
  run(s, t, 1_000);
  assert(!s.runners[1].alive, "bumped into the lava");
  assert(s.kos[0] === 1 && s.falls[0].by === 0, "knockout credited to the bumper");
  // A jumper sails over people on the ground.
  const { s: s2, t: t2 } = setup(2);
  startFight(s2, t2);
  clearFloor(s2);
  place(s2, 0, 0, 0);
  place(s2, 1, 1, 0);
  s2.runners[0].jumpStep = s2.steps;
  s2.runners[0].vx = 250;
  s2.runners[0].vy = 145;
  const vb = s2.runners[1].vx;
  step(s2, t2);
  step(s2, t2);
  assert(s2.runners[1].vx === vb, "no bump between a jumper and someone on the ground");
}

// ---------- power-ups ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  for (let ms = 0; ms < POWER_FIRST_MS + 200; ms += TICK_MS) {
    fidget(s, t, [0, 1]);
    step(s, t);
  }
  assert(s.powers.length >= 1, "a power-up spawns after ~4s");
  const p = s.powers[0];
  assert(s.tiles[p.tile] === 0 && board(s.R).tiles[p.tile].d < s.ring - 1, "on a solid tile in the safe zone");
  const v = view(s, t);
  assert(v.snap.u.length >= 1 && v.snap.u[0][1] === p.tile, "power-ups ride in the snapshot");
}
{
  // Rebuild: restores holes and cracks around you, not further.
  const { s, t } = setup(2);
  startFight(s, t);
  clearFloor(s);
  const b = board(s.R);
  place(s, 1, 4, -4);
  const far = tileOf(b, -4, 1);
  const near1 = tileOf(b, 1, 0);
  const near2 = tileOf(b, 0, 2);
  s.tiles[far] = GONE;
  s.tiles[near1] = GONE;
  s.tiles[near2] = GONE;
  const target = place(s, 0, 0, 1);
  s.powers = [{ kind: "rebuild", tile: tileOf(b, 0, 0) }];
  s.runners[0].x = b.tiles[tileOf(b, 0, 0)].x;
  s.runners[0].y = b.tiles[tileOf(b, 0, 0)].y;
  step(s, t);
  assert(s.powers.length === 0, "picked up");
  assert(s.tiles[near1] === 0 && s.tiles[near2] === 0, "nearby holes rebuilt");
  assert(s.tiles[far] === GONE, "far hole stays");
  assert(snaps(t).some((sn) => sn.fx?.some((e) => e[0] === FX_PICKUP && e[2] === 0)) || s.snap.fx?.some((e) => e[0] === FX_PICKUP), "pickup effect");
  void target;
}
{
  // Float: hover over lava for 3 s, then drop.
  const { s, t } = setup(2);
  startFight(s, t);
  clearFloor(s);
  const b = board(s.R);
  place(s, 1, -4, 4);
  const i0 = place(s, 0, 0, 0);
  s.powers = [{ kind: "float", tile: i0 }];
  step(s, t);
  assert(s.runners[0].floatUntil > simT(s) + FLOAT_MS - 200, "floating");
  for (const nb of [i0, ...b.near[i0]]) s.tiles[nb] = GONE;
  for (let ms = 0; ms < FLOAT_MS - 300; ms += TICK_MS) {
    fidget(s, t, [1]);
    step(s, t);
  }
  assert(s.runners[0].alive, "hovering over lava");
  const fl = s.snap.p.find((x) => x[0] === 0)!;
  assert(((fl[5] ?? 0) & 1) === 1, "float flag in snapshot");
  run(s, t, 600);
  assert(!s.runners[0].alive, "float runs out over lava -> fall");
}
{
  // Shockwave: cracks the floor around everyone else, not you.
  const { s, t } = setup(3);
  startFight(s, t);
  clearFloor(s);
  const b = board(s.R);
  const mine = place(s, 0, 0, 0);
  const v1 = place(s, 1, 3, -3);
  const v2 = place(s, 2, -3, 3);
  s.powers = [{ kind: "shock", tile: mine }];
  step(s, t);
  for (const v of [v1, v2]) {
    assert(s.crackAt[v] > 0, "victim's tile cracks");
    for (const nb of b.near[v]) assert(s.crackAt[nb] > 0 || s.tiles[nb] !== 0, "and the ring around it");
  }
  for (const nb of b.near[mine]) assert(s.crackAt[nb] === 0, "your own floor is untouched");
  assert(s.fx.some((e) => e[0] === FX_SHOCK) || s.snap.fx?.some((e) => e[0] === FX_SHOCK), "shockwave effect");
}

// ---------- collapse: the outer rings crumble, then inward ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  const b = board(s.R);
  // Keep both players safe near the middle, shuffling between two tiles.
  for (let ms = 0; ms < COLLAPSE_START_MS + COLLAPSE_EVERY_MS + 1_500; ms += TICK_MS) {
    for (const slot of [0, 1]) {
      const r = s.runners[slot];
      const tx = CENTER + (slot ? 40 : -40) + (Math.floor(ms / 700) % 2 ? 30 : -30);
      input(s, t, slot, Math.max(-100, Math.min(100, Math.round((tx - r.x) * 2 - r.vx * 0.4))), Math.max(-100, Math.min(100, Math.round((CENTER - r.y) * 2 - r.vy * 0.4))));
    }
    step(s, t);
    // Keep the middle intact (only the collapse matters here).
    b.tiles.forEach((h, i) => {
      if (h.d <= 2 && s.tiles[i] !== 0) {
        s.tiles[i] = 0;
        s.crackAt[i] = 0;
      }
    });
    if (ms === COLLAPSE_START_MS - 1_000) assert(s.ring === s.R + 1, "nothing collapses before 25 s");
  }
  assert(s.ring === s.R - 1, `two rings gone (${s.ring})`);
  b.tiles.forEach((h, i) => {
    if (h.d >= s.R) assert(s.tiles[i] === GONE, "outer ring gone");
  });
  assert(s.runners.every((r) => r.alive), "players in the middle survive");
}

// ---------- falls show at once in snapshots; full views follow at most every 500 ms ----------
{
  const { s, t } = setup(4);
  startFight(s, t);
  clearFloor(s);
  const b = board(s.R);
  place(s, 0, 0, 0);
  place(s, 1, 3, -3);
  const holeA = place(s, 2, -3, 3);
  const holeB = place(s, 3, 3, 0);
  s.tiles[holeA] = GONE;
  s.tiles[holeB] = GONE;
  t.events.length = 0;
  fidget(s, t, [0, 1]);
  assert(step(s, t) === false, "a fall right after a view doesn't re-send the view at once");
  assert(!s.runners[2].alive && !s.runners[3].alive, "both fell");
  assert(snaps(t).some((sn) => (sn.fx ?? []).filter((e) => e[0] === FX_FALL).length === 2), "falls ride in the snapshot");
  let views = 0;
  for (let i = 0; i < 12; i++) {
    fidget(s, t, [0, 1]);
    if (step(s, t)) views += 1;
  }
  assert(views === 1, `one coalesced view (${views})`);
  assert(view(s, t).falls.length === 2, "the view lists both falls");
  void b;
}

// ---------- full match: p1 keeps falling in, p0 wins 3 rounds ----------
{
  const { s, t, ends } = setup(3);
  for (let round = 1; round <= WINS_NEEDED; round++) {
    assert(s.round === round && phaseOf(s) === "countdown", `round ${round} countdown`);
    startFight(s, t);
    const b = board(s.R);
    // p1 and p2 step into a hole; p0 fidgets.
    for (const slot of [1, 2]) {
      const hole = s.tiles.findIndex((x) => x === GONE);
      s.runners[slot].x = b.tiles[hole].x;
      s.runners[slot].y = b.tiles[hole].y;
    }
    fidget(s, t, [0]);
    assert(step(s, t) === true, "falls broadcast");
    if (round < WINS_NEEDED) {
      assert(phaseOf(s) === "roundOver" && s.wins[0] === round, "p0 takes the round");
      run(s, t, ROUND_OVER_MS + 100);
    }
  }
  assert(phaseOf(s) === "final" && ends() === 1, "match ends once");
  assert(t.result?.winners.join() === "p0" && t.result.scores?.p0 === 3, "p0 champion with 3 wins");
  assert(/Player0/.test(t.result.headline), "headline names the winner");
  assert(lava.action(s, "p0", { type: "input", x: 1, y: 0 }, t.ctx) === false, "actions ignored after the end");
  run(s, t, 1_000);
  assert(ends() === 1, "end called exactly once");
  const v = view(s, t);
  assert(v.champions?.join() === "p0" && v.history.length === 3, "final view");
}

// ---------- draws all the way: max rounds, nobody wins ----------
{
  const { s, t, ends } = setup(2);
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    startFight(s, t);
    const b = board(s.R);
    const hole = s.tiles.findIndex((x) => x === GONE);
    for (const r of s.runners) {
      r.x = b.tiles[hole].x;
      r.y = b.tiles[hole].y + (r.slot ? 1 : -1);
    }
    step(s, t);
    if (round < MAX_ROUNDS) {
      assert(phaseOf(s) === "roundOver" && s.lastWinner === null, "both melted together = draw");
      run(s, t, ROUND_OVER_MS + 100);
    }
  }
  assert(phaseOf(s) === "final" && ends() === 1 && t.result?.winners.length === 0, "draws -> nobody wins");
  assert(/lava wins/i.test(t.result!.headline), "draw headline");
}

// ---------- hostile actions ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  const before = JSON.stringify(s.runners);
  const junk: unknown[] = [
    null,
    undefined,
    42,
    "jump",
    [],
    [1, 2],
    {},
    { type: "x" },
    { type: "input" },
    { type: "input", x: "1", y: 0 },
    { type: "input", x: 1.5, y: 0 },
    { type: "input", x: 101, y: 0 },
    { type: "input", x: Number.NaN, y: 0 },
    { type: "input", x: Infinity, y: 0 },
    { type: "input", x: 1, y: 0, s: -1 },
    { type: "input", x: 1, y: 0, s: "1" },
    { type: "input", x: 1, y: 0, s: 1.5 },
    { type: "jump", s: 2 ** 40 },
    { type: "__proto__" },
    { type: "input", x: 1, y: 0, extra: "a".repeat(10_000) }, // extra fields are just ignored
  ];
  for (const a of junk.slice(0, -1)) {
    assert(lava.action(s, "p0", a as never, t.ctx) === false, `junk rejected: ${JSON.stringify(a)}`);
  }
  assert(JSON.stringify(s.runners) === before, "junk changes nothing");
  assert(lava.action(s, "spectator", { type: "input", x: 100, y: 0 }, t.ctx) === false, "non-player ignored");
  assert(JSON.stringify(s.runners) === before, "non-player changes nothing");
  // Diagonal over-length input is clamped to magnitude 1.
  input(s, t, 0, 100, 100);
  assert(Math.abs(Math.hypot(s.runners[0].ix, s.runners[0].iy) - 1) < 1e-9, "input clamped to the unit circle");
}

// ---------- disconnects ----------
{
  // A disconnected player stands still, camps, and falls: the round still ends.
  const { s, t } = setup(3);
  startFight(s, t);
  t.ctx.players[2].connected = false;
  input(s, t, 2, 100, 0);
  lava.playerLeft!(s, "p2", t.ctx);
  assert(s.runners[2].ix === 0, "input zeroed on leave");
  const off = s.snap.p.find((x) => x[0] === 2)!;
  assert(((off[5] ?? 0) & 4) === 4, "offline flag in snapshot");
  for (let ms = 0; ms < 4_000; ms += TICK_MS) {
    fidget(s, t, [0, 1]);
    step(s, t);
  }
  assert(!s.runners[2].alive, "idle disconnected player melts (no stall)");
  t.ctx.players[2].connected = true;
  lava.playerReturned!(s, "p2", t.ctx);
  assert(s.aloneSince === null, "plenty still online");
}
{
  // Down to one online player in every phase: the match ends after ABANDON_MS, a return cancels it.
  for (const where of ["countdown", "fight", "roundOver"]) {
    const { s, t, ends } = setup(2);
    if (where !== "countdown") startFight(s, t);
    if (where === "roundOver") {
      const b = board(s.R);
      const hole = s.tiles.findIndex((x) => x === GONE);
      s.runners[1].x = b.tiles[hole].x;
      s.runners[1].y = b.tiles[hole].y;
      step(s, t);
      assert(phaseOf(s) === "roundOver", "in round over");
    }
    t.ctx.players[1].connected = false;
    lava.playerLeft!(s, "p1", t.ctx);
    assert(view(s, t).abandonAt === t.ctx.now() + ABANDON_MS, `${where}: abandon timer shown`);
    run(s, t, 2_000);
    t.ctx.players[1].connected = true;
    lava.playerReturned!(s, "p1", t.ctx);
    assert(s.aloneSince === null && view(s, t).abandonAt === null, `${where}: return cancels`);
    t.ctx.players[1].connected = false;
    lava.playerLeft!(s, "p1", t.ctx);
    for (let ms = 0; ms < ABANDON_MS + 4_000 && phaseOf(s) !== "final"; ms += TICK_MS) {
      fidget(s, t, [0]);
      step(s, t);
    }
    assert(phaseOf(s) === "final" && ends() === 1, `${where}: match ends`);
    assert(t.result?.winners.join() === "p0" && /everyone else left/.test(t.result.headline), `${where}: forfeit to p0`);
  }
  // Everyone gone.
  const { s, t, ends } = setup(2);
  startFight(s, t);
  for (const i of [0, 1]) {
    t.ctx.players[i].connected = false;
    lava.playerLeft!(s, `p${i}`, t.ctx);
  }
  run(s, t, ABANDON_MS + 500);
  assert(phaseOf(s) === "final" && ends() === 1 && /everyone left/.test(t.result!.headline), "abandoned");
}

// ---------- network: quiet frames skipped, 8-player snapshots small ----------
{
  const { s, t } = setup(8);
  startFight(s, t);
  t.events.length = 0;
  let bytes = 0;
  let ticks = 0;
  for (let ms = 0; ms < 6_000; ms += TICK_MS) {
    for (let slot = 0; slot < 8; slot++) {
      const a = (ms / 600 + slot) % (Math.PI * 2);
      if (ms % 150 === 0) input(s, t, slot, Math.round(Math.cos(a) * 100), Math.round(Math.sin(a) * 100));
    }
    step(s, t);
    ticks += 1;
  }
  for (const e of t.events) bytes += JSON.stringify({ t: "ev", e: e.event }).length;
  const perSec = bytes / (ticks * TICK_MS / 1000);
  if (process.env.VERBOSE) console.log("8p snapshot B/s", Math.round(perSec));
  assert(perSec < 7_000, `8 players: ${Math.round(perSec)} B/s of snapshots`);
  // Nothing moving: frames are skipped (with a heartbeat).
  const { s: q, t: tq } = setup(2);
  startFight(q, tq);
  step(q, tq);
  tq.events.length = 0;
  for (let i = 0; i < 10; i++) step(q, tq);
  assert(tq.events.length <= 3, `idle frames skipped (${tq.events.length})`);
}

// ---------- prediction: the client's replay of your own inputs matches the server ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  clearFloor(s);
  place(s, 0, -2, 0);
  place(s, 1, 4, -4);
  const pred = new LavaPredictor();
  // Zero latency: the client's clock is the server's clock; inputs land on the next substep.
  pred.attachClock({ ready: true, serverNow: () => t.ctx.now() });
  pred.attachRtt(() => 0);
  let worst = 0;
  const feed = () => {
    const sn = s.snap;
    for (const a of sn.a ?? []) if (a[0] === 0) pred.ack(a[1], sn.t + a[2]);
    const me = sn.p.find((x) => x[0] === 0);
    if (me) pred.setBase({ n: sn.n, t: sn.t, x: me[1], y: me[2], vx: me[3], vy: me[4], cd: me[6] ?? 0 });
  };
  const plan: [number, number, number, boolean][] = [
    [0, 60, 0, false],
    [400, 60, 50, false],
    [700, 60, 50, true],
    [1_400, -80, 0, false],
    [2_000, 0, -90, true],
    [2_600, 0, 0, false],
  ];
  let pi = 0;
  for (let ms = 0; ms < 3_200; ms += TICK_MS) {
    while (pi < plan.length && plan[pi][0] <= ms) {
      const [, x, y, j] = plan[pi++];
      const seq = pred.recordInput(x, y, 0);
      lava.action(s, "p0", { type: "input", x, y, s: seq }, t.ctx);
      if (j) lava.action(s, "p0", { type: "jump", s: pred.recordJump(0) }, t.ctx);
    }
    fidget(s, t, [1]);
    step(s, t);
    feed();
    // Keep the floor solid around p0 so only motion is compared.
    s.tiles = s.tiles.map(() => 0);
    s.crackAt = s.crackAt.map(() => 0);
    s.cracking = [];
    // Predict 2 substeps ahead from the newest snapshot and compare after the server catches up.
    const out = { x: 0, y: 0, vx: 0, vy: 0 };
    pred.predict(s.snap.t, out);
    const me = s.runners[0];
    worst = Math.max(worst, Math.hypot(out.x - Math.round(me.x), out.y - Math.round(me.y)));
  }
  assert(s.runners[0].alive, "predicted runner survived");
  if (process.env.VERBOSE) console.log("prediction worst", worst.toFixed(2));
  assert(worst < 2, `prediction at the snapshot time matches (${worst.toFixed(2)})`);
  // Predicting ahead with the same inputs: compare 150ms later against the server.
  const out = { x: 0, y: 0, vx: 0, vy: 0 };
  const seq = pred.recordInput(80, 20, 0);
  lava.action(s, "p0", { type: "input", x: 80, y: 20, s: seq }, t.ctx);
  pred.predict(s.snap.t + 150, out);
  run(s, t, 150);
  const me = s.runners[0];
  assert(Math.hypot(out.x - me.x, out.y - me.y) < 6, `prediction ahead matches (${Math.hypot(out.x - me.x, out.y - me.y).toFixed(2)})`);
}

// ---------- your runner over a jittery, bursty link (what the live server sees from Wi-Fi) ----------
// Drawn the way arena.tsx draws it (the renderer's clock, the replay at serverNow + lead, every
// correction, acknowledgements included, blended out by a spring): no lurches when a bunch lands.
function lavaJitter(link: BurstyOptions, seed: number, secs = 10) {
  const { s, t } = setup(2, seed);
  startFight(s, t);
  clearFloor(s);
  place(s, 0, 0, 0);
  place(s, 1, 4, -4);
  const upLink = burstyLink(seed, link);
  const downLink = burstyLink(seed + 100, link);
  const clock = new Timeline({ period: TICK_MS, start: 100, min: TICK_MS + 15, max: 650 });
  const pred = new LavaPredictor();
  pred.attachClock(clock);
  let rnd = seed * 7919 + 13;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  const toServer: { at: number; a: unknown }[] = [];
  const toClient: { at: number; snap: Snap }[] = [];
  const deliver = (snap: Snap) => toClient.push({ at: downLink.send(t.ctx.now()), snap: JSON.parse(JSON.stringify(snap)) });
  deliver(s.snap);
  const k = { x: 0, y: 0, vx: 0, vy: 0 };
  const k2 = { x: 0, y: 0, vx: 0, vy: 0 };
  const corr = new Spring2D(CORR_MS);
  const drawn: [number, number][] = [];
  const t0 = t.ctx.now();
  let nextTick = t0 + TICK_MS;
  let nextInput = t0 + 100;
  let nextFrame = t0;
  let target: [number, number] = [CENTER, CENTER];
  for (let now = t0; now < t0 + secs * 1_000; now += 1) {
    t.advance(now - t.ctx.now());
    while (toServer.length && toServer[0].at <= now) lava.action(s, "p0", toServer.shift()!.a as never, t.ctx);
    if (now >= nextTick) {
      nextTick += TICK_MS;
      t.events.length = 0;
      // Solid floor throughout: only motion is under test.
      clearFloor(s);
      for (const r of s.runners) r.tileSince = simT(s);
      if (lava.tick!(s, t.ctx)) deliver(s.snap);
      for (const e of snaps(t)) deliver(e);
    }
    while (toClient.length && toClient[0].at <= now) {
      const { snap } = toClient.shift()!;
      clock.observe(snap.t, now);
      const T = clock.serverNow(now) + pred.lead(now);
      const had = pred.base?.n === snap.n && pred.predict(T, k);
      for (const a of snap.a ?? []) if (a[0] === 0) pred.ack(a[1], snap.t + a[2], a[3] === undefined ? undefined : snap.t + a[3], now);
      const me = snap.p.find((x) => x[0] === 0);
      if (me) pred.setBase({ n: snap.n, t: snap.t, x: me[1], y: me[2], vx: me[3], vy: me[4], cd: me[6] ?? 0 });
      if (had && pred.predict(T, k2)) {
        corr.add(k.x - k2.x, k.y - k2.y, (k.vx - k2.vx) / 1000, (k.vy - k2.vy) / 1000);
        if (corr.size > CORR_SNAP) corr.reset();
      }
    }
    if (now >= nextFrame) {
      nextFrame += 1000 / 60;
      clock.tick(now);
      if (pred.predict(clock.serverNow(now) + pred.lead(now), k)) {
        corr.step(1000 / 60);
        if (now - t0 > 1_500) drawn.push([k.x + corr.x, k.y + corr.y]);
      }
    }
    if (now >= nextInput) {
      nextInput = now + 150 + Math.floor(rand() * 200);
      if (rand() < 0.4) {
        const a = rand() * Math.PI * 2;
        target = [CENTER + Math.cos(a) * 100, CENTER + Math.sin(a) * 100];
      }
      if (!pred.predict(clock.serverNow(now) + pred.lead(now), k)) continue;
      let ix = (target[0] - k.x) * 0.9 - k.vx * 0.45;
      let iy = (target[1] - k.y) * 0.9 - k.vy * 0.45;
      const m = Math.hypot(ix, iy) || 1;
      [ix, iy] = [Math.round((ix / m) * 100), Math.round((iy / m) * 100)];
      const seq = pred.recordInput(ix, iy, now);
      toServer.push({ at: upLink.send(now), a: { type: "input", x: ix, y: iy, s: seq, at: pred.stamp(seq) } });
    }
  }
  const lurch: number[] = [];
  for (let i = 2; i < drawn.length; i++) {
    lurch.push(Math.hypot(drawn[i][0] - 2 * drawn[i - 1][0] + drawn[i - 2][0], drawn[i][1] - 2 * drawn[i - 1][1] + drawn[i - 2][1]));
  }
  lurch.sort((a, b) => a - b);
  const span = secs - 1.5;
  return {
    alive: s.runners[0].alive,
    p95: lurch[Math.floor(lurch.length * 0.95)],
    max: lurch[lurch.length - 1],
    lurchesPerS: lurch.filter((v) => v > 3).length / span,
  };
}

for (const [name, link, seed, lim] of [
  ["wifi", WIFI, 41, [2.5, 2.5]],
  ["wifi", WIFI, 42, [2.5, 2.5]],
  ["bad wifi", WIFI_BAD, 43, [4, 4]],
] as const) {
  const r = lavaJitter(link, seed);
  const label = `lava net ${name} #${seed}`;
  if (process.env.NET_VERBOSE) console.log(label, { p95: r.p95.toFixed(2), max: r.max.toFixed(1), lurchesPerS: r.lurchesPerS.toFixed(2) });
  assert(r.alive, `${label}: still standing`);
  assert(r.p95 < lim[0], `${label}: your runner moves smoothly (p95 lurch ${r.p95.toFixed(2)} units/frame)`);
  assert(r.lurchesPerS < lim[1], `${label}: no visible lurches (${r.lurchesPerS.toFixed(2)}/s)`);
}

// ---------- the predicted players bump the way the server bumps them ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  clearFloor(s);
  place(s, 0, -1, 0);
  place(s, 1, 1, -1);
  Object.assign(s.runners[0], { vx: 180, vy: 0, ix: 1, iy: 0 });
  Object.assign(s.runners[1], { vx: -150, vy: 10, ix: -1, iy: 0 });
  step(s, t);
  const w = worldOfSnap(s.snap);
  const pred = new LavaPredictor();
  const out: ({ x: number; y: number; vx: number; vy: number } | undefined)[] = [];
  const contacts: PredictedContact[] = [];
  pred.predictWorld(s.snap.t + 300, w, -1, out, contacts);
  for (let ms = 0; ms < 300; ms += TICK_MS) {
    clearFloor(s);
    fidget(s, t, [0, 1]);
    step(s, t);
  }
  assert(contacts.length > 0 && contacts[0].j > 60, "the prediction sees the bump coming");
  for (const slot of [0, 1]) {
    const r = s.runners[slot];
    const e = Math.hypot(out[slot]!.x - r.x, out[slot]!.y - r.y);
    assert(e < 6, `predicted player ${slot} ends where the server puts them after the bump (${e.toFixed(1)})`);
  }
}

// ---------- stamped inputs: early ones wait for their substep, late ones count back (bounded) ----------
{
  const { s, t } = setup(2);
  startFight(s, t);
  clearFloor(s);
  place(s, 0, 0, 0);
  step(s, t);
  const sim = (k: number) => s.fightAt + k * SUB_MS;
  const stick = () => s.runners[0].ix as number;
  lava.action(s, "p0", { type: "input", x: 100, y: 0, s: 1, at: Math.round(sim(s.steps + 2)) }, t.ctx);
  assert(stick() === 0, "an early input waits");
  step(s, t);
  assert(stick() === 1, "...and lands on its substep");
  const a = (s.snap.a ?? []).find((x) => x[1] === 1);
  assert(a && typeof a[3] === "number", "acknowledged with its arrival time");
  const vy = s.runners[0].vy;
  lava.action(s, "p0", { type: "input", x: 0, y: 100, s: 2, at: Math.round(sim(s.steps + 1) - 100) }, t.ctx);
  assert(s.runners[0].vy > vy + 20, `a late input counts back (vy ${s.runners[0].vy.toFixed(0)})`);
  const vy2 = s.runners[0].vy;
  lava.action(s, "p0", { type: "input", x: 0, y: -100, s: 3, at: Math.round(sim(s.steps + 1) - 1_000) }, t.ctx);
  assert(vy2 - s.runners[0].vy < 2 * 600 * 0.16, `rewind is bounded (${(vy2 - s.runners[0].vy).toFixed(0)})`);
  assert(lava.action(s, "p0", { type: "input", x: 0, y: 0, s: 4, at: Number.POSITIVE_INFINITY }, t.ctx) === false, "a bad stamp is refused");
}

// ---------- host settings: first to 2 ends sooner; the crumble timer moves ----------
{
  const t = makeTestCtx(2, 7, { wins: 2, crumble: 15_000 });
  const s = lava.setup(t.ctx);
  assert(s.winsNeeded === 2 && s.maxRounds === 5 && s.collapseMs === 15_000, "settings read into state");
  const v = view(s, t);
  assert(v.winsNeeded === 2 && v.maxRounds === 5 && v.collapseMs === 15_000, "settings in the view");
  for (let round = 1; round <= 2; round++) {
    startFight(s, t);
    const b = board(s.R);
    const hole = s.tiles.findIndex((x) => x === GONE);
    s.runners[1].x = b.tiles[hole].x;
    s.runners[1].y = b.tiles[hole].y;
    fidget(s, t, [0]);
    step(s, t);
    if (round < 2) run(s, t, ROUND_OVER_MS + 100);
  }
  assert(phaseOf(s) === "final" && t.result?.winners.join() === "p0", "two round wins take the match");
  const d = makeTestCtx(2, 7);
  const sd = lava.setup(d.ctx);
  assert(sd.winsNeeded === WINS_NEEDED && sd.maxRounds === MAX_ROUNDS && sd.collapseMs === COLLAPSE_START_MS, "defaults = classic");

  // A 15 s crumble starts the edge going at 15 s, not 25 s.
  const q = makeTestCtx(2, 9, { crumble: 15_000 });
  const sq = lava.setup(q.ctx);
  startFight(sq, q);
  for (let ms = 0; ms < 15_500 && sq.phase === "fight"; ms += TICK_MS) {
    fidget(sq, q, [0, 1]);
    for (const r of sq.runners) {
      r.x = CENTER + (r.slot ? 30 : -30);
      r.y = CENTER;
      r.vx = 0;
      r.vy = 0;
      r.alive = true;
    }
    board(sq.R).tiles.forEach((h, i) => {
      if (h.d <= 1) {
        sq.tiles[i] = 0;
        sq.crackAt[i] = 0;
      }
    });
    step(sq, q);
  }
  assert(sq.ring <= sq.R, `edges crumble by 15.5 s (${sq.ring})`);
}

// ---------- practice bots: an all-bot match plays itself to the end ----------
for (const seed of [1, 2, 3]) {
  const n = 2 + seed;
  const t = makeTestCtx(n, seed, {}, n);
  const s = lava.setup(t.ctx);
  let acts = 0;
  for (let i = 0; i < 20 * 60 * 15 && !t.result; i++) {
    t.advance(TICK_MS);
    lava.tick!(s, t.ctx);
    for (const id of t.ids) {
      const a = lava.bot!(s, id, t.ctx);
      if (a) {
        acts += 1;
        lava.action(s, id, a, t.ctx);
      }
    }
  }
  assert(t.result, `all-bot match ends (seed ${seed}, round ${s.round})`);
  assert(acts > 50, "bots steer");
}
// One human standing still among bots: the bots win rounds, the match ends.
{
  const t = makeTestCtx(3, 5, { wins: 2 }, 2);
  const s = lava.setup(t.ctx);
  for (let i = 0; i < 20 * 60 * 10 && !t.result; i++) {
    t.advance(TICK_MS);
    lava.tick!(s, t.ctx);
    for (const id of t.ids.slice(1)) {
      const a = lava.bot!(s, id, t.ctx);
      if (a) lava.action(s, id, a, t.ctx);
    }
  }
  assert(t.result && t.result.winners.every((w) => w.startsWith("bot-")), "bots outlast an idle human");
}

void CRACK_STAGE_MS;
console.log("✓ lava tests passed");
