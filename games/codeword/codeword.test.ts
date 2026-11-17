import codeword, { type CodeState } from "./server";
import { config } from "./config";
import { answerList, isGuessWord } from "./dict";
import { hardProblem, markGuess, wordScore, type CodeView, type NoEvent } from "./shared";
import { readSettings } from "../../shared/settings";
import { assert, makeTestCtx } from "../../shared/testing";

// ---- marking, repeated letters ----
const M: [string, string, string][] = [
  ["crane", "crane", "22222"],
  ["speed", "abide", "00101"],
  ["llama", "hello", "11000"],
  ["hello", "llama", "00110"],
  ["geese", "those", "00022"],
  ["eerie", "there", "10102"],
  ["abbey", "babes", "11220"],
  // Exact matches claim their copies before yellows do.
  ["sassy", "class", "11020"],
];
for (const [g, a, want] of M) assert(markGuess(g, a) === want, `${g}/${a}: ${markGuess(g, a)} != ${want}`);

// ---- hard mode rule ----
assert(hardProblem("crate", ["crane"], ["22202"]) === null, "hard ok");
assert(hardProblem("bloke", ["crane"], ["02202"]) !== null, "hard: must keep R in 2nd");
assert(hardProblem("tread", ["eater"], ["11100"]) === null, "hard: all present letters used");
assert(hardProblem("tired", ["eater"], ["11100"]) !== null, "hard: A missing");

// ---- scoring ----
assert(wordScore(true, 1, 0) === 650 && wordScore(true, 6, 999_999) === 100 && wordScore(false, 3, 0) === 0, "scores");

// ---- dictionary ----
const answers = answerList();
assert(answers.length > 1000 && answers.every((w) => /^[a-z]{5}$/.test(w) && isGuessWord(w)), "answers are valid guesses");
assert(isGuessWord("crane") && !isGuessWord("xxxxx") && !isGuessWord("abcde"), "guess list");

// ---- full solo game ----
{
  const t = makeTestCtx(1);
  const s = codeword.setup(t.ctx) as CodeState;
  assert(s.answers.length === 3, "default 3 words");
  const id = t.ids[0];
  // Not started yet.
  assert(codeword.action(s, id, { type: "guess", p: 0, w: "crane" }, t.ctx) === false, "no guessing in countdown");
  t.advance(3100);
  codeword.tick!(s, t.ctx);
  assert(s.phase === "play", "play");
  // Junk and invalid guesses.
  for (const junk of [null, 1, "x", [], {}, { type: "guess" }, { type: "guess", p: 0, w: 5 }, { type: "guess", p: 1, w: "crane" }, { type: "guess", p: 0, w: "a".repeat(999) }])
    assert(codeword.action(s, id, junk, t.ctx) === false, `junk ${JSON.stringify(junk)}`);
  const before = t.events.length;
  assert(codeword.action(s, id, { type: "guess", p: 0, w: "qzxjv" }, t.ctx) === false, "not a word");
  assert((t.events[before].event as NoEvent).why === "word", "word event");
  assert(codeword.action(s, id, { type: "guess", p: 0, w: "abc" }, t.ctx) === false, "short");
  // The view never contains the answer before the word is finished.
  const ans0 = s.answers[0];
  const wrong = ["crane", "pilot", "dusty", "money", "about", "night", "fight"].filter((w) => w !== ans0);
  codeword.action(s, id, { type: "guess", p: 0, w: wrong[0] }, t.ctx);
  assert(!JSON.stringify(codeword.view(s, id, t.ctx)).includes(`"${ans0}"`), "answer hidden from player");
  assert(codeword.action(s, id, { type: "guess", p: 0, w: wrong[0] }, t.ctx) === false, "repeat guess refused");
  // Crack word 1 on the second guess.
  t.advance(20_000);
  codeword.action(s, id, { type: "guess", p: 0, w: ans0 }, t.ctx);
  const v = codeword.view(s, id, t.ctx) as CodeView;
  assert(v.me!.results[0].ok && v.me!.results[0].used === 2 && v.me!.results[0].pts === 500 + 42, `pts ${v.me!.results[0].pts}`);
  assert(v.me!.results[0].answer === ans0, "answer revealed after finishing");
  // Word 2: in the between pause, guesses are refused.
  assert(codeword.action(s, id, { type: "guess", p: 1, w: "crane" }, t.ctx) === false, "between pause");
  t.advance(4100);
  // Fail word 2 with six wrong guesses.
  const ans1 = s.answers[1];
  const six = ["crane", "pilot", "dusty", "money", "about", "night", "fight", "house"].filter((w) => w !== ans1).slice(0, 6);
  for (const w of six) assert(codeword.action(s, id, { type: "guess", p: 1, w }, t.ctx) !== false, `guess ${w}`);
  assert(s.runs[id].idx === 2 && s.runs[id].results[1].ok === false && s.runs[id].results[1].pts === 0, "failed word 2");
  t.advance(4100);
  // Word 3: give up.
  codeword.action(s, id, { type: "giveup", p: 2 }, t.ctx);
  assert(t.result, "game over");
  assert(t.result.scores![id] === 542 && t.result.winners[0] === id, `solo result ${JSON.stringify(t.result)}`);
  assert(t.result.headline.includes("cracked 1 of 3"), t.result.headline);
}

