import type { GameCtx, GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";

// Reference implementation: small, turn-based, rounds handled via tick().

type Mark = 0 | 1; // 0 = X, 1 = O
/** Default round wins needed (the host can change it). */
const TARGET = 3;
const ROUND_PAUSE_MS = 2200;
/** With a player disconnected this long, the match goes to whoever stayed. */
const FORFEIT_MS = 20_000;
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
  /** Round wins needed to take the match. */
  target: number;
  round: number;
  roundEnd: { winner: Mark | null; line: number[] | null; nextAt: number } | null;
  winner: Mark | null; // match winner
  /** Cell of the most recent mark this round (null on a fresh board). */
  last: number | null;
  /** Winner of every finished round (null = draw), oldest first. */
  history: (Mark | null)[];
  /** Since when a seat has been disconnected (null = everyone here). */
  awaySince: number | null;
  /** Match over (a win, or a forfeit when someone left). */
  over: boolean;
  forfeit: boolean;
}

export type TttAction = { type: "place"; cell: number };

export interface TttView extends Omit<TttState, "seats" | "awaySince"> {
  seats: [string, string];
  you: Mark | null;
  /** Pause between rounds, for the "next round" progress bar. */
  pauseMs: number;
  forfeitMs: number;
  /** A player is disconnected: the match is awarded to the other one at this time. */
  forfeitAt: number | null;
}

function newRound(s: TttState) {
  s.board = Array(9).fill(null);
  s.turn = s.starter;
  s.roundEnd = null;
  s.round += 1;
  s.last = null;
}

const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;

function scoreRecord(s: TttState) {
  return { [s.seats[0]]: s.score[0], [s.seats[1]]: s.score[1] };
}

/** Track disconnects. Returns true when that changed what players see. */
function updateAway(s: TttState, ctx: GameCtx): boolean {
  const missing = s.seats.some((id) => !connected(ctx, id));
  if (missing && s.awaySince === null) {
    s.awaySince = ctx.now();
    return true;
  }
  if (!missing && s.awaySince !== null) {
    s.awaySince = null;
    return true;
  }
  return false;
}

/** Someone stayed away too long: the match goes to whoever is still here. */
function forfeit(s: TttState, ctx: GameCtx) {
  const here = ([0, 1] as Mark[]).filter((m) => connected(ctx, s.seats[m]));
  s.over = true;
  s.forfeit = true;
  s.awaySince = null;
  if (here.length === 1) {
    const w = here[0];
    s.winner = w;
    const winner = ctx.player(s.seats[w])?.name ?? "Someone";
    const loser = ctx.player(s.seats[1 - w])?.name ?? "their opponent";
    ctx.end({ winners: [s.seats[w]], headline: `${winner} wins Tic-Tac-Toe — ${loser} left`, scores: scoreRecord(s) });
  } else {
    ctx.end({ winners: [], headline: "Tic-Tac-Toe ended — both players left", scores: scoreRecord(s) });
  }
}

// ---------- practice bot ----------

/** When each bot may move next (keyed by state), so it "thinks" like a person. */
const botReadyAt = new WeakMap<TttState, { key: string; at: number }>();

const pickFrom = (cells: number[], random: () => number) => cells[Math.floor(random() * cells.length)];

/** A cell that completes a line for `mark`, if any. */
function finishing(board: (Mark | null)[], mark: Mark): number[] {
  const out: number[] = [];
  for (const l of LINES) {
    const mine = l.filter((i) => board[i] === mark).length;
    const empty = l.filter((i) => board[i] === null);
    if (mine === 2 && empty.length === 1) out.push(empty[0]);
  }
  return out;
}

/**
 * Medium bot: takes a win, blocks an obvious threat, prefers centre and corners,
 * but now and then misses a block or plays a loose square.
 */
