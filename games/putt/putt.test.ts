import { assert, makeTestCtx } from "../../shared/testing";
import game, { pickCourse, type PuttState, type PuttView } from "./server";
import { HOLES, HOLE_BY_ID } from "./holes";
import { course, freeSpot, railDistance, simulate, SINK_SPEED, simplify } from "./physics";
import {
  AIM_MS,
  BALL_R,
  CARD_MS,
  CUP_R,
  FIRST_AIM_MS,
  FORFEIT_MS,
  HOLES_PER_GAME,
  MAX_ROLL,
  MAX_STROKES,
  PICKUP_SCORE,
  REVEAL_MS,
  STEP_MS,
  WALL_T,
  inSand,
  inWater,
  launchSpeed,
  onGreen,
  rollDistance,
  teeSpots,
  type Hole,
} from "./shared";

type T = ReturnType<typeof makeTestCtx>;

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
const phaseOf = (s: PuttState) => s.phase;
const resultOf = (t: T) => t.result;
const aimOf = (s: PuttState, i: number) => s.balls[i].aim?.a;
const view = (s: PuttState, id: string, t: T) => JSON.parse(JSON.stringify(game.view(s, id, t.ctx))) as PuttView;
const tick = (s: PuttState, t: T) => game.tick!(s, t.ctx);
const holeOf = (s: PuttState): Hole => HOLE_BY_ID[s.course[s.hole]];

/** Angle (tenths of a degree) from a ball to a point. */
const angleTo = (x: number, y: number, tx: number, ty: number) => {
  let a = Math.round((Math.atan2(ty - y, tx - x) * 1800) / Math.PI);
  if (a < 0) a += 3600;
  return a % 3600;
};

/** Let the current roll play out (and the next phase begin). */
function finishRoll(s: PuttState, t: T) {
  assert(phaseOf(s) === "roll", `expected roll, got ${s.phase}`);
  t.advance(s.endsAt - t.ctx.now() + 1);
  tick(s, t);
}

/** Put a ball somewhere specific (for scripted scenarios). */
function place(s: PuttState, i: number, x: number, y: number) {
  s.balls[i].x = x;
  s.balls[i].y = y;
}

// ---------- the geodesic solver: a "reasonable golfer" for completability tests ----------

const CELL = 8;
const GW = Math.ceil(1000 / CELL);
const GH = Math.ceil(600 / CELL);

/** Distance to the cup through the open felt (portals count as zero-length hops). */
function distanceField(hole: Hole) {
  const c = course(hole);
  const ok = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x = gx * CELL + CELL / 2;
      const y = gy * CELL + CELL / 2;
      if (!onGreen(hole, x, y) || inWater(hole, x, y) || railDistance(c, x, y) < BALL_R + WALL_T / 2) continue;
      if ((hole.bumpers ?? []).some((b) => Math.hypot(x - b[0], y - b[1]) < b[2] + BALL_R)) continue;
      ok[gy * GW + gx] = 1;
    }
  }
  const ends: number[][] = [];
  for (const p of hole.portals ?? []) ends.push([p[0], p[1]], [p[2], p[3]]);
  const idx = (x: number, y: number) =>
    Math.min(GH - 1, Math.max(0, Math.floor(y / CELL))) * GW + Math.min(GW - 1, Math.max(0, Math.floor(x / CELL)));
  const cost = new Float64Array(GW * GH).fill(Infinity);
  const start = idx(hole.cup[0], hole.cup[1]);
  cost[start] = 0;
  // Binary heap of [cost, cell].
  const heap: number[][] = [[0, start]];
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  const push = (e: number[]) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const done = new Uint8Array(GW * GH);
  while (heap.length) {
    const [d, i] = pop();
    if (done[i]) continue;
    done[i] = 1;
    const gx = i % GW;
    const gy = (i / GW) | 0;
    const x = gx * CELL + CELL / 2;
    const y = gy * CELL + CELL / 2;
    const relax = (j: number, w: number) => {
      if (d + w < cost[j]) {
        cost[j] = d + w;
        push([cost[j], j]);
      }
    };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH || !ok[ny * GW + nx]) continue;
      relax(ny * GW + nx, Math.hypot(dx, dy) * CELL * (inSand(hole, nx * CELL + 4, ny * CELL + 4) ? 2 : 1));
    }
    ends.forEach((e, k) => {
      if (Math.hypot(x - e[0], y - e[1]) < 14) relax(idx(ends[k ^ 1][0], ends[k ^ 1][1]), 0);
    });
  }
  return (x: number, y: number) => {
    const v = cost[idx(x, y)];
    if (v !== Infinity) return v;
    let best = 5000;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) best = Math.min(best, cost[idx(x + dx * CELL, y + dy * CELL)] + Math.hypot(dx, dy) * CELL);
    return best;
  };
}

