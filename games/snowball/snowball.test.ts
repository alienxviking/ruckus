// Run with: npx tsx games/snowball/snowball.test.ts
import { assert, makeTestCtx } from "../../shared/testing";
import game, { type SnowState, type SnowView } from "./server";
import {
  AMMO,
  AMMO_PILE,
  COUNTDOWN_MS,
  END_FORT,
  END_GROUND,
  END_PLAYER,
  FIELDS,
  FIELD_COUNT,
  FORT_HP,
  MAX_HP,
  MAX_RANGE,
  PLAYER_R,
  RELOAD_MS,
  ROUND_CAP_MS,
  ROUND_OVER_MS,
  SUDDEN_MS,
  THROW_CD_MS,
  TICK_MS,
  WINS_NEEDED,
  WORLD_H,
  WORLD_W,
  decodePositions,
  encodePositions,
  flightAt,
  fortShape,
  isSnap,
  makeFlight,
  readStatus,
  type Snap,
} from "./shared";

type T = ReturnType<typeof makeTestCtx>;

function run(t: T, s: SnowState, ms: number) {
  const end = ms;
  for (let done = 0; done < end; done += TICK_MS) {
    t.advance(TICK_MS);
    game.tick!(s, t.ctx);
  }
}

function toFight(t: T, s: SnowState) {
  assert(s.phase === "countdown", `expected countdown, got ${s.phase}`);
  t.advance(COUNTDOWN_MS);
  assert(game.tick!(s, t.ctx) === true, "countdown -> fight broadcasts");
  assert((s.phase as string) === "fight", "fight starts");
}

/** Put every kid somewhere open and still, far from each other: a clean test range. */
// A bare field for tests (no trees in the way); forts and piles from field 0 can be switched on.
const BARE = FIELDS.length;
FIELDS.push({ ...FIELDS[0], name: "Test", trees: [] });

function clearField(s: SnowState) {
  s.field = BARE;
  s.forts = FIELDS[0].forts.map(() => 0); // no forts in the way
  s.piles = FIELDS[0].piles.map(() => 1e15); // no piles
  // Kid 0 in the middle, everyone else on a ring around it (clear lines of fire from kid 0).
  const spots = s.kids.map((_, i) =>
    i === 0 ? [500, 320] : [500 + Math.cos(i * 0.8) * 260, 320 + Math.sin(i * 0.8) * 240],
  );
  s.kids.forEach((k, i) => {
    [k.x, k.y] = spots[i];
    k.vx = 0;
    k.vy = 0;
  });
}

/** Throw from kid a at kid b's current spot, then run until it lands. Returns the end tuple kind. */
function hit(t: T, s: SnowState, a: number, b: number) {
  const tk = s.kids[b];
  // Wait out the throw cooldown and make sure there's a snowball.
  run(t, s, THROW_CD_MS + TICK_MS);
  s.kids[a].ammo = Math.max(1, s.kids[a].ammo);
  const before = s.kids[b].hp;
  assert(game.action(s, t.ids[a], { type: "throw", x: Math.round(tk.x), y: Math.round(tk.y) }, t.ctx) === false);
  run(t, s, 1_200);
  return before - s.kids[b].hp;
}

function lastSnaps(t: T): Snap[] {
  return t.events.map((e) => e.event).filter(isSnap);
}

// ---------- wire helpers ----------
{
  const xy = [0, 0, 1000, 640, 17.4, 333.6];
  const back = decodePositions(encodePositions(xy));
  assert(back.join() === "0,0,1000,640,17,334", "positions round-trip");
  const st = readStatus("325104", 1);
  assert(st.hp === 1 && st.ammo === 0 && st.power === 1 && st.charges === 1, "status digits");
  const f = makeFlight(100, 100, 400, 100, 0);
  const o = { x: 0, y: 0, h: 0, p: 0 };
  flightAt(f, f.T / 2, o);
  assert(Math.abs(o.x - 250) < 1e-6 && o.h > 40, "an arc peaks in the middle");
  flightAt(f, f.T * 2, o);
  assert(o.p === 1 && o.x === 400 && Math.abs(o.h) < 1e-6, "lands on the target");
  assert(fortShape(FIELDS[0].forts[0], 0) === null, "a fort at 0 hp is gone");
  const big = fortShape(FIELDS[0].forts[0], FORT_HP)!;
  const small = fortShape(FIELDS[0].forts[0], 1)!;
  assert(small.th < big.th && Math.abs(small.bx - small.ax) < Math.abs(big.bx - big.ax), "forts shrink");
}

