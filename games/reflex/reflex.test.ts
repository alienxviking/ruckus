import { assert, makeTestCtx } from "../../shared/testing";
import type { GameResult } from "../../shared/types";
import game, { TARGET, TIMING, type Phase, type ReflexState, type ReflexView } from "./server";

// ---------- helpers ----------

type Harness = ReturnType<typeof makeTestCtx>;

// Read through functions so TypeScript does not keep narrowings across calls that mutate state.
const phaseOf = (s: ReflexState): Phase => s.phase;
const roundOf = (s: ReflexState): number => s.round;

function setup(n: number, seed = 42, ids?: string[]) {
  const t = makeTestCtx(n, seed);
  if (ids) t.ctx.players.forEach((p, i) => (p.id = ids[i]));
  const results: GameResult[] = [];
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    results.push(r);
    end(r);
  };
  const s = game.setup(t.ctx) as ReflexState;
  const pids = t.ctx.players.map((p) => p.id);
  return { t, s, ids: pids, results };
}

const tick = (t: Harness, s: ReflexState) => game.tick!(s, t.ctx) === true;
const view = (t: Harness, s: ReflexState, id: string) => game.view(s, id, t.ctx) as ReflexView;
const tap = (t: Harness, s: ReflexState, id: string, rt: number | null = 250) =>
  game.action(s, id, { type: "tap", round: s.round, rt }, t.ctx);

/** Advance fake time in small steps, ticking, until `pred` holds. Returns ms waited. */
function until(t: Harness, s: ReflexState, pred: (s: ReflexState) => boolean, maxMs = 60_000, stepMs = 25) {
  let waited = 0;
  while (!pred(s)) {
    if (waited >= maxMs) throw new Error(`timed out waiting (phase ${phaseOf(s)}, round ${s.round})`);
    t.advance(stepMs);
    tick(t, s);
    waited += stepMs;
  }
  return waited;
}

function disconnect(t: Harness, s: ReflexState, id: string) {
  t.ctx.player(id)!.connected = false;
  game.playerLeft!(s, id, t.ctx);
}

function reconnect(t: Harness, s: ReflexState, id: string) {
  t.ctx.player(id)!.connected = true;
  game.playerReturned!(s, id, t.ctx);
}

/** A fresh game already in its first "wait", with or without a planned fake-out. */
function inWait(n: number, wantFake: boolean) {
  for (let seed = 1; seed < 500; seed++) {
    const h = setup(n, seed);
    until(h.t, h.s, (s) => phaseOf(s) === "wait");
    if ((h.s.fakeAt !== null) === wantFake) return h;
  }
  throw new Error("no seed produced the wanted wait");
}

