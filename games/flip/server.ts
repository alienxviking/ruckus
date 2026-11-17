import type { GameCtx, GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  AWAY_MS,
  DEFAULT_SIZE,
  FORFEIT_MS,
  PAUSE_MS,
  TARGET_WINS,
  TURN_MS,
  countDiscs,
  discOf,
  flipsFor,
  legalMoves,
  otherSeat as other,
  startBoard,
  type Seat,
} from "./shared";

// Flip: two players outflank each other's discs on a 6x6 or 8x8 board. Everything
// is public, so the view only adds the viewer's seat. Timers are absolute
// deadlines (endsAt) and tick() moves things along: a turn timeout plays a random
// legal move, a disconnected mover is auto-played after 5s (unless both players
// are gone: then the turn freezes), and someone gone a full minute forfeits.
// A player with no legal move passes automatically; when neither can move (or
// the board is full) the game ends and the most discs wins.

export type { Seat };
export type Phase = "turn" | "between" | "over";
export type Ending = "wins" | "cap" | "forfeit" | "abandoned" | "short";

export interface LastMove {
  cell: number;
  seat: Seat;
  /** Cells that flipped to the mover's colour. */
  flips: number[];
  /** True when the server played it (timer ran out or the mover was away). */
  auto: boolean;
}

export interface FlipState {
  seats: [string, string];
  size: number;
  board: number[];
  phase: Phase;
  turn: Seat;
  starter: Seat;
  /** Game wins per seat. */
  score: [number, number];
  game: number;
  /** Finished games: winning seat or null for a draw. */
  results: (Seat | null)[];
  /** Final disc counts of each finished game. */
  finals: [number, number][];
  /** Moves played in the whole match; identifies the current turn for clients. */
  seq: number;
  last: LastMove | null;
  /** Seat that had no move and passed right after the last move (null = nobody). */
  pass: Seat | null;
  endsAt: number;
  timerMs: number;
  turnStartedAt: number;
  awaySince: [number | null, number | null];
  champions: Seat[] | null;
  ending: Ending | null;
  quitter: Seat | null;
  target: number;
  maxGames: number;
  turnMs: number;
  hints: boolean;
}

export type FlipAction = { type: "place"; cell: number };

export interface FlipView {
  seats: [string, string];
  size: number;
  /** size*size digits: 0 empty, 1 seat 0, 2 seat 1. */
  board: string;
  phase: Phase;
  turn: Seat;
  starter: Seat;
  score: [number, number];
  game: number;
  results: (Seat | null)[];
  finals: [number, number][];
  seq: number;
  last: LastMove | null;
  pass: Seat | null;
  endsAt: number;
  timerMs: number;
  forfeitAt: [number | null, number | null];
  champions: Seat[] | null;
  ending: Ending | null;
  quitter: Seat | null;
  you: Seat | null;
  target: number;
  maxGames: number;
  hints: boolean;
}

const SEATS: readonly Seat[] = [0, 1];
const bothAway = (s: FlipState) => s.awaySince[0] !== null && s.awaySince[1] !== null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function seatOf(s: FlipState, id: unknown): Seat | null {
  if (typeof id !== "string" || !id) return null;
  if (id === s.seats[0]) return 0;
  if (id === s.seats[1]) return 1;
  return null;
}

function nameOf(s: FlipState, seat: Seat, ctx: GameCtx): string {
  return ctx.player(s.seats[seat])?.name ?? `Player ${seat + 1}`;
}

