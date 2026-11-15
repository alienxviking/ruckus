import { topScorers } from "../../shared/game";
import { assert, makeTestCtx } from "../../shared/testing";
import type { GameResult } from "../../shared/types";
import { PAIRS } from "./data";
import game, { type ImpostorState, type ImpostorView, type Phase } from "./server";
import {
  AWAY_GUESS_MS,
  CLUE_MS,
  GUESS_MS,
  LAPS,
  REVEAL_MS,
  SHORT_GRACE_MS,
  VOTE_MS,
  VOTE_SETTLE_MS,
  clueProblem,
  guessMatches,
  guessProblem,
  levenshtein,
  normalizeWord,
  sameWord,
} from "./shared";

// ---------- harness ----------

type T = ReturnType<typeof makeTestCtx>;

function start(n: number, seed = 42) {
  const t = makeTestCtx(n, seed);
  let endCalls = 0;
  const realEnd = t.ctx.end;
  t.ctx.end = (r: GameResult) => {
    endCalls += 1;
    realEnd(r);
  };
  const s: ImpostorState = game.setup(t.ctx);
  return { t, s, endCalls: () => endCalls };
}

// Accessors defeat TypeScript narrowing: state changes inside game calls.
const phase = (s: ImpostorState): Phase => s.phase;
const roundOf = (s: ImpostorState): number => s.round;
const turnOf = (s: ImpostorState): number => s.turn;
const clueCount = (s: ImpostorState): number => s.clues.length;
const resultOf = (t: T): GameResult | null => t.result;
const tick = (s: ImpostorState, t: T) => !!game.tick!(s, t.ctx);
const later = (s: ImpostorState, t: T, ms: number) => {
  t.advance(ms);
  return tick(s, t);
};
const view = (s: ImpostorState, t: T, id: string) => game.view(s, id, t.ctx) as ImpostorView;
const act = (s: ImpostorState, t: T, id: string, a: unknown) => game.action(s, id, a as never, t.ctx);
const snap = (s: ImpostorState) => JSON.stringify(s);
const idOf = (s: ImpostorState, seat: number) => s.ids[seat];
const oddId = (s: ImpostorState) => s.ids[s.oddSeat];
const current = (s: ImpostorState) => (phase(s) === "clues" ? s.ids[s.order[turnOf(s) % s.order.length]] : null);
const wordFor = (s: ImpostorState, id: string) => (id === oddId(s) ? s.oddWord : s.majorityWord);

function setConnected(s: ImpostorState, t: T, id: string, on: boolean) {
  const p = t.ctx.players.find((x) => x.id === id)!;
  p.connected = on;
  if (on) game.playerReturned!(s, id, t.ctx);
  else game.playerLeft!(s, id, t.ctx);
}

/** Force this round's words (fresh, distinctive strings for secrecy checks). */
function forceWords(s: ImpostorState, majority: string, odd: string) {
  s.majorityWord = majority;
  s.oddWord = odd;
}

let clueSeq = 0;
/** Everyone gives a valid unique clue until the vote starts. */
function playClues(s: ImpostorState, t: T) {
  let guard = 0;
  while (phase(s) === "clues" && guard++ < 100) {
    const id = current(s)!;
    const ok = act(s, t, id, { type: "clue", text: `zq${++clueSeq}x` });
    assert(ok === true, `clue accepted for ${id}`);
  }
  assert(phase(s) === "vote", "vote follows the clues");
}

function errorsTo(t: T, id: string) {
  return t.events.filter((e) => e.to === id && (e.event as { type?: string }).type === "error");
}

function hasUndefined(v: unknown): boolean {
  if (v === undefined) return true;
  if (Array.isArray(v)) return v.some(hasUndefined);
  if (v && typeof v === "object") return Object.values(v).some(hasUndefined);
  return typeof v === "function";
}

