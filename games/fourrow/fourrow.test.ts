import { assert, makeTestCtx } from "../../shared/testing";
import game, {
  findWin,
  landingRow,
  type Disc,
  type FourAction,
  type FourState,
  type FourView,
  type HoverEvent,
  type Seat,
} from "./server";
import { AWAY_MS, COLS, FORFEIT_MS, MAX_GAMES, PAUSE_MS, ROWS, TARGET_WINS, TURN_MS } from "./shared";
import { colorDistance, discPalette } from "./board";

// ---------- helpers ----------

/**
 * Like assert(), but without TypeScript narrowing: the game mutates state behind
 * the compiler's back, so "phase is between" must not make "phase is turn" later
 * look impossible. assert() is used where narrowing is actually wanted.
 */
function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

type Harness = ReturnType<typeof makeTestCtx>;

function start(players = 2, seed = 42) {
  const t = makeTestCtx(players, seed);
  let endCalls = 0;
  const realEnd = t.ctx.end;
  t.ctx.end = (r) => {
    endCalls++;
    realEnd(r);
  };
  const s: FourState = game.setup(t.ctx);
  return { t, s, ends: () => endCalls };
}

const tick = (s: FourState, t: Harness) => game.tick!(s, t.ctx);
const act = (s: FourState, t: Harness, who: string, a: unknown) => game.action(s, who, a as FourAction, t.ctx);
const view = (s: FourState, t: Harness, who: string) => game.view(s, who, t.ctx) as FourView;
const snap = (s: FourState) => JSON.stringify(s);
const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
const mover = (s: FourState) => s.seats[s.turn];

function play(s: FourState, t: Harness, cols: number[]) {
  for (const col of cols) {
    const ok = act(s, t, mover(s), { type: "drop", col });
    check(ok !== false, `drop in column ${col} accepted`);
  }
}

function setConnected(s: FourState, t: Harness, id: string, connected: boolean, hooks = true) {
  const p = t.ctx.players.find((x) => x.id === id);
  assert(p, `player ${id} exists`);
  p.connected = connected;
  if (!hooks) return;
  if (connected) game.playerReturned!(s, id, t.ctx);
  else game.playerLeft!(s, id, t.ctx);
}

function toNextGame(s: FourState, t: Harness) {
  check(s.phase === "between", "in the pause between games");
  t.advance(PAUSE_MS);
  check(tick(s, t) === true, "tick starts the next game");
  check(s.phase === "turn", "next game running");
}

function emptyBoard(): Disc[][] {
  return Array.from({ length: ROWS }, () => Array<Disc>(COLS).fill(null));
}

function sameCells(a: [number, number][], b: [number, number][]) {
  const key = (cells: [number, number][]) => cells.map(([r, c]) => `${r},${c}`).sort().join(" ");
  return key(a) === key(b);
}

/** Every disc rests on another disc or the floor. */
function assertGravity(board: Disc[][], label: string) {
  check(board.length === ROWS && board.every((row) => row.length === COLS), `${label}: board is ${ROWS}x${COLS}`);
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS - 1; r++) {
      if (board[r][c] !== null) check(board[r + 1][c] !== null, `${label}: floating disc at ${r},${c}`);
    }
  }
}

function anyWinOnBoard(board: Disc[][]) {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (findWin(board, r, c)) return true;
  return false;
}

// Move sequences (columns, starting with the starter).
const STARTER_VERTICAL = [0, 1, 0, 1, 0, 1, 0]; // starter: column 0, rows 5..2
const SECOND_VERTICAL = [0, 1, 2, 1, 3, 1, 0, 1]; // second player: column 1, rows 5..2
const HORIZONTAL = [0, 0, 1, 1, 2, 2, 3]; // starter: bottom row, columns 0..3
const DIAG_UP = [0, 1, 1, 2, 3, 2, 2, 3, 4, 3, 3]; // starter: (5,0) (4,1) (3,2) (2,3)
const DIAG_DOWN = DIAG_UP.map((c) => COLS - 1 - c); // starter: (2,3) (3,4) (4,5) (5,6)
const FIVE = [0, 0, 1, 1, 3, 3, 4, 4, 2]; // starter: bottom row, columns 0..4

// A full board with no four anywhere: colour = (floor(col / 2) + heightFromFloor) % 2,
// where colour 0 belongs to the game's starter. Runs are at most 2 long in every direction.
const drawColour = (col: number, height: number) => (Math.floor(col / 2) + height) % 2;

/** An order of columns that fills the draw pattern with strictly alternating turns. */
const DRAW_ORDER: number[] = (() => {
  const heights = Array<number>(COLS).fill(0);
  const order: number[] = [];
  const dead = new Set<number>();
  const dfs = (): boolean => {
    if (order.length === ROWS * COLS) return true;
    const key = heights.reduce((k, h) => k * (ROWS + 1) + h, 0);
    if (dead.has(key)) return false;
    const want = order.length % 2;
    for (let c = 0; c < COLS; c++) {
      if (heights[c] >= ROWS || drawColour(c, heights[c]) !== want) continue;
      heights[c]++;
      order.push(c);
      if (dfs()) return true;
      heights[c]--;
      order.pop();
    }
    dead.add(key);
    return false;
  };
  check(dfs(), "found an alternating order for the drawn board");
  return order;
})();

function winGame(s: FourState, t: Harness, winner: Seat) {
  play(s, t, winner === s.starter ? STARTER_VERTICAL : SECOND_VERTICAL);
  check(s.win?.seat === winner, "expected seat won the game");
}

function drawGame(s: FourState, t: Harness) {
  const before = [...s.score];
  play(s, t, DRAW_ORDER);
  check(s.results[s.results.length - 1] === null, "game recorded as a draw");
  check(s.win === null, "no winning line on a draw");
  check(s.score[0] === before[0] && s.score[1] === before[1], "draws don't score");
}

