import { assert as assertTs, makeTestCtx } from "../../shared/testing";
import type { GameResult } from "../../shared/types";
import { POLLS } from "./data";
import game, { type PollPhase, type PollState, type PollView } from "./server";
import {
  ABANDON_MS,
  MAJORITY_MULT,
  PREDICT_MS,
  READ_PTS,
  REVEAL_MS,
  ROUNDS,
  VOTE_MS,
  WOLF_BONUS,
  evenSplit,
  misplaced,
  predPoints,
  selfPoints,
  splitOption,
} from "./shared";

function assert(cond: unknown, msg?: string): void {
  assertTs(cond, msg);
}

type T = ReturnType<typeof makeTestCtx>;

function harness(n: number, seed = 42) {
  const t = makeTestCtx(n, seed);
  const calls: GameResult[] = [];
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    calls.push(r);
    end(r);
  };
  const s: PollState = game.setup(t.ctx);
  return { t, s, calls };
}

const view = (s: PollState, id: string, t: T) => game.view(s, id, t.ctx) as PollView;
const tick = (s: PollState, t: T, ms = 0) => {
  t.advance(ms);
  return game.tick!(s, t.ctx);
};
const act = (s: PollState, t: T, id: string, a: unknown) => game.action(s, id, a as never, t.ctx);
const phaseOf = (s: PollState): PollPhase => s.phase;
const nOpts = (s: PollState) => POLLS[s.polls[s.round]].length - 1;

function disconnect(s: PollState, t: T, id: string) {
  t.ctx.player(id)!.connected = false;
  game.playerLeft!(s, id, t.ctx);
}
function reconnect(s: PollState, t: T, id: string) {
  t.ctx.player(id)!.connected = true;
  game.playerReturned!(s, id, t.ctx);
}

function isPlainJson(v: unknown): boolean {
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isPlainJson);
  if (typeof v === "object") {
    if (Object.getPrototypeOf(v) !== Object.prototype) return false;
    return Object.values(v as object).every(isPlainJson);
  }
  return false;
}

/** Everyone votes `pick(i)`, then everyone predicts/reads, then everyone is ready. */
function playRound(s: PollState, t: T, pick: (i: number) => number) {
  assert(phaseOf(s) === "vote", "round starts with a vote");
  s.ids.forEach((id, i) => act(s, t, id, { type: "vote", o: pick(i) % nOpts(s) }));
  assert(phaseOf(s) === "predict", "all voted -> predict early");
  if (s.kinds[s.round] === "room") {
    s.ids.forEach((id, i) => {
      if (i === s.spot) act(s, t, id, { type: "self", n: 1, lock: true });
      else act(s, t, id, { type: "read", o: 0 });
    });
  } else {
    s.ids.forEach((id) => act(s, t, id, { type: "pred", c: evenSplit(s.voters, nOpts(s)), lock: true }));
  }
  assert(phaseOf(s) === "reveal", "all locked -> reveal early");
  s.ids.forEach((id) => act(s, t, id, { type: "ready" }));
}

// ---------- shared helpers ----------
{
  assert(POLLS.length >= 120, "at least 120 polls");
  assert(new Set(POLLS.map((p) => p[0])).size === POLLS.length, "polls are distinct");
  for (const p of POLLS) {
    assert(p.length >= 3 && p.length <= 5, `2-4 options: ${p[0]}`);
    for (const o of p.slice(1)) assert(splitOption(o).emoji && splitOption(o).label, `option has emoji + label: ${o}`);
  }
  assert(misplaced([3, 1, 0], [1, 2, 1]) === 2, "misplaced = half the abs error");
  assert(predPoints(0) === 100 && predPoints(2) === 70 && predPoints(9) === 0, "pred points");
  assert(selfPoints(0) === 100 && selfPoints(1) === 70 && selfPoints(5) === 0, "self points");
  assert(JSON.stringify(evenSplit(7, 3)) === "[3,2,2]", "even split");
}

// ---------- full game, early advances, end once ----------
{
  const { t, s, calls } = harness(5);
  assert(s.polls.length === ROUNDS && new Set(s.polls).size === ROUNDS, "8 distinct polls");
  assert(s.kinds.filter((k) => k === "room").length === 1, "one read-the-room round");
  assert(s.kinds.filter((k) => k === "majority").length === 1, "one majority round");
  for (let r = 0; r < ROUNDS; r++) playRound(s, t, (i) => (i === 0 ? 1 : 0));
  assert(phaseOf(s) === "final", "game over after 8 rounds");
  assert(calls.length === 1, "ctx.end exactly once");
  const res = calls[0];
  const total = s.score.reduce((a, b) => a + b, 0);
  assert(total > 0, "points were scored");
  const best = Math.max(...s.score);
  assert(res.winners.length === s.score.filter((x) => x === best).length, "winners = top scorers");
  assert(res.scores![s.ids[0]] === s.score[0], "scores reported");
  assert(act(s, t, s.ids[0], { type: "vote", o: 0 }) === false, "actions ignored after end");
  tick(s, t, 60_000);
  assert(calls.length === 1, "still ended once");
  const v = view(s, s.ids[0], t);
  assert(v.recap.length === ROUNDS && isPlainJson(v), "final view has recap and is plain JSON");
}

