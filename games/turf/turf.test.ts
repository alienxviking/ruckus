import { assert, makeTestCtx } from "../../shared/testing";
import type { GameResult } from "../../shared/types";
import game, {
  ABANDON_MS,
  fillEnclosed,
  homeSpots,
  paint,
  KEYFRAME_MS,
  type PowerUp,
  type TurfDelta,
  type TurfEvent,
  type TurfInputEcho,
  type TurfKeyframe,
  type TurfState,
  type TurfView,
} from "./server";
import { BOMB_RADIUS, COUNTDOWN_MS, DASH_MS, FREEZE_MS, MAX_HOLD, PLAY_MS, TICK_MS, boardSize, type Dir } from "./shared";
import { TurfPredictor } from "./predict";
import { applyDelta, hear, isTurfWire, nothingHeard, rebuild, type Heard } from "./delta";

// ---------- helpers ----------

type Harness = ReturnType<typeof makeTestCtx>;
const FOREVER = Number.MAX_SAFE_INTEGER;
/** `assert` without TypeScript narrowing: state keeps mutating between checks. */
const check = (cond: unknown, msg: string): void => assert(cond, msg);
const tick = (t: Harness, s: TurfState, ms = TICK_MS) => {
  t.advance(ms);
  return game.tick!(s, t.ctx);
};
const view = (s: TurfState, viewer: string, t: Harness) => game.view(s, viewer, t.ctx) as TurfView;
const snap = (s: TurfState) => JSON.stringify(s);
const at = (s: TurfState, x: number, y: number) => s.tiles[y * s.w + x];
const events = (t: Harness, type: TurfEvent["type"]) =>
  t.events.map((e) => e.event as TurfEvent).filter((e) => e.type === type);

/** Count every ctx.end call (the harness itself only keeps the first). */
function countEnds(t: Harness) {
  const calls: GameResult[] = [];
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    calls.push(r);
    end(r);
  };
  return calls;
}

function newGame(n: number, seed = 42) {
  const t = makeTestCtx(n, seed);
  const ends = countEnds(t);
  const s: TurfState = game.setup(t.ctx);
  return { t, s, ends };
}

/** Countdown over, play running. No random power-ups unless asked. */
function playing(n: number, seed = 42, powers = false) {
  const g = newGame(n, seed);
  tick(g.t, g.s, COUNTDOWN_MS);
  check(g.s.phase === "play", "countdown should give way to play");
  if (!powers) g.s.nextSpawnAt = FOREVER;
  return g;
}

/** Wipe the board so a test can build an exact position. */
function clearBoard(s: TurfState) {
  for (let i = 0; i < s.tiles.length; i++) paint(s, i, -1);
  s.powers = [];
}

function own(s: TurfState, who: number, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) paint(s, y * s.w + x, who);
}

function place(s: TurfState, who: number, x: number, y: number, dir: Dir) {
  const p = s.painters[who];
  p.x = x;
  p.y = y;
  p.dir = ["up", "right", "down", "left"].indexOf(dir);
  p.queue = [];
  p.out = 0;
}

/** Freeze everyone except `who` so only one painter moves. */
function solo(s: TurfState, who: number) {
  s.painters.forEach((p, i) => {
    if (i !== who) p.frozenUntil = FOREVER;
  });
}

const DIR_OF: Record<string, Dir> = { U: "up", R: "right", D: "down", L: "left" };
/** Steer painter `who` one tick per letter (U/R/D/L). */
function drive(t: Harness, s: TurfState, who: number, moves: string) {
  for (const ch of moves) {
    game.action(s, s.painters[who].id, { type: "turn", dir: DIR_OF[ch] }, t.ctx);
    tick(t, s);
  }
}

function checkInvariants(s: TurfState, label: string) {
  const counts = s.painters.map(() => 0);
  for (const o of s.tiles) {
    check(Number.isInteger(o) && o >= -1 && o < s.painters.length, `${label}: bad owner ${o}`);
    if (o >= 0) counts[o] += 1;
  }
  s.painters.forEach((p, i) => {
    check(p.count === counts[i], `${label}: count drift for painter ${i} (${p.count} vs ${counts[i]})`);
    check(p.x >= 0 && p.y >= 0 && p.x < s.w && p.y < s.h, `${label}: painter ${i} out of bounds`);
    check(p.queue.length <= 2, `${label}: queue too deep`);
  });
  check(s.powers.length <= 3, `${label}: too many power-ups`);
}

// ---------- setup ----------

for (const n of [2, 3, 4, 5, 6, 7, 8]) {
  const { t, s } = newGame(n, 7 + n);
  const { w, h } = boardSize(n);
  check(s.w === w && s.h === h, `board size for ${n}`);
  check(n <= 4 ? w === 40 && h === 26 : w === 48 && h === 32, `spec board size for ${n}`);
  check(s.phase === "countdown" && s.endsAt === t.ctx.now() + COUNTDOWN_MS, "starts with a 3s countdown");
  check(s.painters.length === n, "one painter per player");
  for (const [i, p] of s.painters.entries()) {
    check(p.count === 9, `painter ${i} starts with a 3x3 patch`);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) check(at(s, p.x + dx, p.y + dy) === i, "patch is theirs");
    for (const [j, q] of s.painters.entries()) {
      if (i !== j) check(Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)) >= 4, `patches ${i}/${j} must not touch`);
    }
  }
  const v = view(s, t.ids[0], t);
  check(v.tiles.length === w * h && /^[.0-7]+$/.test(v.tiles), "tile string is w*h of . and digits");
  check(v.tiles.replace(/\./g, "").length === 9 * n, "only home patches painted");
  check(v.you === 0 && view(s, "spectator", t).you === -1, "you index");
}

// Mirrored spots stay mirrored (fairness), and everyone faces inwards.
{
  const [a, b] = homeSpots(2, 40, 26);
  check(a.y === b.y && a.x + b.x === 39, "two players are mirror images");
  check((a.x < 20 ? a.dir === 1 : a.dir === 3) && (b.x < 20 ? b.dir === 1 : b.dir === 3), "facing the middle");
  const four = homeSpots(4, 40, 26);
  const xs = four.map((p) => p.x).sort((m, n) => m - n);
  check(xs[0] + xs[3] === 39 && xs[1] + xs[2] === 39, "four players are symmetric");
}

// More than 8 participants: extra players are not painters (owner digits only go to 7).
{
  const t = makeTestCtx(10);
  const s: TurfState = game.setup(t.ctx);
  check(s.painters.length === 8, "capped at 8 painters");
  check(game.action(s, t.ids[9], { type: "turn", dir: "up" }, t.ctx) === false, "player 9 cannot act");
  check(view(s, t.ids[9], t).you === -1, "player 9 watches");
}

