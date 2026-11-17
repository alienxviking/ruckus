import type { GameCtx, GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  AWAY_MS,
  COLS,
  CONNECT,
  FORFEIT_MS,
  PAUSE_MS,
  ROWS,
  TARGET_WINS,
  TURN_MS,
} from "./shared";

// Four in a Row: two players, 7x6 board with gravity, best of 3 (draws don't
// count, the match stops after 5 games). Everything is public, so the view only
// adds the viewer's seat. Timers live in state as absolute deadlines (endsAt)
// and tick() moves things along: turn timeouts drop a random legal disc, a
// disconnected mover gets auto-dropped after 5s (unless both players are gone:
// then nobody is waiting, so the turn freezes), and someone gone for a full
// minute forfeits so the match always finishes (both gone a minute: abandoned).

export type Seat = 0 | 1;
export type Disc = Seat | null;
export type Phase = "turn" | "between" | "over";
/** [row, col]. Row 0 is the TOP row; discs fall towards row ROWS - 1. */
export type Cell = [number, number];
/** A winning run, end to end: [fromRow, fromCol, toRow, toCol]. */
export type Segment = [number, number, number, number];
/**
 * How the match finished: someone reached the target ("wins"), the game cap ran
 * out ("cap"), a player left ("forfeit"), both left ("abandoned"), or there was
 * never a second player ("short").
 */
export type Ending = "wins" | "cap" | "forfeit" | "abandoned" | "short";

export interface LastMove {
  row: number;
  col: number;
  seat: Seat;
  /** True when the server dropped it (turn timer ran out or the mover was away). */
  auto: boolean;
}

export interface WinInfo {
  seat: Seat;
  /** Every disc that is part of a line of four or more through the winning move. */
  cells: Cell[];
  /** The line(s) themselves, for drawing a strike-through. */
  lines: Segment[];
}

export interface FourState {
  seats: [string, string];
  board: Disc[][];
  phase: Phase;
  turn: Seat;
  /** Who started the current game; alternates each game. */
  starter: Seat;
  /** Game wins per seat. */
  score: [number, number];
  /** Current game number, 1-based. */
  game: number;
  /** Finished games: the winning seat, or null for a draw. */
  results: (Seat | null)[];
  /** Discs on the board in the current game. */
  moves: number;
  /** Discs dropped in the whole match; identifies the current turn for clients. */
  seq: number;
  last: LastMove | null;
  /** Winning line of the most recent game (kept through the pause and the final screen). */
  win: WinInfo | null;
  /** Turn deadline ("turn"), next game start ("between"), 0 once "over". */
  endsAt: number;
  /** Full length of the running timer, for countdown bars. */
  timerMs: number;
  turnStartedAt: number;
  /** When each seat disconnected (null = connected). */
  awaySince: [number | null, number | null];
  /** Match winner(s) once over; both seats on a tie after the game cap. */
  champions: Seat[] | null;
  ending: Ending | null;
  /** Seat that forfeited by leaving, if any. */
  quitter: Seat | null;
  /** Game wins needed to take the match (host setting). */
  target: number;
  /** Hard cap on games per match (2 * target + 1). */
  maxGames: number;
  /** Full turn length in ms (host setting). */
  turnMs: number;
  /** Anti-spam budget for hover events. */
  hoverWindow: number;
  hoverCount: number;
}

export type FourAction = { type: "drop"; col: number } | { type: "hover"; col: number | null };

/** Transient event: where the player to move is pointing (sent to everyone else). */
export interface HoverEvent {
  type: "hover";
  seat: Seat;
  col: number | null;
  /** FourView.seq at the time, so stale hovers from an older turn are ignored. */
  seq: number;
}

export interface FourView {
  seats: [string, string];
  /** ROWS x COLS, row 0 at the top: 0 / 1 = that seat's disc, null = empty. */
  board: Disc[][];
  phase: Phase;
  turn: Seat;
  starter: Seat;
  score: [number, number];
  game: number;
  results: (Seat | null)[];
  seq: number;
  last: LastMove | null;
  win: WinInfo | null;
  endsAt: number;
  timerMs: number;
  /** When each seat forfeits if they stay disconnected (null = connected). */
  forfeitAt: [number | null, number | null];
  champions: Seat[] | null;
  ending: Ending | null;
  quitter: Seat | null;
  /** The viewer's seat, or null for spectators. */
  you: Seat | null;
  target: number;
  maxGames: number;
}

