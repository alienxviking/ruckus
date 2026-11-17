import wordwheel, { type WheelState } from "./server";
import { config } from "./config";
import { answersFor, makePuzzle, puzzleCount } from "./dict";
import { usesAll, wordPoints, type NoEvent, type OkEvent, type WheelView } from "./shared";
import { readSettings } from "../../shared/settings";
import { assert, makeTestCtx } from "../../shared/testing";
import type { GameResult } from "../../shared/types";

// ---- scoring ----
assert(wordPoints("team", "abcdemt") === 1, "4 letters = 1");
assert(wordPoints("teams", "aemstxy") === 5, "5 letters = 5");
assert(wordPoints("payment", "aemnpty") === 14, "all seven = 7 + 7");
assert(usesAll("payment", "payment") && !usesAll("team", "payment"), "usesAll");

// ---- every shipped puzzle is healthy ----
{
  const n = puzzleCount();
  assert(n > 200, `enough puzzles (${n})`);
  for (let id = 0; id < n; id++) {
    const pz = makePuzzle(id, () => 0.5);
    const all = pz.centre + pz.ring.join("");
    assert(new Set(all).size === 7 && pz.ring.length === 6, `puzzle ${id} has 7 distinct letters`);
    assert(pz.answers.length >= 20 && pz.answers.length <= 60, `puzzle ${id} answers ${pz.answers.length}`);
    assert(pz.answers.some((w) => w.length === 7 && usesAll(w, all)), `puzzle ${id} has a 7-letter all-seven word`);
    assert(pz.answers.every((w) => w.length >= 4 && w.includes(pz.centre)), `puzzle ${id} answers valid`);
  }
  assert(answersFor("e", [..."paymnt"]).includes("payment"), "answersFor");
}

const ctxPlay = (t: ReturnType<typeof makeTestCtx>, s: WheelState) => {
  t.advance(3100);
  wordwheel.tick!(s, t.ctx);
  assert(s.phase === "play", "playing");
};

// ---- full solo game ----
{
  const t = makeTestCtx(1);
  const s = wordwheel.setup(t.ctx) as WheelState;
  assert(s.puzzles.length === 1 && s.roundMs === 180_000, "defaults: 1 wheel, 3 minutes");
  const id = t.ids[0];
  const pz = s.puzzles[0];
  const all = pz.centre + pz.ring.join("");
  // During the countdown nothing counts; the answers are never in the view while playing.
  assert(wordwheel.action(s, id, { type: "word", r: 0, w: pz.answers[0] }, t.ctx) === false, "countdown");
  ctxPlay(t, s);
  const v0 = wordwheel.view(s, id, t.ctx) as WheelView;
  assert(v0.answers === null && v0.count === pz.answers.length, "answers hidden during play");
  const hidden = pz.answers.filter((w) => w.length >= 6);
  assert(!hidden.some((w) => JSON.stringify(v0).includes(`"${w}"`)), "no answer leaks into the view");
  // Junk.
  for (const junk of [null, 5, "x", [], {}, { type: "word" }, { type: "word", r: 0, w: 7 }, { type: "word", r: 1, w: pz.answers[0] }, { type: "word", r: 0, w: "a".repeat(5000) }, { type: "finish", r: "0" }])
    assert(wordwheel.action(s, id, junk, t.ctx) === false, `junk ${JSON.stringify(junk)}`);
  // Refusals, with the reason.
  const why = (w: string) => {
    const n = t.events.length;
    assert(wordwheel.action(s, id, { type: "word", r: 0, w }, t.ctx) === false, `refuse ${w}`);
    return (t.events[n].event as NoEvent).why;
  };
  const off = [..."abcdefghijklmnopqrtuvwxyz"].find((c) => !all.includes(c))!;
  assert(why(pz.centre + pz.centre + off + pz.centre) === "letters", "letters");
  const noCentre = pz.ring.slice(0, 4).join("");
  assert(why(noCentre) === "centre", "centre");
  assert(why(pz.centre + pz.ring[0]) === "short", "short");
  assert(why(pz.centre.repeat(6)) === "word", "not a word");
  // Play every answer.
  let expect = 0;
  for (const w of pz.answers) {
    const n = t.events.length;
    assert(wordwheel.action(s, id, { type: "word", r: 0, w: w.toUpperCase() }, t.ctx) !== false, `accept ${w}`);
    const ok = t.events[n].event as OkEvent;
    assert(ok.t === "ok" && ok.pts === wordPoints(w, all), "ok event");
    expect += wordPoints(w, all);
  }
  assert(why(pz.answers[0]) === "dup", "dup");
  const v = wordwheel.view(s, id, t.ctx) as WheelView;
  assert(v.me!.pts === expect && v.maxPts === expect, "max points");
  // Finish early ends the wheel (and the game) and reveals the answers.
  wordwheel.action(s, id, { type: "finish", r: 0 }, t.ctx);
  assert(t.result && t.result.scores![id] === expect && t.result.winners[0] === id, "solo result");
  const end = wordwheel.view(s, id, t.ctx) as WheelView;
  assert(end.phase === "over" && end.answers!.length === pz.answers.length, "answers revealed at the end");
  console.log(`  solo: ${pz.answers.length} words, ${expect} points — ${t.result.headline}`);
}

