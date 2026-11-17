import { assert, makeTestCtx } from "../../shared/testing";
import game, { autoMove, botMove, favouriteFace, type LiarsAction, type LiarsState, type LiarsView } from "./server";
import {
  AWAY_MS,
  LONELY_MS,
  ROLL_MS,
  TURN_MS,
  isLegalBid,
  minQtyFor,
  minRaise,
  revealTiming,
  startingDice,
} from "./shared";

// ---------- helpers ----------

/** Like assert() but without narrowing (the game mutates state behind TypeScript's back). */
function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

type Harness = ReturnType<typeof makeTestCtx>;

function start(players = 3, seed = 42) {
  const t = makeTestCtx(players, seed);
  let endCalls = 0;
  const realEnd = t.ctx.end;
  t.ctx.end = (r) => {
    endCalls++;
    realEnd(r);
  };
  const s: LiarsState = game.setup(t.ctx);
  return { t, s, ends: () => endCalls };
}

const tick = (s: LiarsState, t: Harness) => game.tick!(s, t.ctx);
const act = (s: LiarsState, t: Harness, who: string, a: unknown) => game.action(s, who, a as LiarsAction, t.ctx);
const view = (s: LiarsState, t: Harness, who: string) => game.view(s, who, t.ctx) as LiarsView;
const snap = (s: LiarsState) => JSON.stringify(s);
const total = (s: LiarsState) => s.order.reduce((n, id) => n + s.counts[id], 0);

function setConnected(s: LiarsState, t: Harness, id: string, on: boolean) {
  const p = t.ctx.players.find((x) => x.id === id);
  assert(p, `player ${id} exists`);
  p.connected = on;
  if (on) game.playerReturned!(s, id, t.ctx);
  else game.playerLeft!(s, id, t.ctx);
}

/** Finish the cup shake so bidding starts. */
function toBid(s: LiarsState, t: Harness) {
  check(s.phase === "roll", `expected roll, got ${s.phase}`);
  t.advance(ROLL_MS);
  check(tick(s, t) === true, "tick ends the roll");
  check(s.phase === "bid", "bidding started");
}

/** Finish the reveal animation. */
function endReveal(s: LiarsState, t: Harness) {
  check(s.phase === "reveal", `expected reveal, got ${s.phase}`);
  t.advance(s.endsAt - t.ctx.now());
  check(tick(s, t) === true, "tick ends the reveal");
}

/** Overwrite this round's dice (keeping counts consistent). */
function setDice(s: LiarsState, hands: Record<string, number[]>) {
  for (const [id, h] of Object.entries(hands)) {
    s.dice[id] = h.slice();
    s.counts[id] = h.length;
  }
}

function bid(s: LiarsState, t: Harness, qty: number, face: number) {
  const who = s.turn!;
  check(act(s, t, who, { type: "bid", qty, face }) !== false, `${who} bids ${qty}x${face}`);
}

// ---------- shared helpers ----------

check(startingDice(2) === 5 && startingDice(4) === 5, "5 dice up to 4 players");
check(startingDice(5) === 4 && startingDice(6) === 4, "4 dice for 5-6 players");
check(startingDice(7) === 3 && startingDice(8) === 3, "3 dice for 7-8 players");
check(isLegalBid({ qty: 1, face: 2 }, null, 10), "opening 1x2 is legal");
check(!isLegalBid({ qty: 1, face: 1 }, null, 10), "ones can't be bid");
check(!isLegalBid({ qty: 0, face: 3 }, null, 10), "qty >= 1");
check(!isLegalBid({ qty: 11, face: 3 }, null, 10), "qty <= total");
check(!isLegalBid({ qty: 2.5, face: 3 }, null, 10), "integers only");
check(isLegalBid({ qty: 3, face: 2 }, { qty: 2, face: 6 }, 10), "bigger qty, any face");
check(isLegalBid({ qty: 2, face: 5 }, { qty: 2, face: 4 }, 10), "same qty, higher face");
check(!isLegalBid({ qty: 2, face: 4 }, { qty: 2, face: 4 }, 10), "same bid is not a raise");
check(!isLegalBid({ qty: 2, face: 3 }, { qty: 2, face: 4 }, 10), "lower face is not a raise");
check(!isLegalBid({ qty: 1, face: 6 }, { qty: 2, face: 2 }, 10), "lower qty is not a raise");
check(JSON.stringify(minRaise({ qty: 3, face: 4 }, 10)) === '{"qty":3,"face":5}', "min raise bumps the face");
check(JSON.stringify(minRaise({ qty: 3, face: 6 }, 10)) === '{"qty":4,"face":2}', "min raise after sixes");
check(minRaise({ qty: 10, face: 6 }, 10) === null, "no raise over the max bid");
check(minQtyFor(3, { qty: 4, face: 5 }, 10) === 5 && minQtyFor(6, { qty: 4, face: 5 }, 10) === 4, "min qty per face");
check(minQtyFor(2, { qty: 10, face: 5 }, 10) === null, "no qty fits");
check(favouriteFace([1, 3, 3, 5, 5]) === 5 && favouriteFace([1, 1, 1]) === 6 && favouriteFace([2, 4, 4]) === 4, "favourite face");
{
  const a = revealTiming(0);
  const b = revealTiming(24);
  check(a.total >= 4000 && b.total <= 8000 && b.verdict > b.flip, "reveal timing stays around 6s");
}

