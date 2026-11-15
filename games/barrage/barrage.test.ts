import { assert, makeTestCtx } from "../../shared/testing";
import game, { genTerrain, type BarrageState, type BarrageView } from "./server";
import { buildReplay, tankAlive, tankHp } from "./replay";
import {
  ABYSS_Y,
  AIM_MS,
  COLS,
  DT,
  FIRST_AIM_MS,
  FORFEIT_MS,
  FUEL,
  GRAVITY,
  H,
  MAX_TURNS,
  STEP_MS,
  TANK_LIFT,
  W,
  WIND_ACCEL,
  blastDamage,
  carve,
  decodeRuns,
  encodeRuns,
  groundAt,
  launch,
} from "./shared";

type T = ReturnType<typeof makeTestCtx>;

/** Count ctx.end calls (makeTestCtx only keeps the first result). */
function countEnds(t: T) {
  let n = 0;
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    n += 1;
    end(r);
  };
  return () => n;
}

// Read through functions so TypeScript doesn't keep narrowing from earlier asserts.
const phaseOf = (s: BarrageState) => s.phase;
const moveOf = (s: BarrageState, i: number) => s.tanks[i].aim.move;
const resultOf = (t: T) => t.result;

const view = (s: BarrageState, id: string, t: T) => JSON.parse(JSON.stringify(game.view(s, id, t.ctx))) as BarrageView;

/** Flat ground at y and tanks placed at xs. */
function arena(s: BarrageState, y: number, xs: number[]) {
  s.terrain = new Array<number>(COLS).fill(y);
  s.burnt = new Array<number>(COLS).fill(0);
  xs.forEach((x, i) => {
    s.tanks[i].x = x;
  });
}

/** Search for an angle/power whose path (with the current wind) passes closest to a point. */
function solve(s: BarrageState, from: number, tx: number, ty: number, lo = 20, hi = 160) {
  let best = { d: Infinity, angle: 45, power: 50 };
  for (let angle = lo; angle <= hi; angle++) {
    for (let power = 10; power <= 100; power++) {
      const L = launch(s.terrain, s.tanks[from].x, angle, power);
      let { x, y, vx, vy } = L;
      let d = Infinity;
      for (let k = 0; k < 600; k++) {
        vx += s.wind * WIND_ACCEL * DT;
        vy += GRAVITY * DT;
        x += vx * DT;
        y += vy * DT;
        d = Math.min(d, Math.hypot(x - tx, y - ty));
        if (x < 0 || x > W || y > H || y >= groundAt(s.terrain, x)) break;
      }
      if (d < best.d) best = { d, angle, power };
    }
  }
  return best;
}

/** Fire every live tank (optionally with specific shots), then tick through the volley. */
function volley(s: BarrageState, t: T, shots: Record<number, Record<string, unknown>> = {}) {
  s.tanks.forEach((k, i) => {
    if (!k.alive || k.locked) return;
    game.action(s, k.id, { type: "fire", ...(shots[i] ?? {}) }, t.ctx);
  });
  if (s.phase === "aim") {
    t.advance(s.endsAt - t.ctx.now() + 1);
    game.tick!(s, t.ctx);
  }
}

function finishVolley(s: BarrageState, t: T) {
  assert(s.phase === "resolve", "in resolve");
  t.advance(s.endsAt - t.ctx.now() + 1);
  assert(game.tick!(s, t.ctx) === true, "resolve ends on time");
}

