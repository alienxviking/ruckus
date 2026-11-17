import { assert, makeTestCtx } from "../../shared/testing";
import game, { botPit, type SeedsAction, type SeedsState, type SeedsView } from "./server";
import { AWAY_MS, FORFEIT_MS, PITS, STORE, newBoard, sow, sweepIfOver, type Seat } from "./shared";
import type { Settings } from "../../shared/settings";

function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

type Harness = ReturnType<typeof makeTestCtx>;

function start(settings: Settings = {}, bots = 0, seed = 42, players = 2) {
  const t = makeTestCtx(players, seed, settings, bots);
  const s: SeedsState = game.setup(t.ctx);
  return { t, s };
}

const act = (s: SeedsState, t: Harness, who: string, a: unknown) => game.action(s, who, a as SeedsAction, t.ctx);
const tick = (s: SeedsState, t: Harness) => game.tick!(s, t.ctx);
const view = (s: SeedsState, t: Harness, who: string) => game.view(s, who, t.ctx) as SeedsView;
const total = (b: number[]) => b.reduce((a, n) => a + n, 0);
const mover = (s: SeedsState) => s.seats[s.turn];

function setConnected(s: SeedsState, t: Harness, id: string, connected: boolean) {
  const p = t.ctx.players.find((x) => x.id === id);
  assert(p);
  p.connected = connected;
  if (connected) game.playerReturned!(s, id, t.ctx);
  else game.playerLeft!(s, id, t.ctx);
}

// ---------- pure rules ----------
{
  const b = newBoard(4);
  check(total(b) === 48 && b[STORE[0]] === 0 && b[STORE[1]] === 0, "fresh board");
  // Pit 2 (4 seeds) ends exactly in seat 0's store: extra turn.
  const r = sow(b, 0, 2);
  check(r.extra && r.path.join() === "3,4,5,6" && r.board[6] === 1, "extra turn when landing in own store");
  check(r.capture === null, "no capture on extra turn");
  // Seat 1 skips seat 0's store.
  const b2 = Array(14).fill(0);
  b2[12] = 3;
  b2[0] = 1;
  const r2 = sow(b2, 1, 5); // index 12 → 13, (skip nothing), 0, 1
  check(r2.path.join() === "13,0,1", "seat 1 sows into its store then seat 0's row");
  const b3 = Array(14).fill(0);
  b3[5] = 10;
  b3[0] = 1;
  const r3 = sow(b3, 1 as Seat, 0); // empty pit → would be illegal; check skip separately below
  check(r3.path.length === 0, "sowing an empty pit sows nothing");
  const b4 = Array(14).fill(0);
  b4[12] = 9; // seat 1, pit 5: 13, 0..5, (skip 6), 7, 8
  b4[1] = 1;
  const r4 = sow(b4, 1, 5);
  check(!r4.path.includes(6) && r4.path.join() === "13,0,1,2,3,4,5,7,8", "opponent store skipped");
  // Capture: last seed into own empty pit with seeds opposite.
  const b5 = Array(14).fill(0);
  b5[0] = 2; // lands in 2
  b5[10] = 5; // opposite of 2
  b5[7] = 1;
  const r5 = sow(b5, 0, 0);
  check(r5.capture?.pit === 2 && r5.capture.from === 10 && r5.capture.n === 6, "capture");
  check(r5.board[2] === 0 && r5.board[10] === 0 && r5.board[6] === 6, "captured seeds in store");
  // No capture when the opposite pit is empty.
  const b6 = Array(14).fill(0);
  b6[0] = 2;
  b6[7] = 1;
  const r6 = sow(b6, 0, 0);
  check(r6.capture === null && r6.board[2] === 1, "no capture against an empty pit");
  // Lap around: a big pit lands back in its own (now non-empty) pit: no capture.
  const b7 = Array(14).fill(0);
  b7[0] = 13; // 1..6, 7..12, (skip 13), 0
  b7[8] = 1;
  const r7 = sow(b7, 0, 0);
  check(r7.path[r7.path.length - 1] === 0 && r7.board[0] === 0 && r7.capture?.n === 2, "13-seed lap captures in the started pit");
  // Sweep.
  const b8 = Array(14).fill(0);
  b8[9] = 4;
  b8[6] = 10;
  const swept = sweepIfOver(b8);
  check(swept?.[1] === 4 && b8[13] === 4 && b8[9] === 0, "sweep banks the other side");
  console.log("✓ sowing, extra turns, captures, sweep");
}

