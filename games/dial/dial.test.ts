import { topScorers } from "../../shared/game";
import { assert as assertTs, makeTestCtx } from "../../shared/testing";
import type { GameResult } from "../../shared/types";
import { SPECTRUMS } from "./data";
import game, { type DialPhase, type DialState, type DialView } from "./server";
import {
  ABANDON_MS,
  AWAY_GRACE_MS,
  CLUE_MAX,
  CLUE_MS,
  DIAL_EMIT_MIN_MS,
  GUESS_MS,
  REVEAL_MS,
  TARGET_MAX,
  TARGET_MIN,
  cleanClue,
  clueProblem,
  isBareDialNumber,
  isDialEvent,
  pointsFor,
} from "./shared";

// ---------- helpers ----------

/**
 * Same as shared assert, minus TypeScript narrowing: game.action/tick mutate the
 * state, so a field checked earlier may legitimately hold a different value later.
 */
function assert(cond: unknown, msg?: string): void {
  assertTs(cond, msg);
}

type T = ReturnType<typeof makeTestCtx>;

/** A test ctx whose `end` calls are counted. */
function harness(n: number, seed = 42) {
  const t = makeTestCtx(n, seed);
  const calls: GameResult[] = [];
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    calls.push(r);
    end(r);
  };
  const s: DialState = game.setup(t.ctx);
  return { t, s, calls };
}

const view = (s: DialState, id: string, t: T) => game.view(s, id, t.ctx) as DialView;
const tick = (s: DialState, t: T, ms = 0) => {
  t.advance(ms);
  return game.tick!(s, t.ctx);
};
const act = (s: DialState, t: T, id: string, a: unknown) => game.action(s, id, a as never, t.ctx);
const giverId = (s: DialState) => s.ids[s.order[s.round]];
/** Reads the phase without letting TypeScript narrow it across mutating calls. */
const phaseOf = (s: DialState): DialPhase => s.phase;
const guessersOf = (s: DialState) => s.ids.filter((_, i) => i !== s.order[s.round]);
const clamp = (v: number) => Math.max(0, Math.min(100, v));
const snap = (s: DialState) => JSON.stringify(s);

function disconnect(s: DialState, t: T, id: string) {
  t.ctx.player(id)!.connected = false;
  game.playerLeft!(s, id, t.ctx);
}
function reconnect(s: DialState, t: T, id: string) {
  t.ctx.player(id)!.connected = true;
  game.playerReturned!(s, id, t.ctx);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Recursively checks a value is plain JSON (no undefined, functions, NaN, Map...). */
function isPlainJson(v: unknown): boolean {
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isPlainJson);
  if (typeof v === "object") {
    if (Object.getPrototypeOf(v) !== Object.prototype) return false;
    return Object.values(v as object).every(isPlainJson);
  }
  return false;
}

/** Plays the current round: clue, then every guesser locks at target + offset[k]. */
function playRound(s: DialState, t: T, offsets: number[], clue = "a fine clue") {
  assert(s.phase === "clue", `expected clue phase, got ${s.phase}`);
  assert(act(s, t, giverId(s), { type: "clue", text: clue }) === true, "clue accepted");
  assert(s.phase === "guess", "guess phase after clue");
  const g = guessersOf(s);
  g.forEach((id, k) => {
    const v = clamp(s.target + (offsets[k % offsets.length] ?? 0));
    act(s, t, id, { type: "dial", v: clamp(v + 7) }); // wiggle first
    act(s, t, id, { type: "lock", v });
  });
  assert(s.phase === "reveal", "everyone locked -> reveal immediately");
}

// ---------- content & scoring ----------

{
  assert(SPECTRUMS.length >= 80, `need >= 80 spectrums, have ${SPECTRUMS.length}`);
  const seen = new Set<string>();
  for (const [l, r] of SPECTRUMS) {
    assert(typeof l === "string" && typeof r === "string", "labels are strings");
    assert(l.trim() === l && r.trim() === r && l.length > 0 && r.length > 0, `bad label: ${l} / ${r}`);
    assert(l.length <= 22 && r.length <= 22, `label too long: ${l} / ${r}`);
    assert(l.toLowerCase() !== r.toLowerCase(), "ends differ");
    const key = [l, r].map((x) => x.toLowerCase()).sort().join("|");
    assert(!seen.has(key), `duplicate spectrum ${l} / ${r}`);
    seen.add(key);
  }
  // Scales that measure the same thing with synonym ends feel like a repeat in one
  // game: at most one from each group.
  const sameAxis: string[][] = [
    ["Fragile", "Delicate"],
    ["Gone in a second", "Temporary"],
    ["Tastes like nothing", "Bland"],
    ["Introvert activity", "Solo activity"],
    ["Unpopular opinion", "Lukewarm take"],
    ["For kids", "Childish"],
    ["Rare", "Easy to find"],
    ["Feels like Monday", "Weekday", "Ordinary day"],
    ["Not scary at all", "Harmless monster"],
    ["Simple", "Common sense"],
  ];
  const ends = new Set(SPECTRUMS.flatMap(([l, r]) => [l, r]));
  for (const group of sameAxis) {
    const present = group.filter((x) => ends.has(x));
    assert(present.length <= 1, `same-axis spectrums: ${present.join(", ")}`);
  }
  // Every scale needs two ends of one quantity (these didn't).
  for (const bad of ["Needs batteries", "Sounds fake", "Fun to watch", "Healthy snack"]) {
    assert(!ends.has(bad), `ill-formed spectrum end: ${bad}`);
  }
}