// ---------- countdown ----------
{
  const { t, s } = newGame(3);
  const start = s.painters.map((p) => [p.x, p.y]);
  const seq0 = s.seq;
  check(!tick(t, s), "quiet countdown tick broadcasts nothing");
  // Aim during the countdown: applied immediately, broadcast by the next tick.
  const p0 = s.painters[0];
  const want: Dir = p0.dir === 0 ? "down" : "up";
  check(game.action(s, t.ids[0], { type: "turn", dir: want }, t.ctx) === false, "turn never forces a broadcast");
  check(p0.dir === (want === "up" ? 0 : 2) && p0.queue.length === 0, "countdown turn sets direction directly");
  check(tick(t, s) === true && s.seq === seq0 + 1, "next tick broadcasts the new aim");
  check(!tick(t, s), "and only once");
  check(game.action(s, t.ids[0], { type: "turn", dir: want }, t.ctx) === false && !tick(t, s), "same aim is a no-op");
  // Nobody moves before the start.
  t.advance(s.endsAt - t.ctx.now() - 1);
  game.tick!(s, t.ctx);
  check(s.phase === "countdown", "still counting down 1ms before the end");
  check(s.painters.every((p, i) => p.x === start[i][0] && p.y === start[i][1]), "no movement in countdown");
  check(tick(t, s, 1) === true && s.phase === "play", "countdown -> play exactly on time");
  check(s.endsAt === t.ctx.now() + PLAY_MS, "60s of play");
  check(s.painters.every((p, i) => p.x === start[i][0] && p.y === start[i][1]), "the switch tick doesn't move anyone");
  tick(t, s);
  check(p0.x === start[0][0] && p0.y === start[0][1] + (want === "up" ? -1 : 1), "moves in the aimed direction");
}

// ---------- movement, painting, walls, queue ----------
{
  const { t, s } = playing(2);
  clearBoard(s);
  solo(s, 0);
  own(s, 0, 5, 5, 7, 7);
  place(s, 0, 6, 6, "right");
  const p = s.painters[0];
  tick(t, s);
  check(p.x === 7 && p.y === 6 && p.out === 0, "own tile: no new paint");
  tick(t, s);
  check(p.x === 8 && at(s, 8, 6) === 0 && p.out === 1 && p.count === 10, "new tile painted");

  // Wall: run into the right edge, stop, then resume after turning.
  place(s, 0, s.w - 3, 2, "right");
  tick(t, s);
  tick(t, s);
  check(p.x === s.w - 1, "reached the wall");
  const board = () => JSON.stringify([s.tiles, s.painters]);
  const stuck = board();
  check(tick(t, s) === false && board() === stuck, "stopped at the wall, nothing broadcast");
  game.action(s, t.ids[0], { type: "turn", dir: "down" }, t.ctx);
  tick(t, s);
  check(p.x === s.w - 1 && p.y === 3, "resumes when turned");

  // 2-deep queue: both turns apply on consecutive steps; reversal is allowed.
  place(s, 0, 20, 10, "right");
  game.action(s, t.ids[0], { type: "turn", dir: "up" }, t.ctx);
  game.action(s, t.ids[0], { type: "turn", dir: "left" }, t.ctx);
  check(p.queue.map((q) => q.d).join() === "0,3", "two turns queued");
  tick(t, s);
  check(p.x === 20 && p.y === 9, "first queued turn");
  tick(t, s);
  check(p.x === 19 && p.y === 9, "second queued turn");
  game.action(s, t.ids[0], { type: "turn", dir: "right" }, t.ctx);
  tick(t, s);
  check(p.x === 20 && p.y === 9, "instant reversal");
  // Dedupe and overflow.
  game.action(s, t.ids[0], { type: "turn", dir: "right" }, t.ctx);
  check(p.queue.length === 0, "same direction is not queued");
  game.action(s, t.ids[0], { type: "turn", dir: "up" }, t.ctx);
  game.action(s, t.ids[0], { type: "turn", dir: "up" }, t.ctx);
  check(p.queue.map((q) => q.d).join() === "0", "repeat of the last queued turn ignored");
  game.action(s, t.ids[0], { type: "turn", dir: "left" }, t.ctx);
  game.action(s, t.ids[0], { type: "turn", dir: "down" }, t.ctx);
  check(p.queue.map((q) => q.d).join() === "0,2", "third input replaces the second");
  game.action(s, t.ids[0], { type: "turn", dir: "up" }, t.ctx);
  check(p.queue.map((q) => q.d).join() === "0", "replacing with the first collapses the queue");
}

// Players pass through each other and can repaint each other's turf.
{
  const { t, s } = playing(2);
  clearBoard(s);
  own(s, 0, 2, 2, 4, 4);
  own(s, 1, 10, 2, 12, 4);
  place(s, 0, 4, 3, "right");
  place(s, 1, 10, 3, "left");
  for (let i = 0; i < 6; i++) tick(t, s);
  check(s.painters[0].x === 10 && s.painters[1].x === 4, "they crossed");
  check(at(s, 10, 3) === 0 && at(s, 4, 3) === 1, "each repainted the other's home tile");
  check(at(s, 9, 3) === 0 && at(s, 5, 3) === 1, "and the other's fresh trail");
  checkInvariants(s, "pass-through");
}

// ---------- loop fill ----------
{
  const { t, s } = playing(2);
  clearBoard(s);
  solo(s, 0);
  own(s, 0, 5, 5, 7, 7);
  own(s, 1, 9, 7, 9, 7); // an opponent tile that ends up inside the loop
  own(s, 1, 30, 20, 32, 22); // and some turf far away
  place(s, 0, 7, 6, "right");
  drive(t, s, 0, "RRRDDDLLLL");
  check(s.painters[0].out === 10 && events(t, "capture").length === 0, "no capture while the loop is open");
  drive(t, s, 0, "U");
  check(s.painters[0].out === 11, "still outside");
  const before0 = s.painters[0].count;
  const before1 = s.painters[1].count;
  drive(t, s, 0, "U"); // back onto (6,7): own turf -> fill
  const caps = events(t, "capture");
  check(caps.length === 1, "one capture event");
  const cap = caps[0] as Extract<TurfEvent, { type: "capture" }>;
  check(cap.by === 0 && cap.n === 5, `captured the 5 enclosed tiles (got ${cap.n})`);
  for (const [x, y] of [[8, 7], [9, 7], [8, 8], [9, 8], [7, 8]]) check(at(s, x, y) === 0, `(${x},${y}) filled`);
  check(s.painters[0].count === before0 + 5 && s.painters[1].count === before1 - 1, "opponent tile stolen");
  check(cap.x > 7 && cap.x < 10 && cap.y > 6 && cap.y < 9, "event points at the captured area");
  check(s.painters[0].out === 0, "loop closed");
  checkInvariants(s, "fill");
  // Walking around inside your own turf never fills.
  drive(t, s, 0, "RR");
  check(events(t, "capture").length === 1, "no fill while out === 0");
}