/** Greedy golfer: each stroke, the shot whose resting spot is closest to the cup along the felt. */
function solveHole(hole: Hole, sx: number, sy: number) {
  const geo = distanceField(hole);
  let x = sx;
  let y = sy;
  for (let stroke = 1; stroke <= MAX_STROKES; stroke++) {
    const t0 = stroke * 11.3;
    const score = (a: number, p: number) => {
      const b = simulate(hole, [{ slot: 0, x, y }], [{ slot: 0, a, power: p }], t0).bodies[0];
      if (b.sunk) return { v: -1, b };
      if (b.splashed) return { v: geo(x, y) + 500, b };
      return { v: geo(b.x, b.y), b };
    };
    let best = { v: Infinity, a: 0, p: 0 };
    for (let a = 0; a < 3600; a += 25) {
      for (let p = 5; p <= 100; p += 5) {
        const r = score(a, p);
        if (r.v < best.v) best = { v: r.v, a, p };
      }
    }
    const base = best;
    for (let a = base.a - 24; a <= base.a + 24; a += 6) {
      for (let p = Math.max(1, base.p - 4); p <= Math.min(100, base.p + 4); p += 2) {
        const r = score((a + 3600) % 3600, p);
        if (r.v < best.v) best = { v: r.v, a: (a + 3600) % 3600, p };
      }
    }
    const b = score(best.a, best.p).b;
    if (b.sunk) return stroke;
    if (!b.splashed) {
      x = b.x;
      y = b.y;
    }
  }
  return 99;
}

// ---------- 1. layouts are sound and every hole can be played ----------
{
  assert(HOLES.length >= 9, "at least nine layouts");
  assert(new Set(HOLES.map((h) => h.id)).size === HOLES.length, "unique hole ids");
  for (const h of HOLES) {
    const spots = teeSpots(h);
    assert(spots.length === 8, "eight tee spots");
    spots.forEach((p, i) => {
      assert(freeSpot(h, p[0], p[1], spots.filter((_, j) => j !== i)), `${h.id}: tee spot ${i} must be clear`);
    });
    assert(onGreen(h, h.cup[0], h.cup[1]) && !inWater(h, h.cup[0], h.cup[1]), `${h.id}: cup on dry felt`);
    assert(railDistance(course(h), h.cup[0], h.cup[1]) > CUP_R + 4, `${h.id}: cup clear of rails`);
    for (const p of h.portals ?? []) {
      assert(onGreen(h, p[0], p[1]) && onGreen(h, p[2], p[3]), `${h.id}: portals on the felt`);
    }
    // Windmill sails never sweep through a rail.
    for (const m of h.mills ?? []) {
      assert(railDistance(course(h), m[0], m[1]) > m[2] + WALL_T / 2 + 2, `${h.id}: windmill clear of rails`);
    }
  }
  const t0 = Date.now();
  HOLES.forEach((h, i) => {
    // A different tee spot on each hole, so the whole tee box gets covered across the set.
    const spot = teeSpots(h)[i % 8];
    const strokes = solveHole(h, spot[0], spot[1]);
    assert(strokes <= h.par + 1, `${h.id}: the solver should sink it within par + 1 (took ${strokes})`);
  });
  console.log(`  every hole completable (${Date.now() - t0} ms)`);
}