{
  const cases: [number, number][] = [
    [0, 4], [3, 4], [4, 3], [8, 3], [9, 2], [14, 2], [15, 1], [20, 1], [21, 0], [96, 0],
  ];
  for (const [d, pts] of cases) assert(pointsFor(d) === pts, `pointsFor(${d}) should be ${pts}`);
}

{
  assert(cleanClue("  Hot\n\n  dog​ ‮ ") === "Hot dog", "clue cleaned");
  assert(cleanClue("\u0000\u0007 control") === "control", "control chars stripped");
  assert(cleanClue("🧑‍🚀 astronaut") === "🧑‍🚀 astronaut", "emoji ZWJ kept");
  assert(clueProblem("") !== null, "empty clue rejected");
  assert(clueProblem("62") !== null && clueProblem("6 2%") !== null && clueProblem("#62/100") !== null, "numbers rejected");
  assert(clueProblem("90s music") === null && clueProblem("🔥🔥") === null, "normal clues ok");
  assert(clueProblem("x".repeat(CLUE_MAX)) === null && clueProblem("x".repeat(CLUE_MAX + 1)) !== null, "length limit");

  // Only a bare dial position (0-100) is refused, in any digit form; titles and other numbers are clues.
  const bare = ["62", "6 2", "62%", "#62/100", "0", "100", "62.5", "62,5", "\uff16\uff12", "\u0666\u0662", "6\ufe0f\u20e32\ufe0f\u20e3", "(62)!"];
  for (const n of bare) {
    assert(isBareDialNumber(n) && clueProblem(cleanClue(n)) !== null, `bare number refused: ${n}`);
  }
  for (const ok of ["1917", "1984", "300", "2012", "911", "101", "24/7", "007", "1,000", "Area 51", "90s", "7 dwarfs", "9 to 5"]) {
    assert(!isBareDialNumber(ok) && clueProblem(cleanClue(ok)) === null, `number-ish clue allowed: ${ok}`);
  }

  // Blank-looking clues: invisible "letters" and lone joiners/selectors are stripped or refused.
  const blanks = ["\u3164", "\u115f", "\uffa0", "\u2800", "\u200d", "\u200c", "\ufe0f", "\u034f", "\u061c", "\u180e", "\u{e0041}\u{e0042}", "\u3164 \u2800"];
  for (const blank of blanks) {
    assert(clueProblem(cleanClue(blank)) !== null, `blank clue refused: ${JSON.stringify(blank)}`);
  }
  assert(cleanClue("hot\u3164dog") === "hotdog" && cleanClue("a\u2060b\u00adc") === "abc", "fillers and Cf stripped");
  const flag = "\u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}"; // Scotland: black flag + tags
  assert(cleanClue("\u2764\ufe0f love") === "\u2764\ufe0f love" && cleanClue(flag + " pride") === flag + " pride", "emoji presentation and flag tags kept");
  // Zalgo: at most three combining marks per character survive; normal accents are untouched.
  const zalgo = cleanClue("W" + "\u0301".repeat(39));
  assert([...zalgo].length <= 4 && clueProblem(zalgo) === null, `mark pile trimmed (${zalgo.length})`);
  assert(cleanClue("cafe\u0301") === "caf\u00e9" && cleanClue("Pok\u00e9mon") === "Pok\u00e9mon", "accents kept");
}

// ---------- setup: order, targets, timers ----------

for (const n of [2, 3, 4, 7, 12]) {
  for (const seed of [1, 2, 3, 99, 12345]) {
    const { t, s } = harness(n, seed);
    const rounds = n <= 3 ? n * 2 : n;
    assert(s.order.length === rounds, `${n} players -> ${rounds} rounds`);
    for (let i = 0; i < n; i++) {
      const times = s.order.filter((x) => x === i).length;
      assert(times === (n <= 3 ? 2 : 1), `seat ${i} gives ${n <= 3 ? 2 : 1} clue(s)`);
    }
    for (let r = 1; r < s.order.length; r++) assert(s.order[r] !== s.order[r - 1], "no back-to-back clue-giver");
    assert(s.phase === "clue" && s.round === 0, "starts in clue phase");
    assert(s.endsAt === t.ctx.now() + CLUE_MS, "clue deadline is 60s out");
    assert(Number.isInteger(s.target) && s.target >= TARGET_MIN && s.target <= TARGET_MAX, "target in range");
    const v = view(s, t.ids[0], t);
    assert(v.rounds === rounds && v.round === 1 && v.phaseMs === CLUE_MS, "view basics");
    assert(v.game === t.ctx.now(), "view carries a per-game key");
  }
}

{
  // Targets stay within 4..96 across many draws.
  const t = makeTestCtx(4, 7);
  for (let i = 0; i < 300; i++) {
    const s: DialState = game.setup(t.ctx);
    assert(s.target >= TARGET_MIN && s.target <= TARGET_MAX && Number.isInteger(s.target), "target range");
  }
}

// ---------- a full 4-player game ----------