// ---------- setup, views, secrecy ----------
{
  const { t, s } = start();
  const now = t.ctx.now();
  check(s.seats[0] === "p0" && s.seats[1] === "p1", "seats follow join order");
  check(s.board.length === ROWS && s.board.every((r) => r.length === COLS && r.every((c) => c === null)), "empty 6x7 board");
  check(s.phase === "turn" && s.turn === s.starter, "starter moves first");
  check(s.endsAt === now + TURN_MS && s.timerMs === TURN_MS, "30s turn clock");
  check(s.score[0] === 0 && s.score[1] === 0 && s.game === 1 && s.results.length === 0, "fresh match");

  const v0 = view(s, t, "p0");
  const v1 = view(s, t, "p1");
  const vs = view(s, t, "spectator");
  check(v0.you === 0 && v1.you === 1 && vs.you === null, "you = seat, null for spectators");
  check(v0.target === TARGET_WINS && v0.maxGames === MAX_GAMES, "rules in view");
  // Four in a Row has no hidden information: every view is identical except `you`,
  // and server-only bookkeeping never leaves the server.
  const strip = (v: FourView) => JSON.stringify({ ...v, you: null });
  check(strip(v0) === strip(v1) && strip(v1) === strip(vs), "players and spectators see the same board");
  for (const v of [v0, v1, vs]) {
    const json = JSON.stringify(v);
    for (const secret of ["awaySince", "turnStartedAt", "hoverCount", "hoverWindow"]) {
      check(!json.includes(secret), `view does not leak ${secret}`);
    }
    check(JSON.stringify(JSON.parse(json)) === json, "view survives a JSON round-trip");
    check(json.length < 2000, "view is small");
  }
  play(s, t, [3, 3, 4]);
  const later = JSON.stringify(view(s, t, "spectator"));
  check(later.length < 2000, "view stays small mid-game");
}

// Starter is random, and alternates every game.
{
  const starters = new Set<number>();
  for (let seed = 1; seed <= 12; seed++) starters.add(start(2, seed).s.starter);
  check(starters.size === 2, "either seat can start the match");

  const { t, s } = start(2, 3);
  const seen: Seat[] = [s.starter];
  for (let g = 0; g < 4; g++) {
    drawGame(s, t);
    toNextGame(s, t);
    check(s.turn === s.starter, "new starter opens the game");
    seen.push(s.starter);
  }
  for (let i = 1; i < seen.length; i++) check(seen[i] === other(seen[i - 1]), "starter alternates each game");
}

// ---------- gravity, turns, early advance ----------
{
  const { t, s } = start();
  const first = s.turn;
  t.advance(12_000);
  play(s, t, [3]);
  check(s.board[ROWS - 1][3] === first, "disc lands on the floor");
  check(s.last?.row === ROWS - 1 && s.last!.col === 3 && s.last.seat === first && !s.last.auto, "last move recorded");
  check(s.turn === other(first), "turn passes");
  check(s.endsAt === t.ctx.now() + TURN_MS, "a move ends the turn early and restarts the clock");
  play(s, t, [3, 3]);
  check(s.board[ROWS - 2][3] === other(first) && s.board[ROWS - 3][3] === first, "discs stack upward");
  check(s.seq === 3 && s.moves === 3, "move counters");
  assertGravity(s.board, "stacking");
  check(landingRow(s.board, 3) === ROWS - 4 && landingRow(s.board, 0) === ROWS - 1, "landingRow");
}

// ---------- hostile and invalid actions ----------
{
  const { t, s } = start();
  const me = mover(s);
  const them = s.seats[other(s.turn)];
  const before = snap(s);
  const junk: unknown[] = [
    null,
    undefined,
    "drop",
    "",
    42,
    true,
    [],
    [{ type: "drop", col: 3 }],
    {},
    { type: "drop" },
    { type: "drop", col: "3" },
    { type: "drop", col: 3.5 },
    { type: "drop", col: -1 },
    { type: "drop", col: COLS },
    { type: "drop", col: NaN },
    { type: "drop", col: Infinity },
    { type: "drop", col: 1e12 },
    { type: "drop", col: null },
    { type: "drop", col: [3] },
    { type: "drop", col: { valueOf: 3 } },
    { type: "DROP", col: 3 },
    { type: "x".repeat(100_000), col: 3 },
    { type: ["drop"], col: 3 },
    { type: "hover", col: 9 },
    { type: "hover", col: "2" },
    { type: "hover" },
    { type: "place", cell: 4 },
  ];
  for (const a of junk) check(act(s, t, me, a) === false, `rejected ${JSON.stringify(a)?.slice(0, 40)}`);
  check(act(s, t, them, { type: "drop", col: 3 }) === false, "out of turn rejected");
  for (const id of ["stranger", "spectator", "", "P0"]) {
    check(act(s, t, id, { type: "drop", col: 3 }) === false, `non-player ${JSON.stringify(id)} rejected`);
  }
  check(game.action(s, undefined as unknown as string, { type: "drop", col: 3 }, t.ctx) === false, "missing id rejected");
  check(snap(s) === before, "rejected actions change nothing");
  check(t.events.length === 0, "rejected actions emit nothing");

  // Full column.
  play(s, t, [0, 0, 0, 0, 0, 0]);
  check(s.board.every((row) => row[0] !== null), "column 0 full (alternating, no win)");
  const full = snap(s);
  check(act(s, t, mover(s), { type: "drop", col: 0 }) === false, "full column rejected");
  check(snap(s) === full, "full column changes nothing");
  // Extra fields on a valid action are harmless.
  check(act(s, t, mover(s), { type: "drop", col: 1, junk: "x".repeat(50_000) }) !== false, "extra fields ignored");
}