// ---------- 2. physics feel ----------
{
  const h = HOLE_BY_ID.opener;
  // Power maps linearly onto flat roll distance.
  assert(Math.abs(rollDistance(launchSpeed(100)) - MAX_ROLL) < 1, "full power rolls MAX_ROLL");
  assert(Math.abs(rollDistance(launchSpeed(50)) - MAX_ROLL / 2) < 1, "half power rolls half as far");
  // A flat putt on open felt stops about where the preview says.
  const free = simulate(h, [{ slot: 0, x: 200, y: 300 }], [{ slot: 0, a: 900, power: 10 }], 0).bodies[0];
  assert(Math.abs(free.y - 300 - MAX_ROLL * 0.1) < 3 && Math.abs(free.x - 200) < 1, `flat roll distance (${free.x},${free.y})`);
  // Head-on knock: the shooter all but stops, the target takes off.
  const sim = simulate(
    h,
    [
      { slot: 0, x: 200, y: 300 },
      { slot: 1, x: 300, y: 300 },
    ],
    [{ slot: 0, a: 0, power: 40 }],
    0,
  );
  const [a, b] = sim.bodies;
  assert(a.x < 310 && b.x > 380, `ball 0 transfers its pace (a=${a.x}, b=${b.x})`);
  const knock = sim.events.find((e) => e[0] === "knock");
  assert(!!knock && knock[4] === 0 && knock[5] === 1, "knock event names the hitter and victim");
  // Rails bounce: a hard shot into the top rail comes back down.
  const bounce = simulate(h, [{ slot: 0, x: 300, y: 300 }], [{ slot: 0, a: 2700, power: 40 }], 0).bodies[0];
  assert(bounce.y > 220, `rail bounce comes back (${bounce.y})`);
  // Bumpers fire.
  const bump = simulate(h, [{ slot: 0, x: 300, y: 232 }], [{ slot: 0, a: 0, power: 30 }], 0);
  assert(
    bump.events.some((e) => e[0] === "bump"),
    "bumper fires",
  );
  // A slow ball over the cup drops; a screamer lips out.
  const [cx, cy] = h.cup;
  const sink = simulate(h, [{ slot: 0, x: cx - 120, y: cy }], [{ slot: 0, a: 0, power: 16 }], 0);
  assert(sink.bodies[0].sunk && sink.events.some((e) => e[0] === "sink"), "a firm putt drops");
  const lip = simulate(h, [{ slot: 0, x: cx - 60, y: cy }], [{ slot: 0, a: 0, power: 100 }], 0);
  const firstContact = lip.events.find((e) => e[0] === "lip" || e[0] === "sink");
  assert(firstContact?.[0] === "lip", "a screamer lips out (it may still rattle back in later)");
  assert(launchSpeed(100) > SINK_SPEED, "full power is too fast to drop");

  // Water: the ball is out of the roll.
  const lag = HOLE_BY_ID.lagoon;
  const w = lag.water![0];
  const splash = simulate(lag, [{ slot: 0, x: w[0] - 150, y: w[1] + 60 }], [{ slot: 0, a: angleTo(w[0] - 150, w[1] + 60, w[0], w[1]), power: 40 }], 0);
  assert(splash.bodies[0].splashed && splash.events.some((e) => e[0] === "water"), "splash");
  // Portals: in one end, out the other with the same heading.
  const por = HOLE_BY_ID.portals;
  const p = por.portals![0];
  const hop = simulate(por, [{ slot: 0, x: p[0] - 100, y: p[1] }], [{ slot: 0, a: 0, power: 30 }], 0);
  const ev = hop.events.find((e) => e[0] === "portal");
  assert(!!ev && ev[3] === 0 && ev[4] === 1, "portal hop A to B");
  assert(hop.bodies[0].path.length === 2, "a portal hop splits the path into two segments");
  assert(hop.bodies[0].x > p[2], "keeps heading right after the hop");
  // Windmill: a ball parked in the sails' way gets batted out.
  const wm = HOLE_BY_ID.windmill;
  const m = wm.mills![0];
  const swat = simulate(wm, [{ slot: 0, x: m[0], y: m[1] - 60 }], [], 0);
  assert(swat.events.some((e) => e[0] === "whack"), "windmill whacks a parked ball");
  assert(Math.hypot(swat.bodies[0].x - m[0], swat.bodies[0].y - m[1]) > m[2], "and it ends clear of the sails");
  // Sand grabs the ball.
  const sandH = HOLE_BY_ID.opener;
  const sd = sandH.sand![0];
  const inS = simulate(sandH, [{ slot: 0, x: sd[0] - 60, y: sd[1] }], [{ slot: 0, a: 0, power: 30 }], 0).bodies[0];
  const flat = simulate(sandH, [{ slot: 0, x: 300, y: 300 }], [{ slot: 0, a: 0, power: 30 }], 0).bodies[0];
  assert(inS.x - (sd[0] - 60) < (flat.x - 300) * 0.6, "sand stops a ball much sooner");
  // Boost pads speed you up.
  const loop = HOLE_BY_ID.loop;
  const bp = loop.boosts![0];
  const boosted = simulate(loop, [{ slot: 0, x: bp[0], y: bp[1] + 80 }], [{ slot: 0, a: 2700, power: 10 }], 0);
  assert(boosted.events.some((e) => e[0] === "boost"), "boost pad event");
  assert(boosted.bodies[0].y < bp[1] - 100, "boost carries the ball well past the pad");
  // Paths are compact and land exactly where the ball rests.
  const long = simulate(h, [{ slot: 0, x: 200, y: 300 }], [{ slot: 0, a: 150, power: 90 }], 0).bodies[0];
  const seg = long.path[long.path.length - 1];
  assert(seg[seg.length - 2] === long.x && seg[seg.length - 1] === long.y, "path ends where the ball rests");
  assert(long.path.reduce((n, s2) => n + s2.length, 0) < 300, "path is simplified");
  // The simplifier keeps endpoints and stays within tolerance.
  const raw = [0, 0, 0, 2, 2, 0, 4, 4, 0, 6, 6, 0, 8, 6, 5];
  const simp = simplify(raw);
  assert(simp[0] === 0 && simp[simp.length - 3] === 8 && simp.length < raw.length, "simplify");
  console.log("  physics: rolls, knocks, rails, bumpers, cup, water, portals, windmills, sand, boosts");
}

