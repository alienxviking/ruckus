import { assert, makeTestCtx } from "../../shared/testing";
import game, { type TttState } from "./server";

// Full match: the starter always wins via the top row, so someone reaches 3.
{
  const t = makeTestCtx(2);
  const s: TttState = game.setup(t.ctx);
  let guard = 0;
  while (!t.result && guard++ < 200) {
    if (s.roundEnd) {
      t.advance(3000);
      game.tick!(s, t.ctx);
      continue;
    }
    const order = [0, 3, 1, 4, 2, 5, 6, 7, 8];
    const cell = order.find((i) => s.board[i] === null)!;
    game.action(s, s.seats[s.turn], { type: "place", cell }, t.ctx);
  }
  assert(t.result, "match should end");
  assert(t.result.winners.length === 1, "one winner");
  assert(Math.max(...s.score) === 3, "winner has 3");
}

// Rejects out-of-turn, occupied and malformed moves.
{
  const t = makeTestCtx(2);
  const s: TttState = game.setup(t.ctx);
  const other = s.seats[1 - s.turn];
  assert(game.action(s, other, { type: "place", cell: 0 }, t.ctx) === false, "out of turn rejected");
  game.action(s, s.seats[s.turn], { type: "place", cell: 4 }, t.ctx);
  assert(game.action(s, s.seats[s.turn], { type: "place", cell: 4 }, t.ctx) === false, "occupied rejected");
  assert(game.action(s, s.seats[s.turn], { type: "place", cell: 9 }, t.ctx) === false, "range checked");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert(game.action(s, s.seats[s.turn], { type: "place", cell: "1" as any }, t.ctx) === false, "type checked");
  assert(game.action(s, "stranger", { type: "place", cell: 0 }, t.ctx) === false, "non-player rejected");
}

console.log("tictactoe: all tests passed");
