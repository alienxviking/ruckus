import { assert, makeTestCtx } from "../../shared/testing";
import type { GameResult } from "../../shared/types";
import game, { chooseAutoLine, type DotsState } from "./server";
import {
  ABANDON_MS,
  AWAY_MS,
  CHAIN_MS,
  IDLE_STRIKES,
  TURN_MS,
  allLines,
  boxesBeside,
  distinctColors,
  lineIndex,
  ownerOf,
  sideCount,
  type DotsView,
  type LineRef,
  type Orientation,
} from "./shared";

// ---------- harness ----------

function start(n: number, seed = 42) {
  const t = makeTestCtx(n, seed);
  const ends: GameResult[] = [];
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    ends.push(r);
    end(r);
  };
  const s: DotsState = game.setup(t.ctx);
  return { t, s, ends };
}
type G = ReturnType<typeof start>;

const L = (o: Orientation, r: number, c: number) => ({ type: "line", o, r, c });
/** Fresh read of the state, so TypeScript doesn't carry narrowing over from earlier asserts. */
const live = (g: G): DotsState => g.s;
const act = (g: G, who: string, a: unknown) => game.action(g.s, who, a, g.t.ctx);
const tick = (g: G) => game.tick!(g.s, g.t.ctx);
const mover = (g: G) => g.s.seats[g.s.turn];
const now = (g: G) => g.t.ctx.now();
const view = (g: G, id: string) => game.view(g.s, id, g.t.ctx) as DotsView;
const play = (g: G, l: LineRef) => act(g, mover(g), L(l.o, l.r, l.c));
const open = (s: DotsState) => allLines(s.rows, s.cols).filter((l) => ownerOf(s.h, s.v, l, s.rows, s.cols) === -1);
const threeSided = (s: DotsState) =>
  s.boxes.map((_, b) => b).filter((b) => s.boxes[b] === -1 && sideCount(s.h, s.v, b, s.cols) === 3);

function setConnected(g: G, id: string, on: boolean) {
  const p = g.t.ctx.players.find((x) => x.id === id)!;
  p.connected = on;
  if (on) game.playerReturned!(g.s, id, g.t.ctx);
  else game.playerLeft!(g.s, id, g.t.ctx);
}

/** Jump to the current move's deadline and tick once. */
function timeout(g: G) {
  g.t.advance(Math.max(0, g.s.endsAt! - now(g)));
  return tick(g);
}