// ---------- setup ----------

for (let n = 2; n <= 8; n++) {
  const { s, t } = start(n, n * 7);
  check(s.order.length === n, "everyone takes part");
  for (const id of t.ids) {
    check(s.counts[id] === startingDice(n), `${n}p: starting dice`);
    check(s.dice[id].length === s.counts[id], `${n}p: rolled all dice`);
    check(s.dice[id].every((v) => Number.isInteger(v) && v >= 1 && v <= 6), "dice are 1-6");
  }
  check(s.phase === "roll" && s.order.includes(s.starter) && s.turn === s.starter, "random starter opens");
}
{
  // The first starter is random: different seeds pick different openers.
  const starters = new Set<string>();
  for (let seed = 1; seed <= 30; seed++) starters.add(start(4, seed).s.starter);
  check(starters.size >= 3, "starter varies with the seed");
}

// ---------- phases, bidding, turn order ----------

{
  const { s, t } = start(3, 1);
  s.starter = "p1";
  s.turn = "p1";
  check(act(s, t, "p1", { type: "bid", qty: 1, face: 3 }) === false, "no bids during the roll");
  t.advance(ROLL_MS - 1);
  check(!tick(s, t) && s.phase === "roll", "roll lasts ROLL_MS");
  t.advance(1);
  check(tick(s, t) === true && s.phase === "bid" && s.turn === "p1", "roll -> bid, starter to move");
  check(s.endsAt === t.ctx.now() + TURN_MS, "30s turn timer");

  check(act(s, t, "p0", { type: "bid", qty: 1, face: 3 }) === false, "not your turn");
  check(act(s, t, "p1", { type: "liar" }) === false, "can't call liar on nothing");
  check(act(s, t, "p1", { type: "spot" }) === false, "can't call spot on nothing");
  bid(s, t, 2, 3);
  check(s.turn === "p2", "turn passes in join order");
  check(act(s, t, "p2", { type: "bid", qty: 2, face: 3 }) === false, "must raise");
  check(act(s, t, "p2", { type: "bid", qty: 2, face: 2 }) === false, "lower face rejected");
  check(act(s, t, "p2", { type: "bid", qty: 1, face: 6 }) === false, "lower qty rejected");
  check(act(s, t, "p2", { type: "bid", qty: 16, face: 6 }) === false, "more than the dice on the table");
  check(act(s, t, "p2", { type: "bid", qty: 3, face: 1 }) === false, "ones can't be bid");
  bid(s, t, 2, 4);
  check(s.turn === "p0", "wraps around");
  bid(s, t, 3, 2);
  check(s.turn === "p1" && s.bids.length === 3, "history kept");
  const v = view(s, t, "p2");
  check(v.bids.length === 3 && v.bids[2].qty === 3 && v.bids[2].face === 2 && v.bids[0].by === "p1", "bid history in view");
}

// ---------- hostile actions ----------

