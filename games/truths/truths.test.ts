import game, { type TruthState } from "./server";
import { assert, makeTestCtx } from "../../shared/testing";
import { DRUM_MS, FOOL_PTS, REVEAL_MS, SPOT_PTS, cleanStatement, type TruthView } from "./shared";
import type { Settings } from "../../shared/settings";

type T = ReturnType<typeof makeTestCtx>;
const ph = (s: TruthState): string => s.phase;
const view = (s: TruthState, id: string, t: T) => game.view(s, id, t.ctx) as TruthView;
const act = (s: TruthState, t: T, id: string, a: unknown) => game.action(s, id, a as never, t.ctx);
const tick = (s: TruthState, t: T, ms = 0) => {
  t.advance(ms);
  return game.tick!(s, t.ctx);
};
function setup(n: number, settings: Settings = {}, seed = 5) {
  const t = makeTestCtx(n, seed, settings);
  return { t, s: game.setup(t.ctx) };
}
const set = (id: string) => [`${id} has been to Peru`, `${id} can juggle`, `${id} met a astronaut`];
const write = (s: TruthState, t: T, id: string, lie = 2, done = true) => act(s, t, id, { type: "save", s: set(id), lie, done });
/** Display index of the presenter's lie. */
const lieShown = (s: TruthState) => s.perm.indexOf(s.drafts[s.order[s.turn]].lie);

// --- helpers ---
assert(cleanStatement("  hi\u0000 there \n you ") === "hi there you", "clean");
assert(cleanStatement("x".repeat(500)).length === 100, "cap");
assert(cleanStatement(42) === "", "non-string");

// --- writing: validation and privacy ---
{
  const { t, s } = setup(3);
  const [a, b, c] = s.ids;
  assert(act(s, t, a, { type: "save", s: ["a", "b"], lie: 0, done: false }) === false, "needs 3");
  assert(act(s, t, a, { type: "save", s: ["aaa", "bbb", 4], lie: 0, done: false }) === false, "strings only");
  assert(act(s, t, a, { type: "save", s: ["aaa", "bbb", "ccc"], lie: 3, done: false }) === false, "lie range");
  assert(act(s, t, a, { type: "save", s: ["aaa", "bbb", "ccc"], lie: 0, done: "yes" }) === false, "done boolean");
  assert(act(s, t, a, { type: "save", s: ["aaa", "aaa", "ccc"], lie: 0, done: true }) === false, "distinct statements");
  assert(act(s, t, a, { type: "save", s: ["aaa", "", "ccc"], lie: 0, done: true }) === false, "complete statements");
  assert(act(s, t, a, { type: "save", s: ["aaa", "bbb", "ccc"], lie: -1, done: true }) === false, "lie must be marked");
  assert(act(s, t, a, { type: "save", s: ["aa", "", ""], lie: -1, done: false }) === false, "draft saved silently");
  assert(s.drafts[a].s[0] === "aa", "draft stored");
  assert(write(s, t, a) === true, "lock in broadcasts");
  assert(view(s, b, t).draft === null && !JSON.stringify(view(s, b, t)).includes("Peru"), "drafts are private");
  assert(view(s, a, t).draft?.done === true, "own draft visible");
  assert(write(s, t, a, 2, false) === true, "unlock to edit");
  write(s, t, a);
  write(s, t, b);
  assert(ph(s) === "write", "waiting for c");
  write(s, t, c);
  assert(ph(s) === "vote" && s.order.length === 3, "everyone locked → presenting");
  const v = view(s, a, t);
  assert(v.statements.length === 3 && !JSON.stringify(v).includes('"lie"'), "lie not leaked while voting");
  assert(view(s, "spec", t).statements.length === 3 && view(s, "spec", t).myVote === null, "spectator sees statements");
}