/** All numbers anywhere in a value. */
function numbers(v: unknown, out: number[] = []): number[] {
  if (typeof v === "number") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => numbers(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => numbers(x, out));
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Every view must survive a JSON round trip unchanged (no undefined, Map, Set...). */
function assertViewsJsonSafe(t: Harness, s: ReflexState, ids: string[]) {
  for (const id of [...ids, "spectator"]) {
    const v = game.view(s, id, t.ctx);
    assert(deepEqual(v, JSON.parse(JSON.stringify(v))), `view for ${id} is JSON-safe in ${phaseOf(s)}`);
  }
}

/** Before the signal (and during it) no viewer may see any timestamp, or any hint of what's coming. */
function assertNoLeaks(t: Harness, s: ReflexState, ids: string[]) {
  for (const id of [...ids, "spectator"]) {
    const v = view(t, s, id);
    const json = JSON.stringify(v);
    assert(numbers(v).every((n) => n < 1e11), `no timestamps in ${phaseOf(s)} view for ${id}: ${json}`);
    assert(!/goAt|fakeAt|postFake|signalAt|endsAt/.test(json), `no schedule fields in ${phaseOf(s)} view`);
    assert(v.timer === null, `no timer during ${phaseOf(s)}`);
    if (phaseOf(s) !== "fake") assert(v.fakeText === null, `fake text hidden during ${phaseOf(s)}`);
    if (s.fakeText && phaseOf(s) !== "fake") assert(!json.includes(s.fakeText), "fake word not leaked");
  }
}

// ---------- ready -> wait -> go -> result, with timings ----------
{
  const { t, s, ids } = setup(3);
  assert(phaseOf(s) === "ready" && roundOf(s) === 1, "starts in ready, round 1");
  assert(/^[0-9a-z]+$/.test(s.game) && view(t, s, ids[0]).game === s.game, "match id in every view");
  assert(setup(3, 43).s.game !== s.game, "each match gets its own id");
  assert(ids.every((id) => s.scores[id] === 0 && s.best[id] === null && s.fouls[id] === 0), "stats start at zero");
  assertNoLeaks(t, s, ids);
  assertViewsJsonSafe(t, s, ids);

  t.advance(TIMING.readyMs - 1);
  assert(!tick(t, s) && phaseOf(s) === "ready", "ready holds for 2s (and tick reports no change)");
  assert(tap(t, s, ids[0]) === false && !s.taps[ids[0]], "taps during ready are ignored, not fouls");
  t.advance(1);
  assert(tick(t, s) && phaseOf(s) === "wait", "ready -> wait after 2s");
  assertNoLeaks(t, s, ids);

  t.advance(10);
  assert(!tick(t, s) && phaseOf(s) === "wait", "wait: quiet tick reports no change");
  until(t, s, (x) => x.phase === "go", 10_000, 10);
  assertNoLeaks(t, s, ids);
  assertViewsJsonSafe(t, s, ids);
  assert(view(t, s, "spectator").you === null && view(t, s, ids[0]).you?.status === "none", "you: null for spectators");
  t.advance(10);
  assert(!tick(t, s) && phaseOf(s) === "go", "go: quiet tick reports no change");

  // Reaction times stay secret during the signal; your own is shown to you only.
  t.advance(500);
  assert(tap(t, s, ids[0], 337) === true, "valid tap accepted");
  assert(view(t, s, ids[0]).you?.rt === 337 && view(t, s, ids[0]).you?.status === "drew", "you see your own time");
  for (const other of [ids[1], ids[2], "spectator"]) {
    assert(!numbers(view(t, s, other)).includes(337), "others can't see your time before the result");
    assert(view(t, s, other).live[ids[0]] === "drew", "others see that you drew");
  }
  assert(tap(t, s, ids[0], 120) === false && s.taps[ids[0]].rt === 337, "only the first tap counts");

  // Window closes 2s after the signal even if someone never taps.
  assert(tap(t, s, ids[1], 410) === true, "second tap accepted");
  assert(phaseOf(s) === "go", "still waiting for the third player");
  until(t, s, (x) => x.phase === "result", TIMING.goWindowMs + 100, 10);
  assert(s.last?.winners.join() === ids[0], "fastest wins the round");
  assert(s.scores[ids[0]] === 1 && s.scores[ids[1]] === 0, "+1 to the winner only");
  assert(s.best[ids[0]] === 337 && s.best[ids[1]] === 410 && s.best[ids[2]] === null, "best times tracked");
  const order = s.last!.entries.map((e) => e.id).join();
  assert(order === [ids[0], ids[1], ids[2]].join(), "entries ranked fastest first, no-draws after");
  const v = view(t, s, "spectator");
  assert(v.last?.entries[0].rt === 337 && v.timer !== null && v.timer.total === TIMING.resultMs, "result is public");
  assertViewsJsonSafe(t, s, ids);

  // result -> next round after 3.5s
  t.advance(TIMING.resultMs - 10);
  assert(!tick(t, s) && phaseOf(s) === "result", "result holds");
  t.advance(10);
  assert(tick(t, s) && phaseOf(s) === "ready" && roundOf(s) === 2, "result -> next round");
  assert(Object.keys(s.taps).length === 0 && view(t, s, ids[0]).last === null, "round state cleared");
}

// ---------- the wait lasts 1.5-5s; ~30% of rounds have a 700ms fake-out ----------
{
  let rounds = 0;
  let fakes = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { t, s, ids } = setup(2, seed);
    let r = 0;
    while (phaseOf(s) !== "over") {
      until(t, s, (x) => x.phase === "wait", 10_000, 10);
      const waitStart = t.ctx.now();
      let fakeStart = -1;
      let fakeEnd = -1;
      while (phaseOf(s) !== "go") {
        t.advance(10);
        tick(t, s);
        if (phaseOf(s) === "fake") {
          if (fakeStart < 0) fakeStart = t.ctx.now();
          assertNoLeaks(t, s, ids);
          assert(view(t, s, ids[0]).fakeText === s.fakeText && !!s.fakeText, "fake word shown during fake");
        } else if (fakeStart >= 0 && fakeEnd < 0) fakeEnd = t.ctx.now();
        assert(t.ctx.now() - waitStart <= TIMING.waitMaxMs + 50, "signal never later than ~5s");
      }
      const total = t.ctx.now() - waitStart;
      rounds++;
      if (fakeStart >= 0) {
        fakes++;
        assert(fakeStart - waitStart >= TIMING.fakeAfterMinMs, "fake not too early");
        assert(fakeEnd - fakeStart >= TIMING.fakeMs && fakeEnd - fakeStart <= TIMING.fakeMs + 10, "fake lasts ~700ms");
        assert(t.ctx.now() - fakeEnd >= TIMING.postFakeMinMs - 10, "real signal comes well after the fake");
      } else {
        assert(total >= TIMING.waitMinMs && total <= TIMING.waitMaxMs + 10, `plain wait in 1.5-5s (got ${total})`);
      }
      // Alternate winners so games run 9 rounds.
      t.advance(400);
      const w = ids[r++ % 2];
      tap(t, s, w, 200);
      tap(t, s, ids.find((id) => id !== w)!, 300);
      assert(phaseOf(s) === "result" || phaseOf(s) === "over", "both tapped -> resolved at once");
    }
  }
  const rate = fakes / rounds;
  assert(rate > 0.2 && rate < 0.4, `fake-outs in ~30% of rounds (got ${(rate * 100).toFixed(1)}% of ${rounds})`);
}