{
  const { s, t } = start(3, 5);
  toBid(s, t);
  const mover = s.turn!;
  const before = snap(s);
  const junk: unknown[] = [
    null,
    undefined,
    42,
    "bid",
    [],
    ["bid", 3, 4],
    {},
    { type: null },
    { type: "__proto__" },
    { type: "constructor" },
    { type: "bid" },
    { type: "bid", qty: "3", face: 4 },
    { type: "bid", qty: 3, face: "4" },
    { type: "bid", qty: 2.5, face: 4 },
    { type: "bid", qty: NaN, face: 4 },
    { type: "bid", qty: Infinity, face: 4 },
    { type: "bid", qty: -1, face: 4 },
    { type: "bid", qty: 0, face: 4 },
    { type: "bid", qty: 1e9, face: 4 },
    { type: "bid", qty: 2, face: 7 },
    { type: "bid", qty: 2, face: 0 },
    { type: "bid", qty: 2, face: 1 },
    { type: "bid", qty: [2], face: [4] },
    { type: "bid", qty: { valueOf: 2 }, face: 4 },
    { type: "x".repeat(10_000) },
    { type: "liar" },
    { type: "spot" },
  ];
  for (const a of junk) check(act(s, t, mover, a) === false, `junk rejected: ${JSON.stringify(a)?.slice(0, 40)}`);
  for (const id of [...t.ids, "spectator", "", "nobody"]) {
    if (id !== mover) check(act(s, t, id, { type: "bid", qty: 1, face: 2 }) === false, `${id} can't act out of turn`);
  }
  check(snap(s) === before, "junk changed nothing");
  bid(s, t, 1, 2);
  // Wrong phase: during the reveal and after the end.
  const caller = s.turn!;
  check(act(s, t, caller, { type: "liar" }) !== false, "liar accepted");
  check(s.phase === "reveal", "reveal");
  for (const id of t.ids) {
    check(act(s, t, id, { type: "bid", qty: 5, face: 6 }) === false, "no bids during the reveal");
    check(act(s, t, id, { type: "liar" }) === false, "no calls during the reveal");
  }
}

// ---------- Liar: caller wrong / caller right ----------

{
  const { s, t } = start(3, 9);
  s.starter = s.turn = "p0";
  toBid(s, t);
  setDice(s, { p0: [2, 2, 3, 4, 1], p1: [2, 5, 5, 6, 6], p2: [1, 3, 3, 4, 5] });
  // Twos (with ones): p0 3, p1 1, p2 1 = 5.
  bid(s, t, 5, 2); // p0, true
  check(act(s, t, "p1", { type: "liar" }) !== false, "p1 calls liar");
  const sd = s.showdown!;
  check(s.phase === "reveal" && sd.count === 5 && !sd.correct && sd.loser === "p1", "caller wrong loses a die");
  check(s.counts.p1 === 4 && s.counts.p0 === 5, "only the caller lost one");
  check(sd.hands.p1.length === 5 && sd.hands.p2.join("") === "13345", "hands at the call are in the showdown");
  check(s.stats.p0.held === 1 && s.stats.p1.calls === 1 && s.stats.p1.right === 0, "stats");
  // All dice are visible in everyone's view during the reveal.
  const v = view(s, t, "spectator");
  check(v.showdown !== null && v.showdown.hands.p0.join("") === "22341", "spectators see the reveal");
  check(v.turn === null && v.total === 15, "dice on the table at the showdown");
  endReveal(s, t);
  check(s.phase === "roll" && s.round === 2 && s.starter === "p1" && s.turn === "p1", "loser opens the next round");
  check(s.dice.p1.length === 4 && s.showdown === null && s.bids.length === 0, "rerolled, history cleared");
  const v2 = view(s, t, "p2");
  check(v2.showdown === null && v2.last !== null && v2.last.loser === "p1", "summary of the last showdown");
  check(!("hands" in (v2.last as object)), "the summary carries no dice");
}
{
  const { s, t } = start(3, 9);
  s.starter = s.turn = "p0";
  toBid(s, t);
  setDice(s, { p0: [2, 2, 3, 4, 1], p1: [2, 5, 5, 6, 6], p2: [1, 3, 3, 4, 5] });
  bid(s, t, 6, 2); // p0 bluffs: only 5
  check(act(s, t, "p1", { type: "liar" }) !== false, "p1 calls liar");
  check(s.showdown!.correct && s.showdown!.loser === "p0" && s.counts.p0 === 4, "bluffer loses a die");
  check(s.stats.p0.caught === 1 && s.stats.p1.right === 1, "stats on a caught bluff");
  endReveal(s, t);
  check(s.starter === "p0", "bluffer opens next");
}