// ---------- 3. course picking ----------
{
  for (let seed = 1; seed <= 40; seed++) {
    const t = makeTestCtx(2, seed);
    const c = pickCourse(t.ctx.random);
    assert(c.length === HOLES_PER_GAME && new Set(c).size === HOLES_PER_GAME, "six distinct holes");
    const tiers = c.map((id) => HOLE_BY_ID[id].tier);
    assert(tiers.every((x, i) => i === 0 || tiers[i - 1] <= x), "holes ramp up by tier");
    assert(c.some((id) => HOLE_BY_ID[id].mills?.length), "a windmill every game");
    assert(c.some((id) => HOLE_BY_ID[id].portals?.length), "portals every game");
    assert(c.some((id) => HOLE_BY_ID[id].water?.length), "water every game");
  }
  console.log("  course picking ramps up and covers every hazard");
}

// ---------- 4. aim, lock, roll, early advance, secrecy ----------
{
  const t = makeTestCtx(3);
  const ends = countEnds(t);
  const s = game.setup(t.ctx);
  const [p0, p1, p2] = t.ids;
  assert(s.phase === "aim" && s.endsAt === t.ctx.now() + FIRST_AIM_MS, "first aim is longer");
  assert(new Set(s.balls.map((b) => `${b.x},${b.y}`)).size === 3, "balls on distinct tee spots");
  // Draft aims are secret and don't broadcast.
  assert(game.action(s, p0, { type: "aim", a: 1234, p: 55 }, t.ctx) === false, "aim returns false");
  assert(aimOf(s, 0) === 1234, "draft stored");
  assert(view(s, p0, t).aim?.a === 1234, "you see your own draft");
  for (const who of [p1, "spectator"]) {
    const v = view(s, who, t);
    assert(v.aim === null && !JSON.stringify(v).includes("1234"), "nobody else sees your aim");
  }
  // Locking goes out as a tiny event (no full view) and the aim stays secret.
  const before0 = t.events.length;
  assert(game.action(s, p0, { type: "lock", a: 1111, p: 44 }, t.ctx) === false, "lock sends no full view");
  const lockEv = t.events.slice(before0).map((x) => x.event as { t: string; id: string; h: number; s: number });
  assert(lockEv.length === 1 && lockEv[0].t === "lock" && lockEv[0].id === p0 && lockEv[0].h === 0 && lockEv[0].s === 1, "lock event");
  assert(!JSON.stringify(lockEv).includes("1111"), "the lock event doesn't leak the aim");
  assert(view(s, p1, t).balls[0].locked && !JSON.stringify(view(s, p1, t)).includes("1111"), "locked aim stays secret");
  assert(game.action(s, p0, { type: "lock", a: 10, p: 10 }, t.ctx) === false, "can't re-lock");
  assert(game.action(s, p0, { type: "aim", a: 10, p: 10 }, t.ctx) === false && aimOf(s, 0) === 1111, "can't re-aim after locking");
  assert(game.action(s, p1, { type: "lock", a: 0, p: 20 }, t.ctx) === false, "second lock: still an event");
  assert(phaseOf(s) === "aim", "still waiting for p2");
  // p2 never aims: the clock runs out, they take a stroke, ball stays put.
  const before = { x: s.balls[2].x, y: s.balls[2].y };
  t.advance(FIRST_AIM_MS + 1);
  tick(s, t);
  assert(phaseOf(s) === "roll", "aim timeout starts the roll");
  const r = s.roll!;
  assert(r.shots.length === 3 && r.shots.some((x) => x[0] === 2 && x[2] === 0), "the slowpoke's turn is a whiff");
  assert(s.balls.every((b) => b.strokes === 1), "everyone is charged a stroke");
  assert(s.balls[2].x === before.x && s.balls[2].y === before.y || r.paths[2].length > 0, "whiffed ball only moves if knocked");
  assert(r.from.length === 3 && r.from[0][2] === 0, "replay starts from pre-roll strokes");
  // Revealed aims are in the roll view for everyone.
  assert(JSON.stringify(view(s, p2, t).roll).includes("1111"), "aims revealed in the roll");
  assert(view(s, p0, t).aim === null, "no pending aim during the roll");
  // Actions during the roll are rejected.
  assert(game.action(s, p0, { type: "lock", a: 0, p: 10 }, t.ctx) === false, "no shots mid-roll");
  assert(game.action(s, p0, { type: "ready" }, t.ctx) === false, "no ready mid-roll");
  // The roll lasts reveal + motion + tail.
  assert(r.dur >= REVEAL_MS + r.settle * STEP_MS, "duration covers the motion");
  finishRoll(s, t);
  assert(phaseOf(s) === "aim" && s.shot === 2 && s.endsAt === t.ctx.now() + AIM_MS, "next shot");
  // Early advance: everyone locks; the last lock starts the roll and broadcasts it.
  const results = t.ids.map((id) => game.action(s, id, { type: "lock", a: 900, p: 1 }, t.ctx));
  assert(phaseOf(s) === "roll", "all locked starts the roll at once");
  assert(results[2] === true && results[0] === false, "only the roll-starting lock broadcasts");
  assert(ends() === 0, "no end yet");
  console.log("  aim, lock, roll, early advance, secrecy");
}

