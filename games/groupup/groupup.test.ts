import { assert, makeTestCtx } from "../../shared/testing";
import type { Settings } from "../../shared/settings";
import game, { bank, pickPuzzles, type GroupUpState } from "./server";
import { BANK } from "./bank";
import { PUZZLE_MS, READY_MS, REVEAL_MS, puzzleScore, type GroupUpView } from "./shared";

function start(n: number, seed = 7, settings: Settings = {}, memory: Record<string, unknown> = {}) {
  const t = makeTestCtx(n, seed, settings, 0, memory);
  const s: GroupUpState = game.setup(t.ctx);
  return { t, s };
}
type G = ReturnType<typeof start>;
const res = (g: G) => g.t.result;
const act = (g: G, who: string, a: unknown) => game.action(g.s, who, a, g.t.ctx);
const tick = (g: G) => game.tick!(g.s, g.t.ctx);
const view = (g: G, id: string) => game.view(g.s, id, g.t.ctx) as GroupUpView;
function go(g: G) {
  g.t.advance(READY_MS);
  tick(g);
  assert(g.s.phase === "play", "play after countdown");
}
const cur = (g: G, id: string) => g.s.puzzles[g.s.runs[id].idx];
/** Solves group `gi` of the player's current puzzle. */
const solveGroup = (g: G, id: string, gi: number) => act(g, id, { type: "guess", p: g.s.runs[id].idx, w: cur(g, id).groups[gi].w });
function clear(g: G, id: string) {
  for (let gi = 0; gi < 4; gi++) assert(solveGroup(g, id, gi) === true, "group solves");
}
/** Three from one group + one from another: one away. */
function oneAway(g: G, id: string, a = 0, b = 1) {
  const pz = cur(g, id);
  return [...pz.groups[a].w.slice(0, 3), pz.groups[b].w[0]];
}

// ---------- the bank ----------
{
  const all = bank();
  assert(all.length >= 120, `at least 120 puzzles (${all.length})`);
  assert(new Set(all.map((p) => p.id)).size === all.length, "unique ids");
  for (const p of all) {
    const words = p.groups.flatMap((g) => g.words);
    assert(p.groups.length === 4 && p.groups.every((g) => g.words.length === 4 && g.title.length > 0), "4 groups of 4");
    assert(new Set(words).size === 16, `16 distinct words in ${p.groups[0].title}`);
    assert(words.every((w) => /^[A-Z]+( [A-Z]+)?$/.test(w) && w.length <= 10), "tile-friendly words");
  }
  assert(BANK.length === all.length, "parsed everything");
}

// ---------- puzzle picking: seeded, shuffled, no repeats in a room ----------
{
  let x = 5;
  const r = () => ((x = (x * 16807) % 2147483647), x / 2147483647);
  const mem: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (let k = 0; k < 40; k++) for (const p of pickPuzzles(3, r, mem)) {
    assert(!seen.has(p.id) || seen.size >= 100, "no repeats until the bank runs low");
    seen.add(p.id);
    assert(p.words.length === 16 && p.groups.every((g) => g.w.length === 4), "puzzle shape");
    const all = p.groups.flatMap((g) => g.w).sort((a, b) => a - b);
    assert(all.join(",") === Array.from({ length: 16 }, (_, i) => i).join(","), "groups cover every tile once");
  }
  assert((mem.used as string[]).length <= 100, "memory capped");
  const a = start(1, 99);
  const b = start(3, 99);
  assert(JSON.stringify(a.s.puzzles) === JSON.stringify(b.s.puzzles), "same seed, same puzzles (daily)");
  // Tiles are shuffled: the first group isn't just the first four tiles.
  let inOrder = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const p = start(1, seed).s.puzzles[0];
    if (p.groups[0].w.join(",") === "0,1,2,3") inOrder++;
  }
  assert(inOrder <= 1, "tiles shuffled");
  const mem2: Record<string, unknown> = {};
  const g1 = start(1, 1, {}, mem2);
  const g2 = start(1, 1, {}, mem2);
  assert(g1.s.puzzles[0].id !== g2.s.puzzles[0].id, "room memory avoids a repeat even with the same seed");
}