const SEATS: readonly Seat[] = [0, 1];
const DIRECTIONS: readonly [number, number][] = [
  [0, 1], // across
  [1, 0], // down
  [1, 1], // diagonal ↘
  [1, -1], // diagonal ↙
];
/** Hover events allowed per second (a fast sweep across the board is ~8). */
const HOVER_BURST = 24;

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
/** Both players disconnected: nobody is waiting, so no discs are dropped for them. */
const bothAway = (s: FourState) => s.awaySince[0] !== null && s.awaySince[1] !== null;

function emptyBoard(): Disc[][] {
  return Array.from({ length: ROWS }, () => Array<Disc>(COLS).fill(null));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCol(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < COLS;
}

function seatOf(s: FourState, id: unknown): Seat | null {
  if (typeof id !== "string" || !id) return null;
  if (id === s.seats[0]) return 0;
  if (id === s.seats[1]) return 1;
  return null;
}

function discAt(board: Disc[][], r: number, c: number): Disc | undefined {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS ? board[r][c] : undefined;
}

/** Lowest empty row in a column, or -1 when it is full. */
export function landingRow(board: Disc[][], col: number): number {
  for (let r = ROWS - 1; r >= 0; r--) if (board[r][col] === null) return r;
  return -1;
}

/** Lines of CONNECT+ through the disc at (row, col), or null. */
export function findWin(board: Disc[][], row: number, col: number): WinInfo | null {
  const seat = discAt(board, row, col);
  if (seat === null || seat === undefined) return null;
  const cells: Cell[] = [];
  const lines: Segment[] = [];
  const seen = new Set<number>();
  for (const [dr, dc] of DIRECTIONS) {
    let r1 = row;
    let c1 = col;
    while (discAt(board, r1 - dr, c1 - dc) === seat) {
      r1 -= dr;
      c1 -= dc;
    }
    let r2 = row;
    let c2 = col;
    while (discAt(board, r2 + dr, c2 + dc) === seat) {
      r2 += dr;
      c2 += dc;
    }
    const len = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1)) + 1;
    if (len < CONNECT) continue;
    lines.push([r1, c1, r2, c2]);
    for (let i = 0; i < len; i++) {
      const r = r1 + i * dr;
      const c = c1 + i * dc;
      if (seen.has(r * COLS + c)) continue;
      seen.add(r * COLS + c);
      cells.push([r, c]);
    }
  }
  return lines.length ? { seat, cells, lines } : null;
}

function nameOf(s: FourState, seat: Seat, ctx: GameCtx): string {
  return ctx.player(s.seats[seat])?.name ?? `Player ${seat + 1}`;
}

/** Set endsAt for the current turn: 30s normally, 5s while the mover is disconnected. */
function setTurnClock(s: FourState) {
  const full = s.turnStartedAt + s.turnMs;
  const away = s.awaySince[s.turn];
  if (away === null) {
    s.endsAt = full;
    s.timerMs = s.turnMs;
  } else {
    s.endsAt = Math.min(full, Math.max(s.turnStartedAt, away) + AWAY_MS);
    s.timerMs = AWAY_MS;
  }
}

function beginTurn(s: FourState, seat: Seat, ctx: GameCtx) {
  s.phase = "turn";
  s.turn = seat;
  s.turnStartedAt = ctx.now();
  s.hoverWindow = s.turnStartedAt;
  s.hoverCount = 0;
  setTurnClock(s);
}

/** A seat disconnected: shorten their turn clock and clear their hover preview. */
function seatLeft(s: FourState, seat: Seat, ctx: GameCtx) {
  if (s.phase === "over" || s.awaySince[seat] !== null) return;
  s.awaySince[seat] = ctx.now();
  if (s.phase === "turn" && s.turn === seat) {
    setTurnClock(s);
    // Nobody should keep seeing a column the auto-drop will ignore.
    const ev: HoverEvent = { type: "hover", seat, col: null, seq: s.seq };
    ctx.emit(ev, { except: s.seats[seat] });
  }
}