// ---------- win detection in all four directions ----------
{
  const cases: { name: string; cols: number[]; cells: [number, number][] }[] = [
    { name: "vertical", cols: STARTER_VERTICAL, cells: [[5, 0], [4, 0], [3, 0], [2, 0]] },
    { name: "horizontal", cols: HORIZONTAL, cells: [[5, 0], [5, 1], [5, 2], [5, 3]] },
    { name: "diagonal ↗", cols: DIAG_UP, cells: [[5, 0], [4, 1], [3, 2], [2, 3]] },
    { name: "diagonal ↘", cols: DIAG_DOWN, cells: [[2, 3], [3, 4], [4, 5], [5, 6]] },
    { name: "five in a row", cols: FIVE, cells: [[5, 0], [5, 1], [5, 2], [5, 3], [5, 4]] },
  ];
  for (const c of cases) {
    const { t, s } = start();
    const starter = s.starter;
    play(s, t, c.cols.slice(0, -1));
    check(s.phase === "turn" && s.win === null, `${c.name}: no early win`);
    const now = t.ctx.now();
    play(s, t, c.cols.slice(-1));
    check(s.win?.seat === starter, `${c.name}: starter wins`);
    check(sameCells(s.win!.cells, c.cells), `${c.name}: winning cells ${JSON.stringify(s.win!.cells)}`);
    check(s.win!.lines.length === 1, `${c.name}: one line`);
    check(s.score[starter] === 1 && s.score[other(starter)] === 0, `${c.name}: scored`);
    check(s.results.length === 1 && s.results[0] === starter, `${c.name}: result recorded`);
    check(s.phase === "between" && s.endsAt === now + PAUSE_MS, `${c.name}: 2.5s pause`);
    const v = view(s, t, "spectator");
    check(sameCells(v.win!.cells, c.cells) && v.last?.col === c.cols[c.cols.length - 1], `${c.name}: view shows the win`);
    check(act(s, t, mover(s), { type: "drop", col: 6 }) === false, `${c.name}: no moves during the pause`);
  }

  // Two lines at once (horizontal + vertical through the last disc).
  const b = emptyBoard();
  b[5][0] = b[5][1] = b[5][2] = 0;
  b[4][3] = b[3][3] = b[2][3] = 0;
  b[5][3] = 0;
  const w = findWin(b, 5, 3);
  assert(w && w.lines.length === 2 && w.cells.length === 7, "double line: both lines and all 7 cells");
  check(findWin(b, 0, 0) === null && findWin(b, -1, 3) === null && findWin(b, 2, 9) === null, "empty/out of range");
  b[5][2] = 1;
  check(findWin(b, 5, 3)?.lines.length === 1, "blocked line not counted");
}

// ---------- draws ----------
{
  const { t, s } = start(2, 9);
  const finalBoard = (() => {
    const b = emptyBoard();
    const heights = Array<number>(COLS).fill(0);
    DRAW_ORDER.forEach((c, i) => {
      b[ROWS - 1 - heights[c]][c] = (i % 2) as Seat;
      heights[c]++;
    });
    return b;
  })();
  check(!anyWinOnBoard(finalBoard), "draw pattern really has no four");
  drawGame(s, t);
  check(s.board.every((row) => row.every((c) => c !== null)), "board full");
  check(s.phase === "between" && s.game === 1, "draw pauses before game 2");
  toNextGame(s, t);
  check(s.game === 2 && s.board.every((row) => row.every((c) => c === null)), "fresh board for game 2");
  check(s.last === null && s.win === null && s.moves === 0, "per-game state reset");
}

// ---------- between-games pause ----------
{
  const { t, s } = start();
  play(s, t, HORIZONTAL);
  const firstStarter = s.starter;
  t.advance(PAUSE_MS - 1);
  check(!tick(s, t), "pause holds until it expires");
  check(s.phase === "between", "still paused");
  t.advance(1);
  check(tick(s, t) === true && s.phase === "turn", "next game starts after 2.5s");
  check(s.starter === other(firstStarter) && s.turn === s.starter && s.game === 2, "other seat starts game 2");
  check(s.endsAt === t.ctx.now() + TURN_MS, "fresh turn clock");
}

// ---------- full matches ----------
{
  // 2-1 match with alternating winners, ctx.end exactly once, correct scores.
  const { t, s, ends } = start(2, 5);
  const champ = s.starter;
  winGame(s, t, champ);
  toNextGame(s, t);
  winGame(s, t, other(champ));
  toNextGame(s, t);
  drawGame(s, t);
  toNextGame(s, t);
  check(!t.result && s.score[0] === 1 && s.score[1] === 1, "1-1 after a draw: match continues");
  winGame(s, t, champ);
  check(s.phase === "over", "match over");
  check(ends() === 1 && t.result, "ctx.end called once");
  check(t.result!.winners.length === 1 && t.result!.winners[0] === s.seats[champ], "champion wins");
  check(t.result!.headline === `Player${champ} wins Four in a Row 2–1`, `headline: ${t.result!.headline}`);
  check(t.result!.scores?.[s.seats[champ]] === 2 && t.result!.scores?.[s.seats[other(champ)]] === 1, "scores");
  check(s.results.length === 4 && s.results[2] === null, "history includes the draw");
  check(s.champions?.length === 1 && s.champions[0] === champ && s.ending === "wins", "state records the champion");
  const v = view(s, t, "p0");
  check(v.phase === "over" && v.win !== null && v.forfeitAt[0] === null, "final view keeps the winning line");

  // After the end nothing moves.
  const done = snap(s);
  check(act(s, t, mover(s), { type: "drop", col: 5 }) === false, "no drops after the end");
  check(act(s, t, mover(s), { type: "hover", col: 5 }) === false, "no hovers after the end");
  t.advance(10 * 60_000);
  check(!tick(s, t), "tick idle after the end");
  setConnected(s, t, "p0", false);
  t.advance(FORFEIT_MS * 2);
  check(!tick(s, t), "disconnects after the end change nothing");
  setConnected(s, t, "p0", true);
  check(snap(s) === done && ends() === 1, "state frozen, ctx.end still once");
}
{
  // 2-0 sweep.
  const { t, s, ends } = start(2, 11);
  const champ = other(s.starter);
  winGame(s, t, champ);
  toNextGame(s, t);
  winGame(s, t, champ);
  check(ends() === 1 && t.result?.winners[0] === s.seats[champ], "2-0 sweep ends the match");
  check(t.result!.headline.endsWith("2–0"), "2-0 headline");
}

