import { assert, makeTestCtx } from "../../shared/testing";
import type { Settings } from "../../shared/settings";
import game, { type StackState } from "./server";
import {
  AWAY_MS,
  BASE,
  GAME_MS,
  GAP_MS,
  MAX_LAG_MS,
  PERFECT,
  RANGE,
  READY_MS,
  RESTART_MS,
  land,
  motion,
  offsetAt,
  type Rect,
  type StackView,
} from "./shared";

function start(n: number, seed = 3, settings: Settings = {}, bots = 0) {
  const t = makeTestCtx(n, seed, settings, bots);
  const s: StackState = game.setup(t.ctx);
  return { t, s };
}
type G = ReturnType<typeof start>;
const result = (g: G) => g.t.result;
const act = (g: G, who: string, a: unknown) => game.action(g.s, who, a, g.t.ctx);
const tick = (g: G) => game.tick!(g.s, g.t.ctx);
const view = (g: G, id: string) => game.view(g.s, id, g.t.ctx) as StackView;
const now = (g: G) => g.t.ctx.now();
function go(g: G) {
  g.t.advance(READY_MS);
  tick(g);
  assert(g.s.phase === "play", "play after countdown");
}
/** Time after spawn at which the block for this level is dead centre (first pass). */
function centreT(g: G, lv: number) {
  const m = motion(g.s.seed, lv, g.s.speed);
  return RANGE / m.v;
}
/** Drop perfectly (or off by `err` units) as player `id`, waiting for the block first. */
function dropAt(g: G, id: string, err = 0) {
  const tw = g.s.ps[id].tower;
  const lv = tw.blocks.length;
  const m = motion(g.s.seed, lv, g.s.speed);
  const t = Math.max(0, (RANGE + err * m.dir) / m.v);
  const wait = tw.spawnAt + t - now(g);
  if (wait > 0) g.t.advance(Math.ceil(wait));
  return act(g, id, { type: "drop", lv, t });
}

/** Wait for a moment when the sliding block is fully off the tower and drop it there. */
function topple(g: G, id: string) {
  const tw = g.s.ps[id].tower;
  const lv = tw.blocks.length;
  const m = motion(g.s.seed, lv, g.s.speed);
  const top = tw.blocks[lv - 1];
  for (let k = 0; k < 2000; k++) {
    const t = now(g) - tw.spawnAt;
    if (t >= 0 && Math.abs(offsetAt(m, t)) >= top[m.alongX ? 2 : 3]) break;
    g.t.advance(10);
  }
  act(g, id, { type: "drop", lv, t: now(g) - tw.spawnAt });
  assert(!g.s.ps[id].tower.alive, "toppled");
}

// ---------- physics ----------
{
  const m = motion(1, 1, "normal");
  assert(m.alongX && motion(1, 2, "normal").alongX === false, "axes alternate");
  assert(JSON.stringify(motion(99, 7, "fast")) === JSON.stringify(motion(99, 7, "fast")), "motion deterministic");
  assert(motion(1, 30, "normal").v > motion(1, 1, "normal").v * 1.5, "speed ramps");
  assert(Math.abs(offsetAt(m, 0)) === RANGE, "starts at the edge of its range");
  assert(Math.abs(offsetAt(m, RANGE / m.v)) < 0.02, "centre after RANGE/v");
  const p = land(BASE, m, 1, 0);
  assert(p.kind === "perfect" && p.chip === null && p.rect![2] === 100, "perfect snaps");
  const c = land(BASE, m, 20, 0);
  assert(c.kind === "cut" && c.rect![2] === 80 && c.rect![0] === 10 && c.chip![2] === 20 && c.chip![0] === 60, "cut slices overhang");
  const z = land(BASE, motion(1, 2, "normal"), -30, 0);
  assert(z.rect![3] === 70 && z.rect![1] === -15 && z.rect![2] === 100, "cut along z");
  assert(land(BASE, m, 100, 0).kind === "miss", "full overhang misses");
  const narrow: Rect = [0, 0, 60, 100];
  const g = land(narrow, m, 0, 2);
  assert(g.kind === "perfect" && g.rect![2] === 66 && g.combo === 3, "combo regrows");
  assert(land(BASE, m, PERFECT + 0.5, 4).combo === 0, "a cut resets the combo");
}

// ---------- determinism ----------
{
  const a = start(1, 77);
  const b = start(4, 77);
  assert(a.s.seed === b.s.seed, "seed comes from ctx.random only");
}

// ---------- solo game: perfect drops then a miss ----------
{
  const g = start(1, 5, { tries: 1 });
  const id = g.t.ids[0];
  assert(act(g, id, { type: "drop", lv: 1, t: 100 }) === false, "no drops during countdown");
  go(g);
  for (let i = 0; i < 5; i++) assert(dropAt(g, id) === true, "perfect drop");
  const tw = g.s.ps[id].tower;
  assert(tw.blocks.length === 6 && tw.perfects === 5 && tw.combo === 5, "five perfects");
  assert(tw.blocks.every((b) => b[2] === 100 && b[3] === 100), "nothing cut");
  assert(dropAt(g, id, 12) === true, "sloppy drop");
  const top = tw.blocks[tw.blocks.length - 1];
  assert(Math.abs(top[2] * top[3] - 100 * 88) < 1, "12 units cut");
  assert(g.s.ps[id].tower.combo === 0, "combo reset");
  // Miss: drop at the very start (block is fully off the tower).
  topple(g, id);
  assert(result(g), "solo game over with no tries left");
  assert(result(g)!.scores![id] === 6 * 10 + 5 * 5, `score ${result(g)!.scores![id]}`);
  assert(result(g)!.winners[0] === id, "solo winner");
  assert(g.t.events.some((e) => (e.event as { t: string }).t === "fall"), "fall event");
}

