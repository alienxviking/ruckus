import { assert, makeTestCtx } from "../../shared/testing";
import type { Settings } from "../../shared/settings";
import game, { type LadderState } from "./server";
import { bfs, isWord, makePuzzle, nextStep } from "./dict";
import { BETWEEN_MS, MISS_EXTRA, READY_MS, countedSteps, limitFor, oneApart, raceScore, type LadderView } from "./shared";

function start(n: number, seed = 7, settings: Settings = {}, bots = 0) {
  const t = makeTestCtx(n, seed, settings, bots);
  const s: LadderState = game.setup(t.ctx);
  return { t, s };
}
type G = ReturnType<typeof start>;
const result = (g: G) => g.t.result;
const act = (g: G, who: string, a: unknown) => game.action(g.s, who, a, g.t.ctx);
const tick = (g: G) => game.tick!(g.s, g.t.ctx);
const view = (g: G, id: string) => game.view(g.s, id, g.t.ctx) as LadderView;
function go(g: G) {
  g.t.advance(READY_MS);
  tick(g);
  assert(g.s.phase === "play", "play after countdown");
}
/** Wait out the between-puzzles pause if there is one. */
function settle(g: G, id: string) {
  const r = g.s.runs[id];
  if (!r.done && g.t.ctx.now() < r.startedAt) g.t.advance(r.startedAt - g.t.ctx.now());
}
/** Solve the current puzzle along its best ladder. */
function solve(g: G, id: string) {
  settle(g, id);
  const r = g.s.runs[id];
  const idx = r.idx;
  const pz = g.s.puzzles[idx];
  if (r.ladder.length === 1) {
    for (const w of pz.best.slice(1)) assert(act(g, id, { type: "step", p: idx, w }) === true, `step ${w}`);
    return;
  }
  while (g.s.runs[id].idx === idx) {
    const w = nextStep(r.ladder[r.ladder.length - 1], pz.goal)!;
    assert(act(g, id, { type: "step", p: idx, w }) === true, `step ${w}`);
  }
}

// ---------- dictionary ----------
assert(isWord("cold") && isWord("warm") && isWord("stone"), "common words known");
assert(!isWord("zzzz") && !isWord("fuck") && !isWord("bitch"), "junk and rude words refused");
assert(isWord("cuss") && isWord("cusp") && isWord("fjord"), "everyday and rarer real words accepted");
for (const len of [4, 5]) {
  for (let par = 3; par <= 7; par++) {
    let x = 99 + par * len;
    const r = () => ((x = (x * 16807) % 2147483647), x / 2147483647);
    const pz = makePuzzle(len, par, r);
    // Long ones can fall back a step when every candidate has a shortcut through rarer words.
    assert(pz.par === par || (par >= 6 && pz.par === par - 1), `par ${par} for ${len} letters (got ${pz.par})`);
    assert(pz.best.length === pz.par + 1 && pz.best[0] === pz.start && pz.best[pz.par] === pz.goal, "best ladder shape");
    for (let i = 1; i < pz.best.length; i++) assert(oneApart(pz.best[i - 1], pz.best[i]) && isWord(pz.best[i]), "best ladder valid");
    assert(bfs(pz.start).dist.get(pz.goal) === pz.par, "no shortcut via rarer words");
  }
}
assert(nextStep("cold", "warm") !== null, "hint exists");

// ---------- scoring ----------
// The race: fewest counted steps wins; hints add one, giving up counts shortest + MISS_EXTRA.
assert(countedSteps(true, 4, 4, 0) === 4, "solved at the shortest");
assert(countedSteps(true, 6, 4, 1) === 7, "extra steps and a hint");
assert(countedSteps(false, 2, 4, 0) === 4 + MISS_EXTRA, "gave up");
// One step always beats any amount of time; time breaks ties.
assert(raceScore(20, 20, 5, 600_000, 600_000) > raceScore(21, 20, 5, 0, 600_000), "a step outweighs time");
assert(raceScore(20, 20, 5, 1_000, 600_000) > raceScore(20, 20, 5, 300_000, 600_000), "faster breaks a tie");

