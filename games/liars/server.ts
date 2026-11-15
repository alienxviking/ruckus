import type { GameCtx, GameDef } from "../../shared/game";
import {
  AWAY_MS,
  LONELY_MS,
  MAX_FACE,
  MIN_FACE,
  ROLL_MS,
  TURN_MS,
  isLegalBid,
  matches,
  revealTiming,
  startingDice,
} from "./shared";

// Liar's Dice: everyone rolls hidden dice, then players take turns raising a
// bid on how many of one face are on the whole table (ones are wild), until
// someone calls "Liar!" (or "Spot on"). All dice are revealed, someone loses a
// die, and the next round starts with the loser. Last player with dice wins.
//
// Phases: roll (cup shake, no actions) -> bid (turns, 30s each) -> reveal
// (showdown animation) -> roll ... -> over. Deadlines are absolute timestamps
// in state and tick() advances them. Other players' dice only ever appear in a
// view inside `showdown`, which exists only during the reveal and the final.

export type Phase = "roll" | "bid" | "reveal" | "over";

export interface Bid {
  by: string;
  qty: number;
  face: number;
  /** Played by the server (turn timer ran out or the bidder was away). */
  auto: boolean;
}

/** What happened at a showdown, without anybody's dice (safe to keep showing later). */
export interface ShowdownSummary {
  round: number;
  kind: "liar" | "spot";
  caller: string;
  bidder: string;
  qty: number;
  face: number;
  /** Dice on the table showing the face or a wild one. */
  count: number;
  /** Was the caller right? */
  correct: boolean;
  /** Who lost a die (null: a correct "spot on"). */
  loser: string | null;
  /** Correct "spot on" caller who got a die back (null when already at the starting count). */
  gainer: string | null;
  /** Player knocked out by this showdown. */
  out: string | null;
  /** The call was made by the server for an idle/away player. */
  auto: boolean;
}

export interface Showdown extends ShowdownSummary {
  /** Everyone's dice at the moment of the call, for players who still had dice. */
  hands: Record<string, number[]>;
  /** Server time the showdown started (the client paces its animation from this). */
  at: number;
}

export interface PlayerStats {
  /** Liar / spot-on calls made. */
  calls: number;
  /** Calls that were right. */
  right: number;
  /** Bids of yours that survived a Liar call. */
  held: number;
  /** Bids of yours that were caught. */
  caught: number;
  /** Spot-on calls that were exactly right. */
  spots: number;
}

export type Ending = "last" | "left";

export interface LiarsState {
  order: string[];
  /** Dice held per player (public). */
  counts: Record<string, number>;
  /** This round's dice per player (SECRET: only the owner sees theirs). */
  dice: Record<string, number[]>;
  startDice: number;
  phase: Phase;
  round: number;
  /** Who opens the current round. */
  starter: string;
  /** Who must bid or call (null outside the bid phase). */
  turn: string | null;
  bids: Bid[];
  /** Deadline of the current phase / turn. */
  endsAt: number;
  /** Full length of the running timer. */
  timerMs: number;
  /** Since when the player to move has been disconnected (auto-play AWAY_MS later). */
  awayAt: number | null;
  showdown: Showdown | null;
  log: ShowdownSummary[];
  /** Knocked-out players, first out first. */
  out: string[];
  outRound: Record<string, number>;
  stats: Record<string, PlayerStats>;
  /** Since when fewer than 2 connected players still have dice. */
  lonelySince: number | null;
  winners: string[] | null;
  ending: Ending | null;
}

export type LiarsAction = { type: "bid"; qty: number; face: number } | { type: "liar" } | { type: "spot" };

export interface LiarsView {
  phase: Phase;
  round: number;
  order: string[];
  counts: Record<string, number>;
  startDice: number;
  /** Dice in play this round. */
  total: number;
  starter: string;
  turn: string | null;
  bids: Bid[];
  endsAt: number;
  timerMs: number;
  /** The player to move is away: the server plays for them at this time. */
  autoAt: number | null;
  /** The viewer's own dice (null for spectators). */
  mine: number[] | null;
  /** Only during the reveal and the final screen. */
  showdown: Showdown | null;
  /** The previous showdown, without dice (during roll/bid). */
  last: ShowdownSummary | null;
  out: string[];
  outRound: Record<string, number>;
  /** "Spot on" is allowed (3+ players still have dice). */
  spotOk: boolean;
  /** Fewer than 2 players are here: the game ends at this time. */
  lonelyAt: number | null;
  winners: string[] | null;
  ending: Ending | null;
  /** Fun stats, only on the final screen. */
  stats: Record<string, PlayerStats> | null;
  /** Showdowns played so far. */
  showdowns: number;
  you: string | null;
}

