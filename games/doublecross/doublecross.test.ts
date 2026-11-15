import { assert, makeTestCtx } from "../../shared/testing";
import game, { makeTables, resultMs, type DcState } from "./server";
import {
  AWAY_END_MS,
  CHOOSE_MS,
  DRUM_MS,
  HEIST_TALK_MS,
  KEEP_MSGS,
  MAX_MSG,
  PAIR_POTS,
  QUICK,
  ROUNDS,
  SAY_BURST,
  SIT_OUT_MS,
  TALK_MS,
  awards,
  heistPot,
  settle,
  tallies,
  type Choice,
  type DcEvent,
  type DcView,
  type RoundRec,
} from "./shared";

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

const view = (s: DcState, id: string, t: T) => game.view(s, id, t.ctx) as DcView;
const json = (s: DcState, id: string, t: T) => JSON.stringify(game.view(s, id, t.ctx));
const act = (s: DcState, t: T, seat: number, a: unknown) => game.action(s, s.order[seat], a as never, t.ctx);
const seated = (s: DcState) => s.tables.flatMap((tb) => tb.seats);
// Read through functions so assertion narrowing doesn't freeze these fields for the type checker.
const ph = (s: DcState): string => s.phase;
const stp = (s: DcState): number => s.step;
const rnd = (s: DcState): number => s.round;
const nTables = (s: DcState): number => s.tables.length;

/** Jump to the current deadline and tick once. */
function expire(t: T, s: DcState) {
  t.advance(Math.max(0, s.endsAt - t.ctx.now()));
  return game.tick!(s, t.ctx);
}

function setOnline(t: T, s: DcState, seat: number, on: boolean) {
  const p = t.ctx.players.find((x) => x.id === s.order[seat])!;
  p.connected = on;
  if (on) game.playerReturned!(s, p.id, t.ctx);
  else game.playerLeft!(s, p.id, t.ctx);
}

/** Play one whole round from its talk phase: `pick` decides each seated seat's choice (null = no choice). */
function playRound(t: T, s: DcState, pick: (seat: number) => Choice | null) {
  assert(ph(s) === "talk", `round ${rnd(s)} starts in talk (got ${ph(s)})`);
  expire(t, s);
  assert(ph(s) === "choose", "talk -> choose on the timer");
  for (const seat of seated(s)) {
    const c = pick(seat);
    if (c) act(s, t, seat, { type: "choose", c });
  }
  if (ph(s) === "choose") expire(t, s);
  assert(ph(s) === "reveal" && stp(s) === 0, "choose -> drumroll");
  expire(t, s);
  assert(ph(s) === "reveal" && stp(s) === 1, "drumroll -> flip");
  const rec = s.history[s.history.length - 1];
  assert(rec.round === rnd(s), "the flipped round is recorded");
  expire(t, s);
  return rec;
}

const sumGains = (history: RoundRec[], seats: number) => {
  const out = Array.from({ length: seats }, () => 0);
  for (const r of history) for (const tb of r.tables) tb.seats.forEach((seat, i) => (out[seat] += tb.gain[i]));
  return out;
};

// ---------- settle(): the payout rules ----------
{
  const d = settle(["split", "split"], 8);
  assert(d.out === "deal" && d.gain.join() === "4,4", "both split: half each");
  const st = settle(["steal", "split"], 8);
  assert(st.out === "steal" && st.gain.join() === "8,0", "one thief takes the pot");
  const b = settle(["steal", "steal"], 8);
  assert(b.out === "bust" && b.gain.join() === "0,0", "two thieves: nothing");
  const trio = settle(["split", "split", "split"], 12);
  assert(trio.out === "deal" && trio.gain.join() === "4,4,4", "trio splits three ways");
  const trio1 = settle(["split", "steal", "split"], 12);
  assert(trio1.out === "steal" && trio1.gain.join() === "0,12,0", "trio: lone thief takes all");
  const trio2 = settle(["steal", "steal", "split"], 12);
  assert(trio2.out === "bust" && trio2.gain.join() === "0,0,0", "trio: two thieves bust");
  assert(heistPot(3) === 30 && heistPot(4) === 32 && heistPot(7) === 28 && heistPot(10) === 30, "heist pot splits evenly");
}