// Clients interpolate between frames by movement step: the view carries the step number,
// and capture/power events name the step that caused them (so pops can wait for it on screen).
{
  const { t, s } = playing(2);
  const v0 = view(s, s.painters[0].id, t);
  check(v0.tick === 0, "no steps yet when play begins");
  clearBoard(s);
  solo(s, 0);
  own(s, 0, 5, 5, 7, 7);
  place(s, 0, 7, 6, "right");
  drive(t, s, 0, "RRDDLLL");
  check(view(s, "spectator", t).tick === 7, "one step per tick");
  drive(t, s, 0, "U"); // back onto own turf: fill
  const cap = events(t, "capture").at(-1) as Extract<TurfEvent, { type: "capture" }> | undefined;
  check(cap !== undefined && cap.tick === 8 && view(s, "spectator", t).tick === 8, "capture event names the step it happened on");
  s.powers = [{ x: s.painters[0].x, y: s.painters[0].y - 1, kind: "dash" }];
  drive(t, s, 0, "U");
  const pw = events(t, "power").at(-1) as Extract<TurfEvent, { type: "power" }> | undefined;
  check(pw !== undefined && pw.tick === 9, "power event names its step too");
  const before = view(s, "spectator", t).tick;
  tick(t, s, PLAY_MS);
  check(s.phase === "over" && view(s, "spectator", t).tick === before, "the final whistle is not a movement step");
}

// A pocket that touches the board edge is not enclosed... until the edge row is yours too.
{
  const { t, s } = playing(2);
  clearBoard(s);
  solo(s, 0);
  own(s, 0, 1, 1, 3, 3);
  place(s, 0, 3, 2, "right");
  drive(t, s, 0, "RRRUU"); // (4..6,2) then (6,1),(6,0): a wall from the turf up to the top edge
  drive(t, s, 0, "D");
  check(s.painters[0].y === 1 && events(t, "capture").length === 0, "reversing onto your own trail with nothing enclosed: no capture");
  check(at(s, 4, 1) === -1 && at(s, 5, 1) === -1, "edge pocket stays open");
  drive(t, s, 0, "ULLLD"); // paint (5,0),(4,0),(3,0) along the edge, then step onto (3,1)
  const caps = events(t, "capture") as Extract<TurfEvent, { type: "capture" }>[];
  check(caps.length === 1 && caps[0].n === 2, "closing the edge row fills the pocket");
  check(at(s, 4, 1) === 0 && at(s, 5, 1) === 0, "pocket filled");
  checkInvariants(s, "edge pocket");
}

// fillEnclosed directly: enclosed remnants anywhere get captured; empty board -> null.
{
  const { s } = playing(2);
  clearBoard(s);
  check(fillEnclosed(s, 0) === null, "nothing to fill");
  own(s, 0, 10, 10, 14, 14);
  paint(s, 12 * s.w + 12, 1);
  paint(s, 11 * s.w + 11, -1);
  const got = fillEnclosed(s, 0);
  check(got !== null && got.n === 2 && at(s, 12, 12) === 0 && at(s, 11, 11) === 0, "ring interior captured");
  checkInvariants(s, "direct fill");
}

// ---------- power-ups ----------

// Spawning: first after ~2.5s, then every 5-7s, max 3, never next to a painter.
{
  const { t, s } = playing(4, 9, true);
  s.painters.forEach((p) => (p.frozenUntil = FOREVER)); // nobody picks anything up
  let maxSeen = 0;
  let firstAt = -1;
  for (let ms = 0; ms < 40_000; ms += TICK_MS) {
    tick(t, s);
    if (firstAt < 0 && s.powers.length) firstAt = ms;
    maxSeen = Math.max(maxSeen, s.powers.length);
    for (const q of s.powers) {
      for (const p of s.painters) check(Math.abs(p.x - q.x) + Math.abs(p.y - q.y) >= 3, "power-up spawned too close");
    }
  }
  check(firstAt >= 2_000 && firstAt <= 3_000, `first spawn after ~2.5s (got ${firstAt})`);
  check(maxSeen === 3, "caps at 3 on the board");
  const kinds = new Set(s.powers.map((q) => q.kind));
  check(kinds.size >= 1, "kinds are valid");
}

function withPower(kind: PowerUp["kind"], x: number, y: number) {
  const g = playing(3);
  clearBoard(g.s);
  own(g.s, 0, 10, 10, 12, 12);
  own(g.s, 1, 30, 5, 32, 7);
  own(g.s, 2, 30, 18, 32, 20);
  place(g.s, 0, 12, 11, "right");
  place(g.s, 1, 31, 6, "left");
  place(g.s, 2, 31, 19, "left");
  g.s.powers = [{ x, y, kind }];
  return g;
}

// Dash: two tiles per tick for 3s.
{
  const { t, s } = withPower("dash", 13, 11);
  const p = s.painters[0];
  tick(t, s);
  check(s.powers.length === 0 && p.dashUntil === t.ctx.now() + DASH_MS, "dash collected");
  const ev = events(t, "power")[0] as Extract<TurfEvent, { type: "power" }>;
  check(ev && ev.kind === "dash" && ev.by === 0, "power event");
  const x0 = p.x;
  tick(t, s);
  check(p.x === x0 + 2, "moves 2 tiles per tick while dashing");
  check(at(s, x0 + 1, 11) === 0 && at(s, x0 + 2, 11) === 0, "both tiles painted");
  t.advance(DASH_MS);
  const x1 = p.x;
  tick(t, s);
  check(p.x === x1 + 1, "back to normal speed after 3s");
}

// Dash steps take one queued turn each: a tight U-turn in a single tick.
{
  const { t, s } = withPower("dash", 13, 11);
  const p = s.painters[0];
  tick(t, s);
  game.action(s, t.ids[0], { type: "turn", dir: "down" }, t.ctx);
  game.action(s, t.ids[0], { type: "turn", dir: "left" }, t.ctx);
  const [x0, y0] = [p.x, p.y];
  tick(t, s);
  check(p.x === x0 - 1 && p.y === y0 + 1, "down then left within one dash tick");
}