// ---------- helpers ----------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;

const live = (s: LiarsState) => s.order.filter((id) => (s.counts[id] ?? 0) > 0);

const totalDice = (s: LiarsState) => s.order.reduce((n, id) => n + (s.counts[id] ?? 0), 0);

const lastBid = (s: LiarsState): Bid | null => (s.bids.length ? s.bids[s.bids.length - 1] : null);

const nameOf = (ctx: GameCtx, id: string) => ctx.player(id)?.name ?? "Someone";

/** The next player after `id` in join order who still has dice (`id` itself if nobody else). */
function nextLive(s: LiarsState, id: string): string {
  const i = s.order.indexOf(id);
  for (let k = 1; k <= s.order.length; k++) {
    const cand = s.order[(i + k) % s.order.length];
    if ((s.counts[cand] ?? 0) > 0) return cand;
  }
  return id;
}

function roll(ctx: GameCtx): number {
  const v = 1 + Math.floor(ctx.random() * 6);
  return v >= 1 && v <= 6 ? v : 6;
}

function startRound(s: LiarsState, ctx: GameCtx) {
  for (const id of s.order) {
    s.dice[id] = Array.from({ length: s.counts[id] ?? 0 }, () => roll(ctx));
  }
  s.phase = "roll";
  s.bids = [];
  s.turn = s.starter;
  s.showdown = null;
  s.awayAt = null;
  s.endsAt = ctx.now() + ROLL_MS;
  s.timerMs = ROLL_MS;
}

function startTurn(s: LiarsState, id: string, ctx: GameCtx) {
  s.phase = "bid";
  s.turn = id;
  s.endsAt = ctx.now() + TURN_MS;
  s.timerMs = TURN_MS;
  s.awayAt = connected(ctx, id) ? null : ctx.now();
}

function countMatching(s: LiarsState, face: number): number {
  let n = 0;
  for (const id of live(s)) for (const v of s.dice[id] ?? []) if (matches(v, face)) n++;
  return n;
}

function placeBid(s: LiarsState, by: string, qty: number, face: number, auto: boolean, ctx: GameCtx) {
  s.bids.push({ by, qty, face, auto });
  startTurn(s, nextLive(s, by), ctx);
}

function call(s: LiarsState, caller: string, kind: "liar" | "spot", auto: boolean, ctx: GameCtx) {
  const bid = lastBid(s);
  if (!bid) return;
  const count = countMatching(s, bid.face);
  const hands: Record<string, number[]> = {};
  for (const id of live(s)) hands[id] = (s.dice[id] ?? []).slice();

  let correct: boolean;
  let loser: string | null;
  let gainer: string | null = null;
  if (kind === "liar") {
    correct = count < bid.qty;
    loser = correct ? bid.by : caller;
    const st = s.stats[bid.by];
    if (st) {
      if (correct) st.caught++;
      else st.held++;
    }
  } else {
    correct = count === bid.qty;
    loser = correct ? null : caller;
    if (correct && (s.counts[caller] ?? 0) < s.startDice) gainer = caller;
  }
  const cs = s.stats[caller];
  if (cs) {
    cs.calls++;
    if (correct) cs.right++;
    if (correct && kind === "spot") cs.spots++;
  }

  let out: string | null = null;
  if (loser) {
    s.counts[loser] = Math.max(0, (s.counts[loser] ?? 0) - 1);
    if (s.counts[loser] === 0) {
      out = loser;
      s.out.push(loser);
      s.outRound[loser] = s.round;
    }
  }
  if (gainer) s.counts[gainer] = (s.counts[gainer] ?? 0) + 1;

  const summary: ShowdownSummary = {
    round: s.round,
    kind,
    caller,
    bidder: bid.by,
    qty: bid.qty,
    face: bid.face,
    count,
    correct,
    loser,
    gainer,
    out,
    auto,
  };
  s.log.push(summary);
  s.showdown = { ...summary, hands, at: ctx.now() };
  s.phase = "reveal";
  s.turn = null;
  s.awayAt = null;
  const { total } = revealTiming(count);
  s.endsAt = ctx.now() + total;
  s.timerMs = total;
  // The loser opens the next round (or the next player still in if they're out).
  const opener = loser ?? caller;
  s.starter = (s.counts[opener] ?? 0) > 0 ? opener : nextLive(s, opener);
}

