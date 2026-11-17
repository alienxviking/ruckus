import { shuffle, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  ABANDON_MS,
  CARD_MEAN,
  CHART_MAX,
  FLIP_MS,
  HOUSE,
  HOUSE_LIMIT,
  HOUSE_SIZE,
  POS_LIMIT,
  ROUNDS,
  SETTLE_MS,
  SIZE_MAX,
  STREET,
  TAPE_MAX,
  TRADE_MS,
  cardValue,
  houseQuotes,
  maxPriceFor,
  publicFair,
  signed,
  type MkEvent,
  type Trade,
} from "./shared";

// Market Maker: an open-outcry trading game. Everyone holds one secret card, three
// street cards flip during the round, and a contract settles at the sum of every
// dealt card. Traders post bids/asks and hit each other's quotes; a House bot keeps
// a two-sided market around the public fair value so small games always have one.

export type Phase = "trade" | "settle" | "final";
type QSide = "bid" | "ask";

/** A resting quote. `o` = owner slot (-1 = House), `seq` = time priority. */
interface Quote {
  o: number;
  p: number;
  q: number;
  seq: number;
}

/** Fills this round: bought qty/value, sold qty/value, number of fills. */
interface Ledger {
  bq: number;
  bv: number;
  sq: number;
  sv: number;
  n: number;
}

export interface RoundRecord {
  /** Settlement value: the sum of every dealt card. */
  settle: number;
  /** Each trader's card (by slot) and the street. */
  cards: number[];
  street: number[];
  /** Net position at the bell, round P&L and number of fills, by slot. */
  pos: number[];
  pnl: number[];
  fills: number[];
  /** The House's P&L this round (it isn't scored). */
  house: number;
  trades: number;
}

export interface MkState {
  ids: string[];
  phase: Phase;
  round: number;
  /** Host settings: rounds to play, trading time, and when the street cards flip (ms after the open). */
  rounds: number;
  tradeMs: number;
  flipMs: number[];
  roundStart: number;
  endsAt: number;
  flipAt: number[];
  maxPrice: number;
  /** Secret: each trader's card this round, by slot. */
  cards: number[];
  /** Secret until flipped. */
  street: number[];
  flipped: number;
  /** Best first: bids by price desc, asks by price asc, then time. */
  bids: Quote[];
  asks: Quote[];
  seq: number;
  /** Secret until the bell: each trader's fills. */
  led: Ledger[];
  house: Ledger;
  tape: Trade[];
  /** Flat [t, price, t, price, ...] for this round's chart. */
  chart: number[];
  trades: number;
  totals: number[];
  history: RoundRecord[];
  /** Since when fewer than two traders are connected. */
  awaySince: number | null;
  /** The market is closing early: too few traders stayed. */
  abandoned: boolean;
  over: boolean;
}

export type MkAction =
  | { type: "quote"; side: QSide; price: number; size: number }
  | { type: "cancel"; side: QSide | "both" }
  | { type: "trade"; side: "buy" | "sell"; qty: number; price?: number };

/** A row of the book: [owner slot (-1 = House), price, size]. */
export type BookRow = [owner: number, price: number, size: number];