// ---------- setup & countdown ----------
{
  const t = makeTestCtx(4, 7);
  const s = game.setup(t.ctx);
  assert(s.phase === "countdown" && s.round === 1, "starts in countdown");
  assert(s.kids.every((k) => k.hp === MAX_HP && k.ammo === AMMO), "full hp & ammo");
  const spots = new Set(s.kids.map((k) => `${k.x},${k.y}`));
  assert(spots.size === 4, "distinct spawns");
  // No movement or throws during the countdown.
  game.action(s, t.ids[0], { type: "in", x: 100, y: 0 }, t.ctx);
  game.action(s, t.ids[0], { type: "throw", x: 500, y: 300, s: 1 }, t.ctx);
  assert(s.balls.length === 0, "no throws in countdown");
  const refused = t.events.find((e) => (e.event as { k?: string }).k === "no");
  assert(refused && refused.to === t.ids[0], "refusal goes privately to the thrower");
  const x0 = s.kids[0].x;
  t.advance(1000);
  assert(game.tick!(s, t.ctx) === false, "countdown ticks are quiet");
  assert(s.kids[0].x === x0, "frozen in countdown");
  toFight(t, s);
  run(t, s, 500);
  assert(s.kids[0].x > x0, "a held stick walks once the fight starts");
  assert(lastSnaps(t).length > 0, "snapshots stream during the fight");
}

// ---------- hostile actions ----------
{
  const t = makeTestCtx(2, 3);
  const s = game.setup(t.ctx);
  toFight(t, s);
  const before = JSON.stringify({ k: s.kids, b: s.balls });
  const junk: unknown[] = [
    null,
    undefined,
    42,
    "throw",
    [],
    [1, 2],
    {},
    { type: "in" },
    { type: "in", x: 1.5, y: 0 },
    { type: "in", x: 101, y: 0 },
    { type: "in", x: "5", y: 0 },
    { type: "in", x: Infinity, y: 0 },
    { type: "in", x: NaN, y: 0 },
    { type: "throw" },
    { type: "throw", x: 1e9, y: 3 },
    { type: "throw", x: 3.3, y: 3 },
    { type: "throw", x: 300, y: 300, s: -1 },
    { type: "throw", x: 300, y: 300, s: 1.5 },
    { type: "throw", x: 300, y: 300, s: "1" },
    { type: "__proto__" },
    { type: "dash" },
    { type: "throw", x: [1], y: { a: 1 } },
  ];
  for (const a of junk) {
    assert(game.action(s, t.ids[0], a as never, t.ctx) === false, `junk ${JSON.stringify(a)} -> false`);
  }
  assert(game.action(s, "stranger", { type: "throw", x: 500, y: 300 }, t.ctx) === false, "non-player");
  assert(game.action(s, "stranger", { type: "in", x: 100, y: 0 }, t.ctx) === false, "non-player input");
  assert(JSON.stringify({ k: s.kids, b: s.balls }) === before, "junk changed nothing");
}