{
  const { t, s, calls } = harness(4, 2024);
  const offsets = [0, -5, 11, 30]; // 4 pts, 3 pts, 2 pts, 0 pts
  const expected = [0, 0, 0, 0];
  let rounds = 0;
  while (s.phase !== "final") {
    assert(rounds++ < 20, "game terminates");
    const giver = s.order[s.round];
    const target = s.target;
    playRound(s, t, offsets);
    const v = view(s, t.ids[0], t);
    assert(v.phase === "reveal" && v.reveal && v.target === target, "reveal shows the target to everyone");
    let sum = 0;
    let guessed = 0;
    guessersOf(s).forEach((id, k) => {
      const pos = clamp(target + offsets[k]);
      const pts = pointsFor(Math.abs(pos - target));
      expected[s.ids.indexOf(id)] += pts;
      sum += pts;
      guessed++;
      const row = v.reveal!.rows.find((r) => r.id === id)!;
      assert(row.v === pos && row.pts === pts, `row for ${id}`);
    });
    const giverPts = Math.round(sum / guessed);
    expected[giver] += giverPts;
    assert(v.reveal!.giverPts === giverPts, "giver gets the rounded average");
    const dists = v.reveal!.rows.map((r) => r.dist ?? 1000);
    assert(dists.every((d, i) => i === 0 || dists[i - 1] <= d), "rows sorted closest first");
    // Reveal lasts 7s.
    assert(tick(s, t, REVEAL_MS - 10) === false && s.phase === "reveal", "reveal holds for 7s");
    tick(s, t, 10);
    assert(calls.length === 0 || phaseOf(s) === "final", "end only at the very end");
  }
  assert(rounds === 4, "4 players -> 4 rounds");
  assert(calls.length === 1, "ctx.end called exactly once");
  const result = calls[0];
  assert(deepEqual(s.score, expected), `scores ${s.score} vs ${expected}`);
  for (let i = 0; i < 4; i++) assert(result.scores![t.ids[i]] === expected[i], "result scores");
  const winners = topScorers(Object.fromEntries(t.ids.map((id, i) => [id, expected[i]])));
  assert(deepEqual([...result.winners].sort(), [...winners].sort()), "winners are the top scorers");
  assert(result.headline.length > 0 && result.headline.length < 120, "headline is one line");
  assert(result.winners.every((id) => result.headline.includes(t.ctx.player(id)!.name)) || result.winners.length > 3, "headline names winners");
  // Final view: recap of every round, nothing more to do.
  const fv = view(s, t.ids[1], t);
  assert(fv.phase === "final" && fv.recap.length === 4 && fv.reveal === null, "final view has the recap");
  assert(fv.recap.every((r) => !r.skipped && r.clue === "a fine clue"), "recap rounds");
  // After the end: everything is ignored and nothing ticks.
  const before = snap(s);
  assert(act(s, t, t.ids[0], { type: "clue", text: "late" }) === false, "no actions after end");
  assert(act(s, t, t.ids[1], { type: "dial", v: 3 }) === false, "no dial after end");
  assert(tick(s, t, 60_000) === false, "no ticks after end");
  game.playerLeft!(s, t.ids[2], t.ctx);
  game.playerReturned!(s, t.ids[2], t.ctx);
  assert(snap(s) === before, "final is inert");
  assert(calls.length === 1, "still exactly one end");
}

// ---------- phase timers ----------

{
  // Clue timeout: skipped, no points, next giver.
  const { t, s } = harness(4, 5);
  const first = giverId(s);
  assert(tick(s, t, CLUE_MS - 1) === false && s.phase === "clue", "clue holds until the deadline");
  assert(tick(s, t, 1) === true, "clue deadline advances");
  assert(s.phase === "clue" && s.round === 1 && giverId(s) !== first, "next clue-giver");
  assert(s.score.every((x) => x === 0), "no points for a skipped round");
  const v = view(s, t.ids[0], t);
  assert(v.notice?.id === first && v.notice.why === "timeout", "skip notice shown");
  assert(s.endsAt === t.ctx.now() + CLUE_MS, "fresh 60s for the next giver");
  // Notice clears once the next clue is given.
  act(s, t, giverId(s), { type: "clue", text: "next one" });
  assert(view(s, t.ids[0], t).notice === null, "notice cleared");
}

{
  // Guess timeout: movers use their last position, never-moved score 0.
  const { t, s } = harness(4, 6);
  act(s, t, giverId(s), { type: "clue", text: "teapot" });
  assert(s.endsAt === t.ctx.now() + GUESS_MS, "guess lasts 40s");
  const [a, b, c] = guessersOf(s);
  const target = s.target;
  act(s, t, a, { type: "dial", v: target }); // moved, never locked: still scores 4
  act(s, t, b, { type: "lock", v: clamp(target + 9) }); // locked: 2
  // c never touches the dial
  assert(tick(s, t, GUESS_MS - 1) === false && s.phase === "guess", "guess holds until the deadline");
  tick(s, t, 1);
  assert(s.phase === "reveal", "timeout -> reveal");
  const rows = s.reveal!.rows;
  const row = (id: string) => rows.find((r) => r.id === id)!;
  assert(row(a).pts === 4 && row(a).v === target, "unlocked mover uses last position");
  assert(row(b).pts === pointsFor(Math.abs(clamp(target + 9) - target)), "locked scores");
  assert(row(c).v === null && row(c).pts === 0 && row(c).dist === null, "never moved scores 0");
  assert(rows[rows.length - 1].id === c, "no-guess rows last");
  const giverPts = Math.round((row(a).pts + row(b).pts) / 2);
  assert(s.reveal!.giverPts === giverPts, "giver average ignores players who never guessed");
  tick(s, t, REVEAL_MS);
  assert(s.phase === "clue" && s.round === 1, "reveal -> next clue");
  assert(s.needle.every((x) => x === null) && s.locked.every((x) => !x), "needles reset per round");
}

{
  // Lock without moving commits to the middle (where the needle sits).
  const { t, s } = harness(3, 8);
  act(s, t, giverId(s), { type: "clue", text: "middle-ish" });
  const [a] = guessersOf(s);
  assert(act(s, t, a, { type: "lock" }) === true, "bare lock accepted");
  assert(s.needle[s.ids.indexOf(a)] === 50 && s.locked[s.ids.indexOf(a)], "locked at 50");
  assert(act(s, t, a, { type: "lock" }) === false, "double lock rejected");
  assert(act(s, t, a, { type: "dial", v: 10 }) === false, "no moving after lock");
}

