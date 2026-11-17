import { assert, makeTestCtx } from "../../shared/testing";
import game, { type TttState, type TttView } from "./server";

/** Count ctx.end calls (makeTestCtx only keeps the first result). */
function countEnds(t: ReturnType<typeof makeTestCtx>) {
  let n = 0;
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    n += 1;
    end(r);
  };
  return () => n;
}

// Full match: the starter always wins via the top row, so someone reaches 3.
{
  const t = makeTestCtx(2);
  const ends = countEnds(t);
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
    assert(s.last === cell, "last move tracked");
  }
  assert(t.result, "match should end");
  assert(t.result.winners.length === 1, "one winner");
  assert(Math.max(...s.score) === 3, "winner has 3");
  assert(s.over && s.winner !== null && !s.forfeit, "over by a win");
  assert(s.history.length === s.score[0] + s.score[1], "one history entry per decided round");
  // Nothing moves after the end, and the end is reported once.
  assert(game.action(s, s.seats[s.turn], { type: "place", cell: 8 }, t.ctx) === false, "no moves after the end");
  t.advance(60_000);
  assert(!game.tick!(s, t.ctx), "no ticks after the end");
  assert(ends() === 1, "ctx.end exactly once");
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
  const hostile: any[] = [null, undefined, "place", 4, [], [4], { type: "place" }, { type: "place", cell: "1" }, { type: "place", cell: 1.5 }, { type: "place", cell: NaN }];
  for (const a of hostile) assert(game.action(s, s.seats[s.turn], a, t.ctx) === false, `rejects ${JSON.stringify(a)}`);
  assert(game.action(s, "stranger", { type: "place", cell: 0 }, t.ctx) === false, "non-player rejected");
  assert(s.board.filter((c) => c !== null).length === 1, "only the one legal move landed");
}

// A drawn round is recorded, alternates the starter and doesn't score.
{
  const t = makeTestCtx(2);
  const s: TttState = game.setup(t.ctx);
  const starter = s.turn;
  // X O X / X O O / O X X  — no line for either side.
  const plan = [0, 1, 2, 4, 3, 5, 7, 6, 8];
  for (const cell of plan) assert(game.action(s, s.seats[s.turn], { type: "place", cell }, t.ctx) !== false, `move ${cell}`);
  assert(s.roundEnd && s.roundEnd.winner === null && s.history[0] === null, "draw recorded");
  assert(s.score[0] === 0 && s.score[1] === 0, "a draw scores nothing");
  t.advance(2500);
  assert(game.tick!(s, t.ctx) === true, "next round starts");
  assert(s.round === 2 && s.turn === 1 - starter && s.last === null, "starter alternates, fresh board");
}

// Views: seat for players, null for spectators, no internal bookkeeping.
{
  const t = makeTestCtx(2);
  const s: TttState = game.setup(t.ctx);
  const v0 = game.view(s, s.seats[0], t.ctx) as TttView;
  const spec = game.view(s, "spectator", t.ctx) as TttView;
  assert(v0.you === 0 && spec.you === null, "you");
  assert(!("awaySince" in v0) && v0.forfeitAt === null, "no away timer while everyone is here");
}

// A disconnected player forfeits the match after a grace period; the game never stalls.
{
  const t = makeTestCtx(2);
  const ends = countEnds(t);
  const s: TttState = game.setup(t.ctx);
  const away = s.turn; // the player to move leaves
  t.ctx.players[away].connected = false;
  game.playerLeft!(s, s.seats[away], t.ctx);
  const v = game.view(s, s.seats[1 - away], t.ctx) as TttView;
  assert(v.forfeitAt === t.ctx.now() + 20_000, "forfeit countdown shown");
  t.advance(19_000);
  game.tick!(s, t.ctx);
  assert(!t.result, "still waiting inside the grace period");
  t.advance(1_000);
  assert(game.tick!(s, t.ctx) === true, "forfeit broadcast");
  const result = t.result as { winners: string[] } | null; // (TS narrowed t.result to null above)
  assert(result?.winners.length === 1 && result.winners[0] === s.seats[1 - away], "the player who stayed wins");
  assert(s.over && s.forfeit && s.winner === 1 - away, "state marks the forfeit");
  game.tick!(s, t.ctx);
  assert(ends() === 1, "forfeit ends once");
}