// Bomb: paints a radius-2 diamond (13 tiles) and closes loops it completes.
{
  const { t, s } = withPower("bomb", 20, 11);
  const p = s.painters[0];
  place(s, 0, 19, 11, "right");
  p.out = 4;
  const before = p.count;
  tick(t, s);
  const ev = events(t, "power")[0] as Extract<TurfEvent, { type: "power" }>;
  check(ev.kind === "bomb" && ev.n === 13, `bomb paints 13 tiles (got ${ev.n})`);
  let diamond = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= BOMB_RADIUS && at(s, 20 + dx, 11 + dy) === 0) diamond++;
  }
  check(diamond === 13 && p.count === before + 13, "whole radius-2 diamond is painted");
  check(p.out === 0, "standing on turf after the blast");
  checkInvariants(s, "bomb");
}
// Bomb at a corner is clipped to the board.
{
  const { t, s } = withPower("bomb", 0, 0);
  place(s, 0, 1, 0, "left");
  tick(t, s);
  const ev = events(t, "power")[0] as Extract<TurfEvent, { type: "power" }>;
  check(ev.kind === "bomb" && ev.n === 6, `corner bomb paints 6 tiles (got ${ev.n})`);
  check([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [0, 2]].every(([x, y]) => at(s, x, y) === 0), "clipped diamond");
  checkInvariants(s, "corner bomb");
}
// Bomb that completes an enclosure fills it.
{
  const { t, s } = withPower("bomb", 20, 10);
  clearBoard(s);
  s.powers = [{ x: 20, y: 10, kind: "bomb" }];
  // A ring (18..24, 7..13) with a one-tile gap at (18,10). The painter plugs the gap
  // while walking in, but only stands on fresh tiles, so the blast is what fills it.
  own(s, 0, 18, 7, 24, 7);
  own(s, 0, 18, 13, 24, 13);
  own(s, 0, 24, 8, 24, 12);
  own(s, 0, 18, 8, 18, 9);
  own(s, 0, 18, 11, 18, 12);
  place(s, 0, 17, 10, "right");
  tick(t, s); // (18,10): new tile, ring closed
  tick(t, s); // (19,10): new tile
  check(events(t, "capture").length === 0, "no fill yet: never stepped on old turf");
  tick(t, s); // (20,10): bomb
  const caps = events(t, "capture");
  check(caps.length === 1, "blast closed the ring and filled it");
  for (let y = 8; y <= 12; y++) for (let x = 19; x <= 23; x++) check(at(s, x, y) === 0, `(${x},${y}) is inside and filled`);
  checkInvariants(s, "bomb fill");
}

// Freeze: every opponent stops for 1.5s, the collector keeps going.
{
  const { t, s } = withPower("freeze", 13, 11);
  const [a, b, c] = s.painters;
  const bx = b.x;
  const cx = c.x;
  tick(t, s); // everyone moved this tick; a collected the freeze
  check(b.frozenUntil === t.ctx.now() + FREEZE_MS && c.frozenUntil === b.frozenUntil && a.frozenUntil === 0, "opponents frozen");
  const ax = a.x;
  const [bx1, cx1] = [b.x, c.x];
  check(bx1 <= bx && cx1 <= cx, "they moved up to the freeze");
  game.action(s, b.id, { type: "turn", dir: "up" }, t.ctx);
  for (let i = 0; i < 12; i++) tick(t, s); // 1440ms
  check(b.x === bx1 && c.x === cx1 && b.y === 6 && a.x === ax + 12, "frozen painters stay put, collector moves");
  check(b.dir === 0, "frozen painters can still aim");
  tick(t, s);
  tick(t, s);
  check(b.y < 6 && c.x < cx1, "thawed after 1.5s");
}

// ---------- end of game ----------
for (const n of [2, 8]) {
  const { t, s, ends } = playing(n, 100 + n, true);
  let guard = 0;
  while (s.phase !== "over" && guard++ < 2_000) {
    // Wander around: a turn every few ticks.
    if (guard % 4 === 0) {
      for (const id of t.ids) game.action(s, id, { type: "turn", dir: (["up", "right", "down", "left"] as const)[Math.floor(t.ctx.random() * 4)] }, t.ctx);
    }
    tick(t, s);
    checkInvariants(s, `full game ${n}`);
  }
  check(s.phase === "over" && ends.length === 1, `game with ${n} ends once`);
  const result = t.result;
  assert(result, "result recorded");
  const scores = result.scores!;
  const best = Math.max(...Object.values(scores));
  check(result.winners.length >= 1 && result.winners.every((id) => scores[id] === best), "winners have the most tiles");
  s.painters.forEach((p) => check(scores[p.id] === p.count, "scores are tile counts"));
  const pct = Math.round((100 * best) / (s.w * s.h));
  check(result.headline.includes(`${pct}% of the map`), `headline has the share: ${result.headline}`);
  check(result.headline.includes(t.ctx.player(result.winners[0])!.name), "headline names the winner");
  const v = view(s, t.ids[0], t);
  check(v.phase === "over" && v.endReason === "time" && v.winners?.join() === result.winners.join(), "final view");
  check(v.powers.length === 0, "power-ups cleared at the end");
  // After the end: nothing moves, nothing is accepted, end is not called again.
  const frozen = snap(s);
  for (let i = 0; i < 15; i++) check(!tick(t, s), "no broadcasts after the end");
  check(game.action(s, t.ids[0], { type: "turn", dir: "up" }, t.ctx) === false && snap(s) === frozen, "actions ignored after end");
  game.playerLeft!(s, t.ids[1], t.ctx);
  game.playerReturned!(s, t.ids[1], t.ctx);
  check(snap(s) === frozen && ends.length === 1, "end called exactly once");
}

// Ending exactly on time, and a tie.
{
  const { t, s, ends } = playing(3);
  clearBoard(s);
  own(s, 0, 0, 0, 9, 9); // 100
  own(s, 1, 20, 0, 29, 9); // 100
  own(s, 2, 0, 15, 4, 19); // 25
  s.painters.forEach((p) => (p.frozenUntil = FOREVER));
  check(s.endsAt === t.ctx.now() + PLAY_MS, "play lasts 60s");
  t.advance(s.endsAt - t.ctx.now() - 1);
  game.tick!(s, t.ctx);
  check(s.phase === "play", "still playing 1ms before the end");
  tick(t, s, 1);
  check(s.phase === "over" && ends.length === 1, "time's up");
  check(t.result!.winners.length === 2 && t.result!.winners.includes(t.ids[0]) && t.result!.winners.includes(t.ids[1]), "tie: both win");
  check(/tie/.test(t.result!.headline) && t.result!.headline.includes("10% of the map"), t.result!.headline);
  check(t.result!.scores![t.ids[2]] === 25, "loser's score recorded");
}