{
  // Nobody guesses at all: giver gets 0, timers carry the game to the end.
  const { t, s, calls } = harness(3, 9);
  let guard = 0;
  while (s.phase !== "final" && guard++ < 50) {
    if (s.phase === "clue") act(s, t, giverId(s), { type: "clue", text: "silence" });
    tick(s, t, 41_000);
  }
  assert(s.phase === "final" && calls.length === 1, "ends via timers");
  assert(calls[0].winners.length === 0 && /nobody/i.test(calls[0].headline), "nobody scored -> no winners");
}

// ---------- clue-giver average, by hand ----------

{
  // Guessers score 4 and 3 -> average 3.5 rounds to 4.
  const { t, s } = harness(3, 31);
  s.target = 50;
  act(s, t, giverId(s), { type: "clue", text: "halfway" });
  const [a, b] = guessersOf(s);
  act(s, t, a, { type: "lock", v: 53 }); // 3 off -> 4
  act(s, t, b, { type: "lock", v: 46 }); // 4 off -> 3
  assert(s.reveal!.giverPts === 4, "3.5 rounds up to 4");
  assert(s.score[s.ids.indexOf(giverId(s))] === 4 && s.score[s.ids.indexOf(a)] === 4 && s.score[s.ids.indexOf(b)] === 3, "scores");
}

{
  // 4, 3 and 0 -> 2.33 rounds to 2; a guesser who never moved doesn't drag the average down.
  const { t, s } = harness(5, 32);
  s.target = 20;
  act(s, t, giverId(s), { type: "clue", text: "chilly" });
  const [a, b, c, d] = guessersOf(s);
  act(s, t, a, { type: "lock", v: 20 }); // 4
  act(s, t, b, { type: "lock", v: 28 }); // 8 off -> 3
  act(s, t, c, { type: "lock", v: 99 }); // 79 off -> 0
  // d never moves
  tick(s, t, GUESS_MS);
  assert(s.phase === "reveal", "timeout reveal");
  assert(s.reveal!.rows.find((r) => r.id === d)!.v === null, "d never guessed");
  assert(s.reveal!.giverPts === 2, `7/3 rounds to 2, got ${s.reveal!.giverPts}`);
  const v = view(s, a, t);
  assert(v.reveal!.rows.map((r) => r.id).join() === [a, b, c, d].join(), "closest first, no-guess last");
}

// ---------- early advance ----------

{
  const { t, s } = harness(5, 10);
  act(s, t, giverId(s), { type: "clue", text: "early bird" });
  const g = guessersOf(s);
  g.slice(0, -1).forEach((id) => act(s, t, id, { type: "lock", v: 20 }));
  assert(s.phase === "guess", "waits for the last guesser");
  act(s, t, g[g.length - 1], { type: "lock", v: 80 });
  assert(s.phase === "reveal" && s.endsAt === t.ctx.now() + REVEAL_MS, "all locked -> reveal now");
}

// ---------- the live dial ----------

{
  const { t, s } = harness(4, 11);
  act(s, t, giverId(s), { type: "clue", text: "live" });
  const [a] = guessersOf(s);
  t.events.length = 0;
  assert(act(s, t, a, { type: "dial", v: 33 }) === false, "dial returns false (no full re-send)");
  assert(t.events.length === 1, "one event emitted");
  const ev = t.events[0];
  assert(isDialEvent(ev.event) && ev.event.id === a && ev.event.v === 33, "event payload {k,id,v}");
  assert(ev.except === a && ev.to === undefined, "sent to everyone except the mover");
  assert(act(s, t, a, { type: "dial", v: 33 }) === false && t.events.length === 1, "same value: no event");
  t.advance(DIAL_EMIT_MIN_MS);
  act(s, t, a, { type: "dial", v: 0 });
  t.advance(DIAL_EMIT_MIN_MS);
  act(s, t, a, { type: "dial", v: 100 });
  assert(t.events.length === 3 && s.needle[s.ids.indexOf(a)] === 100, "latest value stored");
  // Spam guard: values faster than DIAL_EMIT_MIN_MS are stored, and the latest goes out on the next tick.
  t.events.length = 0;
  t.advance(DIAL_EMIT_MIN_MS);
  act(s, t, a, { type: "dial", v: 10 });
  act(s, t, a, { type: "dial", v: 11 });
  act(s, t, a, { type: "dial", v: 12 });
  assert(t.events.length === 1 && s.needle[s.ids.indexOf(a)] === 12, "bursts stored, one broadcast");
  assert(tick(s, t, 250) === false, "flushing needles needs no full re-send");
  assert(t.events.length === 2 && (t.events[1].event as { v: number }).v === 12, "latest value flushed on tick");
  tick(s, t, 250);
  assert(t.events.length === 2, "nothing pending, nothing sent");
  t.advance(DIAL_EMIT_MIN_MS);
  act(s, t, a, { type: "dial", v: 100 });
  assert(t.events.length === 3, "normal pace broadcasts immediately");
  // Late joiners / spectators see last known positions in the view.
  const sv = view(s, "spectator", t);
  assert(sv.seats.find((x) => x.id === a)!.v === 100, "spectator view has live needle");
  assert(sv.role === "spectator", "spectator role");
}

// ---------- reroll ----------

