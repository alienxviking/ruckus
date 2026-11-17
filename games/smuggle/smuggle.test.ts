import game, { type SmuggleState } from "./server";
import { assert, makeTestCtx } from "../../shared/testing";
import { CARDS } from "./data";
import { READY_MS, type SmuggleView } from "./shared";
import type { Settings } from "../../shared/settings";

type T = ReturnType<typeof makeTestCtx>;
const ph = (s: SmuggleState): string => s.phase;
const view = (s: SmuggleState, id: string, t: T) => game.view(s, id, t.ctx) as SmuggleView;
const act = (s: SmuggleState, t: T, id: string, a: unknown) => game.action(s, id, a as never, t.ctx);
const tick = (s: SmuggleState, t: T, ms = 0) => {
  t.advance(ms);
  return game.tick!(s, t.ctx);
};
function setup(n: number, settings: Settings = {}, memory: Record<string, unknown> = {}, seed = 7) {
  const t = makeTestCtx(n, seed, settings, 0, memory);
  const s = game.setup(t.ctx);
  return { t, s };
}
const other = (s: SmuggleState) => s.teams[s.team === 0 ? 1 : 0][0];

// --- data sanity ---
assert(CARDS.length >= 300, "big word bank");
assert(CARDS.every((c) => c.ban.length === 5), "five banned words each");

// --- setup ---
{
  const { t, s } = setup(6);
  assert(s.teams[0].length === 3 && s.teams[1].length === 3, "even teams");
  assert(ph(s) === "ready" && s.totalTurns === 6, "3 turns per team by default (min 3)");
  const v = view(s, s.describer, t);
  assert(v.role === "describer" && v.card === null, "no card before the turn starts");
}

// --- full game: got / skip / buzz, roles and secrecy ---
{
  const { t, s } = setup(5);
  let turns = 0;
  const describers = new Set<string>();
  while (ph(s) !== "final" && turns < 50) {
    assert(ph(s) === "ready", "turn starts on the ready screen");
    // only the describer can start
    const notMe = s.ids.find((id) => id !== s.describer)!;
    assert(act(s, t, notMe, { type: "start" }) === false, "others can't start");
    assert(act(s, t, s.describer, { type: "start" }) === true, "describer starts");
    describers.add(s.describer);
    const d = s.describer;
    const mate = s.teams[s.team].find((id) => id !== d);
    const opp = other(s);
    const dv = view(s, d, t);
    assert(dv.card && dv.card.w && dv.card.ban.length === 5, "describer sees card");
    assert(view(s, opp, t).card?.w === dv.card.w, "opponents see the card");
    if (mate) assert(view(s, mate, t).card === null && view(s, mate, t).role === "guesser", "teammates don't see the word");
    assert(view(s, "spectator", t).card === null && view(s, "spectator", t).role === "watch", "spectators don't see the word");
    assert(!JSON.stringify(view(s, mate ?? "spectator", t)).includes(`"${dv.card.w}"`), "no leak in guesser view");

    const before = [...s.score] as [number, number];
    const n = s.cardNo;
    assert(act(s, t, d, { type: "got", n: n + 1 }) === false, "stale/future card number rejected");
    assert(act(s, t, opp, { type: "got", n }) === false, "only describer scores");
    if (mate) assert(act(s, t, mate, { type: "buzz", n }) === false, "own team can't buzz");
    assert(act(s, t, d, { type: "buzz", n }) === false, "describer can't buzz");
    assert(act(s, t, d, { type: "got", n }) === true, "got it");
    assert(s.score[s.team] === before[s.team] + 1, "+1");
    assert(act(s, t, d, { type: "got", n }) === false, "double tap on same card ignored");
    assert(act(s, t, d, { type: "skip", n: s.cardNo }) === true, "skip");
    assert(s.score[s.team] === before[s.team] + 1, "skip is free");
    assert(act(s, t, opp, { type: "buzz", n: s.cardNo }) === true, "buzz");
    assert(s.score[s.team] === before[s.team], "buzz −1");
    assert(act(s, t, opp, { type: "buzz", n: s.cardNo - 1 }) === false, "late buzz on old card rejected");
    assert(s.log.length === 3, "log");
    tick(s, t, 61_000);
    turns++;
  }
  assert(ph(s) === "final" && t.result, "game ends");
  assert(turns === s.totalTurns, `played all turns ${turns}`);
  assert(describers.size === 5, "everyone described");
  assert(t.result.winners.length === 0 || t.result.winners.every((id) => s.teams[s.winner!].includes(id)), "winners are a team");
  assert(t.result.headline.length > 5, "headline");
  assert(act(s, t, s.ids[0], { type: "start" }) === false, "no actions after the end");
}

