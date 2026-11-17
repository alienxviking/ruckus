import game, { type HotState } from "./server";
import { assert, makeTestCtx } from "../../shared/testing";
import { QUESTIONS } from "./data";
import { DRUM_MS, LONE_BONUS, READ_PTS, type HotView } from "./shared";
import type { Settings } from "../../shared/settings";

type T = ReturnType<typeof makeTestCtx>;
const ph = (s: HotState): string => s.phase;
const view = (s: HotState, id: string, t: T) => game.view(s, id, t.ctx) as HotView;
const act = (s: HotState, t: T, id: string, a: unknown) => game.action(s, id, a as never, t.ctx);
const tick = (s: HotState, t: T, ms = 0) => {
  t.advance(ms);
  return game.tick!(s, t.ctx);
};
function setup(n: number, settings: Settings = {}, memory: Record<string, unknown> = {}, seed = 3) {
  const t = makeTestCtx(n, seed, settings, 0, memory);
  return { t, s: game.setup(t.ctx) };
}
const hot = (s: HotState) => s.order[s.round];

assert(QUESTIONS.length >= 300, "300+ questions");
assert(QUESTIONS.every((q) => q.length === 3 || q.length === 5), "2 or 4 options");

// --- a scored round ---
{
  const { t, s } = setup(4);
  assert(s.order.length === 8, "auto: twice each with 4");
  const h = hot(s);
  const others = s.ids.filter((id) => id !== h);
  // secrecy
  act(s, t, h, { type: "pick", o: 1 });
  assert(view(s, others[0], t).mine === null && !JSON.stringify(view(s, others[0], t)).includes('"answer"'), "answer hidden from others");
  assert(view(s, h, t).mine === 1, "hot seat sees own pick");
  assert(view(s, "spec", t).mine === null, "spectator view");
  // validation
  assert(act(s, t, others[0], { type: "pick", o: 9 }) === false, "out of range");
  assert(act(s, t, others[0], { type: "pick", o: 1.5 }) === false, "non-integer");
  assert(act(s, t, "stranger", { type: "pick", o: 0 }) === false, "stranger");
  assert(act(s, t, others[0], { type: "next" }) === false, "next only in reveal");
  act(s, t, others[0], { type: "pick", o: 1 });
  act(s, t, others[1], { type: "pick", o: 0 });
  assert(ph(s) === "pick", "still waiting for one");
  act(s, t, others[2], { type: "pick", o: 0 });
  assert(ph(s) === "drum", "everyone in → drumroll");
  assert(view(s, others[0], t).reveal === null, "nothing revealed during drumroll");
  tick(s, t, DRUM_MS + 1);
  assert(ph(s) === "reveal" && s.reveal!.answer === 1, "reveal");
  assert(s.score[others[0]] === READ_PTS + LONE_BONUS, "lone right read gets bonus");
  assert(s.score[others[1]] === 0, "wrong read");
  assert(s.score[h] === Math.round(100 / 3), "hot seat scores share");
  // talk phase: hot seat moves everyone on
  act(s, t, h, { type: "next" });
  assert(ph(s) === "pick" && s.round === 1, "hot seat ends talk");
}

// --- full game with timers only (nobody acts) + full game with everyone acting ---
{
  const { t, s } = setup(3, { pace: "quick", laps: 1 });
  assert(s.order.length === 3 && s.pickMs === 20_000 && s.talkMs === 20_000, "settings honoured");
  for (let i = 0; i < 500 && ph(s) !== "final"; i++) tick(s, t, 1000);
  assert(ph(s) === "final" && t.result && t.result.winners.length === 0, "idle game ends as a draw");
}
{
  const { t, s } = setup(5, { pace: "relaxed" });
  assert(s.order.length === 10 && s.pickMs === 45_000 && s.talkMs === 60_000, "relaxed + auto laps (5 → twice)");
  const seen = new Set<string>();
  let guard = 0;
  while (ph(s) !== "final" && guard++ < 200) {
    if (ph(s) === "pick") {
      seen.add(hot(s));
      const n = QUESTIONS[s.qs[s.round]].length - 1;
      act(s, t, hot(s), { type: "pick", o: 0 });
      for (const id of s.ids) if (id !== hot(s)) act(s, t, id, { type: "pick", o: id === s.ids[0] ? 0 : n - 1 });
    } else if (ph(s) === "drum") tick(s, t, DRUM_MS);
    else if (ph(s) === "reveal") for (const id of s.ids) act(s, t, id, { type: "next" });
  }
  assert(ph(s) === "final" && t.result, "game ends");
  assert(seen.size === 5, "everyone sat in the hot seat");
  assert(t.result.winners.includes(s.ids[0]), "the reader wins");
  assert(new Set(s.qs).size === s.qs.length, "no repeated questions");
  assert(act(s, t, s.ids[0], { type: "next" }) === false, "no actions after end");
}

// --- memory: next game avoids questions just used ---
{
  const memory: Record<string, unknown> = {};
  const a = setup(6, { laps: 2 }, memory, 1);
  for (let i = 0; i < 2000 && ph(a.s) !== "final"; i++) tick(a.s, a.t, 1000);
  const used = new Set(a.s.qs);
  const b = setup(6, { laps: 2 }, memory, 2);
  assert(b.s.qs.every((q) => !used.has(q)), "no repeats within a room");
}

// --- junk ---
{
  const { t, s } = setup(3);
  for (const j of [null, 0, "x", [], {}, { type: "pick" }, { type: "pick", o: "1" }, { type: "pick", o: -1 }, { type: "pick", o: NaN }, { type: "constructor" }])
    for (const id of s.ids) act(s, t, id, j);
  assert(ph(s) === "pick" && s.answer === null, "junk ignored");
}

// --- leaving ---
{
  const { t, s } = setup(4, { laps: 1 });
  const h = hot(s);
  t.ctx.player(h)!.connected = false;
  game.playerLeft!(s, h, t.ctx);
  tick(s, t, 250);
  assert(ph(s) === "drum", "hot seat left without picking → round voided");
  tick(s, t, DRUM_MS + 1);
  assert(s.reveal!.answer === null && Object.values(s.reveal!.pts).every((p) => p === 0), "no points for a void round");
  for (const id of s.ids) if (id !== h) act(s, t, id, { type: "next" });
  assert(ph(s) === "pick" && hot(s) !== h, "moves on without the away player");
  // a guesser leaving doesn't hold up the round
  const h2 = hot(s);
  const g = s.ids.find((id) => id !== h && id !== h2)!;
  t.ctx.player(g)!.connected = false;
  game.playerLeft!(s, g, t.ctx);
  act(s, t, h2, { type: "pick", o: 0 });
  for (const id of s.ids) if (id !== h2 && id !== g && id !== h) act(s, t, id, { type: "pick", o: 0 });
  assert(ph(s) === "drum", "away guesser skipped");
  // everyone leaves → ends
  for (const id of s.ids) {
    t.ctx.player(id)!.connected = false;
    game.playerLeft!(s, id, t.ctx);
  }
  for (let i = 0; i < 100 && ph(s) !== "final"; i++) tick(s, t, 500);
  assert(ph(s) === "final" && t.result!.headline.length > 0, "abandoned game ends");
}

console.log("✓ hotseat tests passed");
