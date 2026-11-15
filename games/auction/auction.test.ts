import { assert, makeTestCtx } from "../../shared/testing";
import game, { type AuState, type AuView } from "./server";
import {
  ABANDON_MS,
  GIFT_DRUM_MS,
  GIFT_SHOW_MS,
  GOING_MS,
  INTRO_MS,
  LOTS,
  NO_BID_MS,
  PEEK_MS,
  SOLD_MS,
  START_CASH,
  STAGE_MS,
  kindOf,
  type AuEvent,
  type Bid,
  type Phase,
} from "./shared";
import type { GameResult } from "../../shared/types";

type T = ReturnType<typeof makeTestCtx>;

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

// Read mutable state through functions so TypeScript doesn't keep narrowing it across actions.
const ph = (s: AuState): Phase => s.phase;
const ld = (s: AuState): Bid | null => s.lead;
const res = (t: T): GameResult | null => t.result;
const view = (s: AuState, t: T, id: string) => game.view(s, id, t.ctx) as AuView;
const tick = (s: AuState, t: T, ms: number) => {
  t.advance(ms);
  return game.tick!(s, t.ctx);
};
const setConnected = (t: T, s: AuState, id: string, on: boolean) => {
  t.ctx.player(id)!.connected = on;
  if (on) game.playerReturned!(s, id, t.ctx);
  else game.playerLeft!(s, id, t.ctx);
};
const bid = (s: AuState, t: T, slot: number, amount: number, lot = s.lot) =>
  game.action(s, s.ids[slot], { type: "bid", lot, amount }, t.ctx);
const events = (t: T) => t.events.map((e) => ({ ...(e.event as AuEvent), to: e.to }));
const lastEvent = (t: T) => events(t)[t.events.length - 1];

/** Everyone presses ready, then wait out the lot intro. */
function startAuction(s: AuState, t: T) {
  for (const id of s.ids) game.action(s, id, { type: "ready" }, t.ctx);
  assert(ph(s) === "lot" && s.lot === 0, "all ready opens lot 1");
  t.advance(INTRO_MS);
}

/** From a "sold" phase, move to the next lot and past its intro. */
function nextLot(s: AuState, t: T) {
  assert(ph(s) === "sold", `expected sold, got ${ph(s)}`);
  const lot = s.lot;
  assert(tick(s, t, s.endsAt - t.ctx.now()) === true, "sold phase ends");
  if (lot + 1 < LOTS) {
    assert(ph(s) === "lot" && s.lot === lot + 1, "next lot opens");
    t.advance(INTRO_MS);
  }
}

// ---------- dealing and peeks ----------
for (let n = 3; n <= 8; n++) {
  for (let seed = 1; seed <= 40; seed++) {
    const t = makeTestCtx(n, seed * 7 + n);
    const s: AuState = game.setup(t.ctx);
    assert(s.crates.length === LOTS, "8 crates");
    const gifts = s.crates.filter((c) => c.gift);
    assert(gifts.length === 1 && !s.crates[0].gift, "one gift, never the first lot");
    const plain = s.crates.filter((c) => !c.gift);
    const cursed = plain.filter((c) => kindOf(c.value) === "cursed").length;
    const junk = plain.filter((c) => kindOf(c.value) === "junk").length;
    assert(cursed >= 1 && cursed <= 2, `1-2 cursed (got ${cursed})`);
    assert(junk === 2, "two junk crates");
    for (const c of plain) {
      const k = kindOf(c.value);
      if (k === "treasure") assert(c.value >= 10 && c.value <= 60, "treasure range");
      if (k === "cursed") assert(c.value >= -40 && c.value <= -15, "cursed range");
      if (k === "junk") assert(c.value >= 0 && c.value <= 5, "junk range");
    }
    const count = new Array(n).fill(0);
    for (const c of s.crates) {
      assert(c.peekers.length === 2 && c.peekers[0] !== c.peekers[1], "two distinct peekers per crate");
      for (const p of c.peekers) {
        assert(p >= 0 && p < n, "peeker is a player");
        count[p] += 1;
      }
    }
    assert(Math.max(...count) - Math.min(...count) <= 1, `peeks spread evenly (${count.join(",")})`);
    assert(s.cash.every((c) => c === START_CASH), "everyone starts with $100");
  }
}