// ---------- game cap: 5 games, leader wins, tie = both win ----------
{
  // Five draws: 0-0, both win.
  const { t, s, ends } = start(2, 21);
  for (let g = 1; g <= MAX_GAMES; g++) {
    drawGame(s, t);
    if (g < MAX_GAMES) toNextGame(s, t);
  }
  check(s.phase === "over" && ends() === 1, "match stops after 5 games");
  check(t.result?.winners.length === 2, "tie: both win");
  check(t.result!.headline === "Player0 and Player1 tie Four in a Row 0–0", `headline: ${t.result!.headline}`);
}
{
  // One win then four draws: leader wins 1-0 after 5 games.
  const { t, s, ends } = start(2, 22);
  const leader = s.starter;
  winGame(s, t, leader);
  for (let g = 2; g <= MAX_GAMES; g++) {
    toNextGame(s, t);
    drawGame(s, t);
  }
  check(ends() === 1 && t.result?.winners.length === 1 && t.result!.winners[0] === s.seats[leader], "leader wins on the cap");
  check(t.result!.headline.includes("1–0 after 5 games"), `headline: ${t.result!.headline}`);
  check(s.ending === "cap", "ending = cap");
}
{
  // 1-1 after 5 games: tie, both win.
  const { t, s } = start(2, 23);
  const a = s.starter;
  winGame(s, t, a);
  toNextGame(s, t);
  winGame(s, t, other(a));
  for (let g = 3; g <= MAX_GAMES; g++) {
    toNextGame(s, t);
    drawGame(s, t);
  }
  check(t.result?.winners.length === 2 && t.result!.scores?.p0 === 1 && t.result!.scores?.p1 === 1, "1-1 tie");
}
{
  // A second win in game 5 still counts as reaching the target.
  const { t, s } = start(2, 24);
  const a = s.starter;
  winGame(s, t, a);
  for (let g = 2; g <= 4; g++) {
    toNextGame(s, t);
    drawGame(s, t);
  }
  toNextGame(s, t);
  winGame(s, t, a);
  check(t.result?.winners[0] === s.seats[a] && t.result!.headline.endsWith("2–0"), "target reached in game 5");
}

// ---------- turn timer ----------
{
  const { t, s } = start(2, 31);
  const slow = s.turn;
  t.advance(TURN_MS - 1);
  check(!tick(s, t), "no auto-drop before 30s");
  check(s.moves === 0, "board untouched");
  t.advance(1);
  check(tick(s, t) === true, "auto-drop at 30s");
  check(s.moves === 1 && s.last?.auto === true && s.last.seat === slow, "random disc dropped for the slow player");
  check(s.turn === other(slow) && s.endsAt === t.ctx.now() + TURN_MS, "turn passes with a fresh clock");
}
{
  // Timeouts only ever pick open columns.
  for (let trial = 0; trial < 60; trial++) {
    const { t, s } = start(2, 100 + trial);
    const open = new Set<number>();
    for (let c = 0; c < COLS; c++) {
      if ((trial >> c) % 2 === 0 && c !== trial % COLS) {
        for (let h = 0; h < ROWS; h++) s.board[ROWS - 1 - h][c] = drawColour(c, h) as Seat;
        s.moves += ROWS;
      } else open.add(c);
    }
    t.advance(TURN_MS);
    tick(s, t);
    check(s.last?.auto && open.has(s.last!.col), `auto-drop picked open column (trial ${trial})`);
  }
}
{
  // Nobody ever moves: timeouts alone finish the match.
  const { t, s, ends } = start(2, 41);
  let ms = 0;
  while (!t.result && ms < 4 * 60 * 60_000) {
    t.advance(1000);
    ms += 1000;
    tick(s, t);
  }
  check(t.result && ends() === 1, "idle match still finishes");
  assertGravity(s.board, "idle match");
}