// --- winners = winning team; auto-start after READY_MS ---
{
  const { t, s } = setup(4);
  while (ph(s) !== "final") {
    tick(s, t, READY_MS + 1); // auto start
    assert(ph(s) === "turn", "auto-started");
    if (s.team === 0) act(s, t, s.describer, { type: "got", n: s.cardNo });
    tick(s, t, 60_001);
  }
  assert(s.winner === 0 && t.result!.winners.length === 2 && t.result!.winners.every((id) => s.teams[0].includes(id)), "red wins");
  assert(t.result!.scores![s.teams[0][0]] === 3, "team score as player score");
}

// --- junk actions ---
{
  const { t, s } = setup(4);
  const junk: unknown[] = [null, 1, "x", [], {}, { type: "start", extra: 1 }, { type: "got" }, { type: "got", n: "1" }, { type: "buzz", n: NaN }, { type: "__proto__" }];
  for (const j of junk) for (const id of [...s.ids, "stranger"]) if (!(j && typeof j === "object" && (j as { type?: string }).type === "start" && id === s.describer)) act(s, t, id, j);
  assert(s.score[0] === 0 && s.score[1] === 0, "junk changes nothing");
  assert(act(s, t, "stranger", { type: "start" }) === false, "non-participant rejected");
}

// --- settings: time, turns, custom words ---
{
  const { t, s } = setup(6, { time: 45, turns: 2 });
  assert(s.turnMs === 45_000 && s.totalTurns === 12, "settings honoured");
  act(s, t, s.describer, { type: "start" });
  assert(s.endsAt - t.ctx.now() === 45_000, "45s turn");
  const words = "alpha,bravo,charlie,delta,echo,foxtrot,golf,hotel,india,juliet,kilo".split(",");
  const c = setup(4, { words });
  act(c.s, c.t, c.s.describer, { type: "start" });
  const card = view(c.s, c.s.describer, c.t).card!;
  assert(words.includes(card.w) && card.ban.length === 0 && view(c.s, c.s.ids[0], c.t).custom, "custom words used");
  const few = setup(4, { words: ["a", "b"] });
  assert(few.s.custom === null, "too few custom words → built-in");
  const bad = setup(4, { time: 999, turns: "x" });
  assert(bad.s.turnMs === 60_000 && bad.s.totalTurns === 6, "bad settings fall back");
}

// --- memory: no repeats across games in a room ---
{
  const memory: Record<string, unknown> = {};
  const a = setup(4, {}, memory, 1);
  const seen = new Set<number>();
  while (ph(a.s) !== "final") {
    act(a.s, a.t, a.s.describer, { type: "start" });
    for (let i = 0; i < 5; i++) act(a.s, a.t, a.s.describer, { type: "skip", n: a.s.cardNo });
    tick(a.s, a.t, 61_000);
  }
  for (let i = 0; i <= a.s.pos; i++) seen.add(a.s.deck[i]);
  assert(Array.isArray(memory.used) && (memory.used as number[]).length === seen.size, "memory records dealt cards");
  const b = setup(4, {}, memory, 2);
  for (let i = 0; i < 20; i++) assert(!seen.has(b.s.deck[i]), "next game starts with fresh cards");
}

// --- leaving: describer drops mid-turn, describer away on ready, abandon ---
{
  const { t, s } = setup(6);
  act(s, t, s.describer, { type: "start" });
  const d = s.describer;
  const turn = s.turn;
  t.ctx.player(d)!.connected = false;
  game.playerLeft!(s, d, t.ctx);
  assert(ph(s) === "ready" && s.turn === turn + 1, "turn ends when describer leaves");
  // next describer (other team) leaves before starting → a teammate takes over
  const next = s.describer;
  const team = s.team;
  t.ctx.player(next)!.connected = false;
  game.playerLeft!(s, next, t.ctx);
  tick(s, t, 250);
  assert(ph(s) === "ready" && s.describer !== next && s.teams[team].includes(s.describer), "teammate takes over");
  t.ctx.player(d)!.connected = true;
  game.playerReturned!(s, d, t.ctx);
  // everyone but one leaves → game ends after ABANDON_MS
  for (const id of s.ids.slice(1)) {
    t.ctx.player(id)!.connected = false;
    game.playerLeft!(s, id, t.ctx);
  }
  for (let i = 0; i < 100 && ph(s) !== "final"; i++) tick(s, t, 500);
  assert(ph(s) === "final" && t.result && t.result.headline.startsWith("Not enough"), "abandoned game ends");
}

// --- whole team away: their turns are skipped, no soft-lock ---
{
  const { t, s } = setup(4);
  for (const id of s.teams[1]) {
    t.ctx.player(id)!.connected = false;
    game.playerLeft!(s, id, t.ctx);
  }
  for (let i = 0; i < 400 && ph(s) !== "final"; i++) tick(s, t, 1000);
  assert(ph(s) === "final", "finishes with one team away");
}

// --- small rooms don't crash ---
{
  const { t, s } = setup(2);
  for (let i = 0; i < 1000 && ph(s) !== "final"; i++) tick(s, t, 1000);
  assert(ph(s) === "final", "2-player game finishes");
}

console.log("✓ smuggle tests passed");