// ---------- fouls: tapping during wait or fake knocks you out of the round ----------
{
  const { t, s, ids } = inWait(3, false);
  assert(tap(t, s, ids[0], 180) === true, "wait tap accepted as a foul");
  assert(s.taps[ids[0]].foul === "wait" && view(t, s, ids[1]).live[ids[0]] === "foul", "foul is public");
  assert(view(t, s, ids[0]).you?.status === "foul", "fouler sees it");
  assert(tap(t, s, ids[0]) === false, "second tap after a foul is ignored");
  until(t, s, (x) => x.phase === "go", 10_000, 10);
  assert(tap(t, s, ids[0], 150) === false, "fouled player can't tap at the signal");
  t.advance(250);
  tap(t, s, ids[1], 260);
  assert(phaseOf(s) === "go", "waiting for the last live player");
  tap(t, s, ids[2], null); // tapped before its screen showed the signal
  assert(phaseOf(s) === "result", "all non-fouled players tapped -> early advance");
  const e = Object.fromEntries(s.last!.entries.map((x) => [x.id, x]));
  assert(e[ids[0]].foul === "wait" && e[ids[2]].foul === "wait" && e[ids[1]].win, "null-rt tap at go is a foul");
  assert(s.fouls[ids[0]] === 1 && s.fouls[ids[2]] === 1 && s.scores[ids[1]] === 1, "foul tallies kept");
  assert(s.last!.entries.map((x) => x.id).join() === [ids[1], ids[0], ids[2]].join(), "fouls ranked last");
}
{
  const { t, s, ids } = inWait(3, true);
  assertNoLeaks(t, s, ids);
  const plain = inWait(3, false);
  const keysA = Object.keys(view(t, s, ids[0])).join();
  const keysB = Object.keys(view(plain.t, plain.s, plain.ids[0])).join();
  assert(keysA === keysB, "a planned fake doesn't change the shape of the view");
  until(t, s, (x) => x.phase === "fake", 5_000, 10);
  const word = s.fakeText!;
  assert(tap(t, s, ids[0]) === true && s.taps[ids[0]].foul === "fake", "falling for the fake is a foul");
  until(t, s, (x) => x.phase === "wait", 2_000, 10);
  assert(tap(t, s, ids[1]) === true && s.taps[ids[1]].foul === "wait", "tap after the fake, before go: foul");
  // Last one standing: the round still waits for the real signal.
  assert(phaseOf(s) === "wait", "one live player left: keep waiting");
  until(t, s, (x) => x.phase === "go", 5_000, 10);
  t.advance(300);
  tap(t, s, ids[2], 222);
  assert(phaseOf(s) === "result" && s.last!.winners.join() === ids[2], "survivor wins the round");
  assert(s.last!.fakeText === word, "fake word recorded for the result screen");
}
{
  // Everyone fouls -> straight to the result, nobody scores.
  const { t, s, ids } = inWait(3, false);
  tap(t, s, ids[0]);
  tap(t, s, ids[1]);
  assert(phaseOf(s) === "wait", "still someone left");
  tap(t, s, ids[2]);
  assert(phaseOf(s) === "result" && s.last!.winners.length === 0, "all fouled -> result, no winner");
  assert(ids.every((id) => s.scores[id] === 0 && s.fouls[id] === 1), "no points, fouls counted");
  assert(s.idleRounds === 0, "fouls count as activity");
}