// ---------- shared maths ----------
{
  assert(blastDamage(35, 34, 0) === 35, "point blank = max");
  assert(blastDamage(35, 34, 34) === 0 && blastDamage(35, 34, 50) === 0, "outside the blast = 0");
  assert(blastDamage(35, 34, 17) === Math.round(35 * Math.pow(0.5, 1.5)), "falloff ^1.5");
  assert(blastDamage(55, 60, -5) === 55, "inside the hull clamps to max");

  const flat = new Array<number>(COLS).fill(400);
  const burnt = new Array<number>(COLS).fill(0);
  carve(flat, burnt, 500, 400, 34);
  assert(flat[250] === 434, `crater bottom at the centre (${flat[250]})`);
  assert(flat[232] === 400 && flat[268] === 400, "outside the radius untouched");
  assert(flat[240] > 400 && flat[240] < 434, "bowl shape");
  assert(burnt[250] === 1 && burnt[200] === 0, "burnt marks the crater");
  // A buried blast: the ground above collapses into it by the chord length.
  const deep = new Array<number>(COLS).fill(300);
  carve(deep, null, 500, 400, 30);
  assert(deep[250] === 360, `buried crater collapses by 2r (${deep[250]})`);
  // The abyss is the floor: heights never pass H.
  const low = new Array<number>(COLS).fill(540);
  carve(low, null, 500, 540, 60);
  assert(low[250] === H, "carving clamps to the bottom");
  assert(low.every((v) => Number.isInteger(v)), "heights stay integers");

  const mask = new Array<number>(COLS).fill(0);
  for (const c of [0, 1, 2, 10, 500]) mask[c] = 1;
  const runs = encodeRuns(mask);
  assert(JSON.stringify(runs) === "[0,2,10,10,500,500]", `runs ${JSON.stringify(runs)}`);
  assert(JSON.stringify(decodeRuns(runs)) === JSON.stringify(mask), "runs round-trip");
}