// ---------- full 4-player game: timers, pairings, scores, end ----------
{
  const t = makeTestCtx(4, 7);
  const ends = countEnds(t);
  const s: DcState = game.setup(t.ctx);
  assert(rnd(s) === 1 && ph(s) === "talk", "starts in round 1 talk");
  assert(s.endsAt - t.ctx.now() === TALK_MS, "talk lasts TALK_MS");
  assert(nTables(s) === 2 && s.tables.every((tb) => tb.seats.length === 2), "4 players = 2 pairs");
  assert(s.tables.every((tb) => tb.pot === PAIR_POTS[0]), "round 1 pot");

  // Phase timings, step by step for round 1.
  t.advance(TALK_MS - 1);
  assert(game.tick!(s, t.ctx) === false && ph(s) === "talk", "talk holds until its deadline");
  t.advance(1);
  assert(game.tick!(s, t.ctx) === true && ph(s) === "choose", "talk -> choose");
  assert(s.endsAt - t.ctx.now() === CHOOSE_MS, "choose lasts CHOOSE_MS");
  act(s, t, 0, { type: "choose", c: "steal" });
  t.advance(CHOOSE_MS);
  game.tick!(s, t.ctx);
  assert(ph(s) === "reveal" && stp(s) === 0 && s.endsAt - t.ctx.now() === DRUM_MS, "choose -> drumroll");
  assert(s.scores.every((x) => x === 0), "no points before the flip");
  t.advance(DRUM_MS);
  game.tick!(s, t.ctx);
  assert(stp(s) === 1 && s.history.length === 1, "drumroll -> flip");
  const r1 = s.history[0];
  const t0 = r1.tables.find((tb) => tb.seats.includes(0))!;
  const i0 = t0.seats.indexOf(0);
  assert(t0.c[i0] === "steal" && t0.out === "steal" && t0.gain[i0] === PAIR_POTS[0], "seat 0 stole the pot");
  assert(t0.auto[1 - i0] === true && t0.c[1 - i0] === "split", "no choice counts as split (auto)");
  assert(s.endsAt - t.ctx.now() === resultMs(false, 2), "results stay up");
  expire(t, s);
  assert(rnd(s) === 2 && ph(s) === "talk", "next round");

  // Rounds 2-5: seat 0 always steals, everyone else splits.
  const seen = new Set<string>();
  for (const tb of r1.tables) seen.add(tb.seats.slice().sort().join("-"));
  for (let r = 2; r <= 5; r++) {
    assert(s.tables.every((tb) => tb.pot === PAIR_POTS[r - 1]), `round ${r} pot`);
    if (r <= 3) {
      for (const tb of s.tables) {
        const key = tb.seats.slice().sort().join("-");
        assert(!seen.has(key), `round ${r}: no repeat pair (${key})`);
        seen.add(key);
      }
    }
    playRound(t, s, (seat) => (seat === 0 ? "steal" : "split"));
  }
  // The heist: everyone at one table, pot 32.
  assert(rnd(s) === ROUNDS && ph(s) === "talk", "round 6 is the heist");
  assert(nTables(s) === 1 && s.tables[0].seats.length === 4 && s.tables[0].pot === 32, "one heist table");
  assert(s.endsAt - t.ctx.now() === HEIST_TALK_MS, "heist talk is shorter");
  const v = view(s, s.order[2], t);
  assert(v.heist && v.me!.table === 0, "heist view");
  const heist = playRound(t, s, () => "split");
  assert(heist.heist && heist.tables[0].out === "deal" && heist.tables[0].gain.every((g) => g === 8), "all split the heist: 8 each");

  assert(ph(s) === "final" && t.result, "game over after the heist");
  assert(ends() === 1, "ctx.end exactly once");
  const totals = sumGains(s.history, 4);
  assert(totals.join() === s.scores.join(), "scores add up from the history");
  const scores = t.result.scores!;
  for (let seat = 0; seat < 4; seat++) assert(scores[s.order[seat]] === s.scores[seat], "result scores");
  const best = Math.max(...s.scores);
  const winners = s.order.filter((_, seat) => s.scores[seat] === best);
  assert(t.result.winners.join() === winners.join(), "top scorer wins");
  assert(t.result.headline.includes("Player0"), `headline names the winner: ${t.result.headline}`);
  // Nothing moves after the end.
  assert(act(s, t, 1, { type: "ready", v: true }) === false, "no actions after the end");
  assert(act(s, t, 1, { type: "say", t: "hello?" }) === false, "no chat after the end");
  t.advance(60_000);
  assert(game.tick!(s, t.ctx) === false, "no ticks after the end");
  assert(ends() === 1, "still one end");
  const fv = view(s, "spectator", t);
  assert(fv.phase === "final" && fv.endsAt === null && fv.history.length === ROUNDS, "final view");
}

