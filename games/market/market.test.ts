import { assert, makeTestCtx } from "../../shared/testing";
import game, { type MkState, type MkView } from "./server";
import {
  ABANDON_MS,
  FLIP_MS,
  HOUSE,
  HOUSE_SPREAD,
  POS_LIMIT,
  ROUNDS,
  SETTLE_MS,
  TAPE_MAX,
  TRADE_MS,
  CHART_MAX,
  cardValue,
  houseQuotes,
  isMkEvent,
  maxPriceFor,
  publicFair,
  type MkEvent,
} from "./shared";

type T = ReturnType<typeof makeTestCtx>;

function fresh(n: number, seed = 42) {
  const t = makeTestCtx(n, seed);
  const s: MkState = game.setup(t.ctx);
  return { t, s };
}
/** Count ctx.end calls (makeTestCtx only keeps the first result). */
function countEnds(t: T) {
  let n = 0;
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    n += 1;
    end(r);
  };
  return () => n;
}
const act = (s: MkState, t: T, i: number, a: unknown) => game.action(s, t.ids[i], a as never, t.ctx);
const view = (s: MkState, t: T, id: string) => game.view(s, id, t.ctx) as MkView;
/** Take the House out of the book so a test sees only the traders' own quotes. */
function noHouse(s: MkState) {
  s.bids = s.bids.filter((q) => q.o !== HOUSE);
  s.asks = s.asks.filter((q) => q.o !== HOUSE);
}
const rows = (book: MkState["bids"]) => book.map((q) => [q.o, q.p, q.q]);
const evs = (t: T) => t.events.map((e) => e.event as MkEvent);
const msgsTo = (t: T, id: string) =>
  t.events.filter((e) => e.to === id && (e.event as MkEvent).k === "msg").map((e) => (e.event as { m: string }).m);
const pos = (s: MkState, i: number) => s.led[i].bq - s.led[i].sq;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Read through functions so TypeScript doesn't keep narrowing fields that the game mutates.
const phaseOf = (s: MkState) => s.phase;
const flippedOf = (s: MkState) => s.flipped;
const len = (x: { length: number }) => x.length;

// ---------- setup ----------
for (const n of [2, 3, 8]) {
  const { s } = fresh(n, n);
  assert(s.ids.length === n && s.cards.length === n && s.street.length === 3, `deal for ${n}`);
  const dealt = [...s.cards, ...s.street];
  assert(new Set(dealt).size === dealt.length && dealt.every((c) => c >= 0 && c < 52), "distinct cards from one deck");
  assert(s.maxPrice === maxPriceFor(n) && s.maxPrice === 13 * (n + 3), "price cap = 13 × cards");
  assert(s.phase === "trade" && s.round === 1 && s.flipped === 0, "round 1 trading");
  const fair = 7 * (n + 3);
  assert(same(rows(s.bids), [[HOUSE, fair - HOUSE_SPREAD, 2]]), "House bids fair − 6 for 2");
  assert(same(rows(s.asks), [[HOUSE, fair + HOUSE_SPREAD, 2]]), "House offers fair + 6 for 2");
}

// ---------- matching: a crossing quote trades at the resting price, the rest rests ----------
{
  const { t, s } = fresh(3);
  noHouse(s);
  assert(act(s, t, 0, { type: "quote", side: "ask", price: 45, size: 3 }) === true, "ask rests");
  assert(same(rows(s.asks), [[0, 45, 3]]), "ask in book");
  assert(act(s, t, 1, { type: "quote", side: "bid", price: 47, size: 2 }) === true, "crossing bid");
  assert(same(s.tape.at(-1)!.slice(0, 4), [1, 0, 45, 2]), "fills 2 at the RESTING price 45");
  assert(same(rows(s.asks), [[0, 45, 1]]) && s.bids.length === 0, "ask partly filled, nothing rests for the bid");
  assert(act(s, t, 2, { type: "quote", side: "bid", price: 46, size: 4 }) === true, "second crossing bid");
  assert(same(s.tape.at(-1)!.slice(0, 4), [2, 0, 45, 1]), "takes the last lot");
  assert(s.asks.length === 0, "a quote at size 0 is removed");
  assert(same(rows(s.bids), [[2, 46, 3]]), "the remainder rests at its own price");
  assert(pos(s, 0) === -3 && pos(s, 1) === 2 && pos(s, 2) === 1, "positions");
  const fills = evs(t).filter((e) => e.k === "t");
  assert(fills.length === 2 && fills.every(isMkEvent), "every fill is emitted");
  assert(fills.every((e) => e.k === "t" && (e.a === 1 || e.a === 2)), "the taker (not the resting quote) is named");
  assert(s.led[0].sv === 45 * 3 && s.led[1].bv === 90, "cash");
}

