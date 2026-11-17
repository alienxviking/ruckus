import { assert, makeTestCtx } from "../../shared/testing";
import type { Settings } from "../../shared/settings";
import game, { type NineboxState } from "./server";
import { grade, logicSolve, makePuzzle, shapeOf, solve, type Level, type Size } from "./sudoku";
import { LIMIT_MS, PAR_MS, READY_MS, SOLVED_FLOOR, PARTIAL_POINTS, score, type NineboxView } from "./shared";

function start(n: number, seed = 7, settings: Settings = {}, bots = 0) {
  const t = makeTestCtx(n, seed, settings, bots);
  const s: NineboxState = game.setup(t.ctx);
  return { t, s };
}
type G = ReturnType<typeof start>;
const res = (g: G) => g.t.result;
const act = (g: G, who: string, a: unknown) => game.action(g.s, who, a, g.t.ctx);
const tick = (g: G) => game.tick!(g.s, g.t.ctx);
const view = (g: G, id: string) => game.view(g.s, id, g.t.ctx) as NineboxView;
function go(g: G) {
  g.t.advance(READY_MS);
  tick(g);
  assert(g.s.phase === "play", "play after countdown");
}
const holes = (g: G) => g.s.givens.flatMap((v, i) => (v ? [] : [i]));
function solveAll(g: G, id: string, stepMs = 1000) {
  for (const i of holes(g)) {
    if (g.s.runs[id].cells[i]) continue;
    g.t.advance(stepMs);
    assert(act(g, id, { type: "place", i, v: g.s.solution[i] }) === true, "correct place");
  }
}

// ---------- engine: unique, logic-solvable puzzles, fast ----------
{
  let x = 2024;
  const r = () => ((x = (x * 16807) % 2147483647), x / 2147483647);
  for (const size of [9, 6] as Size[])
    for (const level of ["easy", "medium", "hard"] as Level[]) {
      let worst = 0;
      for (let k = 0; k < 12; k++) {
        const t0 = performance.now();
        const p = makePuzzle(size, level, r);
        worst = Math.max(worst, performance.now() - t0);
        const sh = shapeOf(size);
        assert(p.givens.length === size * size && p.solution.length === size * size, "grid size");
        assert(solve(p.givens, sh, 2).count === 1, `${size} ${level}: unique solution`);
        assert(solve(p.givens, sh, 1).first!.join("") === p.solution.join(""), "solution matches");
        assert(p.givens.every((v, i) => !v || v === p.solution[i]), "givens agree with the solution");
        assert(logicSolve(p.givens, sh, 2), "solvable by logic, no guessing");
        if (level === "easy") assert(grade(p.givens, sh) === 1, "easy needs only singles");
        if (level === "easy") assert(p.clues >= (size === 9 ? 38 : 20), "easy has plenty of clues");
        if (level === "hard") assert(p.clues <= (size === 9 ? 28 : 12), `hard has few clues (${p.clues})`);
        // Every row/col/box of the solution holds each digit once.
        for (const u of sh.units) assert(new Set(u.map((i) => p.solution[i])).size === size, "valid solution");
      }
      assert(worst < 150, `${size} ${level} generates fast (${worst.toFixed(1)} ms)`);
    }
}

// ---------- scoring ----------
{
  const par = PAR_MS[9].medium;
  const lim = LIMIT_MS[9].medium;
  assert(score(true, par / 2, 0, 1, par, lim) === 1000, "perfect fast solve = 1000");
  assert(score(true, 1000, 0, 1, par, lim) > score(true, 1000, 1, 1, par, lim), "a mistake costs");
  assert(score(true, 60_000, 0, 1, par, lim) >= score(true, 600_000, 0, 1, par, lim), "faster scores more");
  assert(score(true, lim, 20, 1, par, lim) === SOLVED_FLOOR, "solved floor");
  assert(score(false, 0, 0, 1, par, lim) === PARTIAL_POINTS && PARTIAL_POINTS < SOLVED_FLOOR, "unsolved always below solved");
}

// ---------- determinism ----------
{
  const a = start(1, 123);
  const b = start(4, 123);
  assert(a.s.givens.join("") === b.s.givens.join(""), "same seed, same puzzle");
  assert(a.s.givens.join("") !== start(1, 124).s.givens.join(""), "different seed, different puzzle");
}