// ---------- 3 players: the trio every round ----------
{
  const t = makeTestCtx(3, 11);
  const ends = countEnds(t);
  const s: DcState = game.setup(t.ctx);
  assert(nTables(s) === 1 && s.tables[0].seats.length === 3, "3 players = one trio");
  assert(s.tables[0].pot === (PAIR_POTS[0] / 2) * 3, "trio pot is 1.5x");
  const r1 = playRound(t, s, () => "split");
  assert(r1.tables[0].gain.every((g) => g === PAIR_POTS[0] / 2), "trio split pays the same per head as a pair");
  const r2 = playRound(t, s, (seat) => (seat === 1 ? "steal" : "split"));
  const i1 = r2.tables[0].seats.indexOf(1);
  assert(r2.tables[0].out === "steal" && r2.tables[0].gain[i1] === (PAIR_POTS[1] / 2) * 3, "trio thief takes the whole pot");
  const r3 = playRound(t, s, (seat) => (seat === 2 ? "split" : "steal"));
  assert(r3.tables[0].out === "bust" && r3.tables[0].gain.every((g) => g === 0), "two trio thieves bust");
  playRound(t, s, () => null);
  playRound(t, s, () => "split");
  assert(rnd(s) === ROUNDS && s.tables[0].pot === 30, "3-player heist pot is 30");
  const h = playRound(t, s, (seat) => (seat === 0 ? "steal" : "split"));
  assert(h.tables[0].out === "steal" && h.tables[0].gain[h.tables[0].seats.indexOf(0)] === 30, "lone heist thief takes 30");
  assert(t.result && ends() === 1, "3-player game ends once");
  assert(sumGains(s.history, 3).join() === s.scores.join(), "trio scores add up");
}