// ---------- price-time priority ----------
{
  const { t, s } = fresh(4);
  noHouse(s);
  act(s, t, 0, { type: "quote", side: "ask", price: 50, size: 2 });
  act(s, t, 1, { type: "quote", side: "ask", price: 50, size: 2 });
  act(s, t, 2, { type: "quote", side: "ask", price: 49, size: 1 });
  assert(same(rows(s.asks), [[2, 49, 1], [0, 50, 2], [1, 50, 2]]), "best price first, then oldest");
  assert(act(s, t, 3, { type: "trade", side: "buy", qty: 4 }) === true, "market buy");
  assert(
    same(
      s.tape.map((x) => x.slice(0, 4)),
      [[3, 2, 49, 1], [3, 0, 50, 2], [3, 1, 50, 1]],
    ),
    "fills in price-time order",
  );
  assert(same(rows(s.asks), [[1, 50, 1]]), "younger quote keeps its remainder");

  // Re-posting the same quote is a no-op; shrinking keeps priority; a new price loses it.
  act(s, t, 0, { type: "quote", side: "ask", price: 50, size: 3 });
  assert(same(rows(s.asks), [[1, 50, 1], [0, 50, 3]]), "new quote queues behind");
  assert(act(s, t, 0, { type: "quote", side: "ask", price: 50, size: 3 }) === false, "same quote = no change");
  act(s, t, 1, { type: "quote", side: "ask", price: 50, size: 1 });
  assert(same(rows(s.asks), [[1, 50, 1], [0, 50, 3]]), "same size is a no-op, stays first");
  act(s, t, 1, { type: "quote", side: "ask", price: 51, size: 1 });
  act(s, t, 1, { type: "quote", side: "ask", price: 50, size: 1 });
  assert(same(rows(s.asks), [[0, 50, 3], [1, 50, 1]]), "moving the price re-queues");
  act(s, t, 0, { type: "quote", side: "ask", price: 50, size: 2 });
  assert(same(rows(s.asks), [[0, 50, 2], [1, 50, 1]]), "shrinking keeps your place");
}

// ---------- no self-trading, own bid < own ask, price limits ----------
{
  const { t, s } = fresh(3);
  noHouse(s);
  act(s, t, 0, { type: "quote", side: "ask", price: 50, size: 2 });
  assert(act(s, t, 0, { type: "trade", side: "buy", qty: 1 }) === false, "can't buy from yourself");
  assert(msgsTo(t, "p0").at(-1)!.includes("Nobody is selling"), "explains why");
  assert(act(s, t, 0, { type: "quote", side: "bid", price: 50, size: 1 }) === false, "own bid must be below own ask");
  assert(act(s, t, 0, { type: "quote", side: "bid", price: 55, size: 1 }) === false, "no crossing yourself");
  assert(msgsTo(t, "p0").at(-1)!.includes("below your own ask"), "own-cross explained");
  assert(act(s, t, 0, { type: "quote", side: "bid", price: 49, size: 1 }) === true, "bid under own ask is fine");
  assert(act(s, t, 0, { type: "quote", side: "ask", price: 49, size: 1 }) === false, "own ask must be above own bid");
  assert(s.tape.length === 0, "no self trade happened");
  // Someone else posts an ask above p0's bid; p0 sells into... nobody (own bid skipped).
  assert(act(s, t, 0, { type: "trade", side: "sell", qty: 1 }) === false, "own bid is never hit by yourself");

  // Price limit: clicking a stale row never trades at a surprise price.
  assert(act(s, t, 1, { type: "trade", side: "buy", qty: 1, price: 49 }) === false, "nothing at 49 or better");
  assert(msgsTo(t, "p1").at(-1)!.includes("price moved"), "price-moved message");
  assert(act(s, t, 1, { type: "trade", side: "buy", qty: 5, price: 50 }) === true, "buy at 50 or better");
  assert(len(s.tape) === 1 && same(s.tape[0].slice(0, 4), [1, 0, 50, 2]), "IOC: fills what's there, rest is dropped");
  assert(s.asks.length === 0 && s.bids.length === 1, "no remainder rests for a trade");
  assert(act(s, t, 2, { type: "trade", side: "sell", qty: 1, price: 50 }) === false, "sell limit respected");
  assert(act(s, t, 2, { type: "trade", side: "sell", qty: 1, price: 49 }) === true, "sell at 49 or better");
}