// ---------- reaction-time clamping and ties ----------
{
  const { t, s, ids } = inWait(4, false);
  until(t, s, (x) => x.phase === "go", 10_000, 10);
  t.advance(300);
  tap(t, s, ids[0], 5); // impossible -> floor 100
  tap(t, s, ids[1], 99_999); // can't be slower than the server saw -> 300 + 50
  tap(t, s, ids[2], 123.4); // rounded
  tap(t, s, ids[3], -50); // floor
  assert(s.taps[ids[0]].rt === 100, "rt floored at 100ms");
  assert(s.taps[ids[1]].rt === 350, `rt capped at time since signal + 50ms (got ${s.taps[ids[1]].rt})`);
  assert(s.taps[ids[2]].rt === 123, "rt rounded");
  assert(s.taps[ids[3]].rt === 100, "negative rt floored");
  assert(phaseOf(s) === "result", "everyone tapped -> result");
  assert(s.last!.winners.join() === [ids[0], ids[3]].join(), "exact ties all win");
  assert(s.scores[ids[0]] === 1 && s.scores[ids[3]] === 1 && s.scores[ids[2]] === 0, "tied winners both score");
}

// ---------- full game: first to 5, ctx.end exactly once ----------
{
  const { t, s, ids, results } = setup(3, 7);
  const bestOf0: number[] = [];
  let rounds = 0;
  while (phaseOf(s) !== "over") {
    assert(rounds++ < 20, "game should finish");
    until(t, s, (x) => x.phase === "go", 30_000);
    t.advance(400);
    const rt0 = 180 + rounds * 7;
    bestOf0.push(rt0);
    tap(t, s, ids[1], 290);
    tap(t, s, ids[0], rt0);
    tap(t, s, ids[2], 410);
    if (phaseOf(s) === "over") break;
    assert(phaseOf(s) === "result", "resolved after all taps");
    assertViewsJsonSafe(t, s, ids);
  }
  assert(rounds === TARGET, `ends after ${TARGET} rounds (got ${rounds})`);
  assert(results.length === 1, "ctx.end called exactly once");
  const r = results[0];
  assert(r.winners.join() === ids[0], "fastest player wins");
  assert(r.scores?.[ids[0]] === TARGET && r.scores?.[ids[1]] === 0 && r.scores?.[ids[2]] === 0, "final scores");
  assert(r.headline === `Player0 wins Quick Draw 5–0 · best ${Math.min(...bestOf0)} ms`, `headline: ${r.headline}`);
  assert(s.best[ids[0]] === Math.min(...bestOf0) && s.best[ids[1]] === 290, "best reaction kept");
  const fv = view(t, s, ids[1]);
  assert(fv.phase === "over" && fv.winners.join() === ids[0] && fv.endReason === "target", "final view");
  assert(fv.last?.round === TARGET && fv.last.winners.join() === ids[0], "final round summary kept");
  assertViewsJsonSafe(t, s, ids);
  // Nothing moves after the end.
  assert(tap(t, s, ids[0]) === false, "actions ignored after the end");
  t.advance(60_000);
  assert(!tick(t, s) && phaseOf(s) === "over", "ticks are no-ops after the end");
  disconnect(t, s, ids[0]);
  reconnect(t, s, ids[0]);
  assert(results.length === 1 && phaseOf(s) === "over", "still ended exactly once");
}