// ---------- odd and max counts: tables, trio rotation, no repeats ----------
{
  const t = makeTestCtx(5, 3);
  const s: DcState = game.setup(t.ctx);
  const sizes = s.tables.map((tb) => tb.seats.length).sort();
  assert(sizes.join() === "2,3", "5 players = a pair and a trio");
  const trioSeats: number[] = [];
  for (let r = 1; r <= 5; r++) {
    trioSeats.push(...s.tables.find((tb) => tb.seats.length === 3)!.seats);
    assert(s.tables.find((tb) => tb.seats.length === 3)!.pot === (PAIR_POTS[r - 1] / 2) * 3, "trio pot each round");
    playRound(t, s, () => "split");
  }
  // 5 trios of 3 = 15 slots over 5 seats: trio duty should be spread (nobody more than 4 times).
  const duty = [0, 1, 2, 3, 4].map((seat) => trioSeats.filter((x) => x === seat).length);
  assert(Math.max(...duty) <= 4, `trio duty spread: ${duty.join()}`);
  assert(nTables(s) === 1 && s.tables[0].seats.length === 5 && s.tables[0].pot === 30, "5-player heist");
  const h = playRound(t, s, (seat) => (seat < 2 ? "steal" : "split"));
  assert(h.tables[0].out === "bust" && h.tables[0].gain.every((g) => g === 0), "two heist thieves: nobody gets anything");
}
{
  const t = makeTestCtx(10, 5);
  const ends = countEnds(t);
  const s: DcState = game.setup(t.ctx);
  assert(nTables(s) === 5 && s.tables.every((tb) => tb.seats.length === 2), "10 players = 5 pairs");
  const pairs = new Set<string>();
  let repeats = 0;
  for (let r = 1; r <= 5; r++) {
    for (const tb of s.tables) {
      const key = tb.seats.slice().sort((a, b) => a - b).join("-");
      if (pairs.has(key)) repeats++;
      pairs.add(key);
    }
    playRound(t, s, (seat) => (seat % 3 === 0 ? "steal" : "split"));
  }
  assert(repeats === 0, `10 players: no repeat pairs over 5 rounds (${repeats})`);
  assert(s.tables[0].seats.length === 10, "10-player heist");
  // Exercise the heist chat at max size, then measure the biggest view.
  for (let i = 0; i < 40; i++) {
    t.advance(800);
    act(s, t, i % 10, { type: "say", t: `message number ${i} with some padding text to look like a real chat line` });
  }
  assert(s.tables[0].msgs.length === KEEP_MSGS, "only the last messages are kept");
  const size = json(s, s.order[0], t).length;
  assert(size < 7000, `10-player heist view stays small (${size} bytes)`);
  playRound(t, s, () => "split");
  assert(t.result && ends() === 1, "10-player game ends");
  const endSize = json(s, s.order[0], t).length;
  console.log(`  view sizes at 10 players: heist ${size} B, final ${endSize} B`);
}
{
  // makeTables directly: 4 players can avoid repeats for 3 rounds; 2 and 3 make a single table.
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  assert(makeTables([0, 1], [], [], rnd).length === 1, "two seats = one pair");
  assert(makeTables([4, 7, 9], [], [], rnd)[0].length === 3, "three seats = one trio");
  const met = [0, 1, 2, 3, 4, 5].map(() => [0, 0, 0, 0, 0, 0]);
  const tb = makeTables([0, 1, 2, 3, 4, 5], met, [0, 0, 0, 0, 0, 0], rnd);
  assert(tb.length === 3 && tb.flat().sort().join() === "0,1,2,3,4,5", "everyone seated exactly once");
}