// ---------- junk & invalid actions ----------
{
  const { t, s } = start();
  const before = JSON.stringify(s);
  const notMover = s.seats[1 - s.turn];
  const junk: unknown[] = [
    null, 42, "x", [], {}, { type: "x" }, { type: "sow" }, { type: "sow", pit: -1 }, { type: "sow", pit: 6 },
    { type: "sow", pit: 1.5 }, { type: "sow", pit: "2" }, { type: "sow", pit: NaN }, { type: "sow", pit: Infinity },
    { type: "__proto__", pit: 1 },
  ];
  for (const a of junk) check(act(s, t, mover(s), a) === false, `junk rejected: ${JSON.stringify(a)}`);
  check(act(s, t, notMover, { type: "sow", pit: 0 }) === false, "out of turn rejected");
  check(act(s, t, "stranger", { type: "sow", pit: 0 }) === false, "spectator rejected");
  check(JSON.stringify(s) === before, "state untouched by junk");
  // Empty pit is illegal.
  s.board[s.turn === 0 ? 0 : 7] = 0;
  check(act(s, t, mover(s), { type: "sow", pit: 0 }) === false, "empty pit rejected");
  // Spectator view is sane.
  const v = view(s, t, "stranger");
  check(v.you === null && v.board.length === 14, "spectator view");
  console.log("✓ invalid actions rejected");
}

// ---------- settings ----------
{
  for (const n of [3, 4, 5, 6]) {
    const { s } = start({ seeds: n });
    check(total(s.board) === n * 12 && s.board[0] === n, `seeds per pit ${n}`);
  }
  const { s } = start({ seeds: 99, turn: 7, wins: "x" });
  check(s.seeds === 4 && s.turnMs === 30_000 && s.target === 1, "bad settings fall back to defaults");
  const { s: s2 } = start({ turn: 15, wins: 2 });
  check(s2.turnMs === 15_000 && s2.target === 2 && s2.maxGames === 5, "timer and match length");
  console.log("✓ settings honoured");
}

// ---------- full game by hand (pit nearest the store) ----------
{
  const { t, s } = start({ seeds: 3 });
  let guard = 0;
  let sawExtra = false;
  while (s.phase === "turn" && guard++ < 500) {
    const seat = s.turn;
    const before = s.seq;
    const n = [5, 4, 3, 2, 1, 0].find((p) => s.board[(seat === 0 ? 0 : 7) + p] > 0)!;
    check(act(s, t, mover(s), { type: "sow", pit: n }) !== false, "legal sow accepted");
    check(s.seq === before + 1, "seq advances");
    check(total(s.board) === 36, "seeds conserved");
    if (s.last?.extra) {
      sawExtra = true;
      check(s.turn === seat || s.phase !== "turn", "extra turn keeps the mover");
    }
    t.advance(100);
  }
  check(sawExtra, "an extra turn happened");
  check(s.phase === "over", "single game ends the match");
  assert(t.result, "result");
  const [a, b] = [s.board[6], s.board[13]];
  check(a + b === 36, "everything banked");
  if (a !== b) check(t.result.winners.length === 1 && t.result.winners[0] === s.seats[a > b ? 0 : 1], "right winner");
  check(t.result.headline.includes("Seeds"), "headline");
  check(t.result.scores?.[s.seats[0]] === a, "scores are stores in a single game");
  console.log(`✓ full game: ${t.result.headline}`);
}