// ---------- scoring: normal round with lone wolf ----------
{
  const { t, s } = harness(5);
  s.kinds = s.kinds.map(() => "normal");
  // Force a 3-answer poll so the numbers are predictable.
  s.polls[0] = POLLS.findIndex((p) => p.length === 4);
  const [a, b, c, d, e] = s.ids;
  act(s, t, a, { type: "vote", o: 0 });
  act(s, t, b, { type: "vote", o: 0 });
  act(s, t, c, { type: "vote", o: 0 });
  act(s, t, d, { type: "vote", o: 1 });
  assert(phaseOf(s) === "vote", "waits for the last voter");
  act(s, t, e, { type: "vote", o: 1 });
  act(s, t, e, { type: "vote", o: 2 }); // change of mind is fine... but phase already moved on
  assert(phaseOf(s) === "predict" && s.voters === 5, "predict with 5 voters");
  assert(act(s, t, a, { type: "pred", c: [5, 0, 0] }) === false, "draft returns false");
  assert(s.pred[0]![0] === 5 && !s.locked[0], "draft stored, not locked");
  act(s, t, b, { type: "pred", c: [3, 2, 0], lock: true }); // perfect
  act(s, t, c, { type: "pred", c: [3, 1, 1], lock: true }); // off by 1
  // d and e never predict; a's draft counts at the timer
  tick(s, t, PREDICT_MS + 1);
  assert(phaseOf(s) === "reveal", "timer ends predict");
  const r = s.reveal!;
  assert(JSON.stringify(r.counts) === "[3,2,0]", "counts");
  assert(r.rows[1].pts === 100 && r.rows[2].pts === predPoints(1), "perfect and off-by-one");
  assert(r.rows[0].miss === 2 && r.rows[0].pts === predPoints(2), "draft scored");
  assert(r.rows[3].pts === 0 && !r.rows[3].wolf, "no prediction, not alone");
  assert(JSON.stringify(r.top) === "[0]", "top answer");
  tick(s, t, REVEAL_MS + 1);
  assert(phaseOf(s) === "vote" && s.round === 1, "reveal timer -> next round");
  // lone wolf
  s.kinds[1] = "normal";
  s.polls[1] = POLLS.findIndex((p) => p.length === 3);
  s.ids.forEach((id, i) => act(s, t, id, { type: "vote", o: i === 4 ? 1 : 0 }));
  s.ids.forEach((id) => act(s, t, id, { type: "pred", c: [4, 1], lock: true }));
  assert(s.reveal!.rows[4].wolf && s.reveal!.rows[4].pts === 100 + WOLF_BONUS, "lone wolf bonus");
  assert(s.reveal!.rows[0].pts === 100 && !s.reveal!.rows[0].wolf, "herd scores normally");
}

// ---------- lone wolf needs 4+ voters ----------
{
  const { t, s } = harness(3);
  s.kinds[0] = "normal";
  s.polls[0] = POLLS.findIndex((p) => p.length === 3);
  s.ids.forEach((id, i) => act(s, t, id, { type: "vote", o: i === 2 ? 1 : 0 }));
  s.ids.forEach((id) => act(s, t, id, { type: "pred", c: [2, 1], lock: true }));
  assert(!s.reveal!.rows[2].wolf && s.reveal!.rows[2].pts === 100, "no wolf with 3 voters");
}

// ---------- majority rules ----------
{
  const { t, s } = harness(4);
  s.kinds[0] = "majority";
  s.polls[0] = POLLS.findIndex((p) => p.length === 3);
  const v = view(s, s.ids[0], t);
  assert(v.kind === "majority", "kind in view");
  s.ids.forEach((id, i) => act(s, t, id, { type: "vote", o: i === 3 ? 1 : 0 }));
  s.ids.forEach((id) => act(s, t, id, { type: "pred", c: [3, 1], lock: true }));
  const r = s.reveal!;
  assert(r.rows[0].side === true && r.rows[0].pts === 100 * MAJORITY_MULT, "majority doubled");
  assert(r.rows[3].side === false && r.rows[3].pts === 0 && !r.rows[3].wolf, "minority scores nothing");
}