// ---------- word helpers ----------
{
  assert(normalizeWord("  Café-Crème’s ") === "cafecremes", "normalize strips accents, case, punctuation");
  assert(sameWord("dogs", "dog") && sameWord("dog", "dogs"), "simple plural");
  assert(sameWord("berries", "berry") && sameWord("leaves", "leaf") && sameWord("knives", "knife"), "ies/ves plurals");
  assert(sameWord("glasses", "glass") && sameWord("buses", "bus"), "es plurals");
  assert(!sameWord("chess", "ches") && !sameWord("cat", "dog") && !sameWord("", ""), "not the same word");
  assert(levenshtein("kitten", "sitting") === 3 && levenshtein("", "abc") === 3 && levenshtein("abc", "abc") === 0, "levenshtein");
  assert(guessMatches("Giraffe", "giraffe") && guessMatches("girafe", "giraffe") && guessMatches("giraffes", "giraffe"), "lenient guess");
  assert(guessMatches("teas", "tea") && !guessMatches("tee", "tea") && !guessMatches("coffee", "tea"), "short words need exact/plural");
  assert(guessMatches("ice cream", "icecream") && !guessMatches("   ", "tea"), "spaces ignored, blanks rejected");

  const word = "coffee";
  const bad: [string, RegExp][] = [
    ["coffee", /gives away/],
    ["COFFEE", /gives away/],
    ["Coffées", /gives away/],
    ["iced-coffee", /gives away/],
    ["coffeepot", /gives away/],
    ["two words", /One word/],
    ["x".repeat(21), /20 characters/],
    ["hi!", /Letters, digits/],
    ["--", /at least one letter/],
    ["", /Type a clue/],
    ["   ", /Type a clue/],
    ["\u0000\u0007\u200b", /Type a clue/],
    ["mugs", /already said/],
    ["MUG", /already said/],
  ];
  for (const [clue, re] of bad) {
    const p = clueProblem(clue, word, ["mug", "warm"]);
    assert(p !== null && re.test(p), `clue "${clue}" rejected (${p})`);
  }
  for (const ok of ["café", "latte", "rock-n-roll", "o'clock", "42", "x".repeat(20), "  bean\u0007 "]) {
    assert(clueProblem(ok, word, ["mug"]) === null, `clue "${ok}" allowed`);
  }
  assert(clueProblem("berries", "berry", []) !== null && clueProblem("blueberries", "berry", []) !== null, "plural containment");

  // Plural secret words: a clue built on the singular gives it away too.
  const pluralGiveaways: [string, string][] = [
    ["staircase", "stairs"], ["stairway", "stairs"], ["dartboard", "darts"], ["checkerboard", "checkers"],
    ["domino-effect", "dominoes"], ["headphone-jack", "headphones"], ["card-game", "cards"], ["marble-run", "marbles"],
    ["sneakerhead", "sneakers"], ["pajama-party", "pajamas"], ["scissor-kick", "scissors"], ["binocular-vision", "binoculars"],
    ["noodle", "noodles"], ["mitten-shaped", "mittens"], ["knife", "knives"], ["leaf", "leaves"],
  ];
  for (const [clue, secret] of pluralGiveaways) {
    assert(/gives away/.test(clueProblem(clue, secret, []) ?? ""), `"${clue}" gives away "${secret}"`);
  }
  // ...but no false singulars: "caves" isn't "cafe", short stems are ignored.
  for (const [clue, secret] of [["caves", "cafe"], ["cave", "cafe"], ["chorus", "chores"], ["anchor", "chores"], ["toast", "toys"]]) {
    assert(clueProblem(clue, secret, []) === null, `"${clue}" is fine for "${secret}"`);
  }
  assert(!sameWord("caves", "cafe") && sameWord("wolves", "wolf") && sameWord("dominoes", "domino"), "plural rules");

  // Blank-looking and glitch-text clues.
  for (const blank of ["\u3164", "\uffa0", "\u115f", "\u1160", "\u034f", "a\u0301\u0301\u0301\u0301\u0301", "\u0301\u0301"]) {
    assert(clueProblem(blank, "coffee", []) !== null, `invisible/glitch clue refused: ${JSON.stringify(blank)}`);
  }
  assert(/accents/.test(clueProblem("a" + "\u0301".repeat(19), "coffee", []) ?? ""), "zalgo clue refused");
  assert(/accents/.test(guessProblem("tea" + "\u0301".repeat(20)) ?? ""), "zalgo guess refused");
  assert(guessProblem("\u3164") !== null, "blank guess refused");
  assert(clueProblem("cr\u00e8me", "coffee", []) === null && clueProblem("pho\u031b\u0309", "coffee", []) === null, "real accents fine");
  // Cyrillic/Greek look-alikes can't dodge the word checks.
  assert(/gives away/.test(clueProblem("\u0441\u043effee", "coffee", []) ?? ""), "Cyrillic look-alike caught");
  assert(/gives away/.test(clueProblem("\u0422\u0415\u0410", "tea", []) ?? ""), "all-Cyrillic look-alike caught");
  assert(/already said/.test(clueProblem("m\u03bf\u03bfn", "sun", ["moon"]) ?? ""), "Greek look-alike repeat caught");
  assert(guessMatches("\u0441\u043effee", "coffee"), "look-alike guess still counts");
}

// ---------- word list ----------
{
  assert(PAIRS.length >= 80, `at least 80 pairs (have ${PAIRS.length})`);
  const seen = new Set<string>();
  for (const [a, b] of PAIRS) {
    for (const w of [a, b]) {
      assert(/^[a-z]{3,}$/.test(w), `"${w}" is a plain lowercase word`);
      assert(!seen.has(w), `"${w}" appears only once`);
      seen.add(w);
    }
    assert(!a.includes(b) && !b.includes(a), `${a}/${b}: neither contains the other`);
    assert(!sameWord(a, b), `${a}/${b}: not plural twins`);
    assert(levenshtein(a, b) > 1, `${a}/${b}: more than one letter apart`);
    assert(!guessMatches(a, b) && !guessMatches(b, a), `${a}/${b}: guessing your own word never counts`);
  }
}

// ---------- setup & first turn ----------
{
  const { t, s } = start(4);
  assert(phase(s) === "clues" && roundOf(s) === 1 && s.totalRounds === 3, "starts in round 1 clues");
  assert(s.order.length === 4 && new Set(s.order).size === 4, "turn order is a permutation");
  assert(s.majorityWord !== s.oddWord && PAIRS.some(([a, b]) => (a === s.majorityWord && b === s.oddWord) || (b === s.majorityWord && a === s.oddWord)), "words come from one pair");
  assert(s.endsAt === t.ctx.now() + CLUE_MS, "first turn has 25s");
  const v = view(s, t, current(s)!);
  assert(v.currentId === current(s) && v.turn === 0, "view shows whose turn");
  assert(!hasUndefined(v), "view has no undefined values");
  assert(JSON.stringify(JSON.parse(JSON.stringify(v))) === JSON.stringify(v), "view is JSON-safe");

  // Both words get used as the majority word across seeds.
  const majorityIsFirst = new Set<boolean>();
  for (let seed = 1; seed <= 40; seed++) {
    const g = start(3, seed).s;
    const pair = PAIRS.find(([a, b]) => [a, b].includes(g.majorityWord) && [a, b].includes(g.oddWord))!;
    majorityIsFirst.add(pair[0] === g.majorityWord);
  }
  assert(majorityIsFirst.size === 2, "either word of a pair can be the majority word");
}