// ---- settings: 1 word, hard mode ----
{
  const t = makeTestCtx(2, 7, { words: 1, hard: "on" });
  const s = codeword.setup(t.ctx) as CodeState;
  assert(s.answers.length === 1 && s.hard, "settings honoured");
  assert(readSettings(config.settings, { words: 99 }).words === 3, "bad setting falls back");
  t.advance(3100);
  codeword.tick!(s, t.ctx);
  const [a, b] = t.ids;
  // Find a first guess that reveals something, then break the hard rule.
  const ans = s.answers[0];
  const probe = answers.find((w) => w !== ans && markGuess(w, ans).includes("2"))!;
  codeword.action(s, a, { type: "guess", p: 0, w: probe }, t.ctx);
  const breaker = answers.find((w) => hardProblem(w, [probe], [markGuess(probe, ans)]) !== null)!;
  const n = t.events.length;
  assert(codeword.action(s, a, { type: "guess", p: 0, w: breaker }, t.ctx) === false, "hard mode refuses");
  assert((t.events[n].event as NoEvent).why === "hard", "hard event");
  // b's view shows a's colours but not letters.
  const vb = codeword.view(s, b, t.ctx) as CodeView;
  assert(vb.board.find((r) => r.id === a)!.rows.length === 1 && !JSON.stringify(vb).includes(probe), "board shows colours only");
  // Spectator view is sensible and secret-free.
  const spec = codeword.view(s, "spectator", t.ctx) as CodeView;
  assert(spec.me === null && spec.board.length === 2 && !JSON.stringify(spec).includes(ans), "spectator");
  // a cracks it; b leaves and the game still ends once b's away time runs out.
  codeword.action(s, a, { type: "guess", p: 0, w: ans }, t.ctx);
  codeword.playerLeft!(s, b, t.ctx);
  codeword.tick!(s, t.ctx);
  assert(!t.result, "waits a while for the leaver");
  t.advance(31_000);
  codeword.tick!(s, t.ctx);
  const res = t.result as { winners: string[] } | null;
  assert(res && res.winners[0] === a, "leaver doesn't soft-lock");
}

// ---- word clock backstop ----
{
  const t = makeTestCtx(1, 3, { words: 1 });
  const s = codeword.setup(t.ctx) as CodeState;
  t.advance(3100);
  codeword.tick!(s, t.ctx);
  t.advance(241_000);
  codeword.tick!(s, t.ctx);
  assert(t.result && t.result.winners.length === 0, "time runs out, nobody wins");
}

// ---- memory avoids repeats ----
{
  const memory: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (let g = 0; g < 10; g++) {
    const t = makeTestCtx(1, 99 + g, { words: 5 }, 0, memory);
    const s = codeword.setup(t.ctx) as CodeState;
    for (const w of s.answers) {
      assert(!seen.has(w), `repeat ${w}`);
      seen.add(w);
    }
  }
  // Same seed, empty memory: the same words (daily challenge).
  const a = codeword.setup(makeTestCtx(1, 5).ctx) as CodeState;
  const b = codeword.setup(makeTestCtx(1, 5).ctx) as CodeState;
  assert(a.answers.join() === b.answers.join(), "deterministic");
}

// ---- bots finish a game ----
{
  const t = makeTestCtx(3, 11, { words: 3 }, 2);
  const s = codeword.setup(t.ctx) as CodeState;
  const human = t.ids[0];
  codeword.action(s, human, { type: "giveup", p: 0 }, t.ctx);
  let guard = 0;
  while (!t.result && guard++ < 20_000) {
    t.advance(250);
    codeword.tick!(s, t.ctx);
    if (s.phase !== "play") continue;
    if (s.runs[human].idx < 3) codeword.action(s, human, { type: "giveup", p: s.runs[human].idx }, t.ctx);
    for (const id of t.ids.filter((x) => x.startsWith("bot-"))) {
      const act = codeword.bot!(s, id, t.ctx);
      if (act) codeword.action(s, id, act, t.ctx);
    }
  }
  assert(t.result, "bots finish");
  const botRuns = t.ids.filter((x) => x.startsWith("bot-")).map((id) => s.runs[id]);
  const cracked = botRuns.reduce((n, r) => n + r.results.filter((x) => x.ok).length, 0);
  const secs = botRuns.flatMap((r) => r.results.map((x) => x.secs));
  assert(cracked >= 3, `bots crack most words (${cracked}/6)`);
  assert(Math.min(...secs) >= 10, `bots are human-paced (${secs})`);
  console.log(`  bots: ${cracked}/6 cracked, ${botRuns.map((r) => r.results.map((x) => x.used).join("/")).join(" ")} guesses`);
}

console.log("✓ codeword");