// ---------- position limits ----------
{
  const { t, s } = fresh(3);
  noHouse(s);
  // p1 sells 15 to p0 in chunks.
  for (let i = 0; i < 3; i++) {
    act(s, t, 1, { type: "quote", side: "ask", price: 40, size: 5 });
    act(s, t, 0, { type: "trade", side: "buy", qty: 5 });
  }
  assert(pos(s, 0) === POS_LIMIT && pos(s, 1) === -POS_LIMIT, "both at the limit");
  assert(act(s, t, 1, { type: "quote", side: "ask", price: 40, size: 1 }) === false, "short limit blocks asks");
  assert(msgsTo(t, "p1").at(-1)!.includes(`short ${POS_LIMIT}`), "limit explained");
  act(s, t, 2, { type: "quote", side: "ask", price: 41, size: 3 });
  assert(act(s, t, 0, { type: "trade", side: "buy", qty: 1 }) === false, "long limit blocks buys");
  assert(act(s, t, 0, { type: "quote", side: "bid", price: 30, size: 1 }) === false, "long limit blocks bids");
  // Selling frees room; a later buy is clipped to the room left.
  act(s, t, 2, { type: "quote", side: "bid", price: 39, size: 3 });
  assert(act(s, t, 0, { type: "trade", side: "sell", qty: 3 }) === true, "sell some");
  assert(pos(s, 0) === 12, "now long 12");
  act(s, t, 0, { type: "quote", side: "bid", price: 30, size: 5 });
  assert(same(rows(s.bids).find((r) => r[0] === 0), [0, 30, 3]), "a new bid is clipped to the room left");
  assert(msgsTo(t, "p0").at(-1)!.includes("Size cut to 3"), "clip explained");
  assert(act(s, t, 0, { type: "trade", side: "buy", qty: 5 }) === true, "clipped buy");
  assert(pos(s, 0) === POS_LIMIT, "stops exactly at the limit");
  assert(!s.bids.some((q) => q.o === 0), "resting bid shrinks to nothing once you're full");
  // A crossing quote can't overfill either side.
  const { t: t2, s: s2 } = fresh(3);
  noHouse(s2);
  act(s2, t2, 1, { type: "quote", side: "ask", price: 40, size: 5 });
  for (let i = 0; i < 2; i++) {
    act(s2, t2, 0, { type: "trade", side: "buy", qty: 5 });
    act(s2, t2, 1, { type: "quote", side: "ask", price: 40, size: 5 });
  }
  act(s2, t2, 2, { type: "quote", side: "ask", price: 40, size: 5 });
  act(s2, t2, 0, { type: "quote", side: "bid", price: 45, size: 5 });
  assert(pos(s2, 0) === POS_LIMIT && s2.bids.every((q) => q.o !== 0), "crossing bid stops at the limit");
}