// ---------- throwing, ammo, reload, cooldown, range ----------
{
  const t = makeTestCtx(2, 11);
  const s = game.setup(t.ctx);
  toFight(t, s);
  clearField(s);
  const k = s.kids[0];
  game.action(s, t.ids[0], { type: "throw", x: 400, y: 560, s: 1 }, t.ctx);
  assert(s.balls.length === 1 && k.ammo === AMMO - 1, "a throw spends a snowball");
  // Cooldown: an immediate second throw is refused.
  game.action(s, t.ids[0], { type: "throw", x: 400, y: 560, s: 2 }, t.ctx);
  assert(s.balls.length === 1, "throw cooldown");
  run(t, s, THROW_CD_MS);
  game.action(s, t.ids[0], { type: "throw", x: 400, y: 560, s: 3 }, t.ctx);
  run(t, s, THROW_CD_MS);
  game.action(s, t.ids[0], { type: "throw", x: 400, y: 560, s: 4 }, t.ctx);
  assert(k.ammo === 0, "three snowballs, then empty");
  game.action(s, t.ids[0], { type: "throw", x: 400, y: 560, s: 5 }, t.ctx);
  const no5 = t.events.find((e) => (e.event as { k?: string; s?: number }).k === "no" && (e.event as { s: number }).s === 5);
  assert(no5, "empty-handed throw refused with its number");
  run(t, s, RELOAD_MS + 100);
  assert((k.ammo as number) === 1, `reloads one per ${RELOAD_MS}ms (got ${k.ammo})`);
  run(t, s, RELOAD_MS * 3);
  assert((k.ammo as number) === AMMO, "reload stops at full");
  // Range clamp: aiming across the whole field lands at MAX_RANGE.
  run(t, s, 2000);
  s.balls = [];
  [k.x, k.y] = [100, 400];
  game.action(s, t.ids[0], { type: "throw", x: 5000, y: 400, s: 6 }, t.ctx);
  const b = s.balls[0];
  assert(b && Math.abs(Math.hypot(b.f.tx - b.f.x0, b.f.ty - b.f.y0) - MAX_RANGE) <= 1.5, "range clamped");
  assert(b.f.tx <= WORLD_W && b.f.ty <= WORLD_H, "lands on the field");
  // The snapshot carries the spawn with the thrower's number.
  run(t, s, TICK_MS);
  const spawned = lastSnaps(t).some((sn) => sn.b?.some((bt) => bt[0] === b.id && bt[8] === 6));
  assert(spawned, "spawn reaches clients with its input number");
  run(t, s, 1500);
  const ended = lastSnaps(t).some((sn) => sn.e?.some((e) => e[0] === b.id && e[2] === END_GROUND));
  assert(ended, "a miss lands in the snow");
  assert(s.balls.length === 0, "landed balls are dropped");
}

// ---------- hits, knockback, knockouts, round win, match ----------
{
  const t = makeTestCtx(3, 5);
  const s = game.setup(t.ctx);
  toFight(t, s);
  clearField(s);
  const victim = s.kids[1];
  const vx0 = victim.x;
  assert(hit(t, s, 0, 1) === 1, "a hit costs one hp");
  assert(s.hits[0] === 1, "hit counted for the thrower");
  const ends = lastSnaps(t).flatMap((sn) => sn.e ?? []);
  assert(ends.some((e) => e[2] === END_PLAYER && e[3] === 1), "hit reported as a player end");
  assert(victim.x !== vx0 || victim.y !== 260, "knocked back a little");
  clearField(s);
  hit(t, s, 0, 1);
  clearField(s);
  const viewsBefore = s.rev;
  hit(t, s, 0, 1);
  assert(!victim.alive && victim.hp === 0, "three hits = out");
  assert(s.kos[0] === 1 && s.outs.length === 1 && s.outs[0].by === 0, "knockout credited");
  assert(s.rev > viewsBefore, "a knockout broadcasts the view");
  // Out players can't throw or walk.
  game.action(s, t.ids[1], { type: "throw", x: 100, y: 100, s: 9 }, t.ctx);
  assert(!s.balls.some((b) => b.slot === 1), "out players can't throw");
  // Snowballs fly over the fallen.
  clearField(s);
  assert(hit(t, s, 0, 1) === 0, "no more damage to the fallen");
  // Knock out kid 2 too: round to kid 0.
  for (let i = 0; i < 3 && s.phase === "fight"; i++) {
    clearField(s);
    hit(t, s, 0, 2);
  }
  assert(s.phase === "roundOver", `round over (got ${s.phase})`);
  assert(s.wins[0] === 1 && s.lastWinner === t.ids[0], "last one standing takes the round");
  assert(s.history.length === 1 && s.history[0].order.join() === "1,2", "knockout order recorded");
  run(t, s, ROUND_OVER_MS + TICK_MS);
  assert((s.phase as string) === "countdown" && s.round === 2, "next round");
  assert(s.kids.every((k) => k.alive && k.hp === MAX_HP), "everyone back for round 2");
  assert(s.field === (s.firstField + 1) % FIELD_COUNT && s.field !== s.firstField, "fields rotate");
  // Win two more rounds quickly.
  for (let r = 0; r < WINS_NEEDED - 1; r++) {
    toFight(t, s);
    s.kids[1].hp = 1;
    s.kids[2].hp = 1;
    clearField(s);
    hit(t, s, 0, 1);
    clearField(s);
    hit(t, s, 0, 2);
    if (r < WINS_NEEDED - 2) {
      assert(s.phase === "roundOver", "round over");
      run(t, s, ROUND_OVER_MS + TICK_MS);
    }
  }
  assert((s.phase as string) === "final", "match over");
  assert(t.result && t.result.winners.join() === t.ids[0], "winner recorded");
  assert(t.result.scores?.[t.ids[0]] === WINS_NEEDED, "scores are round wins");
  assert(/Player0/.test(t.result.headline), "headline names the winner");
  const r1 = t.result;
  // Nothing after the end.
  assert(game.action(s, t.ids[0], { type: "throw", x: 1, y: 1 }, t.ctx) === false, "ignored after end");
  run(t, s, 2000);
  assert(t.result === r1, "end called once");
  const v = game.view(s, "spectator", t.ctx) as SnowView;
  assert(v.phase === "final" && v.champions?.[0] === t.ids[0], "final view");
  assert(JSON.stringify(v).length < 4096, "view stays small");
}

