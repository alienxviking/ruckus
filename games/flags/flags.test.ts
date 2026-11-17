import flags, { type FlagState, type FlagView } from "./server";
import { assert, makeTestCtx } from "../../shared/testing";
import type { GameResult } from "../../shared/types";
import { BASES, BASE_R, COUNTDOWN_MS, FLAG_DROPPED, FLAG_HOME, MID, SCORED_MS, TICK_MS, isSnap } from "./shared";
import { readSettings } from "../../shared/settings";
import { config } from "./config";

type T = ReturnType<typeof makeTestCtx>;

function run(s: FlagState, t: T, ms: number, withBots = false) {
  for (let el = 0; el < ms && !t.result; el += TICK_MS) {
    t.advance(TICK_MS);
    if (withBots) {
      for (const p of t.ctx.players) {
        if (!p.bot) continue;
        const a = flags.bot!(s, p.id, t.ctx);
        if (a) flags.action(s, p.id, a, t.ctx);
      }
    }
    flags.tick!(s, t.ctx);
  }
}

/** Steer player `slot` toward (x, y) every tick for up to `ms`, until `done`. */
function walkTo(s: FlagState, t: T, slot: number, x: number, y: number, ms: number, done: () => boolean = () => false) {
  for (let el = 0; el < ms && !t.result && !done(); el += TICK_MS) {
    const r = s.runners[slot];
    const dx = x - r.x;
    const dy = y - r.y;
    const d = Math.hypot(dx, dy);
    const a = d < 4 ? { type: "in", x: 0, y: 0 } : { type: "in", x: Math.round((dx / d) * 100), y: Math.round((dy / d) * 100) };
    flags.action(s, t.ids[slot], a as never, t.ctx);
    t.advance(TICK_MS);
    flags.tick!(s, t.ctx);
  }
}

// ---------- setup & teams ----------
{
  const t = makeTestCtx(5);
  const s = flags.setup(t.ctx);
  const reds = s.team.filter((x) => x === 0).length;
  assert(reds === 3 && s.team.length === 5, "teams split 3/2");
  assert(s.phase === "countdown" && s.capsNeeded === 3 && s.timeLimit === 5 * 60_000, "defaults");
  const v = flags.view(s, "spectator", t.ctx) as FlagView;
  assert(isSnap(v.snap) && v.ids.length === 5, "spectator view");
  for (const r of s.runners) assert(r.team === 0 ? r.y > MID : r.y < MID, "lined up on own half");
  console.log("✓ setup, teams, spectator view");
}

// ---------- invalid actions ----------
{
  const t = makeTestCtx(2);
  const s = flags.setup(t.ctx);
  const junk: unknown[] = [null, 5, "x", [], {}, { type: "in" }, { type: "in", x: 1.5, y: 0 }, { type: "in", x: 101, y: 0 },
    { type: "in", x: NaN, y: 0 }, { type: "in", x: "1", y: 2 }, { type: "throw", x: 0, y: 0 }, { type: "__proto__" }];
  for (const a of junk) flags.action(s, t.ids[0], a as never, t.ctx);
  assert(s.runners[0].ix === 0 && s.runners[0].iy === 0, "junk ignored");
  flags.action(s, "stranger", { type: "in", x: 100, y: 0 }, t.ctx);
  assert(s.runners.every((r) => r.ix === 0), "non-player ignored");
  flags.action(s, t.ids[0], { type: "in", x: 100, y: 0 }, t.ctx);
  assert((s.runners[0].ix as number) === 1, "valid input applied");
  console.log("✓ invalid actions rejected");
}

// ---------- grab, tag, drop, return, capture, full game ----------
{
  const t = makeTestCtx(2, 7, { caps: 2 });
  const s = flags.setup(t.ctx);
  run(s, t, COUNTDOWN_MS + 100);
  assert(s.phase === "play", "play starts");
  const red = s.team.indexOf(0);
  const blue = s.team.indexOf(1);
  // Red's guard ring: red can't step into its own base.
  walkTo(s, t, red, BASES[0][0], BASES[0][1], 3000);
  assert(Math.hypot(s.runners[red].x - BASES[0][0], s.runners[red].y - BASES[0][1]) >= BASE_R, "kept out of own base");
  // Blue goes for Red's flag, Red stands still out of the way.
  flags.action(s, t.ids[red], { type: "in", x: 0, y: 0 }, t.ctx);
  s.runners[red].x = 60;
  s.runners[red].y = 600;
  walkTo(s, t, blue, BASES[0][0], BASES[0][1], 8000, () => s.flags[0].at === blue);
  assert(s.flags[0].at === blue, "blue grabbed red's flag");
  // Blue heads home; red tags the carrier in red's half.
  walkTo(s, t, blue, 300, 760, 3000);
  flags.action(s, t.ids[blue], { type: "in", x: 0, y: 0 }, t.ctx);
  walkTo(s, t, red, s.runners[blue].x, s.runners[blue].y, 4000, () => s.runners[blue].out);
  assert(s.runners[blue].out && s.tags[red] === 1, "carrier tagged");
  assert(s.flags[0].at === FLAG_DROPPED || s.flags[0].at === FLAG_HOME, "flag dropped");
  if (s.flags[0].at === FLAG_DROPPED) {
    walkTo(s, t, red, s.flags[0].x, s.flags[0].y, 4000, () => s.flags[0].at === FLAG_HOME);
    assert((s.flags[0].at as number) === FLAG_HOME, "own flag returned by touch");
  }
  // Blue respawns at its base.
  run(s, t, 3000);
  assert(!s.runners[blue].out && s.runners[blue].y < MID, "blue back at its base");
  // Red raids blue twice.
  for (let cap = 1; cap <= 2; cap++) {
    s.runners[blue].x = 40;
    s.runners[blue].y = 40;
    flags.action(s, t.ids[blue], { type: "in", x: 0, y: 0 }, t.ctx);
    walkTo(s, t, red, BASES[1][0], BASES[1][1], 8000, () => s.flags[1].at === red);
    assert(s.flags[1].at === red, "red grabbed");
    walkTo(s, t, red, BASES[0][0], BASES[0][1], 9000, () => s.score[0] === cap);
    assert(s.score[0] === cap, `red captured ${cap}`);
    if (cap === 1) {
      assert((s.phase as string) === "scored", "celebration");
      run(s, t, SCORED_MS + COUNTDOWN_MS + 200);
      assert((s.phase as string) === "play", "play resumes after line-up");
    }
  }
  assert(t.result && (s.phase as string) === "final" && s.winTeam === 0, "match over");
  assert(t.result.winners.length === 1 && t.result.winners[0] === t.ids[red], "red wins");
  console.log("✓ grab, tag, drop, return, capture, full game:", t.result.headline);
}