// ---------- secrecy: private chat ----------
{
  const t = makeTestCtx(5, 9);
  const s: DcState = game.setup(t.ctx);
  const tableOf = (seat: number) => s.tables.find((tb) => tb.seats.includes(seat))!;
  const mine = tableOf(0);
  const outsiders = [0, 1, 2, 3, 4].filter((seat) => !mine.seats.includes(seat));
  assert(outsiders.length > 0, "someone sits elsewhere");
  const SECRET = "I will totally split zebra-42";
  t.events.length = 0;
  assert(act(s, t, 0, { type: "say", t: SECRET, n: 77 }) === false, "chat returns false (events only)");
  assert(act(s, t, mine.seats[1], { type: "say", q: 1 }) === false, "quick phrase");
  // Events: the words only go to the table, by name.
  for (const e of t.events) {
    const ev = e.event as DcEvent;
    const raw = JSON.stringify(e.event);
    if (ev.k === "msg") {
      assert(e.to !== undefined && mine.seats.some((seat) => s.order[seat] === e.to), "chat lines go only to table members");
    } else {
      assert(!raw.includes("zebra") && !raw.includes('"q"'), `public events carry no content: ${raw}`);
    }
  }
  const msgTo = t.events.filter((e) => (e.event as DcEvent).k === "msg").map((e) => e.to);
  assert(msgTo.length === mine.seats.length * 2, "each line reaches every member once");
  const echo = t.events.find((e) => (e.event as DcEvent).k === "msg" && e.to === s.order[0])!.event as Extract<DcEvent, { k: "msg" }>;
  assert(echo.m.n === 77 && echo.m.t === SECRET, "sender gets their nonce echoed");
  // Views: members see it, outsiders and spectators never do.
  for (const seat of mine.seats) assert(json(s, s.order[seat], t).includes("zebra-42"), "table members see the line");
  for (const seat of outsiders) {
    const raw = json(s, s.order[seat], t);
    assert(!raw.includes("zebra-42") && !raw.includes('"q":1'), "other tables never see it");
  }
  assert(!json(s, "spectator", t).includes("zebra"), "spectators never see it");
  assert(view(s, "spectator", t).me === null, "spectators have no seat");
  assert(view(s, s.order[outsiders[0]], t).chatter[s.tables.indexOf(mine)] === 2, "outsiders only see the activity count");
  // The chat stays private through choose, reveal and the flip.
  expire(t, s);
  for (const seat of outsiders) assert(!json(s, s.order[seat], t).includes("zebra"), "still private in choose");
  expire(t, s);
  expire(t, s);
  assert(ph(s) === "reveal" && stp(s) === 1, "flipped");
  for (const seat of outsiders) assert(!json(s, s.order[seat], t).includes("zebra"), "still private after the flip");
  assert(!json(s, "spectator", t).includes("zebra"), "spectators never, even after the flip");
  expire(t, s);
  assert(rnd(s) === 2 && !json(s, s.order[0], t).includes("zebra"), "a new round starts with a clean chat");

  // Hostile chat input.
  assert(act(s, t, 0, { type: "say", t: "x".repeat(5000) }) === false, "long text is capped, not stored whole");
  const last = tableOf(0).msgs[tableOf(0).msgs.length - 1];
  assert(last.t!.length === MAX_MSG, "text capped at MAX_MSG");
  const before = tableOf(0).msgs.length;
  for (const bad of [
    { type: "say" },
    { type: "say", t: "" },
    { type: "say", t: "   \u0000\u0007\u200b  " },
    { type: "say", t: ["array"] },
    { type: "say", t: 42 },
    { type: "say", q: QUICK.length },
    { type: "say", q: -1 },
    { type: "say", q: 1.5 },
    { type: "say", q: "1" },
  ]) {
    assert(act(s, t, 0, bad) === false, `rejects ${JSON.stringify(bad)}`);
  }
  assert(tableOf(0).msgs.length === before, "junk never lands");
  t.advance(10_000);
  act(s, t, 0, { type: "say", t: "a\tb\n\nc\u202e  d" });
  assert(tableOf(0).msgs[tableOf(0).msgs.length - 1].t === "a b c d", "whitespace collapsed, controls stripped");
  // Flood guard.
  t.advance(10_000);
  t.events.length = 0;
  for (let i = 0; i < SAY_BURST + 3; i++) act(s, t, 0, { type: "say", t: `spam ${i}`, n: 1000 + i });
  const nopes = t.events.filter((e) => (e.event as DcEvent).k === "nope");
  assert(nopes.length === 3 && nopes.every((e) => e.to === s.order[0]), "floods are refused privately");
  // Chat is closed outside talk.
  expire(t, s);
  assert(ph(s) === "choose", "choose");
  t.events.length = 0;
  assert(act(s, t, 0, { type: "say", t: "too late", n: 5 }) === false, "no chat in choose");
  assert(t.events.length === 1 && (t.events[0].event as DcEvent).k === "nope", "late message refused");
  assert(!tableOf(0).msgs.some((m) => m.t === "too late"), "late message not stored");
}

