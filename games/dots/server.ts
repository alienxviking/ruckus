import { pick, shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  ABANDON_MS,
  AWAY_MS,
  CHAIN_MS,
  IDLE_STRIKES,
  TURN_MS,
  allLines,
  boardSize,
  boxesBeside,
  lineIndex,
  ownerOf,
  sideCount,
  sidesOfBox,
  type DotsView,
  type LastLine,
  type LineRef,
} from "./shared";

export type { DotsAction, DotsView } from "./shared";

// Dots & Boxes: take turns drawing a line between two neighbouring dots.
// Closing the fourth side of a box claims it and earns another move.
// Every move has a timer; when it runs out (or the mover is away) a sensible
// line is drawn automatically, so the game can never stall.

export interface DotsState {
  rows: number;
  cols: number;
  /** Player ids by seat (join order). Owners and `turn` are seat indices. */
  seats: string[];
  h: number[];
  v: number[];
  boxes: number[];
  scores: number[];
  turn: number;
  /** When the current move began, so a returning player gets their clock back. */
  moveStartedAt: number;
  endsAt: number | null;
  turnMs: number;
  /** Full thinking time per move (host setting). */
  moveMs: number;
  /** Moves in a row each seat let time out while connected (IDLE_STRIKES+ = idle). */
  strikes: number[];
  lastLine: LastLine | null;
  moves: number;
  /** Since when fewer than two participants have been connected (null = enough). */
  aloneSince: number | null;
  over: boolean;
  reason: "done" | "forfeit" | null;
  winners: number[];
}

const MIN_CONNECTED = 2;
const MAX_STRIKES = 9;
const GAME = "Dots & Boxes";

const isConnected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected === true;

/** pick(), but never undefined even if random() misbehaves. */
const choose = <T>(xs: T[], random: () => number): T => pick(xs, random) ?? xs[0];

function nameOf(ctx: GameCtx, id: string): string {
  return ctx.player(id)?.name ?? ctx.players.find((p) => p.id === id)?.name ?? "Someone";
}

/** "A", "A & B", "A, B & C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "Nobody";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function isAway(s: DotsState, ctx: GameCtx, seat: number): boolean {
  return !isConnected(ctx, s.seats[seat]) || s.strikes[seat] >= IDLE_STRIKES;
}

/** Hand the move to `seat` and start its clock. */
function beginMove(s: DotsState, ctx: GameCtx, seat: number, chained: boolean) {
  const now = ctx.now();
  s.turn = seat;
  s.moveStartedAt = now;
  s.turnMs = isAway(s, ctx, seat) ? (chained ? CHAIN_MS : AWAY_MS) : s.moveMs;
  s.endsAt = now + s.turnMs;
}

/** Track whether enough players are connected. Returns true if that changed. */
function updatePresence(s: DotsState, ctx: GameCtx): boolean {
  const online = s.seats.filter((id) => isConnected(ctx, id)).length;
  if (online < MIN_CONNECTED) {
    if (s.aloneSince !== null) return false;
    s.aloneSince = ctx.now();
    return true;
  }
  if (s.aloneSince === null) return false;
  s.aloneSince = null;
  return true;
}

function drawLine(s: DotsState, ctx: GameCtx, line: LineRef, seat: number, auto: boolean) {
  const idx = lineIndex(line.o, line.r, line.c, s.rows, s.cols);
  (line.o === "h" ? s.h : s.v)[idx] = seat;

  const claimed: number[] = [];
  for (const b of boxesBeside(line, s.rows, s.cols)) {
    if (s.boxes[b] === -1 && sideCount(s.h, s.v, b, s.cols) === 4) {
      s.boxes[b] = seat;
      s.scores[seat] += 1;
      claimed.push(b);
    }
  }
  s.moves += 1;
  s.lastLine = { o: line.o, r: line.r, c: line.c, seat, claimed, auto, n: s.moves };

  if (s.boxes.every((o) => o !== -1)) finishBoard(s, ctx);
  else if (claimed.length > 0) beginMove(s, ctx, seat, auto);
  else beginMove(s, ctx, (seat + 1) % s.seats.length, false);
}

function settle(s: DotsState, reason: "done" | "forfeit", winners: number[]) {
  s.over = true;
  s.reason = reason;
  s.winners = winners;
  s.turn = -1;
  s.endsAt = null;
  s.aloneSince = null;
}

function scoreRecord(s: DotsState): Record<string, number> {
  const scores: Record<string, number> = {};
  s.seats.forEach((id, seat) => (scores[id] = s.scores[seat]));
  return scores;
}

/** Every box is claimed: most boxes wins, ties all win. */
function finishBoard(s: DotsState, ctx: GameCtx) {
  const scores = scoreRecord(s);
  const winnerIds = topScorers(scores);
  const winners = winnerIds.map((id) => s.seats.indexOf(id));
  const line = [...s.scores].sort((a, b) => b - a).join("–");
  const names = winnerIds.map((id) => nameOf(ctx, id));
  const headline =
    names.length === 1
      ? `${names[0]} wins ${GAME} ${line}`
      : names.length > 1
        ? `${joinNames(names)} tie at ${GAME} ${line}`
        : `${GAME} ends ${line}`;
  settle(s, "done", winners);
  ctx.end({ winners: winnerIds, headline, scores });
}