// ---------- settings ----------
{
  const g = start(1, 5, { size: 6, level: "hard", mistakes: 5 });
  assert(g.s.size === 6 && g.s.givens.length === 36 && g.s.level === "hard" && g.s.maxMistakes === 5, "6×6 hard, 5 mistakes");
  const d = start(1, 5);
  assert(d.s.size === 9 && d.s.level === "medium" && d.s.maxMistakes === 3, "defaults");
  const junk = start(1, 5, { size: 7, level: "lol", mistakes: 99 });
  assert(junk.s.size === 9 && junk.s.level === "medium" && junk.s.maxMistakes === 3, "junk settings fall back");
  const off = start(1, 5, { mistakes: 0 });
  assert(off.s.maxMistakes === 0, "no limit");
}

// ---------- solo full game ----------
{
  const g = start(1, 9, { size: 6, level: "easy" });
  const id = g.t.ids[0];
  const v0 = view(g, id);
  assert(v0.phase === "ready" && v0.givens === "" && v0.me!.cells === "", "grid hidden during the countdown");
  assert(act(g, id, { type: "place", i: holes(g)[0], v: 1 }) === false, "no moves in the countdown");
  go(g);
  const v1 = view(g, id);
  assert(v1.givens.length === 36 && !("solution" in v1), "givens shown, solution never sent while playing");
  assert(!JSON.stringify(v1).includes(g.s.solution.join("")), "solution string not leaked");
  // One wrong number.
  const i0 = holes(g)[0];
  const wrong = (g.s.solution[i0] % 6) + 1;
  const before = g.t.events.length;
  assert(act(g, id, { type: "place", i: i0, v: wrong }) === true, "wrong place handled");
  assert(g.s.runs[id].mistakes === 1 && g.s.runs[id].cells[i0] === 0, "mistake counted, cell stays empty");
  const ev = g.t.events[before];
  assert(ev && ev.to === id && (ev.event as { t: string }).t === "bad", "private mistake event");
  solveAll(g, id);
  assert(g.s.runs[id].status === "solved", "solved");
  assert(res(g), "game ended");
  assert(res(g)!.winners[0] === id, "solo winner");
  assert(/solved a 6×6 Easy in \d+:\d\d with 1 mistake/.test(res(g)!.headline), `headline: ${res(g)!.headline}`);
  assert(res(g)!.scores![id] > 900, "fast solve scores high");
  assert(view(g, id).solution === g.s.solution.join(""), "solution shown at the end");
}

// ---------- invalid actions ----------
{
  const g = start(2, 11);
  const [a] = g.t.ids;
  go(g);
  const given = g.s.givens.findIndex((v) => v);
  const hole = holes(g)[0];
  const junk: unknown[] = [null, 1, "x", [], {}, { type: "place" }, { type: "place", i: -1, v: 1 }, { type: "place", i: 81, v: 1 },
    { type: "place", i: 1.5, v: 1 }, { type: "place", i: hole, v: 0 }, { type: "place", i: hole, v: 10 }, { type: "place", i: hole, v: "5" },
    { type: "place", i: String(hole), v: 5 }, { type: "place", i: given, v: g.s.givens[given] }, { type: "__proto__" }, { type: "undo" }];
  for (const j of junk) assert(act(g, a, j) === false, `junk refused: ${JSON.stringify(j)}`);
  assert(g.s.runs[a].mistakes === 0, "junk costs nothing");
  assert(act(g, "stranger", { type: "place", i: hole, v: g.s.solution[hole] }) === false, "non-player refused");
  assert(act(g, a, { type: "place", i: hole, v: g.s.solution[hole] }) === true, "right number");
  assert(act(g, a, { type: "place", i: hole, v: g.s.solution[hole] }) === false, "can't overwrite a filled cell");
  // Views never show another player's grid.
  const vb = view(g, g.t.ids[1]);
  assert(vb.me!.cells[hole] === "0", "b doesn't see a's number");
  assert(vb.board.find((r) => r.id === a)!.pct > 0, "board shows a's progress");
}