// ---------- scoring ----------
assert(puzzleScore(4, true, 0, 4, 30_000) === 400 + 160 + 60, "perfect fast clear");
assert(puzzleScore(4, true, 2, 4, PUZZLE_MS) === 400 + 80, "clear with 2 mistakes, slow");
assert(puzzleScore(2, false, 4, 4, 100_000) === 200, "out after 2 groups");
assert(puzzleScore(4, true, 3, 4, PUZZLE_MS) > puzzleScore(3, false, 0, 4, 0), "a group beats any bonus");

// ---------- settings ----------
{
  const g = start(1, 3, { puzzles: 3, mistakes: 5 });
  assert(g.s.puzzles.length === 3 && g.s.maxMistakes === 5, "3 puzzles, 5 mistakes");
  const d = start(1, 3);
  assert(d.s.puzzles.length === 1 && d.s.maxMistakes === 4, "defaults");
  const j = start(1, 3, { puzzles: 9, mistakes: "x" });
  assert(j.s.puzzles.length === 1 && j.s.maxMistakes === 4, "junk falls back");
}

// ---------- solo full game, with every kind of feedback ----------
{
  const g = start(1, 11, { puzzles: 2 });
  const id = g.t.ids[0];
  const v0 = view(g, id);
  assert(v0.phase === "ready" && v0.me!.words.length === 0, "tiles hidden in the countdown");
  assert(act(g, id, { type: "guess", p: 0, w: [0, 1, 2, 3] }) === false, "no guesses in the countdown");
  go(g);
  const v1 = view(g, id);
  assert(v1.me!.words.length === 16 && v1.me!.found.length === 0 && v1.me!.missed.length === 0, "16 tiles, no groups");
  const text = JSON.stringify(v1);
  for (const gr of g.s.puzzles[0].groups) assert(!text.includes(gr.title), "group titles not leaked");
  // One away.
  const before = g.t.events.length;
  assert(act(g, id, { type: "guess", p: 0, w: oneAway(g, id) }) === true, "wrong guess handled");
  assert((g.t.events[before].event as { t: string }).t === "away" && g.t.events[before].to === id, "one away, privately");
  assert(g.s.runs[id].mistakes === 1, "mistake counted");
  // Same guess again (any order) is free.
  assert(act(g, id, { type: "guess", p: 0, w: oneAway(g, id).reverse() }) === false, "repeat refused");
  assert((g.t.events[g.t.events.length - 1].event as { t: string }).t === "dupe" && g.s.runs[id].mistakes === 1, "repeat costs nothing");
  // A right group.
  g.t.advance(5000);
  assert(solveGroup(g, id, 2) === true, "group found");
  const v2 = view(g, id);
  assert(v2.me!.found.length === 1 && v2.me!.found[0].title === g.s.puzzles[0].groups[2].title, "found group shown");
  assert(!JSON.stringify(v2).includes(g.s.puzzles[0].groups[0].title), "other titles still hidden");
  // Can't reuse a locked word.
  assert(act(g, id, { type: "guess", p: 0, w: [g.s.puzzles[0].groups[2].w[0], ...g.s.puzzles[0].groups[0].w.slice(0, 3)] }) === false, "locked word refused");
  for (const gi of [0, 1, 3]) solveGroup(g, id, gi);
  assert(g.s.runs[id].state === "reveal" && g.s.runs[id].results[0].cleared, "puzzle cleared");
  assert(g.s.runs[id].results[0].score === puzzleScore(4, true, 1, 4, 5000), "puzzle scored");
  assert(act(g, id, { type: "guess", p: 0, w: [0, 1, 2, 3] }) === false, "no guesses while revealing");
  // Next puzzle by tapping Next.
  assert(act(g, id, { type: "next", p: 0 }) === true && g.s.runs[id].idx === 1, "next puzzle");
  // Run out of mistakes on puzzle 2: the rest is revealed.
  solveGroup(g, id, 0);
  for (const [a, b] of [[1, 2], [2, 3], [3, 1], [1, 3]]) act(g, id, { type: "guess", p: 1, w: oneAway(g, id, a, b) });
  assert(g.s.runs[id].state === "reveal" && Number(g.s.runs[id].mistakes) === 4, "out of mistakes");
  const v3 = view(g, id);
  assert(v3.me!.missed.length === 3 && v3.me!.found.length === 1, "missed groups revealed");
  // Auto-advance after the reveal ends the game.
  g.t.advance(REVEAL_MS);
  tick(g);
  assert(res(g), "game over");
  assert(res(g)!.winners[0] === id, "solo winner");
  assert(/found 5\/8 groups, 5 mistakes/.test(res(g)!.headline), `headline: ${res(g)!.headline}`);
  assert(res(g)!.scores![id] === g.s.runs[id].total && g.s.runs[id].total > 600, "score reported");
}