// ---------- tie at the finish line ----------
{
  const { t, s, ids, results } = setup(3, 11);
  for (const id of ids) s.scores[id] = id === ids[2] ? 2 : TARGET - 1;
  until(t, s, (x) => x.phase === "go", 30_000);
  t.advance(250);
  tap(t, s, ids[0], 211);
  tap(t, s, ids[1], 211);
  tap(t, s, ids[2], 199.6); // rounds to 200 -> fastest
  assert(phaseOf(s) === "result" && s.scores[ids[2]] === 3, "a faster third player just scores");
  until(t, s, (x) => x.phase === "go", 30_000);
  t.advance(250);
  tap(t, s, ids[0], 211);
  tap(t, s, ids[1], 211);
  tap(t, s, ids[2], 260);
  assert(phaseOf(s) === "over" && results.length === 1, "game over");
  assert(results[0].winners.join() === [ids[0], ids[1]].join(), "both tied leaders win");
  assert(results[0].headline === "Dead heat! Player0 & Player1 tie at 5", `tie headline: ${results[0].headline}`);
}

// ---------- hostile and malformed actions ----------
{
  const { t, s, ids } = inWait(3, false);
  const junk: unknown[] = [
    null,
    undefined,
    "tap",
    42,
    true,
    [],
    ["tap", 1],
    {},
    { type: "TAP", round: s.round },
    { type: "tap" },
    { type: "tap", round: String(s.round) },
    { type: "tap", round: s.round + 0.5 },
    { type: "tap", round: s.round + 1 },
    { type: "tap", round: s.round - 1 },
    { type: "tap", round: s.round, rt: "100" },
    { type: "tap", round: s.round, rt: {} },
    { type: "tap", round: s.round, rt: [] },
    { type: "tap", round: s.round, rt: NaN },
    { type: "tap", round: s.round, rt: Infinity },
    { type: "tap", round: s.round, rt: true },
    { type: "x".repeat(100_000), round: s.round },
    JSON.parse(`{"__proto__": {"type": "tap"}, "round": ${s.round}}`),
  ];
  const before = JSON.stringify(s);
  for (const a of junk) assert(game.action(s, ids[0], a, t.ctx) === false, `rejected: ${String(JSON.stringify(a)).slice(0, 60)}`);
  assert(game.action(s, "spectator", { type: "tap", round: s.round, rt: null }, t.ctx) === false, "spectators can't act");
  assert(game.action(s, "", { type: "tap", round: s.round, rt: null }, t.ctx) === false, "unknown ids can't act");
  assert(JSON.stringify(s) === before, "rejected actions leave state untouched");

  // A tap still in flight from last round must not foul you in the next one.
  until(t, s, (x) => x.phase === "go", 10_000, 10);
  t.advance(200);
  ids.forEach((id) => tap(t, s, id, 200));
  until(t, s, (x) => x.phase === "wait", 10_000, 10);
  assert(game.action(s, ids[0], { type: "tap", round: s.round - 1, rt: 200 }, t.ctx) === false, "stale round rejected");
  assert(!s.taps[ids[0]], "no foul from a stale tap");
  // Wrong phases.
  until(t, s, (x) => x.phase === "go", 10_000, 10);
  t.advance(200);
  ids.forEach((id) => tap(t, s, id, 300));
  assert(phaseOf(s) === "result" && tap(t, s, ids[0]) === false, "result phase ignores taps");
}