function botMove(s: TttState, botId: string, ctx: GameCtx): TttAction | null {
  if (s.over || s.roundEnd || s.seats[s.turn] !== botId) return null;
  const key = `${s.round}:${s.board.join(",")}`;
  const now = ctx.now();
  const t = botReadyAt.get(s);
  if (!t || t.key !== key) {
    botReadyAt.set(s, { key, at: now + 600 + ctx.random() * 1400 });
    return null;
  }
  if (now < t.at) return null;
  const me = s.turn;
  const empty = s.board.flatMap((c, i) => (c === null ? [i] : []));
  if (empty.length === 0) return null;
  const win = finishing(s.board, me);
  if (win.length && ctx.random() < 0.95) return { type: "place", cell: pickFrom(win, ctx.random) };
  const block = finishing(s.board, (1 - me) as Mark);
  if (block.length && ctx.random() < 0.85) return { type: "place", cell: pickFrom(block, ctx.random) };
  if (ctx.random() < 0.25) return { type: "place", cell: pickFrom(empty, ctx.random) };
  if (s.board[4] === null) return { type: "place", cell: 4 };
  const corners = [0, 2, 6, 8].filter((i) => s.board[i] === null);
  return { type: "place", cell: pickFrom(corners.length ? corners : empty, ctx.random) };
}

export const tictactoe: GameDef<TttState, TttAction> = {
  id: "tictactoe",

  setup(ctx) {
    const [a, b] = ctx.players;
    const set = readSettings(config.settings, ctx.settings);
    const target = Number(set.target) || TARGET;
    const first: Mark = ctx.random() < 0.5 ? 0 : 1;
    return {
      seats: [a.id, b.id],
      board: Array(9).fill(null),
      turn: first,
      starter: first,
      score: [0, 0],
      target,
      round: 1,
      roundEnd: null,
      winner: null,
      last: null,
      history: [],
      awaySince: null,
      over: false,
      forfeit: false,
    };
  },

  action(s, playerId, action, ctx) {
    if (s.over || s.roundEnd) return false;
    if (!action || typeof action !== "object" || action.type !== "place") return false;
    const seat = s.seats.indexOf(playerId);
    if (seat !== s.turn) return false;
    const cell = action.cell;
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || s.board[cell] !== null) return false;

    s.board[cell] = s.turn;
    s.last = cell;
    const line = LINES.find((l) => l.every((i) => s.board[i] === s.turn)) ?? null;
    if (line) {
      s.score[s.turn] += 1;
      s.history.push(s.turn);
      s.roundEnd = { winner: s.turn, line, nextAt: ctx.now() + ROUND_PAUSE_MS };
      if (s.score[s.turn] >= s.target) {
        s.winner = s.turn;
        s.over = true;
        s.awaySince = null;
        const p = ctx.player(s.seats[s.turn]);
        ctx.end({
          winners: [s.seats[s.turn]],
          headline: `${p?.name ?? "Someone"} wins Tic-Tac-Toe ${s.score[s.turn]}–${s.score[1 - s.turn]}`,
          scores: scoreRecord(s),
        });
      }
    } else if (s.board.every((c) => c !== null)) {
      s.history.push(null);
      s.roundEnd = { winner: null, line: null, nextAt: ctx.now() + ROUND_PAUSE_MS };
    } else {
      s.turn = (1 - s.turn) as Mark;
    }
  },

  tick(s, ctx) {
    if (s.over) return false;
    let changed = updateAway(s, ctx);
    if (s.awaySince !== null && ctx.now() >= s.awaySince + FORFEIT_MS) {
      forfeit(s, ctx);
      return true;
    }
    if (s.roundEnd && ctx.now() >= s.roundEnd.nextAt) {
      s.starter = (1 - s.starter) as Mark;
      newRound(s);
      changed = true;
    }
    return changed;
  },
  tickMs: 200,

  playerLeft(s, _id, ctx) {
    if (!s.over) updateAway(s, ctx);
  },

  playerReturned(s, _id, ctx) {
    if (!s.over) updateAway(s, ctx);
  },

  bot(s, botId, ctx) {
    return botMove(s, botId, ctx);
  },

  view(s, viewerId): TttView {
    const seat = s.seats.indexOf(viewerId);
    const { awaySince, ...rest } = s;
    return {
      ...rest,
      you: seat === -1 ? null : (seat as Mark),
      pauseMs: ROUND_PAUSE_MS,
      forfeitMs: FORFEIT_MS,
      forfeitAt: awaySince === null ? null : awaySince + FORFEIT_MS,
    };
  },
};

export default tictactoe;