/** A seat reconnected: settle a pending forfeit, or restore / restart the turn clock. */
function seatReturned(s: FourState, seat: Seat, ctx: GameCtx) {
  const since = s.awaySince[seat];
  if (s.phase === "over" || since === null) return;
  const now = ctx.now();
  // Already gone a full minute: coming back (say, while the other player is
  // briefly away) doesn't undo the forfeit.
  if (now - since >= FORFEIT_MS) {
    const otherSince = s.awaySince[other(seat)];
    if (otherSince !== null && now - otherSince >= FORFEIT_MS) endMatch(s, [], "abandoned", ctx);
    else endMatch(s, [other(seat)], "forfeit", ctx, seat);
    return;
  }
  const wasFrozen = bothAway(s);
  s.awaySince[seat] = null;
  if (checkForfeit(s, ctx, now)) return; // the other player's minute already ran out: we win
  if (s.phase !== "turn") return;
  // After a both-away freeze the old deadline is stale: start the turn afresh.
  if (wasFrozen) beginTurn(s, s.turn, ctx);
  else setTurnClock(s);
}

/**
 * A seat away for FORFEIT_MS forfeits. If the other seat is away too, they get
 * their own full minute to come back and claim the win; only when both have
 * been gone that long is the match abandoned. Returns true when it ended.
 */
function checkForfeit(s: FourState, ctx: GameCtx, now: number): boolean {
  if (s.phase === "over") return false;
  for (const seat of SEATS) {
    const since = s.awaySince[seat];
    if (since === null || now - since < FORFEIT_MS) continue;
    const otherSince = s.awaySince[other(seat)];
    if (otherSince === null) {
      endMatch(s, [other(seat)], "forfeit", ctx, seat);
      return true;
    }
    if (now - otherSince >= FORFEIT_MS) {
      endMatch(s, [], "abandoned", ctx);
      return true;
    }
  }
  return false;
}

function endMatch(s: FourState, winners: Seat[], ending: Ending, ctx: GameCtx, quitter: Seat | null = null) {
  if (s.phase === "over") return;
  s.phase = "over";
  s.champions = winners;
  s.ending = ending;
  s.quitter = quitter;
  s.endsAt = 0;
  s.timerMs = 0;

  const [a, b] = s.score;
  let headline: string;
  if (ending === "short") {
    headline = "Four in a Row needs 2 players";
  } else if (ending === "abandoned") {
    headline = "Four in a Row abandoned: both players left";
  } else if (winners.length === 2) {
    headline = `${nameOf(s, 0, ctx)} and ${nameOf(s, 1, ctx)} tie Four in a Row ${a}–${b}`;
  } else {
    const w = winners[0];
    const score = `${s.score[w]}–${s.score[other(w)]}`;
    headline =
      ending === "forfeit"
        ? `${nameOf(s, w, ctx)} wins Four in a Row (${nameOf(s, other(w), ctx)} left)`
        : `${nameOf(s, w, ctx)} wins Four in a Row ${score}` + (ending === "cap" ? ` after ${s.maxGames} games` : "");
  }

  const scores: Record<string, number> = {};
  for (const seat of SEATS) if (s.seats[seat]) scores[s.seats[seat]] = s.score[seat];
  ctx.end({ winners: winners.map((w) => s.seats[w]).filter(Boolean), headline, scores });
}

/** A game just ended (win or draw): finish the match or pause before the next game. */
function finishGame(s: FourState, ctx: GameCtx) {
  const [a, b] = s.score;
  if (a >= s.target || b >= s.target) return endMatch(s, [a >= s.target ? 0 : 1], "wins", ctx);
  if (s.results.length >= s.maxGames) return endMatch(s, a === b ? [0, 1] : [a > b ? 0 : 1], "cap", ctx);
  s.phase = "between";
  s.endsAt = ctx.now() + PAUSE_MS;
  s.timerMs = PAUSE_MS;
}