// ---------- full game: caught & wrong, escape on a tie, caught but guessed ----------
{
  const { t, s, endCalls } = start(4, 7);
  const expected: Record<string, number> = Object.fromEntries(s.ids.map((id) => [id, 0]));
  const odds: string[] = [];

  // Round 1: everyone else votes the odd one, who votes someone else -> caught, wrong guess.
  playClues(s, t);
  assert(clueCount(s) === 4 * LAPS && s.clues.every((c) => c.status === "clue"), "two laps of clues");
  assert(s.clues.filter((c) => c.lap === 0).length === 4 && s.clues.filter((c) => c.lap === 1).length === 4, "laps tagged");
  let odd = oddId(s);
  odds.push(odd);
  const notOdd = s.ids.filter((id) => id !== odd);
  for (const id of notOdd) assert(act(s, t, id, { type: "vote", target: odd }), "vote accepted");
  assert(act(s, t, odd, { type: "vote", target: notOdd[0] }), "odd votes too");
  assert(s.settleAt === t.ctx.now(), "all voted: settling");
  assert(view(s, t, notOdd[0]).allVoted && view(s, t, "spectator").allVoted, "everyone sees the vote closing");
  assert(view(s, t, odd).endsAt === t.ctx.now() + VOTE_SETTLE_MS, "vote closes 2s after the last vote");
  assert(!later(s, t, VOTE_SETTLE_MS - 1) && phase(s) === "vote", "still voting just before");
  assert(later(s, t, 1) && phase(s) === "lastGuess", "caught -> last guess");
  assert(view(s, t, notOdd[1]).caughtId === odd && view(s, t, odd).caughtId === odd, "everyone learns who was caught");
  assert(act(s, t, notOdd[0], { type: "guess", text: s.majorityWord }) === false, "only the odd one guesses");
  assert(act(s, t, odd, { type: "guess", text: "definitely-wrong" }), "odd guesses");
  assert(phase(s) === "reveal", "guess ends the phase at once");
  let last = s.history[0];
  assert(last.outcome === "caught" && last.guess === "definitely-wrong" && !last.guessCorrect, "caught, wrong guess");
  for (const id of notOdd) {
    expected[id] += 2;
    assert(last.points[id] === 2, "catcher who voted right gets 1+1");
  }
  assert(last.points[odd] === 0 && last.votes.length === 4, "odd gets nothing; votes revealed");
  assert(s.endsAt === t.ctx.now() + REVEAL_MS, "reveal lasts 8s");
  assert(!later(s, t, REVEAL_MS - 1) && phase(s) === "reveal", "reveal holds");
  assert(later(s, t, 1) && phase(s) === "clues" && roundOf(s) === 2, "round 2 begins");

  // Round 2: a 1-1-1-1 tie -> the odd one escapes.
  playClues(s, t);
  odd = oddId(s);
  odds.push(odd);
  const ring = s.ids;
  ring.forEach((id, i) => assert(act(s, t, id, { type: "vote", target: ring[(i + 1) % ring.length] }), "ring vote"));
  later(s, t, VOTE_SETTLE_MS);
  assert(phase(s) === "reveal", "tie goes straight to the reveal");
  last = s.history[1];
  assert(last.outcome === "escaped" && last.caughtId === null && last.points[odd] === 3, "tie: odd escapes +3");
  expected[odd] += 3;
  later(s, t, REVEAL_MS);

  // Round 3: caught, but the odd one names the majority word (with a typo / plural).
  assert(roundOf(s) === 3, "round 3");
  playClues(s, t);
  odd = oddId(s);
  for (const id of s.ids) act(s, t, id, { type: "vote", target: id === odd ? s.ids.find((x) => x !== odd)! : odd });
  later(s, t, VOTE_SETTLE_MS);
  assert(phase(s) === "lastGuess", "caught again");
  assert(act(s, t, odd, { type: "guess", text: `  ${s.majorityWord.toUpperCase()} ` }), "caps/padded guess");
  last = s.history[2];
  assert(last.outcome === "guessed" && last.guessCorrect && last.points[odd] === 2, "guessed right: +2");
  expected[odd] += 2;
  assert(Object.values(last.points).reduce((a, b) => a + b, 0) === 2, "nobody else scores");

  assert(!resultOf(t) && endCalls() === 0, "no end before the last reveal finishes");
  later(s, t, REVEAL_MS);
  assert(phase(s) === "final" && endCalls() === 1 && resultOf(t), "game ends once");
  const r = resultOf(t)!;
  for (const id of s.ids) assert(r.scores![id] === expected[id], `score for ${id}: ${r.scores![id]} vs ${expected[id]}`);
  assert(JSON.stringify(r.winners.slice().sort()) === JSON.stringify(topScorers(expected).sort()), "winners = top scorers");
  assert(r.headline.length > 0 && r.headline.length < 120, "punchy headline");
  assert(view(s, t, "spectator").phase === "final" && view(s, t, "spectator").history.length === 3, "final view has the recap");

  // Nothing moves after the end.
  const frozen = snap(s);
  assert(tick(s, t) === false, "no ticks after end");
  later(s, t, 60_000);
  for (const id of s.ids) {
    assert(act(s, t, id, { type: "vote", target: s.ids[0] }) === false, "no actions after end");
    assert(act(s, t, id, { type: "clue", text: "late" }) === false, "no clues after end");
  }
  game.playerLeft!(s, s.ids[0], t.ctx);
  game.playerReturned!(s, s.ids[0], t.ctx);
  assert(snap(s) === frozen && endCalls() === 1, "state frozen after end");
}

// ---------- every timer path, nobody doing anything (3 players) ----------
{
  const { t, s, endCalls } = start(3, 11);
  const escaped: Record<string, number> = Object.fromEntries(s.ids.map((id) => [id, 0]));
  for (let round = 1; round <= 3; round++) {
    assert(roundOf(s) === round && phase(s) === "clues", `round ${round} clues`);
    escaped[oddId(s)] += 3;
    for (let turn = 0; turn < 3 * LAPS; turn++) {
      const who = current(s);
      assert(turnOf(s) === turn, "turn index");
      assert(!later(s, t, CLUE_MS - 1) && current(s) === who, "turn holds until its deadline");
      assert(later(s, t, 1), "timeout advances");
      const entry = s.clues[turn];
      assert(entry.by === who && entry.status === "pass" && entry.text === null, "timeout = pass");
    }
    assert(phase(s) === "vote" && s.endsAt === t.ctx.now() + VOTE_MS, "vote has 45s");
    assert(!later(s, t, VOTE_MS - 1) && phase(s) === "vote", "vote holds");
    assert(later(s, t, 1) && phase(s) === "reveal", "vote times out");
    const h = s.history[round - 1];
    assert(h.outcome === "escaped" && h.votes.length === 0 && h.caughtId === null, "no votes: odd escapes");
    later(s, t, REVEAL_MS);
  }
  assert(phase(s) === "final" && endCalls() === 1, "ended once");
  for (const id of s.ids) assert(resultOf(t)!.scores![id] === escaped[id], "each escape scored +3");
  assert(JSON.stringify(resultOf(t)!.winners.slice().sort()) === JSON.stringify(topScorers(escaped).sort()), "winners = top scorers");
}