function setTurnClock(s: FlipState) {
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

function beginTurn(s: FlipState, seat: Seat, ctx: GameCtx) {
  s.phase = "turn";
  s.turn = seat;
  s.turnStartedAt = ctx.now();
  setTurnClock(s);
}

function seatLeft(s: FlipState, seat: Seat, ctx: GameCtx) {
  if (s.phase === "over" || s.awaySince[seat] !== null) return;
  s.awaySince[seat] = ctx.now();
  if (s.phase === "turn" && s.turn === seat) setTurnClock(s);
}

function seatReturned(s: FlipState, seat: Seat, ctx: GameCtx) {
  const since = s.awaySince[seat];
  if (s.phase === "over" || since === null) return;
  const now = ctx.now();
  if (now - since >= FORFEIT_MS) {
    const otherSince = s.awaySince[other(seat)];
    if (otherSince !== null && now - otherSince >= FORFEIT_MS) endMatch(s, [], "abandoned", ctx);
    else endMatch(s, [other(seat)], "forfeit", ctx, seat);
    return;
  }
  const wasFrozen = bothAway(s);
  s.awaySince[seat] = null;
  if (checkForfeit(s, ctx, now)) return;
  if (s.phase !== "turn") return;
  if (wasFrozen) beginTurn(s, s.turn, ctx);
  else setTurnClock(s);
}

function checkForfeit(s: FlipState, ctx: GameCtx, now: number): boolean {
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

function endMatch(s: FlipState, winners: Seat[], ending: Ending, ctx: GameCtx, quitter: Seat | null = null) {
  if (s.phase === "over") return;
  s.phase = "over";
  s.champions = winners;
  s.ending = ending;
  s.quitter = quitter;
  s.endsAt = 0;
  s.timerMs = 0;

  // A single game is scored in discs; a longer match in game wins.
  const single = s.target === 1;
  const discs = s.finals.length ? s.finals[s.finals.length - 1] : countDiscs(s.board);
  const shown: [number, number] = single ? discs : s.score;
  let headline: string;
  if (ending === "short") headline = "Flip needs 2 players";
  else if (ending === "abandoned") headline = "Flip abandoned: both players left";
  else if (winners.length === 0 || winners.length === 2) {
    headline = single
      ? `${nameOf(s, 0, ctx)} and ${nameOf(s, 1, ctx)} draw Flip ${shown[0]}–${shown[1]}`
      : `${nameOf(s, 0, ctx)} and ${nameOf(s, 1, ctx)} tie Flip ${shown[0]}–${shown[1]}`;
  } else {
    const w = winners[0];
    const score = `${shown[w]}–${shown[other(w)]}`;
    headline =
      ending === "forfeit"
        ? `${nameOf(s, w, ctx)} wins Flip (${nameOf(s, other(w), ctx)} left)`
        : `${nameOf(s, w, ctx)} wins Flip ${score}` + (ending === "cap" ? ` after ${s.maxGames} games` : "");
  }

  const scores: Record<string, number> = {};
  for (const seat of SEATS) if (s.seats[seat]) scores[s.seats[seat]] = shown[seat];
  ctx.end({ winners: winners.map((w) => s.seats[w]).filter(Boolean), headline, scores });
}

/** The current game is over: count discs, score it, then pause or finish the match. */
function finishGame(s: FlipState, ctx: GameCtx) {
  const [a, b] = countDiscs(s.board);
  s.finals.push([a, b]);
  const winner: Seat | null = a === b ? null : a > b ? 0 : 1;
  s.results.push(winner);
  if (winner !== null) s.score[winner] += 1;
  const [wa, wb] = s.score;
  if (s.target === 1) return endMatch(s, winner === null ? [] : [winner], "wins", ctx);
  if (wa >= s.target || wb >= s.target) return endMatch(s, [wa >= s.target ? 0 : 1], "wins", ctx);
  if (s.results.length >= s.maxGames) return endMatch(s, wa === wb ? [] : [wa > wb ? 0 : 1], "cap", ctx);
  s.phase = "between";
  s.endsAt = ctx.now() + PAUSE_MS;
  s.timerMs = PAUSE_MS;
}

function place(s: FlipState, seat: Seat, cell: number, auto: boolean, ctx: GameCtx): boolean {
  const flips = flipsFor(s.board, s.size, cell, seat);
  if (!flips.length) return false;
  const d = discOf(seat);
  s.board[cell] = d;
  for (const f of flips) s.board[f] = d;
  s.seq += 1;
  s.last = { cell, seat, flips, auto };
  s.pass = null;
  const next = other(seat);
  if (legalMoves(s.board, s.size, next).length) beginTurn(s, next, ctx);
  else if (legalMoves(s.board, s.size, seat).length) {
    s.pass = next; // they have no move: the turn comes straight back
    beginTurn(s, seat, ctx);
  } else finishGame(s, ctx);
  return true;
}

function autoMove(s: FlipState, ctx: GameCtx) {
  const moves = legalMoves(s.board, s.size, s.turn);
  if (!moves.length) {
    finishGame(s, ctx); // unreachable (turns only go to a seat that can move), but never stall
    return;
  }
  place(s, s.turn, moves[Math.min(moves.length - 1, Math.floor(ctx.random() * moves.length))], true, ctx);
}

function nextGame(s: FlipState, ctx: GameCtx) {
  s.starter = other(s.starter);
  s.board = startBoard(s.size, s.starter);
  s.last = null;
  s.pass = null;
  s.game += 1;
  beginTurn(s, s.starter, ctx);
}

function syncPresence(s: FlipState, ctx: GameCtx): boolean {
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
// Medium skill: a positional weight table (corners great, the squares next to an
// empty corner bad, edges good) plus mobility, looking one reply ahead (2-ply),
// with noise so it isn't predictable. Near the end it switches to counting discs.
// It reads only the public board.

/** Positional value of each square for a board of this size. */
export function weights(size: number): number[] {
  const w: number[] = [];
  const last = size - 1;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const edgeR = r === 0 || r === last;
      const edgeC = c === 0 || c === last;
      const nearR = r === 1 || r === last - 1;
      const nearC = c === 1 || c === last - 1;
      let v = 1;
      if (edgeR && edgeC) v = 100;
      else if (nearR && nearC) v = -40; // X-square
      else if ((edgeR && nearC) || (edgeC && nearR)) v = -15; // C-square
      else if (edgeR || edgeC) v = 8;
      else if (nearR || nearC) v = -3;
      w.push(v);
    }
  }
  return w;
}

const weightCache = new Map<number, number[]>();
function weightsFor(size: number) {
  let w = weightCache.get(size);
  if (!w) weightCache.set(size, (w = weights(size)));
  return w;
}

function applyMove(board: number[], size: number, cell: number, seat: Seat): number[] {
  const b = board.slice();
  const d = discOf(seat);
  b[cell] = d;
  for (const f of flipsFor(board, size, cell, seat)) b[f] = d;
  return b;
}

/** Board value from `me`'s point of view. */
function evaluate(board: number[], size: number, me: Seat): number {
  const them = other(me);
  const empties = board.filter((x) => x === 0).length;
  const [a, b] = countDiscs(board);
  const mine = me === 0 ? a : b;
  const theirs = me === 0 ? b : a;
  if (empties <= Math.max(6, size)) return (mine - theirs) * 10;
  const w = weightsFor(size);
  let pos = 0;
  for (let i = 0; i < board.length; i++) {
    if (board[i] === discOf(me)) pos += w[i];
    else if (board[i] === discOf(them)) pos -= w[i];
  }
  const mob = legalMoves(board, size, me).length - legalMoves(board, size, them).length;
  return pos + mob * 4;
}

export function botPick(board: number[], size: number, me: Seat, random: () => number): number | null {
  const moves = legalMoves(board, size, me);
  if (!moves.length) return null;
  const them = other(me);
  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const after = applyMove(board, size, m, me);
    const replies = legalMoves(after, size, them);
    let score: number;
    if (!replies.length) score = evaluate(after, size, me) + 15;
    else {
      score = Infinity;
      for (const r of replies) score = Math.min(score, evaluate(applyMove(after, size, r, them), size, me));
    }
    score += random() * 14;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

const botMemory = new WeakMap<FlipState, Map<string, { seq: number; game: number; at: number }>>();

function botMove(s: FlipState, botId: string, ctx: GameCtx): FlipAction | null {
  if (s.phase !== "turn") return null;
  const me = seatOf(s, botId);
  if (me === null || me !== s.turn) return null;
  let mem = botMemory.get(s);
  if (!mem) botMemory.set(s, (mem = new Map()));
  const now = ctx.now();
  const m = mem.get(botId);
  if (!m || m.seq !== s.seq || m.game !== s.game) {
    mem.set(botId, { seq: s.seq, game: s.game, at: now + 800 + ctx.random() * 1200 });
    return null;
  }
  if (now < m.at) return null;
  const cell = botPick(s.board, s.size, me, ctx.random);
  return cell === null ? null : { type: "place", cell };
}

export const flip: GameDef<FlipState, FlipAction> = {
  id: "flip",

  setup(ctx) {
    const [a, b] = ctx.players;
    const settings = readSettings(config.settings, ctx.settings);
    const size = Number(settings.size) === 6 ? 6 : DEFAULT_SIZE;
    const target = Number(settings.wins) || TARGET_WINS;
    const starter: Seat = ctx.random() < 0.5 ? 0 : 1;
    const now = ctx.now();
    return {
      seats: [a?.id ?? "", b?.id ?? ""],
      size,
      board: startBoard(size, starter),
      phase: "turn",
      turn: starter,
      starter,
      score: [0, 0],
      game: 1,
      results: [],
      finals: [],
      seq: 0,
      last: null,
      pass: null,
      endsAt: now + TURN_MS,
      timerMs: TURN_MS,
      turnStartedAt: now,
      awaySince: [null, null],
      champions: null,
      ending: null,
      quitter: null,
      target,
      maxGames: target * 2 + 1, // drawn games count for nobody, so cap the match
      turnMs: TURN_MS,
      hints: settings.hints !== "off",
    };
  },

  action(s, playerId, raw, ctx) {
    if (s.phase !== "turn" || !s.seats[0] || !s.seats[1]) return false;
    if (!isRecord(raw) || raw.type !== "place") return false;
    const seat = seatOf(s, playerId);
    if (seat === null || seat !== s.turn) return false;
    const cell = raw.cell;
    if (typeof cell !== "number" || !Number.isInteger(cell) || cell < 0 || cell >= s.size * s.size) return false;
    return place(s, seat, cell, false, ctx);
  },

  tick(s, ctx) {
    if (s.phase === "over") return false;
    if (!s.seats[0] || !s.seats[1]) {
      endMatch(s, [], "short", ctx);
      return true;
    }
    const now = ctx.now();
    const changed = syncPresence(s, ctx);
    if (s.ending !== null) return true;
    if (checkForfeit(s, ctx, now)) return true;
    if (s.phase === "between" && now >= s.endsAt) {
      nextGame(s, ctx);
      return true;
    }
    if (s.phase === "turn" && now >= s.endsAt && !bothAway(s)) {
      autoMove(s, ctx);
      return true;
    }
    return changed;
  },
  tickMs: 250,

  view(s, viewerId): FlipView {
    const over = s.phase === "over";
    const forfeitAt = (seat: Seat) => {
      const since = s.awaySince[seat];
      return over || since === null ? null : since + FORFEIT_MS;
    };
    return {
      seats: s.seats,
      size: s.size,
      board: s.board.join(""),
      phase: s.phase,
      turn: s.turn,
      starter: s.starter,
      score: s.score,
      game: s.game,
      results: s.results,
      finals: s.finals,
      seq: s.seq,
      last: s.last,
      pass: s.pass,
      endsAt: s.endsAt,
      timerMs: s.timerMs,
      forfeitAt: [forfeitAt(0), forfeitAt(1)],
      champions: s.champions,
      ending: s.ending,
      quitter: s.quitter,
      you: seatOf(s, viewerId),
      target: s.target,
      maxGames: s.maxGames,
      hints: s.hints,
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

export default flip;
