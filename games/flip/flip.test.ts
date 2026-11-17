import { assert, makeTestCtx } from "../../shared/testing";
import game, { botPick, weights, type FlipAction, type FlipState, type FlipView } from "./server";
import { AWAY_MS, FORFEIT_MS, PAUSE_MS, TURN_MS, countDiscs, flipsFor, legalMoves, parseBoard, startBoard } from "./shared";
import type { Settings } from "../../shared/settings";

function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

type Harness = ReturnType<typeof makeTestCtx>;

function start(settings: Settings = {}, seed = 42, players = 2, bots = 0) {
  const t = makeTestCtx(players, seed, settings, bots);
  const s: FlipState = game.setup(t.ctx);
  return { t, s };
}
const act = (s: FlipState, t: Harness, who: string, a: unknown) => game.action(s, who, a as FlipAction, t.ctx);
const view = (s: FlipState, t: Harness, who: string) => game.view(s, who, t.ctx) as FlipView;
const tick = (s: FlipState, t: Harness) => game.tick!(s, t.ctx);
const mover = (s: FlipState) => s.seats[s.turn];

/** Play greedy-first legal moves until the game (or match) is over. */
function playOut(s: FlipState, t: Harness, maxMoves = 400) {
  for (let i = 0; i < maxMoves && s.phase !== "over"; i++) {
    if (s.phase === "between") {
      t.advance(PAUSE_MS);
      tick(s, t);
      continue;
    }
    const moves = legalMoves(s.board, s.size, s.turn);
    check(moves.length > 0, "the player to move always has a move");
    check(act(s, t, mover(s), { type: "place", cell: moves[0] }) !== false, "legal move accepted");
  }
}

// ---------- pure logic ----------
{
  const b = startBoard(8, 0);
  check(countDiscs(b)[0] === 2 && countDiscs(b)[1] === 2, "4 discs to start");
  const m = legalMoves(b, 8, 0);
  check(m.length === 4, "4 opening moves");
  for (const c of m) check(flipsFor(b, 8, c, 0).length === 1, "each opening move flips one");
  check(flipsFor(b, 8, 0, 0).length === 0, "corner not legal at start");
  check(flipsFor(b, 8, 27, 0).length === 0, "occupied not legal");
  check(flipsFor(b, 8, -1, 0).length === 0 && flipsFor(b, 8, 64, 0).length === 0, "out of range");
  const w = weights(8);
  check(w[0] === 100 && w[9] === -40 && w[1] === -15, "weight table");
  console.log("✓ board logic");
}

// ---------- full game to completion ----------
{
  const { t, s } = start();
  check(s.size === 8 && s.board.length === 64, "8x8 default");
  check(s.hints === true, "hints on by default");
  const v0 = view(s, t, "p0");
  check(v0.board.length === 64 && parseBoard(v0.board).join("") === s.board.join(""), "board string round-trips");
  check(v0.you === 0 && view(s, t, "spectator").you === null, "seats in view");
  playOut(s, t);
  assert(t.result, "game ended");
  const [a, b] = countDiscs(s.board);
  check(s.finals[0][0] === a && s.finals[0][1] === b, "final counted");
  if (a !== b) check(t.result.winners.length === 1 && t.result.winners[0] === s.seats[a > b ? 0 : 1], "most discs wins");
  else check(t.result.winners.length === 0, "draw = no winners");
  check(t.result.scores?.p0 === a && t.result.scores?.p1 === b, "single game scored in discs");
  check(/Flip/.test(t.result.headline), "headline");
  console.log(`✓ full game: ${a}-${b} · ${t.result.headline}`);
}

