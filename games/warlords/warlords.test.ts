import { assert, makeTestCtx } from "../../shared/testing";
import game, { resolveCastle, resolveRound, rollValues, type WlState } from "./server";
import {
  AWAY_END_MS,
  CASTLES,
  DRAGON_EXTRA_MS,
  FIRST_PLAN_MS,
  INTRO_MS,
  LAST_SUMMARY_MS,
  PLAN_MS,
  ROUNDS,
  STEP_MS,
  SUMMARY_MS,
  parseAlloc,
  sum,
  type WlView,
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

const view = (s: WlState, id: string, t: T) => game.view(s, id, t.ctx) as WlView;
/** Read state through a function so TypeScript doesn't keep stale narrowings across actions. */
const st = (s: WlState): WlState => s;

function disconnect(s: WlState, t: T, i: number) {
  t.ctx.players[i].connected = false;
  game.playerLeft!(s, t.ids[i], t.ctx);
}
function reconnect(s: WlState, t: T, i: number) {
  t.ctx.players[i].connected = true;
  game.playerReturned!(s, t.ids[i], t.ctx);
}

/** Run the reveal (one tick per step) until the next plan phase or the final. */
function finishReveal(s: WlState, t: T) {
  let guard = 0;
  while (s.phase === "reveal" && guard++ < 20) {
    t.advance(s.endsAt - t.ctx.now());
    assert(game.tick!(s, t.ctx) === true, "each reveal step changes state");
  }
  assert(s.phase !== "reveal", "reveal finishes");
}

/** Everyone locks the given allocations, then the reveal plays out. */
function playRound(s: WlState, t: T, allocs: number[][]) {
  assert(s.phase === "plan", "round starts in plan");
  t.ids.forEach((id, i) => {
    assert(game.action(s, id, { type: "lock", alloc: allocs[i % allocs.length] }, t.ctx) === true, `lock ${id}`);
  });
  assert(st(s).phase === "reveal", "last lock starts the reveal");
  finishReveal(s, t);
}

// ---------- resolution maths ----------
{
  // Biggest army takes it.
  let r = resolveCastle([30, 10, 0], 7, null);
  assert(r.winners.length === 1 && r.winners[0] === 0 && r.points === 7, "biggest wins full value");
  // Tie at the top splits, rounded down.
  r = resolveCastle([30, 30, 5], 7, null);
  assert(r.winners.join() === "0,1" && r.points === 3, "tie splits 7 -> 3 each");
  r = resolveCastle([10, 10, 10, 10], 2, null);
  assert(r.winners.length === 4 && r.points === 1, "split is at least 1 each");
  r = resolveCastle([9, 9, 9], 9, null);
  assert(r.points === 3, "9 split three ways");
  // Dragon: strictly greater needed.
  r = resolveCastle([25, 20], 8, 25);
  assert(r.winners.length === 0 && r.points === 0, "equal to the dragon is not enough");
  r = resolveCastle([26, 20], 8, 25);
  assert(r.winners[0] === 0 && r.points === 8, "one more than the dragon wins");
  r = resolveCastle([40, 40, 1], 5, 39);
  assert(r.winners.join() === "0,1" && r.points === 2, "tie above the dragon splits");
  r = resolveCastle([10, 30, 30], 6, 30);
  assert(r.winners.length === 0, "a tie at the dragon's strength: the dragon keeps it");
  r = resolveCastle([5, 3], 9, 40);
  assert(r.winners.length === 0, "nobody beats the dragon");
  // Nobody came.
  r = resolveCastle([0, 0, 0], 9, null);
  assert(r.winners.length === 0 && r.points === 0, "all zero: nobody scores");
  r = resolveCastle([0, 0], 9, 10);
  assert(r.winners.length === 0, "all zero with a dragon");
  r = resolveCastle([1, 0], 2, null);
  assert(r.winners[0] === 0, "a single troop takes an empty castle");

  const rr = resolveRound(1, ["a", "b", "c", "d", "e"], [2, 3, 4, 5, 6], [[20, 20, 20, 20, 20], [0, 0, 50, 50, 0]], ["lock", "lock"], {
    castle: 4,
    strength: 30,
  });
  // c0: 20 v 0 -> p0 +2; c1: p0 +3; c2: p1 +4; c3: p1 +5; c4: dragon 30 > 20 -> kept.
  assert(rr.gained.join() === "5,9", `round totals ${rr.gained.join()}`);
  assert(rr.castles[4].winners.length === 0, "dragon kept castle 5");
}

// ---------- parseAlloc / hostile allocations ----------
{
  assert(parseAlloc([20, 20, 20, 20, 20])?.join() === "20,20,20,20,20", "even split ok");
  assert(parseAlloc([100, 0, 0, 0, 0]), "all in ok");
  assert(parseAlloc([0, 0, 0, 0, 0]), "all zero ok");
  assert(parseAlloc([10, 10, 10, 10, 10]), "under 100 ok");
  const bad: unknown[] = [
    null,
    undefined,
    "20,20,20,20,20",
    {},
    [20, 20, 20, 20],
    [20, 20, 20, 20, 20, 0],
    [20, 20, 20, 20, 21],
    [-1, 20, 20, 20, 20],
    [1.5, 20, 20, 20, 20],
    [NaN, 0, 0, 0, 0],
    [Infinity, 0, 0, 0, 0],
    ["20", 20, 20, 20, 20],
    [null, 0, 0, 0, 0],
    [101, 0, 0, 0, 0],
    [60, 60, -20, 0, 0],
    new Array(5000).fill(0),
  ];
  for (const b of bad) assert(parseAlloc(b) === null, `rejects ${JSON.stringify(b)?.slice(0, 40)}`);
  const neg0 = parseAlloc([-0, 0, 0, 0, 0]);
  assert(neg0 && Object.is(neg0[0], 0), "-0 normalised");
}

// ---------- castle values ----------
{
  const t = makeTestCtx(2, 7);
  for (let i = 0; i < 300; i++) {
    const v = rollValues(t.ctx);
    assert(v.length === CASTLES, "five castles");
    assert(v.every((x) => Number.isInteger(x) && x >= 2 && x <= 9), "values 2..9");
    assert(new Set(v).size >= 3, "at least three distinct values");
  }
  const s: WlState = game.setup(t.ctx);
  assert(s.dragon.castle >= 0 && s.dragon.castle < CASTLES, "dragon castle in range");
  assert(s.dragon.strength >= 10 && s.dragon.strength <= 40, "dragon strength 10..40");
  assert(new Set(s.names).size === CASTLES, "five distinct names");
}

// ---------- full game, phase timings, ctx.end once ----------
{
  const t = makeTestCtx(3);
  const ends = countEnds(t);
  const s: WlState = game.setup(t.ctx);
  assert(s.phase === "plan" && s.round === 1, "starts planning round 1");
  assert(s.endsAt - t.ctx.now() === FIRST_PLAN_MS, "first plan is longer");

  // Round 1: drive every transition by time.
  game.action(s, t.ids[0], { type: "plan", alloc: [50, 50, 0, 0, 0] }, t.ctx);
  t.advance(FIRST_PLAN_MS - 1);
  assert(game.tick!(s, t.ctx) === false, "nothing happens before the deadline");
  t.advance(1);
  assert(game.tick!(s, t.ctx) === true && st(s).phase === "reveal" && s.step === 0, "deadline starts the reveal");
  const r1 = s.history[0];
  assert(r1.src.join() === "draft,auto,auto", `sources ${r1.src.join()}`);
  assert(r1.alloc[0].join() === "50,50,0,0,0", "draft counted");
  assert(r1.alloc[1].join() === "20,20,20,20,20", "no draft = even split");
  t.advance(INTRO_MS);
  game.tick!(s, t.ctx);
  assert(st(s).step === 1, "first castle after the intro");
  for (let c = 1; c < CASTLES; c++) {
    const dur = STEP_MS + (s.dragon.castle === c - 1 ? DRAGON_EXTRA_MS : 0);
    t.advance(dur - 1);
    assert(game.tick!(s, t.ctx) === false, "castle lingers");
    t.advance(1);
    game.tick!(s, t.ctx);
    assert(s.step === c + 1, `castle ${c + 1}`);
  }
  t.advance(STEP_MS + (s.dragon.castle === CASTLES - 1 ? DRAGON_EXTRA_MS : 0));
  game.tick!(s, t.ctx);
  assert(s.step === CASTLES + 1, "summary");
  const v = view(s, t.ids[1], t);
  assert(v.reveal?.gained?.length === 3 && v.history.length === 1, "summary shows the round");
  t.advance(SUMMARY_MS);
  game.tick!(s, t.ctx);
  assert(st(s).phase === "plan" && st(s).round === 2 && s.endsAt - t.ctx.now() === PLAN_MS, "round 2 plan");
  assert(s.drafts.every((d) => d === null) && s.locked.every((l) => !l), "fresh drafts");

  // Rounds 2..5 by locking (p0 always all-in on the most valuable castle).
  while (s.phase === "plan") {
    const best = s.values.indexOf(Math.max(...s.values));
    const allIn = [0, 0, 0, 0, 0];
    allIn[best] = 100;
    playRound(s, t, [allIn, [20, 20, 20, 20, 20], [0, 25, 25, 25, 25]]);
  }
  assert(s.phase === "final" && s.history.length === ROUNDS, "five rounds then the final");
  assert(t.result, "ctx.end called");
  const totals = t.ids.map((_, i) => sum(s.history.map((r) => r.gained[i])));
  const best = Math.max(...totals);
  const expected = t.ids.filter((_, i) => totals[i] === best);
  assert(t.result.winners.join() === expected.join(), `winners ${t.result.winners} vs ${expected}`);
  assert(t.ids.every((id, i) => t.result!.scores![id] === totals[i]), "scores reported");
  assert(/realm/.test(t.result.headline), t.result.headline);
  const fv = view(s, "spectator", t);
  assert(fv.scores.join() === totals.join() && fv.history.length === ROUNDS && fv.reveal === null, "final view");
  // Nothing after the end.
  assert(game.action(s, t.ids[0], { type: "lock", alloc: [1, 0, 0, 0, 0] }, t.ctx) === false, "no actions after the end");
  t.advance(120_000);
  assert(game.tick!(s, t.ctx) === false, "no ticks after the end");
  disconnect(s, t, 1);
  reconnect(s, t, 1);
  assert(ends() === 1, "ctx.end exactly once");
}

// ---------- last round summary is shorter ----------
{
  const t = makeTestCtx(2);
  const s: WlState = game.setup(t.ctx);
  for (let r = 1; r < ROUNDS; r++) playRound(s, t, [[20, 20, 20, 20, 20]]);
  t.ids.forEach((id) => game.action(s, id, { type: "lock", alloc: [10, 10, 10, 10, 10] }, t.ctx));
  while (s.step <= CASTLES) {
    t.advance(s.endsAt - t.ctx.now());
    game.tick!(s, t.ctx);
  }
  assert(s.phaseMs === LAST_SUMMARY_MS, "last summary is short");
  t.advance(LAST_SUMMARY_MS);
  game.tick!(s, t.ctx);
  assert(s.phase === "final", "final after the last summary");
  // Everyone always tied: everyone wins.
  assert(t.result && t.result.winners.length === 2, "full tie = shared win");
  assert(/share the realm/.test(t.result.headline), t.result.headline);
}

// ---------- all zero: nobody scores ----------
{
  const t = makeTestCtx(3);
  const s: WlState = game.setup(t.ctx);
  for (let r = 0; r < ROUNDS; r++) playRound(s, t, [[0, 0, 0, 0, 0]]);
  assert(t.result && t.result.winners.length === 0, "nobody wins");
  assert(/dragons keep the realm/.test(t.result.headline), t.result.headline);
}

// ---------- early advance, unlock, autosave ----------
{
  const t = makeTestCtx(3);
  const s: WlState = game.setup(t.ctx);
  assert(game.action(s, t.ids[0], { type: "plan", alloc: [100, 0, 0, 0, 0] }, t.ctx) === false, "plan autosave returns false");
  assert(s.drafts[0]?.[0] === 100, "draft saved");
  assert(game.action(s, t.ids[0], { type: "lock" }, t.ctx) === true, "lock uses the draft");
  assert(s.locked[0] && s.drafts[0]?.[0] === 100, "locked with the draft");
  assert(game.action(s, t.ids[0], { type: "plan", alloc: [0, 100, 0, 0, 0] }, t.ctx) === false && s.drafts[0]?.[0] === 100, "locked plans can't change");
  assert(game.action(s, t.ids[0], { type: "lock" }, t.ctx) === false, "double lock rejected");
  assert(game.action(s, t.ids[0], { type: "unlock" }, t.ctx) === true && !s.locked[0], "unlock");
  assert(game.action(s, t.ids[0], { type: "unlock" }, t.ctx) === false, "unlock twice rejected");
  assert(game.action(s, t.ids[0], { type: "lock", alloc: [0, 0, 0, 0, 100] }, t.ctx) === true, "relock with a new plan");
  assert(s.drafts[0]?.[4] === 100, "new plan stored");
  assert(game.action(s, t.ids[1], { type: "lock" }, t.ctx) === false, "lock without any plan rejected");
  game.action(s, t.ids[1], { type: "lock", alloc: [20, 20, 20, 20, 20] }, t.ctx);
  assert(s.phase === "plan", "still waiting on p2");
  game.action(s, t.ids[2], { type: "plan", alloc: [0, 0, 50, 0, 0] }, t.ctx);
  // p2 drops without locking: everyone online has locked -> battle starts.
  disconnect(s, t, 2);
  assert(st(s).phase === "reveal", "a disconnect can complete the locks");
  assert(s.history[0].src.join() === "lock,lock,draft", s.history[0].src.join());
  assert(s.history[0].alloc[2].join() === "0,0,50,0,0", "the offline player's draft counts");
  // Reveal continues while they're gone, and they come back to the next plan.
  finishReveal(s, t);
  assert(s.phase === "plan" && s.round === 2, "round 2");
  reconnect(s, t, 2);
  // An offline player with no draft sends an even split.
  disconnect(s, t, 1);
  game.action(s, t.ids[0], { type: "lock", alloc: [10, 0, 0, 0, 0] }, t.ctx);
  assert(s.phase === "plan", "p2 still planning");
  game.action(s, t.ids[2], { type: "lock", alloc: [0, 10, 0, 0, 0] }, t.ctx);
  assert(st(s).phase === "reveal", "all online locked");
  assert(s.history[1].src[1] === "auto" && s.history[1].alloc[1].join() === "20,20,20,20,20", "offline no-draft = even split");
}

// ---------- nobody online: no instant advance ----------
{
  const t = makeTestCtx(2);
  const s: WlState = game.setup(t.ctx);
  disconnect(s, t, 0);
  disconnect(s, t, 1);
  assert(s.phase === "plan", "nobody online doesn't count as everyone locked");
  assert(s.awaySince !== null, "away clock running");
  t.advance(AWAY_END_MS - 1);
  game.tick!(s, t.ctx);
  assert(!t.result, "not yet");
  reconnect(s, t, 0);
  reconnect(s, t, 1);
  assert(s.awaySince === null, "back: away clock cleared");
  t.advance(AWAY_END_MS);
  game.tick!(s, t.ctx);
  assert(!t.result, "doesn't end while both are back");
}

// ---------- too few online: ends early with standings ----------
for (const where of ["plan", "reveal", "summary"] as const) {
  const t = makeTestCtx(3);
  const ends = countEnds(t);
  const s: WlState = game.setup(t.ctx);
  playRound(s, t, [[100, 0, 0, 0, 0], [0, 100, 0, 0, 0], [0, 0, 100, 0, 0]]);
  if (where !== "plan") t.ids.forEach((id) => game.action(s, id, { type: "lock", alloc: [20, 20, 20, 20, 20] }, t.ctx));
  if (where === "summary") {
    while (s.step <= CASTLES) {
      t.advance(s.endsAt - t.ctx.now());
      game.tick!(s, t.ctx);
    }
  }
  disconnect(s, t, 1);
  assert(s.awaySince === null, "two still online");
  disconnect(s, t, 2);
  assert(s.awaySince !== null, `away clock in ${where}`);
  const v = view(s, t.ids[0], t);
  assert(v.awayEndsAt === s.awaySince! + AWAY_END_MS, "view shows when the game ends");
  // Time passes; the game keeps moving but ends at the away deadline.
  let guard = 0;
  while (!t.result && guard++ < 400) {
    t.advance(250);
    game.tick!(s, t.ctx);
  }
  assert(t.result && s.phase === "final" && s.endedEarly, `ended early in ${where}`);
  assert(/Too few warlords/.test(t.result.headline), t.result.headline);
  const totals = t.ids.map((_, i) => sum(s.history.map((r) => r.gained[i])));
  assert(t.ids.every((id, i) => t.result!.scores![id] === totals[i]), "early scores");
  assert(ends() === 1, "one end");
}

// ---------- secrecy ----------
{
  const t = makeTestCtx(3, 5);
  const s: WlState = game.setup(t.ctx);
  const secret = [37, 0, 0, 0, 63];
  game.action(s, t.ids[0], { type: "plan", alloc: secret }, t.ctx);
  for (const who of [t.ids[1], t.ids[2], "spectator"]) {
    const v = view(s, who, t);
    const json = JSON.stringify(v);
    assert(!json.includes("37,0,0,0,63"), `${who} can't see p0's draft`);
    assert(!json.includes("strength") && v.reveal === null, `${who} can't see the dragon`);
    assert(who === "spectator" ? v.me === null : v.me?.draft === null, "own draft only");
  }
  assert(view(s, t.ids[0], t).me?.draft?.join() === secret.join(), "p0 sees their own draft");
  game.action(s, t.ids[0], { type: "lock" }, t.ctx);
  const v1 = view(s, t.ids[1], t);
  assert(v1.locked.join() === "true,false,false", "only lock flags are public");
  assert(!JSON.stringify(v1).includes("37,0,0,0,63"), "locked plan still secret");

  // Force the dragon onto the last castle and check it stays hidden until then.
  s.dragon = { castle: 4, strength: 33 };
  t.ids.slice(1).forEach((id) => game.action(s, id, { type: "lock", alloc: [10, 10, 10, 10, 10] }, t.ctx));
  assert(s.phase === "reveal", "reveal");
  for (let st = 0; st <= CASTLES + 1; st++) {
    for (const who of [t.ids[1], "spectator"]) {
      const v = view(s, who, t);
      const json = JSON.stringify(v);
      assert(v.reveal?.castles.length === Math.min(st, CASTLES), `${st} castles shown`);
      if (st < CASTLES) {
        assert(!json.includes("strength") && v.reveal.dragon === null, `dragon hidden at step ${st}`);
        assert(v.reveal.castles.every((c) => c.dragon === null), "no dragon on shown castles");
        assert(v.history.length === 0, "the round isn't in the public history yet");
        assert(!json.includes("37,0,0,0,63"), "full allocations not out yet");
        assert(v.reveal.gained === null, "no round totals yet");
      } else {
        assert(v.reveal.dragon?.castle === 4 && v.reveal.dragon.strength === 33, "dragon revealed at its castle");
        assert(v.reveal.castles[4].dragon === 33, "dragon on castle 5");
        assert(v.history.length === 1 && v.history[0].alloc[0].join() === secret.join(), "allocations public now");
      }
      // Live scores count only revealed castles.
      const expect = t.ids.map((_, i) =>
        s.history[0].castles.slice(0, Math.min(st, CASTLES)).reduce((tt, c) => tt + (c.winners.includes(i) ? c.points : 0), 0),
      );
      assert(v.scores.join() === expect.join(), `live scores at step ${st}`);
    }
    if (st <= CASTLES) {
      t.advance(s.endsAt - t.ctx.now());
      game.tick!(s, t.ctx);
    }
  }
  // p0 sees their own army during the reveal.
  assert(view(s, t.ids[0], t).me?.alloc?.join() === secret.join(), "own army in reveal");
}

// ---------- hostile actions ----------
{
  const t = makeTestCtx(2);
  const s: WlState = game.setup(t.ctx);
  const p = t.ids[0];
  const hostile: unknown[] = [
    null,
    undefined,
    42,
    "lock",
    [],
    ["lock"],
    {},
    { type: "x" },
    { type: "__proto__" },
    { type: "plan" },
    { type: "plan", alloc: "20,20,20,20,20" },
    { type: "plan", alloc: [20, 20, 20, 20] },
    { type: "plan", alloc: [20, 20, 20, 20, 20, 0] },
    { type: "plan", alloc: [30, 30, 30, 30, 30] },
    { type: "plan", alloc: [-10, 50, 50, 5, 5] },
    { type: "plan", alloc: [10.5, 0, 0, 0, 0] },
    { type: "plan", alloc: [NaN, 0, 0, 0, 0] },
    { type: "plan", alloc: [1e9, 0, 0, 0, 0] },
    { type: "plan", alloc: { 0: 20, length: 5 } },
    { type: "plan", alloc: new Array(5000).fill(1) },
    { type: "lock", alloc: [101, 0, 0, 0, 0] },
    { type: "lock", alloc: null },
    { type: "lock", alloc: "x".repeat(5000) },
    { type: "unlock" },
  ];
  for (const a of hostile) {
    assert(game.action(s, p, a as never, t.ctx) === false, `rejects ${JSON.stringify(a)?.slice(0, 50)}`);
  }
  assert(s.drafts.every((d) => d === null) && s.locked.every((l) => !l), "no state change from junk");
  assert(game.action(s, "stranger", { type: "lock", alloc: [1, 0, 0, 0, 0] }, t.ctx) === false, "non-player rejected");
  assert(game.spectatorAction === undefined, "no spectator actions");
  // Wrong phase.
  t.ids.forEach((id) => game.action(s, id, { type: "lock", alloc: [20, 20, 20, 20, 20] }, t.ctx));
  assert(s.phase === "reveal", "reveal");
  assert(game.action(s, p, { type: "plan", alloc: [1, 0, 0, 0, 0] }, t.ctx) === false, "no plans during reveal");
  assert(game.action(s, p, { type: "unlock" }, t.ctx) === false, "no unlock during reveal");
  assert(game.action(s, p, { type: "lock", alloc: [1, 0, 0, 0, 0] }, t.ctx) === false, "no lock during reveal");
}

// ---------- min and max players, view size ----------
for (const n of [2, 12]) {
  const t = makeTestCtx(n, 11);
  const ends = countEnds(t);
  const s: WlState = game.setup(t.ctx);
  let maxView = 0;
  for (let r = 0; r < ROUNDS; r++) {
    // Each round some lock, some leave a draft, some do nothing.
    t.ids.forEach((id, i) => {
      const a = [0, 0, 0, 0, 0];
      a[(i + r) % CASTLES] = 40 + i;
      a[(i + r + 2) % CASTLES] = 60 - i;
      if (i % 3 === 0) game.action(s, id, { type: "lock", alloc: a }, t.ctx);
      else if (i % 3 === 1) game.action(s, id, { type: "plan", alloc: a }, t.ctx);
    });
    let guard = 0;
    const start = s.round;
    while (s.phase !== "final" && (s.round === start || s.phase !== "plan") && guard++ < 100) {
      t.advance(1000);
      game.tick!(s, t.ctx);
      maxView = Math.max(maxView, JSON.stringify(view(s, t.ids[0], t)).length);
    }
  }
  assert(s.phase === "final" && t.result, `${n} players: game finishes`);
  assert(ends() === 1, "one end");
  assert(maxView < 6000, `${n} players: view stays small (${maxView} bytes)`);
  console.log(`  ${n} players: max view ${maxView} bytes, ${t.result.headline}`);
}

console.log("✓ warlords tests passed");