// ---------- secrecy: choices until the flip ----------
{
  const t = makeTestCtx(4, 13);
  const s: DcState = game.setup(t.ctx);
  expire(t, s);
  assert(ph(s) === "choose", "choose");
  t.events.length = 0;
  const rev0 = view(s, "spectator", t).rev;
  assert(act(s, t, 0, { type: "choose", c: "steal" }) === false, "a lock is a tiny event, not a broadcast");
  assert(t.events.length === 2, "a private pick ack and a public lock event");
  const pickEv = t.events.find((e) => (e.event as DcEvent).k === "pick")!;
  const lockEv = t.events.find((e) => (e.event as DcEvent).k === "lock")!;
  assert(pickEv.to === s.order[0], "what you picked goes only to you");
  assert(lockEv.to === undefined && !JSON.stringify(lockEv.event).includes("steal"), "everyone hears who locked, never what");
  assert((lockEv.event as Extract<DcEvent, { k: "lock" }>).x > rev0, "lock events are newer than the last view");
  t.events.length = 0;
  const partner = s.tables.find((tb) => tb.seats.includes(0))!.seats.find((x) => x !== 0)!;
  for (const id of [...s.order.filter((_, seat) => seat !== 0), "spectator"]) {
    const raw = json(s, id, t);
    assert(!raw.includes("steal"), `choice hidden from ${id}`);
    const v = view(s, id, t);
    assert(v.locked[0] === true, "but everyone sees seat 0 locked in");
  }
  assert(view(s, s.order[0], t).me!.choice === "steal", "you see your own choice");
  // Switching is secret: no broadcast, a private ack.
  assert(act(s, t, 0, { type: "choose", c: "split" }) === false, "switching returns false");
  assert(act(s, t, 0, { type: "choose", c: "split" }) === false, "same choice again is a no-op");
  assert(t.events.length === 1 && t.events[0].to === s.order[0], "switch ack goes only to the chooser");
  act(s, t, 0, { type: "choose", c: "steal" });
  act(s, t, partner, { type: "choose", c: "steal" });
  // Last lock flips straight to the drumroll, still secret.
  for (const seat of [0, 1, 2, 3]) if (s.choice[seat] === null) act(s, t, seat, { type: "choose", c: "split" });
  assert(ph(s) === "reveal" && stp(s) === 0, "everyone locked: drumroll right away");
  const others = [0, 1, 2, 3].filter((seat) => seat !== 0 && seat !== partner);
  for (const id of [...others.map((seat) => s.order[seat]), "spectator"]) {
    assert(!json(s, id, t).includes("steal"), `hidden during the drumroll from ${id}`);
  }
  const pv = view(s, s.order[partner], t);
  assert(pv.me!.choice === "steal" && pv.history.length === 0, "your partner only sees their own pick");
  expire(t, s);
  assert(json(s, "spectator", t).includes("steal"), "public after the flip");
  const rec = s.history[0].tables.find((tb) => tb.seats.includes(0))!;
  assert(rec.out === "bust", "both stole: bust");
}

