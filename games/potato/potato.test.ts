import { assert, makeTestCtx } from "../../shared/testing";
import game, { type PotatoState, type PotatoView } from "./server";
import { genArrows, genInk, genOdd, genSum, makePuzzle } from "./puzzles";
import {
  AUTO_MS,
  AWAY_MS,
  BOOM_MS,
  FLIGHT_MS,
  FUSE_MAX_MS,
  FUSE_MIN_MS,
  HECKLES,
  PENALTY_MS,
  READY_FIRST_MS,
  READY_MS,
  checkAnswer,
  oddCell,
  sumValue,
  type Puzzle,
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

function setConnected(t: T, id: string, connected: boolean) {
  const p = t.ctx.players.find((x) => x.id === id)!;
  p.connected = connected;
}

// Getters, so TypeScript doesn't narrow state across actions that mutate it.
const phaseOf = (s: PotatoState) => s.phase;
const heldOf = (s: PotatoState) => s.held;
const evCount = (t: T) => t.events.length;
const view = (s: PotatoState, id: string, t: T) => game.view(s, id, t.ctx) as PotatoView;
const tick = (s: PotatoState, t: T) => game.tick!(s, t.ctx);
const act = (s: PotatoState, id: string, a: unknown, t: T) => game.action(s, id, a, t.ctx);

/** The right answer, straight from the puzzle (every puzzle is self-evident). */
function rightAnswer(pz: Puzzle): number | number[] {
  switch (pz.t) {
    case "sum":
      return pz.opts.indexOf(sumValue(pz));
    case "odd":
      return oddCell(pz.cells);
    case "arrows":
      return pz.seq.slice();
    case "ink":
      return pz.opts.indexOf(pz.ink);
  }
}

function wrongAnswer(pz: Puzzle): number | number[] {
  switch (pz.t) {
    case "sum":
      return pz.opts.findIndex((o) => o !== sumValue(pz));
    case "odd":
      return (oddCell(pz.cells) + 1) % 9;
    case "arrows":
      return [(pz.seq[0] + 1) % 4];
    case "ink":
      return pz.opts.findIndex((o) => o !== pz.ink);
  }
}

/** Ready -> live. */
function goLive(s: PotatoState, t: T) {
  assert(s.phase === "ready", `expected ready, got ${s.phase}`);
  t.advance(s.endsAt - t.ctx.now());
  assert(tick(s, t) === true, "ready -> live broadcasts");
  assert(phaseOf(s) === "live", "live after the ready beat");
}

/** Wait for the holder's puzzle to open, then solve it. */
function solve(s: PotatoState, t: T) {
  const held = s.held!;
  if (t.ctx.now() < held.openAt) t.advance(held.openAt - t.ctx.now());
  assert(act(s, s.holder!, { type: "solve", n: held.n, a: rightAnswer(held.pz) }, t) === true, "solve accepted");
  assert(s.armed, "armed after solving");
}

function legalTarget(s: PotatoState): string {
  const left = s.seats.filter((x) => x.lives > 0);
  return left.find((x) => x.id !== s.holder && (x.id !== s.lastFrom || left.length <= 2))!.id;
}

// ---------- puzzles ----------
{
  let r = 1;
  const rand = () => {
    r = (r * 16807) % 2147483647;
    return (r - 1) / 2147483646;
  };
  for (let i = 0; i < 400; i++) {
    const sum = genSum(rand);
    assert(sum.t === "sum");
    const v = sumValue(sum);
    assert(v >= 0 && sum.opts.length === 3 && new Set(sum.opts).size === 3, "sum options distinct");
    assert(sum.opts.includes(v) && sum.opts.every((o) => o >= 0), "sum answer offered, no negatives");
    assert(
      sum.opts.every((o, k) => k === 0 || sum.opts[k - 1] < o),
      "sum options ascending",
    );
    const odd = genOdd(rand);
    assert(odd.t === "odd" && odd.cells.length === 9, "3x3 odd grid");
    const oc = oddCell(odd.cells);
    assert(oc >= 0 && odd.cells.filter((c) => c === odd.cells[oc]).length === 1, "exactly one odd cell");
    assert(new Set(odd.cells).size === 2, "two kinds of emoji");
    const arr = genArrows(rand);
    assert(arr.t === "arrows" && arr.seq.length === 3 && !(arr.seq[0] === arr.seq[1] && arr.seq[1] === arr.seq[2]), "arrows");
    const ink = genInk(rand);
    assert(ink.t === "ink" && ink.opts.length === 3 && new Set(ink.opts).size === 3, "ink options distinct");
    assert(ink.opts.includes(ink.ink) && ink.opts.includes(ink.word) && ink.word !== ink.ink, "ink trap offered");
    for (const pz of [sum, odd, arr, ink]) {
      assert(checkAnswer(pz, rightAnswer(pz)) === true, `right answer accepted (${pz.t})`);
      assert(checkAnswer(pz, wrongAnswer(pz)) === false, `wrong answer rejected (${pz.t})`);
    }
  }
  // Never the same kind twice in a row.
  let last = null as Puzzle["t"] | null;
  for (let i = 0; i < 200; i++) {
    const pz = makePuzzle(rand, last);
    assert(pz.t !== last, "puzzle kinds alternate");
    last = pz.t;
  }
  // Malformed answers are ignored (null), not penalised.
  const arrows: Puzzle = { t: "arrows", seq: [0, 1, 2] };
  for (const bad of [null, "0", 1, [], [0, 1, 2, 3], [0, 1.5], [0, 9], [-1], { 0: 0 }]) {
    assert(checkAnswer(arrows, bad) === null, `arrows: ${JSON.stringify(bad)} is malformed`);
  }
  assert(checkAnswer(arrows, [0, 1]) === null, "a correct prefix is not an answer yet");
  assert(checkAnswer(arrows, [0, 2]) === false, "a wrong prefix is wrong");
  const sum: Puzzle = { t: "sum", a: 3, b: 4, op: "+", opts: [6, 7, 8] };
  for (const bad of [null, "1", 1.5, -1, 3, NaN, Infinity, [1]]) assert(checkAnswer(sum, bad) === null, `sum: ${String(bad)} malformed`);
}

// ---------- setup and the first round ----------
{
  const t = makeTestCtx(3);
  const s: PotatoState = game.setup(t.ctx);
  assert(s.phase === "ready" && s.round === 1 && s.maxLives === 2, "3 players: ready, round 1, 2 lives");
  assert(s.seats.every((x) => x.lives === 2), "everyone starts with 2 lives");
  assert(s.holder && t.ids.includes(s.holder), "someone starts with the potato");
  assert(s.endsAt === t.ctx.now() + READY_FIRST_MS, "first ready beat");
  assert(tick(s, t) === false, "nothing to broadcast mid-beat");
  assert(act(s, s.holder, { type: "solve", n: 1, a: 0 }, t) === false, "no answers during the ready beat");
  goLive(s, t);
  const fuse = s.fuseAt - s.liveAt;
  assert(fuse >= FUSE_MIN_MS && fuse <= FUSE_MAX_MS, `fuse ${fuse} in range`);
  assert(s.held && s.held.openAt === t.ctx.now(), "first puzzle opens at once");
  assert(tick(s, t) === false, "a quiet live tick broadcasts nothing");
}

// Lives: one life from 9 players up; 12 players works.
{
  const t9 = makeTestCtx(9);
  assert((game.setup(t9.ctx) as PotatoState).maxLives === 1, "9 players: 1 life");
  const t8 = makeTestCtx(8);
  assert((game.setup(t8.ctx) as PotatoState).maxLives === 2, "8 players: 2 lives");
}

// ---------- solving, penalties, throwing ----------
{
  const t = makeTestCtx(4, 7);
  const s: PotatoState = game.setup(t.ctx);
  goLive(s, t);
  const holder = s.holder!;
  const other = t.ids.find((id) => id !== holder)!;
  const held = s.held!;

  // Not armed yet: no throws.
  assert(act(s, holder, { type: "throw", to: other }, t) === false, "can't throw before solving");
  // Someone else can't answer the holder's puzzle.
  assert(act(s, other, { type: "solve", n: held.n, a: rightAnswer(held.pz) }, t) === false, "only the holder answers");
  // Stale puzzle number.
  assert(act(s, holder, { type: "solve", n: held.n + 1, a: rightAnswer(held.pz) }, t) === false, "wrong puzzle number");

  // Wrong answer: a new puzzle after the penalty.
  assert(act(s, holder, { type: "solve", n: held.n, a: wrongAnswer(held.pz) }, t) === true, "wrong answer counts");
  const seat = s.seats.find((x) => x.id === holder)!;
  assert(seat.wrong === 1 && !s.armed, "one fumble, not armed");
  assert(s.held && s.held.n === held.n + 1 && s.held.openAt === t.ctx.now() + PENALTY_MS, "new puzzle after the penalty");
  assert(s.held.pz.t !== held.pz.t, "a different kind of puzzle");
  assert(
    act(s, holder, { type: "solve", n: s.held.n, a: rightAnswer(s.held.pz) }, t) === false,
    "can't answer during the penalty",
  );
  t.advance(PENALTY_MS);
  solve(s, t);
  assert(s.held === null && seat.best === 0, "solved instantly after it opened");
  assert(act(s, holder, { type: "solve", n: 99, a: 0 }, t) === false, "no answers once armed");

  // Throw rules.
  assert(act(s, holder, { type: "throw", to: holder }, t) === false, "can't throw to yourself");
  assert(act(s, holder, { type: "throw", to: "stranger" }, t) === false, "can't throw to a stranger");
  const now = t.ctx.now();
  assert(act(s, holder, { type: "throw", to: other }, t) === true, "throw accepted");
  assert(s.holder === other && s.lastFrom === holder && s.passes === 1, "potato heads to the target");
  assert(s.flight && s.flight.from === holder && s.flight.to === other && s.flight.lands === now + FLIGHT_MS, "flight");
  const caught = heldOf(s);
  assert(caught && caught.openAt === now + FLIGHT_MS, "catcher's puzzle opens on landing");
  assert(seat.throws === 1, "throw counted");
  assert(act(s, holder, { type: "throw", to: other }, t) === false, "can't throw twice");

  // The catcher can't answer mid-air, and can't throw straight back.
  assert(act(s, other, { type: "solve", n: caught.n, a: rightAnswer(caught.pz) }, t) === false, "can't answer mid-air");
  solve(s, t);
  assert(act(s, other, { type: "throw", to: holder }, t) === false, "no throwbacks with 4 alive");
  const third = t.ids.find((id) => id !== holder && id !== other)!;
  assert(act(s, other, { type: "throw", to: third }, t) === true, "throw onwards");

  // Views: only the holder sees the puzzle.
  t.advance(FLIGHT_MS);
  const vh = view(s, third, t);
  assert(vh.held && vh.held.n === heldOf(s)!.n, "holder sees their puzzle");
  for (const id of [...t.ids.filter((x) => x !== third), "spectator"]) {
    assert(view(s, id, t).held === null, `${id} doesn't see the holder's puzzle`);
  }
}

// ---------- explosions ----------

// In-hand explosion; actions that arrive after the fuse never beat it.
{
  const t = makeTestCtx(3, 11);
  const s: PotatoState = game.setup(t.ctx);
  goLive(s, t);
  const holder = s.holder!;
  solve(s, t);
  t.advance(s.fuseAt - t.ctx.now());
  // The throw arrives at fuseAt, before any tick: too late.
  assert(act(s, holder, { type: "throw", to: legalTarget(s) }, t) === true, "late action triggers the boom");
  assert(s.phase === "boom" && s.boom && s.boom.victim === holder && !s.boom.midair, "boom in hand");
  assert(s.seats.find((x) => x.id === holder)!.lives === 1, "holder lost a life");
  assert(s.boom.fuseMs === s.fuseAt - s.liveAt, "fuse revealed after the boom");
  assert(tick(s, t) === false, "boom holds");
  t.advance(BOOM_MS);
  assert(tick(s, t) === true && phaseOf(s) === "ready" && s.round === 2, "next round after the boom");
  assert(s.endsAt === t.ctx.now() + READY_MS && s.boom === null, "short ready beat");
}

// Mid-air explosion: the thrower loses.
{
  const t = makeTestCtx(4, 5);
  const s: PotatoState = game.setup(t.ctx);
  goLive(s, t);
  const thrower = s.holder!;
  const target = legalTarget(s);
  t.advance(s.fuseAt - t.ctx.now() - 200);
  solve(s, t);
  assert(act(s, thrower, { type: "throw", to: target }, t) === true, "throw just before the fuse");
  t.advance(300);
  assert(tick(s, t) === true, "boom broadcast");
  assert(s.boom && s.boom.midair && s.boom.victim === thrower && s.boom.to === target, "mid-air: the thrower loses");
  assert(Math.abs(s.boom.frac - 200 / FLIGHT_MS) < 1e-9, "blew up 40% of the way");
  assert(s.seats.find((x) => x.id === thrower)!.lives === 1, "thrower lost a life");
  assert(s.seats.find((x) => x.id === target)!.lives === 2, "target is fine");
}

// A throw that lands just before the fuse: the catcher loses.
{
  const t = makeTestCtx(3, 9);
  const s: PotatoState = game.setup(t.ctx);
  goLive(s, t);
  const thrower = s.holder!;
  const target = legalTarget(s);
  t.advance(s.fuseAt - t.ctx.now() - FLIGHT_MS - 50);
  solve(s, t);
  act(s, thrower, { type: "throw", to: target }, t);
  t.advance(FLIGHT_MS + 100);
  tick(s, t);
  assert(s.boom && !s.boom.midair && s.boom.victim === target, "landed: the catcher loses");
}

// ---------- secrecy: the fuse never leaks ----------
{
  const t = makeTestCtx(5, 3);
  const s: PotatoState = game.setup(t.ctx);
  const viewers = [...t.ids, "spectator"];
  const leaks = () => {
    const fuseAt = String(s.fuseAt);
    const fuseMs = String(s.fuseAt - s.liveAt);
    for (const id of viewers) {
      const json = JSON.stringify(view(s, id, t));
      assert(!json.includes(fuseAt), `fuseAt leaked to ${id}`);
      assert(!/fuse/i.test(json) || s.phase === "boom" || s.phase === "over", `fuse field leaked to ${id}`);
      if (s.phase === "live") assert(!json.includes(`:${fuseMs},`) && !json.includes(`:${fuseMs}}`), `fuse length leaked to ${id}`);
    }
    for (const e of t.events) assert(!JSON.stringify(e).includes(fuseAt), "fuse leaked in an event");
  };
  leaks();
  goLive(s, t);
  for (let i = 0; i < 6 && s.phase === "live"; i++) {
    leaks();
    solve(s, t);
    leaks();
    act(s, s.holder!, { type: "throw", to: legalTarget(s) }, t);
    leaks();
    t.advance(FLIGHT_MS);
  }
  // Out players and spectators heckle; still nothing.
  game.spectatorAction!(s, "spectator", { type: "heckle", e: 0 }, t.ctx);
  leaks();
  // Ticks during live never broadcast on their own.
  let broadcasts = 0;
  while (s.phase === "live" && t.ctx.now() < s.fuseAt - 100) {
    t.advance(100);
    if (tick(s, t)) broadcasts++;
  }
  assert(broadcasts === 0, "no broadcasts while the fuse burns");
  t.advance(100);
  tick(s, t);
  assert(s.phase === "boom", "boom");
}

// ---------- hostile and invalid actions ----------
{
  const t = makeTestCtx(3, 21);
  const s: PotatoState = game.setup(t.ctx);
  goLive(s, t);
  const holder = s.holder!;
  const n = s.held!.n;
  const hostile: unknown[] = [
    null,
    undefined,
    42,
    "solve",
    [],
    [{ type: "solve" }],
    {},
    { type: "x" },
    { type: "__proto__" },
    { type: "constructor" },
    { type: "solve" },
    { type: "solve", n: String(n), a: 0 },
    { type: "solve", n, a: "0" },
    { type: "solve", n, a: 1.5 },
    { type: "solve", n, a: -1 },
    { type: "solve", n, a: 99 },
    { type: "solve", n, a: NaN },
    { type: "solve", n, a: Infinity },
    { type: "solve", n, a: { 0: 1 } },
    { type: "solve", n, a: new Array(5000).fill(0) },
    { type: "solve", n: 1e9, a: 0 },
    { type: "throw", to: 5 },
    { type: "throw", to: null },
    { type: "throw", to: "x".repeat(5000) },
    { type: "throw", to: { $gt: "" } },
    { type: "heckle", e: 0 },
    { type: "heckle", e: "0" },
  ];
  const before = JSON.stringify(s);
  for (const a of hostile) assert(act(s, holder, a, t) === false, `rejects ${JSON.stringify(a)?.slice(0, 60)}`);
  for (const a of hostile) assert(act(s, "stranger", a, t) === false, "strangers rejected");
  assert(JSON.stringify(s) === before, "hostile actions changed nothing");
  assert(t.events.length === 0, "no events from junk");
  // Spectators can't play.
  assert(game.spectatorAction!(s, "spectator", { type: "solve", n, a: 0 }, t.ctx) === false, "spectator can't solve");
  assert(game.spectatorAction!(s, "spectator", { type: "throw", to: holder }, t.ctx) === false, "spectator can't throw");
  assert(game.spectatorAction!(s, holder, { type: "heckle", e: 0 }, t.ctx) === false && t.events.length === 0, "players can't heckle as spectators");
  assert(JSON.stringify(s) === before, "still nothing changed");
}

// ---------- heckles ----------
{
  const t = makeTestCtx(3, 4);
  const s: PotatoState = game.setup(t.ctx);
  goLive(s, t);
  // Survivors can't heckle.
  assert(act(s, t.ids[0], { type: "heckle", e: 0 }, t) === false && t.events.length === 0, "survivors don't heckle");
  // Spectator heckles go to everyone else, rate-limited.
  assert(game.spectatorAction!(s, "spectator", { type: "heckle", e: 2 }, t.ctx) === false, "heckle returns false");
  assert(evCount(t) === 1, "heckle emitted");
  const ev = t.events[0];
  assert(JSON.stringify(ev.event) === JSON.stringify({ k: "h", f: "spectator", e: 2 }) && ev.except === "spectator", "heckle shape");
  game.spectatorAction!(s, "spectator", { type: "heckle", e: 1 }, t.ctx);
  assert(evCount(t) === 1, "too soon: dropped");
  for (let i = 0; i < 10; i++) {
    t.advance(300);
    game.spectatorAction!(s, "spectator", { type: "heckle", e: 1 }, t.ctx);
  }
  assert(evCount(t) === 5, `rate limited (${evCount(t)})`);
  const count = t.events.length;
  t.advance(10_000);
  for (const e of [-1, HECKLES.length, 0.5, "1", null]) game.spectatorAction!(s, "spectator", { type: "heckle", e }, t.ctx);
  assert(t.events.length === count, "bad heckles ignored");
  // An out player heckles through action().
  const out = s.seats[1];
  out.lives = 0;
  assert(act(s, out.id, { type: "heckle", e: 4 }, t) === false && t.events.length === count + 1, "out players heckle");
}

// ---------- two left: throwbacks are allowed ----------
{
  const t = makeTestCtx(3, 8);
  const s: PotatoState = game.setup(t.ctx);
  s.seats[2].lives = 0;
  s.outOrder.push(s.seats[2].id);
  // Make sure the holder is a survivor for this round.
  s.holder = s.seats[0].id;
  goLive(s, t);
  const [a, b] = [s.seats[0].id, s.seats[1].id];
  solve(s, t);
  assert(act(s, a, { type: "throw", to: s.seats[2].id }, t) === false, "can't throw to a knocked-out player");
  assert(act(s, a, { type: "throw", to: b }, t) === true, "a -> b");
  solve(s, t);
  assert(act(s, b, { type: "throw", to: a }, t) === true, "b -> a straight back with only two left");
}

// ---------- disconnects ----------

// A disconnected holder auto-throws after AUTO_MS; coming back cancels it.
{
  const t = makeTestCtx(4, 12);
  const s: PotatoState = game.setup(t.ctx);
  goLive(s, t);
  const holder = s.holder!;
  setConnected(t, holder, false);
  game.playerLeft!(s, holder, t.ctx);
  assert(s.autoAt === t.ctx.now() + AUTO_MS, "auto-throw scheduled");
  assert(view(s, t.ids.find((x) => x !== holder)!, t).autoAt === s.autoAt, "everyone sees the auto-throw countdown");
  t.advance(1000);
  setConnected(t, holder, true);
  game.playerReturned!(s, holder, t.ctx);
  assert(s.autoAt === null && s.holder === holder, "back in time: still yours");
  setConnected(t, holder, false);
  assert(tick(s, t) === true && s.autoAt !== null, "tick notices the disconnect");
  // Keep the fuse out of the way for this check.
  s.fuseAt = t.ctx.now() + 60_000;
  t.advance(AUTO_MS);
  assert(tick(s, t) === true, "auto-throw broadcast");
  assert(s.holder !== holder && s.flight?.from === holder, "potato moved on");
  assert(t.ctx.player(s.holder!)?.connected, "auto-throws go to someone connected");
  assert(s.seats.find((x) => x.id === holder)!.throws === 0, "auto-throws aren't counted as the player's throws");
}

// Throwing to a disconnected player: they auto-throw 3s after it lands.
{
  const t = makeTestCtx(3, 13);
  const s: PotatoState = game.setup(t.ctx);
  goLive(s, t);
  s.fuseAt = t.ctx.now() + 60_000;
  const from = s.holder!;
  const to = legalTarget(s);
  setConnected(t, to, false);
  game.playerLeft!(s, to, t.ctx);
  solve(s, t);
  act(s, from, { type: "throw", to }, t);
  assert(tick(s, t) === true && s.autoAt === s.flight!.lands + AUTO_MS, "auto clock starts at landing");
  t.advance(FLIGHT_MS + AUTO_MS);
  tick(s, t);
  assert(s.holder !== to && s.flight?.from === to, "the absent player's potato moved on");
}

// Disconnects in ready and boom phases don't stall anything.
{
  const t = makeTestCtx(3, 14);
  const s: PotatoState = game.setup(t.ctx);
  const starter = s.holder!;
  setConnected(t, starter, false);
  game.playerLeft!(s, starter, t.ctx);
  goLive(s, t);
  assert(s.holder === starter, "starts with the absent player");
  tick(s, t);
  assert(s.autoAt !== null, "auto-throw scheduled at once");
  s.fuseAt = t.ctx.now() + 60_000;
  t.advance(AUTO_MS);
  tick(s, t);
  assert(s.holder !== starter, "moved on");
  // Boom with someone away.
  t.advance(s.fuseAt - t.ctx.now());
  tick(s, t);
  assert(s.phase === "boom", "boom");
  setConnected(t, starter, true);
  game.playerReturned!(s, starter, t.ctx);
  t.advance(BOOM_MS);
  tick(s, t);
  assert(phaseOf(s) === "ready" || phaseOf(s) === "over", "boom moves on");
}

// Everyone else leaves: after AWAY_MS the one who stayed wins; a return cancels it.
{
  const t = makeTestCtx(3, 15);
  const ends = countEnds(t);
  const s: PotatoState = game.setup(t.ctx);
  goLive(s, t);
  s.fuseAt = t.ctx.now() + 10 * 60_000;
  const [a, b, c] = t.ids;
  setConnected(t, b, false);
  setConnected(t, c, false);
  game.playerLeft!(s, b, t.ctx);
  game.playerLeft!(s, c, t.ctx);
  assert(s.awaySince === t.ctx.now(), "away clock starts");
  assert(view(s, a, t).awayEndsAt === t.ctx.now() + AWAY_MS, "everyone sees when it ends");
  t.advance(AWAY_MS / 2);
  setConnected(t, b, true);
  game.playerReturned!(s, b, t.ctx);
  assert(s.awaySince === null, "a return cancels it");
  setConnected(t, b, false);
  let guard = 0;
  while (!t.result && guard++ < 2000) {
    t.advance(100);
    tick(s, t);
  }
  assert(t.result && t.result.winners.length === 1 && t.result.winners[0] === a, "the one who stayed wins");
  assert(/Player0 wins/.test(t.result.headline), "headline names the winner");
  assert(s.over && s.phase === "over" && ends() === 1, "ended once");
  t.advance(10_000);
  assert(tick(s, t) === false && act(s, a, { type: "solve", n: 1, a: 0 }, t) === false, "nothing after the end");
}

// ---------- full games to completion ----------
function playOut(players: number, seed: number) {
  const t = makeTestCtx(players, seed);
  const ends = countEnds(t);
  const s: PotatoState = game.setup(t.ctx);
  const maxLives = s.maxLives;
  let throwsTotal = 0;
  let guard = 0;
  while (!t.result && guard++ < 50_000) {
    if (s.phase === "ready" || s.phase === "boom") {
      t.advance(Math.max(0, s.endsAt - t.ctx.now()));
      assert(tick(s, t) === true, `${s.phase} advances`);
      continue;
    }
    // live: the holder sometimes fumbles, then throws to someone legal.
    const held = s.held;
    if (s.armed) {
      const before = s.passes;
      assert(act(s, s.holder!, { type: "throw", to: legalTarget(s) }, t) === true, "legal throw");
      if (s.phase === "live") assert(s.passes === before + 1, "pass counted");
      throwsTotal++;
      t.advance(FLIGHT_MS);
      tick(s, t);
      continue;
    }
    if (held) {
      if (t.ctx.now() < held.openAt) t.advance(held.openAt - t.ctx.now());
      const fumble = (guard * 7919) % 5 === 0;
      act(s, s.holder!, { type: "solve", n: held.n, a: fumble ? wrongAnswer(held.pz) : rightAnswer(held.pz) }, t);
      t.advance(700);
      tick(s, t);
      continue;
    }
    t.advance(100);
    tick(s, t);
  }
  assert(t.result, `${players}p game ends`);
  assert(ends() === 1, "ctx.end exactly once");
  const left = s.seats.filter((x) => x.lives > 0);
  assert(left.length === 1, "one survivor");
  assert(t.result.winners.length === 1 && t.result.winners[0] === left[0].id, "the survivor wins");
  assert(s.winner === left[0].id && s.phase === "over", "state agrees");
  assert(s.outOrder.length === players - 1, "everyone else knocked out in order");
  assert(t.result.scores && t.result.scores[left[0].id] === Math.max(...Object.values(t.result.scores)), "survivor outlived the most booms");
  const totalLost = s.seats.reduce((n, x) => n + (maxLives - x.lives), 0);
  const booms = s.seats.reduce((n, x) => n + x.booms, 0);
  assert(totalLost === booms, "every boom cost exactly one life");
  assert(t.result.headline.includes(t.ctx.player(left[0].id)!.name), "headline names the winner");
  // Final view has standings for everyone.
  const v = view(s, "spectator", t);
  assert(v.stats && v.stats.length === players && v.winner === left[0].id, "final stats");
  assert(JSON.stringify(v).length < 4096, "final view stays small");
  // Nothing after the end.
  assert(act(s, left[0].id, { type: "throw", to: s.seats[0].id }, t) === false, "no actions after the end");
  t.advance(60_000);
  assert(tick(s, t) === false, "no ticks after the end");
  assert(ends() === 1, "still once");
  assert(throwsTotal > 0, "potatoes were thrown");
  return s;
}

playOut(3, 1);
playOut(3, 99);
playOut(5, 2);
const big = playOut(12, 3);
assert(big.maxLives === 1, "12 players: one life each");

// View size at the max player count stays tiny.
{
  const t = makeTestCtx(12, 6);
  const s: PotatoState = game.setup(t.ctx);
  goLive(s, t);
  const json = JSON.stringify(view(s, s.holder!, t));
  assert(json.length < 2500, `12p view is ${json.length} bytes`);
}

console.log("✓ potato tests passed");

// ---------- host settings ----------
{
  const t = makeTestCtx(4, 7, { lives: 3, fuse: "short" });
  const s: PotatoState = game.setup(t.ctx);
  assert(s.maxLives === 3 && s.seats.every((x) => x.lives === 3), "lives setting honoured");
  goLive(s, t);
  const len = s.fuseAt - s.liveAt;
  assert(len >= 8_000 && len <= 18_000, `short fuse is 8-18s, got ${len}`);
  const t9 = makeTestCtx(10, 7, { lives: 2 });
  assert((game.setup(t9.ctx) as PotatoState).maxLives === 2, "explicit lives beat the 9+ rule");
  const td = makeTestCtx(4, 7, { lives: 99, fuse: "nope" });
  const sd: PotatoState = game.setup(td.ctx);
  assert(sd.maxLives === 2 && sd.fuseMin === FUSE_MIN_MS && sd.fuseMax === FUSE_MAX_MS, "bad settings fall back to defaults");
}

// ---------- practice bots ----------
function botGame(players: number, bots: number, seed: number) {
  const t = makeTestCtx(players, seed, {}, bots);
  const s: PotatoState = game.setup(t.ctx);
  let solves = 0;
  for (let i = 0; i < 20_000 && !t.result; i++) {
    t.advance(100);
    tick(s, t);
    for (const id of t.ids) {
      if (!t.ctx.player(id)?.bot) continue;
      const a = game.bot!(s, id, t.ctx);
      if (a) {
        if ((a as { type: string }).type === "solve") solves++;
        act(s, id, a, t);
      }
    }
  }
  assert(t.result, `bot game (${players}p/${bots} bots) reached an end`);
  assert(solves > 0, "bots solved puzzles");
  return s;
}
botGame(4, 4, 11);
botGame(3, 3, 12);
{
  // 1 idle human + 2 bots: the human just keeps blowing up; bots keep passing.
  const s = botGame(3, 2, 13);
  assert(s.seats.some((x) => x.id.startsWith("bot-") && x.throws > 0), "bots threw");
}

console.log("✓ potato settings + bot tests passed");