// ---------- the House ----------
{
  // Sanity on public info alone: always buys below and sells above fair value.
  for (let fair = 15; fair <= 140; fair++) {
    for (let inv = -20; inv <= 20; inv++) {
      const { bid, ask } = houseQuotes(fair, inv, 143);
      assert(bid <= fair - 1 && ask >= fair + 1 && bid < ask, `house edge at fair ${fair}, inv ${inv}`);
    }
  }
  assert(houseQuotes(50, 3, 143).ask < houseQuotes(50, 0, 143).ask, "long House cheapens its prices");
  assert(houseQuotes(50, -3, 143).bid > houseQuotes(50, 0, 143).bid, "short House raises its prices");

  // Random trading over whole games: every House fill is on the right side of the public fair value,
  // and each round is zero-sum between the traders and the House.
  for (let seed = 1; seed <= 6; seed++) {
    const n = 2 + (seed % 7);
    const t = makeTestCtx(n, seed * 101);
    const s: MkState = game.setup(t.ctx);
    let houseFills = 0;
    const emit = t.ctx.emit;
    t.ctx.emit = (e, o) => {
      const ev = e as MkEvent;
      if (ev.k === "t") {
        const fair = publicFair(
          s.street.map((c, i) => (i < s.flipped ? c : null)),
          n,
        );
        const [b, se, p] = ev.tr;
        if (b === HOUSE) assert(p <= fair - 1, `House bought at ${p} with fair ${fair}`);
        if (se === HOUSE) assert(p >= fair + 1, `House sold at ${p} with fair ${fair}`);
        if (b === HOUSE || se === HOUSE) houseFills++;
      }
      emit(e, o);
    };
    let r = seed * 7;
    const rand = (k: number) => ((r = (r * 1103515245 + 12345) % 2147483648), r % k);
    let guard = 0;
    while (!t.result && guard++ < 5000) {
      if (s.phase === "trade") {
        for (let k = 0; k < 4; k++) {
          const i = rand(n);
          const fair = 7 * (n + 3);
          const roll = rand(5);
          if (roll === 0) act(s, t, i, { type: "trade", side: rand(2) ? "buy" : "sell", qty: 1 + rand(5) });
          else if (roll === 4) act(s, t, i, { type: "cancel", side: "both" });
          else act(s, t, i, { type: "quote", side: rand(2) ? "bid" : "ask", price: Math.max(1, fair - 15 + rand(31)), size: 1 + rand(5) });
          for (const q of s.bids) assert(q.q > 0 && q.q <= 5, "bid sizes sane");
          for (let j = 0; j < n; j++) assert(Math.abs(pos(s, j)) <= POS_LIMIT, "limit never breached");
          const bb = s.bids[0]?.p ?? -1;
          const ba = s.asks[0]?.p ?? Infinity;
          assert(bb < ba, `book never crossed (${bb} / ${ba})`);
        }
      }
      t.advance(1000);
      game.tick!(s, t.ctx);
    }
    assert(t.result, "random game finishes");
    assert(houseFills > 0, "the House traded");
    for (const h of s.history) {
      assert(h.pnl.reduce((a, b) => a + b, 0) + h.house === 0, "zero-sum round");
    }
  }
}

// ---------- the House steps aside instead of crossing, and requotes after trading ----------
{
  const { t, s } = fresh(3);
  const fair = 42;
  // A trader's ask below the House bid trades at the House's resting price.
  assert(act(s, t, 0, { type: "quote", side: "ask", price: 30, size: 1 }) === true, "sell into the House");
  assert(same(s.tape[0].slice(0, 4), [HOUSE, 0, fair - 6, 1]), "fills at the House's bid");
  const hb = s.bids.find((q) => q.o === HOUSE)!;
  const ha = s.asks.find((q) => q.o === HOUSE)!;
  assert(hb.p === fair - 6 - 1 && ha.p === fair + 6 - 1 && hb.q === 2, "House requoted, skewed down after buying");
  // A trader's bid sitting above where the House wants to offer makes it step back, not trade.
  noHouse(s);
  act(s, t, 1, { type: "quote", side: "bid", price: 60, size: 1 });
  t.advance(FLIP_MS[0]);
  game.tick!(s, t.ctx);
  const ask = s.asks.find((q) => q.o === HOUSE)!;
  assert(ask.p >= 61 && s.tape.length === 1, "House never initiates a trade");
  // Once the stale bid is pulled, the House steps back in to its usual price.
  const fair2 = view(s, t, "p0").fair;
  const target = houseQuotes(fair2, s.house.bq - s.house.sq, s.maxPrice).ask;
  assert(act(s, t, 1, { type: "cancel", side: "bid" }) === true, "cancel");
  assert(s.asks.find((q) => q.o === HOUSE)!.p === target, `House back at its own ask (${target})`);
  // A quote that doesn't move the House leaves its time priority alone.
  const seq = s.asks.find((q) => q.o === HOUSE)!.seq;
  act(s, t, 2, { type: "quote", side: "ask", price: target, size: 1 });
  assert(s.asks.find((q) => q.o === HOUSE)!.seq === seq && s.asks[0].o === HOUSE, "House keeps its place in the queue");
}

