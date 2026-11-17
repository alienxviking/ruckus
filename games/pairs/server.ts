import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  ABANDON_MS,
  AWAY_MS,
  BOARD_CARDS,
  FACES,
  SHOW_MS,
  SOLO_MS,
  TURN_MS,
  soloScore,
  type BoardChoice,
  type LastMove,
  type PairsView,
} from "./shared";

export type { PairsAction, PairsView } from "./shared";

// Memory Pairs (Ruckus take on the classic Concentration). Flip two cards; a match is
// yours and you go again. Solo: clear the board in as few wrong guesses and seconds as
// you can. Together: take turns on a turn clock, most pairs wins.

export interface PairsState {
  /** Face index per card (secret while face down). */
  faces: number[];
  owner: number[];
  up: number[];
  seats: string[];
  scores: number[];
  turn: number;
  phase: "pick" | "show" | "over";
  showUntil: number;
  endsAt: number | null;
  turnMs: number;
  moveMs: number;
  flips: number[];
  misses: number[];
  startedAt: number;
  solo: boolean;
  last: LastMove | null;
  moves: number;
  final: number | null;
  /** Solo: seconds the run took, once over. */
  secs: number | null;
  /** Every card turned over, in order (public knowledge: everyone saw it). Bots learn from this. */
  seen: [number, number][];
  emptySince: number | null;
}

const GAME = "Memory Pairs";

const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected === true;
const nameOf = (ctx: GameCtx, id: string) => ctx.player(id)?.name ?? "Someone";

function startTurn(s: PairsState, ctx: GameCtx, seat: number) {
  s.turn = seat;
  s.phase = "pick";
  s.up = [];
  if (s.solo) {
    s.endsAt = null;
    return;
  }
  s.turnMs = connected(ctx, s.seats[seat]) ? s.moveMs : AWAY_MS;
  s.endsAt = ctx.now() + s.turnMs;
}

function nextTurn(s: PairsState, ctx: GameCtx) {
  startTurn(s, ctx, (s.turn + 1) % s.seats.length);
}

function finish(s: PairsState, ctx: GameCtx, why: "cleared" | "time" | "empty") {
  if (s.phase === "over") return;
  s.phase = "over";
  s.endsAt = null;
  s.up = [];
  const scores: Record<string, number> = {};
  if (s.solo) {
    const id = s.seats[0];
    const secs = Math.round((ctx.now() - s.startedAt) / 1000);
    s.secs = secs;
    s.final = soloScore(s.scores[0], s.misses[0], secs);
    scores[id] = s.final;
    const total = s.faces.length / 2;
    const headline =
      why === "cleared"
        ? `${nameOf(ctx, id)} cleared ${GAME} in ${secs}s with ${s.misses[0]} miss${s.misses[0] === 1 ? "" : "es"}: ${s.final} points`
        : `${nameOf(ctx, id)} found ${s.scores[0]}/${total} pairs: ${s.final} points`;
    ctx.end({ winners: s.final > 0 ? [id] : [], headline, scores });
    return;
  }
  s.seats.forEach((id, i) => (scores[id] = s.scores[i]));
  const winners = topScorers(scores);
  const line = [...s.scores].sort((a, b) => b - a).join("–");
  const headline =
    winners.length === 1
      ? `${nameOf(ctx, winners[0])} wins ${GAME} ${line}`
      : winners.length > 1
        ? `${winners.map((id) => nameOf(ctx, id)).join(" & ")} tie at ${GAME} ${line}`
        : `${GAME} ended with no pairs found`;
  ctx.end({ winners, headline, scores });
}