// ---------- read the room ----------
{
  const { t, s } = harness(4);
  s.kinds[0] = "room";
  s.polls[0] = POLLS.findIndex((p) => p.length === 3);
  s.ids.forEach((id, i) => act(s, t, id, { type: "vote", o: i === 0 ? 1 : 0 }));
  assert(phaseOf(s) === "predict" && s.spot >= 0, "spotlight chosen");
  const spotId = s.ids[s.spot];
  const spotVote = s.vote[s.spot]!;
  const v0 = view(s, s.ids[(s.spot + 1) % 4], t);
  assert(v0.spot === spotId, "spot is public during predict");
  assert(!JSON.stringify(v0).includes(`"vote":${spotVote},"right"`), "spot vote hidden");
  assert(act(s, t, spotId, { type: "read", o: 0 }) === false, "spot can't read themselves");
  assert(act(s, t, s.ids[(s.spot + 1) % 4], { type: "pred", c: [3, 1], lock: true }) === false, "no count predictions in room round");
  assert(act(s, t, s.ids[(s.spot + 1) % 4], { type: "self", n: 1 }) === false, "only spot guesses self");
  assert(act(s, t, spotId, { type: "self", n: 9 }) === false, "self out of range");
  assert(act(s, t, spotId, { type: "self", n: 2 }) === false, "self draft returns false");
  let right = 0;
  s.ids.forEach((id, i) => {
    if (i === s.spot) return;
    const o = i % 2 === 0 ? spotVote : 1 - spotVote;
    if (o === spotVote) right++;
    act(s, t, id, { type: "read", o });
  });
  assert(phaseOf(s) === "predict", "waits for the spotlight to lock");
  act(s, t, spotId, { type: "self", n: 2, lock: true });
  assert(phaseOf(s) === "reveal", "all locked -> reveal");
  const r = s.reveal!;
  assert(r.spot && r.spot.right === right && r.spot.readers === 3, "spot result");
  assert(r.rows[s.spot].pts === selfPoints(Math.abs(2 - right)), "spot scored on its guess");
  s.ids.forEach((_, i) => {
    if (i === s.spot) return;
    assert(r.rows[i].pts === (r.rows[i].read === spotVote ? READ_PTS : 0), "readers scored");
  });
}

// ---------- secrecy ----------
{
  const { t, s } = harness(4);
  s.polls[0] = POLLS.findIndex((p) => p.length === 5);
  act(s, t, s.ids[0], { type: "vote", o: 3 });
  const other = JSON.stringify(view(s, s.ids[1], t));
  const spec = JSON.stringify(view(s, "spectator", t));
  assert(view(s, s.ids[0], t).mine!.vote === 3, "I see my vote");
  assert(view(s, s.ids[1], t).mine!.vote === null, "others don't see it in mine");
  assert(!other.includes('"vote":3') && !spec.includes('"vote":3'), "vote hidden from others/spectators");
  assert(view(s, "spectator", t).mine === null, "spectator has no private data");
  assert(view(s, s.ids[1], t).seats[0].voted, "others see that I voted");
  assert(view(s, s.ids[1], t).reveal === null, "no reveal yet");
  assert(JSON.stringify(view(s, s.ids[1], t)).length < 4000, "view is small");
}

// ---------- hostile actions ----------
{
  const { t, s } = harness(3);
  const id = s.ids[0];
  const junk: unknown[] = [
    null,
    42,
    "vote",
    [],
    {},
    { type: "x" },
    { type: "__proto__" },
    { type: "vote" },
    { type: "vote", o: -1 },
    { type: "vote", o: 1.5 },
    { type: "vote", o: "0" },
    { type: "vote", o: 99 },
    { type: "vote", o: Number.NaN },
    { type: "pred", c: [1, 2] },
    { type: "read", o: 0 },
    { type: "self", n: 0 },
    { type: "ready" },
  ];
  const before = JSON.stringify(s);
  for (const j of junk) assert(act(s, t, id, j) === false, `rejects ${JSON.stringify(j)}`);
  assert(act(s, t, "stranger", { type: "vote", o: 0 }) === false, "non-participant rejected");
  assert(JSON.stringify(s) === before, "state untouched by junk");
  // move to predict
  s.ids.forEach((p) => act(s, t, p, { type: "vote", o: 0 }));
  if (s.kinds[0] !== "room") {
    const n = nOpts(s);
    const bad: unknown[] = [
      { type: "pred", c: "3" },
      { type: "pred", c: new Array(5000).fill(0) },
      { type: "pred", c: Array.from({ length: n }, () => 9) },
      { type: "pred", c: [3, ...new Array(n - 1).fill(0)], lock: "yes" },
      { type: "pred", c: [-1, 4, ...new Array(n - 2).fill(0)] },
      { type: "pred", c: [1.5, 1.5, ...new Array(n - 2).fill(0)] },
      { type: "vote", o: 0 },
      { type: "ready" },
    ];
    for (const j of bad) assert(act(s, t, id, j) === false, `rejects ${JSON.stringify(j).slice(0, 60)}`);
    assert(act(s, t, id, { type: "pred", c: [3, ...new Array(n - 1).fill(0)], lock: true }) === true, "valid lock");
    assert(act(s, t, id, { type: "pred", c: [3, ...new Array(n - 1).fill(0)], lock: true }) === false, "no double lock");
  }
}