// ---------- forts ----------
{
  const t = makeTestCtx(2, 9);
  const s = game.setup(t.ctx);
  toFight(t, s);
  clearField(s);
  s.forts[0] = FORT_HP; // the wall at (245..345, 180)
  const k = s.kids[0];
  [k.x, k.y] = [295, 260];
  const shooter = () => {
    run(t, s, THROW_CD_MS + TICK_MS);
    k.ammo = 3;
    game.action(s, t.ids[0], { type: "throw", x: 295, y: 120 }, t.ctx);
    run(t, s, 800);
  };
  shooter();
  assert(s.forts[0] === FORT_HP - 1, `fort takes a hit (hp ${s.forts[0]})`);
  const fe = lastSnaps(t).flatMap((sn) => sn.e ?? []);
  assert(fe.some((e) => e[2] === END_FORT && e[3] === 0), "fort hit reported");
  for (let i = 0; i < FORT_HP - 1; i++) shooter();
  assert(s.forts[0] === 0, "fort crumbles");
  const before = s.forts.slice();
  shooter();
  assert(s.forts.join() === before.join(), "a crumbled fort stops nothing");
  // A long lob sails over a fort.
  s.forts[0] = FORT_HP;
  [k.x, k.y] = [295, 520];
  run(t, s, THROW_CD_MS + TICK_MS);
  k.ammo = 3;
  game.action(s, t.ids[0], { type: "throw", x: 295, y: 20 }, t.ctx);
  run(t, s, 1500);
  assert(s.forts[0] === FORT_HP, "a lob flies over the wall");
  // Walls block walking.
  [k.x, k.y] = [295, 230];
  game.action(s, t.ids[0], { type: "in", x: 0, y: -100 }, t.ctx);
  run(t, s, 1500);
  assert(k.y >= 180 + 15 + PLAYER_R - 1, `can't walk through a fort (y ${k.y.toFixed(1)})`);
  game.action(s, t.ids[0], { type: "in", x: 0, y: 0 }, t.ctx);
}

