import tug, { type TugState, type TugView } from "./server";
import { assert, makeTestCtx } from "../../shared/testing";
import { BEAT_MS, FIRST_COUNTDOWN_MS, LINE, MASH_PULL, ROUND_MS, ROUND_OVER_MS, TICK_MS, beatAt, type AnswerEvent } from "./shared";

type T = ReturnType<typeof makeTestCtx>;

function step(s: TugState, t: T, ms: number) {
  for (let left = ms; left > 0 && !t.result; left -= TICK_MS) {
    t.advance(TICK_MS);
    tug.tick?.(s, t.ctx);
    for (const p of t.ctx.players) {
      if (!p.bot) continue;
      const a = tug.bot?.(s, p.id, t.ctx);
      if (a) tug.action(s, p.id, a, t.ctx);
    }
  }
}

function toPull(s: TugState, t: T) {
  for (let i = 0; i < 200 && s.phase !== "pull" && !t.result; i++) step(s, t, TICK_MS);
  assert(s.phase === "pull" || t.result, "reaches pulling");
}

/** Answer the current question correctly for player `slot`. */
function answer(s: TugState, t: T, slot: number, right = true) {
  const p = s.pl[slot];
  const id = s.ids[slot];
  if (s.kind === "mash") return tug.action(s, id, { type: "mash", n: 4 }, t.ctx);
  if (s.kind === "rhythm") {
    let b = Math.max(0, Math.round((t.ctx.now() - beatAt(s.pullAt, 0)) / BEAT_MS));
    if (b <= p.beat) b = p.beat + 1;
    while (beatAt(s.pullAt, b) > t.ctx.now()) t.advance(10);
    return tug.action(s, id, { type: "beat", b, e: right ? 10 : 400 }, t.ctx);
  }
  const pr = p.prompt!;
  if (pr.k === "type") return tug.action(s, id, { type: "word", q: pr.q, text: right ? pr.w.toUpperCase() + " " : "nope" }, t.ctx);
  const c = p.ans as number;
  return tug.action(s, id, { type: "pick", q: pr.q, c: right ? c : (c + 1) % 4 }, t.ctx);
}

// ---------- setup & teams ----------
{
  const t = makeTestCtx(5);
  const s = tug.setup(t.ctx);
  assert(s.teams[0].length === 3 && s.teams[1].length === 2, "uneven teams split 3/2");
  assert(s.kind === "mash" && s.order[0] === "mash", "mixed matches open with mashing");
  assert(new Set(s.order).size === 5, "every challenge is in the rotation");
  const v = tug.view(s, "p0", t.ctx) as TugView;
  assert(v.me !== null && v.phase === "countdown", "players get their own prompt state");
  const spec = tug.view(s, "watcher", t.ctx) as TugView;
  assert(spec.me === null && spec.ids.length === 5, "spectators get a sensible view");
  console.log("✓ setup, teams, spectator view");
}

// ---------- junk & validation ----------
{
  const t = makeTestCtx(4);
  const s = tug.setup(t.ctx);
  const junk: unknown[] = [null, 1, "x", [], {}, { type: "mash" }, { type: "mash", n: 1e9 }, { type: "mash", n: 1.5 }, { type: "mash", n: -3 },
    { type: "word", q: "1", text: 5 }, { type: "pick", q: 1, c: 9 }, { type: "beat", b: -1, e: 0 }, { type: "beat", b: 1, e: Infinity }, { type: "__proto__" }];
  // Before pulling starts nothing counts.
  assert(tug.action(s, "p0", { type: "mash", n: 3 }, t.ctx) === false && s.pos === 0, "no pulling during the countdown");
  toPull(s, t);
  for (const j of junk) tug.action(s, "p0", j as never, t.ctx);
  assert(s.pos === 0, "junk moves nothing");
  assert(tug.action(s, "stranger", { type: "mash", n: 3 }, t.ctx) === false && s.pos === 0, "non-players can't pull");
  // Wrong challenge type is ignored.
  tug.action(s, "p0", { type: "beat", b: 0, e: 0 }, t.ctx);
  assert(s.pos === 0, "rhythm taps don't count in a mash round");
  // Mash rate limit: a flood of taps can't exceed the bucket.
  for (let i = 0; i < 50; i++) tug.action(s, "p0", { type: "mash", n: 8 }, t.ctx);
  assert(Math.abs(s.pos) <= 5 * MASH_PULL / 2 + 1e-6, `tap flood is capped (moved ${s.pos})`);
  console.log("✓ junk and floods rejected");
}