{
  const { t, s } = harness(4, 12);
  const giver = giverId(s);
  const [other] = guessersOf(s);
  const target = s.target;
  const before = view(s, giver, t);
  assert(act(s, t, other, { type: "reroll" }) === false, "only the clue-giver can reroll");
  assert(act(s, t, giver, { type: "reroll" }) === true, "reroll accepted");
  const after = view(s, giver, t);
  assert(after.rerolled && `${after.left}|${after.right}` !== `${before.left}|${before.right}`, "new spectrum");
  assert(s.target === target, "target unchanged by reroll");
  assert(act(s, t, giver, { type: "reroll" }) === false, "only one reroll");
  act(s, t, giver, { type: "clue", text: "ok" });
  assert(act(s, t, giver, { type: "reroll" }) === false, "no reroll during guessing");
  // Fresh reroll next round.
  guessersOf(s).forEach((id) => act(s, t, id, { type: "lock" }));
  tick(s, t, REVEAL_MS);
  assert(s.phase === "clue" && !s.rerolled && act(s, t, giverId(s), { type: "reroll" }) === true, "reroll resets per round");
}

// ---------- hostile input ----------

{
  const { t, s } = harness(4, 13);
  const giver = giverId(s);
  const [g1] = guessersOf(s);
  const junk: unknown[] = [
    null, undefined, 42, "clue", [], [{ type: "clue", text: "x" }], {}, { type: null }, { type: "x" },
    { type: "__proto__" }, { type: "constructor" }, { type: "toString" },
    { type: "clue" }, { type: "clue", text: 5 }, { type: "clue", text: ["array"] }, { type: "clue", text: { a: 1 } },
    { type: "clue", text: "" }, { type: "clue", text: "    " }, { type: "clue", text: "\u0000\u0007" },
    { type: "clue", text: "x".repeat(CLUE_MAX + 1) }, { type: "clue", text: "y".repeat(1_000_000) },
    { type: "clue", text: "62" }, { type: "clue", text: "  6 2 % " },
    { type: "dial", v: 50 }, { type: "lock" }, { type: "lock", v: 40 },
  ];
  const before = snap(s);
  for (const a of junk) {
    assert(act(s, t, giver, a) === false, `giver junk rejected: ${JSON.stringify(a)?.slice(0, 40)}`);
    assert(act(s, t, g1, a) === false, `guesser junk rejected: ${JSON.stringify(a)?.slice(0, 40)}`);
  }
  assert(act(s, t, g1, { type: "clue", text: "not my turn" }) === false, "guesser can't give the clue");
  assert(act(s, t, "stranger", { type: "clue", text: "hi" }) === false, "non-participant rejected");
  assert(act(s, t, "spectator", { type: "reroll" }) === false, "spectator rejected");
  assert(snap(s) === before && t.events.length === 0, "junk changed nothing");

  // Guess phase junk.
  assert(act(s, t, giver, { type: "clue", text: "  Lukewarm\tcoffee  " }) === true, "valid clue");
  assert(s.clue === "Lukewarm coffee", "clue sanitized");
  assert(act(s, t, giver, { type: "clue", text: "again" }) === false, "clue only once");
  const guessJunk: unknown[] = [
    { type: "dial" }, { type: "dial", v: -1 }, { type: "dial", v: 101 }, { type: "dial", v: 50.5 },
    { type: "dial", v: "50" }, { type: "dial", v: null }, { type: "dial", v: Number.NaN },
    { type: "dial", v: Infinity }, { type: "dial", v: [50] }, { type: "dial", v: { v: 1 } },
    { type: "lock", v: 101 }, { type: "lock", v: "1" }, { type: "lock", v: null }, { type: "lock", v: 3.3 },
    { type: "reroll" }, { type: "clue", text: "late" },
  ];
  const mid = snap(s);
  for (const a of guessJunk) assert(act(s, t, g1, a) === false, `guess junk rejected: ${JSON.stringify(a)}`);
  assert(act(s, t, giver, { type: "dial", v: 10 }) === false, "giver can't dial");
  assert(act(s, t, giver, { type: "lock", v: 10 }) === false, "giver can't lock");
  assert(snap(s) === mid && t.events.length === 0, "guess junk changed nothing");

  // Reveal phase: nothing goes.
  guessersOf(s).forEach((id) => act(s, t, id, { type: "lock", v: 50 }));
  assert(s.phase === "reveal", "reveal");
  const rev = snap(s);
  for (const a of [{ type: "dial", v: 3 }, { type: "lock" }, { type: "clue", text: "x" }, { type: "reroll" }]) {
    for (const id of s.ids) assert(act(s, t, id, a) === false, "reveal ignores actions");
  }
  assert(snap(s) === rev, "reveal junk changed nothing");
}

// ---------- secrecy ----------

{
  const { t, s } = harness(4, 14);
  const giver = giverId(s);
  const others = [...guessersOf(s), "spectator"];
  const check = (label: string) => {
    s.target = 37;
    assert(view(s, giver, t).target === 37, `${label}: giver sees the target`);
    for (const id of others) {
      const v = view(s, id, t);
      assert(v.target === null && v.reveal === null && v.recap.length === 0, `${label}: hidden from ${id}`);
    }
    // A distinctive value proves it isn't smuggled out in any other field.
    s.target = 12.3456789;
    assert(JSON.stringify(view(s, giver, t)).includes("12.3456789"), `${label}: giver json has it`);
    for (const id of others) {
      assert(!JSON.stringify(view(s, id, t)).includes("12.3456789"), `${label}: no leak to ${id}`);
    }
    s.target = 37;
  };
  check("clue");
  act(s, t, giver, { type: "reroll" });
  check("clue after reroll");
  act(s, t, giver, { type: "clue", text: "secret" });
  check("guess");
  const [a] = guessersOf(s);
  act(s, t, a, { type: "dial", v: 70 });
  check("guess with needles");
  // Events never carry the target.
  assert(t.events.length > 0, "needle events were emitted");
  for (const e of t.events) {
    assert(isDialEvent(e.event) && Object.keys(e.event as object).sort().join() === "id,k,v", "events carry only k/id/v");
  }
  guessersOf(s).forEach((id) => act(s, t, id, { type: "lock" }));
  for (const id of [...s.ids, "spectator"]) assert(view(s, id, t).target === 37, "revealed to all");
}

