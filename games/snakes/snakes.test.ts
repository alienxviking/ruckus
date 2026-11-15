import { assert, makeTestCtx } from "../../shared/testing";
import type { GameResult } from "../../shared/types";
import game, { buildView, spawnLayout, type Snake, type SnakeAction, type SnakeState, type SnakeView } from "./server";
import {
  COUNTDOWN_MS,
  DELTA,
  DIRS,
  GHOST_MS,
  GOLDEN_VALUE,
  MAX_QUEUE,
  REJOIN_MS,
  ROUND_MS,
  ROUND_OVER_MS,
  START_LEN,
  TICK_MS,
  OPPOSITE,
  type Dir,
  type Phase,
} from "./shared";

// ---------- harness ----------

function start(n: number, seed = 7) {
  const t = makeTestCtx(n, seed);
  const ends: GameResult[] = [];
  const realEnd = t.ctx.end;
  t.ctx.end = (r) => {
    ends.push(r);
    realEnd(r);
  };
  const s: SnakeState = game.setup(t.ctx);
  return { t, s, ends };
}
type H = ReturnType<typeof start>;

const tick = (h: H, ms = TICK_MS) => {
  h.t.advance(ms);
  return game.tick!(h.s, h.t.ctx);
};
const act = (h: H, id: string, a: unknown) => game.action(h.s, id, a as SnakeAction, h.t.ctx);
const turn = (h: H, id: string, dir: Dir) => act(h, id, { type: "turn", dir });
const snakeOf = (h: H, id: string) => h.s.snakes.find((x) => x.id === id) as Snake;
const at = (h: H, x: number, y: number) => y * h.s.w + x;
const lenOf = (sn: Snake) => sn.body.length + sn.grow;
const viewOf = (h: H, id: string) => game.view(h.s, id, h.t.ctx) as SnakeView;
const perp = (d: Dir): Dir => (d === "up" || d === "down" ? "left" : "up");
// Read through functions so TypeScript doesn't carry narrowing across state-mutating calls.
const phaseOf = (h: H): Phase => h.s.phase;
const num = (x: number) => x;
const dirOf = (sn: Snake): Dir => sn.dir;

function toPlay(h: H) {
  assert(phaseOf(h) === "countdown", `expected countdown, got ${h.s.phase}`);
  h.t.advance(h.s.endsAt - h.t.ctx.now());
  assert(game.tick!(h.s, h.t.ctx) === true, "countdown -> play broadcasts");
  assert(phaseOf(h) === "play", `expected play, got ${h.s.phase}`);
}

/** Head at (x, y) moving `dir`, body trailing behind it. */
function line(x: number, y: number, dir: Dir, len = START_LEN): [number, number][] {
  const [dx, dy] = DELTA[dir];
  return Array.from({ length: len }, (_, i) => [x - dx * i, y - dy * i] as [number, number]);
}

function place(h: H, id: string, cells: [number, number][], dir: Dir, grow = 0) {
  const sn = snakeOf(h, id);
  sn.body = cells.map(([x, y]) => at(h, x, y));
  sn.dir = dir;
  sn.queue = [];
  sn.alive = true;
  sn.away = false;
  sn.grow = grow;
  sn.diedAt = 0;
}

/** Park exactly the minimum food in the bottom-right corner and stop golden pellets, so scenarios are deterministic. */
function quiet(h: H) {
  const s = h.s;
  s.food = [];
  for (let i = 0; s.food.length < s.snakes.length + 3; i++) s.food.push((s.h - 1) * s.w + (s.w - 1 - i));
  s.golden = null;
  s.goldenAt = Number.MAX_SAFE_INTEGER;
}

function disconnect(h: H, id: string) {
  h.t.ctx.player(id)!.connected = false;
  game.playerLeft!(h.s, id, h.t.ctx);
}
function reconnect(h: H, id: string) {
  h.t.ctx.player(id)!.connected = true;
  game.playerReturned!(h.s, id, h.t.ctx);
}

/** In play: every snake except `winner` drives into the right wall next tick (winner null = all crash). */
function finishPlay(h: H, winner: string | null) {
  assert(phaseOf(h) === "play", "finishPlay needs play");
  quiet(h);
  let j = 0;
  for (const sn of h.s.snakes) {
    if (!sn.alive) continue;
    if (sn.id === winner) place(h, sn.id, line(10, h.s.h - 4, "left"), "left");
    else place(h, sn.id, line(h.s.w - 1, 2 + 2 * j++, "right"), "right");
  }
  tick(h);
}

/** Play a whole round with a chosen outcome, starting from countdown or roundOver. */
function forceRound(h: H, winner: string | null) {
  if (phaseOf(h) === "roundOver") {
    h.t.advance(h.s.endsAt - h.t.ctx.now());
    game.tick!(h.s, h.t.ctx);
  }
  toPlay(h);
  finishPlay(h, winner);
}

function stepCell(s: SnakeState, c: number, d: Dir) {
  const x = (c % s.w) + DELTA[d][0];
  const y = Math.floor(c / s.w) + DELTA[d][1];
  return x < 0 || y < 0 || x >= s.w || y >= s.h ? -1 : y * s.w + x;
}

function flood(s: SnakeState, blocked: Uint8Array, from: number, limit: number) {
  const seen = new Uint8Array(s.w * s.h);
  const q = [from];
  seen[from] = 1;
  let n = 0;
  while (q.length && n < limit) {
    const c = q.shift()!;
    n++;
    for (const d of DIRS) {
      const nc = stepCell(s, c, d);
      if (nc >= 0 && !blocked[nc] && !seen[nc]) {
        seen[nc] = 1;
        q.push(nc);
      }
    }
  }
  return n;
}

