import type { GameCtx, GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  AWAY_MS,
  DEFAULT_SEEDS,
  FORFEIT_MS,
  PAUSE_MS,
  PITS,
  STORE,
  TURN_MS,
  animMs,
  legalPits,
  newBoard,
  other,
  sow,
  sweepIfOver,
  type Capture,
  type Seat,
} from "./shared";

// Seeds: Kalah for two. 6 pits a side plus a store, sown counter-clockwise.
// Everything is public, so the view only adds the viewer's seat. Timers are
// absolute deadlines in state and tick() moves things along, like Four in a Row:
// a timed-out mover gets a random pit sown for them, a disconnected mover after
// 5s (both away: the turn freezes), and a full minute away forfeits the match.

export type { Seat } from "./shared";
export type Phase = "turn" | "between" | "over";
export type Ending = "wins" | "cap" | "forfeit" | "abandoned" | "short";

export interface LastMove {
  seat: Seat;
  /** Pit number 0-5 on the mover's side. */
  pit: number;
  /** The board before the move (so clients can replay it seed by seed). */
  from: number[];
  /** Slots each seed landed in, in order. */
  path: number[];
  capture: Capture | null;
  extra: boolean;
  /** Seeds each seat banked when the move emptied a side (game over), else null. */
  sweep: [number, number] | null;
  /** True when the server sowed it (timer ran out or the mover was away). */
  auto: boolean;
}

export interface SeedsState {
  seats: [string, string];
  board: number[];
  phase: Phase;
  turn: Seat;
  starter: Seat;
  /** Game wins per seat. */
  score: [number, number];
  game: number;
  /** Finished games: winning seat or null for a draw, with the final stores. */
  results: { winner: Seat | null; stores: [number, number] }[];
  /** Moves made in the whole match; identifies the current turn for clients. */
  seq: number;
  last: LastMove | null;
  endsAt: number;
  timerMs: number;
  /** When the current turn's clock starts (after the previous move's animation). */
  turnStartedAt: number;
  awaySince: [number | null, number | null];
  champions: Seat[] | null;
  ending: Ending | null;
  quitter: Seat | null;
  target: number;
  maxGames: number;
  turnMs: number;
  seeds: number;
}

export type SeedsAction = { type: "sow"; pit: number };

export interface SeedsView {
  seats: [string, string];
  board: number[];
  phase: Phase;
  turn: Seat;
  starter: Seat;
  score: [number, number];
  game: number;
  results: { winner: Seat | null; stores: [number, number] }[];
  seq: number;
  last: LastMove | null;
  endsAt: number;
  timerMs: number;
  forfeitAt: [number | null, number | null];
  champions: Seat[] | null;
  ending: Ending | null;
  quitter: Seat | null;
  you: Seat | null;
  target: number;
  maxGames: number;
  seeds: number;
}

const SEATS: readonly Seat[] = [0, 1];
const bothAway = (s: SeedsState) => s.awaySince[0] !== null && s.awaySince[1] !== null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function seatOf(s: SeedsState, id: unknown): Seat | null {
  if (typeof id !== "string" || !id) return null;
  if (id === s.seats[0]) return 0;
  if (id === s.seats[1]) return 1;
  return null;
}

function nameOf(s: SeedsState, seat: Seat, ctx: GameCtx): string {
  return ctx.player(s.seats[seat])?.name ?? `Player ${seat + 1}`;
}

function lastAnimMs(s: SeedsState): number {
  const l = s.last;
  return l ? animMs(l.path.length, l.capture !== null, l.sweep !== null) : 0;
}

