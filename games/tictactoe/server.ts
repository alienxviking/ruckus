import type { GameDef } from "../../shared/game";

// Reference implementation: small, turn-based, rounds handled via tick().

type Mark = 0 | 1; // 0 = X, 1 = O
const TARGET = 3;
const ROUND_PAUSE_MS = 2200;
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export interface TttState {
  seats: [string, string];
  board: (Mark | null)[];
  turn: Mark;
  starter: Mark;
  score: [number, number];
  round: number;
  roundEnd: { winner: Mark | null; line: number[] | null; nextAt: number } | null;
  winner: Mark | null; // match winner
}

export type TttAction = { type: "place"; cell: number };

export interface TttView extends Omit<TttState, "seats"> {
  seats: [string, string];
  you: Mark | null;
  target: number;
}

function newRound(s: TttState) {
  s.board = Array(9).fill(null);
  s.turn = s.starter;
  s.roundEnd = null;
  s.round += 1;
}

export const tictactoe: GameDef<TttState, TttAction> = {
  id: "tictactoe",

  setup(ctx) {
    const [a, b] = ctx.players;
    const first: Mark = ctx.random() < 0.5 ? 0 : 1;
    return {
      seats: [a.id, b.id],
      board: Array(9).fill(null),
      turn: first,
      starter: first,
      score: [0, 0],
      round: 1,
      roundEnd: null,
      winner: null,
    };
  },

  action(s, playerId, action, ctx) {
    if (s.winner !== null || s.roundEnd) return false;
    if (action?.type !== "place") return false;
    const seat = s.seats.indexOf(playerId);
    if (seat !== s.turn) return false;
    const cell = action.cell;
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || s.board[cell] !== null) return false;

    s.board[cell] = s.turn;
    const line = LINES.find((l) => l.every((i) => s.board[i] === s.turn)) ?? null;
    if (line) {
      s.score[s.turn] += 1;
      s.roundEnd = { winner: s.turn, line, nextAt: ctx.now() + ROUND_PAUSE_MS };
      if (s.score[s.turn] >= TARGET) {
        s.winner = s.turn;
        const p = ctx.player(s.seats[s.turn]);
        ctx.end({
          winners: [s.seats[s.turn]],
          headline: `${p?.name ?? "Someone"} wins Tic-Tac-Toe ${s.score[s.turn]}–${s.score[1 - s.turn]}`,
          scores: { [s.seats[0]]: s.score[0], [s.seats[1]]: s.score[1] },
        });
      }
    } else if (s.board.every((c) => c !== null)) {
      s.roundEnd = { winner: null, line: null, nextAt: ctx.now() + ROUND_PAUSE_MS };
    } else {
      s.turn = (1 - s.turn) as Mark;
    }
  },

  tick(s, ctx) {
    if (s.winner === null && s.roundEnd && ctx.now() >= s.roundEnd.nextAt) {
      s.starter = (1 - s.starter) as Mark;
      newRound(s);
      return true;
    }
  },
  tickMs: 200,

  view(s, viewerId): TttView {
    const seat = s.seats.indexOf(viewerId);
    return { ...s, you: seat === -1 ? null : (seat as Mark), target: TARGET };
  },
};

export default tictactoe;