// ---------- Spot on ----------

{
  // Exact: the caller gets a die back (up to the starting count).
  const { s, t } = start(3, 11);
  s.starter = s.turn = "p0";
  toBid(s, t);
  setDice(s, { p0: [6, 6, 1], p1: [6, 2, 2, 3, 4], p2: [5, 5, 5, 5, 5] });
  bid(s, t, 4, 6); // exactly 4 sixes (6,6,1,6)
  check(act(s, t, "p1", { type: "spot" }) !== false, "spot on accepted with 3 players");
  const sd = s.showdown!;
  check(sd.kind === "spot" && sd.correct && sd.loser === null && sd.gainer === null, "exact spot on");
  check(s.stats.p1.spots === 1 && s.stats.p1.right === 1, "spot-on stats");
  check(s.counts.p1 === 5 && s.counts.p0 === 3, "already at the starting count: no gain beyond it");
  endReveal(s, t);
  check(s.starter === "p1", "spot-on caller opens next");
}
{
  const { s, t } = start(3, 11);
  s.starter = s.turn = "p0";
  toBid(s, t);
  setDice(s, { p0: [5, 5, 5, 5, 5], p1: [6, 2, 1], p2: [6, 6, 3, 4, 2] });
  bid(s, t, 4, 6); // 6,1,6,6 = 4
  check(act(s, t, "p1", { type: "spot" }) !== false, "spot on");
  check(s.showdown!.gainer === "p1" && s.counts.p1 === 4, "caller gains a die back");
}
{
  const { s, t } = start(3, 11);
  s.starter = s.turn = "p0";
  toBid(s, t);
  setDice(s, { p0: [5, 5, 5, 5, 5], p1: [6, 2, 1, 3, 3], p2: [6, 6, 3, 4, 2] });
  bid(s, t, 3, 6); // there are 4
  check(act(s, t, "p1", { type: "spot" }) !== false, "spot on");
  check(!s.showdown!.correct && s.showdown!.loser === "p1" && s.counts.p1 === 4, "wrong spot on costs the caller");
}
{
  const { s, t } = start(2, 3);
  toBid(s, t);
  bid(s, t, 1, 2);
  check(act(s, t, s.turn!, { type: "spot" }) === false, "no spot on with 2 players");
  check(view(s, t, "p0").spotOk === false, "view says spot on is off");
}

// ---------- elimination, skipping, final ----------