// ---------- last guess times out ----------
{
  const { t, s } = start(3, 5);
  playClues(s, t);
  const odd = oddId(s);
  for (const id of s.ids) if (id !== odd) act(s, t, id, { type: "vote", target: odd });
  later(s, t, VOTE_SETTLE_MS - 1);
  // The odd one hasn't voted, so the vote is still open until they do (or 45s pass).
  assert(phase(s) === "vote" && s.settleAt === null, "waits for the last connected voter");
  later(s, t, VOTE_MS);
  assert(phase(s) === "lastGuess" && s.endsAt === t.ctx.now() + GUESS_MS, "last guess has 25s");
  assert(!later(s, t, GUESS_MS - 1) && phase(s) === "lastGuess", "guess window holds");
  assert(later(s, t, 1) && phase(s) === "reveal", "guess times out");
  const h = s.history[0];
  assert(h.outcome === "caught" && h.guess === null, "no guess = caught");
  for (const id of s.ids) assert(h.points[id] === (id === odd ? 0 : 2), "catchers score 2");
}

// ---------- vote resolution edge cases ----------
{
  // Wrong person caught -> odd escapes.
  const { t, s } = start(5, 3);
  playClues(s, t);
  const odd = oddId(s);
  const innocent = s.ids.find((id) => id !== odd)!;
  for (const id of s.ids) if (id !== innocent) act(s, t, id, { type: "vote", target: innocent });
  act(s, t, innocent, { type: "vote", target: odd });
  later(s, t, VOTE_SETTLE_MS);
  const h = s.history[0];
  assert(h.outcome === "escaped" && h.caughtId === innocent && h.points[odd] === 3, "wrong person: odd escapes");
  assert(Object.entries(h.points).every(([id, p]) => (id === odd ? p === 3 : p === 0)), "only the odd one scores");
}
{
  // Two-way tie at the top even though the odd one leads nobody.
  const { t, s } = start(4, 9);
  playClues(s, t);
  const odd = oddId(s);
  const [a, b, c] = s.ids.filter((id) => id !== odd);
  act(s, t, a, { type: "vote", target: odd });
  act(s, t, b, { type: "vote", target: odd });
  act(s, t, c, { type: "vote", target: a });
  act(s, t, odd, { type: "vote", target: a });
  later(s, t, VOTE_SETTLE_MS);
  assert(phase(s) === "reveal" && s.history[0].outcome === "escaped" && s.history[0].caughtId === null, "2-2 tie: escape");
}
{
  // Votes can change until the vote ends; the final vote counts.
  const { t, s } = start(4, 21);
  playClues(s, t);
  const odd = oddId(s);
  const others = s.ids.filter((id) => id !== odd);
  assert(act(s, t, others[0], { type: "vote", target: others[1] }), "first vote");
  assert(act(s, t, others[0], { type: "vote", target: others[1] }) === false, "same vote again is a no-op");
  assert(act(s, t, others[0], { type: "vote", target: odd }), "changed vote");
  assert(view(s, t, others[0]).myVote === odd, "my vote shows the change");
  act(s, t, others[1], { type: "vote", target: odd });
  act(s, t, others[2], { type: "vote", target: odd });
  act(s, t, odd, { type: "vote", target: others[2] });
  assert(s.settleAt !== null, "settling");
  later(s, t, 1000);
  assert(act(s, t, odd, { type: "vote", target: others[1] }), "can still switch while settling");
  later(s, t, VOTE_SETTLE_MS - 1000);
  assert(phase(s) === "lastGuess", "closes on the original settle time");
  act(s, t, odd, { type: "guess", text: "nope" });
  const h = s.history[0];
  assert(h.votes.find((v) => v.voter === odd)!.target === others[1], "final vote recorded");
}

// ---------- hostile & invalid actions ----------
{
  const { t, s } = start(4, 13);
  const turnId = current(s)!;
  const other = s.ids.find((id) => id !== turnId)!;
  const before = snap(s);
  const junk: unknown[] = [
    null,
    undefined,
    "clue",
    42,
    true,
    [],
    ["clue", "x"],
    {},
    { type: "CLUE", text: "fine" },
    { type: "clue" },
    { type: "clue", text: 5 },
    { type: "clue", text: null },
    { type: "clue", text: ["fine"] },
    { type: "clue", text: { toString: "fine" } },
    { type: "clue", text: "y".repeat(100_000) },
    { type: "vote", target: other },
    { type: "guess", text: "anything" },
    { type: "__proto__" },
  ];
  for (const a of junk) assert(act(s, t, turnId, a) === false, `junk rejected: ${JSON.stringify(a)?.slice(0, 40)}`);
  assert(act(s, t, other, { type: "clue", text: "early" }) === false, "not your turn");
  assert(act(s, t, "stranger", { type: "clue", text: "hello" }) === false, "spectators can't act");
  assert(act(s, t, "__proto__", { type: "clue", text: "hello" }) === false, "weird ids can't act");
  assert(snap(s) === before, "no state change from junk");
  assert(errorsTo(t, other).length === 0, "no error spam for out-of-turn actions");

  // Bad clue text -> private error to the clue-giver only, no state change.
  forceWords(s, "coffee", "tea");
  const forced = snap(s);
  const myWord = wordFor(s, turnId);
  const n0 = t.events.length;
  for (const text of [myWord, myWord.toUpperCase() + "s", "two words", "x".repeat(21), "<b>", "", "y".repeat(5000)]) {
    assert(act(s, t, turnId, { type: "clue", text }) === false, `bad clue "${text.slice(0, 12)}" refused`);
  }
  const errs = t.events.slice(n0);
  assert(
    errs.length === 7 && errs.every((e) => e.to === turnId && typeof (e.event as { message?: unknown }).message === "string"),
    "one private error per bad clue",
  );
  assert(snap(s) === forced && turnOf(s) === 0 && clueCount(s) === 0, "turn not consumed");

  // Repeats of an earlier clue are refused (case and plurals don't matter).
  assert(act(s, t, turnId, { type: "clue", text: "Kettle" }), "first clue ok");
  const next = current(s)!;
  assert(act(s, t, next, { type: "clue", text: "kettles" }) === false, "repeat (plural) refused");
  assert(act(s, t, next, { type: "clue", text: "KETTLE" }) === false, "repeat (case) refused");
  assert(errorsTo(t, next).length === 2 && clueCount(s) === 1, "repeat errors are private, turn kept");

  // Vote phase junk.
  playClues(s, t);
  const v0 = snap(s);
  const voter = s.ids[0];
  for (const target of [voter, "stranger", 3, null, undefined, ["p1"], { id: "p1" }, "", "P1"]) {
    assert(act(s, t, voter, { type: "vote", target }) === false, `bad vote target ${String(target)}`);
  }
  assert(act(s, t, voter, { type: "clue", text: "late" }) === false, "no clues while voting");
  assert(act(s, t, voter, { type: "guess", text: "early" }) === false, "no guesses while voting");
  assert(act(s, t, "stranger", { type: "vote", target: s.ids[1] }) === false, "spectator can't vote");
  assert(snap(s) === v0, "vote state untouched");

  // Last guess junk.
  const odd = oddId(s);
  for (const id of s.ids) if (id !== odd) act(s, t, id, { type: "vote", target: odd });
  later(s, t, VOTE_MS);
  assert(phase(s) === "lastGuess", "in last guess");
  const g0 = snap(s);
  const m0 = errorsTo(t, odd).length;
  for (const text of [5, null, ["x"], "", "   ", "a".repeat(31), "<script>", "x".repeat(10_000)]) {
    assert(act(s, t, odd, { type: "guess", text }) === false, `bad guess ${String(text).slice(0, 10)}`);
  }
  assert(errorsTo(t, odd).length === m0 + 8, "bad guesses get private errors");
  assert(act(s, t, s.ids.find((id) => id !== odd)!, { type: "guess", text: s.majorityWord }) === false, "others can't guess");
  assert(act(s, t, odd, { type: "vote", target: s.ids.find((id) => id !== odd)! }) === false, "no voting during the guess");
  assert(snap(s) === g0, "guess state untouched");
}

