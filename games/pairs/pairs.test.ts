import { assert, makeTestCtx } from "../../shared/testing";
import type { Settings } from "../../shared/settings";
import game, { type PairsState } from "./server";
import { AWAY_MS, SHOW_MS, SOLO_MS, TURN_MS, soloScore, type PairsView } from "./shared";

function start(n: number, seed = 4, settings: Settings = {}, bots = 0) {
  const t = makeTestCtx(n, seed, settings, bots);
  const s: PairsState = game.setup(t.ctx);
  return { t, s };
}
type G = ReturnType<typeof start>;
const result = (g: G) => g.t.result;
const act = (g: G, who: string, a: unknown) => game.action(g.s, who, a, g.t.ctx);
const tick = (g: G) => game.tick!(g.s, g.t.ctx);
const view = (g: G, id: string) => game.view(g.s, id, g.t.ctx) as PairsView;
const mover = (g: G) => g.s.seats[g.s.turn];
const flip = (g: G, i: number) => act(g, mover(g), { type: "flip", i });
/** Cards of one unclaimed pair. */
function aPair(g: G): [number, number] {
  for (let i = 0; i < g.s.faces.length; i++) {
    if (g.s.owner[i] >= 0) continue;
    const j = g.s.faces.findIndex((f, k) => k !== i && f === g.s.faces[i] && g.s.owner[k] < 0);
    if (j >= 0) return [i, j];
  }
  throw new Error("no pair left");
}
function aMiss(g: G): [number, number] {
  const open = g.s.owner.map((o, i) => i).filter((i) => g.s.owner[i] < 0);
  for (const i of open) for (const j of open) if (i !== j && g.s.faces[i] !== g.s.faces[j]) return [i, j];
  throw new Error("no miss possible");
}

// ---------- board ----------
{
  const g = start(2);
  assert(g.s.faces.length === 24, "24 cards by default");
  const counts = new Map<number, number>();
  for (const f of g.s.faces) counts.set(f, (counts.get(f) ?? 0) + 1);
  assert([...counts.values()].every((c) => c === 2), "every face twice");
  assert(start(1, 4, { board: "small" }).s.faces.length === 16, "small board");
  assert(start(1, 4, { board: "large" }).s.faces.length === 36, "large board");
  assert(start(1, 4, { board: "huge" }).s.faces.length === 24, "bad setting falls back");
  assert(JSON.stringify(start(1, 99).s.faces) === JSON.stringify(start(1, 99).s.faces), "deterministic from the seed");
  const v = view(g, g.t.ids[0]);
  assert(v.faces.every((f) => f === -1), "no faces leak face down");
}

// ---------- solo: clear the board ----------
{
  const g = start(1, 5, { board: "small" });
  const id = g.t.ids[0];
  assert(g.s.endsAt === null, "no turn clock solo");
  // One miss first.
  const [m1, m2] = aMiss(g);
  assert(flip(g, m1) && flip(g, m2), "flips");
  assert(g.s.phase === "show" && g.s.misses[0] === 1, "miss shows");
  const v = view(g, id);
  assert(v.faces[m1] >= 0 && v.faces[m2] >= 0, "missed cards visible while shown");
  assert(flip(g, aPair(g)[0]) === false, "can't flip while showing");
  g.t.advance(SHOW_MS);
  tick(g);
  assert(view(g, id).phase === "pick" && view(g, id).faces[m1] === -1, "flipped back");
  g.t.advance(20_000);
  while (!result(g)) {
    const [a, b] = aPair(g);
    assert(flip(g, a) && flip(g, b), "pair");
  }
  const want = soloScore(8, 1, Math.round((SHOW_MS + 20_000) / 1000));
  assert(result(g)!.scores![id] === want, `solo score ${result(g)!.scores![id]} vs ${want}`);
  assert(result(g)!.winners[0] === id && /cleared/.test(result(g)!.headline), "solo win headline");
  assert(view(g, id).final === want, "final in view");
}

// ---------- solo time cap ----------
{
  const g = start(1, 6);
  const [a, b] = aPair(g);
  flip(g, a);
  flip(g, b);
  g.t.advance(SOLO_MS);
  tick(g);
  assert(result(g) && /found 1\/12/.test(result(g)!.headline), "time cap ends solo");
}