function place(s: FourState, seat: Seat, col: number, auto: boolean, ctx: GameCtx): boolean {
  const row = landingRow(s.board, col);
  if (row < 0) return false;
  s.board[row][col] = seat;
  s.moves += 1;
  s.seq += 1;
  s.last = { row, col, seat, auto };
  const win = findWin(s.board, row, col);
  if (win) {
    s.win = win;
    s.score[seat] += 1;
    s.results.push(seat);
    finishGame(s, ctx);
  } else if (s.moves >= ROWS * COLS) {
    s.results.push(null);
    finishGame(s, ctx);
  } else {
    beginTurn(s, other(seat), ctx);
  }
  return true;
}

function autoDrop(s: FourState, ctx: GameCtx) {
  const open: number[] = [];
  for (let c = 0; c < COLS; c++) if (s.board[0][c] === null) open.push(c);
  if (!open.length) {
    // Unreachable (a full board is already a draw), but never get stuck.
    s.results.push(null);
    finishGame(s, ctx);
    return;
  }
  const col = open[Math.min(open.length - 1, Math.floor(ctx.random() * open.length))];
  place(s, s.turn, col, true, ctx);
}

function nextGame(s: FourState, ctx: GameCtx) {
  s.board = emptyBoard();
  s.moves = 0;
  s.last = null;
  s.win = null;
  s.game += 1;
  s.starter = other(s.starter);
  beginTurn(s, s.starter, ctx);
}

/** Reconcile awaySince with the room's connection flags (in case a hook was missed). */
function syncPresence(s: FourState, ctx: GameCtx): boolean {
  let changed = false;
  for (const seat of SEATS) {
    const p = ctx.player(s.seats[seat]);
    const away = !p || !p.connected;
    if (away === (s.awaySince[seat] !== null)) continue;
    changed = true;
    if (away) seatLeft(s, seat, ctx);
    else seatReturned(s, seat, ctx);
  }
  return changed;
}


// ---- Practice bot -------------------------------------------------------------
// Medium skill: takes a win, usually blocks, avoids handing over an instant win,
// otherwise leans to the centre with some randomness. Everything is public, so it
// reads the same board a human sees. Think time is tracked per turn (seq).
const botMemory = new WeakMap<FourState, Map<string, { seq: number; at: number }>>();

function winsAt(board: Disc[][], col: number, seat: Seat): boolean {
  const row = landingRow(board, col);
  if (row < 0) return false;
  board[row][col] = seat;
  const win = findWin(board, row, col) !== null;
  board[row][col] = null;
  return win;
}