// ---- settings: 2 wheels, 2 minutes; clock ends rounds; between pause ----
{
  const t = makeTestCtx(2, 9, { rounds: 2, time: 120 });
  const s = wordwheel.setup(t.ctx) as WheelState;
  assert(s.puzzles.length === 2 && s.roundMs === 120_000, "settings honoured");
  assert(s.puzzles[0].id !== s.puzzles[1].id, "different wheels");
  assert(readSettings(config.settings, { time: 7 }).time === 180, "bad setting falls back");
  ctxPlay(t, s);
  const [a, b] = t.ids;
  wordwheel.action(s, a, { type: "word", r: 0, w: s.puzzles[0].answers[0] }, t.ctx);
  // b sees a's count and points, not the word.
  const vb = wordwheel.view(s, b, t.ctx) as WheelView;
  assert(vb.board.find((r) => r.id === a)!.words === 1 && !JSON.stringify(vb).includes(`"${s.puzzles[0].answers[0]}"`), "board counts only");
  // Spectators get a sensible view.
  const spec = wordwheel.view(s, "watcher", t.ctx) as WheelView;
  assert(spec.me === null && spec.board.length === 2 && spec.ring.length === 6, "spectator view");
  // One player done isn't enough to end the wheel.
  wordwheel.action(s, a, { type: "finish", r: 0 }, t.ctx);
  assert(s.phase === "play", "waits for b");
  assert(wordwheel.action(s, a, { type: "word", r: 0, w: s.puzzles[0].answers[1] }, t.ctx) === false, "finished players can't play");
  t.advance(120_000);
  wordwheel.tick!(s, t.ctx);
  assert((s.phase as string) === "between", "clock ends the wheel");
  assert(wordwheel.action(s, b, { type: "word", r: 0, w: s.puzzles[0].answers[2] }, t.ctx) === false, "no words between wheels");
  t.advance(10_100);
  wordwheel.tick!(s, t.ctx);
  assert((s.phase as string) === "play" && s.round === 1 && !s.seats[a].finished, "wheel 2");
  // b drops out; a finishing still waits 30 s for them, then ends.
  wordwheel.playerLeft!(s, b, t.ctx);
  wordwheel.action(s, a, { type: "finish", r: 1 }, t.ctx);
  assert((s.phase as string) === "play", "away player still counted for a while");
  t.advance(31_000);
  wordwheel.tick!(s, t.ctx);
  const res = t.result as GameResult | null;
  assert(res && res.winners[0] === a && res.scores![a] > 0, "leaver doesn't soft-lock");
}

// ---- memory / determinism ----
{
  const memory: Record<string, unknown> = {};
  const seen = new Set<number>();
  for (let g = 0; g < 20; g++) {
    const s = wordwheel.setup(makeTestCtx(1, 100 + g, { rounds: 3 }, 0, memory).ctx) as WheelState;
    for (const p of s.puzzles) {
      assert(!seen.has(p.id), "no repeats");
      seen.add(p.id);
    }
  }
  const x = wordwheel.setup(makeTestCtx(1, 5).ctx) as WheelState;
  const y = wordwheel.setup(makeTestCtx(1, 5).ctx) as WheelState;
  assert(JSON.stringify(x.puzzles) === JSON.stringify(y.puzzles), "deterministic (daily)");
}

// ---- bots play a whole game at a human pace ----
{
  const t = makeTestCtx(3, 21, { rounds: 2 }, 2);
  const s = wordwheel.setup(t.ctx) as WheelState;
  let guard = 0;
  let firstAt = 0;
  const start = t.ctx.now();
  while (!t.result && guard++ < 10_000) {
    t.advance(250);
    wordwheel.tick!(s, t.ctx);
    for (const id of ["bot-0", "bot-1"]) {
      const act = wordwheel.bot!(s, id, t.ctx);
      if (act && wordwheel.action(s, id, act, t.ctx) !== false && !firstAt) firstAt = t.ctx.now() - start;
    }
  }
  assert(t.result, "bots finish");
  const counts = ["bot-0", "bot-1"].map((id) => s.seats[id].found.map((f) => f.length));
  const per = counts.flat();
  const answers = s.puzzles.map((p) => p.answers.length);
  assert(per.every((n) => n >= 5), `bots find words ${per}`);
  assert(per.every((n, i) => n <= answers[i % 2] * 0.75), `bots leave plenty to find ${per} of ${answers}`);
  assert(firstAt >= 3000 + 3000 + 5000, `bots think first (${firstAt})`);
  console.log(`  bots found ${JSON.stringify(counts)} of ${answers}`);
}

console.log("✓ wordwheel");