// ---------- secrecy ----------
{
  const { t, s } = start(5, 17);
  forceWords(s, "quokka", "wombat");
  const odd = oddId(s);
  const viewers = [...s.ids, "spectator"];
  const check = (label: string) => {
    for (const id of viewers) {
      const v = view(s, t, id);
      const json = JSON.stringify(v);
      const mine = id === "spectator" ? null : id === odd ? "wombat" : "quokka";
      const theirs = id === odd ? "quokka" : "wombat";
      if (mine) assert(v.myWord === mine && json.includes(mine), `${label}: ${id} sees their own word`);
      else assert(v.myWord === null && !json.includes("quokka"), `${label}: spectator has no word`);
      assert(!json.includes(theirs), `${label}: ${id} never sees the other word`);
      for (const key of ["oddSeat", "oddId", "oddWord", "majorityWord", "usedPairs", "votes", "wasOdd", "pair"]) {
        assert(!(key in v), `${label}: no ${key} in view`);
      }
      assert(v.history.length === 0, `${label}: no reveal yet`);
      if (phase(s) !== "lastGuess") assert(v.caughtId === null, `${label}: nobody named`);
    }
  };
  check("clues");
  act(s, t, current(s)!, { type: "clue", text: "pouch" });
  check("clues after a clue");
  playClues(s, t);
  check("vote");
  const others = s.ids.filter((id) => id !== odd);
  act(s, t, others[0], { type: "vote", target: odd });
  act(s, t, others[1], { type: "vote", target: others[2] });
  check("vote with votes");
  const v1 = view(s, t, others[1]);
  assert(v1.voted.length === 2 && v1.voted.includes(others[0]) && v1.myVote === others[2], "who voted, not for whom");
  assert(view(s, t, others[3]).myVote === null && view(s, t, "spectator").myVote === null, "others' votes stay hidden");
  for (const id of s.ids) if (id !== odd) act(s, t, id, { type: "vote", target: odd });
  later(s, t, VOTE_MS);
  assert(phase(s) === "lastGuess", "caught");
  check("last guess");
  assert(view(s, t, odd).myWord === "wombat" && !JSON.stringify(view(s, t, odd)).includes("quokka"), "odd one still doesn't see the answer");
  act(s, t, odd, { type: "guess", text: "koala" });
  assert(phase(s) === "reveal", "reveal");
  for (const id of viewers) {
    const json = JSON.stringify(view(s, t, id));
    assert(json.includes("quokka") && json.includes("wombat") && json.includes("koala"), `reveal: ${id} sees both words and the guess`);
    assert(view(s, t, id).history[0].oddId === odd, "reveal names the odd one");
  }
  // Next round: new secrets are hidden again, the old round stays revealed.
  later(s, t, REVEAL_MS);
  forceWords(s, "narwhal", "platypus");
  const odd2 = oddId(s);
  for (const id of viewers) {
    const json = JSON.stringify(view(s, t, id));
    assert(!json.includes(id === odd2 ? "narwhal" : "platypus"), `round 2: ${id} can't see the other word`);
    assert(id !== "spectator" || (!json.includes("narwhal") && !json.includes("platypus")), "round 2: spectator sees neither");
  }
}

// ---------- disconnects: clue phase ----------
{
  const { t, s } = start(5, 23);
  const order = s.order.map((i) => idOf(s, i));
  // The current player drops: skipped at once.
  const first = order[0];
  t.advance(3000);
  setConnected(s, t, first, false);
  assert(s.clues[0].by === first && s.clues[0].status === "away", "current player skipped instantly");
  assert(current(s) === order[1] && s.endsAt === t.ctx.now() + CLUE_MS, "next player gets a full turn");
  // A later player drops: skipped when their turn comes.
  setConnected(s, t, order[2], false);
  act(s, t, order[1], { type: "clue", text: "zqalpha" });
  assert(s.clues[2].by === order[2] && s.clues[2].status === "away" && current(s) === order[3], "offline player skipped on arrival");
  // The first player comes back in time for lap 2.
  setConnected(s, t, first, true);
  act(s, t, order[3], { type: "clue", text: "zqbravo" });
  act(s, t, order[4], { type: "clue", text: "zqecho" });
  assert(current(s) === first && turnOf(s) === 5, "returning player gets their lap-2 turn");
  act(s, t, first, { type: "clue", text: "zqcharlie" });
  act(s, t, order[1], { type: "clue", text: "zqdelta" });
  assert(s.clues[7].status === "away", "still-offline player skipped again");
  assert(current(s) === order[3], "on to the next player");
  act(s, t, order[3], { type: "clue", text: "zqfoxtrot" });
  // Tick also catches an offline current player (e.g. no playerLeft callback).
  t.ctx.players.find((p) => p.id === order[4])!.connected = false;
  assert(tick(s, t) && phase(s) === "vote", "tick skips an offline current player");
  t.ctx.players.find((p) => p.id === order[4])!.connected = true;
  tick(s, t);
}