function setTurnClock(s: SeedsState) {
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

/** The clock starts once the previous move has finished animating. */
function beginTurn(s: SeedsState, seat: Seat, ctx: GameCtx, delay = 0) {
  s.phase = "turn";
  s.turn = seat;
  s.turnStartedAt = ctx.now() + delay;
  setTurnClock(s);
}

function seatLeft(s: SeedsState, seat: Seat, ctx: GameCtx) {
  if (s.phase === "over" || s.awaySince[seat] !== null) return;
  s.awaySince[seat] = ctx.now();
  if (s.phase === "turn" && s.turn === seat) setTurnClock(s);
}

function seatReturned(s: SeedsState, seat: Seat, ctx: GameCtx) {
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

function checkForfeit(s: SeedsState, ctx: GameCtx, now: number): boolean {
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

function endMatch(s: SeedsState, winners: Seat[], ending: Ending, ctx: GameCtx, quitter: Seat | null = null) {
  if (s.phase === "over") return;
  s.phase = "over";
  s.champions = winners;
  s.ending = ending;
  s.quitter = quitter;
  s.endsAt = 0;
  s.timerMs = 0;

  const lastGame = s.results[s.results.length - 1];
  const single = s.target === 1;
  // Best of 1: the seeds banked are the interesting number; otherwise game wins.
  const tally = (seat: Seat) => (single ? (lastGame?.stores[seat] ?? s.board[STORE[seat]]) : s.score[seat]);
  let headline: string;
  if (ending === "short") headline = "Seeds needs 2 players";
  else if (ending === "abandoned") headline = "Seeds abandoned: both players left";
  else if (winners.length === 2) {
    headline = single
      ? `${nameOf(s, 0, ctx)} and ${nameOf(s, 1, ctx)} draw at Seeds ${tally(0)}–${tally(1)}`
      : `${nameOf(s, 0, ctx)} and ${nameOf(s, 1, ctx)} tie Seeds ${tally(0)}–${tally(1)}`;
  } else {
    const w = winners[0];
    headline =
      ending === "forfeit"
        ? `${nameOf(s, w, ctx)} wins Seeds (${nameOf(s, other(w), ctx)} left)`
        : `${nameOf(s, w, ctx)} wins Seeds ${tally(w)}–${tally(other(w))}` + (ending === "cap" ? ` after ${s.maxGames} games` : "");
  }
  const scores: Record<string, number> = {};
  for (const seat of SEATS) if (s.seats[seat]) scores[s.seats[seat]] = tally(seat);
  ctx.end({ winners: winners.map((w) => s.seats[w]).filter(Boolean), headline, scores });
}

function finishGame(s: SeedsState, ctx: GameCtx) {
  const stores: [number, number] = [s.board[STORE[0]], s.board[STORE[1]]];
  const winner: Seat | null = stores[0] === stores[1] ? null : stores[0] > stores[1] ? 0 : 1;
  s.results.push({ winner, stores });
  if (winner !== null) s.score[winner] += 1;
  const [a, b] = s.score;
  if (s.target === 1 && winner === null) return endMatch(s, [0, 1], "wins", ctx);
  if (a >= s.target || b >= s.target) return endMatch(s, [a >= s.target ? 0 : 1], "wins", ctx);
  if (s.results.length >= s.maxGames) return endMatch(s, a === b ? [0, 1] : [a > b ? 0 : 1], "cap", ctx);
  s.phase = "between";
  s.timerMs = lastAnimMs(s) + PAUSE_MS;
  s.endsAt = ctx.now() + s.timerMs;
}

function play(s: SeedsState, seat: Seat, pit: number, auto: boolean, ctx: GameCtx): boolean {
  if (!legalPits(s.board, seat).includes(pit)) return false;
  const from = s.board;
  const r = sow(from, seat, pit);
  s.board = r.board;
  const sweep = sweepIfOver(s.board);
  s.seq += 1;
  s.last = { seat, pit, from, path: r.path, capture: r.capture, extra: r.extra && !sweep, sweep, auto };
  if (sweep) finishGame(s, ctx);
  else beginTurn(s, r.extra ? seat : other(seat), ctx, lastAnimMs(s));
  return true;
}

function autoSow(s: SeedsState, ctx: GameCtx) {
  const legal = legalPits(s.board, s.turn);
  if (!legal.length) {
    // Unreachable (an empty side ends the game), but never get stuck.
    sweepIfOver(s.board);
    finishGame(s, ctx);
    return;
  }
  play(s, s.turn, legal[Math.min(legal.length - 1, Math.floor(ctx.random() * legal.length))], true, ctx);
}

function nextGame(s: SeedsState, ctx: GameCtx) {
  s.board = newBoard(s.seeds);
  s.last = null;
  s.game += 1;
  s.starter = other(s.starter);
  beginTurn(s, s.starter, ctx);
}

function syncPresence(s: SeedsState, ctx: GameCtx): boolean {
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
// Medium: a depth-limited minimax on store difference (an extra turn keeps the same
// player moving, so it naturally chains them), then a little noise so it sometimes
// takes the second-best pit. Only reads the public board.

function evaluate(board: number[], me: Seat): number {
  return board[STORE[me]] - board[STORE[other(me)]];
}

function search(board: number[], toMove: Seat, me: Seat, depth: number, alpha: number, beta: number): number {
  const legal = legalPits(board, toMove);
  if (depth === 0 || !legal.length) return evaluate(board, me);
  const maxing = toMove === me;
  let best = maxing ? -Infinity : Infinity;
  for (const n of legal) {
    const r = sow(board, toMove, n);
    const b = r.board;
    const over = sweepIfOver(b) !== null;
    const v = over ? evaluate(b, me) * 10 : search(b, r.extra ? toMove : other(toMove), me, depth - 1, alpha, beta);
    if (maxing) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, v);
    }
    if (beta <= alpha) break;
  }
  return best;
}

export function botPit(board: number[], me: Seat, random: () => number, depth = 4): number | null {
  const legal = legalPits(board, me);
  if (!legal.length) return null;
  const scored = legal.map((n) => {
    const r = sow(board, me, n);
    const b = r.board;
    const over = sweepIfOver(b) !== null;
    const v = over ? evaluate(b, me) * 10 : search(b, r.extra ? me : other(me), me, depth - 1, -Infinity, Infinity);
    return { n, v: v + random() * 1.5 };
  });
  scored.sort((a, b) => b.v - a.v);
  // Now and then settle for the runner-up (if it isn't much worse).
  if (scored.length > 1 && random() < 0.2 && scored[0].v - scored[1].v < 3) return scored[1].n;
  return scored[0].n;
}

const botMemory = new WeakMap<SeedsState, Map<string, { seq: number; at: number }>>();

function botMove(s: SeedsState, botId: string, ctx: GameCtx): SeedsAction | null {
  if (s.phase !== "turn") return null;
  const me = seatOf(s, botId);
  if (me === null || me !== s.turn) return null;
  let mem = botMemory.get(s);
  if (!mem) botMemory.set(s, (mem = new Map()));
  const now = ctx.now();
  const m = mem.get(botId);
  if (!m || m.seq !== s.seq) {
    mem.set(botId, { seq: s.seq, at: Math.max(now, s.turnStartedAt) + 800 + ctx.random() * 1200 });
    return null;
  }
  if (now < m.at) return null;
  const pit = botPit(s.board, me, ctx.random);
  return pit === null ? null : { type: "sow", pit };
}

export const seeds: GameDef<SeedsState, SeedsAction> = {
  id: "seeds",

  setup(ctx) {
    const [a, b] = ctx.players;
    const settings = readSettings(config.settings, ctx.settings);
    const target = Number(settings.wins) || 1;
    const turnMs = (Number(settings.turn) || TURN_MS / 1000) * 1000;
    const seedCount = Number(settings.seeds) || DEFAULT_SEEDS;
    const starter: Seat = ctx.random() < 0.5 ? 0 : 1;
    const now = ctx.now();
    return {
      seats: [a?.id ?? "", b?.id ?? ""],
      board: newBoard(seedCount),
      phase: "turn",
      turn: starter,
      starter,
      score: [0, 0],
      game: 1,
      results: [],
      seq: 0,
      last: null,
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
      seeds: seedCount,
    };
  },

  action(s, playerId, raw, ctx) {
    if (s.phase !== "turn" || !s.seats[0] || !s.seats[1]) return false;
    if (!isRecord(raw) || raw.type !== "sow") return false;
    const seat = seatOf(s, playerId);
    if (seat === null || seat !== s.turn) return false;
    const pit = raw.pit;
    if (typeof pit !== "number" || !Number.isInteger(pit) || pit < 0 || pit >= PITS) return false;
    return play(s, seat, pit, false, ctx);
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
      autoSow(s, ctx);
      return true;
    }
    return changed;
  },
  tickMs: 200,

  view(s, viewerId): SeedsView {
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
      endsAt: s.endsAt,
      timerMs: s.timerMs,
      forfeitAt: [forfeitAt(0), forfeitAt(1)],
      champions: s.champions,
      ending: s.ending,
      quitter: s.quitter,
      you: seatOf(s, viewerId),
      target: s.target,
      maxGames: s.maxGames,
      seeds: s.seeds,
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

export default seeds;