{
  const { s, t, ends } = start(3, 21);
  s.starter = s.turn = "p0";
  toBid(s, t);
  setDice(s, { p0: [3, 3, 3], p1: [2], p2: [4, 4] });
  bid(s, t, 4, 2); // p0 bluffs (only 1 two)
  check(act(s, t, "p1", { type: "liar" }) !== false, "liar");
  check(s.counts.p0 === 2 && !s.out.length, "p0 down to 2");
  endReveal(s, t);
  toBid(s, t);
  check(s.turn === "p0", "p0 opens");
  setDice(s, { p0: [3, 3], p1: [2], p2: [4, 4] });
  bid(s, t, 2, 3); // true
  check(s.turn === "p1", "p1 next");
  check(act(s, t, "p1", { type: "liar" }) !== false, "p1 calls wrongly");
  check(s.counts.p1 === 0 && s.out[0] === "p1" && s.showdown!.out === "p1" && s.outRound.p1 === 2, "p1 is out");
  endReveal(s, t);
  check(s.starter === "p2" && s.dice.p1.length === 0, "next live player opens when the loser is out");
  toBid(s, t);
  check(view(s, t, "p0").spotOk === false, "spot on off with 2 left");
  setDice(s, { p0: [3, 3], p2: [4, 4] });
  bid(s, t, 1, 4); // p2
  check(s.turn === "p0", "p1 is skipped");
  bid(s, t, 2, 4); // p0
  check(s.turn === "p2", "back to p2, skipping p1");
  check(act(s, t, "p1", { type: "liar" }) === false, "knocked-out players can't act");
  check(view(s, t, "p1").mine!.length === 0, "knocked-out players hold nothing");
  check(act(s, t, "p2", { type: "liar" }) !== false, "p2 calls"); // 2 fours: p0 right, p2 loses
  check(s.counts.p2 === 1, "p2 down to 1");
  endReveal(s, t);
  toBid(s, t);
  setDice(s, { p0: [5, 5], p2: [6] });
  check(s.turn === "p2", "p2 opens");
  bid(s, t, 2, 6); // p2 bluffs
  check(act(s, t, "p0", { type: "liar" }) !== false, "p0 calls");
  check(s.counts.p2 === 0 && s.phase === "reveal", "final showdown still plays out");
  tick(s, t);
  check(s.lonelySince === null && view(s, t, "p0").lonelyAt === null, "no 'not enough players' countdown once decided");
  check(ends() === 0, "game not ended before the reveal finishes");
  endReveal(s, t);
  check(s.phase === "over" && ends() === 1, "ended once");
  const r = t.result!;
  check(r.winners.length === 1 && r.winners[0] === "p0", "last player with dice wins");
  check(r.headline === "Player0 wins Liar's Dice with 2 dice left", `headline: ${r.headline}`);
  check(r.scores!.p0 === 2 && r.scores!.p1 === 0, "scores = dice left");
  const v = view(s, t, "p1");
  check(v.winners![0] === "p0" && v.stats !== null && v.showdowns === 4 && v.out.join() === "p1,p2", "final view");
  check(v.showdown !== null && v.showdown.out === "p2", "final showdown kept");
  // Nothing moves after the end.
  const before = snap(s);
  for (const id of t.ids) {
    check(act(s, t, id, { type: "bid", qty: 1, face: 2 }) === false, "no actions after the end");
    check(act(s, t, id, { type: "liar" }) === false, "no calls after the end");
  }
  t.advance(120_000);
  check(tick(s, t) === false && snap(s) === before && ends() === 1, "ticks do nothing after the end");
  setConnected(s, t, "p0", false);
  t.advance(LONELY_MS + 1000);
  tick(s, t);
  check(ends() === 1, "still ended once");
}
{
  // "1 die left" headline.
  const { s, t } = start(2, 2);
  s.starter = s.turn = "p0";
  toBid(s, t);
  setDice(s, { p0: [4], p1: [2] });
  bid(s, t, 2, 4); // only 1 four
  check(act(s, t, "p1", { type: "liar" }) !== false, "liar");
  endReveal(s, t);
  check(t.result!.headline === "Player1 wins Liar's Dice with 1 die left", t.result!.headline);
}

// ---------- secrecy ----------

{
  const { s, t } = start(4, 33);
  const secret: Record<string, number[]> = { p0: [2, 2, 2, 2, 2], p1: [6, 6, 6, 6, 6], p2: [5, 5, 5, 5, 5], p3: [3, 3, 3, 3, 3] };
  setDice(s, secret);
  const leak = (v: unknown, id: string) => JSON.stringify(v).includes(secret[id].join(","));
  for (const phase of ["roll", "bid"] as const) {
    if (phase === "bid") {
      toBid(s, t);
      setDice(s, secret);
      bid(s, t, 1, 2);
    }
    for (const viewer of [...t.ids, "spectator"]) {
      const v = view(s, t, viewer);
      for (const id of t.ids) {
        if (id === viewer) {
          check(leak(v, id) && v.mine!.join(",") === secret[id].join(","), `${phase}: ${viewer} sees own dice`);
        } else {
          check(!leak(v, id), `${phase}: ${viewer} must not see ${id}'s dice`);
        }
      }
      check(v.showdown === null, `${phase}: no showdown before the reveal`);
      if (viewer === "spectator") check(v.mine === null && v.you === null, "spectators hold nothing");
    }
  }
  // State must not hide secrets in odd places either: only the dice map has them.
  const v = view(s, t, "spectator");
  check(!("dice" in v), "no dice map in the view");
}

// ---------- timeouts and auto-play ----------