// ---------- disconnects in every phase ----------
{
  // ready: 3 players, one drops -> carry on; 2 players, one drops -> pause, then resume.
  const a = setup(3);
  disconnect(a.t, a.s, a.ids[2]);
  assert(phaseOf(a.s) === "ready", "2 of 3 online: keep going");
  until(a.t, a.s, (x) => x.phase === "go", 10_000);
  a.t.advance(200);
  tap(a.t, a.s, a.ids[0], 230);
  tap(a.t, a.s, a.ids[1], 260);
  assert(phaseOf(a.s) === "result", "disconnected player isn't waited for");
  assert(a.s.last!.entries.find((e) => e.id === a.ids[2])?.away === true, "marked away");
  reconnect(a.t, a.s, a.ids[2]);
  until(a.t, a.s, (x) => x.phase === "go", 30_000);
  a.t.advance(200);
  tap(a.t, a.s, a.ids[0], 230);
  tap(a.t, a.s, a.ids[1], 260);
  assert(phaseOf(a.s) === "go", "returned player is waited for again");

  const b = setup(2);
  const round = b.s.round;
  disconnect(b.t, b.s, b.ids[1]);
  assert(phaseOf(b.s) === "paused" && b.s.pauseReason === "away", "ready: below 2 online -> paused");
  const pv = view(b.t, b.s, b.ids[0]);
  assert(pv.pauseReason === "away" && pv.timer?.total === TIMING.awayGraceMs, "pause countdown visible");
  b.t.advance(5_000);
  assert(!tick(b.t, b.s), "paused holds");
  reconnect(b.t, b.s, b.ids[1]);
  assert(phaseOf(b.s) === "ready" && roundOf(b.s) === round + 1, "back to 2 -> new round");
}
{
  // wait: a drop that leaves only fouled players resolves the round at once.
  const { t, s, ids } = inWait(3, false);
  tap(t, s, ids[0]);
  tap(t, s, ids[1]);
  disconnect(t, s, ids[2]);
  assert(phaseOf(s) === "result" && s.last!.winners.length === 0, "only fouled players left -> result");
  // wait: below 2 online voids the round (fouls discarded) and pauses.
  const w = inWait(2, false);
  tap(w.t, w.s, w.ids[0]);
  disconnect(w.t, w.s, w.ids[1]);
  assert(phaseOf(w.s) === "paused" && w.s.fouls[w.ids[0]] === 0, "voided round: no foul recorded");
  assertViewsJsonSafe(w.t, w.s, w.ids);
}
{
  // fake: drop during the fake-out.
  const { t, s, ids } = inWait(2, true);
  until(t, s, (x) => x.phase === "fake", 5_000, 10);
  disconnect(t, s, ids[0]);
  assert(phaseOf(s) === "paused" && s.fakeText === null, "fake: below 2 online -> paused, round voided");
  reconnect(t, s, ids[0]);
  assert(phaseOf(s) === "ready", "resumes with a fresh round");
}
{
  // go: the last untapped player leaving resolves the round immediately.
  const { t, s, ids } = inWait(3, false);
  until(t, s, (x) => x.phase === "go", 10_000, 10);
  t.advance(200);
  tap(t, s, ids[0], 240);
  tap(t, s, ids[1], 260);
  disconnect(t, s, ids[2]);
  assert(phaseOf(s) === "result" && s.last!.winners.join() === ids[0], "go: leaver no longer blocks the round");
  // go: everyone gone -> window still closes, then the game pauses and finally ends.
  const g = inWait(2, false);
  until(g.t, g.s, (x) => x.phase === "go", 10_000, 10);
  disconnect(g.t, g.s, g.ids[0]);
  assert(phaseOf(g.s) === "go", "one player still online: keep the window open");
  disconnect(g.t, g.s, g.ids[1]);
  assert(phaseOf(g.s) === "result", "nobody online -> resolve");
  until(g.t, g.s, (x) => x.phase === "paused", 10_000);
  until(g.t, g.s, (x) => x.phase === "over", TIMING.awayGraceMs + 100);
  assert(g.results.length === 1 && g.results[0].winners.length === 0, "everyone left, nobody scored: no winner");
  assert(g.results[0].headline === "Everyone left · no winner", `headline: ${g.results[0].headline}`);
}
{
  // result: one of two leaves; the next round can't start -> pause -> ends with the stayer winning.
  const { t, s, ids, results } = setup(2, 3);
  until(t, s, (x) => x.phase === "go", 10_000);
  t.advance(200);
  tap(t, s, ids[1], 230);
  tap(t, s, ids[0], 260);
  assert(phaseOf(s) === "result" && s.scores[ids[1]] === 1, "p1 leads");
  disconnect(t, s, ids[1]);
  assert(phaseOf(s) === "result", "result screen finishes first");
  until(t, s, (x) => x.phase === "paused", TIMING.resultMs + 100);
  t.advance(TIMING.awayGraceMs - 100);
  assert(!tick(t, s) && phaseOf(s) === "paused", "grace period holds");
  t.advance(100);
  assert(tick(t, s) && phaseOf(s) === "over", "grace over -> game ends");
  assert(results.length === 1 && results[0].winners.join() === ids[0], "the player who stayed wins by default");
  assert(results[0].headline === "Player0 wins by default · everyone else left", `headline: ${results[0].headline}`);
  assert(view(t, s, ids[0]).endReason === "away", "end reason in view");
}