// ---------- a full game: peeks, a bidding war, a no-sale, the gift and the final ----------
{
  const t = makeTestCtx(4, 3);
  const ends = countEnds(t);
  const s: AuState = game.setup(t.ctx);
  assert(ph(s) === "peek" && s.endsAt === t.ctx.now() + PEEK_MS, "starts with peeks");
  // Ready is idempotent, and one player's ready doesn't start the auction.
  assert(game.action(s, s.ids[0], { type: "ready" }, t.ctx) === true, "ready");
  assert(game.action(s, s.ids[0], { type: "ready" }, t.ctx) === false, "ready twice is a no-op");
  assert(ph(s) === "peek", "still peeking");
  // Bids during peeks are refused.
  assert(bid(s, t, 1, 5, 0) === false && ld(s) === null, "no bids while peeking");
  startAuction(s, t);

  // Lot 1: a bidding war. Every bid resets the gavel to the start.
  t.events.length = 0;
  assert(bid(s, t, 0, 5) === false, "accepted bids go out as events, not views");
  let e = lastEvent(t);
  assert(e.k === "bid" && e.p === 0 && e.a === 5 && e.n === 1 && e.to === undefined, "bid event broadcast to all");
  assert(s.endsAt === t.ctx.now() + GOING_MS, "gavel starts");
  t.advance(STAGE_MS * 2 + 400); // into "last call"
  assert(game.tick!(s, t.ctx) === false, "nothing visible changes mid-countdown");
  bid(s, t, 1, 6);
  assert(ld(s)?.p === 1 && s.endsAt === t.ctx.now() + GOING_MS, "a late bid resets the gavel to the start");
  t.advance(GOING_MS - 200); // anti-snipe: a bid in the last second still resets
  bid(s, t, 0, 16);
  assert(ld(s)?.a === 16 && s.endsAt === t.ctx.now() + GOING_MS, "a bid in the last second resets too");
  // Validation.
  assert(bid(s, t, 0, 20) === false && ld(s)?.a === 16, "can't outbid yourself");
  e = lastEvent(t);
  assert(e.k === "no" && e.to === s.ids[0], "refusals go to the bidder only");
  t.advance(250);
  assert(bid(s, t, 2, 16) === false && ld(s)?.p === 0, "must beat the top bid");
  t.advance(250);
  assert(bid(s, t, 2, START_CASH + 1) === false, "can't bid more than your cash");
  t.advance(250);
  assert(bid(s, t, 2, 17.5) === false, "whole dollars only");
  assert(bid(s, t, 2, 17, 3) === false, "bids for another lot are refused");
  assert(ld(s)?.a === 16 && s.n === 3, "only legal bids landed");
  // The gavel falls exactly at the deadline.
  t.advance(s.endsAt - t.ctx.now() - 1);
  assert(game.tick!(s, t.ctx) === false && ph(s) === "lot", "not a millisecond early");
  assert(tick(s, t, 1) === true && ph(s) === "sold", "sold at the deadline");
  assert(s.crates[0].status === "sold" && s.crates[0].buyer === 0 && s.crates[0].price === 16, "sold to the top bidder");
  assert(s.cash[0] === START_CASH - 16, "the winner pays");
  const v1 = view(s, t, s.ids[2]);
  assert(v1.crates[0].value === s.crates[0].value, "opened crate is revealed to everyone");
  assert(view(s, t, "spectator").crates[0].value === s.crates[0].value, "and to spectators");
  assert(bid(s, t, 2, 30, 0) === false, "no bids after the gavel");
  assert(s.endsAt - t.ctx.now() === SOLD_MS || s.crates[0].gift, "reveal pause");
  nextLot(s, t);

  // Lot 2: nobody bids -> no sale after the opening window.
  t.advance(NO_BID_MS - 1);
  assert(game.tick!(s, t.ctx) === false, "still open");
  assert(tick(s, t, 1) === true && ph(s) === "sold" && s.crates[1].status === "unsold", "no sale");
  assert(view(s, t, s.ids[3]).crates[1].value === s.crates[1].value || s.crates[1].gift, "unsold crates are opened too");
  nextLot(s, t);

  // A bid that arrives after the deadline but before the tick: the sale lands first.
  bid(s, t, 3, 2);
  t.advance(GOING_MS + 50);
  assert(bid(s, t, 1, 10) === true, "late bid triggers the due sale");
  assert(ph(s) === "sold" && s.crates[2].buyer === 3 && s.crates[2].price === 2, "the earlier bidder keeps it");
  e = lastEvent(t);
  assert(e.k === "no" && e.to === s.ids[1] && /late/i.test(e.m), "late bidder is told");
  nextLot(s, t);

  // Remaining lots: player 1 buys everything cheaply.
  while (ph(s) === "lot") {
    assert(bid(s, t, 1, 1) === false && ld(s)?.p === 1, "opening bid $1");
    assert(tick(s, t, GOING_MS) === true && ph(s) === "sold", "sold");
    if (s.lot === LOTS - 1) break;
    nextLot(s, t);
  }
  const giftLot = s.crates.findIndex((c) => c.gift);
  assert(s.crates[giftLot].status === "sold", "gift sold");
  const giftOwner = s.crates[giftLot].buyer;
  // Gift stays sealed for non-peekers until the reveal.
  const outsider = s.ids.findIndex((_, i) => !s.crates[giftLot].peekers.includes(i));
  assert(view(s, t, s.ids[outsider]).crates[giftLot].x2 === null, "gift sealed after the sale");
  assert(tick(s, t, s.endsAt - t.ctx.now()) === true && ph(s) === "gift", "double-or-nothing reveal");
  assert(view(s, t, s.ids[outsider]).crates[giftLot].x2 === null, "sealed during the drum roll");
  assert(tick(s, t, GIFT_DRUM_MS) === true && s.giftShown, "result shows");
  assert(view(s, t, s.ids[outsider]).crates[giftLot].x2 === s.crates[giftLot].x2, "now everyone knows");
  assert(!t.result, "not over during the reveal");
  assert(tick(s, t, GIFT_SHOW_MS) === true && ph(s) === "final", "final");
  assert(t.result && ends() === 1, "ctx.end once");
  // Scores = cash + vault (with the gift).
  for (let i = 0; i < 4; i++) {
    let vault = 0;
    for (const c of s.crates) if (c.status === "sold" && c.buyer === i && !c.gift) vault += c.value;
    if (i === giftOwner) vault = s.crates[giftLot].x2 ? vault * 2 : 0;
    const spent = s.crates.filter((c) => c.status === "sold" && c.buyer === i).reduce((a, c) => a + c.price, 0);
    assert(s.cash[i] === START_CASH - spent, "cash = start - spent");
    assert(res(t)!.scores![s.ids[i]] === s.cash[i] + vault, `score for p${i}`);
  }
  const best = Math.max(...Object.values(res(t)!.scores!));
  assert(res(t)!.winners.every((id) => res(t)!.scores![id] === best), "winners have the top score");
  const fv = view(s, t, s.ids[2]);
  assert(fv.crates.every((c) => c.peekers !== null) && fv.scores !== null, "final reveals who peeked");
  // Nothing happens after the end.
  assert(game.action(s, s.ids[0], { type: "bid", lot: s.lot, amount: 1 }, t.ctx) === false, "no actions after the end");
  assert(game.tick!(s, t.ctx) === false, "no ticks after the end");
  t.advance(60_000);
  game.tick!(s, t.ctx);
  assert(ends() === 1, "still exactly one end");
}