// ---------- 5. hostile actions ----------
{
  const t = makeTestCtx(2);
  const s = game.setup(t.ctx);
  const [p0] = t.ids;
  const junk: unknown[] = [
    null,
    undefined,
    42,
    "lock",
    [],
    ["lock"],
    {},
    { type: "x" },
    { type: null },
    { type: "__proto__" },
    { type: "lock" },
    { type: "lock", a: 1.5, p: 10 },
    { type: "lock", a: -1, p: 10 },
    { type: "lock", a: 3600, p: 10 },
    { type: "lock", a: 100, p: 0 },
    { type: "lock", a: 100, p: 101 },
    { type: "lock", a: "100", p: 10 },
    { type: "lock", a: 100, p: Number.NaN },
    { type: "lock", a: Infinity, p: 10 },
    { type: "lock", a: [1], p: { $gt: 0 } },
    { type: "aim", a: 1e9, p: 1e9 },
    { type: "ready" },
    { type: "lock", a: "x".repeat(5000), p: 10 },
  ];
  const snap = JSON.stringify(s);
  for (const a of junk) {
    assert(game.action(s, p0, a as never, t.ctx) === false, `junk rejected: ${JSON.stringify(a)?.slice(0, 40)}`);
  }
  assert(JSON.stringify(s) === snap, "junk changes nothing");
  assert(game.action(s, "intruder", { type: "lock", a: 0, p: 50 }, t.ctx) === false, "strangers can't play");
  assert(game.action(s, "spectator", { type: "ready" }, t.ctx) === false, "spectators can't ready");
  console.log("  hostile actions rejected");
}