function flip(s: PairsState, ctx: GameCtx, i: number) {
  const seat = s.turn;
  s.up.push(i);
  s.flips[seat] += 1;
  s.seen.push([i, s.faces[i]]);
  if (s.up.length < 2) {
    // A fresh clock for the second card, so a slow first flip doesn't rush the second.
    if (!s.solo && s.endsAt !== null) s.endsAt = Math.max(s.endsAt, ctx.now() + Math.min(s.turnMs, 6_000));
    return;
  }
  const [a, b] = s.up;
  const match = s.faces[a] === s.faces[b];
  s.moves += 1;
  s.last = { seat, a, b, match, n: s.moves };
  if (match) {
    s.owner[a] = seat;
    s.owner[b] = seat;
    s.scores[seat] += 1;
    s.up = [];
    if (s.owner.every((o) => o >= 0)) finish(s, ctx, "cleared");
    else startTurn(s, ctx, seat);
  } else {
    s.misses[seat] += 1;
    s.phase = "show";
    s.showUntil = ctx.now() + SHOW_MS;
    s.endsAt = null;
  }
}

// ---------- practice bot ----------

interface BotMind {
  /** card -> [face, when seen (index in s.seen)] */
  mem: Map<number, [number, number]>;
  read: number;
  key: string;
  at: number;
}
const minds = new WeakMap<PairsState, Map<string, BotMind>>();

/** Medium bot: remembers what it has seen, but memories fade the longer ago they were. */
function botMove(s: PairsState, botId: string, ctx: GameCtx): number | null {
  if (s.phase !== "pick" || s.seats[s.turn] !== botId) return null;
  let all = minds.get(s);
  if (!all) minds.set(s, (all = new Map()));
  let mind = all.get(botId);
  if (!mind) all.set(botId, (mind = { mem: new Map(), read: 0, key: "", at: 0 }));
  for (; mind.read < s.seen.length; mind.read++) {
    const [card, face] = s.seen[mind.read];
    mind.mem.set(card, [face, mind.read]);
  }
  const now = ctx.now();
  const key = `${s.moves}:${s.up.length}`;
  if (mind.key !== key) {
    mind.key = key;
    mind.at = now + (s.up.length ? 600 + ctx.random() * 800 : 900 + ctx.random() * 1400);
    return null;
  }
  if (now < mind.at) return null;

  const open = s.owner.map((o, i) => i).filter((i) => s.owner[i] < 0 && !s.up.includes(i));
  if (!open.length) return null;
  const age = (seenAt: number) => s.seen.length - seenAt;
  const recall = (i: number): number | null => {
    const m = mind!.mem.get(i);
    if (!m) return null;
    return ctx.random() < Math.max(0.15, 0.85 * Math.pow(0.9, age(m[1]))) ? m[0] : null;
  };
  const known = new Map<number, number>();
  for (const i of open) {
    const f = recall(i);
    if (f !== null) known.set(i, f);
  }
  const unknown = open.filter((i) => !known.has(i));
  const any = (xs: number[]) => xs[Math.floor(ctx.random() * xs.length) % xs.length];

  if (s.up.length === 1) {
    const face = s.faces[s.up[0]]; // face up: everyone can see it
    const partner = [...known].find(([i, f]) => f === face && i !== s.up[0]);
    if (partner) return partner[0];
    return any(unknown.length ? unknown : open);
  }
  // First card: go for a remembered pair, else turn over something new.
  const byFace = new Map<number, number[]>();
  for (const [i, f] of known) byFace.set(f, [...(byFace.get(f) ?? []), i]);
  const pair = [...byFace.values()].find((xs) => xs.length >= 2);
  if (pair) return pair[0];
  return any(unknown.length ? unknown : open);
}

// ---------- the game ----------