// ---------- views are plain JSON in every phase ----------

{
  const { t, s } = harness(3, 15);
  const viewers = [...t.ids, "spectator"];
  const checkAll = (label: string) => {
    for (const id of viewers) {
      const v = view(s, id, t);
      assert(isPlainJson(v), `${label}: view for ${id} is plain JSON`);
      assert(deepEqual(JSON.parse(JSON.stringify(v)), v), `${label}: round-trips`);
    }
  };
  checkAll("clue");
  act(s, t, giverId(s), { type: "clue", text: "json" });
  act(s, t, guessersOf(s)[0], { type: "dial", v: 12 });
  checkAll("guess");
  guessersOf(s).forEach((id) => act(s, t, id, { type: "lock" }));
  checkAll("reveal");
  let guard = 0;
  while (s.phase !== "final" && guard++ < 50) tick(s, t, CLUE_MS);
  checkAll("final");
}

// ---------- disconnects ----------

{
  // Clue-giver leaves during the clue phase: skipped after the grace period.
  const { t, s } = harness(4, 16);
  const giver = giverId(s);
  disconnect(s, t, giver);
  const v = view(s, t.ids.find((id) => id !== giver)!, t);
  assert(v.skipAt === t.ctx.now() + AWAY_GRACE_MS, "everyone sees when the skip happens");
  tick(s, t, AWAY_GRACE_MS - 10);
  assert(s.round === 0 && s.phase === "clue", "not skipped during the grace period");
  tick(s, t, 10);
  assert(s.round === 1 && s.phase === "clue", "skipped after grace");
  assert(view(s, t.ids[0], t).notice?.why === "away", "away notice");
  // They come back and later get their own... (they were giver once; with 4 players no second turn)
  reconnect(s, t, giver);
  assert(s.away[s.ids.indexOf(giver)] === null, "back");
}

{
  // Clue-giver blips (refresh) and returns within the grace: keeps the turn.
  const { t, s } = harness(4, 17);
  const giver = giverId(s);
  const deadline = s.endsAt;
  disconnect(s, t, giver);
  tick(s, t, 3_000);
  reconnect(s, t, giver);
  tick(s, t, AWAY_GRACE_MS);
  assert(s.round === 0 && s.phase === "clue" && s.endsAt === deadline, "turn kept, deadline unchanged");
  assert(view(s, t.ids[0], t).skipAt === null, "no skip pending");
  assert(act(s, t, giver, { type: "clue", text: "made it" }) === true, "can still give the clue");
}

{
  // A giver who left long before their turn still gets the grace period on their own turn,
  // with a visible countdown, and keeps the turn if they come back in time.
  const { t, s } = harness(4, 18);
  const nextGiver = s.ids[s.order[1]];
  disconnect(s, t, nextGiver);
  tick(s, t, 30_000);
  tick(s, t, CLUE_MS); // round 0 times out -> round 1 (the absent giver)
  assert(s.round === 1, "on to round 1");
  const turnStart = t.ctx.now();
  assert(view(s, t.ids[0], t).skipAt === turnStart + AWAY_GRACE_MS, "countdown starts with their turn");
  tick(s, t, 250);
  assert(s.round === 1, "not skipped on the first tick of their turn");
  tick(s, t, AWAY_GRACE_MS - 500);
  assert(s.round === 1, "still within the grace");
  reconnect(s, t, nextGiver);
  tick(s, t, 5_000);
  assert(s.round === 1 && view(s, t.ids[0], t).skipAt === null, "came back in time: keeps the turn");
  assert(act(s, t, nextGiver, { type: "clue", text: "phew" }) === true, "and gives the clue");
}

{
  // Still absent when their grace runs out: skipped, and the next giver starts fresh.
  const { t, s } = harness(4, 18);
  const nextGiver = s.ids[s.order[1]];
  disconnect(s, t, nextGiver);
  tick(s, t, CLUE_MS);
  assert(s.round === 1, "absent giver's turn");
  tick(s, t, AWAY_GRACE_MS - 1);
  assert(s.round === 1, "grace holds");
  tick(s, t, 1);
  assert(s.round === 2 && view(s, t.ids[0], t).notice?.id === nextGiver, "skipped after the grace");
}

for (const where of ["clue", "guess", "reveal"] as const) {
  // Everyone drops at once (shared Wi-Fi blip): no turns are burned. The game waits for the
  // abandonment timer and ends abandoned, not as a normal finish full of skipped rounds.
  const { t, s, calls } = harness(4, 40);
  if (where !== "clue") act(s, t, giverId(s), { type: "clue", text: "together" });
  if (where === "reveal") guessersOf(s).forEach((id) => act(s, t, id, { type: "lock", v: 50 }));
  assert(phaseOf(s) === where, `in ${where}`);
  const start = t.ctx.now();
  for (const id of s.ids) disconnect(s, t, id);
  let guard = 0;
  while (phaseOf(s) !== "final" && guard++ < 400) tick(s, t, 250);
  assert(calls.length === 1 && s.abandoned, `${where}: ended as abandoned`);
  assert(t.ctx.now() - start >= ABANDON_MS, `${where}: not before the ${ABANDON_MS}ms countdown`);
  assert(s.recap.every((r) => !r.skipped), `${where}: no turns burned`);
  assert(/not enough players/i.test(calls[0].headline), `${where}: headline explains why`);
}