// ---------- disconnects: vote phase ----------
{
  const { t, s } = start(4, 29);
  playClues(s, t);
  const [a, b, c, d] = s.ids;
  act(s, t, a, { type: "vote", target: b });
  act(s, t, b, { type: "vote", target: c });
  act(s, t, c, { type: "vote", target: a });
  assert(s.settleAt === null && !view(s, t, a).allVoted, "waiting on d");
  setConnected(s, t, d, false);
  assert(s.settleAt === t.ctx.now(), "d leaving means everyone connected has voted");
  later(s, t, 1000);
  setConnected(s, t, d, true);
  assert(s.settleAt === null && view(s, t, a).endsAt === s.endsAt, "d back: the vote reopens to its full deadline");
  later(s, t, VOTE_SETTLE_MS);
  assert(phase(s) === "vote", "still waiting on d");
  act(s, t, d, { type: "vote", target: a });
  later(s, t, VOTE_SETTLE_MS);
  assert(phase(s) !== "vote", "resolves once d votes");
}

// ---------- disconnects: last guess ----------
{
  // Odd one drops mid-guess and never returns: resolved after the short grace.
  const { t, s } = start(4, 31);
  playClues(s, t);
  const odd = oddId(s);
  for (const id of s.ids) if (id !== odd) act(s, t, id, { type: "vote", target: odd });
  later(s, t, VOTE_MS);
  assert(phase(s) === "lastGuess", "caught");
  later(s, t, 2000);
  setConnected(s, t, odd, false);
  assert(view(s, t, s.ids.find((id) => id !== odd)!).endsAt === t.ctx.now() + AWAY_GUESS_MS, "short window shown");
  assert(!later(s, t, AWAY_GUESS_MS - 1) && phase(s) === "lastGuess", "waits a moment");
  assert(later(s, t, 1) && phase(s) === "reveal" && s.history[0].outcome === "caught", "offline odd one forfeits the guess");
}
{
  // Odd one drops and comes back quickly: still gets to guess.
  const { t, s } = start(4, 37);
  playClues(s, t);
  const odd = oddId(s);
  for (const id of s.ids) if (id !== odd) act(s, t, id, { type: "vote", target: odd });
  later(s, t, VOTE_MS);
  setConnected(s, t, odd, false);
  later(s, t, AWAY_GUESS_MS - 2000);
  setConnected(s, t, odd, true);
  assert(view(s, t, odd).endsAt === s.endsAt, "full guess window restored");
  later(s, t, 3000);
  assert(phase(s) === "lastGuess", "still guessing after the grace would have passed");
  assert(act(s, t, odd, { type: "guess", text: s.majorityWord }), "guess lands");
  assert(s.history[0].outcome === "guessed", "guessed after reconnecting");
}
{
  // Odd one was already offline when caught: a short window from the start of the phase.
  const { t, s } = start(5, 41);
  playClues(s, t);
  const odd = oddId(s);
  for (const id of s.ids) if (id !== odd) act(s, t, id, { type: "vote", target: odd });
  setConnected(s, t, odd, false);
  later(s, t, 30_000);
  tick(s, t);
  assert(phase(s) === "lastGuess", "caught while offline");
  assert(view(s, t, s.ids.find((id) => id !== odd)!).endsAt === s.endsAt - GUESS_MS + AWAY_GUESS_MS, "8s window from the phase start");
  later(s, t, AWAY_GUESS_MS);
  assert(phase(s) === "reveal", "no stall on an absent odd one");
}

// ---------- disconnects: reveal & next odd one ----------
for (const seed of [43, 44, 45, 46, 47]) {
  const { t, s } = start(6, seed);
  playClues(s, t);
  later(s, t, VOTE_MS);
  assert(phase(s) === "reveal", "reveal");
  // Two players go offline during the reveal: the next odd one is someone connected.
  const away = s.ids.slice(0, 2);
  for (const id of away) setConnected(s, t, id, false);
  later(s, t, REVEAL_MS);
  assert(roundOf(s) === 2 && !away.includes(oddId(s)), "next odd one is connected");
  assert(phase(s) === "clues" && !away.includes(current(s)!), "an online player has the turn");
  for (const id of away) setConnected(s, t, id, true);
}