export const pairs: GameDef<PairsState, unknown> = {
  id: "pairs",

  setup(ctx) {
    const set = readSettings(config.settings, ctx.settings);
    const board = (["small", "normal", "large"].includes(String(set.board)) ? set.board : "normal") as BoardChoice;
    const n = BOARD_CARDS[board];
    const moveMs = Number(set.turnSec) * 1000 || TURN_MS;
    const chosen = shuffle(
      FACES.map((_, i) => i),
      ctx.random,
    ).slice(0, n / 2);
    const faces = shuffle([...chosen, ...chosen], ctx.random);
    const seats = ctx.players.map((p) => p.id);
    const solo = seats.length === 1;
    const s: PairsState = {
      faces,
      owner: faces.map(() => -1),
      up: [],
      seats,
      scores: seats.map(() => 0),
      turn: 0,
      phase: "pick",
      showUntil: 0,
      endsAt: null,
      turnMs: moveMs,
      moveMs,
      flips: seats.map(() => 0),
      misses: seats.map(() => 0),
      startedAt: ctx.now(),
      solo,
      last: null,
      moves: 0,
      final: null,
      secs: null,
      seen: [],
      emptySince: null,
    };
    startTurn(s, ctx, solo ? 0 : Math.floor(ctx.random() * seats.length) % Math.max(1, seats.length));
    return s;
  },

  action(s, playerId, raw, ctx) {
    if (s.phase !== "pick") return false;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
    const a = raw as Record<string, unknown>;
    if (a.type !== "flip" || s.seats[s.turn] !== playerId) return false;
    const i = a.i;
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= s.faces.length) return false;
    if (s.owner[i] >= 0 || s.up.includes(i)) return false;
    flip(s, ctx, i);
    return true;
  },

  tick(s, ctx) {
    if (s.phase === "over") return false;
    const now = ctx.now();
    // Nobody left to play: end after a while.
    const anyone = s.seats.some((id) => connected(ctx, id));
    if (!anyone) {
      if (s.emptySince === null) s.emptySince = now;
      else if (now - s.emptySince >= ABANDON_MS) {
        finish(s, ctx, "empty");
        return true;
      }
    } else s.emptySince = null;
    if (s.solo && now - s.startedAt >= SOLO_MS) {
      finish(s, ctx, "time");
      return true;
    }
    if (s.phase === "show" && now >= s.showUntil) {
      if (s.solo) startTurn(s, ctx, 0);
      else nextTurn(s, ctx);
      return true;
    }
    if (s.phase === "pick" && s.endsAt !== null && now >= s.endsAt) {
      // Out of time: whatever is face up flips back, and the turn passes.
      nextTurn(s, ctx);
      return true;
    }
    return false;
  },
  tickMs: 250,

  playerLeft(s, playerId, ctx) {
    if (s.phase === "over" || s.solo) return;
    if (s.seats[s.turn] === playerId && s.endsAt !== null) {
      const soon = ctx.now() + AWAY_MS;
      if (soon < s.endsAt) {
        s.endsAt = soon;
        s.turnMs = AWAY_MS;
      }
    }
  },

  playerReturned(s, playerId, ctx) {
    if (s.phase !== "pick" || s.solo) return;
    if (s.seats[s.turn] === playerId && s.endsAt !== null) {
      s.turnMs = s.moveMs;
      s.endsAt = ctx.now() + s.moveMs;
    }
  },

  bot(s, botId, ctx) {
    const i = botMove(s, botId, ctx);
    return i === null ? null : { type: "flip", i };
  },

  view(s, viewerId): PairsView {
    const over = s.phase === "over";
    return {
      n: s.faces.length,
      faces: s.faces.map((f, i) => (over || s.owner[i] >= 0 || s.up.includes(i) ? f : -1)),
      owner: s.owner,
      up: s.up,
      seats: s.seats,
      scores: s.scores,
      turn: s.turn,
      phase: s.phase,
      endsAt: s.endsAt,
      turnMs: s.turnMs,
      flips: s.flips,
      misses: s.misses,
      startedAt: s.startedAt,
      soloEndsAt: s.solo ? s.startedAt + SOLO_MS : null,
      last: s.last,
      solo: s.solo,
      final: s.final,
      secs: s.secs,
      you: s.seats.indexOf(viewerId),
    };
  },
};

export default pairs;