export interface MkView {
  phase: Phase;
  round: number;
  rounds: number;
  /** Trading time per round and the street flip times (ms after the open). */
  tradeMs: number;
  flipMs: number[];
  /** Participants by slot. */
  ids: string[];
  roundStart: number;
  endsAt: number;
  flipAt: number[];
  maxPrice: number;
  /** Street card codes; null = still face down. */
  street: (number | null)[];
  /** My slot (-1 = spectator) and my card. */
  me: number;
  card: number | null;
  /** My fills this round: [bought qty, bought value, sold qty, sold value]. Null for spectators. */
  mine: [number, number, number, number] | null;
  bids: BookRow[];
  asks: BookRow[];
  /** Fills per trader this round (positions stay secret until the bell). */
  counts: number[];
  tape: Trade[];
  /** Trades so far this round (keys the tape). */
  nt: number;
  chart: number[];
  /** Public fair value: known street + 7 per unseen card. */
  fair: number;
  totals: number[];
  history: RoundRecord[];
  /** When the market closes early because too few traders are connected (null = not closing). */
  closeAt: number | null;
  abandoned: boolean;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const newLedger = (): Ledger => ({ bq: 0, bv: 0, sq: 0, sv: 0, n: 0 });
const posOf = (l: Ledger) => l.bq - l.sq;
const pnlAt = (l: Ledger, settle: number) => l.sv - l.bv + posOf(l) * settle;
const ledger = (s: MkState, owner: number) => (owner === HOUSE ? s.house : s.led[owner]);
const send = (ctx: GameCtx, e: MkEvent, to?: string) => ctx.emit(e, to ? { to } : undefined);
const tell = (ctx: GameCtx, to: string, m: string) => send(ctx, { k: "msg", m }, to);

/** How many more lots `owner` may buy ("bid") or sell ("ask") before hitting the limit. */
function headroom(s: MkState, owner: number, side: QSide): number {
  const limit = owner === HOUSE ? HOUSE_LIMIT : POS_LIMIT;
  const pos = posOf(ledger(s, owner));
  return side === "bid" ? limit - pos : limit + pos;
}

function sortBook(s: MkState) {
  s.bids.sort((a, b) => b.p - a.p || a.seq - b.seq);
  s.asks.sort((a, b) => a.p - b.p || a.seq - b.seq);
}

function removeOwner(book: Quote[], owner: number): boolean {
  const i = book.findIndex((q) => q.o === owner);
  if (i < 0) return false;
  book.splice(i, 1);
  return true;
}

/** Shrink every resting quote to what its owner may still trade; drop empty ones. */
function clipAll(s: MkState) {
  for (const side of ["bid", "ask"] as const) {
    const book = side === "bid" ? s.bids : s.asks;
    for (let i = book.length - 1; i >= 0; i--) {
      const room = headroom(s, book[i].o, side);
      if (book[i].q > room) book[i].q = room;
      if (book[i].q <= 0) book.splice(i, 1);
    }
  }
}

function pushChart(s: MkState, t: number, price: number) {
  s.chart.push(t, price);
  if (s.chart.length <= CHART_MAX * 2) return;
  // Halve the resolution of the older half, so the whole round stays on the chart.
  const half = Math.floor(s.chart.length / 4) * 2;
  const older: number[] = [];
  for (let i = 0; i < half; i += 4) older.push(s.chart[i], s.chart[i + 1]);
  s.chart = older.concat(s.chart.slice(half));
}

function record(s: MkState, ctx: GameCtx, buyer: number, seller: number, price: number, qty: number, taker: number) {
  const B = ledger(s, buyer);
  const S = ledger(s, seller);
  B.bq += qty;
  B.bv += price * qty;
  B.n += 1;
  S.sq += qty;
  S.sv += price * qty;
  S.n += 1;
  const t = Math.max(0, Math.round((ctx.now() - s.roundStart) / 100));
  const tr: Trade = [buyer, seller, price, qty, t];
  s.tape.push(tr);
  if (s.tape.length > TAPE_MAX) s.tape.splice(0, s.tape.length - TAPE_MAX);
  pushChart(s, t, price);
  s.trades += 1;
  send(ctx, { k: "t", tr, n: s.trades, a: taker });
}

/**
 * Match an incoming order against the opposite side of the book: best price first,
 * then oldest, never against the owner's own quote, always at the RESTING price.
 * `side` is what the incoming owner does ("bid" = buys). Returns lots filled.
 */
function sweep(s: MkState, ctx: GameCtx, owner: number, side: QSide, qty: number, limit: number | null): number {
  const opp = side === "bid" ? s.asks : s.bids;
  let left = Math.min(qty, headroom(s, owner, side));
  let filled = 0;
  let i = 0;
  while (i < opp.length && left > 0) {
    const r = opp[i];
    if (r.o === owner) {
      i++;
      continue;
    }
    if (limit !== null && (side === "bid" ? r.p > limit : r.p < limit)) break;
    const n = Math.min(left, r.q, headroom(s, r.o, side === "bid" ? "ask" : "bid"));
    if (n <= 0) {
      opp.splice(i, 1);
      continue;
    }
    if (side === "bid") record(s, ctx, owner, r.o, r.p, n, owner);
    else record(s, ctx, r.o, owner, r.p, n, owner);
    r.q -= n;
    left -= n;
    filled += n;
    if (r.q <= 0) opp.splice(i, 1);
    else i++;
  }
  return filled;
}

const limitMsg = (side: QSide) =>
  side === "bid"
    ? `You're long ${POS_LIMIT}, the most allowed. Sell some before buying more.`
    : `You're short ${POS_LIMIT}, the most allowed. Buy some back before selling more.`;

type Placed = { filled: number; rested: number; cut: boolean } | { error: string } | null;

/**
 * Post (or replace) `owner`'s quote on one side. If it crosses another trader's
 * quote it trades right away at their price; whatever is left rests in the book.
 * Returns null when nothing changed.
 */
function placeQuote(s: MkState, ctx: GameCtx, owner: number, side: QSide, price: number, size: number): Placed {
  const book = side === "bid" ? s.bids : s.asks;
  const mineOther = (side === "bid" ? s.asks : s.bids).find((q) => q.o === owner);
  if (mineOther && (side === "bid" ? price >= mineOther.p : price <= mineOther.p)) {
    return {
      error:
        side === "bid"
          ? `Your bid must be below your own ask (${mineOther.p}). Move or cancel the ask first.`
          : `Your ask must be above your own bid (${mineOther.p}). Move or cancel the bid first.`,
    };
  }
  const room = headroom(s, owner, side);
  if (room <= 0) return { error: limitMsg(side) };
  const want = Math.min(size, room);
  const old = book.find((q) => q.o === owner);
  if (old && old.p === price) {
    // Same price: shrinking keeps your place in the queue, the same size is a no-op.
    if (old.q === want) return null;
    if (want < old.q) {
      old.q = want;
      return { filled: 0, rested: want, cut: want < size };
    }
  }
  if (old) removeOwner(book, owner);
  const filled = sweep(s, ctx, owner, side, want, price);
  const rested = want - filled;
  if (rested > 0) {
    book.push({ o: owner, p: price, q: rested, seq: ++s.seq });
    sortBook(s);
  }
  clipAll(s);
  return { filled, rested, cut: want < size };
}

/**
 * The House requotes around the public fair value, skewed by its inventory. It is
 * passive: it never crosses a trader's quote (it steps back one tick instead), so it
 * only trades when someone takes its price.
 */
function houseTargets(s: MkState): { bid: [number, number] | null; ask: [number, number] | null } {
  const fair = publicFair(streetShown(s), s.ids.length);
  const { bid, ask } = houseQuotes(fair, posOf(s.house), s.maxPrice);
  const bestAsk = s.asks.find((q) => q.o !== HOUSE)?.p ?? Infinity;
  const bestBid = s.bids.find((q) => q.o !== HOUSE)?.p ?? -Infinity;
  const b = Math.min(bid, bestAsk - 1);
  const a = Math.max(ask, bestBid + 1);
  const bq = Math.min(HOUSE_SIZE, headroom(s, HOUSE, "bid"));
  const aq = Math.min(HOUSE_SIZE, headroom(s, HOUSE, "ask"));
  return { bid: bq > 0 && b >= 1 ? [b, bq] : null, ask: aq > 0 && a <= s.maxPrice ? [a, aq] : null };
}

function requoteHouse(s: MkState) {
  const t = houseTargets(s);
  removeOwner(s.bids, HOUSE);
  removeOwner(s.asks, HOUSE);
  if (t.bid) s.bids.push({ o: HOUSE, p: t.bid[0], q: t.bid[1], seq: ++s.seq });
  if (t.ask) s.asks.push({ o: HOUSE, p: t.ask[0], q: t.ask[1], seq: ++s.seq });
  sortBook(s);
}

/** Requote only if the House's quotes are off target (keeps its place in the queue otherwise). */
function syncHouse(s: MkState) {
  const hb = s.bids.find((q) => q.o === HOUSE);
  const ha = s.asks.find((q) => q.o === HOUSE);
  if (!hb && !ha) return; // out of the book (at its limits): it comes back after its next trade or flip
  const t = houseTargets(s);
  const same = (q: Quote | undefined, want: [number, number] | null) => (q ? !!want && q.p === want[0] && q.q === want[1] : !want);
  if (!same(hb, t.bid) || !same(ha, t.ask)) requoteHouse(s);
}

/** Street flip times for a round of `tradeMs`: the default 25/50/70 s of 90, scaled to whole seconds. */
export function flipTimes(tradeMs: number): number[] {
  if (tradeMs === TRADE_MS) return FLIP_MS.slice();
  return FLIP_MS.map((ms) => Math.round((ms * tradeMs) / TRADE_MS / 1000) * 1000);
}

const streetShown = (s: MkState) => s.street.map((c, i) => (i < s.flipped ? c : null));

function startRound(s: MkState, ctx: GameCtx, round: number) {
  const deck = shuffle(
    Array.from({ length: 52 }, (_, i) => i),
    ctx.random,
  );
  const now = ctx.now();
  s.round = round;
  s.phase = "trade";
  s.cards = s.ids.map((_, i) => deck[i]);
  s.street = deck.slice(s.ids.length, s.ids.length + STREET);
  s.flipped = 0;
  s.roundStart = now;
  s.endsAt = now + s.tradeMs;
  s.flipAt = s.flipMs.map((ms) => now + ms);
  s.bids = [];
  s.asks = [];
  s.led = s.ids.map(newLedger);
  s.house = newLedger();
  s.tape = [];
  s.chart = [];
  s.trades = 0;
  requoteHouse(s);
}

/** Turn over every street card that is due. Returns true if any flipped. */
function doFlips(s: MkState, ctx: GameCtx): boolean {
  if (s.phase !== "trade") return false;
  let any = false;
  while (s.flipped < STREET && ctx.now() >= s.flipAt[s.flipped]) {
    const i = s.flipped++;
    send(ctx, { k: "flip", i, c: s.street[i] });
    any = true;
  }
  if (any) requoteHouse(s);
  return any;
}

/** The bell: reveal everything, settle every position, bank the round. */
function ringBell(s: MkState, ctx: GameCtx) {
  s.flipped = STREET;
  s.bids = [];
  s.asks = [];
  const settle = [...s.cards, ...s.street].reduce((sum, c) => sum + cardValue(c), 0);
  const pnl = s.led.map((l) => pnlAt(l, settle));
  s.totals = s.totals.map((t, i) => t + pnl[i]);
  s.history.push({
    settle,
    cards: s.cards.slice(),
    street: s.street.slice(),
    pos: s.led.map(posOf),
    pnl,
    fills: s.led.map((l) => l.n),
    house: pnlAt(s.house, settle),
    trades: s.trades,
  });
  s.phase = "settle";
  s.endsAt = ctx.now() + SETTLE_MS;
  send(ctx, { k: "bell", v: settle });
}

function finish(s: MkState, ctx: GameCtx) {
  s.phase = "final";
  s.over = true;
  s.endsAt = ctx.now();
  s.awaySince = null;
  const best = Math.max(...s.totals);
  const winners = s.ids.filter((_, i) => s.totals[i] === best);
  const name = (id: string) => ctx.player(id)?.name ?? "Someone";
  const at = signed(best);
  let headline: string;
  if (winners.length === 1) headline = `${name(winners[0])} wins Market Maker at ${at}`;
  else if (winners.length === s.ids.length) headline = `Market Maker ends in a ${winners.length}-way tie at ${at}`;
  else headline = `${winners.slice(0, -1).map(name).join(", ")} & ${name(winners[winners.length - 1])} tie at ${at}`;
  if (s.abandoned) headline += " (market closed early)";
  ctx.end({
    winners,
    headline,
    scores: Object.fromEntries(s.ids.map((id, i) => [id, s.totals[i]])),
  });
}

/** Track whether at least two traders are connected. Returns true if that changed. */
function updateAway(s: MkState, ctx: GameCtx): boolean {
  const here = s.ids.filter((id) => ctx.player(id)?.connected !== false).length;
  if (here >= 2 && s.awaySince !== null) {
    s.awaySince = null;
    return true;
  }
  if (here < 2 && s.awaySince === null && !s.abandoned) {
    s.awaySince = ctx.now();
    return true;
  }
  return false;
}

function parseSide(v: unknown): QSide | null {
  return v === "bid" || v === "ask" ? v : null;
}

// ---------- practice bot ----------

interface BotMem {
  /** Round + street cards up when the plan was made (a flip throws it away). */
  key: string;
  /** Don't act before this time. */
  at: number;
  /** Actions still to send, one per tick. */
  queue: MkAction[];
}
const botMem = new WeakMap<MkState, Map<string, BotMem>>();

/**
 * One decision for a bot trader, from what its own view shows: its card, the street,
 * the book and its fills. It values the contract at the public fair value with its own
 * card swapped in, leans against its inventory, takes quotes that are clearly mispriced
 * and otherwise makes a market a few points either side of its guess.
 */
export function botPlan(v: MkView, rand: () => number): MkAction[] {
  if (v.phase !== "trade" || v.me < 0 || v.card === null || !v.mine) return [];
  const pos = v.mine[0] - v.mine[2];
  const guess = v.fair - CARD_MEAN + cardValue(v.card) - pos * 0.4 + (rand() - 0.5) * 2;
  const edge = 2 + rand() * 2;
  const bestAsk = v.asks.find((r) => r[0] !== v.me);
  const bestBid = v.bids.find((r) => r[0] !== v.me);
  const size = 1 + Math.floor(rand() * 3);
  if (bestAsk && bestAsk[1] <= guess - edge && pos < POS_LIMIT) {
    return [{ type: "trade", side: "buy", qty: Math.min(size, bestAsk[2]), price: bestAsk[1] }];
  }
  if (bestBid && bestBid[1] >= guess + edge && pos > -POS_LIMIT) {
    return [{ type: "trade", side: "sell", qty: Math.min(size, bestBid[2]), price: bestBid[1] }];
  }
  if (rand() < 0.35) return []; // just watch for a moment
  const clampP = (p: number) => Math.max(1, Math.min(v.maxPrice, Math.round(p)));
  const bid = clampP(guess - edge);
  const ask = Math.max(bid + 1, clampP(guess + edge));
  const myBid = v.bids.find((r) => r[0] === v.me);
  const myAsk = v.asks.find((r) => r[0] === v.me);
  if (myBid && myAsk && Math.abs(myBid[1] - bid) <= 1 && Math.abs(myAsk[1] - ask) <= 1) return [];
  const plan: MkAction[] = [];
  if (myBid || myAsk) plan.push({ type: "cancel", side: "both" });
  const q = 1 + Math.floor(rand() * 2);
  if (pos < POS_LIMIT) plan.push({ type: "quote", side: "bid", price: bid, size: q });
  if (pos > -POS_LIMIT && ask <= v.maxPrice) plan.push({ type: "quote", side: "ask", price: ask, size: q });
  return plan;
}

export const market: GameDef<MkState, MkAction> = {
  id: "market",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const set = readSettings(config.settings, ctx.settings);
    const rounds = typeof set.rounds === "number" ? set.rounds : ROUNDS;
    const tradeMs = typeof set.roundMs === "number" ? set.roundMs : TRADE_MS;
    const s: MkState = {
      ids,
      phase: "trade",
      round: 0,
      rounds,
      tradeMs,
      flipMs: flipTimes(tradeMs),
      roundStart: 0,
      endsAt: 0,
      flipAt: [],
      maxPrice: maxPriceFor(ids.length),
      cards: [],
      street: [],
      flipped: 0,
      bids: [],
      asks: [],
      seq: 0,
      led: [],
      house: newLedger(),
      tape: [],
      chart: [],
      trades: 0,
      totals: ids.map(() => 0),
      history: [],
      awaySince: null,
      abandoned: false,
      over: false,
    };
    startRound(s, ctx, 1);
    return s;
  },