// ---------- timers drive everything; nobody acts ----------
{
  const { t, s, calls } = harness(3);
  tick(s, t, VOTE_MS + 1);
  assert(phaseOf(s) === "reveal", "no votes -> straight to reveal");
  assert(s.reveal!.counts.every((c) => c === 0), "empty reveal");
  for (let k = 0; k < 40 && phaseOf(s) !== "final"; k++) tick(s, t, Math.max(VOTE_MS, PREDICT_MS, REVEAL_MS) + 1);
  assert(phaseOf(s) === "final" && calls.length === 1, "idle game still ends");
  assert(calls[0].winners.length === 0, "nobody scored -> no winners");
}

// ---------- disconnects never stall ----------
{
  const { t, s, calls } = harness(4);
  const [a, b, c, d] = s.ids;
  disconnect(s, t, d);
  act(s, t, a, { type: "vote", o: 0 });
  act(s, t, b, { type: "vote", o: 0 });
  act(s, t, c, { type: "vote", o: 1 });
  assert(phaseOf(s) === "predict", "absent player not waited for in vote");
  assert(s.voters === 3, "only voters count");
  if (s.kinds[s.round] !== "room") {
    act(s, t, a, { type: "pred", c: evenSplit(3, nOpts(s)), lock: true });
    act(s, t, b, { type: "pred", c: evenSplit(3, nOpts(s)), lock: true });
    disconnect(s, t, c);
    tick(s, t, 250);
    assert(phaseOf(s) === "reveal", "leaver no longer blocks predict");
  } else {
    tick(s, t, PREDICT_MS + 1);
  }
  reconnect(s, t, c);
  reconnect(s, t, d);
  assert(view(s, d, t).phase === "reveal" && view(s, d, t).reveal !== null, "returner sees the reveal");
  // Reveal: someone leaves in reveal, others ready -> moves on
  disconnect(s, t, d);
  [a, b, c].forEach((id) => act(s, t, id, { type: "ready" }));
  assert(phaseOf(s) === "vote", "ready from those here advances");
  // Everyone but one leaves -> abandon after ABANDON_MS
  disconnect(s, t, b);
  disconnect(s, t, c);
  tick(s, t, 250);
  assert(s.lowSince !== null && view(s, a, t).endingAt !== null, "warning shown");
  reconnect(s, t, b);
  tick(s, t, 250);
  assert(s.lowSince === null, "warning cleared on return");
  disconnect(s, t, b);
  tick(s, t, 250);
  for (let k = 0; k < 100 && phaseOf(s) !== "final"; k++) tick(s, t, 1000);
  assert(phaseOf(s) === "final" && calls.length === 1, "abandoned game ends once");
  assert(calls[0].headline.startsWith("Not enough players"), "abandon headline");
  void ABANDON_MS;
}

// ---------- room round: spotlight never a non-voter; max players ----------
{
  const { t, s, calls } = harness(12, 7);
  s.kinds[0] = "room";
  s.ids.forEach((id, i) => {
    if (i % 3 !== 0) act(s, t, id, { type: "vote", o: 0 });
  });
  tick(s, t, VOTE_MS + 1);
  assert(phaseOf(s) === "predict" && s.vote[s.spot] !== null, "spotlight voted");
  assert(JSON.stringify(view(s, s.ids[0], t)).length < 4000, "12-player view is small");
  for (let k = 0; k < 60 && phaseOf(s) !== "final"; k++) {
    if (phaseOf(s) === "vote") playRound(s, t, (i) => i % 3);
    else tick(s, t, Math.max(VOTE_MS, PREDICT_MS, REVEAL_MS) + 1);
  }
  assert(phaseOf(s) === "final" && calls.length === 1, "12-player game ends once");
  const v = view(s, s.ids[0], t);
  assert(isPlainJson(v) && JSON.stringify(v).length < 6000, "final view small");
}

// ---------- ties ----------
{
  const { t, s, calls } = harness(3);
  s.kinds = s.kinds.map(() => "normal");
  for (let r = 0; r < ROUNDS; r++) playRound(s, t, () => 0);
  assert(calls.length === 1 && calls[0].winners.length === 3, "three-way tie shares the win");
}

console.log("✓ poll tests passed");