/** Most common non-one face in a hand (ties go to the higher face). */
export function favouriteFace(hand: number[]): number {
  const n = [0, 0, 0, 0, 0, 0, 0];
  for (const v of hand) if (v >= 1 && v <= 6) n[v]++;
  let best = MAX_FACE;
  for (let f = MAX_FACE - 1; f >= MIN_FACE; f--) if (n[f] > n[best]) best = f;
  return best;
}

/**
 * What the server plays for an idle or away player: call Liar when the bid
 * needs more than (own matching + unknown/3) + 1, else the minimal raise on
 * the most common non-one face. An opening bid claims what you hold of it.
 */
export function autoMove(s: LiarsState, id: string): LiarsAction {
  const hand = s.dice[id] ?? [];
  const total = totalDice(s);
  const prev = lastBid(s);
  const face = favouriteFace(hand);
  const held = hand.filter((v) => matches(v, face)).length;
  if (!prev) return { type: "bid", qty: Math.max(1, Math.min(total, held)), face };
  const mine = hand.filter((v) => matches(v, prev.face)).length;
  const unknown = total - hand.length;
  if (prev.qty > mine + unknown / 3 + 1) return { type: "liar" };
  const qty = face > prev.face ? prev.qty : prev.qty + 1;
  if (qty > total) return { type: "liar" };
  return { type: "bid", qty, face };
}

function playAuto(s: LiarsState, ctx: GameCtx) {
  const id = s.turn;
  if (!id) return;
  const a = autoMove(s, id);
  if (a.type === "bid") placeBid(s, id, a.qty, a.face, true, ctx);
  else call(s, id, "liar", true, ctx);
}

function finish(s: LiarsState, ctx: GameCtx, ending: Ending) {
  if (s.phase === "over") return;
  const still = live(s);
  let winners: string[];
  if (ending === "last") {
    winners = still;
  } else {
    const here = still.filter((id) => connected(ctx, id));
    if (here.length) winners = here;
    else {
      const most = Math.max(0, ...still.map((id) => s.counts[id] ?? 0));
      winners = still.filter((id) => s.counts[id] === most);
    }
  }
  s.phase = "over";
  s.turn = null;
  s.awayAt = null;
  s.lonelySince = null;
  s.endsAt = 0;
  s.timerMs = 0;
  s.winners = winners;
  s.ending = ending;
  // Anyone still holding dice ranks above everyone knocked out.
  const scores: Record<string, number> = {};
  for (const id of s.order) scores[id] = s.counts[id] ?? 0;
  let headline: string;
  if (winners.length === 1) {
    const w = winners[0];
    const n = s.counts[w] ?? 0;
    headline =
      ending === "last"
        ? `${nameOf(ctx, w)} wins Liar's Dice with ${n} ${n === 1 ? "die" : "dice"} left`
        : `${nameOf(ctx, w)} wins Liar's Dice — everyone else left`;
  } else if (winners.length > 1) {
    headline = `Liar's Dice ends in a tie: ${winners.map((id) => nameOf(ctx, id)).join(" & ")}`;
  } else {
    headline = "Liar's Dice ended — everyone left";
  }
  ctx.end({ winners, headline, scores });
}

/** Track "fewer than 2 players here". Returns true when that changed what players see. */
function updateLonely(s: LiarsState, ctx: GameCtx): boolean {
  if (s.phase === "over") return false;
  const still = live(s);
  // One player left with dice: the game is already decided (the final reveal is playing).
  const here = still.length < 2 ? 2 : still.filter((id) => connected(ctx, id)).length;
  if (here < 2 && s.lonelySince === null) {
    s.lonelySince = ctx.now();
    return true;
  }
  if (here >= 2 && s.lonelySince !== null) {
    s.lonelySince = null;
    return true;
  }
  return false;
}

/** Track whether the player to move is away. Returns true when it changed. */
function updateAway(s: LiarsState, ctx: GameCtx): boolean {
  if (s.phase !== "bid" || !s.turn) return false;
  const away = !connected(ctx, s.turn);
  if (away && s.awayAt === null) {
    s.awayAt = ctx.now();
    return true;
  }
  if (!away && s.awayAt !== null) {
    s.awayAt = null;
    return true;
  }
  return false;
}

// ---------- the game ----------