{
  // Everyone drops for 12s and comes back: same round, same phase, nobody lost a turn.
  const { t, s, calls } = harness(4, 41);
  tick(s, t, 3_000);
  const round = s.round;
  for (const id of s.ids) disconnect(s, t, id);
  for (let k = 0; k < 48; k++) tick(s, t, 250);
  for (const id of s.ids) reconnect(s, t, id);
  tick(s, t, 250);
  assert(calls.length === 0 && phaseOf(s) === "clue" && s.round === round, "resumed where it was");
  assert(act(s, t, giverId(s), { type: "clue", text: "we're back" }) === true, "giver kept the turn");
}

{
  // 2 players, one refreshes (3s): no "game ends" warning flashes. A real drop shows it after the grace.
  const { t, s } = harness(2, 42);
  const [a, b] = s.ids;
  disconnect(s, t, a);
  for (let k = 0; k < 12; k++) {
    tick(s, t, 250);
    assert(view(s, b, t).endingAt === null, "no warning during a refresh");
  }
  reconnect(s, t, a);
  tick(s, t, 250);
  const left = t.ctx.now();
  disconnect(s, t, a);
  tick(s, t, AWAY_GRACE_MS - 250);
  assert(view(s, b, t).endingAt === null, "still nothing just before the grace");
  tick(s, t, 250);
  assert(view(s, b, t).endingAt === left + ABANDON_MS, "warning once they've been gone a while");
}

{
  // Guesser drops mid-guess: others locked -> wait out the grace, then reveal using their last position.
  const { t, s } = harness(4, 19);
  act(s, t, giverId(s), { type: "clue", text: "drop" });
  const [a, b, c] = guessersOf(s);
  act(s, t, c, { type: "dial", v: s.target });
  disconnect(s, t, c);
  act(s, t, a, { type: "lock", v: 10 });
  act(s, t, b, { type: "lock", v: 90 });
  assert(s.phase === "guess", "briefly waits for the dropped guesser");
  tick(s, t, AWAY_GRACE_MS - 1);
  assert(s.phase === "guess", "still in grace");
  tick(s, t, 1);
  assert(s.phase === "reveal", "stops waiting after the grace");
  assert(s.reveal!.rows.find((r) => r.id === c)!.pts === 4, "dropped guesser's needle still counts");
  // Reveal continues with someone away; the next round starts normally.
  tick(s, t, REVEAL_MS);
  assert(s.phase === "clue" && s.round === 1, "reveal not stalled");
  reconnect(s, t, c);
  assert(!view(s, a, t).seats.find((x) => x.id === c)!.away, "back online");
}

{
  // Guesser drops and returns within the grace: can still play.
  const { t, s } = harness(3, 20);
  act(s, t, giverId(s), { type: "clue", text: "blip" });
  const [a, b] = guessersOf(s);
  act(s, t, a, { type: "lock", v: 40 });
  disconnect(s, t, b);
  tick(s, t, 2_000);
  reconnect(s, t, b);
  tick(s, t, AWAY_GRACE_MS);
  assert(s.phase === "guess", "waiting for b again");
  assert(act(s, t, b, { type: "lock", v: 41 }) === true && s.phase === "reveal", "b locks -> reveal");
}

{
  // Everyone but one leaves: the game ends gracefully after ABANDON_MS, once.
  const { t, s, calls } = harness(3, 21);
  act(s, t, giverId(s), { type: "clue", text: "lonely" });
  const stay = giverId(s);
  for (const id of s.ids) if (id !== stay) disconnect(s, t, id);
  const left = t.ctx.now();
  tick(s, t, 250);
  assert(view(s, stay, t).endingAt === null, "no warning for what may be a refresh");
  tick(s, t, AWAY_GRACE_MS);
  const v = view(s, stay, t);
  assert(v.endingAt === left + ABANDON_MS && v.endingAt > t.ctx.now(), "ending countdown shown after the grace");
  // One comes back in time: cancelled.
  const back = s.ids.find((id) => id !== stay)!;
  tick(s, t, 5_000);
  reconnect(s, t, back);
  tick(s, t, 250);
  assert(view(s, stay, t).endingAt === null, "countdown cancelled");
  disconnect(s, t, back);
  let guard = 0;
  while (s.phase !== "final" && guard++ < 400) tick(s, t, 250);
  assert(s.phase === "final" && calls.length === 1, "ended once");
  assert(/not enough players/i.test(calls[0].headline), "headline explains why");
  assert(guard * 250 <= ABANDON_MS + 1_000, "ended about ABANDON_MS later");
  tick(s, t, 60_000);
  assert(calls.length === 1, "no second end");
}

{
  // Disconnect + reconnect in the reveal and final phases never breaks anything.
  const { t, s, calls } = harness(2, 22);
  for (let r = 0; r < 4; r++) {
    playRound(s, t, [0]);
    const g = guessersOf(s)[0];
    disconnect(s, t, g);
    reconnect(s, t, g);
    tick(s, t, REVEAL_MS);
  }
  assert(s.phase === "final" && calls.length === 1, "2-player game finished");
  disconnect(s, t, t.ids[0]);
  reconnect(s, t, t.ids[0]);
  tick(s, t, 60_000);
  assert(calls.length === 1 && s.phase === "final", "final stays final");
}