// ---------- invalid actions ----------
{
  const { t, s } = start();
  const before = JSON.stringify(s);
  const wrong = s.seats[1 - s.turn];
  const junk: unknown[] = [
    null,
    42,
    "x",
    [],
    {},
    { type: "place" },
    { type: "place", cell: "19" },
    { type: "place", cell: 1.5 },
    { type: "place", cell: -1 },
    { type: "place", cell: 64 },
    { type: "place", cell: Infinity },
    { type: "place", cell: NaN },
    { type: "place", cell: 0 }, // not a legal move
    { type: "place", cell: 27 }, // occupied
    { type: "drop", col: 1 },
    { type: "__proto__" },
  ];
  for (const a of junk) check(act(s, t, mover(s), a) === false, `junk rejected: ${JSON.stringify(a)}`);
  const legal = legalMoves(s.board, s.size, s.turn)[0];
  check(act(s, t, wrong, { type: "place", cell: legal }) === false, "out of turn rejected");
  check(act(s, t, "stranger", { type: "place", cell: legal }) === false, "spectator rejected");
  check(JSON.stringify(s) === before, "state unchanged by junk");
  console.log("✓ invalid actions rejected");
}

// ---------- settings honoured ----------
{
  const { t, s } = start({ size: 6, hints: "off", wins: 2 });
  check(s.size === 6 && s.board.length === 36, "6x6 board");
  check(view(s, t, "p0").board.length === 36, "6x6 view");
  check(s.hints === false && view(s, t, "p0").hints === false, "hints off");
  check(s.target === 2 && s.maxGames === 5, "best of 3");
  const firstStarter = s.starter;
  playOut(s, t, 30);
  // play the first game out, then make sure the next one starts with the other player
  while (s.phase === "turn") {
    const moves = legalMoves(s.board, s.size, s.turn);
    act(s, t, mover(s), { type: "place", cell: moves[0] });
  }
  if (s.phase === "between") {
    t.advance(PAUSE_MS);
    tick(s, t);
    check(s.game === 2 && s.starter !== firstStarter && s.turn === s.starter, "starter alternates");
    check(countDiscs(s.board)[0] === 2 && countDiscs(s.board)[1] === 2, "fresh board");
  }
  playOut(s, t, 2000);
  assert(t.result, "match ended");
  check(s.results.length >= 2, "at least two games in best of 3");
  const { t: t2, s: s2 } = start({ size: 7, hints: 3, wins: 9 });
  check(s2.size === 8 && s2.hints && s2.target === 1, "invalid settings fall back to defaults");
  void t2;
  console.log("✓ settings honoured");
}

// ---------- pass handling ----------
{
  const { t, s } = start({ size: 6 });
  // Row 0: [0 1 . ...], row 5: [0 1 . ...]. Seat 0 plays a1-c1, after which seat 1 can't move.
  s.board = Array(36).fill(0);
  s.board[0] = 1;
  s.board[1] = 2;
  s.board[30] = 1;
  s.board[31] = 2;
  s.turn = 0;
  s.phase = "turn";
  const ok = act(s, t, s.seats[0], { type: "place", cell: 2 });
  check(ok !== false, "move accepted");
  check(legalMoves(s.board, 6, 1).length === 0, "seat 1 has no move");
  check(s.pass === 1 && s.turn === 0 && s.phase === "turn", "seat 1 passes, seat 0 again");
  check(view(s, t, "p1").pass === 1, "pass visible");
  act(s, t, s.seats[0], { type: "place", cell: 32 });
  check((s.phase as string) === "over", "nobody can move: game over");
  assert(t.result && t.result.winners[0] === s.seats[0], "seat 0 wins with all discs");
  console.log("✓ pass and end when neither can move");
}

// ---------- timer auto-move ----------
{
  const { t, s } = start();
  const seq = s.seq;
  t.advance(TURN_MS - 10);
  tick(s, t);
  check(s.seq === seq, "no auto-move before the timer");
  t.advance(20);
  tick(s, t);
  check(s.seq === seq + 1 && s.last?.auto === true, "auto-move on timeout");
  console.log("✓ turn timer auto-moves");
}