// ---------- idle: 3 rounds with no taps at all -> pause; a tap resumes ----------
{
  const { t, s, ids, results } = setup(3, 5);
  for (let i = 0; i < TIMING.idleRounds; i++) {
    until(t, s, (x) => x.phase === "go", 10_000);
    until(t, s, (x) => x.phase === "result", TIMING.goWindowMs + 100);
    assert(s.last!.entries.every((e) => e.rt === null && !e.foul && !e.away), "nobody drew");
  }
  until(t, s, (x) => x.phase !== "result", TIMING.resultMs + 100);
  assert(phaseOf(s) === "paused" && s.pauseReason === "idle", "3 idle rounds -> idle pause");
  assert(view(t, s, "spectator").pauseReason === "idle", "spectators see the pause");
  assert(game.action(s, ids[2], { type: "tap", round: s.round - 1, rt: null }, t.ctx) === false, "stale resume rejected");
  const round = s.round;
  assert(tap(t, s, ids[2], null) === true && phaseOf(s) === "ready" && roundOf(s) === round + 1, "a tap resumes play");
  assert(s.idleRounds === 0, "idle counter reset");

  for (let i = 0; i < TIMING.idleRounds; i++) {
    until(t, s, (x) => x.phase === "go", 10_000);
    until(t, s, (x) => x.phase === "result", TIMING.goWindowMs + 100);
  }
  until(t, s, (x) => x.phase === "paused", TIMING.resultMs + 100);
  s.scores[ids[1]] = 2; // someone was ahead before everyone wandered off
  t.advance(1_000);
  assert(!tick(t, s) && phaseOf(s) === "paused", "idle pause holds quietly");
  until(t, s, (x) => x.phase === "over", TIMING.idleGraceMs + 100, 500);
  assert(results.length === 1 && results[0].winners.join() === ids[1], "idle timeout ends with the leader winning");
  assert(results[0].headline === "Everyone holstered · Player1 led with 2", `headline: ${results[0].headline}`);
}