// ---------- lag clamp: a drop can't claim a time far in the past or the future ----------
{
  const g = start(1, 6);
  const id = g.t.ids[0];
  go(g);
  const tw = g.s.ps[id].tower;
  const tc = centreT(g, 1);
  // Arrive 3s after the perfect moment, claiming the perfect moment.
  g.t.advance(Math.ceil(tc) + 3000);
  act(g, id, { type: "drop", lv: 1, t: tc });
  const claimedAt = tw.spawnAt - GAP_MS; // spawnAt moved to drop time + GAP
  assert(claimedAt >= now(g) - MAX_LAG_MS - 1, "claimed time clamped to the lag window");
  // Future claims are clamped to now.
  const g2 = start(1, 6);
  go(g2);
  g2.t.advance(700);
  act(g2, g2.t.ids[0], { type: "drop", lv: 1, t: 1e9 });
  const t2 = g2.s.ps[g2.t.ids[0]].tower;
  assert(t2.alive ? t2.spawnAt === now(g2) + GAP_MS : t2.restartAt === now(g2) + RESTART_MS, "future claim clamped to now");
}

// ---------- invalid actions ----------
{
  const g = start(2, 8);
  const [a] = g.t.ids;
  go(g);
  const junk: unknown[] = [null, 0, "drop", [], {}, { type: "drop" }, { type: "drop", lv: 2, t: 10 }, { type: "drop", lv: "1", t: 10 },
    { type: "drop", lv: 1, t: NaN }, { type: "drop", lv: 1, t: Infinity }, { type: "drop", lv: 1, t: "5" }, { type: "drop", col: 1.5 }, { type: "x" }];
  for (const j of junk) assert(act(g, a, j) === false, `junk refused ${JSON.stringify(j)}`);
  assert(act(g, "ghost", { type: "drop", lv: 1, t: 10 }) === false, "non-player refused");
  assert(g.s.ps[a].tower.blocks.length === 1, "nothing placed");
  // Can't drop before the next block appears.
  assert(dropAt(g, a) === true, "drop");
  assert(act(g, a, { type: "drop", lv: 2, t: 0 }) === false, "next block not there yet");
}

// ---------- idle blocks fall by themselves; tries; game cap ----------
{
  const g = start(1, 9, { tries: 2 });
  const id = g.t.ids[0];
  go(g);
  let guard = 0;
  let idleDrops = 0;
  while (g.s.ps[id].tower.n === 0 && guard++ < 2000) {
    const before = g.s.ps[id].tower.blocks.length;
    g.t.advance(250);
    tick(g);
    if (g.s.ps[id].tower.blocks.length > before) idleDrops++;
  }
  assert(idleDrops > 0 || g.s.ps[id].tower.n === 1, "idle blocks fall by themselves");
  assert(g.s.ps[id].tower.n === 1 && g.s.ps[id].tower.alive, "second tower after the first toppled");
  assert(!result(g), "still going with a try left");
  assert(view(g, id).me!.triesLeft === 0, "no tries left");
  g.t.advance(GAME_MS);
  tick(g);
  assert(result(g), "game cap ends it");
}

// ---------- multiplayer, leaving, spectators ----------
{
  const g = start(3, 10, { tries: 1 });
  const [a, b, c] = g.t.ids;
  go(g);
  for (let i = 0; i < 4; i++) dropAt(g, a);
  for (let i = 0; i < 2; i++) dropAt(g, b, 5);
  const v = view(g, "spectator");
  assert(v.me === null && v.watch?.id === a, "spectator watches the leader");
  const vb = view(g, b);
  assert(vb.rows.find((r) => r.id === a)!.h === 4, "rows show others' heights");
  assert(JSON.stringify(vb).length < 4000, "view stays small");
  // c drops out: their tower closes after AWAY_MS.
  g.t.ctx.players[2].connected = false;
  game.playerLeft!(g.s, c, g.t.ctx);
  g.t.advance(AWAY_MS);
  tick(g);
  assert(g.s.ps[c].done, "away player's tower closed");
  // a and b topple: game ends.
  for (const id of [a, b]) topple(g, id);
  assert(result(g), "ended");
  assert(result(g)!.winners.length === 1 && result(g)!.winners[0] === a, "tallest wins");
}

// ---------- bots ----------
{
  const g = start(3, 14, { tries: 1 }, 2);
  const human = g.t.ids[0];
  go(g);
  let guard = 0;
  while (!result(g) && guard++ < 100_000) {
    g.t.advance(100);
    for (const id of g.t.ids) {
      if (!g.t.ctx.player(id)?.bot) continue;
      const a = game.bot!(g.s, id, g.t.ctx);
      if (a) assert(game.action(g.s, id, a, g.t.ctx) === true, "bot drop accepted");
    }
    if (g.s.ps[human].tower.alive && guard === 30) topple(g, human);
    tick(g);
  }
  assert(result(g), "bots finished");
  const hs = g.t.ids.filter((id) => id.startsWith("bot")).map((id) => g.s.ps[id].bestH);
  console.log(`  bot towers: ${hs.join(", ")}`);
  assert(hs.every((h) => h >= 5 && h < 120), "bots build reasonable towers");
}

console.log("✓ stack");