// ---------- ready / early advance / hostile actions ----------
{
  const t = makeTestCtx(4, 21);
  const s: DcState = game.setup(t.ctx);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hostile: any[] = [
    null,
    undefined,
    42,
    "ready",
    [],
    [{ type: "ready", v: true }],
    {},
    { type: "ready" },
    { type: "ready", v: "true" },
    { type: "ready", v: 1 },
    { type: "choose", c: "split" },
    { type: "choose", c: "STEAL" },
    { type: "__proto__" },
    { type: "constructor" },
    { type: "lock" },
    { type: "pick", option: 999 },
  ];
  for (const a of hostile) assert(act(s, t, 0, a) === false, `rejects ${JSON.stringify(a)}`);
  assert(game.action(s, "stranger", { type: "ready", v: true }, t.ctx) === false, "non-player rejected");
  assert(game.action(s, "spectator", { type: "say", t: "hi" }, t.ctx) === false, "spectator can't chat");
  assert(ph(s) === "talk" && s.ready.every((r) => !r), "nothing changed");

  t.events.length = 0;
  assert(act(s, t, 0, { type: "ready", v: true }) === false && s.ready[0], "ready (a tiny event, no broadcast)");
  const rv = t.events[0]?.event as Extract<DcEvent, { k: "ready" }>;
  assert(t.events.length === 1 && rv.k === "ready" && rv.s === 0 && rv.v === true && t.events[0].to === undefined, "public ready event");
  assert(act(s, t, 0, { type: "ready", v: true }) === false && t.events.length === 1, "ready twice is a no-op");
  assert(act(s, t, 0, { type: "ready", v: false }) === false && !s.ready[0], "unready");
  assert((t.events[1].event as Extract<DcEvent, { k: "ready" }>).x > rv.x, "ready events are ordered");
  for (const seat of [0, 1, 2]) act(s, t, seat, { type: "ready", v: true });
  assert(ph(s) === "talk", "still waiting on one");
  assert(view(s, "spectator", t).ready.filter(Boolean).length === 3, "ready flags are public");
  assert(act(s, t, 3, { type: "ready", v: true }) === true, "the last ready broadcasts the new phase");
  assert(ph(s) === "choose", "everyone ready: straight to the choice");
  assert(act(s, t, 0, { type: "ready", v: false }) === false, "ready is talk-only");
  for (const a of [{ type: "choose" }, { type: "choose", c: null }, { type: "choose", c: ["steal"] }, { type: "choose", c: "both" }]) {
    assert(act(s, t, 1, a) === false, `rejects ${JSON.stringify(a)}`);
  }
  for (const seat of [0, 1, 2, 3]) act(s, t, seat, { type: "choose", c: "split" });
  assert(ph(s) === "reveal" && stp(s) === 0, "everyone chose: early reveal");
  assert(act(s, t, 0, { type: "choose", c: "steal" }) === false, "no choosing during the reveal");
  expire(t, s);
  assert(s.history[0].tables.every((tb) => tb.out === "deal" && tb.auto.every((a) => !a)), "all deals, none auto");
}