// ---------- piles & power-ups ----------
{
  const t = makeTestCtx(2, 21);
  const s = game.setup(t.ctx);
  toFight(t, s);
  clearField(s);
  s.piles = FIELDS[0].piles.map(() => 0);
  const k = s.kids[0];
  k.ammo = 1;
  [k.x, k.y] = FIELDS[0].piles[0];
  run(t, s, TICK_MS * 2);
  assert(k.ammo === AMMO_PILE, "a snow pile overfills you");
  assert(s.piles[0] > 0, "the pile regrows");
  // Power-up: triple.
  s.power = { kind: "triple", x: Math.round(k.x), y: Math.round(k.y) + 10 };
  run(t, s, TICK_MS * 2);
  assert(s.power === null && k.power === "triple" && k.charges === 3, "picked up triple");
  assert(lastSnaps(t).some((sn) => /..[1-6]/.test(sn.s.slice(0, 3))), "power shows in the status digits");
  run(t, s, THROW_CD_MS + TICK_MS);
  s.balls = [];
  game.action(s, t.ids[0], { type: "throw", x: Math.round(k.x) + 300, y: Math.round(k.y), s: 3 }, t.ctx);
  assert(s.balls.length === 3 && (k.charges as number) === 2, "triple shot");
  // Big ball does 2 damage.
  k.power = "big";
  k.charges = 1;
  clearField(s);
  run(t, s, 1500);
  const dmg = hit(t, s, 0, 1);
  assert(dmg === 2, `big ball = 2 damage (got ${dmg})`);
  assert(k.power === null, "charges run out");
  // Power-ups appear on their own.
  const t2 = makeTestCtx(2, 4);
  const s2 = game.setup(t2.ctx);
  toFight(t2, s2);
  run(t2, s2, 8_000);
  assert(s2.power !== null, "a power-up drops");
}

// ---------- blizzard & round cap ----------
{
  const t = makeTestCtx(2, 13);
  const s = game.setup(t.ctx);
  toFight(t, s);
  clearField(s);
  run(t, s, SUDDEN_MS + 100);
  assert(s.sudden && s.kids.every((k) => k.hp === 1), "blizzard: one hit = out");
  run(t, s, ROUND_CAP_MS - SUDDEN_MS);
  assert(s.phase === "roundOver" && s.lastWinner === null, "round cap = draw");
  assert(s.wins.every((w) => w === 0), "nobody scores a draw");
}

// ---------- disconnects ----------
{
  // Countdown: a drop doesn't stall it; reconnect resumes.
  const t = makeTestCtx(3, 17);
  const s = game.setup(t.ctx);
  t.ctx.players[1].connected = false;
  game.playerLeft!(s, t.ids[1], t.ctx);
  toFight(t, s);
  run(t, s, 1000);
  assert(s.phase === "fight", "fight runs with one offline");
  // The offline player is a sitting duck: hits still land.
  clearField(s);
  assert(hit(t, s, 0, 1) === 1, "offline players can be hit");
  t.ctx.players[1].connected = true;
  game.playerReturned!(s, t.ids[1], t.ctx);
  assert(s.aloneSince === null, "not alone");
}
{
  // Everyone but one leaves: forfeit after ABANDON_MS, in every phase.
  for (const phase of ["countdown", "fight", "roundOver"] as const) {
    const t = makeTestCtx(2, 23);
    const s = game.setup(t.ctx);
    if (phase !== "countdown") toFight(t, s);
    if (phase === "roundOver") {
      clearField(s);
      s.kids[1].hp = 1;
      hit(t, s, 0, 1);
      assert(s.phase === "roundOver", "reached round over");
    }
    t.ctx.players[1].connected = false;
    game.playerLeft!(s, t.ids[1], t.ctx);
    const v = game.view(s, t.ids[0], t.ctx) as SnowView;
    assert(v.abandonAt !== null, "abandon countdown shown");
    run(t, s, 10_500);
    assert(s.phase === "final" && t.result?.winners.join() === t.ids[0], `forfeit from ${phase}`);
  }
  // Both leave: abandoned.
  const t = makeTestCtx(2, 29);
  const s = game.setup(t.ctx);
  toFight(t, s);
  for (const p of t.ctx.players) p.connected = false;
  game.playerLeft!(s, t.ids[0], t.ctx);
  game.playerLeft!(s, t.ids[1], t.ctx);
  run(t, s, 10_500);
  assert(s.phase === "final" && t.result?.winners.length === 0, "abandoned: no winners");
  // Coming back before the deadline cancels it.
  const t3 = makeTestCtx(2, 31);
  const s3 = game.setup(t3.ctx);
  toFight(t3, s3);
  t3.ctx.players[1].connected = false;
  game.playerLeft!(s3, t3.ids[1], t3.ctx);
  run(t3, s3, 4000);
  t3.ctx.players[1].connected = true;
  game.playerReturned!(s3, t3.ids[1], t3.ctx);
  run(t3, s3, 8000);
  assert(s3.phase === "fight" && !t3.result, "reconnect cancels the forfeit");
}