// ---------- intro window and stale lots ----------
{
  const t = makeTestCtx(3, 9);
  const s: AuState = game.setup(t.ctx);
  for (const id of s.ids) game.action(s, id, { type: "ready" }, t.ctx);
  assert(bid(s, t, 0, 3) === false && ld(s) === null, "no bids during the lot intro");
  t.advance(INTRO_MS);
  assert(bid(s, t, 0, 3) === false && ld(s)?.a === 3, "bids open after the intro");
  assert(bid(s, t, 1, 0) === false && ld(s)?.a === 3, "zero rejected");
  t.advance(250);
  assert(bid(s, t, 1, -5) === false && ld(s)?.a === 3, "negative rejected");
}

// ---------- hostile actions ----------
{
  const t = makeTestCtx(3, 11);
  const s: AuState = game.setup(t.ctx);
  startAuction(s, t);
  const before = JSON.stringify(s);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const junk: any[] = [
    null,
    undefined,
    42,
    "bid",
    [],
    [{ type: "bid", lot: 0, amount: 5 }],
    {},
    { type: "__proto__" },
    { type: "constructor" },
    { type: "bid" },
    { type: "bid", lot: "0", amount: 5 },
    { type: "bid", lot: 0, amount: "5" },
    { type: "bid", lot: 0, amount: NaN },
    { type: "bid", lot: 0, amount: Infinity },
    { type: "bid", lot: 0, amount: 1e300 },
    { type: "bid", lot: 0, amount: 2.5 },
    { type: "bid", lot: -1, amount: 5 },
    { type: "bid", lot: 99, amount: 5 },
    { type: "bid", lot: 0, amount: { valueOf: 5 } },
    { type: "bid", lot: 0, amount: [5] },
    { type: "ready" },
    { type: "x".repeat(5000) },
  ];
  for (const a of junk) assert(game.action(s, s.ids[0], a, t.ctx) === false, `rejects ${JSON.stringify(a)?.slice(0, 60)}`);
  assert(game.action(s, "stranger", { type: "bid", lot: 0, amount: 5 }, t.ctx) === false, "non-players can't bid");
  assert(game.action(s, "spectator", { type: "ready" }, t.ctx) === false, "spectators can't ready");
  const after = JSON.parse(JSON.stringify(s)) as AuState;
  const b = JSON.parse(before) as AuState;
  assert(after.lead === null && after.n === 0 && JSON.stringify(after.cash) === JSON.stringify(b.cash), "junk changed nothing");
  // Refusal notices are rate limited.
  const t0 = t.events.length;
  for (let i = 0; i < 20; i++) bid(s, t, 1, START_CASH + 50);
  assert(t.events.length - t0 <= 1, "refusal notices are rate limited");
}