/** Not enough players stayed connected: whoever is still here wins by default. */
function forfeit(s: DotsState, ctx: GameCtx) {
  const present = s.seats.map((_, seat) => seat).filter((seat) => isConnected(ctx, s.seats[seat]));
  const winners = present.length === 1 ? present : [];
  let headline: string;
  if (winners.length === 1) {
    const winner = s.seats[winners[0]];
    const gone =
      s.seats.length === 2 ? `${nameOf(ctx, s.seats.find((id) => id !== winner) ?? "")} left` : "the others left";
    headline = `${nameOf(ctx, winner)} wins ${GAME} — ${gone}`;
  } else {
    headline = `${GAME} ended — everyone left`;
  }
  settle(s, "forfeit", winners);
  ctx.end({ winners: winners.map((seat) => s.seats[seat]), headline, scores: scoreRecord(s) });
}

// ---------- auto-play ----------

/**
 * How many boxes the next player could take after `line` is drawn, if they
 * greedily close every box that has three sides.
 */
function giveaway(s: DotsState, line: LineRef): number {
  const { rows, cols } = s;
  const h = s.h.slice();
  const v = s.v.slice();
  const owned = s.boxes.map((o) => o !== -1);
  const mark = (l: LineRef) => {
    (l.o === "h" ? h : v)[lineIndex(l.o, l.r, l.c, rows, cols)] = 0;
  };
  mark(line);
  let taken = 0;
  for (let changed = true; changed; ) {
    changed = false;
    for (let b = 0; b < owned.length; b++) {
      if (owned[b]) continue;
      const n = sideCount(h, v, b, cols);
      if (n === 4) {
        owned[b] = true;
        taken += 1;
        changed = true;
      } else if (n === 3) {
        const missing = sidesOfBox(b, cols).find((l) => ownerOf(h, v, l, rows, cols) === -1);
        if (missing) mark(missing);
        changed = true;
      }
    }
  }
  return taken;
}

/**
 * The line drawn for a player who ran out of time: close a box if one is
 * ready; otherwise a line that gives nothing away (no third side on any box);
 * otherwise the line that hands the next player the fewest boxes.
 */
export function chooseAutoLine(s: DotsState, random: () => number): LineRef | null {
  const { rows, cols } = s;
  const open = allLines(rows, cols).filter((l) => ownerOf(s.h, s.v, l, rows, cols) === -1);
  if (open.length === 0) return null;
  const sides = (l: LineRef) => boxesBeside(l, rows, cols).map((b) => sideCount(s.h, s.v, b, cols));

  const closing = open.filter((l) => sides(l).some((n) => n === 3));
  if (closing.length) return choose(closing, random);

  const safe = open.filter((l) => sides(l).every((n) => n < 2));
  if (safe.length) return choose(safe, random);

  let best: LineRef[] = [];
  let bestCost = Infinity;
  for (const l of open) {
    const cost = giveaway(s, l);
    if (cost < bestCost) {
      bestCost = cost;
      best = [l];
    } else if (cost === bestCost) {
      best.push(l);
    }
  }
  return choose(best, random);
}

function autoMove(s: DotsState, ctx: GameCtx) {
  const seat = s.turn;
  if (isConnected(ctx, s.seats[seat])) s.strikes[seat] = Math.min(MAX_STRIKES, s.strikes[seat] + 1);
  const line = chooseAutoLine(s, ctx.random);
  if (line) drawLine(s, ctx, line, seat, true);
  else finishBoard(s, ctx); // unreachable: an unclaimed box always has an open side
}

/** Board for the host's size choice; "normal" is the classic size for the player count. */
function boardFor(players: number, size: string): { rows: number; cols: number } {
  const { rows, cols } = boardSize(players);
  if (size === "small") return { rows: rows - 1, cols: cols - 1 };
  if (size === "large") return { rows: rows + 2, cols: cols + 2 };
  return { rows, cols };
}

// ---------- practice bot ----------

/** When each bot (by state) may move next, so it "thinks" like a person. */
const botReadyAt = new WeakMap<DotsState, Map<string, { n: number; at: number }>>();

/**
 * Medium bot: takes boxes that are ready and avoids third sides like the auto-move, but
 * sometimes misses a free box or plays a careless line.
 */
function botMove(s: DotsState, botId: string, ctx: GameCtx): LineRef | null {
  if (s.over || s.seats[s.turn] !== botId) return null;
  let timers = botReadyAt.get(s);
  if (!timers) botReadyAt.set(s, (timers = new Map()));
  const now = ctx.now();
  const t = timers.get(botId);
  if (!t || t.n !== s.moves) {
    const chained = s.lastLine?.seat === s.turn && s.lastLine.claimed.length > 0;
    const think = chained ? 450 + ctx.random() * 600 : 800 + ctx.random() * 1700;
    timers.set(botId, { n: s.moves, at: now + think });
    return null;
  }
  if (now < t.at) return null;
  const open = allLines(s.rows, s.cols).filter((l) => ownerOf(s.h, s.v, l, s.rows, s.cols) === -1);
  if (open.length === 0) return null;
  if (ctx.random() < 0.12) return choose(open, ctx.random);
  return chooseAutoLine(s, ctx.random);
}