// ---------- 8 players, simultaneous knockouts, max rounds, bandwidth ----------
{
  const t = makeTestCtx(8, 37);
  const s = game.setup(t.ctx);
  const spots = new Set(s.kids.map((k) => `${k.x},${k.y}`));
  assert(spots.size === 8, "eight distinct spawns");
  toFight(t, s);
  // Everyone walks around and throws; measure snapshot sizes.
  t.events.length = 0;
  for (let i = 0; i < 60; i++) {
    t.ids.forEach((id, j) => {
      if (i % 10 === j % 10) game.action(s, id, { type: "in", x: i % 20 < 10 ? 100 : -100, y: j % 2 ? 60 : -60 }, t.ctx);
      if (i % 8 === j % 8) game.action(s, id, { type: "throw", x: 500, y: 320, s: i + 1 }, t.ctx);
    });
    run(t, s, TICK_MS);
  }
  const bytes = t.events.reduce((n, e) => n + JSON.stringify(e.event).length, 0);
  const perSec = bytes / 3 / 1024;
  assert(perSec < 6, `snapshot traffic ${perSec.toFixed(2)} KB/s at 8 players`);
  const v = JSON.stringify(game.view(s, t.ids[0], t.ctx));
  assert(v.length < 4096, `view ${v.length} B`);
}
{
  // Two last players out on the same step = a draw.
  const t = makeTestCtx(3, 41);
  const s = game.setup(t.ctx);
  toFight(t, s);
  clearField(s);
  s.kids[0].alive = false;
  s.kids[0].hp = 0;
  s.kids[1].hp = 1;
  s.kids[2].hp = 1;
  // Both throw at each other at the same moment from mirrored spots.
  [s.kids[1].x, s.kids[1].y] = [300, 320];
  [s.kids[2].x, s.kids[2].y] = [700, 320];
  run(t, s, THROW_CD_MS + TICK_MS);
  game.action(s, t.ids[1], { type: "throw", x: 700, y: 320 }, t.ctx);
  game.action(s, t.ids[2], { type: "throw", x: 300, y: 320 }, t.ctx);
  run(t, s, 1500);
  assert(s.phase === "roundOver" && s.lastWinner === null, `double knockout = draw (${s.phase}, ${s.lastWinner})`);
}
{
  // Max rounds: draws all the way end the match on wins (all zero = no winners).
  const t = makeTestCtx(2, 43);
  const s = game.setup(t.ctx);
  for (let r = 0; r < 7; r++) {
    toFight(t, s);
    run(t, s, ROUND_CAP_MS + TICK_MS);
    if (s.phase === "roundOver") run(t, s, ROUND_OVER_MS + TICK_MS);
  }
  assert(s.phase === "final" && t.result && t.result.winners.length === 0, "seven draws end the match");
  assert(/draw/.test(t.result.headline), "draw headline");
}
{
  // Spectator view = player view (nothing secret), and snapshots carry nothing input-dependent.
  const t = makeTestCtx(2, 47);
  const s = game.setup(t.ctx);
  const a = JSON.stringify(game.view(s, t.ids[0], t.ctx));
  const b = JSON.stringify(game.view(s, "spectator", t.ctx));
  assert(a === b, "same view for all");
}

console.log("✓ snowball tests passed");