// ---------- not enough players ----------
{
  // A player drops for a moment: the game carries on.
  const { t, s, endCalls } = start(3, 47);
  const leaver = s.ids.find((id) => id !== current(s))!;
  setConnected(s, t, leaver, false);
  assert(s.shortSince === t.ctx.now() && view(s, t, s.ids[0]).shortUntil === t.ctx.now() + SHORT_GRACE_MS, "warning shown");
  later(s, t, SHORT_GRACE_MS - 1000);
  setConnected(s, t, leaver, true);
  assert(s.shortSince === null && view(s, t, s.ids[0]).shortUntil === null, "warning cleared");
  later(s, t, SHORT_GRACE_MS);
  assert(endCalls() === 0 && phase(s) !== "final", "game continues");
}
{
  // A player leaves for good mid-vote: ends gracefully with scores so far.
  const { t, s, endCalls } = start(3, 53);
  playClues(s, t);
  later(s, t, VOTE_MS); // round 1: no votes, odd escapes (+3)
  const firstOdd = oddId(s);
  later(s, t, REVEAL_MS);
  playClues(s, t);
  const leaver = s.ids.find((id) => id !== firstOdd)!;
  setConnected(s, t, leaver, false);
  assert(!later(s, t, SHORT_GRACE_MS - 1) && phase(s) === "vote", "grace period");
  assert(later(s, t, 1) && phase(s) === "final", "ends after the grace period");
  assert(endCalls() === 1 && resultOf(t)!.winners.length === 1 && resultOf(t)!.winners[0] === firstOdd, "leader wins");
  assert(/^Ended early: Player\d wins Odd One Out with 3 points$/.test(resultOf(t)!.headline), "headline explains the early end");
  assert(s.endedEarly && s.history.length === 2 && s.history[1].outcome === "abandoned", "unfinished round revealed as abandoned");
  assert(Object.values(s.history[1].points).every((p) => p === 0), "nobody scores an abandoned round");
  assert(view(s, t, "spectator").history[1].majorityWord === s.majorityWord, "words shown in the recap");
  assert(tick(s, t) === false && endCalls() === 1, "end called once");
}
{
  // Everybody vanishes: the game pauses (no turns burned, no rounds auto-resolved, no points)
  // and ends after the grace period.
  const { t, s, endCalls } = start(4, 59);
  const gone = t.ctx.now();
  for (const id of s.ids) setConnected(s, t, id, false);
  assert(phase(s) === "clues" && clueCount(s) <= 1, "at most the first leaver's turn was skipped");
  assert(view(s, t, "spectator").shortUntil === gone + SHORT_GRACE_MS, "everyone sees the pause and its deadline");
  let guard = 0;
  while (phase(s) !== "final" && guard++ < 400) later(s, t, 1000);
  assert(phase(s) === "final" && endCalls() === 1, "ends instead of stalling");
  assert(t.ctx.now() - gone >= SHORT_GRACE_MS && t.ctx.now() - gone < SHORT_GRACE_MS + 1500, "ends after the grace period");
  assert(roundOf(s) === 1 && s.scores.every((x) => x === 0), "no rounds played on their own, nobody scored");
  assert(resultOf(t)!.winners.length === 0 && /ended early/i.test(resultOf(t)!.headline), "nobody wins an empty game");
}

{
  // Everyone drops for 12s, 2s into round 1, then returns: same round, same turn, the
  // turn clock resumes where it stopped, and nobody has scored.
  const { t, s, endCalls } = start(4, 5);
  later(s, t, 2000);
  const turn = turnOf(s);
  const who = current(s);
  const left = s.endsAt - t.ctx.now();
  for (const id of s.ids) setConnected(s, t, id, false);
  for (let ms = 0; ms < 12_000; ms += 250) later(s, t, 250);
  for (const id of s.ids) setConnected(s, t, id, true);
  assert(endCalls() === 0 && phase(s) === "clues" && roundOf(s) === 1, "still round 1 clues");
  assert(s.clues.filter((c) => c.status === "away").length <= 1, "no turns burned while paused");
  const v = view(s, t, s.ids[0]);
  assert(v.shortUntil === null && s.scores.every((x) => x === 0) && s.history.length === 0, "no points, no reveals");
  if (current(s) === who) {
    assert(turnOf(s) === turn && s.endsAt - t.ctx.now() === left, "turn clock resumes with the time it had");
  }
  playClues(s, t);
  assert(phase(s) === "vote", "play continues normally");
}

{
  // A 2.5s blip during the vote, before anyone voted: still voting afterwards, nobody scores.
  const { t, s } = start(4, 6);
  playClues(s, t);
  const remaining = s.endsAt - t.ctx.now();
  for (const id of s.ids) setConnected(s, t, id, false);
  for (let ms = 0; ms < 2500; ms += 250) later(s, t, 250);
  for (const id of s.ids) setConnected(s, t, id, true);
  tick(s, t);
  assert(phase(s) === "vote" && s.scores.every((x) => x === 0), "vote survives the blip");
  assert(s.endsAt - t.ctx.now() === remaining, "the vote clock lost no time");
  assert(view(s, t, s.ids[0]).allVoted === false, "an empty vote doesn't count as everyone voted");
}

{
  // 3 players, one drops mid-round: paused instead of skipping, resumes when they return.
  const { t, s, endCalls } = start(3, 48);
  const who = current(s)!;
  later(s, t, 10_000);
  setConnected(s, t, who, false);
  assert(current(s) === who && clueCount(s) === 0, "their turn waits instead of being skipped");
  for (let ms = 0; ms < SHORT_GRACE_MS - 1000; ms += 250) later(s, t, 250); // longer than the 15s left
  assert(current(s) === who && clueCount(s) === 0 && endCalls() === 0, "no timeout while paused");
  setConnected(s, t, who, true);
  assert(view(s, t, who).endsAt - t.ctx.now() === CLUE_MS - 10_000, "turn time left as it was before the pause");
  assert(act(s, t, who, { type: "clue", text: "zqback" }), "and they can play their turn");
}