// ---------- determinism: same seed, same puzzles ----------
{
  const a = start(1, 123);
  const b = start(3, 123);
  assert(JSON.stringify(a.s.puzzles) === JSON.stringify(b.s.puzzles), "puzzles depend only on the seed");
  const c = start(1, 124);
  assert(JSON.stringify(a.s.puzzles) !== JSON.stringify(c.s.puzzles), "different seed, different puzzles");
}

// ---------- settings ----------
{
  const g = start(1, 5, { puzzles: 3, level: "hard" });
  assert(g.s.puzzles.length === 3, "3 puzzles");
  assert(g.s.puzzles[0].par === 5, "hard starts at par 5");
  const e = start(1, 5, { puzzles: 8, level: "easy" });
  assert(e.s.puzzles.length === 8 && e.s.puzzles[0].par === 3, "8 easy puzzles");
  const junk = start(1, 5, { puzzles: 99, level: "lol" });
  assert(junk.s.puzzles.length === 5, "bad settings fall back to defaults");
}

// ---------- solo full game ----------
{
  const g = start(1, 9);
  const id = g.t.ids[0];
  assert(act(g, id, { type: "step", p: 0, w: "x" }) === false, "no moves during countdown");
  assert(view(g, id).phase === "ready", "ready view");
  go(g);
  const n = g.s.puzzles.length;
  for (let i = 0; i < n; i++) solve(g, id);
  const r = g.s.runs[id];
  assert(r.done && r.results.every((x) => x.ok && x.steps === x.par), "all solved at par");
  assert(result(g), "game ended");
  assert(result(g)!.winners[0] === id, "solo winner");
  const best = g.s.puzzles.reduce((t, p) => t + p.par, 0);
  assert(r.total === best, "steps counted");
  assert(result(g)!.scores![id] >= 10 * 10 * n, "score reported");
  assert(/in \d+ steps/.test(result(g)!.headline), "solo headline");
}

// ---------- invalid actions ----------
{
  const g = start(2, 11);
  const [a, b] = g.t.ids;
  go(g);
  const pz = g.s.puzzles[0];
  const cur = pz.start;
  const junk: unknown[] = [null, 1, "x", [], {}, { type: "step" }, { type: "step", p: 0, w: 5 }, { type: "step", p: 1, w: pz.best[1] },
    { type: "step", p: 0, w: "a".repeat(5000) }, { type: "step", p: 0, w: cur }, { type: "step", p: 0, w: "zz" + cur.slice(2) },
    { type: "undo", p: 0 }, { type: "hint", p: "0" }, { type: "skip" }, { type: "__proto__", p: 0 }];
  for (const j of junk) assert(act(g, a, j) === false, `junk refused: ${JSON.stringify(j)?.slice(0, 40)}`);
  assert(act(g, "stranger", { type: "skip", p: 0 }) === false, "non-player refused");
  // A non-word one letter away is refused with a private event.
  const before = g.t.events.length;
  let fake = "";
  for (let i = 0; i < cur.length && !fake; i++)
    for (const ch of "qxzjv") {
      const w = cur.slice(0, i) + ch + cur.slice(i + 1);
      if (!isWord(w)) {
        fake = w;
        break;
      }
    }
  assert(act(g, a, { type: "step", p: 0, w: fake }) === false, "non-word refused");
  const ev = g.t.events[before];
  assert(ev && ev.to === a && (ev.event as { why: string }).why === "word", "refusal event to the player only");
  // Revisiting a word is refused.
  assert(act(g, a, { type: "step", p: 0, w: pz.best[1] }) === true, "good step");
  assert(act(g, a, { type: "step", p: 0, w: cur }) === false, "can't go back to a used word");
  assert(act(g, a, { type: "undo", p: 0 }) === true, "undo works");
  assert(g.s.runs[a].ladder.length === 1, "undo popped");
  // Hints play a step and cost points.
  assert(act(g, b, { type: "hint", p: 0 }) === true, "hint");
  assert(g.s.runs[b].hints === 1 && g.s.runs[b].ladder.length === 2, "hint played a step");
  // Views never leak another player's words or the current best ladder.
  const vb = view(g, b);
  assert(!JSON.stringify(vb.board).includes(pz.best[1]), "board has no words");
  assert(vb.me!.results.length === 0, "no results yet");
  assert(!JSON.stringify(view(g, a)).includes(`"best":["${pz.start}"`), "best path hidden while playing");
}