/** A cautious bot: never into walls, bodies or another head's reach; prefers open space. */
function safeDir(h: H, id: string): Dir | null {
  const s = h.s;
  const sn = snakeOf(h, id);
  if (!sn || !sn.alive) return null;
  const blocked = new Uint8Array(s.w * s.h);
  for (const o of s.snakes) if (o.alive) for (const c of o.body) blocked[c] = 1;
  for (const o of s.snakes) {
    if (!o.alive || o === sn) continue;
    for (const d of DIRS) {
      const c = stepCell(s, o.body[0], d);
      if (c >= 0) blocked[c] = 1;
    }
  }
  let best: Dir | null = null;
  let bestScore = -1;
  for (const d of DIRS) {
    if (d === OPPOSITE[sn.dir]) continue;
    const c = stepCell(s, sn.body[0], d);
    if (c < 0 || blocked[c]) continue;
    const score = flood(s, blocked, c, 60) + (d === sn.dir ? 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function assertPlain(v: unknown, path = "view") {
  if (v === null) return;
  assert(v !== undefined, `${path} is undefined`);
  if (typeof v === "number") return assert(Number.isFinite(v), `${path} is not finite`);
  if (typeof v === "string" || typeof v === "boolean") return;
  assert(typeof v === "object", `${path} has type ${typeof v}`);
  if (Array.isArray(v)) return v.forEach((x, i) => assertPlain(x, `${path}[${i}]`));
  const proto = Object.getPrototypeOf(v);
  assert(proto === Object.prototype, `${path} is not a plain object`);
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) assertPlain(x, `${path}.${k}`);
}

function checkInvariants(h: H, label: string) {
  const s = h.s;
  const taken = new Set<number>();
  for (const sn of s.snakes) {
    assert(sn.queue.length <= MAX_QUEUE, `${label}: queue too long`);
    if (!sn.alive) continue;
    assert(sn.body.length >= START_LEN, `${label}: snake shrank`);
    sn.body.forEach((c, j) => {
      assert(Number.isInteger(c) && c >= 0 && c < s.w * s.h, `${label}: body out of bounds`);
      assert(!taken.has(c), `${label}: bodies overlap at ${c}`);
      taken.add(c);
      if (j > 0) {
        const p = sn.body[j - 1];
        const d = Math.abs((p % s.w) - (c % s.w)) + Math.abs(Math.floor(p / s.w) - Math.floor(c / s.w));
        assert(d === 1, `${label}: body not contiguous`);
      }
    });
  }
  const food = new Set<number>();
  for (const c of s.food) {
    assert(Number.isInteger(c) && c >= 0 && c < s.w * s.h, `${label}: food out of bounds`);
    assert(!taken.has(c), `${label}: food under a live snake`);
    assert(!food.has(c), `${label}: duplicate food`);
    food.add(c);
  }
  if (s.golden !== null) {
    assert(!taken.has(s.golden) && !food.has(s.golden), `${label}: golden pellet on something`);
  }
  if (s.phase === "countdown" || s.phase === "play") {
    assert(s.food.length >= s.snakes.length + 3, `${label}: not enough food (${s.food.length})`);
  }
}

// ---------- setup & grid sizes ----------

for (const [n, w, hh] of [
  [2, 32, 24],
  [3, 32, 24],
  [4, 40, 30],
  [8, 40, 30],
] as const) {
  const h = start(n);
  assert(h.s.w === w && h.s.h === hh, `grid for ${n} players should be ${w}x${hh}`);
  assert(phaseOf(h) === "countdown" && h.s.round === 1, "starts in round 1 countdown");
  assert(h.s.endsAt === h.t.ctx.now() + COUNTDOWN_MS, "countdown lasts 3s");
  assert(h.s.snakes.length === n, "one snake per player");
  assert(h.s.snakes.every((sn) => sn.alive && sn.body.length === START_LEN), "length-4 snakes");
  assert(h.s.food.length === n + 3, "players + 3 pellets");
  assert(h.s.golden === null, "no golden pellet before play");
  assert(Object.keys(h.s.roundWins).length === n, "round wins for everyone");
  checkInvariants(h, `setup ${n}`);
  // Countdown ticks don't broadcast; the snakes stay put.
  const before = JSON.stringify(h.s.snakes);
  assert(tick(h, 1000) === false && tick(h, 1000) === false, "countdown ticks are quiet");
  assert(JSON.stringify(h.s.snakes) === before, "nothing moves during the countdown");
  assert(tick(h, 999) === false && phaseOf(h) === "countdown", "not before the deadline");
  assert(tick(h, 1) === true && phaseOf(h) === "play", "play starts at the deadline");
  assert(h.s.endsAt === h.t.ctx.now() + ROUND_MS, "round lasts 90s");
}

// ---------- spawn layouts: every count, both grids, every mirror ----------

for (const [w, hh, counts] of [
  [32, 24, [2, 3]],
  [40, 30, [2, 3, 4, 5, 6, 7, 8]],
] as const) {
  for (const n of counts) {
    for (const fx of [false, true]) {
      for (const fy of [false, true]) {
        const label = `layout ${w}x${hh} n=${n} flip=${fx},${fy}`;
        const layout = spawnLayout(w, hh, n, fx, fy);
        assert(layout.length === n, `${label}: count`);
        const owner = new Map<number, number>();
        layout.forEach(({ body, dir }, i) => {
          assert(body.length === START_LEN, `${label}: length`);
          for (const c of body) {
            assert(c >= 0 && c < w * hh, `${label}: in bounds`);
            assert(!owner.has(c), `${label}: overlap`);
            owner.set(c, i);
          }
          const hx = body[0] % w;
          const hy = Math.floor(body[0] / w);
          const inward =
            (dir === "right" && hx < w / 2) ||
            (dir === "left" && hx > w / 2) ||
            (dir === "down" && hy < hh / 2) ||
            (dir === "up" && hy > hh / 2);
          assert(inward, `${label}: snake ${i} faces inward`);
        });
        // At least one free cell between different snakes.
        for (const [c, i] of owner) {
          for (const d of DIRS) {
            const x = (c % w) + DELTA[d][0];
            const y = Math.floor(c / w) + DELTA[d][1];
            const o = owner.get(y * w + x);
            assert(x < 0 || y < 0 || x >= w || y >= hh || o === undefined || o === i, `${label}: snakes touch`);
          }
        }
        // Nobody can crash in the first 12 ticks (~1.3s) when everyone goes straight.
        const h = start(w === 32 ? Math.max(2, n) : Math.max(4, n));
        h.s.snakes = h.s.snakes.slice(0, n);
        toPlay(h);
        quiet(h);
        h.s.snakes.forEach((sn, i) => {
          sn.body = layout[i].body.slice();
          sn.dir = layout[i].dir;
        });
        for (let k = 0; k < 12; k++) tick(h);
        assert(phaseOf(h) === "play" && h.s.snakes.every((sn) => sn.alive), `${label}: early crash`);
      }
    }
  }
}

// ---------- full match: a careful bot beats a snake that never turns ----------

{
  const h = start(2, 3);
  const [a, b] = h.t.ids;
  let guard = 0;
  const phases = new Set<string>();
  while (!h.ends.length && guard++ < 5000) {
    phases.add(h.s.phase);
    if (phaseOf(h) === "play") {
      const d = safeDir(h, a);
      if (d && d !== snakeOf(h, a).dir) turn(h, a, d);
    }
    tick(h);
    checkInvariants(h, `full match tick ${guard}`);
  }
  assert(h.ends.length === 1, "match ends exactly once");
  const r = h.t.result!;
  assert(r.winners.length === 1 && r.winners[0] === a, "careful bot wins");
  assert(r.scores?.[a] === 2 && r.scores?.[b] === 0, "scores are round wins");
  assert(r.headline === "Player0 wins Snake Brawl 2–0", `headline: ${r.headline}`);
  assert(phaseOf(h) === "final" && h.s.champions?.join() === a, "final phase with champion");
  assert(["countdown", "play", "roundOver"].every((p) => phases.has(p)), "went through every phase");
  assert(h.s.history.length === h.s.round && h.s.history.filter((x) => x.winner === a).length === 2, "history");
  assert(h.s.history.every((x) => x.reason === "last"), "rounds ended by crashes");
  assert(viewOf(h, b).best[a] >= START_LEN && viewOf(h, b).best[b] >= START_LEN, "best lengths in the view");
  // After the end nothing moves and nothing is accepted.
  const frozen = JSON.stringify(h.s);
  for (let i = 0; i < 30; i++) assert(tick(h, 5000) === false, "final ticks are quiet");
  assert(turn(h, a, "up") === false && turn(h, b, "left") === false, "actions ignored after the end");
  disconnect(h, b);
  reconnect(h, b);
  assert(JSON.stringify(h.s) === frozen, "final state frozen");
  assert(h.ends.length === 1, "still ended exactly once");
}

// ---------- 2–1 headline ----------

{
  const h = start(3);
  const [a, b, c] = h.t.ids;
  forceRound(h, b);
  assert(phaseOf(h) === "roundOver" && h.s.lastRoundWinner === b && h.s.roundReason === "last", "b takes round 1");
  assert(h.s.endsAt === h.t.ctx.now() + ROUND_OVER_MS, "round over lasts 3s");
  assert(tick(h, ROUND_OVER_MS - 1) === false && phaseOf(h) === "roundOver", "round over waits");
  assert(tick(h, 1) === true && phaseOf(h) === "countdown" && h.s.round === 2, "round 2 countdown");
  checkInvariants(h, "round 2");
  assert(h.s.snakes.length === 3 && h.s.snakes.every((sn) => sn.alive && sn.body.length === START_LEN), "fresh snakes");
  forceRound(h, c);
  forceRound(h, b);
  assert(h.ends.length === 1 && h.t.result?.winners.join() === b, "b wins");
  assert(h.t.result?.headline === "Player1 wins Snake Brawl 2–1", `headline: ${h.t.result?.headline}`);
  assert(h.t.result?.scores?.[a] === 0 && h.t.result?.scores?.[c] === 1, "scores");
}

// ---------- round cap: ties all win; all draws -> nobody wins; single leader ----------

{
  const h = start(3);
  const [a, b, c] = h.t.ids;
  forceRound(h, a);
  forceRound(h, b);
  forceRound(h, c);
  forceRound(h, null);
  assert(phaseOf(h) === "roundOver" && h.s.roundReason === "crash" && h.s.lastRoundWinner === null, "crash = draw");
  assert(h.s.round === 4 && !h.ends.length, "still going after 4 rounds");
  forceRound(h, null);
  assert(phaseOf(h) === "final" && h.ends.length === 1, "capped at 5 rounds");
  assert(h.t.result?.winners.slice().sort().join() === [a, b, c].join(), "ties all win");
  assert(h.t.result?.headline === "Player0, Player1 & Player2 tie Snake Brawl with 1 round each", h.t.result?.headline);
  assert(JSON.stringify(h.s.history.map((x) => x.winner)) === JSON.stringify([a, b, c, null, null]), "history");
  assert(h.s.history[3].reason === "crash", "draw reason");
}
{
  const h = start(2);
  for (let i = 0; i < 5; i++) forceRound(h, null);
  assert(phaseOf(h) === "final" && h.ends.length === 1, "five draws end the match");
  assert(h.t.result?.winners.length === 0, "nobody wins");
  assert(h.t.result?.headline === "Snake Brawl ends in a draw: nobody took a round", h.t.result?.headline);
}
{
  const h = start(2);
  forceRound(h, h.t.ids[1]);
  for (let i = 0; i < 4; i++) forceRound(h, null);
  assert(h.t.result?.winners.join() === h.t.ids[1], "single leader at the cap wins");
  assert(h.t.result?.headline === "Player1 wins Snake Brawl 1–0", h.t.result?.headline);
}

// ---------- timeout: longest snake wins; a tie is a draw ----------

{
  const h = start(3);
  const [a, b, c] = h.t.ids;
  toPlay(h);
  quiet(h);
  place(h, a, line(10, 5, "right", 6), "right");
  place(h, b, line(10, 10, "right"), "right");
  place(h, c, line(10, 15, "right"), "right", 3); // 4 + 3 pending = 7, the longest
  assert(tick(h, ROUND_MS - 1 - TICK_MS) === true && phaseOf(h) === "play", "not over before 90s");
  tick(h, 1 + TICK_MS);
  assert(phaseOf(h) === "roundOver" && h.s.lastRoundWinner === c && h.s.roundReason === "time", "longest wins on time");
  assert(h.s.roundWins[c] === 1, "round win counted");
}
{
  const h = start(3);
  const [a, b, c] = h.t.ids;
  toPlay(h);
  quiet(h);
  place(h, a, line(10, 5, "right", 6), "right");
  place(h, b, line(10, 10, "right", 5), "right", 1);
  place(h, c, line(10, 15, "right"), "right");
  tick(h, ROUND_MS);
  assert(phaseOf(h) === "roundOver" && h.s.lastRoundWinner === null && h.s.roundReason === "tie", "tie for longest = draw");
  assert(Object.values(h.s.roundWins).every((x) => x === 0), "nobody scores");
  assert(h.s.history[0].winner === null && h.s.history[0].reason === "tie", "history: tie");
}

// ---------- early end: the round ends as soon as one snake is left ----------

{
  const h = start(4);
  const [a, b, c, d] = h.t.ids;
  toPlay(h);
  quiet(h);
  place(h, a, line(h.s.w - 1, 3, "right"), "right");
  place(h, b, line(12, 10, "left"), "left");
  place(h, c, line(12, 15, "left"), "left");
  place(h, d, line(12, 20, "left"), "left");
  tick(h);
  assert(phaseOf(h) === "play" && h.s.snakes.filter((sn) => sn.alive).length === 3, "three left: keep going");
  place(h, b, line(h.s.w - 1, 5, "right"), "right");
  place(h, c, line(h.s.w - 1, 7, "right"), "right");
  tick(h);
  assert(phaseOf(h) === "roundOver" && h.s.lastRoundWinner === d, "last snake standing wins immediately");
  assert(h.t.ctx.now() < h.s.endsAt && h.s.history.length === 1, "well before the 90s timer");
}

// ---------- collisions ----------

{
  // Wall.
  const h = start(2);
  const [a, b] = h.t.ids;
  toPlay(h);
  quiet(h);
  place(h, a, line(h.s.w - 1, 3, "right"), "right");
  place(h, b, line(10, 12, "left"), "left");
  tick(h);
  assert(!snakeOf(h, a).alive && snakeOf(h, b).alive, "wall kills");
  assert(h.s.feed.length === 1 && h.s.feed[0].id === a && h.s.feed[0].cause === "wall" && h.s.feed[0].by === null, "feed: wall");
  assert(h.s.lastRoundWinner === b && h.s.roundWins[b] === 1, "survivor takes the round");
}
{
  // Own body.
  const h = start(2);
  const [a, b] = h.t.ids;
  toPlay(h);
  quiet(h);
  place(h, a, [[5, 5], [6, 5], [6, 6], [5, 6], [4, 6], [4, 7]], "left");
  place(h, b, line(20, 15, "left"), "left");
  assert(turn(h, a, "down") === false && snakeOf(h, a).queue.join() === "down", "queued");
  tick(h);
  assert(!snakeOf(h, a).alive && h.s.feed[0].cause === "self", "own body kills");
}
{
  // Another snake's body.
  const h = start(3);
  const [a, b, c] = h.t.ids;
  toPlay(h);
  quiet(h);
  place(h, b, line(12, 10, "up", 5), "up");
  place(h, a, line(11, 12, "right"), "right");
  place(h, c, line(20, 18, "left"), "left");
  tick(h);
  assert(!snakeOf(h, a).alive && snakeOf(h, b).alive, "body hit kills the attacker only");
  assert(h.s.feed[0].cause === "snake" && h.s.feed[0].by === b, "feed: by b");
}
{
  // Head-on into the same cell: both die (2 players -> draw).
  const h = start(2);
  const [a, b] = h.t.ids;
  toPlay(h);
  quiet(h);
  place(h, a, line(10, 5, "right"), "right");
  place(h, b, line(12, 5, "left"), "left");
  tick(h);
  assert(!snakeOf(h, a).alive && !snakeOf(h, b).alive, "head-on kills both");
  assert(h.s.feed.every((f) => f.cause === "head") && h.s.feed.find((f) => f.id === a)?.by === b, "feed: head-on");
  assert(phaseOf(h) === "roundOver" && h.s.lastRoundWinner === null && h.s.roundReason === "crash", "draw");
  assert(Object.values(h.s.roundWins).every((x) => x === 0), "nobody scores a draw");
}
{
  // Heads swapping places also counts as head-on.
  const h = start(2);
  const [a, b] = h.t.ids;
  toPlay(h);
  quiet(h);
  place(h, a, line(10, 5, "right"), "right");
  place(h, b, line(11, 5, "left"), "left");
  tick(h);
  assert(!snakeOf(h, a).alive && !snakeOf(h, b).alive, "swap kills both");
  assert(h.s.feed.every((f) => f.cause === "head"), "swap is head-on");
}
{
  // Chasing your own tail is fine: the tail moves away this tick.
  const h = start(2);
  const [a, b] = h.t.ids;
  toPlay(h);
  quiet(h);
  place(h, a, [[5, 5], [6, 5], [6, 6], [5, 6]], "left");
  place(h, b, line(20, 15, "left"), "left");
  turn(h, a, "down");
  turn(h, a, "right");
  turn(h, a, "up");
  for (let i = 0; i < 3; i++) {
    tick(h);
    assert(snakeOf(h, a).alive, `tail chase tick ${i}`);
  }
  assert(snakeOf(h, a).body.slice().sort().join() === [at(h, 5, 5), at(h, 6, 5), at(h, 6, 6), at(h, 5, 6)].sort().join(), "looping in place");
}
{
  // ...unless you're growing, then the tail stays.
  const h = start(2);
  const [a, b] = h.t.ids;
  toPlay(h);
  quiet(h);
  place(h, a, [[5, 5], [6, 5], [6, 6], [5, 6]], "left", 1);
  place(h, b, line(20, 15, "left"), "left");
  turn(h, a, "down");
  tick(h);
  assert(!snakeOf(h, a).alive && h.s.feed[0].cause === "self", "growing tail blocks");
}
{
  // Another snake's departing tail is free; a growing one isn't.
  for (const grow of [0, 1]) {
    const h = start(3);
    const [a, b, c] = h.t.ids;
    toPlay(h);
    quiet(h);
    place(h, b, line(10, 8, "up"), "up", grow); // tail at (10, 11)
    place(h, a, line(9, 11, "right"), "right");
    place(h, c, line(25, 18, "left"), "left");
    tick(h);
    assert(snakeOf(h, a).alive === (grow === 0), `departing tail (grow ${grow})`);
    assert(snakeOf(h, b).alive, "b unharmed");
  }
}
{
  // Two heads into the same freed tail cell: head-on, both die.
  const h = start(3);
  const [a, b, c] = h.t.ids;
  toPlay(h);
  quiet(h);
  place(h, b, line(10, 8, "up"), "up");
  place(h, a, line(9, 11, "right"), "right");
  place(h, c, line(11, 11, "left"), "left");
  tick(h);
  assert(!snakeOf(h, a).alive && !snakeOf(h, c).alive && snakeOf(h, b).alive, "both heads die");
  assert(phaseOf(h) === "roundOver" && h.s.lastRoundWinner === b, "b survives and wins");
}

// ---------- food ----------

{
  const h = start(2);
  const [a, b] = h.t.ids;
  toPlay(h);
  quiet(h);
  place(h, a, line(10, 5, "right"), "right");
  place(h, b, line(10, 15, "right"), "right");
  h.s.food.push(at(h, 11, 5));
  tick(h);
  const sa = snakeOf(h, a);
  assert(sa.grow === 1 && sa.body.length === 4 && lenOf(sa) === 5, "pellet = +1 (pending)");
  assert(!h.s.food.includes(at(h, 11, 5)), "pellet eaten");
  assert(h.s.food.length === h.s.snakes.length + 3, "food kept at players + 3");
  assert(viewOf(h, b).snakes.find((x) => x.id === a)?.len === 5, "view len includes pending growth");
  tick(h);
  assert(num(sa.body.length) === 5 && num(sa.grow) === 0, "grew by one");
  h.s.golden = at(h, 13, 5);
  tick(h);
  assert(h.s.golden === null && num(sa.grow) === GOLDEN_VALUE, "golden = +3");
  assert(h.s.goldenAt >= h.t.ctx.now() + 7000 && h.s.goldenAt <= h.t.ctx.now() + 9000, "next golden in ~8s");
  for (let i = 0; i < 3; i++) tick(h);
  assert(num(sa.body.length) === 8, "grew by three");
  assert(h.s.best[a] === 8 && h.s.best[b] === START_LEN, "best length tracked");
  // A pellet eaten when food is at the minimum gets replaced right away.
  const target = h.s.snakes.length + 3;
  h.s.food = h.s.food.slice(0, target - 1);
  h.s.food.push(stepCell(h.s, sa.body[0], sa.dir));
  tick(h);
  assert(h.s.food.length === target, "eaten pellet replaced");
  checkInvariants(h, "food");
}
{
  // Golden pellets show up ~8s into play, one at a time.
  const h = start(2, 11);
  toPlay(h);
  assert(h.s.golden === null, "no golden at the start");
  tick(h, 6900);
  assert(h.s.golden === null, "not before 7s");
  tick(h, 2200);
  assert(h.s.golden !== null, "golden after ~8s");
  const g = h.s.golden;
  tick(h, 9000);
  assert(h.s.golden === g, "only one golden pellet at a time");
  const v = viewOf(h, h.t.ids[0]);
  assert(v.golden?.[0] === g % h.s.w && v.golden?.[1] === Math.floor(g / h.s.w), "golden in the view");
}
{
  // Dead snakes burst into food: every second body cell.
  const h = start(3);
  const [a, b, c] = h.t.ids;
  toPlay(h);
  quiet(h);
  place(h, a, line(h.s.w - 1, 3, "right", 7), "right");
  place(h, b, line(10, 12, "left"), "left");
  place(h, c, line(10, 18, "left"), "left");
  const body = snakeOf(h, a).body.slice();
  const before = h.s.food.length;
  tick(h);
  assert(!snakeOf(h, a).alive, "crashed");
  assert(h.s.food.length === before + 4, `4 pellets from a 7-long snake (got ${h.s.food.length - before})`);
  body.forEach((cell, j) => assert(h.s.food.includes(cell) === (j % 2 === 0), `pellet pattern at ${j}`));
  // The view keeps the body briefly for a death flash, then drops it.
  const ghost = viewOf(h, b).snakes.find((x) => x.id === a)!;
  assert(!ghost.alive && ghost.body.length === 14 && ghost.diedAt === h.t.ctx.now(), "ghost in view");
  tick(h, GHOST_MS);
  assert(viewOf(h, b).snakes.find((x) => x.id === a)!.body.length === 0, "ghost gone after the flash");
}

// ---------- turn queue ----------

{
  const h = start(2);
  const [a] = h.t.ids;
  const sn = snakeOf(h, a);
  const d0 = sn.dir;
  const p = perp(d0);
  assert(turn(h, a, OPPOSITE[d0]) === false && num(sn.queue.length) === 0, "reversal ignored");
  assert(turn(h, a, d0) === false && num(sn.queue.length) === 0, "same direction ignored");
  assert(turn(h, a, p) === false && sn.queue.join() === p, "turn queued during the countdown (no broadcast)");
  assert(turn(h, a, p) === false && num(sn.queue.length) === 1, "duplicate of the last queued ignored");
  assert(turn(h, a, OPPOSITE[p]) === false && num(sn.queue.length) === 1, "reversal of the last queued ignored");
  turn(h, a, d0);
  turn(h, a, p);
  assert(sn.queue.join() === [p, d0, p].join(), "three queued");
  turn(h, a, d0);
  turn(h, a, OPPOSITE[d0]);
  assert(num(sn.queue.length) === 3, "queue capped at three");
  toPlay(h);
  assert(num(sn.queue.length) === 3 && dirOf(sn) === d0, "countdown doesn't consume turns");
  const head = sn.body[0];
  tick(h);
  assert(dirOf(sn) === p && num(sn.queue.length) === 2 && sn.body[0] === stepCell(h.s, head, p), "one turn per tick");
  tick(h);
  assert(dirOf(sn) === d0 && num(sn.queue.length) === 1, "second turn");
  tick(h);
  assert(dirOf(sn) === p && num(sn.queue.length) === 0, "third turn");
}

// ---------- hostile and invalid actions ----------

{
  const h = start(3);
  const [a, b, c] = h.t.ids;
  const huge = "up".repeat(50_000);
  const bad: unknown[] = [
    null,
    undefined,
    0,
    42,
    NaN,
    "turn",
    "up",
    true,
    [],
    ["turn", "up"],
    [{ type: "turn", dir: "up" }],
    {},
    { type: "turn" },
    { dir: "up" },
    { type: "TURN", dir: "up" },
    { type: ["turn"], dir: "up" },
    { type: "turn", dir: "UP" },
    { type: "turn", dir: " up" },
    { type: "turn", dir: 1 },
    { type: "turn", dir: null },
    { type: "turn", dir: ["up"] },
    { type: "turn", dir: { up: 1 } },
    { type: "turn", dir: huge },
    { type: "turn", dir: "__proto__" },
    { type: "turn", dir: "constructor" },
    { type: "turn", dir: "toString" },
    Object.create(null),
    JSON.parse('{"type":"turn","__proto__":{"dir":"up"}}'),
  ];
  const before = JSON.stringify(h.s);
  for (const x of bad) {
    let r: unknown;
    try {
      r = act(h, a, x);
    } catch (e) {
      throw new Error(`action threw on ${JSON.stringify(x)?.slice(0, 40)}: ${e}`);
    }
    assert(r === false, `rejects ${JSON.stringify(x)?.slice(0, 40)}`);
  }
  const valid = perp(snakeOf(h, a).dir);
  assert(act(h, "stranger", { type: "turn", dir: valid }) === false, "non-participant rejected");
  assert(act(h, "spectator", { type: "turn", dir: valid }) === false, "spectator rejected");
  assert(JSON.stringify(h.s) === before, "no state change from junk");

  toPlay(h);
  finishPlay(h, b); // a and c crash
  assert(phaseOf(h) === "roundOver", "round over");
  assert(turn(h, b, perp(snakeOf(h, b).dir)) === false && snakeOf(h, b).queue.length === 0, "no turns between rounds");
  assert(turn(h, a, "up") === false, "dead snake can't turn");
  h.t.advance(ROUND_OVER_MS);
  game.tick!(h.s, h.t.ctx);
  toPlay(h);
  const sc = snakeOf(h, c);
  disconnect(h, c);
  assert(turn(h, c, perp(sc.dir)) === false && sc.queue.length === 0, "dead (left) snake can't turn");
}

// ---------- secrecy: queued turns never leave the server; everyone sees the same thing ----------

{
  const h = start(3);
  const [a, b] = h.t.ids;
  toPlay(h);
  const v0 = JSON.stringify(viewOf(h, b));
  const spec0 = JSON.stringify(viewOf(h, "spectator"));
  assert(JSON.stringify(viewOf(h, a)) === v0 && spec0 === v0, "all viewers get the same view");
  const sn = snakeOf(h, a);
  turn(h, a, perp(sn.dir));
  assert(sn.queue.length === 1, "queued");
  assert(JSON.stringify(viewOf(h, b)) === v0, "other players can't see a queued turn");
  assert(JSON.stringify(viewOf(h, "spectator")) === spec0, "spectators can't either");
  const fresh = JSON.stringify(buildView(h.s, h.t.ctx.now()));
  assert(fresh === v0, "the queue isn't part of the view at all");
  for (const key of ["queue", "spawn", "spawnDir", "away", "grow", "goldenAt", "rev"]) {
    assert(!fresh.includes(`"${key}"`), `view leaks ${key}`);
  }
  assertPlain(viewOf(h, b));
}

// ---------- disconnects: countdown ----------

{
  const h = start(3);
  const [a, b, c] = h.t.ids;
  const spawn = snakeOf(h, b).body.slice();
  disconnect(h, b);
  assert(!snakeOf(h, b).alive && snakeOf(h, b).away, "pulled off the board");
  assert(!viewOf(h, a).snakes.some((x) => x.id === b), "sits out: not in the view");
  assert(h.s.feed.length === 0, "no death in the feed for a countdown drop");
  reconnect(h, b);
  assert(snakeOf(h, b).alive && snakeOf(h, b).body.join() === spawn.join(), "back on its spawn during the countdown");
  assert(viewOf(h, a).snakes.find((x) => x.id === b)?.body.length === START_LEN * 2, "back in the view");
  disconnect(h, b);
  toPlay(h);
  assert(h.s.snakes.filter((sn) => sn.alive).length === 2, "round starts without them");
  reconnect(h, b);
  assert(!snakeOf(h, b).alive, "no snake mid-round");
  assert(!viewOf(h, c).snakes.some((x) => x.id === b), "still sitting out in the view");
  finishPlay(h, a);
  assert(h.s.lastRoundWinner === a, "a wins");
  h.t.advance(ROUND_OVER_MS);
  game.tick!(h.s, h.t.ctx);
  assert(h.s.round === 2 && snakeOf(h, b)?.alive, "back next round");
  assert(snakeOf(h, c).alive, "c too");
}
{
  // Two players, one drops during the countdown and stays away: the other takes the round, then wins by forfeit.
  const h = start(2);
  const [a, b] = h.t.ids;
  disconnect(h, b);
  h.t.advance(COUNTDOWN_MS);
  assert(game.tick!(h.s, h.t.ctx) === true, "transition broadcasts");
  assert(phaseOf(h) === "roundOver" && h.s.lastRoundWinner === a, "round goes to the one still here");
  h.t.advance(ROUND_OVER_MS);
  assert(game.tick!(h.s, h.t.ctx) === true && phaseOf(h) === "roundOver", "break held open for them");
  assert(viewOf(h, a).waiting === true, "view says we're waiting");
  h.t.advance(REJOIN_MS);
  game.tick!(h.s, h.t.ctx);
  assert(phaseOf(h) === "final" && h.ends.length === 1, "match over");
  assert(h.t.result?.winners.join() === a, "forfeit winner");
  assert(h.t.result?.headline === "Player0 wins Snake Brawl: everyone else left", h.t.result?.headline);
}

// ---------- disconnects: play ----------

{
  const h = start(3);
  const [a, b, c] = h.t.ids;
  toPlay(h);
  quiet(h);
  const sb = snakeOf(h, b);
  const len = sb.body.length;
  const body = sb.body.slice();
  const food = h.s.food.length;
  disconnect(h, b);
  assert(!sb.alive && h.s.feed.at(-1)?.cause === "left" && h.s.feed.at(-1)?.id === b, "dies immediately");
  assert(h.s.food.length === food + Math.ceil(len / 2), "leaves food behind");
  assert(viewOf(h, a).snakes.find((x) => x.id === b)?.body.length === body.length * 2, "death flash in the view");
  assert(phaseOf(h) === "play", "two snakes left: keep playing");
  reconnect(h, b);
  assert(!sb.alive, "no respawn mid-round");
  tick(h);
  checkInvariants(h, "after leave");
  finishPlay(h, c);
  h.t.advance(ROUND_OVER_MS);
  game.tick!(h.s, h.t.ctx);
  assert(snakeOf(h, b).alive && h.s.snakes.length === 3, "reconnected player gets a snake next round");
}
{
  // Last opponent leaves mid-round: the survivor takes it; at 2 wins the match ends right there.
  const h = start(2);
  const [a, b] = h.t.ids;
  forceRound(h, a);
  toPlayFromRoundOver(h);
  disconnect(h, b);
  assert(phaseOf(h) === "final" && h.ends.length === 1 && h.t.result?.winners.join() === a, "ends on the spot");
  assert(h.t.result?.headline === "Player0 wins Snake Brawl 2–0", h.t.result?.headline);
}
{
  // Everyone leaves mid-round: the round ends, then the match ends instead of stalling.
  const h = start(3);
  toPlay(h);
  for (const id of h.t.ids) disconnect(h, id);
  assert(phaseOf(h) === "roundOver", "round ends");
  h.t.advance(ROUND_OVER_MS);
  game.tick!(h.s, h.t.ctx);
  assert(phaseOf(h) === "roundOver" && h.ends.length === 0, "waits a moment for someone to come back");
  for (let i = 0; i < REJOIN_MS / TICK_MS + 2; i++) tick(h);
  assert(phaseOf(h) === "final" && num(h.ends.length) === 1, "match ends when nobody is left");
}

// ---------- disconnects: round over and final ----------

{
  const h = start(3);
  const [a, b, c] = h.t.ids;
  forceRound(h, a);
  disconnect(h, c);
  assert(phaseOf(h) === "roundOver", "nothing happens until the next round");
  h.t.advance(ROUND_OVER_MS);
  game.tick!(h.s, h.t.ctx);
  assert(phaseOf(h) === "countdown" && h.s.snakes.length === 2 && !h.s.snakes.some((sn) => sn.id === c), "next round without c");
  assert(h.s.food.length === 2 + 3, "food sized for the snakes in play");
  reconnect(h, c);
  assert(!h.s.snakes.some((sn) => sn.id === c), "c waits for the next round");
  forceRound(h, b);
  h.t.advance(ROUND_OVER_MS);
  game.tick!(h.s, h.t.ctx);
  assert(num(h.s.snakes.length) === 3 && snakeOf(h, c).alive, "c is back");
  // Drop during the final screen: harmless.
  toPlay(h);
  finishPlay(h, a);
  assert(phaseOf(h) === "final" && h.ends.length === 1, "a wins 2-1");
  disconnect(h, a);
  reconnect(h, a);
  disconnect(h, b);
  assert(tick(h) === false && h.ends.length === 1, "final is stable");
}
{
  // Two players, one drops between rounds: forfeit.
  const h = start(2);
  const [a, b] = h.t.ids;
  forceRound(h, b);
  disconnect(h, b);
  h.t.advance(ROUND_OVER_MS);
  game.tick!(h.s, h.t.ctx);
  assert(phaseOf(h) === "roundOver" && h.ends.length === 0, "no instant forfeit");
  h.t.advance(REJOIN_MS - 1);
  assert(game.tick!(h.s, h.t.ctx) === false && phaseOf(h) === "roundOver", "still waiting just before the grace runs out");
  h.t.advance(1);
  game.tick!(h.s, h.t.ctx);
  assert(phaseOf(h) === "final" && h.t.result?.winners.join() === a, "forfeit to the player still here");
  assert(num(h.ends.length) === 1, "ctx.end exactly once");
  for (let i = 0; i < 5; i++) tick(h);
  assert(num(h.ends.length) === 1, "stays ended");
}
{
  // Regression: a quick page refresh between rounds used to end a 2-player match on the spot
  // (handing it to the player who was behind). Now the break waits, and play resumes when they're back.
  const h = start(2);
  const [a, b] = h.t.ids;
  forceRound(h, b); // b leads 1-0
  disconnect(h, b);
  h.t.advance(ROUND_OVER_MS);
  game.tick!(h.s, h.t.ctx);
  assert(phaseOf(h) === "roundOver" && viewOf(h, a).waiting, "holding the break");
  const giveUp = h.s.endsAt;
  assert(giveUp === h.t.ctx.now() + REJOIN_MS, "view counts down to the give-up time");
  h.t.advance(2_000);
  assert(game.tick!(h.s, h.t.ctx) === false, "nothing to broadcast while waiting");
  reconnect(h, b);
  assert(game.tick!(h.s, h.t.ctx) === true, "next tick notices they're back");
  assert(phaseOf(h) === "countdown" && h.s.round === 2 && h.s.snakes.length === 2, "round 2 starts with both");
  assert(!viewOf(h, a).waiting && h.ends.length === 0, "match goes on");
  assert(h.s.roundWins[b] === 1, "b keeps the lead");
  // The grace is per break: the next drop gets a fresh one.
  forceRound(h, a);
  disconnect(h, a);
  h.t.advance(ROUND_OVER_MS);
  game.tick!(h.s, h.t.ctx);
  assert(phaseOf(h) === "roundOver" && h.s.endsAt === h.t.ctx.now() + REJOIN_MS, "fresh grace");
  h.t.advance(REJOIN_MS);
  game.tick!(h.s, h.t.ctx);
  assert(phaseOf(h) === "final" && h.t.result?.winners.join() === b && num(h.ends.length) === 1, "forfeit after the grace");
}
{
  // Three players, one drops between rounds: two are still here, so no waiting at all.
  const h = start(3);
  const [a, , c] = h.t.ids;
  forceRound(h, a);
  disconnect(h, c);
  h.t.advance(ROUND_OVER_MS);
  game.tick!(h.s, h.t.ctx);
  assert(phaseOf(h) === "countdown" && !viewOf(h, a).waiting, "carries straight on");
}

// ---------- fuzz: random play at min, mid and max sizes; invariants, cache, termination, view size ----------

// [players, seed, chance of a random turn per tick, chance of no input]
const timedOut: string[] = [];
for (const [n, seed, wild, idle] of [
  [2, 1, 0.15, 0.05],
  [3, 2, 0.15, 0.05],
  [5, 3, 0.15, 0.05],
  [8, 4, 0.15, 0.05],
  [8, 5, 0.15, 0.05],
  [4, 6, 0, 0],
] as const) {
  const h = start(n, seed);
  let r = seed * 7919 + 1;
  const rand = () => {
    r = (r * 1103515245 + 12345) % 2147483648;
    return r / 2147483648;
  };
  let maxView = 0;
  let steps = 0;
  const sameView = (label: string) => {
    const cached = JSON.stringify(game.view(h.s, h.t.ids[0], h.t.ctx));
    assert(cached === JSON.stringify(buildView(h.s, h.t.ctx.now())), `${label}: stale cached view`);
    assert(JSON.stringify(game.view(h.s, "spectator", h.t.ctx)) === cached, `${label}: spectator view differs`);
    maxView = Math.max(maxView, cached.length);
  };
  for (; steps < 9000 && phaseOf(h) !== "final"; steps++) {
    for (const id of h.t.ids) {
      const x = rand();
      if (x < wild) act(h, id, { type: "turn", dir: DIRS[Math.floor(rand() * 4)] });
      else if (x < 1 - idle) {
        const d = safeDir(h, id);
        if (d) turn(h, id, d);
      }
    }
    if (rand() < 0.003) {
      const id = h.t.ids[Math.floor(rand() * n)];
      const rev = h.s.rev;
      if (h.t.ctx.player(id)!.connected) disconnect(h, id);
      else reconnect(h, id);
      if (h.s.rev !== rev) sameView(`fuzz ${n} connection`);
    }
    const changed = tick(h);
    checkInvariants(h, `fuzz n=${n} step ${steps}`);
    if (changed) sameView(`fuzz ${n} step ${steps}`);
  }
  assert(phaseOf(h) === "final", `fuzz n=${n}: game finished (${steps} ticks)`);
  assert(h.ends.length === 1, `fuzz n=${n}: ended exactly once`);
  assert(maxView < 12_000, `fuzz n=${n}: view stays small (${maxView} bytes)`);
  assertPlain(viewOf(h, "spectator"));
  timedOut.push(...h.s.history.filter((r) => r.reason === "time" || r.reason === "tie").map((r) => r.reason));
}
assert(timedOut.length > 0, "careful bots reach the 90s timer");

function toPlayFromRoundOver(h: H) {
  h.t.advance(h.s.endsAt - h.t.ctx.now());
  game.tick!(h.s, h.t.ctx);
  toPlay(h);
}

console.log("snakes: all tests passed");