  action(s, playerId, raw, ctx) {
    if (s.over || s.phase !== "trade") return false;
    const slot = s.ids.indexOf(playerId);
    if (slot < 0) return false;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    // A flip that is due lands before the order does, so nobody trades on a stale card.
    const flipped = doFlips(s, ctx);
    if (ctx.now() >= s.endsAt) return flipped;
    const a = raw as Record<string, unknown>;
    const houseFills = s.house.n;
    const done = (changed: boolean) => {
      if (s.house.n !== houseFills) requoteHouse(s);
      else syncHouse(s);
      return changed || flipped;
    };

    if (a.type === "quote") {
      const side = parseSide(a.side);
      const { price, size } = a;
      if (!side || !isInt(price) || price < 1 || price > s.maxPrice) return flipped;
      if (!isInt(size) || size < 1 || size > SIZE_MAX) return flipped;
      const res = placeQuote(s, ctx, slot, side, price, size);
      if (res === null) return flipped;
      if ("error" in res) {
        tell(ctx, playerId, res.error);
        return flipped;
      }
      if (res.cut) tell(ctx, playerId, `Size cut to ${res.filled + res.rested}: positions are capped at ±${POS_LIMIT} lots.`);
      return done(true);
    }

    if (a.type === "cancel") {
      const which = a.side === "both" ? (["bid", "ask"] as const) : parseSide(a.side) ? [a.side as QSide] : null;
      if (!which) return flipped;
      let removed = false;
      for (const side of which) if (removeOwner(side === "bid" ? s.bids : s.asks, slot)) removed = true;
      return removed ? done(true) : flipped;
    }

    if (a.type === "trade") {
      const side: QSide | null = a.side === "buy" ? "bid" : a.side === "sell" ? "ask" : null;
      const { qty, price } = a;
      if (!side || !isInt(qty) || qty < 1 || qty > SIZE_MAX) return flipped;
      let limit: number | null = null;
      if (price !== undefined && price !== null) {
        if (!isInt(price) || price < 1 || price > s.maxPrice) return flipped;
        limit = price;
      }
      const room = headroom(s, slot, side);
      if (room <= 0) {
        tell(ctx, playerId, limitMsg(side));
        return flipped;
      }
      const opp = side === "bid" ? s.asks : s.bids;
      const others = opp.filter((q) => q.o !== slot);
      const reachable = others.filter((q) => limit === null || (side === "bid" ? q.p <= limit : q.p >= limit));
      if (!reachable.length) {
        const verb = side === "bid" ? "buy" : "sell";
        tell(
          ctx,
          playerId,
          !others.length
            ? side === "bid"
              ? "Nobody is selling right now. Post a bid and wait for a seller."
              : "Nobody is buying right now. Post an ask and wait for a buyer."
            : `Nothing left to ${verb} at ${limit} or better: the price moved.`,
        );
        return flipped;
      }
      const want = Math.min(qty, room);
      sweep(s, ctx, slot, side, want, limit);
      clipAll(s);
      if (want < qty) tell(ctx, playerId, `Size cut to ${want}: positions are capped at ±${POS_LIMIT} lots.`);
      return done(true);
    }

    return flipped;
  },