// ---------- hostile input ----------
{
  const { t, s } = playing(3);
  const before = snap(s);
  const bad: unknown[] = [
    null,
    undefined,
    "turn",
    42,
    true,
    [],
    ["turn", "up"],
    {},
    { type: "turn" },
    { type: "Turn", dir: "up" },
    { type: "turn", dir: 0 },
    { type: "turn", dir: 1.5 },
    { type: "turn", dir: "UP" },
    { type: "turn", dir: " up" },
    { type: "turn", dir: "north" },
    { type: "turn", dir: null },
    { type: "turn", dir: {} },
    { type: "turn", dir: ["up"] },
    { type: "turn", dir: "up".repeat(50_000) },
    { type: "move", dir: "up" },
    { type: ["turn"], dir: "up" },
    JSON.parse('{"__proto__":{"type":"turn"},"dir":"up"}'),
  ];
  for (const a of bad) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    check(game.action(s, t.ids[0], a as any, t.ctx) === false, `rejected ${JSON.stringify(a)?.slice(0, 40)}`);
  }
  check(game.action(s, "stranger", { type: "turn", dir: "up" }, t.ctx) === false, "non-participant rejected");
  check(game.action(s, "spectator", { type: "turn", dir: "down" }, t.ctx) === false, "spectator rejected");
  check(snap(s) === before, "hostile actions changed nothing");
}

// ---------- secrecy: queued turns are private ----------
{
  const { t, s } = playing(3);
  const v1 = JSON.stringify(view(s, t.ids[1], t));
  const vs = JSON.stringify(view(s, "spectator", t));
  game.action(s, t.ids[0], { type: "turn", dir: s.painters[0].dir === 0 ? "down" : "up" }, t.ctx);
  game.action(s, t.ids[0], { type: "turn", dir: "left" }, t.ctx);
  check(s.painters[0].queue.length === 2, "turns queued");
  check(JSON.stringify(view(s, t.ids[1], t)) === v1, "another player's view does not reveal queued turns");
  check(JSON.stringify(view(s, "spectator", t)) === vs, "spectator view does not reveal queued turns");
  for (const v of [v1, vs, JSON.stringify(view(s, t.ids[0], t))]) {
    check(!/queue|nextSpawn|aloneSince|"enc"/.test(v), "internal fields never leave the server");
  }
}

// ---------- disconnects ----------

// Countdown: someone drops, the game still starts; they wait in place, then rejoin.
{
  const { t, s } = newGame(3);
  t.ctx.player(t.ids[1])!.connected = false;
  game.playerLeft!(s, t.ids[1], t.ctx);
  check(s.aloneSince === null, "two still online: no abandonment timer");
  tick(t, s, COUNTDOWN_MS);
  check(s.phase === "play", "countdown finishes without them");
  const p1 = s.painters[1];
  const [x, y] = [p1.x, p1.y];
  for (let i = 0; i < 5; i++) tick(t, s);
  check(p1.x === x && p1.y === y, "away painter waits in place");
  check(game.action(s, t.ids[1], { type: "turn", dir: "up" }, t.ctx) === false, "(room never forwards their input anyway)");
  t.ctx.player(t.ids[1])!.connected = true;
  game.playerReturned!(s, t.ids[1], t.ctx);
  tick(t, s);
  check(p1.x !== x || p1.y !== y, "moves again after returning");
}

// Play: 2 players, one leaves -> 8s grace, then the one who stayed wins.
{
  const { t, s, ends } = playing(2);
  t.ctx.player(t.ids[1])!.connected = false;
  const seq = s.seq;
  game.playerLeft!(s, t.ids[1], t.ctx);
  check(s.seq > seq && s.aloneSince === t.ctx.now(), "abandonment timer starts");
  check(view(s, t.ids[0], t).abandonAt === t.ctx.now() + ABANDON_MS, "clients see the deadline");
  // They come back in time: timer cleared.
  tick(t, s, 3_000);
  t.ctx.player(t.ids[1])!.connected = true;
  game.playerReturned!(s, t.ids[1], t.ctx);
  check(s.aloneSince === null && (view(s, t.ids[0], t).abandonAt ?? null) === null, "timer cleared on return");
  // Leave again, for good this time.
  t.ctx.player(t.ids[1])!.connected = false;
  game.playerLeft!(s, t.ids[1], t.ctx);
  tick(t, s, ABANDON_MS - 200);
  check(s.phase === "play", "still waiting");
  tick(t, s, 200);
  check(s.phase === "over" && ends.length === 1, "ends after the grace period");
  check(t.result!.winners.join() === t.ids[0], "the player who stayed wins");
  check(/everyone else left/.test(t.result!.headline), t.result!.headline);
  check(view(s, t.ids[0], t).endReason === "abandoned", "reason in view");
}

// Everyone leaves: ends with the usual scoring.
{
  const { t, s, ends } = playing(3);
  for (const id of t.ids) {
    t.ctx.player(id)!.connected = false;
    game.playerLeft!(s, id, t.ctx);
  }
  for (let i = 0; i < ABANDON_MS / TICK_MS + 2; i++) tick(t, s);
  check(s.phase === "over" && ends.length === 1, "empty game ends");
  check(t.result!.winners.length === 3 && /tie/.test(t.result!.headline), "all tied at 9 tiles");
}

// 3 players, one leaves: game continues normally.
{
  const { t, s } = playing(3);
  t.ctx.player(t.ids[2])!.connected = false;
  game.playerLeft!(s, t.ids[2], t.ctx);
  for (let i = 0; i < 100; i++) tick(t, s);
  check(s.phase === "play" && s.aloneSince === null, "two online keep playing");
}

// Abandonment also works from the countdown.
{
  const { t, s, ends } = newGame(2);
  t.ctx.player(t.ids[0])!.connected = false;
  game.playerLeft!(s, t.ids[0], t.ctx);
  for (let i = 0; i < (ABANDON_MS + COUNTDOWN_MS) / TICK_MS; i++) tick(t, s);
  check(s.phase === "over" && ends.length === 1 && t.result!.winners.join() === t.ids[1], "countdown abandonment");
}