// ---------- flips, catch-up, bell, settlement maths ----------
{
  const { t, s } = fresh(3);
  // Rig the deal: cards 5, 9, K; street 2, 7, Q -> settles at 5+9+13+2+7+12 = 48.
  s.cards = [4, 13 + 8, 26 + 12];
  s.street = [1, 6, 11];
  noHouse(s);
  t.events.length = 0;
  act(s, t, 0, { type: "quote", side: "ask", price: 44, size: 3 });
  act(s, t, 1, { type: "trade", side: "buy", qty: 3 }); // p1 +3 @ 44
  act(s, t, 2, { type: "quote", side: "bid", price: 50, size: 2 });
  act(s, t, 1, { type: "trade", side: "sell", qty: 1, price: 50 }); // p1 −1 @ 50 to p2
  act(s, t, 0, { type: "trade", side: "sell", qty: 1, price: 50 }); // p0 −1 @ 50 to p2
  assert(pos(s, 0) === -4 && pos(s, 1) === 2 && pos(s, 2) === 2, "positions before the bell");

  t.advance(FLIP_MS[0] - 1);
  assert(game.tick!(s, t.ctx) === false, "nothing before 25s");
  t.advance(1);
  assert(game.tick!(s, t.ctx) === true && s.flipped === 1, "first street card at 25s");
  assert(evs(t).some((e) => e.k === "flip" && e.i === 0 && e.c === 1), "flip event");
  const v1 = view(s, t, "p0");
  assert(v1.street[0] === 1 && v1.street[1] === null && v1.fair === 2 + 7 * 5, "view shows only flipped street");
  const h = s.asks.find((q) => q.o === HOUSE);
  assert(h && h.p === v1.fair + 6, "House requoted on the flip");
  // An action after a due flip but before the tick sees the flip first.
  t.advance(FLIP_MS[1] - FLIP_MS[0]);
  assert(act(s, t, 0, { type: "cancel", side: "bid" }) === true, "catch-up flip counts as a change");
  assert(flippedOf(s) === 2, "second flip landed with the action");
  t.advance(FLIP_MS[2] - FLIP_MS[1]);
  game.tick!(s, t.ctx);
  assert(flippedOf(s) === 3, "third flip at 70s");
  t.advance(TRADE_MS - FLIP_MS[2] - 1);
  assert(game.tick!(s, t.ctx) === false && s.phase === "trade", "still trading at 89.999s");
  t.advance(1);
  assert(act(s, t, 0, { type: "trade", side: "buy", qty: 1 }) === false, "no trades once the bell is due");
  assert(game.tick!(s, t.ctx) === true && phaseOf(s) === "settle", "bell at 90s");
  const r = s.history[0];
  assert(r.settle === 48, `settles at the sum of all cards (${r.settle})`);
  // p0: sold 3 @ 44 and 1 @ 50 -> (44−48)·3 + (50−48)·1 = −10
  // p1: bought 3 @ 44, sold 1 @ 50 -> (48−44)·3 + (50−48) = 14
  // p2: bought 2 @ 50 -> (48−50)·2 = −4
  assert(same(r.pnl, [-10, 14, -4]), `round P&L ${JSON.stringify(r.pnl)}`);
  assert(same(r.pos, [-4, 2, 2]) && same(s.totals, [-10, 14, -4]), "positions revealed, totals banked");
  assert(r.house === 0 && same(r.fills, [2, 2, 2]), "House untouched, fill counts");
  assert(s.bids.length === 0 && s.asks.length === 0, "book cleared at the bell");
  assert(evs(t).some((e) => e.k === "bell" && e.v === 48), "bell event");
  assert(act(s, t, 0, { type: "quote", side: "bid", price: 10, size: 1 }) === false, "no quoting while settling");
  const sv = view(s, t, "spectator");
  assert(same(sv.street, [1, 6, 11]) && sv.history[0].cards.length === 3, "everything public after the bell");
  t.advance(SETTLE_MS - 1);
  assert(game.tick!(s, t.ctx) === false, "settle holds for 8s");
  t.advance(1);
  assert(game.tick!(s, t.ctx) === true && s.phase === "trade" && s.round === 2, "round 2 opens");
  assert(s.tape.length === 0 && s.chart.length === 0 && pos(s, 1) === 0, "fresh round");
  assert(len(s.bids) === 1 && len(s.asks) === 1, "House back in the book");
}