function invariants(s: DotsState, countMoves = true) {
  const counts = s.seats.map(() => 0);
  for (let b = 0; b < s.rows * s.cols; b++) {
    const full = sideCount(s.h, s.v, b, s.cols) === 4;
    assert(full === (s.boxes[b] !== -1), `box ${b}: owned iff all four sides drawn`);
    if (s.boxes[b] !== -1) counts[s.boxes[b]] += 1;
  }
  counts.forEach((n, seat) => assert(s.scores[seat] === n, `seat ${seat} score matches boxes`));
  if (countMoves) {
    const drawn = s.h.filter((x) => x !== -1).length + s.v.filter((x) => x !== -1).length;
    assert(drawn === s.moves, "moves equals lines drawn");
  }
  if (s.over) {
    assert(s.turn === -1 && s.endsAt === null, "finished game has no mover or clock");
  } else {
    assert(s.turn >= 0 && s.turn < s.seats.length, "valid mover");
    assert(s.endsAt !== null && s.endsAt >= s.moveStartedAt, "running clock");
  }
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw a line straight into the state (for building positions). */
function put(s: DotsState, o: Orientation, r: number, c: number, owner = 0) {
  (o === "h" ? s.h : s.v)[lineIndex(o, r, c, s.rows, s.cols)] = owner;
}

/** Fill the board, then leave `gaps` open and un-claim the boxes they touch. */
function buildBoard(s: DotsState, gaps: LineRef[], owner: (b: number) => number) {
  s.h.fill(0);
  s.v.fill(0);
  for (const l of gaps) (l.o === "h" ? s.h : s.v)[lineIndex(l.o, l.r, l.c, s.rows, s.cols)] = -1;
  s.scores = s.seats.map(() => 0);
  for (let b = 0; b < s.boxes.length; b++) {
    s.boxes[b] = sideCount(s.h, s.v, b, s.cols) === 4 ? owner(b) : -1;
    if (s.boxes[b] !== -1) s.scores[s.boxes[b]] += 1;
  }
  s.moves = s.h.filter((x) => x !== -1).length + s.v.filter((x) => x !== -1).length;
}

const policyFirst = (s: DotsState) => open(s)[0];
const policySmart = (rand: () => number) => (s: DotsState) => chooseAutoLine(s, rand)!;

function playOut(g: G, policy: (s: DotsState) => LineRef) {
  let guard = 0;
  while (!g.s.over && guard++ < 200) {
    g.t.advance(700);
    assert(play(g, policy(g.s)) !== false, "legal move accepted");
    invariants(g.s);
  }
  assert(g.s.over, "game finished");
}

function checkFinished(g: G) {
  assert(g.ends.length === 1, `ctx.end called exactly once (got ${g.ends.length})`);
  const r = g.ends[0];
  const total = g.s.rows * g.s.cols;
  assert(g.s.scores.reduce((a, b) => a + b, 0) === total, "every box scored");
  const best = Math.max(...g.s.scores);
  const expected = g.s.seats.filter((_, i) => g.s.scores[i] === best);
  assert(r.winners.length === expected.length && expected.every((id) => r.winners.includes(id)), "winners = most boxes");
  for (const [i, id] of g.s.seats.entries()) assert(r.scores?.[id] === g.s.scores[i], "result carries scores");
  assert(r.headline.includes("Dots & Boxes"), "headline names the game");
  assert(g.s.reason === "done", "finished normally");
  // Nothing moves after the end.
  const before = JSON.stringify(g.s);
  for (const id of g.s.seats) assert(act(g, id, L("h", 0, 0)) === false, "actions ignored after end");
  g.t.advance(60_000);
  assert(!tick(g), "tick idle after end");
  game.playerLeft!(g.s, g.s.seats[0], g.t.ctx);
  game.playerReturned!(g.s, g.s.seats[0], g.t.ctx);
  assert(JSON.stringify(g.s) === before, "finished state is frozen");
  assert(g.ends.length === 1, "still exactly one end");
}

// ---------- setup & board sizes ----------
{
  for (const [n, rows, cols, lines] of [
    [2, 5, 5, 60],
    [3, 5, 6, 71],
    [4, 6, 6, 84],
  ] as const) {
    const g = start(n);
    assert(g.s.rows === rows && g.s.cols === cols, `${n} players: ${cols}x${rows} boxes`);
    assert(g.s.h.length + g.s.v.length === lines, `${n} players: ${lines} lines`);
    assert(g.s.boxes.length === rows * cols && g.s.boxes.every((b) => b === -1), "empty boxes");
    assert(g.s.turn >= 0 && g.s.turn < n, "random first mover in range");
    assert(g.s.endsAt === now(g) + TURN_MS && g.s.turnMs === TURN_MS, "30s clock");
    assert(g.s.scores.every((x) => x === 0), "zero scores");
    invariants(g.s);
  }
  // The first mover varies with the seed.
  const firsts = new Set<number>();
  for (let seed = 1; seed <= 40; seed++) firsts.add(start(3, seed).s.turn);
  assert(firsts.size === 3, "every seat can start");
}

// ---------- line geometry ----------
{
  const g = start(3); // 5 rows x 6 cols
  const { rows, cols } = g.s;
  assert(lineIndex("h", rows, cols - 1, rows, cols) >= 0, "bottom-right h line valid");
  assert(lineIndex("h", 0, cols, rows, cols) === -1, "h col == cols invalid");
  assert(lineIndex("h", rows + 1, 0, rows, cols) === -1, "h row > rows invalid");
  assert(lineIndex("v", rows - 1, cols, rows, cols) >= 0, "right-edge v line valid");
  assert(lineIndex("v", rows, 0, rows, cols) === -1, "v row == rows invalid");
  assert(lineIndex("v", 0, cols + 1, rows, cols) === -1, "v col > cols invalid");
  const seen = new Set<string>();
  for (const l of allLines(rows, cols)) seen.add(`${l.o}${lineIndex(l.o, l.r, l.c, rows, cols)}`);
  assert(seen.size === 71, "line indices unique");
  assert(boxesBeside({ o: "h", r: 0, c: 2 }, rows, cols).join() === "2", "top edge touches one box");
  assert(boxesBeside({ o: "v", r: 1, c: 3 }, rows, cols).join() === "8,9", "inner v line touches two boxes");
}

// ---------- display colours never collide ----------
{
  const palette = ["#a", "#b", "#c", "#d", "#e"];
  assert(distinctColors(["#a", "#b", "#c"], palette).join() === "#a,#b,#c", "distinct colours untouched");
  const clash = distinctColors(["#a", "#a", "#b", "#a"], palette);
  assert(new Set(clash).size === 4, "clashing colours split up");
  assert(clash[0] === "#a" && clash[2] === "#b", "first owner keeps their colour");
  assert(!clash.slice(1).includes("#a"), "later duplicates borrow unused colours");
}

// ---------- turns, claiming, going again ----------
{
  const g = start(2);
  const [a, b] = [mover(g), g.s.seats[1 - g.s.turn]];
  assert(act(g, a, L("h", 0, 0)) === true, "first line accepted");
  assert(mover(g) === b, "turn passes without a box");
  assert(g.s.lastLine?.seat === g.s.seats.indexOf(a) && g.s.lastLine.claimed.length === 0, "lastLine recorded");
  g.t.advance(4000);
  assert(act(g, b, L("v", 0, 0)) === true && mover(g) === a, "back to A");
  assert(act(g, a, L("v", 0, 1)) === true && mover(g) === b, "A draws the third side and hands it over");
  assert(threeSided(g.s).join() === "0", "box 0 has three sides");
  g.t.advance(12_000);
  assert(act(g, b, L("h", 1, 0)) === true, "B closes box 0");
  const bSeat = g.s.seats.indexOf(b);
  assert(g.s.boxes[0] === bSeat && g.s.scores[bSeat] === 1, "box claimed by B");
  assert(mover(g) === b, "closing a box earns another move");
  assert(g.s.endsAt === now(g) + TURN_MS, "fresh clock for the extra move");
  assert(g.s.lastLine?.claimed.join() === "0" && g.s.lastLine.n === 4, "lastLine lists the claim");
  invariants(g.s);

  // Double box: one line closes two boxes at once.
  for (const [o, r, c] of [
    ["h", 2, 2],
    ["h", 3, 2],
    ["v", 2, 2],
    ["h", 2, 3],
    ["h", 3, 3],
    ["v", 2, 4],
  ] as const)
    put(g.s, o, r, c, 0);
  g.s.moves += 6;
  assert(act(g, b, L("v", 2, 3)) === true, "middle line accepted");
  assert(live(g).scores[bSeat] === 3 && live(g).lastLine?.claimed.length === 2, "double box scores two");
  assert(mover(g) === b, "and B goes again");
  invariants(g.s);
}

// ---------- hostile / invalid actions ----------
{
  const g = start(3);
  const m = mover(g);
  const other = g.s.seats.find((id) => id !== m)!;
  put(g.s, "h", 1, 1, 0);
  g.s.moves = 1;
  const snapshot = JSON.stringify(g.s);
  const bad: unknown[] = [
    null,
    undefined,
    0,
    42,
    "line",
    "x".repeat(100_000),
    true,
    [],
    ["line", "h", 0, 0],
    {},
    { type: "line" },
    { type: "LINE", o: "h", r: 0, c: 0 },
    { type: "line", o: "x", r: 0, c: 0 },
    { type: "line", o: "H", r: 0, c: 0 },
    { type: "line", o: ["h"], r: 0, c: 0 },
    { type: "line", o: "h".repeat(1_000_000), r: 0, c: 0 },
    { type: "line", o: "h", r: "0", c: 0 },
    { type: "line", o: "h", r: 0, c: "0" },
    { type: "line", o: "h", r: 0.5, c: 0 },
    { type: "line", o: "h", r: -1, c: 0 },
    { type: "line", o: "h", r: NaN, c: 0 },
    { type: "line", o: "h", r: Infinity, c: 0 },
    { type: "line", o: "h", r: 1e9, c: 0 },
    { type: "line", o: "h", r: 0, c: 6 }, // h col must be < cols
    { type: "line", o: "h", r: 6, c: 0 }, // h row must be <= rows
    { type: "line", o: "v", r: 5, c: 0 }, // v row must be < rows
    { type: "line", o: "v", r: 0, c: 7 }, // v col must be <= cols
    { type: "line", o: "h", r: 1, c: 1 }, // already drawn
    { type: "line", o: "h", r: null, c: null },
    { type: "line", o: "h", r: { valueOf: () => 0 }, c: 0 },
    { type: "back" }, // not idle
    { type: "place", cell: 3 },
    { type: ["line"], o: "h", r: 0, c: 0 },
  ];
  for (const a of bad) assert(act(g, m, a) === false, `rejected ${String(JSON.stringify(a)).slice(0, 60)}`);
  assert(act(g, other, L("h", 0, 0)) === false, "out of turn rejected");
  assert(act(g, "stranger", L("h", 0, 0)) === false, "non-participant rejected");
  assert(act(g, "spectator", { type: "back" }) === false, "spectator rejected");
  assert(JSON.stringify(g.s) === snapshot, "rejected actions change nothing");
  // Edge lines at the far ends are legal.
  assert(act(g, m, L("v", 4, 6)) === true, "bottom-right v line accepted");
  const m2 = mover(g);
  assert(act(g, m2, L("h", 5, 5)) === true, "bottom-right h line accepted");
  // Extra junk fields are ignored rather than trusted.
  const m3 = mover(g);
  assert(act(g, m3, { type: "line", o: "h", r: 0, c: 0, seat: 2, claimed: [1, 2], __proto__: { x: 1 } }) === true, "extra fields ignored");
  assert(g.s.lastLine?.claimed.length === 0, "claims computed by the server");
  invariants(g.s);
}

// ---------- full games (2, 3 and 4 players) ----------
{
  for (const n of [2, 3, 4]) {
    for (const seed of [1, 7, 99]) {
      const g = start(n, seed);
      playOut(g, policySmart(mulberry(seed * 13 + n)));
      checkFinished(g);
    }
    const g = start(n, 5);
    playOut(g, policyFirst);
    checkFinished(g);
  }
}

// ---------- headlines and ties ----------
{
  // 2 players: 25 boxes, a single winner.
  const g = start(2);
  buildBoard(g.s, [{ o: "h", r: 0, c: 0 }], (b) => (b % 2 === 1 ? 0 : 1)); // 12 boxes each, box 0 open
  g.s.turn = 0;
  assert(g.s.scores[0] === 12 && g.s.scores[1] === 12, "12-12 before the last box");
  assert(act(g, g.s.seats[0], L("h", 0, 0)) === true, "last line");
  assert(g.ends[0].headline === "Player0 wins Dots & Boxes 13–12", `headline: ${g.ends[0].headline}`);
  assert(g.ends[0].winners.join() === "p0", "single winner");
  assert(view(g, "p1").winners.join() === "0" && view(g, "p1").over, "view shows winners");
  checkFinished(g);
}
{
  // 3 players: three-way tie 10-10-10.
  const g = start(3);
  buildBoard(g.s, [{ o: "v", r: 4, c: 6 }], (b) => (b < 10 ? 0 : b < 20 ? 1 : 2)); // box 29 open
  g.s.turn = 2;
  assert(g.s.scores.join() === "10,10,9", "10-10-9 before the last box");
  assert(act(g, "p2", L("v", 4, 6)) === true, "last line");
  assert(g.ends[0].winners.length === 3, "everyone tied wins");
  assert(g.ends[0].headline === "Player0, Player1 & Player2 tie at Dots & Boxes 10–10–10", g.ends[0].headline);
  checkFinished(g);
}
{
  // 4 players: two-way tie 10-10-8-8.
  const g = start(4);
  buildBoard(g.s, [{ o: "h", r: 6, c: 5 }], (b) => (b < 10 ? 0 : b < 19 ? 1 : b < 27 ? 2 : 3)); // box 35 open
  g.s.turn = 1;
  assert(g.s.scores.join() === "10,9,8,8", "before the last box");
  assert(act(g, "p1", L("h", 6, 5)) === true, "last line");
  assert(g.ends[0].winners.join() === "p0,p1", "two winners");
  assert(g.ends[0].headline === "Player0 & Player1 tie at Dots & Boxes 10–10–8–8", g.ends[0].headline);
  checkFinished(g);
}

// ---------- move timer & auto-play ----------
{
  const g = start(2);
  const seat = g.s.turn;
  g.t.advance(TURN_MS - 1);
  assert(!tick(g), "no change before the deadline");
  assert(g.s.moves === 0, "nothing drawn yet");
  g.t.advance(1);
  assert(tick(g) === true, "deadline hit: auto-move");
  assert(live(g).moves === 1 && g.s.lastLine?.auto === true && g.s.lastLine.seat === seat, "line drawn for the mover");
  assert(g.s.strikes[seat] === 1, "one strike");
  assert(g.s.turn !== seat, "turn passed");
  assert(threeSided(g.s).length === 0, "auto-move gave nothing away");
  invariants(g.s);
}
{
  // Auto-play never hands out a box while a safe line exists.
  const g = start(3, 3);
  for (let i = 0; i < 30; i++) {
    const hadSafe = open(g.s).some((l) =>
      boxesBeside(l, g.s.rows, g.s.cols).every((b) => sideCount(g.s.h, g.s.v, b, g.s.cols) < 2),
    );
    if (!hadSafe) break;
    assert(timeout(g) === true, "auto-move happened");
    assert(threeSided(g.s).length === 0, `safe auto-move #${i}`);
    invariants(g.s);
  }
}
{
  // Auto-play takes a ready box (and keeps the move).
  const g = start(2);
  const seat = g.s.turn;
  for (const [o, r, c] of [
    ["h", 2, 2],
    ["h", 3, 2],
    ["v", 2, 2],
  ] as const)
    put(g.s, o, r, c, 1 - seat);
  g.s.moves = 3;
  assert(timeout(g), "timed out");
  assert(g.s.boxes[2 * 5 + 2] === seat && g.s.scores[seat] === 1, "auto-move closed the ready box");
  assert(g.s.turn === seat, "kept the move");
  assert(g.s.turnMs === TURN_MS && g.s.endsAt === now(g) + TURN_MS, "connected player (1 strike) still gets 30s");
  invariants(g.s);
}
{
  // With only bad options, auto-play sacrifices the smallest chain.
  const g = start(2);
  // Box 0 is a lone box (both open sides on the edge, costs 1);
  // boxes (2,4),(3,4),(4,4) form a 3-chain down the right edge (costs 3).
  const lone: LineRef[] = [
    { o: "h", r: 0, c: 0 },
    { o: "v", r: 0, c: 0 },
  ];
  const chain: LineRef[] = [
    { o: "v", r: 2, c: 5 },
    { o: "h", r: 3, c: 4 },
    { o: "h", r: 4, c: 4 },
    { o: "h", r: 5, c: 4 },
  ];
  buildBoard(g.s, [...lone, ...chain], (b) => b % 2);
  invariants(g.s);
  assert(threeSided(g.s).length === 0, "no ready boxes");
  for (let i = 0; i < 20; i++) {
    const pickLine = chooseAutoLine(g.s, mulberry(i))!;
    assert(lone.some((l) => l.o === pickLine.o && l.r === pickLine.r && l.c === pickLine.c), "sacrifices the lone box");
  }
  const before = [...g.s.scores];
  const seat = g.s.turn;
  const opp = 1 - seat;
  assert(timeout(g), "timeout");
  assert(g.s.turn === opp && threeSided(g.s).join() === "0", "lone box handed over");
  assert(timeout(g) && g.s.scores[opp] === before[opp] + 1 && g.s.turn === opp, "opponent's auto-move grabs it");
  assert(timeout(g) && g.s.turn === seat && threeSided(g.s).length >= 1, "then has to open the chain");
  let guard = 0;
  while (!g.s.over && guard++ < 10) {
    assert(timeout(g), "timeout");
    invariants(g.s);
  }
  assert(g.s.scores[seat] === before[seat] + 3, "the whole chain goes back the other way");
  checkFinished(g);
}
{
  // Two timeouts in a row mark a connected player idle; their next moves auto-play after 5s.
  const g = start(2);
  const seat = g.s.turn;
  const id = g.s.seats[seat];
  timeout(g); // seat strike 1
  assert(!view(g, id).idle[seat], "one miss is not idle");
  timeout(g); // other seat strike 1
  assert(g.s.turn === seat && g.s.turnMs === TURN_MS, "still a full clock after one miss");
  timeout(g); // seat strike 2
  assert(g.s.strikes[seat] === IDLE_STRIKES && view(g, id).idle[seat], "idle after two misses");
  timeout(g); // other seat
  assert(live(g).turn === seat && live(g).turnMs === AWAY_MS && g.s.endsAt === now(g) + AWAY_MS, "idle player gets 5s");
  g.t.advance(1000);
  assert(act(g, id, { type: "back" }) === true, "I'm back");
  assert(live(g).strikes[seat] === 0 && g.s.endsAt === now(g) + TURN_MS && live(g).turnMs === TURN_MS, "full clock restored");
  assert(act(g, id, { type: "back" }) === false, "back twice is a no-op");
  // Idle again, then a real move clears it.
  g.s.strikes[seat] = IDLE_STRIKES;
  const l = open(g.s)[0];
  assert(act(g, id, L(l.o, l.r, l.c)) === true && g.s.strikes[seat] === 0, "a real move clears idle");
  invariants(g.s);
}

// ---------- disconnects ----------
{
  // The mover drops: their move auto-plays 5s later.
  const g = start(3);
  const seat = g.s.turn;
  const id = mover(g);
  g.t.advance(2000);
  setConnected(g, id, false);
  assert(g.s.endsAt === now(g) + AWAY_MS && g.s.turnMs === AWAY_MS, "clock cut to 5s");
  assert(view(g, "p0").closeAt === null, "two others still here: no countdown");
  g.t.advance(AWAY_MS - 1);
  assert(!tick(g), "not yet");
  g.t.advance(1);
  assert(tick(g) && g.s.lastLine?.auto && g.s.lastLine.seat === seat, "auto-played for the absent player");
  assert(g.s.strikes[seat] === 0, "absence is not a strike");
  // Their next turn comes around with a 5s clock.
  while (g.s.turn !== seat) {
    const l = policySmart(mulberry(g.s.moves))(g.s);
    play(g, l);
  }
  assert(g.s.turnMs === AWAY_MS || g.s.turnMs === CHAIN_MS, "absent player's turn is short");
  // They come back mid-move: the rest of the normal clock returns.
  g.t.advance(1000);
  setConnected(g, id, true);
  assert(g.s.endsAt === g.s.moveStartedAt + TURN_MS && live(g).turnMs === TURN_MS, "clock restored on return");
  invariants(g.s);
}
{
  // Dropping while it's someone else's move doesn't touch their clock.
  const g = start(3);
  const other = g.s.seats.find((id) => id !== mover(g))!;
  const before = g.s.endsAt;
  setConnected(g, other, false);
  assert(g.s.endsAt === before, "mover's clock unchanged");
  setConnected(g, other, true);
  assert(g.s.endsAt === before, "still unchanged on return");
}
{
  // An absent player's auto-move that closes a box chains quickly.
  const g = start(2);
  const seat = g.s.turn;
  for (const [o, r, c] of [
    ["h", 0, 0],
    ["v", 0, 0],
    ["v", 0, 1],
    ["h", 0, 1],
    ["v", 0, 2],
  ] as const)
    put(g.s, o, r, c, 1 - seat);
  g.s.moves = 5;
  setConnected(g, mover(g), false);
  g.t.advance(AWAY_MS);
  assert(tick(g) && g.s.turn === seat && g.s.scores[seat] === 1, "absent player auto-closed a box");
  assert(g.s.turnMs === CHAIN_MS && g.s.endsAt === now(g) + CHAIN_MS, "follow-up auto-move is quick");
  g.t.advance(CHAIN_MS);
  assert(tick(g) && live(g).scores[seat] === 2, "chain continues");
  invariants(g.s);
}
{
  // Two players, one leaves for good: countdown, then a forfeit win.
  const g = start(2);
  const [stay, leave] = [g.s.seats[0], g.s.seats[1]];
  setConnected(g, leave, false);
  const closeAt = view(g, stay).closeAt;
  assert(closeAt === now(g) + ABANDON_MS, "countdown starts");
  // Coming back cancels it.
  g.t.advance(10_000);
  setConnected(g, leave, true);
  assert(view(g, stay).closeAt === null, "countdown cancelled");
  setConnected(g, leave, false);
  let guard = 0;
  while (!g.s.over && guard++ < 1000) {
    g.t.advance(250);
    tick(g);
    invariants(g.s);
  }
  assert(g.s.over && g.s.reason === "forfeit", "ended by forfeit");
  assert(now(g) - (closeAt! + 10_000) < 1000, "ended about 30s after the second drop");
  assert(g.ends.length === 1 && g.ends[0].winners.join() === stay, "the player who stayed wins");
  assert(g.ends[0].headline === "Player0 wins Dots & Boxes — Player1 left", g.ends[0].headline);
  assert(act(g, stay, L("h", 0, 0)) === false && !tick(g), "frozen after forfeit");
}
{
  // The countdown also follows presence changes the room makes without callbacks.
  const g = start(3);
  g.t.ctx.players[1].connected = false;
  g.t.ctx.players[2].connected = false;
  assert(tick(g) === true && view(g, "p0").closeAt === now(g) + ABANDON_MS, "tick notices");
  g.t.ctx.players[2].connected = true;
  assert(tick(g) === true && view(g, "p0").closeAt === null, "tick notices the return");
}
{
  // Everyone gone: ends with no winners, never stalls.
  const g = start(4);
  for (const id of g.s.seats) setConnected(g, id, false);
  let guard = 0;
  while (!g.s.over && guard++ < 10_000) {
    g.t.advance(250);
    tick(g);
  }
  assert(g.s.over && g.ends.length === 1 && g.ends[0].winners.length === 0, "abandoned game ends without winners");
  assert(g.ends[0].headline === "Dots & Boxes ended — everyone left", g.ends[0].headline);
}
{
  // Three players, one leaves: the game plays on and finishes with auto-moves for them.
  const g = start(3, 11);
  const gone = g.s.seats[1];
  setConnected(g, gone, false);
  const rand = mulberry(5);
  let guard = 0;
  while (!g.s.over && guard++ < 500) {
    if (mover(g) === gone) {
      g.t.advance(g.s.endsAt! - now(g));
      assert(g.s.turnMs <= AWAY_MS, "absent mover is on a short clock");
      tick(g);
    } else {
      g.t.advance(1500);
      play(g, policySmart(rand)(g.s));
    }
    invariants(g.s);
  }
  checkFinished(g);
}
{
  // Nobody ever moves: the game still completes through timeouts alone.
  for (const n of [2, 4]) {
    const g = start(n, 21);
    let guard = 0;
    while (!g.s.over && guard++ < 200) {
      assert(timeout(g) === true, "timeout always progresses");
      invariants(g.s);
    }
    checkFinished(g);
    assert(g.s.strikes.every((x) => x >= IDLE_STRIKES), "everyone ended up idle");
  }
}

// ---------- disconnect / reconnect at every stage ----------
{
  const g = start(2, 8);
  const rand = mulberry(8);
  let flips = 0;
  let guard = 0;
  while (!g.s.over && guard++ < 200) {
    // Toggle the non-mover, then the mover, around every few moves.
    if (g.s.moves % 5 === 0) {
      const id = g.s.seats[(g.s.turn + 1) % 2];
      setConnected(g, id, false);
      setConnected(g, id, true);
      setConnected(g, mover(g), false);
      setConnected(g, mover(g), true);
      flips++;
    }
    g.t.advance(500);
    play(g, policySmart(rand)(g.s));
    invariants(g.s);
  }
  assert(flips > 5, "exercised reconnects");
  checkFinished(g);
}

// ---------- views: public, serialisable, identical but for `you` ----------
{
  const g = start(3);
  play(g, open(g.s)[3]);
  setConnected(g, g.s.seats[2], false);
  const ids = [...g.s.seats, "spectator"];
  const views = ids.map((id) => view(g, id));
  for (const [i, v] of views.entries()) {
    const json = JSON.stringify(v);
    assert(JSON.stringify(JSON.parse(json)) === json, "JSON round-trips");
    assert(v.you === (i < 3 ? i : -1), "you = seat or -1");
    const strip = { ...v, you: 0 };
    assert(JSON.stringify(strip) === JSON.stringify({ ...views[0], you: 0 }), "same public view for everyone");
    for (const key of ["strikes", "moveStartedAt", "aloneSince"])
      assert(!json.includes(`"${key}"`), `internal field ${key} not exposed`);
  }
  const v = views[3];
  assert(v.h.length === 36 && v.v.length === 35 && v.boxes.length === 30, "compact arrays");
  assert(v.closeAt === null && v.turn >= 0 && v.endsAt! > 0 && v.lastLine?.n === 1, "live fields");
}

// ---------- degenerate player counts ----------
{
  // One participant (below the minimum): never throws and ends gracefully.
  const g = start(1);
  assert(g.s.rows === 5 && g.s.cols === 5, "smallest board");
  const id = g.s.seats[0];
  assert(act(g, id, L("h", 0, 0)) === true && mover(g) === id, "a lone player keeps moving");
  g.t.advance(ABANDON_MS);
  tick(g);
  assert(g.s.over && g.ends.length === 1 && g.ends[0].winners.join() === id, "ends by default");
}
{
  const g = start(0);
  assert(g.s.endsAt === null, "no clock without players");
  g.t.advance(ABANDON_MS + 1);
  tick(g);
  assert(g.s.over && g.ends.length === 1 && g.ends[0].winners.length === 0, "empty game ends");
}

// ---------- fuzz: hostile input, random timing and presence ----------
{
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const n = 2 + (seed % 3);
    const g = start(n, seed);
    const rand = mulberry(seed * 977);
    const junk = (): unknown => {
      const pickOne = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
      return pickOne<unknown>([
        null,
        "line",
        [],
        { type: "back" },
        { type: "line", o: pickOne(["h", "v", "d", 1]), r: Math.floor(rand() * 10) - 2, c: Math.floor(rand() * 10) - 2 },
        { type: "line", o: "h", r: rand() * 5, c: 0 },
      ]);
    };
    let guard = 0;
    while (!g.s.over && guard++ < 3000) {
      const roll = rand();
      const who = g.s.seats[Math.floor(rand() * n)];
      if (roll < 0.45) act(g, who, junk());
      else if (roll < 0.75) play(g, open(g.s)[Math.floor(rand() * open(g.s).length)]);
      else if (roll < 0.85) setConnected(g, who, !g.t.ctx.player(who)!.connected);
      else {
        g.t.advance(Math.floor(rand() * 40_000));
        tick(g);
      }
      invariants(g.s);
    }
    assert(g.s.over, `fuzz game ${seed} finished`);
    assert(g.ends.length === 1, "fuzz: exactly one end");
  }
}