// ---------- dropped flag auto-returns ----------
{
  const t = makeTestCtx(2);
  const s = flags.setup(t.ctx);
  run(s, t, COUNTDOWN_MS + 100);
  s.flags[1] = { at: FLAG_DROPPED, x: 300, y: 300, returnAt: s.fightAt + s.steps * 25 + 1000 };
  for (const r of s.runners) [r.x, r.y] = [40, r.team === 0 ? 900 : 100];
  run(s, t, 1500);
  assert(s.flags[1].at === FLAG_HOME, "auto return");
  console.log("✓ dropped flag goes home by itself");
}

// ---------- time limit & overtime ----------
{
  const t = makeTestCtx(2, 3, { minutes: 3 });
  const s = flags.setup(t.ctx);
  assert(s.timeLimit === 180_000, "minutes setting");
  run(s, t, COUNTDOWN_MS + 181_000);
  assert(s.overtime && s.phase === "play", "tied at the buzzer -> overtime");
  run(s, t, 121_000);
  assert(t.result && t.result.winners.length === 0 && s.winTeam === -1, "overtime runs out -> draw");
  console.log("✓ time limit, overtime, draw:", t.result.headline);
}

// ---------- settings fall back ----------
{
  const set = readSettings(config.settings, { caps: 99, minutes: "x" });
  assert(set.caps === 3 && set.minutes === 5, "bad settings use defaults");
  const t = makeTestCtx(4, 1, { caps: 5, minutes: 8 });
  const s = flags.setup(t.ctx);
  assert(s.capsNeeded === 5 && s.timeLimit === 480_000, "settings honoured");
  console.log("✓ settings honoured");
}

// ---------- bots finish a game ----------
for (const [n, bots] of [[2, 2], [6, 6], [5, 4]] as const) {
  const t = makeTestCtx(n, 11 + n, { minutes: 3 }, bots);
  const s = flags.setup(t.ctx);
  run(s, t, 8 * 60_000, true);
  assert(t.result, `bots (${n}) finish`);
  const total = s.score[0] + s.score[1];
  console.log(`✓ ${bots} bots in ${n}: ${t.result.headline} (captures ${total}, tags ${s.tags.reduce((a, b) => a + b, 0)})`);
  for (const r of s.runners) assert(r.x >= 0 && r.x <= 600 && r.y >= 0 && r.y <= 1000, "on the field");
}

// ---------- leaving ----------
{
  const t = makeTestCtx(4);
  const s = flags.setup(t.ctx);
  run(s, t, COUNTDOWN_MS + 500);
  // One player drops: the game goes on.
  t.ctx.players[0].connected = false;
  flags.playerLeft!(s, t.ids[0], t.ctx);
  run(s, t, 20_000);
  assert(!t.result, "one leaving doesn't end it");
  // A whole team drops: the other team wins after a while.
  const team = s.team[0];
  for (let i = 0; i < 4; i++) {
    if (s.team[i] !== team) continue;
    t.ctx.players[i].connected = false;
    flags.playerLeft!(s, t.ids[i], t.ctx);
  }
  const v = flags.view(s, t.ids[1], t.ctx) as FlagView;
  assert(v.abandonAt !== null, "abandon countdown shown");
  run(s, t, 13_000);
  const res = t.result as GameResult | null;
  assert(res && s.winTeam === 1 - team && s.how === "forfeit", "forfeit");
  console.log("✓ leaving doesn't soft-lock:", res.headline);
}
{
  const t = makeTestCtx(2);
  const s = flags.setup(t.ctx);
  run(s, t, COUNTDOWN_MS + 500);
  t.ctx.players[1].connected = false;
  flags.playerLeft!(s, t.ids[1], t.ctx);
  run(s, t, 5_000);
  t.ctx.players[1].connected = true;
  flags.playerReturned!(s, t.ids[1], t.ctx);
  run(s, t, 15_000);
  assert(!t.result, "returning in time keeps the match");
  console.log("✓ reconnect keeps the match going");
}
console.log("✓ flags: all tests passed");