// ---------- the game ----------

export const dots: GameDef<DotsState, unknown> = {
  id: "dots",

  setup(ctx) {
    // Fresh turn order every game, not lobby join order.
    const seats = shuffle(ctx.players.map((p) => p.id), ctx.random);
    const set = readSettings(config.settings, ctx.settings);
    const moveMs = Number(set.turnSec) * 1000 || TURN_MS;
    const { rows, cols } = boardFor(seats.length, String(set.board));
    const s: DotsState = {
      rows,
      cols,
      seats,
      h: new Array<number>((rows + 1) * cols).fill(-1),
      v: new Array<number>(rows * (cols + 1)).fill(-1),
      boxes: new Array<number>(rows * cols).fill(-1),
      scores: seats.map(() => 0),
      turn: 0,
      moveStartedAt: ctx.now(),
      endsAt: null,
      turnMs: moveMs,
      moveMs,
      strikes: seats.map(() => 0),
      lastLine: null,
      moves: 0,
      aloneSince: null,
      over: false,
      reason: null,
      winners: [],
    };
    if (seats.length > 0) {
      const first = Math.min(seats.length - 1, Math.floor(ctx.random() * seats.length));
      beginMove(s, ctx, first, false);
    }
    updatePresence(s, ctx);
    return s;
  },

  action(s, playerId, raw, ctx) {
    if (s.over) return false;
    const seat = s.seats.indexOf(playerId);
    if (seat < 0) return false;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
    const a = raw as Record<string, unknown>;

    if (a.type === "back") {
      if (s.strikes[seat] < IDLE_STRIKES) return false;
      s.strikes[seat] = 0;
      if (s.turn === seat && s.endsAt !== null) {
        const now = ctx.now();
        s.moveStartedAt = now;
        s.turnMs = s.moveMs;
        s.endsAt = now + s.moveMs;
      }
      return true;
    }

    if (a.type !== "line" || seat !== s.turn) return false;
    const { o, r, c } = a;
    if (o !== "h" && o !== "v") return false;
    if (typeof r !== "number" || typeof c !== "number") return false;
    const idx = lineIndex(o, r, c, s.rows, s.cols);
    if (idx < 0 || (o === "h" ? s.h : s.v)[idx] !== -1) return false;

    s.strikes[seat] = 0;
    drawLine(s, ctx, { o, r, c }, seat, false);
    return true;
  },

  tick(s, ctx) {
    if (s.over) return false;
    let changed = updatePresence(s, ctx);
    const now = ctx.now();
    if (s.aloneSince !== null && now >= s.aloneSince + ABANDON_MS) {
      forfeit(s, ctx);
      return true;
    }
    if (s.endsAt !== null && now >= s.endsAt) {
      autoMove(s, ctx);
      changed = true;
    }
    return changed;
  },
  tickMs: 250,

  playerLeft(s, playerId, ctx) {
    if (s.over) return;
    const seat = s.seats.indexOf(playerId);
    if (seat < 0) return;
    updatePresence(s, ctx);
    // Their move now auto-plays soon instead of making everyone wait.
    if (s.turn === seat && s.endsAt !== null) {
      const soon = ctx.now() + AWAY_MS;
      if (soon < s.endsAt) {
        s.endsAt = soon;
        s.turnMs = AWAY_MS;
      }
    }
  },

  playerReturned(s, playerId, ctx) {
    if (s.over) return;
    const seat = s.seats.indexOf(playerId);
    if (seat < 0) return;
    s.strikes[seat] = 0;
    updatePresence(s, ctx);
    // Give back the rest of the normal clock (never more than a fresh move would get).
    if (s.turn === seat && s.endsAt !== null) {
      const full = s.moveStartedAt + s.moveMs;
      if (full > s.endsAt) {
        s.endsAt = full;
        s.turnMs = s.moveMs;
      }
    }
  },

  bot(s, botId, ctx) {
    const l = botMove(s, botId, ctx);
    return l ? { type: "line", o: l.o, r: l.r, c: l.c } : null;
  },

  view(s, viewerId): DotsView {
    return {
      rows: s.rows,
      cols: s.cols,
      seats: s.seats,
      h: s.h,
      v: s.v,
      boxes: s.boxes,
      scores: s.scores,
      turn: s.turn,
      endsAt: s.endsAt,
      turnMs: s.turnMs,
      idle: s.strikes.map((n) => n >= IDLE_STRIKES),
      lastLine: s.lastLine,
      moves: s.moves,
      closeAt: s.aloneSince === null ? null : s.aloneSince + ABANDON_MS,
      over: s.over,
      reason: s.reason,
      winners: s.winners,
      you: s.seats.indexOf(viewerId),
    };
  },
};

export default dots;