// ---------- full game, ctx.end exactly once, winners ----------
{
  const { t, s } = fresh(3, 7);
  const ends = countEnds(t);
  let guard = 0;
  while (!t.result && guard++ < 100) {
    if (s.phase === "trade") {
      // p0 lifts the House offer every round.
      act(s, t, 0, { type: "trade", side: "buy", qty: 2 });
      t.advance(TRADE_MS);
    } else t.advance(SETTLE_MS);
    game.tick!(s, t.ctx);
  }
  assert(t.result && s.phase === "final" && s.over, "game over");
  assert(s.history.length === ROUNDS, "three rounds settled");
  const best = Math.max(...s.totals);
  const want = s.ids.filter((_, i) => s.totals[i] === best);
  assert(same(t.result.winners, want), "winners = highest total");
  assert(t.result.scores!.p0 === s.totals[0], "scores reported");
  assert(t.result.headline.includes("Market Maker"), t.result.headline);
  for (let i = 0; i < 3; i++) assert(s.totals[i] === s.history.reduce((a, h) => a + h.pnl[i], 0), "totals add up");
  assert(act(s, t, 0, { type: "quote", side: "bid", price: 10, size: 1 }) === false, "no actions after the end");
  t.advance(60_000);
  assert(game.tick!(s, t.ctx) === false, "no ticks after the end");
  assert(ends() === 1, "ctx.end exactly once");
  const fv = view(s, t, "p1");
  assert(fv.phase === "final" && fv.history.length === 3 && fv.mine === null, "final view");
}

// ---------- winners can be negative; ties ----------
{
  const finishWith = (totals: number[]) => {
    const { t, s } = fresh(totals.length);
    t.advance(TRADE_MS);
    game.tick!(s, t.ctx);
    s.totals = totals.slice();
    s.round = ROUNDS;
    t.advance(SETTLE_MS);
    game.tick!(s, t.ctx);
    return t.result!;
  };
  const neg = finishWith([-5, -3, -9]);
  assert(same(neg.winners, ["p1"]) && neg.headline === "Player1 wins Market Maker at −3", neg.headline);
  const tie = finishWith([12, 4, 12]);
  assert(same(tie.winners, ["p0", "p2"]) && tie.headline.includes("Player0 & Player2 tie at +12"), tie.headline);
  const all = finishWith([0, 0]);
  assert(same(all.winners, ["p0", "p1"]) && all.headline.includes("2-way tie"), all.headline);
  const pos1 = finishWith([7, 140, -20, 3, 3, 0, 1, 2]);
  assert(same(pos1.winners, ["p1"]) && pos1.headline.endsWith("+140"), pos1.headline);
}

// ---------- hostile input ----------
{
  const { t, s } = fresh(3);
  const before = JSON.stringify(s);
  const hostile: unknown[] = [
    null,
    undefined,
    0,
    "quote",
    [],
    [{ type: "quote", side: "bid", price: 40, size: 1 }],
    {},
    { type: "__proto__" },
    { type: "constructor" },
    { type: "quote" },
    { type: "quote", side: "middle", price: 40, size: 1 },
    { type: "quote", side: "bid", price: 40.5, size: 1 },
    { type: "quote", side: "bid", price: "40", size: 1 },
    { type: "quote", side: "bid", price: 0, size: 1 },
    { type: "quote", side: "bid", price: -4, size: 1 },
    { type: "quote", side: "bid", price: s.maxPrice + 1, size: 1 },
    { type: "quote", side: "bid", price: Infinity, size: 1 },
    { type: "quote", side: "bid", price: NaN, size: 1 },
    { type: "quote", side: "bid", price: 1e300, size: 1 },
    { type: "quote", side: "bid", price: 40, size: 0 },
    { type: "quote", side: "bid", price: 40, size: 6 },
    { type: "quote", side: "bid", price: 40, size: 2.5 },
    { type: "quote", side: "bid", price: 40, size: [2] },
    { type: "quote", side: { $gt: "" }, price: 40, size: 1 },
    { type: "cancel" },
    { type: "cancel", side: "all" },
    { type: "cancel", side: "bid" }, // nothing to cancel = no change
    { type: "trade" },
    { type: "trade", side: "bid", qty: 1 },
    { type: "trade", side: "buy", qty: 0 },
    { type: "trade", side: "buy", qty: 6 },
    { type: "trade", side: "buy", qty: "1" },
    { type: "trade", side: "buy", qty: 1, price: "40" },
    { type: "trade", side: "buy", qty: 1, price: 0 },
    { type: "trade", side: "buy", qty: 1, price: 1.5 },
    { type: "trade", side: "buy", qty: 1, price: 1 }, // valid but nothing that cheap
    { type: "x".repeat(5000) },
  ];
  for (const a of hostile) assert(act(s, t, 0, a) === false, `rejects ${JSON.stringify(a)?.slice(0, 80)}`);
  assert(game.action(s, "stranger", { type: "trade", side: "buy", qty: 1 } as never, t.ctx) === false, "non-player rejected");
  assert(game.action(s, "spectator", { type: "quote", side: "bid", price: 40, size: 1 } as never, t.ctx) === false, "spectator rejected");
  assert(JSON.stringify(s) === before, "nothing changed");
  // A price limit given as null is the same as none.
  assert(act(s, t, 0, { type: "trade", side: "buy", qty: 1, price: null }) === true, "null limit = market order");
}