{
  // A participant whose connection flag flips without a hook call is still noticed by tick().
  const { t, s } = harness(4, 23);
  const giver = giverId(s);
  t.ctx.player(giver)!.connected = false; // no playerLeft call
  tick(s, t, 250);
  assert(s.away[s.ids.indexOf(giver)] !== null, "tick syncs connection flags");
  tick(s, t, AWAY_GRACE_MS);
  assert(s.round === 1, "and skips the missing giver");
}

// ---------- ties and player counts ----------

{
  // 2 players: competitive scores would always tie (the clue-giver gets the only guess's
  // points), so the pair plays co-op for one team score out of 16; 8 or more wins.
  const { t, s, calls } = harness(2, 24);
  assert(s.order.length === 4, "2 players -> 4 rounds");
  const v0 = view(s, t.ids[0], t);
  assert(deepEqual(v0.team, { score: 0, goal: 8, max: 16 }), "co-op team in the view");
  assert(deepEqual(view(s, "spectator", t).team, v0.team), "spectators see the team score too");
  while (phaseOf(s) !== "final") {
    playRound(s, t, [0]);
    assert(view(s, t.ids[1], t).team!.score === 4 * (s.round + 1), "team score grows each reveal");
    tick(s, t, REVEAL_MS);
  }
  assert(calls.length === 1, "one end");
  const r = calls[0];
  assert(r.winners.length === 2, "team goal reached -> both win");
  assert(/perfect sync/i.test(r.headline) && /16\/16/.test(r.headline), `team headline: ${r.headline}`);
  assert(r.headline.includes("Player0") && r.headline.includes("Player1") && !/tie/i.test(r.headline), "names the team, no tie");
  assert(view(s, t.ids[0], t).team!.score === 16, "final view keeps the team score");
}

{
  // Exactly the goal wins; below it, nobody wins.
  const a = harness(2, 25);
  while (phaseOf(a.s) !== "final") {
    a.s.target = 50;
    playRound(a.s, a.t, [9]); // 9 off -> 2 points a round
    tick(a.s, a.t, REVEAL_MS);
  }
  assert(view(a.s, a.t.ids[0], a.t).team!.score === 8 && a.calls[0].winners.length === 2, "8/16 reaches the goal");
  assert(/^In sync!/.test(a.calls[0].headline), `goal headline: ${a.calls[0].headline}`);
  const b = harness(2, 26);
  while (phaseOf(b.s) !== "final") {
    b.s.target = 50;
    playRound(b.s, b.t, [15]); // 15 off -> 1 point a round
    tick(b.s, b.t, REVEAL_MS);
  }
  assert(view(b.s, b.t.ids[0], b.t).team!.score === 4, "4/16");
  assert(
    b.calls[0].winners.length === 0 && /out of tune/i.test(b.calls[0].headline) && /8 needed/.test(b.calls[0].headline),
    `short of the goal: ${b.calls[0].headline}`,
  );
}

{
  // Many random 2-player games: always a team result, never a fake "tie for the win".
  for (let seed = 1; seed <= 60; seed++) {
    const { t, s, calls } = harness(2, seed);
    let guard = 0;
    while (phaseOf(s) !== "final" && guard++ < 50) {
      if (phaseOf(s) === "clue") act(s, t, giverId(s), { type: "clue", text: "some clue" });
      if (phaseOf(s) === "guess") act(s, t, guessersOf(s)[0], { type: "lock", v: Math.floor(t.ctx.random() * 101) });
      tick(s, t, REVEAL_MS);
    }
    const r = calls[0];
    const team = view(s, t.ids[0], t).team!;
    assert(calls.length === 1 && !/tie/i.test(r.headline), "no tie headline in co-op");
    assert(r.winners.length === (team.score >= team.goal ? 2 : 0), "both win or neither, by the team goal");
  }
  // 3+ players stay competitive.
  const three = harness(3, 1);
  assert(view(three.s, three.t.ids[0], three.t).team === null, "no team mode with 3 players");
}

{
  // 12 players: 12 rounds, everyone gives exactly one clue, game completes.
  const { t, s, calls } = harness(12, 25);
  assert(s.order.length === 12, "12 rounds");
  const givers: string[] = [];
  while (s.phase !== "final") {
    givers.push(giverId(s));
    playRound(s, t, [0, 2, -4, 9, -13, 18, 25, -40, 1, -2, 6]);
    tick(s, t, REVEAL_MS);
  }
  assert(new Set(givers).size === 12, "each player gave one clue");
  assert(calls.length === 1 && calls[0].winners.length >= 1, "12-player game ended with a winner");
  const views = [...t.ids, "spectator"].map((id) => JSON.stringify(view(s, id, t)).length);
  assert(Math.max(...views) < 8_000, `final view stays small (${Math.max(...views)} bytes)`);
}

{
  // Too few players to play at all: ends on the first tick instead of stalling.
  const { t, s, calls } = harness(1, 26);
  tick(s, t, 250);
  assert(s.phase === "final" && calls.length === 1 && calls[0].winners.length === 0, "1 player ends gracefully");
}

{
  // Three-way tie headline lists names; 4+ way tie is summarised.
  const { t, s, calls } = harness(4, 27);
  s.order = [0, 1, 2, 3];
  s.score = [5, 5, 5, 5];
  s.round = 3;
  s.phase = "reveal";
  s.endsAt = t.ctx.now();
  tick(s, t, 0);
  assert(calls.length === 1 && calls[0].winners.length === 4 && /4-way tie/.test(calls[0].headline), "4-way tie");
}

console.log("dial: all tests passed");