  tick(s, ctx) {
    if (s.over) return false;
    let changed = updateAway(s, ctx);
    const now = ctx.now();
    if (s.awaySince !== null && !s.abandoned && now >= s.awaySince + ABANDON_MS) {
      s.abandoned = true;
      s.awaySince = null;
      if (s.phase === "trade") ringBell(s, ctx);
      return true;
    }
    if (s.phase === "trade") {
      if (doFlips(s, ctx)) changed = true;
      if (now >= s.endsAt) {
        ringBell(s, ctx);
        changed = true;
      }
    } else if (s.phase === "settle" && now >= s.endsAt) {
      if (s.round >= s.rounds || s.abandoned) finish(s, ctx);
      else startRound(s, ctx, s.round + 1);
      changed = true;
    }
    return changed;
  },
  tickMs: 250,

  playerLeft(s, playerId, ctx) {
    if (s.over) return;
    // No stale quotes left behind for others to pick off.
    const slot = s.ids.indexOf(playerId);
    if (slot >= 0) {
      removeOwner(s.bids, slot);
      removeOwner(s.asks, slot);
      if (s.phase === "trade") syncHouse(s);
    }
    updateAway(s, ctx);
  },

  playerReturned(s, _playerId, ctx) {
    if (!s.over) updateAway(s, ctx);
  },