export const liars: GameDef<LiarsState, LiarsAction> = {
  id: "liars",

  setup(ctx) {
    const order = ctx.players.map((p) => p.id);
    const startDice = startingDice(order.length);
    const counts: Record<string, number> = {};
    const stats: Record<string, PlayerStats> = {};
    for (const id of order) {
      counts[id] = startDice;
      stats[id] = { calls: 0, right: 0, held: 0, caught: 0, spots: 0 };
    }
    const starter = order[Math.min(order.length - 1, Math.floor(ctx.random() * order.length))] ?? "";
    const s: LiarsState = {
      order,
      counts,
      dice: {},
      startDice,
      phase: "roll",
      round: 1,
      starter,
      turn: null,
      bids: [],
      endsAt: 0,
      timerMs: 0,
      awayAt: null,
      showdown: null,
      log: [],
      out: [],
      outRound: {},
      stats,
      lonelySince: null,
      winners: null,
      ending: null,
    };
    startRound(s, ctx);
    if (order.length < 2) finish(s, ctx, "left");
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.phase !== "bid" || s.turn !== playerId) return false;
    if (!isRecord(action) || typeof action.type !== "string") return false;
    const prev = lastBid(s);
    switch (action.type) {
      case "bid": {
        const { qty, face } = action as Record<string, unknown>;
        if (typeof qty !== "number" || typeof face !== "number") return false;
        if (!isLegalBid({ qty, face }, prev, totalDice(s))) return false;
        placeBid(s, playerId, qty, face, false, ctx);
        return true;
      }
      case "liar":
        if (!prev || prev.by === playerId) return false;
        call(s, playerId, "liar", false, ctx);
        return true;
      case "spot":
        if (!prev || prev.by === playerId || live(s).length < 3) return false;
        call(s, playerId, "spot", false, ctx);
        return true;
      default:
        return false;
    }
  },

  tick(s, ctx) {
    if (s.phase === "over") return false;
    const now = ctx.now();
    let changed = updateLonely(s, ctx);
    if (s.lonelySince !== null && now >= s.lonelySince + LONELY_MS) {
      finish(s, ctx, "left");
      return true;
    }
    changed = updateAway(s, ctx) || changed;

    if (s.phase === "roll" && now >= s.endsAt) {
      startTurn(s, s.turn ?? s.starter, ctx);
      return true;
    }
    if (s.phase === "bid") {
      const awayDue = s.awayAt !== null && now >= s.awayAt + AWAY_MS;
      if (awayDue || now >= s.endsAt) {
        playAuto(s, ctx);
        return true;
      }
    }
    if (s.phase === "reveal" && now >= s.endsAt) {
      if (live(s).length <= 1) {
        finish(s, ctx, "last");
      } else {
        s.round += 1;
        startRound(s, ctx);
      }
      return true;
    }
    return changed;
  },
  tickMs: 200,

  playerLeft(s, _id, ctx) {
    updateLonely(s, ctx);
    updateAway(s, ctx);
  },

  playerReturned(s, _id, ctx) {
    updateLonely(s, ctx);
    updateAway(s, ctx);
  },

  view(s, viewerId): LiarsView {
    const isPlayer = s.order.includes(viewerId);
    const revealed = s.phase === "reveal" || s.phase === "over";
    const over = s.phase === "over";
    return {
      phase: s.phase,
      round: s.round,
      order: s.order,
      counts: s.counts,
      startDice: s.startDice,
      total: revealed && s.showdown ? Object.values(s.showdown.hands).reduce((n, h) => n + h.length, 0) : totalDice(s),
      starter: s.starter,
      turn: s.turn,
      bids: s.bids,
      endsAt: s.endsAt,
      timerMs: s.timerMs,
      autoAt: s.phase === "bid" && s.awayAt !== null ? Math.min(s.endsAt, s.awayAt + AWAY_MS) : null,
      mine: isPlayer ? (s.dice[viewerId] ?? []).slice() : null,
      showdown: revealed ? s.showdown : null,
      last: !revealed && s.log.length ? s.log[s.log.length - 1] : null,
      out: s.out,
      outRound: s.outRound,
      spotOk: live(s).length >= 3,
      lonelyAt: s.lonelySince === null ? null : s.lonelySince + LONELY_MS,
      winners: s.winners,
      ending: s.ending,
      stats: over ? s.stats : null,
      showdowns: s.log.length,
      you: isPlayer ? viewerId : null,
    };
  },
};

export default liars;