// ---------- every challenge works, wrong answers slip ----------
{
  const t = makeTestCtx(2, 7, { wins: 4 });
  const s = tug.setup(t.ctx);
  // Play the four non-mash challenges (mashing has its own tests below).
  s.order = ["rhythm", "type", "sums", "colour", "mash"];
  s.kind = "rhythm";
  const seen = new Set<string>();
  for (let r = 0; r < 5 && !t.result; r++) {
    toPull(s, t);
    const kind = s.kind as string;
    seen.add(kind);
    const red = s.ids.indexOf(s.teams[0][0]);
    const before = s.pos;
    answer(s, t, red, true);
    assert(s.pos < before, `${s.kind}: a right answer pulls toward Red`);
    if (kind === "sums" || kind === "colour") {
      const b2 = s.pos;
      answer(s, t, red, false);
      assert(s.pos > b2, `${s.kind}: a wrong answer slips the rope back`);
      const locked = s.pl[red].lockUntil > t.ctx.now();
      assert(locked, "and locks you briefly");
      const q = s.pl[red].prompt!.q;
      answer(s, t, red, true);
      assert(s.pl[red].prompt!.q === q, "locked answers are ignored");
    }
    if (kind === "type") {
      const ev = t.events.filter((e) => (e.event as AnswerEvent).k === "a" && e.to === s.ids[red]);
      assert(ev.length > 0, "the typist gets a private answer event");
    }
    // Red drags it home.
    for (let i = 0; i < 400 && s.phase === "pull"; i++) {
      if (s.kind === "rhythm") step(s, t, BEAT_MS);
      else if (s.kind === "mash") step(s, t, 300);
      else step(s, t, 1_000);
      answer(s, t, red, true);
      step(s, t, TICK_MS);
    }
    assert(s.history[s.history.length - 1]?.w === 0, `${s.kind}: Red takes the round`);
  }
  assert(seen.size === 4, "four different challenges played");
  assert(t.result && t.result.winners.length === 1 && t.result.winners[0] === s.teams[0][0], "Red wins best of 7 (4 wins)");
  assert(/Red team wins/.test(t.result.headline), t.result.headline);
  console.log("✓ every challenge, slips and locks, full match to a win");
}

// ---------- uneven teams stay fair ----------
{
  const t = makeTestCtx(3, 3, { mix: "mash" });
  const s = tug.setup(t.ctx);
  toPull(s, t);
  // Every player taps the same amount: the rope shouldn't move.
  for (let i = 0; i < 10; i++) {
    for (const id of s.ids) tug.action(s, id, { type: "mash", n: 1 }, t.ctx);
    t.advance(200);
  }
  assert(Math.abs(s.pos) < 2, `equal effort holds the flag still (pos ${s.pos})`);
  assert(s.order.every((k) => k === "mash"), "mash-only setting");
  console.log("✓ team-size scaling, mash-only");
}

// ---------- time limit, comeback, draws, settings ----------
{
  const t = makeTestCtx(2, 11, { wins: 2, mix: "brainy" });
  const s = tug.setup(t.ctx);
  assert(s.winsNeeded === 2 && s.maxRounds === 5, "best of 3");
  assert(s.order.every((k) => ["type", "sums", "colour"].includes(k)), "brainy mix");
  toPull(s, t);
  // Nobody does anything: draw at the buzzer.
  step(s, t, ROUND_MS + TICK_MS);
  assert(s.history[0]?.how === "draw" && s.phase === "roundOver", "an untouched rope is a draw");
  step(s, t, ROUND_OVER_MS + 4_000);
  assert((s.phase as string) === "pull" && s.round === 2, "next round starts");
  // Comeback: pulling back from your own side is stronger.
  const blue = s.ids.indexOf(s.teams[1][0]);
  const red = s.ids.indexOf(s.teams[0][0]);
  s.pos = -80;
  answer(s, t, blue, true);
  const back = s.pos + 80;
  s.pos = 0;
  s.pl[blue].streak = 0;
  answer(s, t, blue, true);
  assert(back > s.pos * 1.2, `comeback bonus (${back} vs ${s.pos})`);
  s.pos = 70;
  answer(s, t, red, true);
  step(s, t, ROUND_MS);
  assert(s.history[1]?.how === "time" && s.history[1].w === 1, "ahead at the buzzer wins");
  console.log("✓ draws, buzzer wins, comeback, settings");
}