{
  // Opening timeout: auto-bid on the favourite face, claiming what you hold.
  const { s, t } = start(3, 41);
  s.starter = s.turn = "p0";
  toBid(s, t);
  setDice(s, { p0: [4, 4, 1, 2, 6], p1: [2, 2, 2, 2, 2], p2: [3, 3, 3, 3, 3] });
  t.advance(TURN_MS - 1);
  check(!tick(s, t) && s.bids.length === 0, "not yet");
  t.advance(1);
  check(tick(s, t) === true, "timeout acts");
  const b = s.bids[0];
  check(b.by === "p0" && b.auto && b.face === 4 && b.qty === 3, `auto opening ${b.qty}x${b.face}`);
  check(s.turn === "p1" && s.endsAt === t.ctx.now() + TURN_MS, "next player gets a fresh timer");
}
{
  // Auto liar when the bid is far above what's likely.
  const { s, t } = start(3, 41);
  s.starter = s.turn = "p0";
  toBid(s, t);
  setDice(s, { p0: [4, 4, 1, 2, 6], p1: [2, 3, 3, 5, 6], p2: [3, 3, 3, 3, 3] });
  bid(s, t, 8, 2); // p1 holds 1 two; unknown 10 -> expects 1 + 3.33 + 1 = 5.3 < 8
  check(JSON.stringify(autoMove(s, "p1")) === '{"type":"liar"}', "auto calls liar on a wild bid");
  t.advance(TURN_MS);
  tick(s, t);
  check(s.phase === "reveal" && s.showdown!.caller === "p1" && s.showdown!.auto, "auto liar call");
}
{
  // Otherwise: the minimal raise on the most common non-one face.
  const { s, t } = start(3, 41);
  s.starter = s.turn = "p0";
  toBid(s, t);
  setDice(s, { p0: [4, 4, 1, 2, 6], p1: [5, 5, 3, 1, 2], p2: [3, 3, 3, 3, 3] });
  bid(s, t, 3, 6);
  check(JSON.stringify(autoMove(s, "p1")) === '{"type":"bid","qty":4,"face":5}', "raise qty when the face is lower");
}
{
  const { s, t } = start(3, 41);
  s.starter = s.turn = "p0";
  toBid(s, t);
  setDice(s, { p0: [4, 4, 1, 2, 6], p1: [5, 5, 3, 1, 2], p2: [3, 3, 3, 3, 3] });
  bid(s, t, 3, 4);
  check(JSON.stringify(autoMove(s, "p1")) === '{"type":"bid","qty":3,"face":5}', "same qty with a higher face");
  // Max bid: no raise possible -> liar.
  s.bids.push({ by: "p0", qty: 15, face: 6, auto: false });
  check(autoMove(s, "p1").type === "liar", "no raise left: call");
}

// ---------- disconnects ----------