// ---------- mistake limit knocks you out; others play on ----------
{
  const g = start(2, 13, { mistakes: 3 });
  const [a, b] = g.t.ids;
  go(g);
  const i0 = holes(g)[0];
  const wrong = (g.s.solution[i0] % 9) + 1;
  for (let k = 0; k < 3; k++) act(g, a, { type: "place", i: i0, v: wrong });
  assert(g.s.runs[a].status === "out", "out after 3 mistakes");
  assert(act(g, a, { type: "place", i: i0, v: g.s.solution[i0] }) === false, "no moves once out");
  assert(!res(g), "game goes on for b");
  solveAll(g, b);
  assert(res(g) && res(g)!.winners[0] === b, "b wins");
  assert(res(g)!.scores![a] < res(g)!.scores![b], "out scores less");
}
{
  // Off: no limit.
  const g = start(1, 14, { mistakes: 0 });
  const id = g.t.ids[0];
  go(g);
  const i0 = holes(g)[0];
  const wrong = (g.s.solution[i0] % 9) + 1;
  for (let k = 0; k < 10; k++) act(g, id, { type: "place", i: i0, v: wrong });
  assert(g.s.runs[id].status === "play" && g.s.runs[id].mistakes === 10, "no limit when off");
  assert(act(g, id, { type: "quit" }) === true, "give up");
  assert(res(g) && /filled 0%/.test(res(g)!.headline), "give-up headline");
}

// ---------- time limit ----------
{
  const g = start(2, 15, { size: 6, level: "easy" });
  go(g);
  g.t.advance(LIMIT_MS[6].easy);
  tick(g);
  assert(res(g), "ends at the time limit");
  assert(res(g)!.winners.length === 0, "nobody filled anything: no winner");
}

// ---------- a player leaving doesn't stall the game ----------
{
  const g = start(3, 31, { size: 6 });
  const [a, b, c] = g.t.ids;
  go(g);
  g.t.ctx.players[2].connected = false;
  game.playerLeft!(g.s, c, g.t.ctx);
  solveAll(g, a);
  solveAll(g, b);
  assert(!res(g), "waits a little for the dropped player");
  g.t.advance(60_000);
  tick(g);
  assert(res(g), "ends once the dropped player has been gone a while");
  assert(!res(g)!.winners.includes(c), "dropped player didn't win");
}
{
  const g = start(2, 32, { size: 6 });
  const [a, b] = g.t.ids;
  go(g);
  game.playerLeft!(g.s, b, g.t.ctx);
  g.t.advance(5_000);
  game.playerReturned!(g.s, b, g.t.ctx);
  solveAll(g, a);
  g.t.advance(120_000);
  tick(g);
  assert(!res(g), "a returned player is waited for");
  solveAll(g, b);
  assert(res(g), "ends when both are done");
}

// ---------- spectators ----------
{
  const g = start(2, 41, { size: 6 });
  go(g);
  const [, b] = g.t.ids;
  const h = holes(g);
  act(g, b, { type: "place", i: h[0], v: g.s.solution[h[0]] });
  const v = view(g, "spectator");
  assert(v.me === null && v.watch && v.watch.id === b, "spectators follow the leader");
  assert(!("solution" in v), "spectators don't get the solution mid-game");
}

// ---------- bots finish a game at a human pace ----------
{
  const g = start(2, 51, { size: 6, level: "easy" }, 1);
  const human = g.t.ids[0];
  go(g);
  let guard = 0;
  let firstMove = -1;
  while (!res(g) && guard++ < 20_000) {
    g.t.advance(250);
    const bot = g.t.ids[1];
    const a = game.bot!(g.s, bot, g.t.ctx);
    if (a) {
      if (firstMove < 0) firstMove = guard * 250;
      game.action(g.s, bot, a, g.t.ctx);
    }
    if (g.s.runs[bot].status !== "play" && g.s.runs[human].status === "play") act(g, human, { type: "quit" });
    tick(g);
  }
  assert(res(g), "bot finished");
  const r = g.s.runs[g.t.ids[1]];
  assert(r.status === "solved", "bot solves the grid");
  assert(r.ms > 60_000 && r.ms < LIMIT_MS[6].easy, `bot is human-paced (${Math.round(r.ms / 1000)}s)`);
  assert(firstMove > 3_000, "bot thinks before its first move");
  console.log(`  bot: solved 6×6 easy in ${Math.round(r.ms / 1000)}s with ${r.mistakes} mistakes`);
}

console.log("✓ ninebox");