// ---------- bad settings fall back ----------
{
  const t = makeTestCtx(2, 1, { wins: 99, mix: "chaos" });
  const s = tug.setup(t.ctx);
  assert(s.winsNeeded === 3 && s.order.length === 5, "defaults when settings are bad");
  console.log("✓ settings fall back to defaults");
}

// ---------- bots finish games ----------
for (const [n, bots, mix] of [[2, 2, "all"], [6, 6, "all"], [5, 4, "brainy"], [12, 12, "mash"]] as const) {
  const t = makeTestCtx(n, 5 + n, { mix }, bots);
  const s = tug.setup(t.ctx);
  step(s, t, 15 * 60_000);
  assert(t.result, `bots (${n}, ${mix}) finish a game`);
  const lines = s.history.filter((h) => h.how === "line").length;
  console.log(`  ${n} bots ${mix}: ${s.wins.join("–")} in ${s.history.length} rounds (${lines} dragged over), "${t.result.headline}"`);
}
console.log("✓ bots finish games");

// ---------- leaving ----------
{
  const t = makeTestCtx(4);
  const s = tug.setup(t.ctx);
  toPull(s, t);
  const blue = s.teams[1];
  // One blue leaves: the other blue's taps now count for the whole team.
  const p = t.ctx.players.find((x) => x.id === blue[0])!;
  p.connected = false;
  tug.playerLeft?.(s, p.id, t.ctx);
  tug.action(s, blue[1], { type: "mash", n: 2 }, t.ctx);
  assert(Math.abs(s.pos - 2 * MASH_PULL) < 1e-6, `a short-handed team still pulls full strength (${s.pos})`);
  step(s, t, ROUND_MS + 1_000);
  assert(!t.result, "one player gone doesn't end the game");
  // Whole blue team gone: Red wins after the grace period.
  const q = t.ctx.players.find((x) => x.id === blue[1])!;
  q.connected = false;
  tug.playerLeft?.(s, q.id, t.ctx);
  step(s, t, 5_000);
  assert(!t.result && (tug.view(s, "p0", t.ctx) as TugView).abandonAt, "a countdown to forfeit shows");
  q.connected = true;
  tug.playerReturned?.(s, q.id, t.ctx);
  step(s, t, 15_000);
  assert(!t.result, "returning in time cancels the forfeit");
  q.connected = false;
  tug.playerLeft?.(s, q.id, t.ctx);
  step(s, t, 13_000);
  const res = t.result as { winners: string[] } | null;
  assert(res && res.winners.length === 2 && res.winners.every((id) => s.teams[0].includes(id)), "red wins by forfeit");
  console.log("✓ leaving doesn't soft-lock; forfeit");
}
{
  const t = makeTestCtx(2);
  const s = tug.setup(t.ctx);
  for (const p of t.ctx.players) {
    p.connected = false;
    tug.playerLeft?.(s, p.id, t.ctx);
  }
  step(s, t, FIRST_COUNTDOWN_MS + 14_000);
  assert(t.result && t.result.winners.length === 0, "everyone gone ends the game (draw at 0-0)");
  console.log("✓ empty room ends");
}

// ---------- traffic ----------
{
  const t = makeTestCtx(4);
  const s = tug.setup(t.ctx);
  toPull(s, t);
  t.events.length = 0;
  step(s, t, 3_000);
  assert(t.events.length <= 4, `an idle rope only sends heartbeats (${t.events.length})`);
  const size = JSON.stringify(tug.view(s, "p0", t.ctx)).length;
  assert(size < 1_500, `view stays small (${size} bytes)`);
  void LINE;
  console.log("✓ quiet traffic, small views");
}
console.log("✓ tug: all tests passed");