// ---------- view size ----------
for (const n of [4, 8]) {
  const t = makeTestCtx(n, 5);
  // Real ids are 16 chars.
  t.ctx.players.forEach((p, i) => (p.id = `abcdefghijklmn${String(i).padStart(2, "0")}`));
  const s: TurfState = game.setup(t.ctx);
  tick(t, s, COUNTDOWN_MS);
  s.powers = [
    { x: 1, y: 1, kind: "dash" },
    { x: 40, y: 2, kind: "freeze" },
    { x: 3, y: 30, kind: "bomb" },
  ];
  s.painters.forEach((p) => {
    p.dashUntil = t.ctx.now() + 2_000;
    p.out = 120;
    p.count = 999;
  });
  const size = JSON.stringify(game.view(s, s.painters[0].id, t.ctx)).length;
  const limit = n <= 4 ? 1_600 : 2_250;
  check(size <= limit, `view for ${n} players is ${size} bytes (limit ${limit})`);
}

// ---------- determinism + fuzz ----------
function fuzz(n: number, seed: number) {
  const t = makeTestCtx(n, seed);
  const ends = countEnds(t);
  const s: TurfState = game.setup(t.ctx);
  const dirs = ["up", "right", "down", "left"] as const;
  let guard = 0;
  while (s.phase !== "over" && guard++ < 3_000) {
    const r = t.ctx.random();
    const who = t.ids[Math.floor(t.ctx.random() * n)];
    if (r < 0.5) game.action(s, who, { type: "turn", dir: dirs[Math.floor(t.ctx.random() * 4)] }, t.ctx);
    else if (r < 0.52) {
      const p = t.ctx.player(who)!;
      p.connected = !p.connected;
      if (p.connected) game.playerReturned!(s, who, t.ctx);
      else game.playerLeft!(s, who, t.ctx);
    }
    tick(t, s);
    checkInvariants(s, `fuzz ${n}/${seed}`);
    const v = view(s, who, t);
    check(v.tiles.length === s.w * s.h, "tile string length");
    check(JSON.stringify(JSON.parse(JSON.stringify(v))) === JSON.stringify(v), "view is plain JSON");
    check(JSON.parse(JSON.stringify(s)) && true, "state is JSON-serialisable");
  }
  check(s.phase === "over" && ends.length === 1, `fuzz ${n}/${seed} ended once`);
  return snap(s) + JSON.stringify(t.result) + JSON.stringify(t.events);
}
for (let n = 2; n <= 8; n++) for (const seed of [1, 2, 3]) fuzz(n, seed * 31 + n);
check(fuzz(5, 77) === fuzz(5, 77), "same seed + inputs -> same game");

// ---------- stamped turns: held until their tick, late ones land on the next step ----------
{
  const { t, s } = playing(2);
  clearBoard(s);
  place(s, 0, 20, 12, "right");
  solo(s, 0);
  const p = s.painters[0];
  const t0 = s.tick;
  t.advance(40);
  game.action(s, t.ids[0], { type: "turn", dir: "up", seq: 3, at: t0 + 2 }, t.ctx);
  check(view(s, t.ids[0], t).me?.join() === `0,3,${2 * TICK_MS - 40}`, "received, early by 200ms");
  check(view(s, t.ids[1], t).me?.join() !== "0,3,200", "only the owner sees their status");
  check(view(s, "spectator", t).me === undefined, "spectators get none");
  tick(t, s, TICK_MS - 40);
  check(p.dir === 1 && p.x === 21, "held on the tick before its own");
  tick(t, s);
  check(p.dir === 0 && p.y === 11 && s.tick === t0 + 2, "applied on exactly its tick");
  check(view(s, t.ids[0], t).me?.[0] === 3, "reported as applied");
  t.advance(30);
  game.action(s, t.ids[0], { type: "turn", dir: "left", seq: 4, at: s.tick }, t.ctx);
  check(view(s, t.ids[0], t).me?.[2] === -30, "late by 30ms");
  tick(t, s, TICK_MS - 30);
  check(p.dir === 3, "late turn lands on the next tick");
  game.action(s, t.ids[0], { type: "turn", dir: "down", seq: 5, at: s.tick + 99 }, t.ctx);
  check(p.queue[0]?.at === s.tick + 1 + MAX_HOLD, "hold capped at MAX_HOLD ticks");
  for (const bad of [-1, 2.5, "7", null, 2 ** 40]) {
    check(game.action(s, t.ids[0], { type: "turn", dir: "up", seq: bad } as never, t.ctx) === false, `bad seq ${String(bad)}`);
    check(game.action(s, t.ids[0], { type: "turn", dir: "up", at: bad } as never, t.ctx) === false, `bad at ${String(bad)}`);
  }
  check(p.queue.length === 1 && p.rx === 5, "bad stamps changed nothing");
  // Countdown aims apply at once and say so.
  const g = newGame(2);
  game.action(g.s, g.t.ids[0], { type: "turn", dir: "down", seq: 9, at: 5 }, g.t.ctx);
  check(g.s.painters[0].dir === 2 && view(g.s, g.t.ids[0], g.t).me?.join() === "9,9,0", "countdown aim applied at once");
  check(view(g.s, g.t.ids[0], g.t).at === undefined, "no step clock before play");
}

// ---------- the predictor against the real server, over a simulated network ----------
interface NetResult {
  accepted: number;
  latency: number[];
  corrections: number;
  late: number;
  lead: number;
}