// ---------- setup ----------
for (const n of [2, 3, 8]) {
  for (const seed of [1, 7, 42, 99]) {
    const t = makeTestCtx(n, seed);
    const s: BarrageState = game.setup(t.ctx);
    assert(s.terrain.length === COLS, "501 columns");
    assert(s.terrain.every((h) => Number.isInteger(h) && h >= 180 && h <= 500), "heights within 180..500");
    assert(s.tanks.length === n && s.tanks.every((k) => k.hp === 100 && k.alive && k.fuel === FUEL), "fresh tanks");
    const xs = s.tanks.map((k) => k.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert(xs[i] - xs[i - 1] > 40, `tanks spread out (${xs.join(",")})`);
    assert(xs[0] >= 14 && xs[xs.length - 1] <= W - 14, "on the map");
    for (const k of s.tanks) assert(k.aim.angle === (k.x < W / 2 ? 55 : 125) && k.aim.power === 60, "default aim at the centre");
    assert(s.phase === "aim" && s.turn === 1 && s.endsAt === t.ctx.now() + FIRST_AIM_MS, "starts aiming");
    assert(Math.abs(s.wind) <= 10 && Number.isInteger(s.wind), "wind in range");
  }
  // genTerrain alone is smooth (no cliffs taller than a few units per column).
  const r = makeTestCtx(1, n).ctx.random;
  const ter = genTerrain(r);
  let steep = 0;
  for (let c = 1; c < COLS; c++) steep = Math.max(steep, Math.abs(ter[c] - ter[c - 1]));
  assert(steep <= 12, `rolling hills (${steep})`);
}

// ---------- hostile and invalid actions ----------
{
  const t = makeTestCtx(3);
  const s: BarrageState = game.setup(t.ctx);
  const [a, b] = t.ids;
  const before = JSON.stringify(s);
  const junk: unknown[] = [
    null,
    undefined,
    "fire",
    42,
    [],
    ["fire"],
    {},
    { type: "x" },
    { type: "__proto__" },
    { type: "constructor" },
    { type: "aim" },
    { type: "aim", angle: -1 },
    { type: "aim", angle: 181 },
    { type: "aim", angle: 45.5 },
    { type: "aim", angle: "90" },
    { type: "aim", angle: NaN },
    { type: "aim", angle: Infinity },
    { type: "aim", power: 9 },
    { type: "aim", power: 101 },
    { type: "aim", power: [50] },
    { type: "aim", weapon: "nuke" },
    { type: "aim", weapon: "a".repeat(10_000) },
    { type: "aim", weapon: null },
    { type: "aim", move: 41 },
    { type: "aim", move: -41 },
    { type: "aim", move: 2.5 },
    { type: "aim", angle: 60, power: 500 },
    { type: "fire", angle: 200 },
    { type: "fire", weapon: { $gt: "" } },
    { type: "fire", move: "10" },
  ];
  for (const j of junk) assert(game.action(s, a, j as never, t.ctx) === false, `rejects ${JSON.stringify(j)}`);
  assert(JSON.stringify(s) === before, "junk changes nothing");
  assert(game.action(s, "stranger", { type: "fire" }, t.ctx) === false, "non-player rejected");
  assert(!s.tanks.some((k) => k.locked), "nobody got locked by junk");

  // Valid aims are stored but not broadcast (private, and the aimer's screen already has them).
  assert(game.action(s, a, { type: "aim", angle: 77, power: 33, weapon: "heavy", move: -40 }, t.ctx) === false, "aim: no broadcast");
  const aim = s.tanks[0].aim;
  assert(aim.angle === 77 && aim.power === 33 && aim.weapon === "heavy" && aim.move === -40, "aim stored");
  game.action(s, a, { type: "aim", power: 34 }, t.ctx);
  assert(s.tanks[0].aim.angle === 77 && s.tanks[0].aim.power === 34, "partial aim keeps the rest");

  // Lock in. Then further aims or fires are rejected.
  assert(game.action(s, a, { type: "fire" }, t.ctx) === true, "fire locks (broadcast)");
  assert(s.tanks[0].locked, "locked");
  assert(game.action(s, a, { type: "aim", angle: 10 }, t.ctx) === false && s.tanks[0].aim.angle === 77, "locked aims frozen");
  assert(game.action(s, a, { type: "fire" }, t.ctx) === false, "no double lock");

  // A bad fire doesn't lock.
  assert(game.action(s, b, { type: "fire", angle: -5 }, t.ctx) === false && !s.tanks[1].locked, "bad fire doesn't lock");
  // Ammo: heavy is one per game, splitter two.
  s.tanks[1].heavy = 0;
  assert(game.action(s, b, { type: "aim", weapon: "heavy" }, t.ctx) === false && s.tanks[1].aim.weapon === "shell", "no heavy left");
  // Moves are clipped to fuel.
  s.tanks[1].fuel = 12;
  game.action(s, b, { type: "aim", move: 40 }, t.ctx);
  assert(s.tanks[1].aim.move === 12, "move clipped to fuel");
  game.action(s, b, { type: "aim", move: -40 }, t.ctx);
  assert(moveOf(s, 1) === -12, "move clipped to fuel (left)");
}

// ---------- secrecy ----------
{
  const t = makeTestCtx(3);
  const s: BarrageState = game.setup(t.ctx);
  const [a, b] = t.ids;
  game.action(s, a, { type: "aim", angle: 133, power: 77, weapon: "split", move: -37 }, t.ctx);
  game.action(s, a, { type: "fire" }, t.ctx);
  const mine = view(s, a, t);
  assert(mine.aim?.angle === 133 && mine.aim.power === 77 && mine.aim.weapon === "split", "you see your own shot");
  for (const id of [b, t.ids[2], "spectator"]) {
    const v = view(s, id, t);
    const json = JSON.stringify(v);
    assert(!json.includes('"power":77') && !json.includes("133") && !json.includes('"move":-37'), `pending aim hidden from ${id}`);
    assert(!json.includes(':"split"'), `pending weapon hidden from ${id}`);
    const tank = v.tanks[0];
    assert(tank.locked === true, "others see the lock");
    assert(!("aim" in tank), "no aim on public tanks");
  }
  assert(view(s, "spectator", t).aim === null, "spectators have no aim");
  for (const k of view(s, b, t).tanks) assert(Object.keys(k).sort().join() === Object.keys(view(s, a, t).tanks[0]).sort().join(), "same public shape");
}

// ---------- phase flow: early advance, deadline, next turn ----------
{
  const t = makeTestCtx(3);
  const s: BarrageState = game.setup(t.ctx);
  assert(game.tick!(s, t.ctx) === false, "idle tick changes nothing");
  game.action(s, t.ids[0], { type: "aim", weapon: "heavy", move: 20 }, t.ctx);
  game.action(s, t.ids[0], { type: "fire" }, t.ctx);
  game.action(s, t.ids[1], { type: "fire" }, t.ctx);
  assert(s.phase === "aim", "still waiting on the third");
  game.action(s, t.ids[2], { type: "fire" }, t.ctx);
  assert(phaseOf(s) === "resolve", "everyone locked: early advance");
  assert(s.resolve!.aims.length === 3, "three shots");
  const flow = s;
  assert(s.tanks[0].heavy === 0 && s.tanks[0].fuel <= FUEL - 1, "heavy spent, fuel burnt");
  const v = view(s, t.ids[1], t);
  assert(v.resolve && v.resolve.at === t.ctx.now(), "resolve view has its clock");
  assert(v.aim === null, "no aim during resolve");
  assert(JSON.stringify(v.terrain) === JSON.stringify(s.before!.terrain), "resolve view has the terrain BEFORE");
  // Before the end of the animation nothing moves on.
  t.advance(s.resolve!.dur - 50);
  assert(game.tick!(s, t.ctx) === false && phaseOf(s) === "resolve", "resolve waits for the animation");
  t.advance(60);
  assert(game.tick!(flow, t.ctx) === true, "resolve ends");
  if (phaseOf(flow) === "aim") {
    assert(s.turn === 2 && s.endsAt === t.ctx.now() + AIM_MS, "turn 2, normal timer");
    assert(s.tanks.every((k) => !k.locked && k.aim.move === 0 && k.aim.weapon === "shell"), "fresh turn");
    assert(Math.abs(s.wind) <= 10, "wind drifts within range");
    // The deadline: unlocked tanks fire their last aim.
    game.action(s, t.ids[1], { type: "aim", angle: 90, power: 10 }, t.ctx);
    t.advance(AIM_MS + 1);
    assert(game.tick!(s, t.ctx) === true && phaseOf(flow) === "resolve", "deadline starts the volley");
    const shot = s.resolve!.aims.find((x) => x[0] === 1);
    assert(shot && shot[1] === 90 && shot[2] === 10, "last aim fired at the deadline");
  }
}

// ---------- the replay reproduces the server exactly (sync) ----------
for (const seed of [3, 5, 8, 13]) {
  const t = makeTestCtx(6, seed);
  const s: BarrageState = game.setup(t.ctx);
  let checked = 0;
  for (let turn = 0; turn < 6 && !t.result; turn++) {
    s.tanks.forEach((k) => {
      if (!k.alive) return;
      const w = k.split > 0 && turn % 2 ? "split" : k.heavy > 0 && turn === 2 ? "heavy" : "shell";
      game.action(s, k.id, { type: "fire", angle: 20 + Math.floor(t.ctx.random() * 140), power: 25 + Math.floor(t.ctx.random() * 60), weapon: w, move: Math.floor(t.ctx.random() * 81) - 40 }, t.ctx);
    });
    assert(s.phase === "resolve", "volley started");
    const v = view(s, "spectator", t);
    const rp = buildReplay(v)!;
    assert(JSON.stringify(rp.snaps[rp.snaps.length - 1]) === JSON.stringify(s.terrain), "replayed craters = server terrain");
    assert(JSON.stringify(rp.burnt[rp.burnt.length - 1]) === JSON.stringify(s.burnt), "replayed scorch = server");
    const end = v.resolve!.dur + 1;
    s.tanks.forEach((k, i) => {
      assert(tankHp(rp, i, end) === k.hp, `replayed hp for ${k.id}`);
      assert(tankAlive(rp, i, end) === k.alive, `replayed alive for ${k.id}`);
      assert(rp.x1[i] === k.x, "replayed drive");
    });
    for (const sh of v.resolve!.shells) {
      assert(sh.p.every((n) => Number.isInteger(n)), "path ints");
      assert(sh.p.length === 2 * (Math.floor((sh.n - 1) / v.resolve!.every) + 2) || sh.n === 0 || sh.p.length >= 4, "path length sane");
    }
    for (const b of v.resolve!.booms) assert(b.t * STEP_MS <= v.resolve!.dur, "booms inside the animation");
    checked++;
    finishVolley(s, t);
  }
  assert(checked > 0, "checked volleys");
}

// ---------- direct hit, self damage, kill credit ----------
{
  const t = makeTestCtx(2);
  const s: BarrageState = game.setup(t.ctx);
  arena(s, 420, [300, 700]);
  s.wind = 0;
  const best = solve(s, 0, 700, 420 - TANK_LIFT);
  assert(best.d < 6, "solver found a hit");
  // p1 shoots straight up at low power: it comes back down on itself.
  game.action(s, t.ids[0], { type: "fire", angle: best.angle, power: best.power, weapon: "heavy" }, t.ctx);
  game.action(s, t.ids[1], { type: "fire", angle: 90, power: 12 }, t.ctx);
  const r = s.resolve!;
  const hit = r.booms.find((b) => b.s === 0)!;
  assert(hit && hit.hit === 1, "heavy is a direct hit");
  const dmg1 = hit.d[hit.d.indexOf(1) + 1];
  assert(dmg1 >= 45 && dmg1 <= 55, `heavy direct hit hurts (${dmg1})`);
  const self = r.booms.find((b) => b.s === 1)!;
  assert(self && self.d[0] === 1 && self.d[1] > 20, "self damage counts");
  assert(s.tanks[0].dealt === dmg1, "dealt excludes self damage");
  assert(s.tanks[1].dealt === 0, "own goals aren't credited");
  assert(s.terrain[350] > 420, "crater under the target");
  finishVolley(s, t);
  // Finish p1 off.
  s.tanks[1].hp = 10;
  const again = solve(s, 0, 700, groundAt(s.terrain, 700) - TANK_LIFT);
  game.action(s, t.ids[0], { type: "fire", angle: again.angle, power: again.power }, t.ctx);
  game.action(s, t.ids[1], { type: "fire", angle: 170, power: 100 }, t.ctx);
  assert(!s.tanks[1].alive && s.tanks[1].why === "hp" && s.tanks[1].hp === 0, "destroyed");
  assert(s.tanks[0].kills === 1, "kill credited");
  assert(s.resolve!.deaths.some((d) => d.s === 1 && d.by === 0 && d.why === "hp"), "death in the timeline");
  assert(!t.result, "the end waits for the animation");
  const ends = countEnds(t);
  finishVolley(s, t);
  const res = resultOf(t);
  assert(res && res.winners.join() === t.ids[0], "last tank wins");
  assert(res.headline.includes("last one rolling"), "headline");
  assert(res.scores?.[t.ids[1]] === 0, "scores are hp");
  assert(s.phase === "final" && s.final?.reason === "last", "final phase");
  assert(game.action(s, t.ids[0], { type: "fire" }, t.ctx) === false, "no actions after the end");
  t.advance(60_000);
  assert(game.tick!(s, t.ctx) === false, "no ticks after the end");
  assert(ends() === 1, "ctx.end exactly once");
  const fv = view(s, t.ids[1], t);
  assert(fv.final?.winners[0] === t.ids[0] && fv.resolve === null, "final view");
}

// ---------- the abyss ----------
{
  const t = makeTestCtx(2);
  const s: BarrageState = game.setup(t.ctx);
  arena(s, 420, [200, 700]);
  // p1 sits on a thin pillar over a deep pit.
  for (let c = 0; c < COLS; c++) if (c >= 320 && c <= 380) s.terrain[c] = 545;
  for (let c = 345; c <= 355; c++) s.terrain[c] = 520;
  s.wind = 0;
  const best = solve(s, 0, 700, 520);
  game.action(s, t.ids[0], { type: "fire", angle: best.angle, power: best.power, weapon: "heavy" }, t.ctx);
  game.action(s, t.ids[1], { type: "fire", angle: 90, power: 100 }, t.ctx);
  const d = s.resolve!.deaths.find((x) => x.s === 1);
  assert(d, "p1 died");
  assert(d.why === "abyss" && groundAt(s.terrain, 700) > ABYSS_Y, `into the abyss (${d.why})`);
  assert(s.tanks[1].hp === 0 && s.tanks[0].kills === 1, "abyss counts as a kill");
  // Drive stops at the lip of a bottomless pit.
  finishVolley(s, t);
}
{
  const t = makeTestCtx(2);
  const s: BarrageState = game.setup(t.ctx);
  arena(s, 420, [300, 700]);
  for (let c = 165; c <= 200; c++) s.terrain[c] = H;
  s.wind = 0;
  game.action(s, t.ids[0], { type: "fire", angle: 170, power: 100, move: 40 }, t.ctx);
  game.action(s, t.ids[1], { type: "fire", angle: 10, power: 100 }, t.ctx);
  assert(s.tanks[0].x < 330 && s.tanks[0].alive, `stops before the pit (${s.tanks[0].x})`);
  assert(s.tanks[0].fuel === FUEL - (s.tanks[0].x - 300), "fuel = distance driven");
}

// ---------- splitter ----------
{
  const t = makeTestCtx(2);
  const s: BarrageState = game.setup(t.ctx);
  arena(s, 450, [200, 800]);
  s.wind = 0;
  game.action(s, t.ids[0], { type: "fire", angle: 60, power: 42, weapon: "split" }, t.ctx);
  game.action(s, t.ids[1], { type: "fire", angle: 120, power: 42, weapon: "split" }, t.ctx);
  const r = s.resolve!;
  const parents = r.shells.filter((x) => x.w === "split");
  const bombs = r.shells.filter((x) => x.w === "bomb");
  assert(parents.length === 2 && parents.every((x) => x.e === "s"), "splitters split at the apex");
  assert(bombs.length === 6, "three bomblets each");
  assert(bombs.every((x) => x.a > 0 && x.p.length >= 4), "bomblets start mid-air");
  assert(r.booms.filter((b) => b.w === "bomb").length >= 4 && r.booms.every((b) => b.r === 24 || b.w !== "bomb"), "bomblet blasts");
  assert(s.tanks[0].split === 1, "ammo used");
  finishVolley(s, t);
  game.action(s, t.ids[0], { type: "fire", weapon: "split" }, t.ctx);
  assert(s.tanks[0].split === 1, "ammo spent when the volley flies, not at lock");
}

// ---------- draw: everyone left dies in the same volley ----------
{
  const t = makeTestCtx(3);
  const ends = countEnds(t);
  const s: BarrageState = game.setup(t.ctx);
  arena(s, 420, [200, 500, 800]);
  s.wind = 0;
  // p0 already gone; p1 and p2 blow each other up.
  s.tanks[0].alive = false;
  s.tanks[0].hp = 0;
  s.tanks[0].why = "hp";
  s.tanks[1].hp = 5;
  s.tanks[2].hp = 5;
  const a = solve(s, 1, 800, 413);
  const b = solve(s, 2, 500, 413);
  game.action(s, t.ids[1], { type: "fire", angle: a.angle, power: a.power }, t.ctx);
  game.action(s, t.ids[2], { type: "fire", angle: b.angle, power: b.power }, t.ctx);
  assert(s.phase === "resolve", "dead p0 isn't waited for");
  assert(s.tanks.every((k) => !k.alive), "both died");
  finishVolley(s, t);
  assert(t.result && t.result.winners.sort().join() === [t.ids[1], t.ids[2]].sort().join(), "draw among the last two");
  assert(s.final?.reason === "draw" && t.result.headline.includes("draw"), "draw headline");
  assert(ends() === 1, "ended once");
}

// ---------- turn limit: most HP wins (and ties) ----------
for (const tie of [false, true]) {
  const t = makeTestCtx(2);
  const ends = countEnds(t);
  const s: BarrageState = game.setup(t.ctx);
  arena(s, 420, [300, 700]);
  if (!tie) s.tanks[1].hp = 80;
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    assert(s.turn === turn && s.phase === "aim", `turn ${turn}`);
    s.wind = 0;
    // Both fire harmlessly off the map.
    volley(s, t, { 0: { angle: 160, power: 100 }, 1: { angle: 20, power: 100 } });
    assert(s.resolve!.booms.length === 0, "harmless volley");
    finishVolley(s, t);
  }
  assert(t.result, "game ends after the last turn");
  assert(s.final?.reason === "turns", "turn limit");
  if (tie) assert(t.result.winners.length === 2 && t.result.headline.includes("tie"), "tie on HP");
  else assert(t.result.winners.join() === t.ids[0] && t.result.headline.includes("100 HP"), "most HP wins");
  assert(ends() === 1, "ended once");
}