// ---------- 6. water penalty, respawn and sinking through the server ----------
{
  const t = makeTestCtx(2, 9);
  const s = game.setup(t.ctx);
  // Play hole 0 on the lagoon.
  s.course = ["lagoon", ...s.course.filter((id) => id !== "lagoon")].slice(0, HOLES_PER_GAME);
  const h = HOLE_BY_ID.lagoon;
  place(s, 0, 640, 470);
  place(s, 1, 760, 150);
  const w = h.water![0];
  game.action(s, t.ids[0], { type: "lock", a: angleTo(640, 470, w[0], w[1]), p: 60 }, t.ctx);
  game.action(s, t.ids[1], { type: "lock", a: angleTo(760, 150, h.cup[0], h.cup[1]), p: 6 }, t.ctx);
  assert(phaseOf(s) === "roll", "rolling");
  const r = s.roll!;
  assert(r.ev.some((e) => e[0] === "water" && e[2] === 0), "p0 splashes");
  assert(s.balls[0].strokes === 2 && s.balls[0].stats.splashes === 1, "splash costs a stroke");
  assert(r.resp.length === 1 && r.resp[0][0] === 0, "respawn recorded");
  assert(Math.hypot(s.balls[0].x - 640, s.balls[0].y - 470) < 40, "back near where it was hit from");
  assert(r.ev.some((e) => e[0] === "sink" && e[2] === 1) && s.balls[1].sunk, "p1 drops it");
  // Replay paths end where the server put each ball.
  const last = r.paths[1][r.paths[1].length - 1];
  assert(Math.hypot(last[last.length - 2] - h.cup[0], last[last.length - 1] - h.cup[1]) <= CUP_R + 1, "sink path ends in the cup");
  finishRoll(s, t);
  assert(phaseOf(s) === "aim", "p0 still has to finish");
  assert(game.action(s, t.ids[1], { type: "lock", a: 0, p: 10 }, t.ctx) === false, "a holed-out ball can't shoot");
  // p0 now times out four times: 2 + 4 = 6 strokes, picks up with 8.
  for (let i = 0; i < 4; i++) {
    t.advance(s.endsAt - t.ctx.now() + 1);
    tick(s, t);
    finishRoll(s, t);
  }
  assert(phaseOf(s) === "card", `capped ball ends the hole (${s.phase})`);
  assert(s.balls[0].card[0] === PICKUP_SCORE && s.balls[1].card[0] === 1, "pick-up 8 and an ace");
  assert(s.balls[1].stats.aces === 1, "ace counted");
  console.log("  water, respawn, sinking, stroke cap");
}

// ---------- 7. a full game, ties, ready-to-advance ----------
function playGame(n: number, seed: number, mode: "ready" | "timeout") {
  const t = makeTestCtx(n, seed);
  const ends = countEnds(t);
  const s = game.setup(t.ctx);
  let guard = 0;
  while (!s.over && guard++ < 2000) {
    if (s.phase === "aim") {
      const hole = holeOf(s);
      s.balls.forEach((b, i) => {
        if (b.sunk || b.out) return;
        const d = Math.hypot(hole.cup[0] - b.x, hole.cup[1] - b.y);
        const p = Math.max(1, Math.min(100, Math.round((d / MAX_ROLL) * 100) + 3));
        game.action(s, t.ids[i], { type: "lock", a: angleTo(b.x, b.y, hole.cup[0], hole.cup[1]), p }, t.ctx);
      });
      if (s.phase === "aim") {
        t.advance(s.endsAt - t.ctx.now() + 1);
        tick(s, t);
      }
    } else if (s.phase === "roll") {
      finishRoll(s, t);
    } else if (s.phase === "card") {
      assert(s.balls.every((b) => b.card.length === s.hole + 1), "card filled for this hole");
      if (mode === "ready") {
        for (const id of t.ids) game.action(s, id, { type: "ready" }, t.ctx);
      } else {
        t.advance(CARD_MS + 1);
        tick(s, t);
      }
    }
  }
  assert(s.over && phaseOf(s) === "final", "game finished");
  assert(ends() === 1, "ctx.end exactly once");
  const res = resultOf(t)!;
  const totals = s.balls.map((b) => b.card.reduce((a, c) => a + c, 0));
  const best = Math.min(...totals);
  const want = s.balls.filter((_, i) => totals[i] === best).map((b) => b.id);
  assert(JSON.stringify(res.winners.slice().sort()) === JSON.stringify(want.sort()), "lowest total wins");
  assert(s.balls.every((b) => b.card.length === HOLES_PER_GAME), "six holes on every card");
  assert(res.scores && res.scores[t.ids[0]] === totals[0], "scores are total strokes");
  assert(/Putt Panic/.test(res.headline), "headline");
  // Nothing more happens after the end.
  assert(game.action(s, t.ids[0], { type: "ready" }, t.ctx) === false, "ignored after end");
  t.advance(60_000);
  assert(!tick(s, t), "no ticks after end");
  return { s, t };
}
{
  playGame(2, 3, "ready");
  playGame(8, 5, "timeout");
  const { s } = playGame(4, 11, "ready");
  const v = JSON.stringify(game.view(s, "spectator", makeTestCtx(4).ctx));
  assert(v.length < 4000, `final view is small (${v.length})`);
  console.log("  full games: 2, 4 and 8 players");
}
{
  // Ties share the win.
  const t = makeTestCtx(2);
  const s = game.setup(t.ctx);
  for (const b of s.balls) b.card = [2, 3, 3, 2, 4];
  s.hole = HOLES_PER_GAME - 1;
  s.phase = "card";
  s.balls.forEach((b) => b.card.push(3));
  s.endsAt = t.ctx.now();
  t.advance(1);
  tick(s, t);
  assert(t.result?.winners.length === 2 && /tie/.test(t.result.headline), "a tie shares the win");
  console.log("  ties share the win");
}