/** Painter 0 zigzags through the predictor with `up`/`down` ms of delay and a clock `skew` ms off. */
function netGame(up: number, down: number, skew: number, dash: boolean): NetResult {
  const { t, s } = playing(2);
  clearBoard(s);
  place(s, 0, 8, 12, "right");
  place(s, 1, 3, 3, "down");
  solo(s, 0);
  if (dash) s.painters[0].dashUntil = FOREVER;
  const me = t.ids[0];
  const pred = new TurfPredictor();
  // What reaches the client: full views (when tick() returns true) and events (deltas, echoes).
  const toClient: { at: number; v?: TurfView; e?: unknown }[] = [];
  const toServer: { at: number; a: unknown }[] = [];
  const send = () => toClient.push({ at: t.ctx.now() + down, v: JSON.parse(JSON.stringify(view(s, me, t))) });
  let seen = t.events.length;
  const flushEvents = () => {
    for (; seen < t.events.length; seen++) {
      const ev = t.events[seen];
      if (!ev.to || ev.to === me) toClient.push({ at: t.ctx.now() + down, e: JSON.parse(JSON.stringify(ev.event)) });
    }
  };
  let base: TurfView | null = null;
  let heard: Heard = nothingHeard;
  send();
  let rnd = 12345;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  // A zigzag that stays on the board: right, up, right, down, ... (and back left when near the edge).
  const res: NetResult = { accepted: 0, latency: [], corrections: 0, late: 0, lead: 0 };
  const watching: { dir: number; at: number }[] = [];
  const head = { x: 0, y: 0, dir: 0, next: 0 };
  let nextTick = t.ctx.now() + TICK_MS;
  let nextPress = t.ctx.now() + 200;
  let k = 0;
  let lastRx = 0;
  const end = t.ctx.now() + 7_000;
  for (let now = t.ctx.now(); now < end; now += 2) {
    t.advance(now - t.ctx.now());
    const cnow = now + skew;
    while (toServer.length && toServer[0].at <= now) game.action(s, me, toServer.shift()!.a as never, t.ctx);
    flushEvents();
    if (now >= nextTick) {
      nextTick += TICK_MS;
      if (game.tick!(s, t.ctx)) send();
      flushEvents();
    }
    const calibrated = res.accepted >= 3;
    while (toClient.length && toClient[0].at <= now) {
      const msg = toClient.shift()!;
      if (msg.v) base = msg.v;
      else if (isTurfWire(msg.e)) heard = hear(heard, msg.e);
      const built = rebuild(base, heard);
      check(!built.gap, "no missing ticks on a reliable link");
      const v = built.view;
      if (!v) continue;
      const tau = pred.advance(now, cnow);
      pred.head(tau, head);
      const [bx, by] = [head.x, head.y];
      pred.ingest(v, cnow, now);
      pred.head(tau, head);
      if (calibrated && Math.hypot(head.x - bx, head.y - by) > 0.01) res.corrections += 1;
      if (v.me && v.me[1] > lastRx) {
        lastRx = v.me[1];
        if (calibrated && v.me[2] < 0) res.late += 1;
      }
    }
    pred.head(pred.advance(now, cnow), head);
    for (let i = watching.length - 1; i >= 0; i--) {
      if (head.dir === watching[i].dir) {
        if (res.accepted > 5) res.latency.push(now - watching[i].at);
        watching.splice(i, 1);
      }
    }
    if (now >= nextPress) {
      nextPress = now + (dash ? 200 : 300) + Math.floor(rand() * 150);
      const p = s.painters[0];
      const goingRight = Math.floor(k / 2) % 12 < 6;
      const sideways = goingRight ? 1 : 3;
      const dir = k % 2 === 0 ? sideways : p.y > 12 ? 0 : 2;
      k += 1;
      const stamp = pred.press(dir, cnow, now);
      if (stamp) {
        res.accepted += 1;
        watching.length = 0;
        watching.push({ dir, at: now });
        toServer.push({ at: now + up, a: { type: "turn", dir: ["up", "right", "down", "left"][dir], ...stamp } });
      }
    }
  }
  res.lead = pred.lead.value(end);
  return res;
}

for (const [up, down, skew, dash] of [
  [50, 50, 0, false],
  [20, 80, 0, false],
  [75, 75, -75, false],
  [50, 50, 0, true],
] as const) {
  const r = netGame(up, down, skew, dash);
  const label = `net up=${up} down=${down} skew=${skew}${dash ? " dash" : ""}`;
  const max = Math.max(...r.latency);
  const mean = r.latency.reduce((x, y) => x + y, 0) / r.latency.length;
  if (process.env.NET_VERBOSE) console.log(label, { mean: Math.round(mean), max, ...r, latency: r.latency.length });
  check(r.accepted >= 12 && r.latency.length >= 8, `${label}: enough turns (${r.accepted}, ${r.latency.length})`);
  check(max <= TICK_MS + 8, `${label}: turn visible within a tick (max ${max}ms)`);
  check(mean <= TICK_MS * 0.7, `${label}: about half a tick on average (${mean.toFixed(0)}ms)`);
  check(r.corrections === 0, `${label}: no corrections once calibrated (${r.corrections})`);
  check(r.late === 0, `${label}: turns arrive in time (${r.late} late)`);
  check(r.lead >= up - skew && r.lead <= up - skew + 40, `${label}: lead tracks clock error + uplink (${r.lead.toFixed(0)})`);
}

// ---------- the predictor: local queue mirror, countdown aim, walls ----------
{
  const { t, s } = playing(2);
  clearBoard(s);
  place(s, 0, s.w - 2, 12, "right");
  solo(s, 0);
  const pred = new TurfPredictor();
  const now = t.ctx.now();
  pred.ingest(JSON.parse(JSON.stringify(view(s, t.ids[0], t))), now, now);
  check(pred.press(1, now, now) === null, "repeat refused locally");
  const head = { x: 0, y: 0, dir: 0, next: 0 };
  pred.head(s.tick + 3.5, head);
  check(head.x === s.w - 1 && head.y === 12, "the walk stops at the wall");
  check(pred.press(0, now, now) !== null && pred.press(3, now, now) !== null, "two turns queue");
  check(pred.press(2, now, now) !== null && pred.pending.map((q) => q.d).join() === "0,2", "a third replaces the second");
  check(pred.press(0, now, now) !== null && pred.pending.map((q) => q.d).join() === "0", "repeating the first collapses");
  pred.head(pred.advance(now, now), head);
  check(head.next === 0, "the arrow swings to the queued turn at once");
  const g = newGame(2);
  const p2 = new TurfPredictor();
  const t2 = g.t.ctx.now();
  p2.ingest(JSON.parse(JSON.stringify(view(g.s, g.t.ids[0], g.t))), t2, t2);
  const aim = (g.s.painters[0].dir + 1) % 4;
  check(p2.press(aim, t2, t2)?.at === undefined, "countdown aims are untimed");
  p2.head(p2.advance(t2, t2), head);
  check(head.next === aim, "countdown aim shows at once");
}