// ---------- disconnects ----------
{
  // A disconnected tank doesn't fire, doesn't hold up the turn, and still takes hits.
  const t = makeTestCtx(3);
  const s: BarrageState = game.setup(t.ctx);
  t.ctx.players[2].connected = false;
  game.playerLeft!(s, t.ids[2], t.ctx);
  assert(s.awaySince === null, "two drivers is enough");
  game.action(s, t.ids[0], { type: "fire" }, t.ctx);
  game.action(s, t.ids[1], { type: "fire" }, t.ctx);
  assert(s.phase === "resolve", "no waiting for the disconnected");
  assert(!s.resolve!.aims.some((a) => a[0] === 2), "disconnected tank holds fire");
  assert(game.action(s, t.ids[0], { type: "fire" }, t.ctx) === false, "no actions during resolve");
  finishVolley(s, t);
  // Back again: plays normally.
  t.ctx.players[2].connected = true;
  game.playerReturned!(s, t.ids[2], t.ctx);
  if (phaseOf(s) === "aim") {
    for (const id of t.ids) game.action(s, id, { type: "fire" }, t.ctx);
    if (s.tanks[2].alive) assert(s.resolve!.aims.some((a) => a[0] === 2), "returned tank fires");
  }
}
{
  // Down to one driver: a countdown, then the one who stayed wins.
  const t = makeTestCtx(2);
  const ends = countEnds(t);
  const s: BarrageState = game.setup(t.ctx);
  t.ctx.players[1].connected = false;
  game.playerLeft!(s, t.ids[1], t.ctx);
  assert(s.awaySince === t.ctx.now(), "countdown starts");
  assert(view(s, t.ids[0], t).awayAt === t.ctx.now() + FORFEIT_MS, "view shows the countdown");
  // The lone driver can still play turns meanwhile.
  game.action(s, t.ids[0], { type: "fire", angle: 170, power: 100 }, t.ctx);
  assert(s.phase === "resolve", "lone driver's lock starts the volley");
  finishVolley(s, t);
  // Coming back cancels the countdown.
  t.ctx.players[1].connected = true;
  game.playerReturned!(s, t.ids[1], t.ctx);
  assert(s.awaySince === null && view(s, t.ids[0], t).awayAt === null, "countdown cancelled");
  t.ctx.players[1].connected = false;
  game.playerLeft!(s, t.ids[1], t.ctx);
  let guard = 0;
  while (!t.result && guard++ < 50) {
    t.advance(5000);
    game.tick!(s, t.ctx);
  }
  assert(t.result && t.result.winners.join() === t.ids[0], "the one who stayed wins");
  assert(s.final?.reason === "forfeit" && t.result.headline.includes("left"), "forfeit headline");
  assert(ends() === 1, "ended once");
}
{
  // Everyone gone: the game doesn't race through turns, and wraps up after the grace period.
  const t = makeTestCtx(3);
  const s: BarrageState = game.setup(t.ctx);
  s.tanks[2].hp = 90;
  for (const p of t.ctx.players) p.connected = false;
  for (const id of t.ids) game.playerLeft!(s, id, t.ctx);
  t.advance(1000);
  game.tick!(s, t.ctx);
  assert(s.phase === "aim", "no early advance with nobody here");
  let guard = 0;
  while (!t.result && guard++ < 100) {
    t.advance(1000);
    game.tick!(s, t.ctx);
  }
  assert(t.result && s.final?.reason === "forfeit", "ends when everyone's gone");
  assert(t.result.winners.length === 2 && !t.result.winners.includes(t.ids[2]), "most armour wins");
  assert(s.turn <= 3, "didn't burn through turns");
}
{
  // Disconnect mid-volley: the animation still ends on time.
  const t = makeTestCtx(2);
  const s: BarrageState = game.setup(t.ctx);
  for (const id of t.ids) game.action(s, id, { type: "fire" }, t.ctx);
  t.ctx.players[0].connected = false;
  game.playerLeft!(s, t.ids[0], t.ctx);
  assert(s.awaySince === null, "no countdown during the volley");
  finishVolley(s, t);
  if (!t.result) assert(s.phase === "aim" && s.awaySince === t.ctx.now(), "countdown starts with the next aim");
}