// ---------- disconnects ----------
{
  // Mover disconnects mid-turn: auto-drop 5s later, not before.
  const { t, s } = start(2, 51);
  const away = s.turn;
  const awayId = s.seats[away];
  t.advance(10_000);
  setConnected(s, t, awayId, false);
  check(s.endsAt === t.ctx.now() + AWAY_MS && s.timerMs === AWAY_MS, "deadline cut to 5s");
  check(view(s, t, "spectator").forfeitAt[away] === t.ctx.now() + FORFEIT_MS, "forfeit countdown visible");
  t.advance(AWAY_MS - 1);
  check(!tick(s, t) && s.moves === 0, "not yet");
  t.advance(1);
  check(tick(s, t) === true && s.moves === 1 && s.last?.auto && s.last.seat === away, "auto-dropped for the away player");
  check(s.endsAt === t.ctx.now() + TURN_MS && s.timerMs === TURN_MS, "connected opponent gets the full 30s");
  play(s, t, [s.last!.col === 3 ? 4 : 3]);
  check(s.turn === away && s.endsAt === t.ctx.now() + AWAY_MS, "away player's next turn is 5s");
  // Comes back: the normal clock returns.
  t.advance(2000);
  setConnected(s, t, awayId, true);
  check(s.endsAt === s.turnStartedAt + TURN_MS && s.timerMs === TURN_MS, "full clock restored on return");
  check(view(s, t, "p0").forfeitAt[away] === null, "forfeit countdown cleared");
  t.advance(AWAY_MS);
  check(!tick(s, t) && s.turn === away, "no auto-drop after returning");
}
{
  // Mover blips out and back before the 5s run out: nothing is dropped.
  const { t, s } = start(2, 52);
  const id = mover(s);
  t.advance(25_000);
  setConnected(s, t, id, false);
  check(s.endsAt === s.turnStartedAt + TURN_MS, "deadline never extends past the original 30s");
  t.advance(1000);
  setConnected(s, t, id, true);
  t.advance(3000);
  check(!tick(s, t) && s.moves === 0, "still their move");
  t.advance(1000);
  check(tick(s, t) === true && s.moves === 1, "original 30s deadline still applies");
}
{
  // The waiting player disconnects: mover's clock unchanged; their own turn is short.
  const { t, s } = start(2, 53);
  const waiting = other(s.turn);
  const deadline = s.endsAt;
  setConnected(s, t, s.seats[waiting], false);
  check(s.endsAt === deadline, "mover's clock untouched");
  play(s, t, [2]);
  check(s.turn === waiting && s.endsAt === t.ctx.now() + AWAY_MS, "away player's turn auto-resolves in 5s");
}
{
  // Disconnect during the pause between games: the next game still starts on time.
  const { t, s } = start(2, 54);
  play(s, t, HORIZONTAL);
  const nextStarter = other(s.starter);
  setConnected(s, t, s.seats[nextStarter], false);
  toNextGame(s, t);
  check(s.turn === nextStarter && s.endsAt === t.ctx.now() + AWAY_MS, "away starter gets the 5s clock");
  t.advance(AWAY_MS);
  check(tick(s, t) === true && s.moves === 1 && s.last?.auto, "away starter auto-dropped");
  setConnected(s, t, s.seats[nextStarter], true);
  check(s.awaySince[nextStarter] === null, "back again");
}
{
  // Connection flags that changed without the hooks are picked up by tick().
  const { t, s } = start(2, 55);
  const id = mover(s);
  setConnected(s, t, id, false, false);
  check(tick(s, t) === true && s.awaySince[s.turn] !== null, "tick notices the disconnect");
  check(s.endsAt === t.ctx.now() + AWAY_MS, "and shortens the clock");
  setConnected(s, t, id, true, false);
  check(tick(s, t) === true && s.awaySince[s.turn] === null && s.timerMs === TURN_MS, "and the return");
  check(!tick(s, t), "no change, no broadcast");
}
{
  // Gone for a minute: forfeit. The game keeps moving meanwhile.
  const { t, s, ends } = start(2, 56);
  const quitter = other(s.turn);
  const stayer = other(quitter);
  setConnected(s, t, s.seats[quitter], false);
  let elapsed = 0;
  while (!t.result && elapsed < FORFEIT_MS - 200) {
    t.advance(200);
    elapsed += 200;
    tick(s, t);
    if (s.phase === "turn" && s.turn === stayer && s.moves < 20) {
      const open = [3, 2, 4, 1, 5, 0, 6].find((c) => s.board[0][c] === null)!;
      act(s, t, s.seats[stayer], { type: "drop", col: open });
    }
  }
  check(!t.result, "no forfeit before 60s");
  check(s.seq > 2, "auto-drops kept the game moving");
  t.advance(200);
  tick(s, t);
  check(t.result && ends() === 1, "forfeit after 60s away");
  check(t.result!.winners.length === 1 && t.result!.winners[0] === s.seats[stayer], "the player who stayed wins");
  check(t.result!.headline === `Player${stayer} wins Four in a Row (Player${quitter} left)`, `headline: ${t.result!.headline}`);
  check(s.ending === "forfeit" && s.quitter === quitter, "forfeit recorded");
}
{
  // Back before the minute is up: no forfeit.
  const { t, s } = start(2, 57);
  const id = s.seats[other(s.turn)];
  setConnected(s, t, id, false);
  t.advance(FORFEIT_MS - 1000);
  tick(s, t);
  setConnected(s, t, id, true);
  t.advance(5000);
  tick(s, t);
  check(!t.result && s.phase !== "over", "returning resets the forfeit clock");
}
{
  // Both leave: the match is abandoned with no winners.
  const { t, s, ends } = start(2, 58);
  setConnected(s, t, "p0", false);
  t.advance(3000);
  setConnected(s, t, "p1", false);
  let guard = 0;
  while (!t.result && guard++ < 1000) {
    t.advance(200);
    tick(s, t);
  }
  check(t.result && ends() === 1 && t.result!.winners.length === 0, "abandoned, nobody wins");
  check(t.result!.headline.includes("abandoned"), `headline: ${t.result!.headline}`);
  const elapsed = t.ctx.now() - 1_700_000_000_000;
  check(elapsed >= 3000 + FORFEIT_MS && elapsed <= 3000 + FORFEIT_MS + 400, "ends once both have been gone a minute");
  check(s.moves === 0, "no discs were dropped for two absent players");
}
{
  // Disconnect / reconnect after the end is ignored.
  const { t, s } = start(2, 59);
  winGame(s, t, s.starter);
  toNextGame(s, t);
  winGame(s, t, other(s.starter));
  const done = snap(s);
  setConnected(s, t, "p1", false);
  setConnected(s, t, "p1", true);
  check(snap(s) === done, "hooks after the end are no-ops");
}