// ---------- delta protocol: the rebuilt view always equals the server's; bandwidth ----------
function deltaFuzz(n: number, seed: number) {
  const { t, s } = newGame(n, seed);
  const player = t.ids[0];
  const viewers = [player, "spectator"];
  const base: Record<string, TurfView> = Object.fromEntries(viewers.map((v) => [v, JSON.parse(JSON.stringify(view(s, v, t)))]));
  const heard: Record<string, Heard> = Object.fromEntries(viewers.map((v) => [v, nothingHeard]));
  let r = seed * 7919 + 3;
  const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  let seen = 0;
  let bytes = 0;
  let playMs = 0;
  let checks = 0;
  let fulls = 0;
  const refresh = () => {
    for (const v of viewers) base[v] = JSON.parse(JSON.stringify(view(s, v, t)));
  };
  for (let step = 0; step < 2000 && s.phase !== "over"; step++) {
    for (const id of t.ids) {
      if (rand() < 0.3) {
        const d = ["up", "right", "down", "left"][Math.floor(rand() * 4)] as Dir;
        game.action(s, id, { type: "turn", dir: d, seq: step + 1, at: s.tick + 1 + Math.floor(rand() * 2) }, t.ctx);
      }
    }
    if (rand() < 0.01) {
      // Someone drops or comes back: the room sends everyone the full view.
      const p = t.ctx.player(t.ids[1 + Math.floor(rand() * (n - 1))])!;
      p.connected = !p.connected;
      if (p.connected) game.playerReturned!(s, p.id, t.ctx);
      else game.playerLeft!(s, p.id, t.ctx);
      refresh();
    }
    const playing = s.phase === "play";
    const full = tick(t, s);
    for (; seen < t.events.length; seen++) {
      const ev = t.events[seen];
      if (!isTurfWire(ev.event)) continue;
      for (const v of viewers) if (!ev.to || ev.to === v) heard[v] = hear(heard[v], JSON.parse(JSON.stringify(ev.event)));
      if (playing && (!ev.to || ev.to === player)) bytes += JSON.stringify({ t: "ev", e: ev.event, now: t.ctx.now() }).length;
    }
    if (full) {
      refresh();
      fulls += 1;
      if (playing) bytes += JSON.stringify({ t: "game", view: base[player], now: t.ctx.now() }).length;
    }
    if (playing) playMs += TICK_MS;
    for (const v of viewers) {
      const built = rebuild(base[v], heard[v]);
      check(!built.gap, `turf delta n=${n} step ${step}: no gap for ${v}`);
      const want = JSON.stringify(view(s, v, t));
      const got = JSON.stringify(built.view);
      if (got !== want) throw new Error(`turf delta n=${n} step ${step} (${v}): rebuilt view differs\n got  ${got.replace(/"tiles":"[^"]*"/, "")}\n want ${want.replace(/"tiles":"[^"]*"/, "")}`);
      checks += 1;
    }
  }
  check(s.phase === "over", `turf delta n=${n}: game over`);
  return { kbps: bytes / (playMs / 1000) / 1024, checks, fulls };
}

for (const [n, seed] of [
  [2, 5],
  [3, 6],
  [8, 7],
] as const) {
  const { kbps, checks, fulls } = deltaFuzz(n, seed);
  if (process.env.NET_VERBOSE) console.log(`turf delta n=${n}: ${kbps.toFixed(2)} KB/s per client during play, ${checks} checks, ${fulls} full views`);
  check(checks > 200, `turf delta n=${n}: enough comparisons (${checks})`);
  check(kbps < (n === 8 ? 5 : 3), `turf delta n=${n}: small enough (${kbps.toFixed(2)} KB/s per client)`);
}

{
  // A plain tick is a delta (tick() returns false) carrying only the tiles that changed.
  const { t, s } = playing(3);
  clearBoard(s);
  place(s, 0, 10, 10, "right");
  place(s, 1, 20, 10, "right");
  place(s, 2, 30, 10, "left");
  s.fullAt = t.ctx.now();
  tick(t, s);
  t.events.length = 0;
  check(tick(t, s) === false, "a plain tick returns false");
  const d = t.events.find((e) => (e.event as TurfDelta).k === "d")?.event as TurfDelta;
  check(d && d.n === s.tick && d.p.length === 15 && d.c?.length === 9, "positions plus three painted tiles");
  check(JSON.stringify(d).length < 160, `deltas are small (${JSON.stringify(d).length} bytes)`);
  check(!d.b && !d.pw && !d.dz, "nothing else when nothing else changed");
  // A big fill sends the whole board instead of a long change list.
  for (let i = 0; i < s.tiles.length * 0.3; i++) paint(s, i, 1);
  t.events.length = 0;
  tick(t, s);
  const big = t.events.find((e) => (e.event as TurfDelta).k === "d")?.event as TurfDelta;
  check(typeof big?.b === "string" && big.b.length === s.w * s.h && !big.c, "the whole board after a big fill");
  // Full views every KEYFRAME_MS.
  let fulls = 0;
  for (let i = 0; i < Math.ceil((2 * KEYFRAME_MS) / TICK_MS); i++) if (tick(t, s)) fulls += 1;
  check(fulls === 2, `a keyframe every ${KEYFRAME_MS}ms (${fulls})`);
  // A missing tick is a gap; a requested keyframe closes it (once a second per viewer).
  const v0 = JSON.parse(JSON.stringify(view(s, t.ids[0], t))) as TurfView;
  t.events.length = 0;
  tick(t, s);
  tick(t, s);
  const ds = t.events.map((e) => e.event as TurfDelta).filter((e) => e.k === "d");
  check(ds.length === 2 && applyDelta(v0, ds[1]) === null, "a delta only applies to the tick before it");
  let h = hear(nothingHeard, ds[1]);
  check(rebuild(v0, h).gap, "a skipped tick is a gap");
  t.events.length = 0;
  check(game.action(s, t.ids[0], { type: "sync" }, t.ctx) === false, "sync never broadcasts");
  const key = t.events.find((e) => (e.event as TurfKeyframe).k === "K");
  check(key?.to === t.ids[0], "the keyframe goes only to whoever asked");
  h = hear(h, key!.event as TurfKeyframe);
  check(!rebuild(v0, h).gap && rebuild(v0, h).view?.tick === s.tick, "the keyframe closes the gap");
  t.events.length = 0;
  game.action(s, t.ids[0], { type: "sync" }, t.ctx);
  check(t.events.length === 0, "one keyframe a second per viewer");
  const before = snap(s);
  check(game.spectatorAction!(s, "spectator", { type: "sync" }, t.ctx) === false, "spectators can ask too");
  check(t.events.some((e) => e.to === "spectator"), "and get one");
  check(snap(s) === before, "spectator requests never change the game");
  // Your input echo goes only to you.
  t.events.length = 0;
  game.action(s, t.ids[0], { type: "turn", dir: "up", seq: 41, at: s.tick + 1 }, t.ctx);
  check(t.events[0]?.to === t.ids[0] && (t.events[0].event as TurfInputEcho).rx === 41, "input echo, to you only");
}

console.log("turf: all tests passed");