{
  // Resuming an idle pause with only one player online falls back to waiting for players.
  const { t, s, ids } = setup(2, 6);
  for (let i = 0; i < TIMING.idleRounds; i++) {
    until(t, s, (x) => x.phase === "go", 10_000);
    until(t, s, (x) => x.phase === "result", TIMING.goWindowMs + 100);
  }
  until(t, s, (x) => x.phase === "paused", TIMING.resultMs + 100);
  t.ctx.player(ids[1])!.connected = false; // dropped without the room noticing yet
  assert(tap(t, s, ids[0], null) === true, "resume tap accepted");
  assert(phaseOf(s) === "paused" && s.pauseReason === "away", "not enough players -> away pause");
  game.playerLeft!(s, ids[1], t.ctx);
  reconnect(t, s, ids[1]);
  assert(phaseOf(s) === "ready", "player back -> play resumes");
}

// ---------- min and max player counts ----------
{
  // 12 players, random-ish skill: someone reaches 5 and ties are handled.
  const { t, s, ids, results } = setup(12, 99);
  let guard = 0;
  let rng = 12345;
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  while (phaseOf(s) !== "over") {
    assert(guard++ < 200, "12-player game finishes");
    until(t, s, (x) => x.phase === "go", 30_000);
    t.advance(700);
    for (const [i, id] of ids.entries()) {
      if (i === 11 && guard % 3 === 0) continue; // someone occasionally misses
      tap(t, s, id, 150 + Math.floor(rand() * 40) * 10 + i);
    }
    if (phaseOf(s) !== "over") until(t, s, (x) => x.phase === "result" || x.phase === "over", 2_500);
  }
  const r = results[0];
  const max = Math.max(...ids.map((id) => s.scores[id]));
  assert(results.length === 1 && max === TARGET, "first to 5");
  assert(r.winners.length >= 1 && r.winners.every((id) => s.scores[id] === TARGET), "winners are the leaders");
  assert(Object.keys(r.scores ?? {}).length === 12, "scores for all 12");
  assertViewsJsonSafe(t, s, ids);
}
{
  // 2 players: straightforward duel.
  const { t, s, ids, results } = setup(2, 21);
  while (phaseOf(s) !== "over") {
    until(t, s, (x) => x.phase === "go", 30_000);
    t.advance(300);
    tap(t, s, ids[1], 199);
    tap(t, s, ids[0], 250);
  }
  assert(results.length === 1 && results[0].winners.join() === ids[1], "2-player duel ends");
  assert(results[0].headline === "Player1 wins Quick Draw 5–0 · best 199 ms", `headline: ${results[0].headline}`);
}

// ---------- player ids that collide with Object.prototype keys ----------
{
  const weird = ["__proto__", "constructor", "toString"];
  const { t, s, ids, results } = setup(3, 8, weird);
  assert(ids.join() === weird.join(), "custom ids applied");
  assert(weird.every((id) => s.scores[id] === 0 && !s.taps[id]), "clean stats for odd ids");
  while (phaseOf(s) !== "over") {
    until(t, s, (x) => x.phase === "go", 30_000);
    t.advance(300);
    assert(tap(t, s, "constructor", 200) === true, "'constructor' can tap");
    assert(tap(t, s, "__proto__", 240) === true, "'__proto__' can tap");
    tap(t, s, "toString", 260);
  }
  assert(results[0].winners.join() === "constructor" && results[0].scores?.["constructor"] === TARGET, "odd ids score");
  const json = JSON.stringify(view(t, s, "__proto__"));
  assert(json.includes('"__proto__":0') && json.includes('"constructor":5'), "odd ids survive serialisation");
}

console.log("reflex: all tests passed");