  bot(s, botId, ctx) {
    if (s.over || s.phase !== "trade" || !s.ids.includes(botId)) return null;
    let all = botMem.get(s);
    if (!all) botMem.set(s, (all = new Map()));
    const now = ctx.now();
    const key = `${s.round}:${s.flipped}`;
    let m = all.get(botId);
    if (!m || m.key !== key) {
      // New round or a street card just flipped: take a moment to look at it.
      m = { key, at: now + 800 + ctx.random() * 2200, queue: [] };
      all.set(botId, m);
      return null;
    }
    if (m.queue.length) return m.queue.shift() ?? null;
    if (now < m.at || now >= s.endsAt) return null;
    m.at = now + 1500 + ctx.random() * 3000;
    m.queue = botPlan(market.view(s, botId, ctx) as MkView, ctx.random);
    return m.queue.shift() ?? null;
  },

  view(s, viewerId): MkView {
    const me = s.ids.indexOf(viewerId);
    const trading = s.phase === "trade";
    const L = me >= 0 && trading ? s.led[me] : null;
    const street = streetShown(s);
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.rounds,
      tradeMs: s.tradeMs,
      flipMs: s.flipMs,
      ids: s.ids,
      roundStart: s.roundStart,
      endsAt: s.endsAt,
      flipAt: s.flipAt,
      maxPrice: s.maxPrice,
      street,
      me,
      card: me >= 0 ? s.cards[me] : null,
      mine: L ? [L.bq, L.bv, L.sq, L.sv] : null,
      bids: s.bids.map((q): BookRow => [q.o, q.p, q.q]),
      asks: s.asks.map((q): BookRow => [q.o, q.p, q.q]),
      counts: s.led.map((l) => l.n),
      tape: s.tape,
      nt: s.trades,
      chart: s.chart,
      fair: publicFair(street, s.ids.length),
      totals: s.totals,
      history: s.history,
      closeAt: s.awaySince === null || s.abandoned ? null : s.awaySince + ABANDON_MS,
      abandoned: s.abandoned,
    };
  },
};

export default market;