// ---------- multiplayer turns ----------
{
  const g = start(3, 7);
  const first = mover(g);
  const [a, b] = aPair(g);
  assert(flip(g, a) && flip(g, b), "match");
  assert(mover(g) === first && g.s.scores[g.s.turn] === 1, "match keeps the turn");
  const [c, d] = aMiss(g);
  flip(g, c);
  flip(g, d);
  g.t.advance(SHOW_MS);
  tick(g);
  assert(mover(g) !== first, "miss passes the turn");
  // Not your turn.
  assert(act(g, first, { type: "flip", i: aPair(g)[0] }) === false, "not your turn");
  // Timer runs out.
  const who = mover(g);
  flip(g, aMiss(g)[0]);
  g.t.advance(TURN_MS + 7000);
  tick(g);
  assert(mover(g) !== who && g.s.up.length === 0, "timeout passes the turn and flips back");
  // Play out.
  let guard = 0;
  while (!result(g) && guard++ < 100) {
    const [x, y] = aPair(g);
    flip(g, x);
    flip(g, y);
  }
  assert(result(g) && result(g)!.winners.length >= 1, "multiplayer ends");
  const total = Object.values(result(g)!.scores!).reduce((s, x) => s + x, 0);
  assert(total === 12, "scores are pairs");
}

// ---------- invalid actions ----------
{
  const g = start(2, 8);
  const m = mover(g);
  const junk: unknown[] = [null, 3, "flip", [], {}, { type: "flip" }, { type: "flip", i: -1 }, { type: "flip", i: 24 }, { type: "flip", i: 1.5 },
    { type: "flip", i: "2" }, { type: "flip", i: NaN }, { type: "line", o: "h", r: 0, c: 0 }];
  for (const j of junk) assert(act(g, m, j) === false, `junk refused ${JSON.stringify(j)}`);
  assert(act(g, "nobody", { type: "flip", i: 0 }) === false, "stranger refused");
  assert(flip(g, 0) === true && flip(g, 0) === false, "can't flip the same card twice");
  const [a, b] = aPair(g);
  if (g.s.up[0] !== a && g.s.up[0] !== b) {
    // finish this turn first
    flip(g, aMiss(g).find((i) => i !== 0)!);
  }
}

// ---------- leaving doesn't stall ----------
{
  const g = start(2, 9);
  const away = mover(g);
  const p = g.t.ctx.players.find((x) => x.id === away)!;
  p.connected = false;
  game.playerLeft!(g.s, away, g.t.ctx);
  assert(g.s.endsAt! <= g.t.ctx.now() + AWAY_MS, "away player's turn shortened");
  g.t.advance(AWAY_MS);
  tick(g);
  assert(mover(g) !== away, "away turn skipped");
  // Their next turn is short too.
  const [x, y] = aMiss(g);
  flip(g, x);
  flip(g, y);
  g.t.advance(SHOW_MS);
  tick(g);
  assert(mover(g) === away && g.s.turnMs === AWAY_MS, "short turn for the away player");
  // Everyone gone: the game ends.
  for (const pl of g.t.ctx.players) pl.connected = false;
  for (let i = 0; i < 200 && !result(g); i++) {
    g.t.advance(500);
    tick(g);
  }
  assert(result(g), "abandoned game ends");
}

// ---------- spectators ----------
{
  const g = start(2, 10);
  const v = view(g, "watcher");
  assert(v.you === -1 && v.faces.every((f) => f === -1), "spectator sees the board, no secrets");
}

// ---------- bots ----------
{
  const g = start(3, 11, {}, 2);
  const human = g.t.ids[0];
  let guard = 0;
  let botFlips = 0;
  while (!result(g) && guard++ < 20_000) {
    g.t.advance(100);
    for (const id of g.t.ids) {
      if (!g.t.ctx.player(id)?.bot) continue;
      const a = game.bot!(g.s, id, g.t.ctx);
      if (a) {
        assert(game.action(g.s, id, a, g.t.ctx) === true, "bot flip valid");
        botFlips++;
      }
    }
    if (mover(g) === human && g.s.phase === "pick" && guard % 15 === 0) {
      const open = g.s.owner.map((o, i) => i).filter((i) => g.s.owner[i] < 0 && !g.s.up.includes(i));
      act(g, human, { type: "flip", i: open[0] });
    }
    tick(g);
  }
  assert(result(g), "bots finish a game");
  const s = result(g)!.scores!;
  console.log(`  bots: ${botFlips} flips, scores ${JSON.stringify(s)}`);
  assert(s["bot-0"] + s["bot-1"] >= 6, "bots find pairs");
}
{
  // A solo game with only a bot? Not possible (bots need a human host), but bots alone must not stall.
  const g = start(2, 15, {}, 2);
  let guard = 0;
  while (!result(g) && guard++ < 20_000) {
    g.t.advance(100);
    for (const id of g.t.ids) {
      const a = game.bot!(g.s, id, g.t.ctx);
      if (a) game.action(g.s, id, a, g.t.ctx);
    }
    tick(g);
  }
  assert(result(g), "two bots finish");
  // Memory: total misses should be well under a random player's.
  const misses = g.s.misses.reduce((a, b) => a + b, 0);
  console.log(`  two bots: ${misses} misses for 12 pairs`);
  assert(misses < 40, "bots remember something");
}

console.log("✓ pairs");