// ---------- secrecy ----------
{
  const { t, s } = fresh(4, 3);
  noHouse(s);
  act(s, t, 0, { type: "quote", side: "ask", price: 50, size: 2 });
  act(s, t, 1, { type: "trade", side: "buy", qty: 2 });
  const secretKeys = ["cards", "led", "pos", "pnl", "house", "bq", "sq", "bv", "sv"];
  const walk = (v: unknown, path: string, out: string[]) => {
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (path === "" && k === "history") continue; // past rounds are public
      out.push(k);
      walk(x, `${path}.${k}`, out);
    }
  };
  for (const id of ["p1", "p2", "spectator"]) {
    const v = view(s, t, id);
    const keys: string[] = [];
    walk(v, "", keys);
    for (const k of secretKeys) assert(!keys.includes(k), `${id}'s view has no "${k}"`);
    assert(v.street.every((c) => c === null), "unflipped street hidden");
    const me = s.ids.indexOf(id);
    assert(v.card === (me >= 0 ? s.cards[me] : null), "only your own card");
    assert(id === "spectator" ? v.mine === null : v.mine !== null, "only your own fills");
    if (id === "p2") assert(same(v.mine, [0, 0, 0, 0]), "p2 sees its own (empty) fills, not p0's or p1's");
    assert(same(v.counts, [1, 1, 0, 0]), "others' trade counts are public");
  }
  const json = JSON.stringify(view(s, t, "spectator"));
  assert(!json.includes('"cards"') && !json.includes('"street":[' + s.street[0]), "spectator JSON has no secrets");
  // Past rounds' cards become public once settled; the current deal stays secret.
  t.advance(TRADE_MS);
  game.tick!(s, t.ctx);
  t.advance(SETTLE_MS);
  game.tick!(s, t.ctx);
  const v2 = view(s, t, "p3");
  assert(v2.round === 2 && v2.history.length === 1 && v2.street.every((c) => c === null), "round 2 street hidden");
  assert(v2.card === s.cards[3], "round 2: own card");
}