// ---------- secrecy ----------
{
  const t = makeTestCtx(5, 21);
  const s: AuState = game.setup(t.ctx);
  for (let p = 0; p < 5; p++) {
    const v = view(s, t, s.ids[p]);
    const json = JSON.stringify(v);
    assert(!json.includes('"peekers":['), "who peeked stays secret");
    s.crates.forEach((c, i) => {
      const mine = c.peekers.includes(p);
      assert(v.crates[i].peeked === mine, "peek flag only for your own peeks");
      if (c.gift) {
        assert(v.crates[i].value === null, "gift has no value");
        assert(v.crates[i].x2 === (mine ? c.x2 : null), "gift outcome only for its peekers");
      } else assert(v.crates[i].value === (mine ? c.value : null), "values only for your own peeks");
    });
  }
  const spec = view(s, t, "spectator");
  assert(spec.me === -1, "spectator slot");
  assert(spec.crates.every((c) => c.value === null && c.x2 === null && !c.peeked && c.peekers === null), "spectators see no peeks");
  // Even an outsider's JSON doesn't carry the hidden values in any field.
  const outsider = s.ids.findIndex((_, i) => s.crates.every((c) => !c.peekers.includes(i) || c.gift));
  if (outsider >= 0) {
    const json = JSON.stringify(view(s, t, s.ids[outsider]));
    assert(!/"value":-?\d/.test(json.replace(/"value":null/g, "")), "no values leak");
  }
}

// ---------- disconnects: peeks, abandonment, reconnects ----------
{
  // A disconnected player doesn't hold up the peek phase.
  const t = makeTestCtx(3, 5);
  const s: AuState = game.setup(t.ctx);
  game.action(s, s.ids[0], { type: "ready" }, t.ctx);
  game.action(s, s.ids[1], { type: "ready" }, t.ctx);
  assert(ph(s) === "peek", "waiting for the third");
  setConnected(t, s, s.ids[2], false);
  assert(tick(s, t, 250) === true && ph(s) === "lot", "the absent player is skipped");
  // The leader leaves mid-lot: their bid stands and the gavel still falls.
  t.advance(INTRO_MS);
  bid(s, t, 1, 7);
  setConnected(t, s, s.ids[1], false);
  assert(s.awaySince !== null, "only one bidder left");
  tick(s, t, GOING_MS);
  assert(ph(s) === "sold" && s.crates[0].buyer === 1, "an absent leader still wins");
  // Someone comes back before the deadline: no early close.
  setConnected(t, s, s.ids[2], true);
  assert(s.awaySince === null, "back to two");
  nextLot(s, t);
  // Too few for too long: the auction closes and the game ends.
  setConnected(t, s, s.ids[2], false);
  const ends = countEnds(t);
  const closeAt = (view(s, t, s.ids[0]).closeAt ?? 0) - t.ctx.now();
  assert(closeAt === ABANDON_MS, "players are warned");
  let guard = 0;
  while (!t.result && guard++ < 400) tick(s, t, 250);
  assert(t.result && ends() === 1 && s.abandoned, "closed early");
  assert(s.crates.every((c) => c.status !== "up"), "leftover crates go unsold");
  assert(/closed early/.test(res(t)!.headline), "headline says why");
}
{
  // Everyone disconnects: timers still run the game to the end.
  const t = makeTestCtx(3, 6);
  const s: AuState = game.setup(t.ctx);
  for (const id of s.ids) setConnected(t, s, id, false);
  let guard = 0;
  while (!t.result && guard++ < 2000) tick(s, t, 250);
  assert(t.result, "game never stalls");
  // Reconnecting after the end is harmless.
  setConnected(t, s, s.ids[0], true);
  assert(game.tick!(s, t.ctx) === false, "quiet after the end");
}
{
  // Reconnect in every phase: the view is complete for a returning player.
  const t = makeTestCtx(4, 8);
  const s: AuState = game.setup(t.ctx);
  const phases = new Set<string>();
  let guard = 0;
  while (!t.result && guard++ < 2000) {
    phases.add(ph(s));
    setConnected(t, s, s.ids[3], false);
    setConnected(t, s, s.ids[3], true);
    const v = view(s, t, s.ids[3]);
    assert(v.phase === ph(s) && v.crates.length === LOTS, "full view after reconnect");
    if (ph(s) === "lot" && t.ctx.now() >= s.openAt && !ld(s) && s.lot % 2 === 0) bid(s, t, s.lot % 4, 3);
    tick(s, t, 250);
  }
  assert(t.result, "finished");
  for (const p of ["peek", "lot", "sold"]) assert(phases.has(p), `visited ${p}`);
}