// ---------- invalid actions ----------
{
  const g = start(2, 12);
  const [a, b] = g.t.ids;
  go(g);
  const junk: unknown[] = [null, 1, "x", [], {}, { type: "guess" }, { type: "guess", p: 0 }, { type: "guess", p: 0, w: [0, 1, 2] },
    { type: "guess", p: 0, w: [0, 1, 2, 2] }, { type: "guess", p: 0, w: [0, 1, 2, 16] }, { type: "guess", p: 0, w: [0, 1, 2, -1] },
    { type: "guess", p: 0, w: [0, 1, 2, 1.5] }, { type: "guess", p: 0, w: ["0", 1, 2, 3] }, { type: "guess", p: 1, w: [0, 1, 2, 3] },
    { type: "guess", p: "0", w: [0, 1, 2, 3] }, { type: "next", p: 0 }, { type: "__proto__" }, { type: "guess", p: 0, w: new Array(5000).fill(0) }];
  for (const j of junk) assert(act(g, a, j) === false, `junk refused: ${JSON.stringify(j)?.slice(0, 50)}`);
  assert(g.s.runs[a].mistakes === 0, "junk costs nothing");
  assert(act(g, "stranger", { type: "guess", p: 0, w: g.s.puzzles[0].groups[0].w }) === false, "non-player refused");
  solveGroup(g, a, 0);
  const vb = view(g, b);
  assert(vb.me!.found.length === 0 && !JSON.stringify(vb).includes(g.s.puzzles[0].groups[0].title), "b doesn't see a's group");
  assert(vb.board.find((r) => r.id === a)!.found === 1, "board shows a's progress");
}

// ---------- time limit ----------
{
  const g = start(1, 13);
  const id = g.t.ids[0];
  go(g);
  solveGroup(g, id, 0);
  g.t.advance(PUZZLE_MS);
  tick(g);
  assert(g.s.runs[id].state === "reveal" && g.s.runs[id].results[0].found === 1, "time's up reveals the rest");
  g.t.advance(REVEAL_MS);
  tick(g);
  assert(res(g) && res(g)!.scores![id] === 100, "scored the one group");
}

// ---------- multiplayer race + leaving ----------
{
  const g = start(3, 31, { puzzles: 2 });
  const [a, b, c] = g.t.ids;
  go(g);
  g.t.ctx.players[2].connected = false;
  game.playerLeft!(g.s, c, g.t.ctx);
  for (const id of [a, b]) {
    clear(g, id);
    act(g, id, { type: "next", p: 0 });
  }
  clear(g, a);
  act(g, a, { type: "next", p: 1 });
  act(g, b, { type: "guess", p: 1, w: oneAway(g, b) });
  clear(g, b);
  act(g, b, { type: "next", p: 1 });
  assert(!res(g), "waits a little for the dropped player");
  g.t.advance(45_000);
  tick(g);
  assert(res(g), "ends once the dropped player has been gone a while");
  assert(res(g)!.winners.length === 1 && res(g)!.winners[0] === a, "fewer mistakes wins");
  assert(/wins Group Up with \d+ points/.test(res(g)!.headline), res(g)!.headline);
}
{
  const g = start(2, 32);
  const [a, b] = g.t.ids;
  go(g);
  game.playerLeft!(g.s, b, g.t.ctx);
  g.t.advance(5_000);
  game.playerReturned!(g.s, b, g.t.ctx);
  clear(g, a);
  act(g, a, { type: "next", p: 0 });
  g.t.advance(60_000);
  tick(g);
  assert(!res(g), "a returned player is waited for");
  clear(g, b);
  act(g, b, { type: "next", p: 0 });
  assert(res(g) && res(g)!.winners.length === 1 && res(g)!.winners[0] === a, "the faster perfect clear wins");
}

// ---------- spectators ----------
{
  const g = start(2, 41);
  go(g);
  solveGroup(g, g.t.ids[1], 0);
  const v = view(g, "spectator");
  assert(v.me === null && v.watch && v.watch.id === g.t.ids[1], "spectators follow the leader");
}

console.log(`✓ groupup (${bank().length} puzzles)`);