// ---------- disconnects: quotes pulled at once, early close, reconnect ----------
{
  const { t, s } = fresh(3);
  act(s, t, 1, { type: "quote", side: "bid", price: 40, size: 2 });
  act(s, t, 1, { type: "quote", side: "ask", price: 44, size: 2 });
  t.ctx.players[1].connected = false;
  game.playerLeft!(s, "p1", t.ctx);
  assert(!s.bids.some((q) => q.o === 1) && !s.asks.some((q) => q.o === 1), "no stale quotes left behind");
  t.advance(ABANDON_MS + 1000);
  game.tick!(s, t.ctx);
  assert(!s.abandoned && s.awaySince === null, "two traders still here: keep going");
  t.ctx.players[2].connected = false;
  game.playerLeft!(s, "p2", t.ctx);
  assert(s.awaySince !== null && view(s, t, "p0").closeAt === s.awaySince + ABANDON_MS, "closing countdown shown");
  t.advance(ABANDON_MS - 1);
  game.tick!(s, t.ctx);
  assert(!s.abandoned, "not yet");
  // Comes back in time: nothing happens.
  t.ctx.players[2].connected = true;
  game.playerReturned!(s, "p2", t.ctx);
  game.tick!(s, t.ctx);
  assert(s.awaySince === null && view(s, t, "p0").closeAt === null, "countdown cancelled");
  // Leaves for good: the market closes early, settles the round and ends.
  t.ctx.players[2].connected = false;
  game.playerLeft!(s, "p2", t.ctx);
  const ends = countEnds(t);
  t.advance(ABANDON_MS);
  assert(game.tick!(s, t.ctx) === true && s.phase === "settle" && s.abandoned, "early bell");
  assert(s.history.length === 1 && s.flipped === 3, "round settled with every card shown");
  t.advance(SETTLE_MS);
  game.tick!(s, t.ctx);
  assert(t.result && phaseOf(s) === "final" && ends() === 1, "game ends gracefully");
  assert(t.result.headline.includes("closed early"), t.result.headline);
}
{
  // Disconnects in the settle phase never stall the next round; a 2-player game closes if one is gone.
  const { t, s } = fresh(2);
  t.advance(TRADE_MS);
  game.tick!(s, t.ctx);
  assert(s.phase === "settle", "settling");
  t.ctx.players[1].connected = false;
  game.playerLeft!(s, "p1", t.ctx);
  t.advance(SETTLE_MS);
  game.tick!(s, t.ctx);
  assert(phaseOf(s) === "trade" && s.round === 2, "next round starts without them");
  assert(act(s, t, 0, { type: "trade", side: "buy", qty: 1 }) === true, "the one left can still trade with the House");
  t.advance(ABANDON_MS - SETTLE_MS);
  game.tick!(s, t.ctx);
  assert(s.phase === "settle" && s.abandoned, "closes 20s after the room emptied");
  t.advance(SETTLE_MS);
  game.tick!(s, t.ctx);
  assert(t.result && t.result.winners.length >= 1, "ends with a result");
  game.playerReturned!(s, "p1", t.ctx);
  assert(game.tick!(s, t.ctx) === false, "nothing after the end");
}

// ---------- tape and chart caps, view size ----------
{
  const { t, s } = fresh(8, 11);
  noHouse(s);
  for (let k = 0; k < 70; k++) {
    t.advance(1000);
    act(s, t, k % 8, { type: "quote", side: "ask", price: 70 + (k % 5), size: 1 });
    act(s, t, (k + 1) % 8, { type: "trade", side: "buy", qty: 1 });
    act(s, t, (k + 1) % 8, { type: "trade", side: "sell", qty: 1 }); // flatten if a bid is around
  }
  assert(s.tape.length === TAPE_MAX, "tape keeps the last 30");
  assert(s.chart.length <= CHART_MAX * 2 && s.chart.length % 2 === 0, "chart thinned");
  for (let i = 2; i < s.chart.length; i += 2) assert(s.chart[i] >= s.chart[i - 2], "chart stays in time order");
  // A full book: every trader quoting both sides.
  for (let i = 0; i < 8; i++) {
    act(s, t, i, { type: "cancel", side: "both" });
    act(s, t, i, { type: "quote", side: "bid", price: 40 + i, size: 5 });
    act(s, t, i, { type: "quote", side: "ask", price: 100 + i, size: 5 });
  }
  s.history.push(...[0, 1].map(() => ({ ...structuredClone(s.history[0] ?? {}), settle: 77, cards: s.cards.slice(), street: s.street.slice(), pos: s.ids.map(() => -15), pnl: s.ids.map(() => -1234), fills: s.ids.map(() => 99), house: 12345, trades: 999 })));
  s.ids = s.ids.map((id) => id + "-xxxxxxxxxxxxxxxxxxxx"); // real ids are longer
  const size = JSON.stringify(game.view(s, s.ids[0], t.ctx)).length;
  assert(s.bids.filter((q) => q.o !== HOUSE).length === 8 && s.asks.filter((q) => q.o !== HOUSE).length === 8, "full book");
  assert(size < 3000, `view stays small (${size} bytes)`);
  console.log(`  (8-player view with a full book, tape and history: ${size} bytes)`);
}

// ---------- every card value used ----------
{
  const vals = new Set<number>();
  for (let c = 0; c < 52; c++) vals.add(cardValue(c));
  assert(vals.size === 13 && Math.min(...vals) === 1 && Math.max(...vals) === 13, "A=1 … K=13");
}

console.log("✓ market tests passed");