// ---------- host settings ----------
{
  const t = makeTestCtx(2, 7, { board: "small", turnSec: 15 });
  const s: DotsState = game.setup(t.ctx);
  assert(s.rows === 4 && s.cols === 4, "small board is 4x4 for two");
  assert(s.turnMs === 15_000 && s.endsAt === t.ctx.now() + 15_000, "15s turn timer");
  const v = game.view(s, t.ids[0], t.ctx) as DotsView;
  assert(v.turnMs === 15_000, "view carries the configured timer");
  t.advance(15_000);
  game.tick!(s, t.ctx);
  assert(s.moves === 1, "move auto-played after 15s");
  const big: DotsState = game.setup(makeTestCtx(3, 1, { board: "large" }).ctx);
  assert(big.rows === 7 && big.cols === 8, "large board for three");
  const junk: DotsState = game.setup(makeTestCtx(2, 1, { board: "huge", turnSec: 7 }).ctx);
  assert(junk.rows === 5 && junk.turnMs === TURN_MS, "invalid settings fall back to defaults");
}

// ---------- practice bots ----------
for (const [n, bots] of [
  [2, 1],
  [4, 4],
  [3, 2],
] as const) {
  const t = makeTestCtx(n, 11 + n, {}, bots);
  const s: DotsState = game.setup(t.ctx);
  let guard = 0;
  let botMoves = 0;
  while (!t.result && guard++ < 20_000) {
    t.advance(100);
    game.tick!(s, t.ctx);
    for (const id of t.ids) {
      if (!t.ctx.player(id)?.bot) continue;
      const a = game.bot!(s, id, t.ctx);
      if (a) {
        assert(game.action(s, id, a, t.ctx) !== false, "bot move is legal");
        botMoves++;
      }
    }
    // The human (if any) plays a random line quickly.
    const m = s.seats[s.turn];
    if (!s.over && m && !t.ctx.player(m)?.bot) {
      const l = open(s)[0];
      act({ t, s, ends: [] }, m, L(l.o, l.r, l.c));
    }
  }
  assert(t.result, `bots finish a ${n}-player game`);
  assert(botMoves > 0, "bots moved themselves");
  assert(guard * 100 < 15 * 60_000, "bot game within 15 minutes");
}

console.log("dots: all tests passed");