// ---------- leaving doesn't soft-lock ----------
{
  const { t, s } = start();
  const away = mover(s);
  t.ctx.players.find((p) => p.id === away)!.connected = false;
  game.playerLeft!(s, away, t.ctx);
  const seq = s.seq;
  t.advance(AWAY_MS + 1);
  tick(s, t);
  check(s.seq === seq + 1 && s.last?.auto, "away mover auto-played after 5s");
  check(view(s, t, "p0").forfeitAt[s.seats.indexOf(away)] !== null, "forfeit countdown shown");
  // Keep going until the forfeit.
  for (let i = 0; i < 40 && s.phase !== "over"; i++) {
    if (s.phase === "turn" && mover(s) !== away) {
      const m = legalMoves(s.board, s.size, s.turn);
      act(s, t, mover(s), { type: "place", cell: m[0] });
    }
    t.advance(AWAY_MS + 1);
    tick(s, t);
  }
  assert(t.result, "match ended by forfeit");
  check(t.result.winners.length === 1 && t.result.winners[0] !== away, "the one who stayed wins");
  check(/left/.test(t.result.headline), "forfeit headline");
  console.log("✓ away player auto-moves, then forfeits");
}
{
  // Both away: frozen, then abandoned.
  const { t, s } = start();
  for (const id of s.seats) {
    t.ctx.players.find((p) => p.id === id)!.connected = false;
    game.playerLeft!(s, id, t.ctx);
  }
  const seq = s.seq;
  t.advance(AWAY_MS * 3);
  tick(s, t);
  check(s.seq === seq, "frozen while both away");
  t.advance(FORFEIT_MS);
  tick(s, t);
  assert(t.result && t.result.winners.length === 0, "abandoned");
  console.log("✓ both away: frozen then abandoned");
}
{
  // Returning in time restores the clock.
  const { t, s } = start();
  const id = mover(s);
  const p = t.ctx.players.find((x) => x.id === id)!;
  p.connected = false;
  game.playerLeft!(s, id, t.ctx);
  check(s.timerMs === AWAY_MS, "short clock while away");
  p.connected = true;
  game.playerReturned!(s, id, t.ctx);
  check(s.timerMs === TURN_MS, "full clock on return");
  // syncPresence picks up a missed hook
  p.connected = false;
  tick(s, t);
  check(s.awaySince[s.turn] !== null, "presence synced from ctx");
  console.log("✓ reconnect restores the clock");
}
{
  // One player only: ends quickly.
  const { t, s } = start({}, 1, 1);
  tick(s, t);
  assert(t.result && t.result.winners.length === 0, "short game ends");
  console.log("✓ 1 player ends cleanly");
}

// ---------- bots ----------
for (const size of [8, 6]) {
  const { t, s } = start({ size }, 7, 2, 2);
  let steps = 0;
  while (!t.result && steps++ < 20000) {
    t.advance(200);
    for (const id of s.seats) {
      const a = game.bot!(s, id, t.ctx);
      if (a) check(game.action(s, id, a, t.ctx) !== false, "bot moves are legal");
    }
    tick(s, t);
  }
  assert(t.result, `bots finish a ${size}x${size} game`);
  check(!s.last?.auto, "bots never time out");
  console.log(`✓ bots finish ${size}x${size}: ${t.result.headline} (${(steps * 200) / 1000}s game time)`);
}
{
  // The bot grabs an available corner.
  const b = Array(64).fill(0);
  b[9] = 2; // X-square held by seat 1
  b[18] = 1;
  b[27] = 1;
  b[28] = 2;
  let corner = 0;
  for (let i = 0; i < 20; i++) if (botPick(b, 8, 0, Math.random) === 0) corner++;
  check(corner === 20, "bot takes the corner");
  // Bot beats a random mover most of the time.
  let wins = 0;
  for (let g = 0; g < 10; g++) {
    const { t, s } = start({}, 100 + g);
    while (!t.result) {
      const moves = legalMoves(s.board, s.size, s.turn);
      const cell = s.turn === 0 ? botPick(s.board, s.size, 0, t.ctx.random)! : moves[Math.floor(t.ctx.random() * moves.length)];
      act(s, t, mover(s), { type: "place", cell });
    }
    if (t.result.winners[0] === s.seats[0]) wins++;
  }
  check(wins >= 7, `bot beats random play (${wins}/10)`);
  console.log(`✓ bot strength: beat random ${wins}/10`);
}

console.log("✓ flip: all tests passed");