// ---------- 8. disconnects never stall the game ----------
{
  const t = makeTestCtx(3);
  const s = game.setup(t.ctx);
  const [p0, p1, p2] = t.ids;
  // Away during AIM: the rest lock, the roll starts without them and they take no stroke.
  t.ctx.player(p2)!.connected = false;
  game.playerLeft!(s, p2, t.ctx);
  game.action(s, p0, { type: "lock", a: 0, p: 10 }, t.ctx);
  game.action(s, p1, { type: "lock", a: 1800, p: 10 }, t.ctx);
  assert(phaseOf(s) === "roll", "away golfer doesn't block the roll");
  assert(s.balls[2].strokes === 0, "away golfer isn't charged");
  // Back during ROLL.
  t.ctx.player(p2)!.connected = true;
  game.playerReturned!(s, p2, t.ctx);
  finishRoll(s, t);
  assert(phaseOf(s) === "aim", "next shot after reconnect");
  // Locked, then dropped: the shot still goes.
  game.action(s, p2, { type: "lock", a: 900, p: 5 }, t.ctx);
  t.ctx.player(p2)!.connected = false;
  game.playerLeft!(s, p2, t.ctx);
  t.advance(AIM_MS + 1);
  tick(s, t);
  assert(s.roll?.shots.some((x) => x[0] === 2 && x[2] === 5), "a locked shot fires even if they drop");
  finishRoll(s, t);
  // Everyone still here sinks or caps: the hole ends without the away golfer.
  s.balls[0].sunk = true;
  s.balls[1].sunk = true;
  tick(s, t);
  assert(phaseOf(s) === "card", "hole ends when only away golfers are left");
  assert(s.balls[2].card[0] === PICKUP_SCORE, "away golfer takes the pick-up score");
  // Away during CARD doesn't block "everyone ready". The first tap is just an event.
  const evAt = t.events.length;
  assert(game.action(s, p0, { type: "ready" }, t.ctx) === false, "ready is an event");
  assert((t.events[evAt]?.event as { t: string }).t === "ready", "ready event");
  assert(game.action(s, p0, { type: "ready" }, t.ctx) === false && t.events.length === evAt + 1, "double ready ignored");
  assert(game.action(s, p1, { type: "ready" }, t.ctx) === true, "the last ready moves on and broadcasts");
  assert(phaseOf(s) === "aim" && s.hole === 1, "ready skips the card without the away golfer");
  // Reconnect in AIM: they play the new hole normally.
  t.ctx.player(p2)!.connected = true;
  game.playerReturned!(s, p2, t.ctx);
  game.action(s, p2, { type: "lock", a: 0, p: 30 }, t.ctx);
  assert(s.balls[2].locked, "back in the game");
  console.log("  disconnect/reconnect in aim, roll and card");
}
{
  // Forfeit: down to one golfer for FORFEIT_MS ends the game with them as the winner.
  const t = makeTestCtx(3);
  const ends = countEnds(t);
  const s = game.setup(t.ctx);
  for (const id of t.ids.slice(1)) {
    t.ctx.player(id)!.connected = false;
    game.playerLeft!(s, id, t.ctx);
  }
  assert(view(s, t.ids[0], t).awayAt === t.ctx.now() + FORFEIT_MS, "away countdown shown");
  // The lone golfer can still play on meanwhile.
  assert(game.action(s, t.ids[0], { type: "lock", a: 0, p: 20 }, t.ctx) === true, "solo lock starts the roll");
  assert(phaseOf(s) === "roll", "solo golfer keeps playing");
  finishRoll(s, t);
  t.advance(FORFEIT_MS);
  tick(s, t);
  assert(s.over && ends() === 1 && t.result?.winners[0] === t.ids[0], "forfeit win");
  // Everyone gone: still ends, never stalls.
  const t2 = makeTestCtx(2);
  const s2 = game.setup(t2.ctx);
  for (const id of t2.ids) {
    t2.ctx.player(id)!.connected = false;
    game.playerLeft!(s2, id, t2.ctx);
  }
  for (let i = 0; i < 400 && !s2.over; i++) {
    t2.advance(1000);
    tick(s2, t2);
  }
  assert(s2.over, "an empty course still wraps up");
  console.log("  forfeit when golfers leave");
}