// ---------- full games to completion with random aims ----------
for (const n of [2, 4, 8]) {
  const t = makeTestCtx(n, 1234 + n);
  const ends = countEnds(t);
  const s: BarrageState = game.setup(t.ctx);
  let guard = 0;
  while (!t.result && guard++ < 200) {
    if (s.phase === "aim") {
      for (const k of s.tanks) {
        if (!k.alive) continue;
        const other = s.tanks.find((o) => o.alive && o.id !== k.id);
        const toward = other && other.x > k.x;
        game.action(s, k.id, { type: "aim", angle: toward ? 30 + Math.floor(t.ctx.random() * 50) : 100 + Math.floor(t.ctx.random() * 50), power: 30 + Math.floor(t.ctx.random() * 50) }, t.ctx);
        if (t.ctx.random() < 0.7) game.action(s, k.id, { type: "fire", weapon: k.split ? "split" : "shell" }, t.ctx);
      }
      if (s.phase === "aim") {
        t.advance(s.endsAt - t.ctx.now());
        game.tick!(s, t.ctx);
      }
    } else if (s.phase === "resolve") {
      const size = JSON.stringify(game.view(s, t.ids[0], t.ctx)).length;
      assert(size < 25_000, `resolve view small (${size})`);
      finishVolley(s, t);
    }
  }
  assert(t.result, `game with ${n} ends`);
  assert(ends() === 1, "ctx.end exactly once");
  assert(s.turn <= MAX_TURNS, "within the turn limit");
  const alive = s.tanks.filter((k) => k.alive);
  if (s.final?.reason === "last") assert(alive.length === 1 && t.result.winners.join() === alive[0].id, "winner is the survivor");
  if (s.final?.reason === "turns") assert(t.result.winners.every((id) => s.tanks.find((k) => k.id === id)!.alive), "winners are alive");
}

// ---------- worst-case bandwidth: 8 splitters lobbed sky-high ----------
{
  const t = makeTestCtx(8, 77);
  const s: BarrageState = game.setup(t.ctx);
  s.wind = 0;
  s.tanks.forEach((k, i) => {
    game.action(s, k.id, { type: "fire", angle: 84 + (i % 4) * 4, power: 100, weapon: "split" }, t.ctx);
  });
  assert(s.phase === "resolve", "volley");
  const size = JSON.stringify(game.view(s, t.ids[0], t.ctx)).length;
  assert(size < 25_000, `worst-case resolve view under 25 KB (${size})`);
  assert(s.resolve!.shells.length >= 8, "lots of shells");
  const aimSize = JSON.stringify(view(s, t.ids[0], t)).length;
  assert(aimSize > 0, "serialisable");
  finishVolley(s, t);
  const idle = JSON.stringify(game.view(s, t.ids[0], t.ctx)).length;
  assert(idle < 5_000, `aim view small (${idle})`);
}

console.log("✓ barrage tests passed");