// ---------- both players away: nothing is played for them ----------
const MID_GAME = [3, 3, 2, 4, 4, 2, 5, 1, 1, 5]; // no four yet; lots of threats
{
  const { t, s, ends } = start(2, 70);
  play(s, t, MID_GAME);
  const board = JSON.stringify(s.board);
  const seq = s.seq;
  const moverSeat = s.turn;
  setConnected(s, t, "p0", false);
  setConnected(s, t, "p1", false);
  for (let ms = 0; ms < FORFEIT_MS - 1000; ms += 200) {
    t.advance(200);
    tick(s, t);
  }
  check(s.seq === seq && JSON.stringify(s.board) === board, "no random discs while both are away");
  check(!t.result && ends() === 0 && s.phase === "turn", "nothing decided while both are away");
  check(s.score[0] === 0 && s.score[1] === 0 && s.results.length === 0, "score untouched");
  // The mover comes back first: a fresh full clock, not an expired one.
  setConnected(s, t, s.seats[moverSeat], true);
  check(s.turnStartedAt === t.ctx.now() && s.endsAt === t.ctx.now() + TURN_MS, "returning mover gets a fresh 30s");
  check(!tick(s, t) && s.seq === seq, "no instant auto-drop on return");
}
{
  // The waiting player comes back first: the still-away mover gets a fresh 5s, then auto-drops.
  const { t, s } = start(2, 71);
  play(s, t, MID_GAME);
  const seq = s.seq;
  const waiting = other(s.turn);
  setConnected(s, t, "p0", false);
  setConnected(s, t, "p1", false);
  t.advance(20_000);
  check(!tick(s, t) && s.seq === seq, "frozen");
  setConnected(s, t, s.seats[waiting], true);
  check(s.endsAt === t.ctx.now() + AWAY_MS && s.timerMs === AWAY_MS, "away mover gets a fresh 5s");
  t.advance(AWAY_MS - 1);
  check(!tick(s, t) && s.seq === seq, "not yet");
  t.advance(1);
  check(tick(s, t) === true && s.seq === seq + 1 && s.last?.auto, "auto-drop resumes with someone to wait on");
}
{
  // Hooks missed: tick() notices both are away, freezes, and restarts the turn on return.
  const { t, s } = start(2, 72);
  play(s, t, MID_GAME);
  const seq = s.seq;
  const moverSeat = s.turn;
  setConnected(s, t, "p0", false, false);
  setConnected(s, t, "p1", false, false);
  for (let ms = 0; ms < 30_000; ms += 200) {
    t.advance(200);
    tick(s, t);
  }
  check(s.seq === seq, "frozen without hooks too");
  setConnected(s, t, s.seats[moverSeat], true, false);
  check(tick(s, t) === true && s.endsAt === t.ctx.now() + TURN_MS, "fresh clock after tick sees the return");
}

// ---------- forfeit vs. a blip by the player who stayed ----------
{
  // The stayer drops just before the leaver's minute is up, then comes straight back: they still win.
  const { t, s, ends } = start(2, 73);
  const quitter = other(s.turn);
  const stayer = other(quitter);
  setConnected(s, t, s.seats[quitter], false);
  t.advance(FORFEIT_MS - 300);
  tick(s, t);
  setConnected(s, t, s.seats[stayer], false);
  t.advance(400);
  check(!tick(s, t) && !t.result, "no instant 'abandoned' while the stayer is only briefly away");
  t.advance(2000);
  check(!tick(s, t) && !t.result, "still waiting for the stayer");
  setConnected(s, t, s.seats[stayer], true);
  check(t.result && ends() === 1, "match ends as soon as the stayer returns");
  check(s.ending === "forfeit" && s.quitter === quitter, "it's a forfeit");
  check(t.result!.winners.length === 1 && t.result!.winners[0] === s.seats[stayer], "the stayer wins");
  check(view(s, t, "spectator").forfeitAt[stayer] === null, "no countdown once over");
}
{
  // The leaver comes back after their minute while the stayer is briefly away: still the leaver's forfeit.
  for (const hooks of [true, false]) {
    const { t, s, ends } = start(2, 78);
    const quitter = other(s.turn);
    const stayer = other(quitter);
    setConnected(s, t, s.seats[quitter], false, hooks);
    tick(s, t);
    t.advance(FORFEIT_MS - 300);
    tick(s, t);
    setConnected(s, t, s.seats[stayer], false, hooks);
    tick(s, t);
    t.advance(1000);
    check(!tick(s, t) && !t.result, `waiting for the stayer (hooks: ${hooks})`);
    setConnected(s, t, s.seats[quitter], true, hooks);
    tick(s, t);
    check(t.result && ends() === 1 && s.ending === "forfeit" && s.quitter === quitter, `leaver can't undo the forfeit (hooks: ${hooks})`);
    check(t.result!.winners.join() === s.seats[stayer], `the stayer wins (hooks: ${hooks})`);
  }
}
{
  // Back within their own minute (the other player is away too): play resumes, nobody forfeits yet.
  const { t, s } = start(2, 79);
  setConnected(s, t, "p0", false);
  t.advance(30_000);
  setConnected(s, t, "p1", false);
  t.advance(10_000);
  tick(s, t);
  setConnected(s, t, "p0", true);
  check(!t.result && s.phase === "turn" && s.awaySince[0] === null, "p0 is back in the game");
  t.advance(FORFEIT_MS - 10_000);
  tick(s, t);
  check(t.result && s.ending === "forfeit" && s.quitter === 1, "p1 forfeits after their own minute");
}
{
  // If the stayer doesn't come back either, the match is abandoned once they've been gone a minute too.
  const { t, s, ends } = start(2, 74);
  const quitter = other(s.turn);
  const stayer = other(quitter);
  setConnected(s, t, s.seats[quitter], false);
  t.advance(FORFEIT_MS - 10_000);
  tick(s, t);
  setConnected(s, t, s.seats[stayer], false);
  const stayerLeft = t.ctx.now();
  while (!t.result && t.ctx.now() - stayerLeft < FORFEIT_MS + 1000) {
    t.advance(200);
    tick(s, t);
  }
  check(t.result && ends() === 1 && s.ending === "abandoned", "abandoned");
  check(t.result!.winners.length === 0, "nobody wins");
  check(t.ctx.now() - stayerLeft >= FORFEIT_MS && t.ctx.now() - stayerLeft <= FORFEIT_MS + 200, "after both were gone a minute");
}