// --- a full game ---
{
  const { t, s } = setup(4);
  for (const id of s.ids) write(s, t, id);
  let guard = 0;
  const presented = new Set<string>();
  while (ph(s) !== "final" && guard++ < 50) {
    assert(ph(s) === "vote", "vote phase");
    const p = s.order[s.turn];
    presented.add(p);
    const lie = lieShown(s);
    const voters = s.ids.filter((id) => id !== p);
    assert(act(s, t, p, { type: "vote", o: 0 }) === false, "presenter can't vote");
    assert(act(s, t, voters[0], { type: "vote", o: 3 }) === false, "range");
    assert(act(s, t, p, { type: "reveal" }) === false, "can't reveal before votes are in");
    const before = { ...s.score };
    act(s, t, voters[0], { type: "vote", o: lie });
    act(s, t, voters[1], { type: "vote", o: (lie + 1) % 3 });
    act(s, t, voters[2], { type: "vote", o: (lie + 2) % 3 });
    assert(ph(s) === "vote", "voting doesn't cut the conversation short");
    assert(act(s, t, voters[2], { type: "reveal" }) === false, "only the reader reveals");
    assert(act(s, t, p, { type: "reveal" }) === true, "reader reveals");
    assert(ph(s) === "drum" && view(s, voters[0], t).reveal === null, "drumroll hides the answer");
    tick(s, t, DRUM_MS + 1);
    assert(ph(s) === "reveal", "reveal");
    assert(s.score[voters[0]] - before[voters[0]] === SPOT_PTS, "spotter +100");
    assert(s.score[voters[1]] - before[voters[1]] === 0, "fooled 0");
    assert(s.score[p] - before[p] === 2 * FOOL_PTS, "liar +50 per fooled");
    assert(view(s, voters[1], t).reveal?.lie === lie, "reveal shows the lie");
    act(s, t, voters[0], { type: "next" });
    assert(ph(s) === "reveal", "one ready isn't enough");
    act(s, t, p, { type: "next" });
  }
  assert(ph(s) === "final" && t.result, "ends");
  assert(presented.size === 4, "everyone presented");
  assert(t.result.winners.length > 0 && t.result.headline.length > 0, "winner");
  assert(act(s, t, s.ids[0], { type: "next" }) === false, "nothing after the end");
}

// --- timers & settings: unlocked complete drafts count; empty writers are skipped ---
{
  const { t, s } = setup(3, { write: 180, talk: 60 });
  assert(s.writeMs === 180_000 && s.talkMs === 60_000, "settings honoured");
  write(s, t, s.ids[0], 1, false); // complete but never locked
  act(s, t, s.ids[1], { type: "save", s: ["only one", "", ""], lie: -1, done: false });
  tick(s, t, 180_001);
  assert(ph(s) === "vote" && s.order.length === 1 && s.order[0] === s.ids[0], "complete draft counts at the bell");
  tick(s, t, 60_001);
  assert(ph(s) === "drum", "talk timer");
  tick(s, t, DRUM_MS + 1);
  tick(s, t, REVEAL_MS + 1);
  assert(ph(s) === "final" && t.result, "ends after the only set");
  const bad = setup(3, { write: 7, talk: "x" });
  assert(bad.s.writeMs === 300_000 && bad.s.talkMs === 90_000, "defaults");
}
{
  const { t, s } = setup(3);
  tick(s, t, 300_001);
  assert(ph(s) === "final" && t.result!.winners.length === 0, "nobody wrote → ends cleanly");
}

// --- junk ---
{
  const { t, s } = setup(3);
  for (const j of [null, 1, "x", [], {}, { type: "save" }, { type: "save", s: "abc", lie: 0, done: true }, { type: "vote", o: 1 }, { type: "reveal" }, { type: "next" }, { type: "__proto__" }])
    for (const id of [...s.ids, "stranger"]) act(s, t, id, j);
  assert(ph(s) === "write" && Object.values(s.drafts).every((d) => !d.done), "junk ignored");
}

// --- leaving ---
{
  const { t, s } = setup(4);
  for (const id of s.ids.slice(0, 3)) write(s, t, id);
  const away = s.ids[3];
  t.ctx.player(away)!.connected = false;
  game.playerLeft!(s, away, t.ctx);
  tick(s, t, 250);
  assert(ph(s) === "vote" && s.order.length === 3, "writer who left doesn't hold up writing");
  // presenter leaves: votes still finish the turn
  const p = s.order[s.turn];
  t.ctx.player(p)!.connected = false;
  game.playerLeft!(s, p, t.ctx);
  for (const id of s.ids) if (id !== p && id !== away) act(s, t, id, { type: "vote", o: 0 });
  assert(ph(s) === "drum", "no soft-lock when the reader drops");
  tick(s, t, DRUM_MS + 1);
  for (const id of s.ids) if (id !== p && id !== away) act(s, t, id, { type: "next" });
  assert(ph(s) === "vote" && s.order[s.turn] !== p, "next player");
  // everyone leaves → abandoned
  for (const id of s.ids) {
    t.ctx.player(id)!.connected = false;
    game.playerLeft!(s, id, t.ctx);
  }
  for (let i = 0; i < 100 && ph(s) !== "final"; i++) tick(s, t, 500);
  assert(ph(s) === "final" && t.result!.headline.startsWith("Not enough"), "abandoned");
}

console.log("✓ truths tests passed");