// ---------- player counts ----------
{
  // 12 players: three rounds, three different odd ones, 24 turns each.
  const { t, s, endCalls } = start(12, 61);
  const expected: Record<string, number> = Object.fromEntries(s.ids.map((id) => [id, 0]));
  for (let round = 1; round <= 3; round++) {
    for (const id of s.ids) if (id !== oddId(s)) expected[id] += 2;
    assert(s.order.length === 12, "everyone in the order");
    playClues(s, t);
    assert(clueCount(s) === 24, "24 turns");
    const odd = oddId(s);
    for (const id of s.ids) act(s, t, id, { type: "vote", target: id === odd ? s.ids.find((x) => x !== odd)! : odd });
    later(s, t, VOTE_SETTLE_MS);
    act(s, t, odd, { type: "guess", text: "zzz" });
    later(s, t, REVEAL_MS);
  }
  assert(endCalls() === 1 && phase(s) === "final", "12-player game completes");
  // Each round: 11 catchers x 2 points.
  for (const id of s.ids) assert(resultOf(t)!.scores![id] === expected[id], "12-player scores");
  const r = resultOf(t)!;
  assert(JSON.stringify(r.winners.slice().sort()) === JSON.stringify(topScorers(expected).sort()), "winners = top scorers");
  if (r.winners.length > 3) {
    assert(r.headline === `${r.winners.length} players tie for the win with 6 points`, `big tie summarised: ${r.headline}`);
  }
}
{
  // A many-way tie gives a short headline instead of listing every name.
  const { t, s } = start(12, 62);
  s.scores = s.ids.map((_, i) => (i < 9 ? 6 : 4));
  s.round = s.totalRounds;
  s.phase = "reveal";
  s.endsAt = t.ctx.now();
  tick(s, t);
  const r = resultOf(t)!;
  assert(r.winners.length === 9 && r.headline === "9 players tie for the win with 6 points", r.headline);
  const three = start(3, 63);
  three.s.scores = [2, 2, 2];
  three.s.round = three.s.totalRounds;
  three.s.phase = "reveal";
  three.s.endsAt = three.t.ctx.now();
  tick(three.s, three.t);
  assert(/^Player0, Player1 & Player2 tie for the win with 2 points$/.test(resultOf(three.t)!.headline), "small ties still name everyone");
}
{
  // Player ids are client-chosen: a "__proto__" id must still score like anyone else.
  const t = makeTestCtx(3, 71);
  t.ctx.players[0].id = "__proto__";
  const s: ImpostorState = game.setup(t.ctx);
  let guard = 0;
  while (phase(s) !== "final" && guard++ < 200) later(s, t, 30_000);
  assert(phase(s) === "final" && resultOf(t), "game with a weird id completes");
  assert(Object.prototype.hasOwnProperty.call(resultOf(t)!.scores, "__proto__"), "weird id has its own score entry");
  const weirdEscapes = s.history.filter((h) => h.oddId === "__proto__").length;
  assert(resultOf(t)!.scores!["__proto__"] === 3 * weirdEscapes, "weird id scored its escapes");
  assert(resultOf(t)!.winners.includes("__proto__") === topScorers(resultOf(t)!.scores!).includes("__proto__"), "weird id ranked normally");
  const v = JSON.parse(JSON.stringify(view(s, t, "__proto__"))) as ImpostorView;
  assert(Object.prototype.hasOwnProperty.call(v.scores, "__proto__"), "weird id survives the JSON round trip");
}
{
  // Seeds vary the pair, the odd one and the order.
  const pairs = new Set<string>();
  const firsts = new Set<string>();
  for (let seed = 100; seed < 120; seed++) {
    const { s } = start(6, seed);
    pairs.add(s.majorityWord);
    firsts.add(s.ids[s.oddSeat]);
  }
  assert(pairs.size > 10 && firsts.size > 3, "randomised setup");
}

// ---------- choosing the odd one keeps the role hidden ----------
{
  // 3 players: round 3's odd one is not simply "whoever is left"; earlier odd ones can be odd again.
  let distinctFirstTwo = 0;
  let lastFresh = 0;
  let repeats = 0;
  const firstPick = new Map<string, number>();
  for (let seed = 1; seed <= 400; seed++) {
    const t = makeTestCtx(3, seed);
    const s: ImpostorState = game.setup(t.ctx);
    const odds: string[] = [];
    let guard = 0;
    while (phase(s) !== "final" && guard++ < 200) {
      if (phase(s) === "clues" && turnOf(s) === 0 && odds.length < roundOf(s)) odds.push(oddId(s));
      later(s, t, 30_000);
    }
    assert(odds.length === 3, "three rounds");
    firstPick.set(odds[0], (firstPick.get(odds[0]) ?? 0) + 1);
    if (new Set(odds).size < 3) repeats += 1;
    if (odds[0] !== odds[1]) {
      distinctFirstTwo += 1;
      if (!odds.slice(0, 2).includes(odds[2])) lastFresh += 1;
    }
  }
  const share = lastFresh / distinctFirstTwo;
  assert(share > 0.35 && share < 0.65, `round 3 isn't predictable (${(share * 100).toFixed(0)}% the remaining player)`);
  assert(repeats > 100 && repeats < 300, `odd ones can repeat (${repeats}/400 games)`);
  assert([...firstPick.values()].every((c) => c > 100), "round 1 is uniform");
}

// ---------- deadlines hold even between ticks ----------
{
  // A vote sent after the vote closed (no tick in between) is refused and can't change the result.
  const { t, s } = start(4, 7);
  playClues(s, t);
  const odd = oddId(s);
  const others = s.ids.filter((id) => id !== odd);
  for (const id of others) act(s, t, id, { type: "vote", target: odd });
  act(s, t, odd, { type: "vote", target: others[0] });
  t.advance(VOTE_SETTLE_MS + 200);
  const moved = act(s, t, others[0], { type: "vote", target: others[1] });
  assert(moved === true, "the overdue close is applied (and broadcast)");
  assert(phase(s) === "lastGuess" && s.votes[s.ids.indexOf(others[0])] === s.ids.indexOf(odd), "late vote change refused");
  // A guess 200ms after the guess window is refused: caught.
  t.advance(GUESS_MS + 200);
  act(s, t, odd, { type: "guess", text: s.majorityWord });
  assert(s.history[0].outcome === "caught" && s.history[0].guess === null, "late guess refused");
}
{
  // A clue 200ms after the turn ended counts as a pass, not a clue.
  const { t, s } = start(4, 8);
  const who = current(s)!;
  t.advance(CLUE_MS + 200);
  assert(act(s, t, who, { type: "clue", text: "zqlate" }) === true, "overdue pass applied");
  assert(s.clues[0].status === "pass" && s.clues[0].text === null && current(s) !== who, "late clue refused");
}
{
  // A caught odd one who returns just after their short away window doesn't get the full window back.
  const { t, s } = start(5, 41);
  playClues(s, t);
  const odd = oddId(s);
  for (const id of s.ids) if (id !== odd) act(s, t, id, { type: "vote", target: odd });
  later(s, t, VOTE_MS);
  assert(phase(s) === "lastGuess", "caught");
  setConnected(s, t, odd, false);
  t.advance(AWAY_GUESS_MS + 100);
  setConnected(s, t, odd, true);
  assert(phase(s) === "reveal" && s.history[0].outcome === "caught", "window had closed");
}

console.log("impostor: all tests passed");