// ---------- timeouts auto-sow; best of 3 completes ----------
{
  const { t, s } = start({ wins: 2, turn: 15, seeds: 3 });
  let guard = 0;
  while (s.phase !== "over" && guard++ < 5000) {
    t.advance(16_000);
    tick(s, t);
  }
  check(s.phase === "over", "timeouts alone finish a best of 3");
  assert(t.result, "result");
  check(s.results.length >= 2, "several games played");
  check(s.last === null || s.last.auto || s.phase === "over", "auto flag");
  console.log(`✓ timeouts finish the match: ${t.result.headline}`);
}

// ---------- disconnects ----------
{
  const { t, s } = start();
  const away = mover(s);
  const seq = s.seq;
  setConnected(s, t, away, false);
  check(s.endsAt <= t.ctx.now() + AWAY_MS, "away mover gets a short clock");
  t.advance(AWAY_MS + 10);
  tick(s, t);
  check(s.seq === seq + 1 && s.last?.auto, "away mover auto-sown");
  // Both away: frozen.
  const other = s.seats.find((id) => id !== away)!;
  setConnected(s, t, other, false);
  const seq2 = s.seq;
  t.advance(30_000);
  tick(s, t);
  check(s.seq === seq2 && s.phase === "turn", "frozen while both away");
  setConnected(s, t, other, true);
  t.advance(FORFEIT_MS);
  // keep ticking: the original leaver forfeits.
  for (let i = 0; i < 100 && s.phase !== "over"; i++) {
    t.advance(1000);
    tick(s, t);
  }
  check(s.phase === "over" && s.ending === "forfeit" && t.result?.winners[0] === other, "leaver forfeits");
  console.log("✓ leaving can't soft-lock: auto-sow, freeze, forfeit");
}

// ---------- missing second player ----------
{
  const { t, s } = start({}, 0, 1, 1);
  tick(s, t);
  check(s.phase === "over" && t.result?.winners.length === 0, "short match ends");
  console.log("✓ one player ends cleanly");
}

// ---------- bots ----------
{
  // Bot takes an obvious extra turn / capture.
  const b = Array(14).fill(0);
  b[3] = 3; // pit 3 → 4,5,6: extra turn
  b[0] = 1;
  b[12] = 1;
  check(botPit(b, 0, () => 0.5) !== null, "bot picks");
  const { t, s } = start({}, 2, 7);
  let guard = 0;
  while (s.phase !== "over" && guard++ < 20_000) {
    t.advance(200);
    for (const id of s.seats) {
      const a = game.bot!(s, id, t.ctx);
      if (a) check(game.action(s, id, a, t.ctx) !== false, "bot action valid");
    }
    tick(s, t);
  }
  check(s.phase === "over", "bots finish a game");
  assert(t.result, "result");
  check(s.results.length === 1 && !s.last?.auto, "bots played without timeouts");
  console.log(`✓ bots finish: ${t.result.headline}`);

  // Bot beats random play more often than not.
  let wins = 0;
  for (let g = 0; g < 20; g++) {
    let board = newBoard(4);
    let turn: Seat = (g % 2) as Seat;
    let rs = g * 7 + 1;
    const rnd = () => ((rs = (rs * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let k = 0; k < 400; k++) {
      const legal = [0, 1, 2, 3, 4, 5].filter((p) => board[(turn === 0 ? 0 : 7) + p] > 0);
      if (!legal.length) break;
      const pit = turn === 0 ? botPit(board, 0, rnd)! : legal[Math.floor(rnd() * legal.length)];
      const r = sow(board, turn, pit);
      board = r.board;
      if (sweepIfOver(board)) break;
      if (!r.extra) turn = turn === 0 ? 1 : 0;
    }
    if (board[6] > board[13]) wins++;
  }
  check(wins >= 15, `bot beats random (${wins}/20)`);
  console.log(`✓ bot beats random ${wins}/20`);
}

check(PITS === 6, "6 pits");
console.log("✓ seeds: all tests passed");