// ---------- disconnects in every phase ----------
{
  const t = makeTestCtx(4, 31);
  const ends = countEnds(t);
  const s: DcState = game.setup(t.ctx);
  // Talk: an offline player doesn't block "everyone ready".
  setOnline(t, s, 3, false);
  for (const seat of [0, 1, 2]) act(s, t, seat, { type: "ready", v: true });
  assert(ph(s) === "choose", "offline player skipped for ready");
  // Choose: offline player auto-splits, the rest lock -> reveal.
  for (const seat of [0, 1, 2]) act(s, t, seat, { type: "choose", c: "split" });
  assert(ph(s) === "reveal", "offline player skipped for choosing");
  expire(t, s);
  const t3 = s.history[0].tables.find((tb) => tb.seats.includes(3))!;
  assert(t3.auto[t3.seats.indexOf(3)] && t3.c[t3.seats.indexOf(3)] === "split", "offline = split");
  // Away longer than SIT_OUT_MS when the next round starts: sits out.
  t.advance(SIT_OUT_MS);
  expire(t, s);
  assert(rnd(s) === 2 && s.sitting.includes(3) && !seated(s).includes(3), "long-gone player sits out");
  assert(nTables(s) === 1 && s.tables[0].seats.length === 3, "the other three form a trio");
  const v3 = view(s, s.order[3], t);
  assert(v3.me!.table === -1 && v3.me!.msgs.length === 0, "sitting out: no table, no chat");
  assert(act(s, t, 3, { type: "ready", v: true }) === false, "sitting out can't act");
  // Comes back mid-round: still sitting out this round, dealt in next round.
  setOnline(t, s, 3, true);
  const r2 = playRound(t, s, () => "split");
  assert(r2.sitting.includes(3), "history remembers who sat out");
  assert(seated(s).includes(3) && nTables(s) === 2, "back in for round 3");
  // A quick refresh at the round start doesn't cost a round.
  expire(t, s);
  expire(t, s);
  expire(t, s);
  assert(rnd(s) === 3 && stp(s) === 1, "round 3 flipped");
  setOnline(t, s, 1, false);
  t.advance(1000);
  expire(t, s);
  assert(rnd(s) === 4 && seated(s).includes(1), "briefly away = still dealt in");
  setOnline(t, s, 1, true);
  // Reveal: disconnects mid-reveal don't stall it.
  expire(t, s);
  for (const seat of seated(s)) act(s, t, seat, { type: "choose", c: "split" });
  setOnline(t, s, 2, false);
  expire(t, s);
  assert(stp(s) === 1, "flip happens with someone offline");
  setOnline(t, s, 2, true);
  expire(t, s);
  assert(rnd(s) === 5 && ph(s) === "talk", "round 5");
  // Too few online for AWAY_END_MS: the game ends early with standings.
  setOnline(t, s, 1, false);
  setOnline(t, s, 2, false);
  setOnline(t, s, 3, false);
  assert(s.awaySince !== null, "away countdown");
  assert(view(s, s.order[0], t).awayEndsAt === s.awaySince! + AWAY_END_MS, "countdown in the view");
  t.advance(AWAY_END_MS - 1000);
  game.tick!(s, t.ctx);
  assert(ph(s) !== "final", "not yet");
  setOnline(t, s, 2, true);
  assert(s.awaySince === null, "someone came back: countdown off");
  setOnline(t, s, 2, false);
  t.advance(AWAY_END_MS);
  game.tick!(s, t.ctx);
  assert(ph(s) === "final" && s.endedEarly && t.result, "ended early");
  assert(t.result.headline.startsWith("Too few players left"), "headline says why");
  assert(ends() === 1, "one end");
  t.advance(60_000);
  game.tick!(s, t.ctx);
  setOnline(t, s, 1, true);
  assert(ends() === 1, "still one end");
}
{
  // Everyone else gone at a round start: ends early instead of seating one player alone.
  const t = makeTestCtx(3, 2);
  const ends = countEnds(t);
  const s: DcState = game.setup(t.ctx);
  setOnline(t, s, 1, false);
  setOnline(t, s, 2, false);
  expire(t, s);
  expire(t, s);
  expire(t, s);
  t.advance(SIT_OUT_MS);
  expire(t, s);
  assert(ph(s) === "final" && s.endedEarly && ends() === 1, "one player left: game over");
}

// ---------- awards ----------
{
  const tb = (seats: number[], c: Choice[], pot = 4) => ({ seats, pot, c, auto: c.map(() => false), ...settle(c, pot) });
  const history: RoundRec[] = [
    { round: 1, heist: false, sitting: [], tables: [tb([0, 1], ["steal", "split"]), tb([2, 3], ["split", "split"])] },
    { round: 2, heist: false, sitting: [], tables: [tb([0, 2], ["steal", "split"], 6), tb([1, 3], ["split", "split"], 6)] },
    { round: 3, heist: false, sitting: [], tables: [tb([0, 3], ["steal", "steal"], 8), tb([1, 2], ["split", "split"], 8)] },
  ];
  const tl = tallies(history, 4);
  assert(tl[0].steals === 3 && tl[0].heists === 2 && tl[0].stolen === 10 && tl[0].busts === 1, "tallies for the thief");
  assert(tl[1].burned === 1 && tl[1].splits === 3, "tallies for the trusting");
  const aw = awards(history, 4);
  const get = (k: string) => aw.find((a) => a.key === k)!;
  assert(get("backstabber").seats.join() === "0", "backstabber");
  assert(get("saint").seats.join() === "1,2", `saints tie: ${get("saint").seats.join()}`);
  assert(get("trusting").seats.join() === "1,2", "most trusting (burned once each, three splits)");
  const none = awards([{ round: 1, heist: false, sitting: [], tables: [tb([0, 1], ["split", "split"])] }], 2);
  assert(none.length === 1 && none[0].key === "saint", "no thieves, no backstabber award");
}

console.log("✓ doublecross tests passed");