// ---------- hover cleared when the mover leaves; per-turn hover budget ----------
{
  const { t, s } = start(2, 75);
  const me = mover(s);
  act(s, t, me, { type: "hover", col: 2 });
  const before = t.events.length;
  setConnected(s, t, me, false);
  const ev = t.events[t.events.length - 1];
  check(t.events.length === before + 1, "leaving emits one event");
  const h = ev.event as HoverEvent;
  check(h.type === "hover" && h.col === null && h.seat === s.turn && h.seq === s.seq, "hover cleared for everyone");
  // The waiting player leaving doesn't emit anything.
  const { t: t2, s: s2 } = start(2, 76);
  setConnected(s2, t2, s2.seats[other(s2.turn)], false);
  check(t2.events.length === 0, "no hover event when the waiting player leaves");
}
{
  const { t, s } = start(2, 77);
  for (let i = 0; i < 40; i++) act(s, t, mover(s), { type: "hover", col: i % COLS });
  play(s, t, [3]);
  const n = t.events.length;
  act(s, t, mover(s), { type: "hover", col: 1 });
  check(t.events.length === n + 1, "next mover's hovers aren't blocked by the previous mover's spam");
}

// ---------- hover events ----------
{
  const { t, s } = start(2, 61);
  const me = mover(s);
  const them = s.seats[other(s.turn)];
  check(act(s, t, me, { type: "hover", col: 3 }) === false, "hover never re-broadcasts state");
  const ev = t.events[0];
  const e = ev?.event as HoverEvent;
  check(e?.type === "hover" && e.col === 3 && e.seat === s.turn && e.seq === s.seq, "hover event payload");
  check(ev.except === me && !ev.to, "sent to everyone but the mover");
  check(act(s, t, me, { type: "hover", col: null }) === false && (t.events[1].event as HoverEvent).col === null, "hover off");
  check(act(s, t, them, { type: "hover", col: 2 }) === false && t.events.length === 2, "only the mover can hover");
  check(act(s, t, "spectator", { type: "hover", col: 2 }) === false && t.events.length === 2, "spectators can't hover");
  // Spam is capped per second.
  for (let i = 0; i < 100; i++) act(s, t, me, { type: "hover", col: i % COLS });
  const burst = t.events.length;
  check(burst < 40, `hover spam capped (${burst})`);
  t.advance(1000);
  act(s, t, me, { type: "hover", col: 1 });
  check(t.events.length === burst + 1, "budget refills");
  // After a move the event carries the new seq, so clients drop stale hovers.
  play(s, t, [6]);
  act(s, t, mover(s), { type: "hover", col: 4 });
  check((t.events[t.events.length - 1].event as HoverEvent).seq === 1, "hover tagged with the current turn");
  // No hovering while games are paused or after the end.
  play(s, t, [2, 0, 2, 0, 2, 0, 2]); // second player stacks four in column 3
  check(s.phase === "between" && s.win?.seat === other(s.starter), "game won");
  const paused = t.events.length;
  for (const id of s.seats) act(s, t, id, { type: "hover", col: 1 });
  check(t.events.length === paused, "no hover events in the pause");
}