// Coming back in time cancels the forfeit, and play continues.
{
  const t = makeTestCtx(2);
  const s: TttState = game.setup(t.ctx);
  const away = 1 - s.turn;
  t.ctx.players[away].connected = false;
  game.playerLeft!(s, s.seats[away], t.ctx);
  game.action(s, s.seats[s.turn], { type: "place", cell: 4 }, t.ctx); // the player who stayed can still move
  t.advance(15_000);
  game.tick!(s, t.ctx);
  t.ctx.players[away].connected = true;
  game.playerReturned!(s, s.seats[away], t.ctx);
  t.advance(10_000); // past the old forfeit time, within the fresh move clock
  game.tick!(s, t.ctx);
  assert(!t.result && s.awaySince === null, "no forfeit after returning");
  assert(game.action(s, s.seats[away], { type: "place", cell: 0 }, t.ctx) !== false, "returned player moves");
}

// Both players gone: nobody wins, still exactly one end.
{
  const t = makeTestCtx(2);
  const s: TttState = game.setup(t.ctx);
  for (const p of t.ctx.players) p.connected = false;
  game.playerLeft!(s, s.seats[0], t.ctx);
  t.advance(21_000);
  game.tick!(s, t.ctx);
  assert(t.result && t.result.winners.length === 0, "nobody wins an abandoned match");
}

// Host setting: first to 1 ends after a single won round.
{
  const t = makeTestCtx(2, 42, { target: 1 });
  const s: TttState = game.setup(t.ctx);
  assert(s.target === 1 && (game.view(s, s.seats[0], t.ctx) as TttView).target === 1, "target in state and view");
  for (const cell of [0, 3, 1, 4, 2]) game.action(s, s.seats[s.turn], { type: "place", cell }, t.ctx);
  assert(t.result && t.result.winners.length === 1 && s.round === 1, "one round decides it");
  const bad = makeTestCtx(2, 42, { target: 99 });
  assert(game.setup(bad.ctx).target === 3, "invalid setting falls back to the default");
}

// Bots: 1 human playing randomly vs a bot, and bot vs bot, both reach a result.
for (const [humans, bots] of [[1, 1], [0, 2]] as const) {
  for (const seed of [1, 2, 3, 4, 5]) {
    const t = makeTestCtx(humans + bots, seed, {}, bots);
    const s: TttState = game.setup(t.ctx);
    let ms = 0;
    while (!t.result && ms < 10 * 60_000) {
      t.advance(200);
      ms += 200;
      game.tick!(s, t.ctx);
      for (const id of t.ids) {
        if (id.startsWith("bot-")) {
          const a = game.bot!(s, id, t.ctx);
          if (a) assert(game.action(s, id, a, t.ctx) !== false, "bot moves are legal");
        } else if (!s.roundEnd && !s.over && s.seats[s.turn] === id && ms % 1000 === 0) {
          const empty = s.board.flatMap((c, i) => (c === null ? [i] : []));
          game.action(s, id, { type: "place", cell: empty[Math.floor(t.ctx.random() * empty.length)] }, t.ctx);
        }
      }
    }
    assert(t.result, `bot game ends (seed ${seed}, ${bots} bots)`);
    assert(!s.forfeit, "ended by play, not a forfeit");
  }
}

// Bot never moves out of turn and waits a human-ish moment before moving.
{
  const t = makeTestCtx(2, 7, {}, 1);
  const s: TttState = game.setup(t.ctx);
  const botSeat = s.seats.indexOf("bot-0");
  if (s.turn !== botSeat) {
    assert(game.bot!(s, "bot-0", t.ctx) == null, "bot waits for its turn");
    game.action(s, s.seats[s.turn], { type: "place", cell: 4 }, t.ctx);
  }
  assert(game.bot!(s, "bot-0", t.ctx) == null, "thinks first");
  t.advance(2100);
  assert(game.bot!(s, "bot-0", t.ctx), "then moves");
}

console.log("tictactoe: all tests passed");

// ---------- move timer: a stalled player gets a random move ----------
{
  const t = makeTestCtx(2);
  const s = game.setup(t.ctx);
  const before = s.board.filter((c) => c !== null).length;
  t.advance(20_001);
  game.tick!(s, t.ctx);
  if (s.board.filter((c) => c !== null).length !== before + 1) throw new Error("move timer did not play a move");
  console.log("✓ move timer plays for a stalled player");
}