// ---------- the gift: x2 doubles the vault, x0 wipes it (even a cursed one) ----------
for (const x2 of [true, false]) {
  const t = makeTestCtx(3, 13);
  const s: AuState = game.setup(t.ctx);
  const giftLot = s.crates.findIndex((c) => c.gift);
  s.crates[giftLot].x2 = x2;
  startAuction(s, t);
  for (;;) {
    // Player 0 buys everything for $1 (cash 100 covers 8 lots).
    bid(s, t, 0, 1);
    tick(s, t, GOING_MS);
    if (s.lot === LOTS - 1) break;
    nextLot(s, t);
  }
  tick(s, t, s.endsAt - t.ctx.now());
  assert(ph(s) === "gift", "gift reveal");
  tick(s, t, GIFT_DRUM_MS);
  tick(s, t, GIFT_SHOW_MS);
  assert(t.result, "ended");
  const raw = s.crates.filter((c) => !c.gift).reduce((a, c) => a + c.value, 0);
  const expect = START_CASH - LOTS + (x2 ? raw * 2 : 0);
  assert(res(t)!.scores![s.ids[0]] === expect, `gift ${x2 ? "x2" : "x0"}: ${res(t)!.scores![s.ids[0]]} vs ${expect}`);
  assert(res(t)!.scores![s.ids[1]] === START_CASH, "others keep their cash");
}

// ---------- ties and the unsold gift ----------
{
  const t = makeTestCtx(3, 17);
  const s: AuState = game.setup(t.ctx);
  let guard = 0;
  while (!t.result && guard++ < 2000) tick(s, t, 250);
  assert(t.result, "ended with no bids at all");
  assert(res(t)!.winners.length === 3, "everyone ties");
  assert(/Nobody bought/.test(res(t)!.headline), "headline");
  assert(s.crates.every((c) => c.status === "unsold"), "all unsold");
  const v = view(s, t, s.ids[0]);
  assert(v.crates.every((c) => (c.gift ? c.x2 !== null : c.value !== null)), "the final opens everything");
}

// ---------- max players ----------
{
  const t = makeTestCtx(8, 23);
  const ends = countEnds(t);
  const s: AuState = game.setup(t.ctx);
  startAuction(s, t);
  for (;;) {
    // A war between everyone: each player raises by 1 in turn.
    for (let r = 0; r < 12; r++) bid(s, t, r % 8, r + 1);
    assert(ld(s)?.a === 12, "12 bids landed");
    tick(s, t, GOING_MS);
    if (s.lot === LOTS - 1) break;
    nextLot(s, t);
  }
  let guard = 0;
  while (!t.result && guard++ < 200) tick(s, t, 250);
  assert(t.result && ends() === 1, "8-player game ends");
  const json = JSON.stringify(view(s, t, s.ids[0]));
  assert(json.length < 4000, `view stays small (${json.length} bytes)`);
}

console.log("✓ auction tests passed");