// ---------- 9. view sizes ----------
{
  const t = makeTestCtx(8, 21);
  const s = game.setup(t.ctx);
  const aimSize = JSON.stringify(game.view(s, t.ids[0], t.ctx)).length;
  assert(aimSize < 2500, `aim view is small (${aimSize})`);
  // Everyone blasts at once: the replay must stay compact.
  s.balls.forEach((_, i) => game.action(s, t.ids[i], { type: "lock", a: (i * 450 + 77) % 3600, p: 100 }, t.ctx));
  assert(phaseOf(s) === "roll", "8-ball roll");
  const rollSize = JSON.stringify(game.view(s, t.ids[0], t.ctx)).length;
  assert(rollSize < 12_000, `roll view is compact (${rollSize})`);
  assert(s.roll!.ev.some((e) => e[0] === "knock"), "eight balls at full power bang into each other");
  console.log(`  view sizes: aim ${aimSize} B, 8-ball full-power roll ${rollSize} B`);
}

// ---------- 10. host settings ----------
{
  const t = makeTestCtx(2, 5, { holes: 3, aim: 8 });
  const s = game.setup(t.ctx);
  assert(s.course.length === 3 && new Set(s.course).size === 3, "three holes when the host asks");
  assert(s.endsAt === t.ctx.now() + 11_000 && s.total === 11_000, "8s aim plus 3s on the first shot");
  game.action(s, t.ids[0], { type: "lock", a: 0, p: 10 }, t.ctx);
  game.action(s, t.ids[1], { type: "lock", a: 1800, p: 10 }, t.ctx);
  finishRoll(s, t);
  assert(phaseOf(s) === "aim" && s.endsAt === t.ctx.now() + 8_000, "later shots get 8s");
  const d = game.setup(makeTestCtx(2, 5).ctx);
  assert(d.course.length === HOLES_PER_GAME && d.aimMs === AIM_MS && d.firstAimMs === FIRST_AIM_MS, "defaults unchanged");
  const bad = game.setup(makeTestCtx(2, 5, { holes: 4, aim: "x" }).ctx);
  assert(bad.course.length === HOLES_PER_GAME && bad.aimMs === AIM_MS, "invalid settings fall back");
  console.log("  host settings: holes and aim timer");
}

// ---------- 11. practice bots ----------
{
  for (const [humans, bots] of [
    [1, 2],
    [0, 3],
  ]) {
    const n = humans + bots;
    const t = makeTestCtx(n, 9, { holes: 3 }, bots);
    const s = game.setup(t.ctx);
    let simMs = 0;
    const t0 = Date.now();
    while (!t.result && simMs < 30 * 60_000) {
      t.advance(200);
      simMs += 200;
      for (const id of t.ids) {
        if (!id.startsWith("bot-")) continue;
        const a = game.bot!(s, id, t.ctx);
        if (a) game.action(s, id, a, t.ctx);
      }
      game.tick!(s, t.ctx);
    }
    assert(t.result, `bots finish a 3-hole game (${humans} human)`);
    const botCards = s.balls.filter((b) => b.id.startsWith("bot-")).map((b) => b.card.reduce((x, y) => x + y, 0));
    assert(botCards.every((c) => c < 3 * PICKUP_SCORE), `bots actually play (${botCards.join(", ")})`);
    console.log(`  bots: ${humans} human + ${bots} bots done in ${Math.round(simMs / 1000)}s game time, cards ${botCards.join("/")}, ${Date.now() - t0} ms CPU`);
  }
}

console.log("✓ putt tests passed");