// ---------- timeouts, skips, between-puzzle pause ----------
{
  const g = start(2, 21, { puzzles: 3 });
  const [a, b] = g.t.ids;
  go(g);
  assert(act(g, a, { type: "skip", p: 0 }) === true, "skip");
  assert(g.s.runs[a].results[0].counted === g.s.puzzles[0].par + MISS_EXTRA && g.s.runs[a].idx === 1, "skip counts shortest + penalty");
  assert(act(g, a, { type: "hint", p: 1 }) === false, "no moves during the pause");
  g.t.advance(BETWEEN_MS);
  assert(act(g, a, { type: "hint", p: 1 }) === true, "moves after the pause");
  // b times out on puzzle 0.
  g.t.advance(limitFor(g.s.puzzles[0].par));
  tick(g);
  assert(g.s.runs[b].idx === 1 && !g.s.runs[b].results[0].ok, "timed out");
  assert(!result(g), "still going");
  // Finish both.
  for (const id of [a, b]) while (!g.s.runs[id].done) solve(g, id);
  assert(result(g) && result(g)!.winners.length >= 1, "ended with a winner");
}

// ---------- a player leaving doesn't stall the game ----------
{
  const g = start(3, 31, { puzzles: 3 });
  const [a, b, c] = g.t.ids;
  go(g);
  g.t.ctx.players[2].connected = false;
  game.playerLeft!(g.s, c, g.t.ctx);
  for (const id of [a, b]) while (!g.s.runs[id].done) solve(g, id);
  assert(!result(g), "waits a little for the dropped player");
  g.t.advance(30_000);
  tick(g);
  assert(result(g), "ends once the dropped player has been gone a while");
  assert(!result(g)!.winners.includes(c), "dropped player didn't win");
}
{
  // Returning in time lets them finish.
  const g = start(2, 32, { puzzles: 3 });
  const [a, b] = g.t.ids;
  go(g);
  game.playerLeft!(g.s, b, g.t.ctx);
  g.t.advance(5_000);
  game.playerReturned!(g.s, b, g.t.ctx);
  while (!g.s.runs[a].done) solve(g, a);
  g.t.advance(60_000);
  tick(g);
  assert(!result(g), "a returned player is waited for");
  while (!g.s.runs[b].done) solve(g, b);
  assert(result(g), "ends when both are done");
}

// ---------- spectators ----------
{
  const g = start(2, 41);
  go(g);
  solve(g, g.t.ids[1]);
  const v = view(g, "spectator");
  assert(v.me === null && v.watch && v.watch.id === g.t.ids[1], "spectators follow the leader");
}

// ---------- bots finish a game ----------
{
  const g = start(3, 51, { puzzles: 3 }, 2);
  const human = g.t.ids[0];
  go(g);
  let guard = 0;
  while (!result(g) && guard++ < 20_000) {
    g.t.advance(250);
    for (const id of g.t.ids) {
      if (!g.t.ctx.player(id)?.bot) continue;
      const a = game.bot!(g.s, id, g.t.ctx);
      if (a) game.action(g.s, id, a, g.t.ctx);
    }
    if (g.s.runs[human].done === false && guard % 40 === 0) act(g, human, { type: "skip", p: g.s.runs[human].idx });
    tick(g);
  }
  assert(result(g), "bots finished the game");
  const botSolved = g.t.ids.filter((id) => id.startsWith("bot")).flatMap((id) => g.s.runs[id].results).filter((r) => r.ok).length;
  assert(botSolved >= 3, `bots solve most ladders (${botSolved}/6)`);
  console.log(`  bots: ${botSolved}/6 solved, scores ${JSON.stringify(result(g)!.scores)}`);
}

console.log("✓ ladder");