function botColumn(s: FourState, me: Seat, random: () => number): number | null {
  const board = s.board;
  const open: number[] = [];
  for (let c = 0; c < COLS; c++) if (board[0][c] === null) open.push(c);
  if (!open.length) return null;
  const them = other(me);
  const win = open.find((c) => winsAt(board, c, me));
  if (win !== undefined) return win;
  const block = open.find((c) => winsAt(board, c, them));
  if (block !== undefined && random() < 0.85) return block;
  // Columns that don't let the opponent win right on top of our disc.
  const safe = open.filter((c) => {
    const row = landingRow(board, c);
    if (row <= 0) return true;
    board[row][c] = me;
    const bad = winsAt(board, c, them);
    board[row][c] = null;
    return !bad;
  });
  const pool = safe.length ? safe : open;
  const centre = (COLS - 1) / 2;
  let best = pool[0];
  let bestScore = -Infinity;
  for (const c of pool) {
    const score = -Math.abs(c - centre) + random() * 2.2;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function botMove(s: FourState, botId: string, ctx: GameCtx): FourAction | null {
  if (s.phase !== "turn") return null;
  const me = seatOf(s, botId);
  if (me === null || me !== s.turn) return null;
  let mem = botMemory.get(s);
  if (!mem) botMemory.set(s, (mem = new Map()));
  const now = ctx.now();
  const m = mem.get(botId);
  if (!m || m.seq !== s.seq) {
    mem.set(botId, { seq: s.seq, at: now + 700 + ctx.random() * 1600 });
    return null;
  }
  if (now < m.at) return null;
  const col = botColumn(s, me, ctx.random);
  return col === null ? null : { type: "drop", col };
}

export const fourrow: GameDef<FourState, FourAction> = {
  id: "fourrow",

  setup(ctx) {
    const [a, b] = ctx.players;
    const settings = readSettings(config.settings, ctx.settings);
    const target = Number(settings.wins) || TARGET_WINS;
    const turnMs = (Number(settings.turn) || TURN_MS / 1000) * 1000;
    const starter: Seat = ctx.random() < 0.5 ? 0 : 1;
    const now = ctx.now();
    return {
      seats: [a?.id ?? "", b?.id ?? ""],
      board: emptyBoard(),
      phase: "turn",
      turn: starter,
      starter,
      score: [0, 0],
      game: 1,
      results: [],
      moves: 0,
      seq: 0,
      last: null,
      win: null,
      endsAt: now + turnMs,
      timerMs: turnMs,
      turnStartedAt: now,
      awaySince: [null, null],
      champions: null,
      ending: null,
      quitter: null,
      target,
      maxGames: target * 2 + 1,
      turnMs,
      hoverWindow: 0,
      hoverCount: 0,
    };
  },

  action(s, playerId, raw, ctx) {
    if (s.phase !== "turn" || !s.seats[0] || !s.seats[1]) return false;
    if (!isRecord(raw)) return false;
    const seat = seatOf(s, playerId);
    if (seat === null || seat !== s.turn) return false;

    if (raw.type === "drop") {
      if (!isCol(raw.col) || s.board[0][raw.col] !== null) return false;
      return place(s, seat, raw.col, false, ctx);
    }

    if (raw.type === "hover") {
      const col = raw.col;
      if (col !== null && !isCol(col)) return false;
      const now = ctx.now();
      if (now - s.hoverWindow >= 1000) {
        s.hoverWindow = now;
        s.hoverCount = 0;
      }
      if (s.hoverCount >= HOVER_BURST) return false;
      s.hoverCount += 1;
      const ev: HoverEvent = { type: "hover", seat, col, seq: s.seq };
      ctx.emit(ev, { except: playerId });
      return false; // only an event; nothing to re-broadcast
    }

    return false;
  },

  tick(s, ctx) {
    if (s.phase === "over") return false;
    if (!s.seats[0] || !s.seats[1]) {
      endMatch(s, [], "short", ctx);
      return true;
    }
    const now = ctx.now();
    const changed = syncPresence(s, ctx);
    if (s.ending !== null) return true; // a return noticed by syncPresence settled a forfeit
    if (checkForfeit(s, ctx, now)) return true;

    if (s.phase === "between" && now >= s.endsAt) {
      nextGame(s, ctx);
      return true;
    }
    if (s.phase === "turn" && now >= s.endsAt && !bothAway(s)) {
      autoDrop(s, ctx);
      return true;
    }
    return changed;
  },
  tickMs: 200,

  view(s, viewerId): FourView {
    const over = s.phase === "over";
    const forfeitAt = (seat: Seat) => {
      const since = s.awaySince[seat];
      return over || since === null ? null : since + FORFEIT_MS;
    };
    return {
      seats: s.seats,
      board: s.board,
      phase: s.phase,
      turn: s.turn,
      starter: s.starter,
      score: s.score,
      game: s.game,
      results: s.results,
      seq: s.seq,
      last: s.last,
      win: s.win,
      endsAt: s.endsAt,
      timerMs: s.timerMs,
      forfeitAt: [forfeitAt(0), forfeitAt(1)],
      champions: s.champions,
      ending: s.ending,
      quitter: s.quitter,
      you: seatOf(s, viewerId),
      target: s.target,
      maxGames: s.maxGames,
    };
  },

  playerLeft(s, playerId, ctx) {
    const seat = seatOf(s, playerId);
    if (seat !== null) seatLeft(s, seat, ctx);
  },

  playerReturned(s, playerId, ctx) {
    const seat = seatOf(s, playerId);
    if (seat !== null) seatReturned(s, seat, ctx);
  },

  bot: botMove,
};

export default fourrow;