{
  // A disconnected mover is auto-played after AWAY_MS.
  const { s, t } = start(3, 51);
  s.starter = s.turn = "p0";
  toBid(s, t);
  bid(s, t, 1, 3);
  setConnected(s, t, "p1", false);
  check(s.awayAt === t.ctx.now(), "away noticed");
  check(view(s, t, "p0").autoAt === t.ctx.now() + AWAY_MS, "view shows when the auto-play happens");
  t.advance(AWAY_MS - 1);
  check(!tick(s, t) && s.turn === "p1", "waits a moment");
  t.advance(1);
  check(tick(s, t) === true, "auto-played after 3s");
  check(s.turn !== "p1" || s.phase === "reveal", "p1's turn is over");
  check(s.bids.length === 2 || s.phase === "reveal", "p1 acted");
}
{
  // Disconnected when their turn comes up: away from the turn start.
  const { s, t } = start(3, 52);
  s.starter = s.turn = "p0";
  setConnected(s, t, "p1", false);
  toBid(s, t);
  bid(s, t, 1, 3);
  check(s.turn === "p1" && s.awayAt === t.ctx.now(), "away from the turn start");
  t.advance(AWAY_MS);
  check(tick(s, t) === true && (s.turn !== "p1" || s.phase === "reveal"), "auto-played");
  // Coming back mid-turn of someone else changes nothing; coming back on your turn clears the timer.
  setConnected(s, t, "p1", true);
  check(s.awayAt === null, "nobody away");
}
{
  // Returning before the auto-play cancels it.
  const { s, t } = start(3, 53);
  s.starter = s.turn = "p0";
  toBid(s, t);
  setConnected(s, t, "p0", false);
  t.advance(AWAY_MS - 500);
  tick(s, t);
  setConnected(s, t, "p0", true);
  check(s.awayAt === null, "back in time");
  t.advance(1000);
  check(!tick(s, t) && s.turn === "p0" && s.bids.length === 0, "no auto-play after returning");
  // Missed playerLeft hook: tick notices on its own.
  t.ctx.players[0].connected = false;
  check(tick(s, t) === true && s.awayAt !== null, "tick notices a silent disconnect");
  t.advance(AWAY_MS);
  check(tick(s, t) === true && s.bids.length === 1 && s.bids[0].auto, "and auto-plays");
}
{
  // Disconnects in roll and reveal don't stall anything.
  const { s, t } = start(3, 54);
  s.starter = s.turn = "p0";
  setConnected(s, t, "p2", false);
  toBid(s, t);
  bid(s, t, 1, 2);
  check(act(s, t, "p1", { type: "liar" }) !== false, "call");
  setConnected(s, t, "p0", false);
  endReveal(s, t);
  check(s.phase === "roll", "reveal ends with players away");
  setConnected(s, t, "p0", true);
  setConnected(s, t, "p2", true);
  toBid(s, t);
}
{
  // Everyone away: the game plays itself out (or ends after LONELY_MS), it never stalls.
  const { s, t, ends } = start(4, 55);
  for (const id of t.ids) setConnected(s, t, id, false);
  check(s.lonelySince !== null, "lonely noticed");
  for (let i = 0; i < 400 && s.phase !== "over"; i++) {
    t.advance(1000);
    tick(s, t);
  }
  check(s.phase === "over" && ends() === 1, "ends");
  check(t.result!.winners.length >= 1, "someone with the most dice wins");
}
{
  // 2 players, one leaves: the other wins after LONELY_MS.
  const { s, t, ends } = start(2, 56);
  toBid(s, t);
  setConnected(s, t, "p1", false);
  check(view(s, t, "p0").lonelyAt === t.ctx.now() + LONELY_MS, "view shows the countdown");
  t.advance(LONELY_MS - 1);
  tick(s, t);
  check(s.phase !== "over", "not yet");
  t.advance(1);
  tick(s, t);
  check(s.phase === "over" && ends() === 1 && t.result!.winners.join() === "p0", "the player who stayed wins");
  check(t.result!.headline === "Player0 wins Liar's Dice — everyone else left", t.result!.headline);
}
{
  // ... but not when they come back in time.
  const { s, t } = start(2, 57);
  toBid(s, t);
  setConnected(s, t, "p1", false);
  t.advance(LONELY_MS / 2);
  tick(s, t);
  setConnected(s, t, "p1", true);
  check(s.lonelySince === null, "lonely cleared");
  t.advance(LONELY_MS);
  tick(s, t);
  check(s.phase !== "over", "game goes on");
}
{
  // Knocked-out players leaving don't matter.
  const { s, t } = start(3, 58);
  s.counts.p2 = 0;
  s.dice.p2 = [];
  s.out.push("p2");
  setConnected(s, t, "p2", false);
  tick(s, t);
  check(s.lonelySince === null, "two players still here");
}

// ---------- full games, 2 to 8 players, random play ----------