// ---------- disc colours (client helper) ----------
{
  const palette = ["#ff5d73", "#ffb020", "#ffe14d", "#4ade80", "#2dd4bf", "#38bdf8", "#818cf8", "#c084fc", "#f472b6", "#fb923c", "#a3e635", "#e2e8f0"];
  for (const a of palette) {
    for (const b of palette) {
      const [c0, c1] = discPalette(a, b);
      check(c0 === a, "seat 0 keeps their colour");
      check(colorDistance(c0, c1) >= 125, `discs distinguishable for ${a} vs ${b} (${c0} / ${c1})`);
      if (colorDistance(a, b) >= 125) check(c1 === b, "distinct colours are kept as-is");
    }
  }
  const [d0, d1] = discPalette(undefined, "not-a-colour");
  check(/^#[0-9a-f]{6}$/i.test(d0) && /^#[0-9a-f]{6}$/i.test(d1) && d0 !== d1, "bad colours fall back to defaults");
}

// ---------- player counts ----------
{
  // A lone player (the room never allows this, but never get stuck).
  const { t, s, ends } = start(1);
  check(act(s, t, "p0", { type: "drop", col: 3 }) === false, "no play without an opponent");
  check(tick(s, t) === true && s.phase === "over" && ends() === 1, "ends gracefully");
  check(t.result?.winners.length === 0, "no winners");
  check(JSON.stringify(view(s, t, "p0")).length > 0, "view still works");
}
{
  // Extra players beyond 2 are ignored by the game (the room caps at 2).
  const { t, s } = start(3);
  check(s.seats.length === 2 && !s.seats.includes("p2"), "two seats only");
  check(act(s, t, "p2", { type: "drop", col: 3 }) === false, "third player can't act");
  check(view(s, t, "p2").you === null, "third player sees a spectator view");
}

// ---------- fuzz: random play, junk, disconnects, time jumps ----------
{
  const rng = (seed: number) => {
    let x = seed >>> 0 || 1;
    return () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 4294967296;
    };
  };
  const junk: unknown[] = [null, "x", 7, [], {}, { type: "drop", col: -3 }, { type: "drop", col: 2.2 }, { type: "hover", col: 99 }];
  for (let seed = 1; seed <= 60; seed++) {
    const { t, s, ends } = start(2, seed);
    const r = rng(seed * 7919);
    const flaky = seed % 3 !== 0;
    let steps = 0;
    while (!t.result && steps++ < 50_000) {
      const roll = r();
      const who = s.seats[r() < 0.8 ? s.turn : other(s.turn)];
      if (roll < 0.5) act(s, t, who, { type: "drop", col: Math.floor(r() * (COLS + 2)) - 1 });
      else if (roll < 0.6) act(s, t, who, junk[Math.floor(r() * junk.length)]);
      else if (roll < 0.65) act(s, t, who, { type: "hover", col: Math.floor(r() * COLS) });
      else if (roll < 0.7 && flaky) {
        const id = s.seats[r() < 0.5 ? 0 : 1];
        const p = t.ctx.players.find((x) => x.id === id)!;
        setConnected(s, t, id, !p.connected);
      } else {
        t.advance(Math.floor(r() * 8000));
        tick(s, t);
      }
      assertGravity(s.board, `fuzz ${seed}`);
      let a = 0;
      let b = 0;
      for (const row of s.board) for (const c of row) if (c === s.starter) a++;
      else if (c !== null) b++;
      check(a - b === 0 || a - b === 1, `fuzz ${seed}: turns alternate (${a} vs ${b})`);
      check(s.score[0] + s.score[1] <= s.results.length && s.results.length <= MAX_GAMES, `fuzz ${seed}: results`);
      const frozen = s.awaySince[0] !== null && s.awaySince[1] !== null; // turn clock stops when both are gone
      check(s.phase !== "turn" || frozen || s.endsAt > t.ctx.now() - 9000, `fuzz ${seed}: deadline sane`);
      check(Math.max(...s.score) <= TARGET_WINS, `fuzz ${seed}: score capped`);
    }
    check(t.result, `fuzz ${seed}: match finished`);
    check(ends() === 1, `fuzz ${seed}: ctx.end once`);
    const w = t.result!.winners;
    if (s.ending === "wins") check(w.length === 1 && s.score[s.seats.indexOf(w[0])] === TARGET_WINS, `fuzz ${seed}: winner`);
    if (s.ending === "cap") check(s.results.length === MAX_GAMES, `fuzz ${seed}: cap`);
  }
}


// ---- Host settings ----
{
  const t = makeTestCtx(2, 7, { wins: 1, turn: 15 });
  const s: FourState = game.setup(t.ctx);
  check(s.target === 1 && s.maxGames === 3 && s.turnMs === 15_000, "settings read");
  check(s.endsAt - t.ctx.now() === 15_000, "short move timer");
  const v = game.view(s, s.seats[0], t.ctx) as FourView;
  check(v.target === 1 && v.maxGames === 3, "view carries match length");
  const w = s.turn;
  // winner stacks column 0, loser column 1
  for (let i = 0; i < 3; i++) {
    act(s, t, s.seats[w], { type: "drop", col: 0 });
    act(s, t, s.seats[other(w)], { type: "drop", col: 1 });
  }
  act(s, t, s.seats[w], { type: "drop", col: 0 });
  check(s.phase === "over" && t.result?.winners[0] === s.seats[w], "best of 1 ends after one win");
}
{
  const t = makeTestCtx(2, 7, { wins: 99, turn: "x" });
  const s: FourState = game.setup(t.ctx);
  check(s.target === TARGET_WINS && s.turnMs === TURN_MS, "invalid settings fall back to defaults");
}

// ---- Bots ----
for (const [n, bots] of [[2, 2], [2, 1]] as const) {
  for (let seed = 1; seed <= 6; seed++) {
    const t = makeTestCtx(n, seed, {}, bots);
    const s: FourState = game.setup(t.ctx);
    let steps = 0;
    while (!t.result && steps < 20_000) {
      steps++;
      t.advance(200);
      tick(s, t);
      for (const id of s.seats) {
        if (!t.ctx.player(id)?.bot) continue;
        const a = game.bot!(s, id, t.ctx);
        if (a) check(act(s, t, id, a) !== false, "bot move accepted");
      }
    }
    check(t.result, `bots finish a match (seed ${seed}, ${bots} bots)`);
    check(t.ctx.now() - 1_700_000_000_000 < 30 * 60_000, "within sane time");
  }
}
// The bot takes an immediate win and blocks one.
{
  const t = makeTestCtx(2, 3, {}, 1);
  const s: FourState = game.setup(t.ctx);
  const bot = s.seats.indexOf("bot-0") as Seat;
  s.turn = bot;
  s.board[5][0] = bot; s.board[5][1] = bot; s.board[5][2] = bot;
  s.board[5][5] = other(bot); s.board[5][6] = other(bot); s.board[4][6] = other(bot);
  check(game.bot!(s, "bot-0", t.ctx) === null, "bot thinks first");
  t.advance(3000);
  const a = game.bot!(s, "bot-0", t.ctx) as { type: string; col: number };
  check(a && a.type === "drop" && a.col === 3, "bot takes the win");
  check(game.bot!(s, s.seats[other(bot)], t.ctx) === null, "bot hook ignores non-turn seats");
}

console.log("fourrow: all tests passed");