for (let n = 2; n <= 8; n++) {
  for (let seed = 1; seed <= 12; seed++) {
    const { s, t, ends } = start(n, seed * 101 + n);
    let rand = seed;
    const r = () => ((rand = (rand * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let steps = 0;
    while (s.phase !== "over" && steps < 5000) {
      steps++;
      if (s.phase === "bid" && s.turn) {
        const who = s.turn;
        const prev = s.bids.length ? s.bids[s.bids.length - 1] : null;
        const x = r();
        let ok: boolean | void = false;
        if (prev && x < 0.25) ok = act(s, t, who, { type: "liar" });
        else if (prev && x < 0.32) ok = act(s, t, who, { type: "spot" });
        if (ok !== false) {
          // done
        } else if (x < 0.45) {
          // Let the timer play for them.
          t.advance(TURN_MS);
          tick(s, t);
          ok = true;
        } else {
          const mr = minRaise(prev, total(s));
          ok = mr ? act(s, t, who, { type: "bid", qty: mr.qty + (r() < 0.3 ? 1 : 0), face: mr.face }) : false;
          if (ok === false && mr) ok = act(s, t, who, { type: "bid", qty: mr.qty, face: mr.face });
          if (ok === false) ok = act(s, t, who, { type: "liar" });
        }
        check(ok !== false, "some move is always possible");
      } else {
        t.advance(500);
        tick(s, t);
      }
      // Invariants
      const tot = total(s);
      check(tot >= 1, "dice left");
      for (const id of s.order) check(s.counts[id] >= 0 && s.counts[id] <= s.startDice, "counts in range");
      const v = view(s, t, s.order[0]);
      check(JSON.stringify(v).length < 6000, "view stays small");
    }
    check(s.phase === "over", `${n}p seed ${seed}: game finishes`);
    check(ends() === 1, "ended exactly once");
    const res = t.result!;
    check(res.winners.length === 1, "one winner");
    const w = res.winners[0];
    check(s.counts[w] > 0 && s.order.filter((id) => s.counts[id] > 0).length === 1, "winner is the last with dice");
    check(s.out.length === n - 1 && !s.out.includes(w), "everyone else knocked out in order");
    check(res.headline.startsWith(`${t.ctx.player(w)!.name} wins Liar's Dice with`), "headline");
    JSON.parse(JSON.stringify(view(s, t, "spectator")));
  }
}

// ---------- host settings ----------
{
  const t = makeTestCtx(3, 7, { dice: 3, turnMs: 15_000 });
  const s: LiarsState = game.setup(t.ctx);
  check(s.startDice === 3 && s.order.every((id) => s.counts[id] === 3 && s.dice[id].length === 3), "3 starting dice");
  toBid(s, t);
  check(s.endsAt - t.ctx.now() === 15_000 && view(s, t, s.order[0]).timerMs === 15_000, "15s turn timer");
  t.advance(15_000);
  tick(s, t);
  check(s.bids.length === 1 && s.bids[0].auto, "timer runs out after 15s");
  const d = makeTestCtx(3, 7, { dice: 99, turnMs: 1 });
  const s2: LiarsState = game.setup(d.ctx);
  check(s2.startDice === 5 && s2.turnMs === TURN_MS, "invalid settings fall back to the defaults");
  const big: LiarsState = game.setup(makeTestCtx(8, 7, { dice: 6 }).ctx);
  check(big.startDice === 6, "6 dice even with 8 players");
}

// ---------- practice bots ----------
{
  for (const [n, bots, seed] of [
    [4, 4, 1],
    [3, 2, 2],
    [6, 5, 3],
    [2, 1, 4],
  ] as const) {
    const t = makeTestCtx(n, seed, {}, bots);
    const s: LiarsState = game.setup(t.ctx);
    let botMoves = 0;
    let autos = 0;
    for (let i = 0; i < 20_000 && !t.result; i++) {
      t.advance(200);
      tick(s, t);
      for (const id of s.order) {
        if (!t.ctx.player(id)?.bot) continue;
        const a = game.bot!(s, id, t.ctx);
        if (a == null) continue;
        check(s.turn === id, "bots only move on their turn");
        const before = s.bids.length;
        check(act(s, t, id, a) !== false, `bot move is legal: ${JSON.stringify(a)}`);
        botMoves++;
        if (s.phase === "bid") check(s.bids.length === before + 1, "a bid was placed");
      }
    }
    for (const sd of s.log) if (sd.auto) autos++;
    for (const b of s.bids) if (b.auto) autos++;
    check(t.result !== null && s.phase === "over", `${n}p with ${bots} bots: game finishes`);
    check(botMoves > 5, "bots played");
    if (bots === n) check(autos === 0 && s.log.every((x) => !x.auto), "all-bot games never need the timer");
  }
  // Bots think before acting, and never act on someone else's turn.
  const t = makeTestCtx(3, 9, {}, 2);
  const s: LiarsState = game.setup(t.ctx);
  toBid(s, t);
  for (const id of s.order) if (id !== s.turn && id.startsWith("bot-")) check(game.bot!(s, id, t.ctx) == null, "not my turn");
  if (s.turn?.startsWith("bot-")) {
    check(game.bot!(s, s.turn, t.ctx) == null, "first look: thinking");
    t.advance(300);
    check(game.bot!(s, s.turn, t.ctx) == null, "still thinking after 0.3s");
    t.advance(3_000);
    check(game.bot!(s, s.turn, t.ctx) != null, "acts within a few seconds");
  }
  // Bots call an obviously impossible bid.
  const v = { phase: "bid", turn: "bot-0", you: "bot-0", mine: [2, 3, 4, 5, 6], total: 10, spotOk: false, bids: [{ by: "p0", qty: 9, face: 6, auto: false }] } as unknown as LiarsView;
  check(botMove(v, () => 0.5)?.type === "liar", "bot calls a wild bid");
}

console.log("✓ liars tests passed");
