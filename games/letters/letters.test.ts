import { assert, makeTestCtx } from "../../shared/testing";
import type { GameResult } from "../../shared/types";
import game, { cleanAnswer, type LettersState } from "./server";
import { CATEGORIES } from "./data";
import {
  ANSWER_MS,
  CATEGORIES_PER_ROUND,
  LETTERS,
  MAX_ANSWER,
  REJOIN_MS,
  RESULTS_MS,
  REVIEW_MS,
  ROUNDS,
  answerCore,
  answerKey,
  autoVerdict,
  splitArticle,
  type LettersView,
  type LiveCell,
  type Phase,
} from "./shared";

// ---------- harness ----------

type T = ReturnType<typeof makeTestCtx>;

function start(n: number, seed = 42) {
  const t = makeTestCtx(n, seed);
  let ends = 0;
  const end = t.ctx.end;
  t.ctx.end = (r: GameResult) => {
    ends++;
    end(r);
  };
  const s: LettersState = game.setup(t.ctx);
  return { t, s, ends: () => ends };
}

const act = (s: LettersState, t: T, who: number | string, a: unknown) =>
  game.action(s, typeof who === "number" ? t.ids[who] : who, a, t.ctx);
const tick = (s: LettersState, t: T) => game.tick!(s, t.ctx);
const view = (s: LettersState, t: T, who: number | string) =>
  game.view(s, typeof who === "number" ? t.ids[who] : who, t.ctx) as LettersView;
// Getters (not property reads) so TypeScript doesn't carry narrowing across mutating calls.
const phase = (s: LettersState): Phase => s.phase;
const round = (s: LettersState): number => s.round;
const vetoCount = (s: LettersState, author: number, i: number): number => s.vetoes[author][i].length;
const cellAt = (v: LettersView, ci: number, k: number): LiveCell => v.board![ci][k];

function drop(s: LettersState, t: T, who: number) {
  t.ctx.players[who].connected = false;
  game.playerLeft!(s, t.ids[who], t.ctx);
}
function back(s: LettersState, t: T, who: number) {
  t.ctx.players[who].connected = true;
  game.playerReturned!(s, t.ids[who], t.ctx);
}

/** A valid-looking answer for the current letter. Tags made only of letters keep keys distinct. */
const word = (s: LettersState, tag: string) => `${s.plan[s.round].letter}${tag}`;

/** Fill every category for player `who` with distinct answers based on `tag`. */
function fillAll(s: LettersState, t: T, who: number, tag: string) {
  for (let i = 0; i < CATEGORIES_PER_ROUND; i++) {
    assert(act(s, t, who, { type: "answer", i, text: word(s, `${tag}${"abcdef"[i]}`) }) === true, "answer accepted");
  }
}

/** Walk the game through timers only (nobody presses anything) until it ends. */
function runOut(s: LettersState, t: T) {
  for (let guard = 0; guard < 50 && s.phase !== "final"; guard++) {
    t.advance(Math.max(1, (s.endsAt ?? 0) - t.ctx.now()));
    tick(s, t);
  }
}

/** Checks a view is plain JSON: no undefined, functions, Maps, Sets or non-finite numbers. */
function assertPlain(v: unknown, path = "view"): void {
  if (v === null || typeof v === "string" || typeof v === "boolean") return;
  if (typeof v === "number") return assert(Number.isFinite(v), `${path} is not finite`);
  assert(typeof v === "object", `${path} is ${typeof v}`);
  if (Array.isArray(v)) return v.forEach((x, i) => assertPlain(x, `${path}[${i}]`));
  assert(Object.getPrototypeOf(v) === Object.prototype, `${path} is not a plain object`);
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) assertPlain(x, `${path}.${k}`);
}

function checkViews(s: LettersState, t: T) {
  for (const who of [...t.ids, "spectator"]) assertPlain(game.view(s, who, t.ctx));
}

// ---------- data and text rules ----------
{
  assert(CATEGORIES.length >= 80, `need at least 80 categories, have ${CATEGORIES.length}`);
  const seen = new Set<string>();
  for (const c of CATEGORIES) {
    assert(c === c.trim() && c.length > 2 && c.length <= 40, `odd category "${c}"`);
    assert(!seen.has(c.toLowerCase()), `duplicate category "${c}"`);
    seen.add(c.toLowerCase());
  }
  assert(LETTERS.length === 20 && !LETTERS.some((l) => "QUVXYZ".includes(l)), "letter pool");

  assert(answerCore("The Beatles") === "beatles", "drops 'the'");
  assert(answerCore("  ¡An Apple!") === "apple!", "drops leading punctuation and 'an'");
  assert(answerCore('"Banana"') === 'banana"', "drops leading quote");
  assert(answerCore("The") === "the", "a lone article stays");
  assert(splitArticle("A banana").article === "a", "reports the article");
  assert(autoVerdict("The Beatles", "B") === "ok", "article ignored for the letter");
  assert(autoVerdict("The Beatles", "T") === "letter", "article does not count as the letter");
  assert(autoVerdict("A banana", "B") === "ok", "'a' ignored");
  assert(autoVerdict("Éclair", "E") === "ok", "accents folded");
  assert(autoVerdict("éclair", "e") === "ok", "lowercase letter arg");
  assert(autoVerdict("", "B") === "blank" && autoVerdict("   ", "B") === "blank", "blank");
  assert(autoVerdict("Apple", "B") === "letter", "wrong letter");
  assert(autoVerdict("!!!", "B") === "letter", "punctuation only");
  assert(autoVerdict("B", "B") === "short" && autoVerdict("B.", "B") === "short", "single letter is too short");
  assert(autoVerdict("Bo", "B") === "ok", "two letters is fine");

  assert(answerKey("The Beatles") === answerKey("beatles"), "key drops article");
  assert(answerKey("Crème Brûlée") === answerKey("creme brulee"), "key folds accents");
  assert(answerKey("Spider-Man") === answerKey("spider man"), "key ignores punctuation/spaces");
  assert(answerKey("Ice cream") === answerKey("icecream"), "key ignores spaces");
  assert(answerKey("Cats") === answerKey("cat"), "key folds plurals");
  assert(answerKey("Mac & Cheese") === answerKey("mac and cheese"), "key reads & as and");
  assert(answerKey("Bus") !== answerKey("Bu"), "short words keep their s");
  assert(answerKey("Glass") !== answerKey("Glas"), "double s kept");
  assert(answerKey("Banana") !== answerKey("Bandana"), "different words differ");

  assert(cleanAnswer("  Big\u0000\u0007  \t bad\n wolf ") === "Big bad wolf", "control chars and spaces");
  assert(cleanAnswer("a\u200b\u202eb") === "ab", "zero-width and bidi stripped");
  assert(cleanAnswer("x".repeat(100)).length === MAX_ANSWER, "capped");
  const emoji = cleanAnswer("🍌".repeat(50));
  assert(Array.from(emoji).length === MAX_ANSWER && !/[\ud800-\udbff]$/.test(emoji), "emoji never split");
}

// ---------- setup: letters and categories never repeat, never Q U V X Y Z ----------
{
  for (let seed = 1; seed <= 300; seed++) {
    const t = makeTestCtx(3, seed);
    const s: LettersState = game.setup(t.ctx);
    assert(s.plan.length === ROUNDS, "three rounds planned");
    const letters = s.plan.map((r) => r.letter);
    assert(new Set(letters).size === ROUNDS, "letters unique");
    assert(letters.every((l) => (LETTERS as readonly string[]).includes(l)), "letters from the pool");
    const cats = s.plan.flatMap((r) => r.categories);
    assert(cats.length === ROUNDS * CATEGORIES_PER_ROUND && new Set(cats).size === cats.length, "categories unique");
  }
  const { t, s } = start(3);
  const v = view(s, t, 0);
  assert(v.phase === "answer" && v.round === 1 && v.rounds === ROUNDS, "starts answering round 1");
  assert(v.categories.length === 6 && v.endsAt === t.ctx.now() + ANSWER_MS, "six categories, 90s");
  assert(v.mine?.length === 6 && v.mine.every((a) => a === ""), "blank answers");
  assert(!JSON.stringify(v).includes(s.plan[1].categories[0]), "future categories not leaked");
  checkViews(s, t);
}

// ---------- full game: scoring, vetoes, duplicates, timers, end ----------
{
  const { t, s, ends } = start(3);
  const scoreOf = () => s.scores.slice();

  // Round 1. p0 six unique answers. p1 copies p0 on categories 0-1 (with different
  // spelling) and leaves the rest blank. p2 answers with the wrong letter / too short.
  fillAll(s, t, 0, "oak");
  act(s, t, 1, { type: "answer", i: 0, text: `the ${word(s, "oaka").toLowerCase()}s` });
  act(s, t, 1, { type: "answer", i: 1, text: ` ${word(s, "oakb").toUpperCase()}!` });
  act(s, t, 2, { type: "answer", i: 0, text: "Zzz top" }); // Z is never a round letter
  act(s, t, 2, { type: "answer", i: 1, text: s.plan[0].letter });

  // Timer: nothing moves a millisecond early.
  t.advance(ANSWER_MS - 1);
  assert(tick(s, t) === false && phase(s) === "answer", "still answering at 89.999s");
  t.advance(1);
  assert(tick(s, t) === true && phase(s) === "review", "review at 90s");
  let v = view(s, t, 2);
  assert(v.board?.length === 6 && v.board[0].length === 3, "board is categories x players");
  assert(cellAt(v, 0, 0).status === "shared" && cellAt(v, 0, 1).status === "shared", "duplicates spotted");
  assert(cellAt(v, 0, 0).same[0] === 1 && cellAt(v, 0, 1).same[0] === 0, "same-as indices");
  assert(cellAt(v, 2, 0).status === "unique" && cellAt(v, 2, 0).points === 10, "unique 10");
  assert(cellAt(v, 0, 2).status === "letter" && cellAt(v, 1, 2).status === "short", "auto-invalid reasons");
  assert(cellAt(v, 3, 1).status === "blank", "blank");
  assert(cellAt(v, 2, 0).canVeto && !cellAt(v, 0, 2).canVeto, "can veto valid answers only");
  assert(cellAt(view(s, t, 0), 0, 0).canVeto === false, "cannot veto own answer");
  assert(cellAt(view(s, t, "spectator"), 2, 0).canVeto === false, "spectators cannot veto");
  checkViews(s, t);

  t.advance(REVIEW_MS - 1);
  assert(tick(s, t) === false && phase(s) === "review", "still reviewing at 59.999s");
  t.advance(1);
  assert(tick(s, t) === true && phase(s) === "results", "results at 60s");
  // p0: 2 shared (5) + 4 unique (10) = 50; p1: 2 shared = 10; p2: 0
  assert(JSON.stringify(scoreOf()) === "[50,10,0]", `round 1 scores ${scoreOf()}`);
  v = view(s, t, 1);
  assert(v.recap?.round === 1 && JSON.stringify(v.recap.points) === "[50,10,0]", "recap points");
  checkViews(s, t);
  t.advance(RESULTS_MS - 1);
  assert(tick(s, t) === false && phase(s) === "results", "results hold for 6s");
  t.advance(1);
  assert(tick(s, t) === true && phase(s) === "answer" && round(s) === 1, "round 2 starts");
  assert(view(s, t, 0).mine!.every((a) => a === ""), "answers reset between rounds");
  assert(s.plan[1].letter !== s.plan[0].letter, "new letter");

  // Round 2: p0 and p1 both write the same answer for category 0; p1's gets vetoed by
  // p2 (3 online: one veto is half of the other two), so p0's becomes unique.
  act(s, t, 0, { type: "answer", i: 0, text: word(s, "anana") });
  act(s, t, 1, { type: "answer", i: 0, text: word(s, "anana") });
  act(s, t, 1, { type: "answer", i: 1, text: word(s, "ingo") });
  act(s, t, 2, { type: "answer", i: 1, text: word(s, "ingo") });
  // Early advance: everyone done.
  assert(act(s, t, 0, { type: "done" }) === true && phase(s) === "answer", "p0 done");
  assert(act(s, t, 1, { type: "done" }) === true && phase(s) === "answer", "p1 done");
  assert(act(s, t, 1, { type: "undone" }) === true && !s.done[1], "undone reverts");
  assert(act(s, t, 1, { type: "answer", i: 2, text: word(s, "oat") }) === true, "edit after undone");
  assert(act(s, t, 1, { type: "done" }) === true, "p1 done again");
  assert(act(s, t, 2, { type: "done" }) === true && phase(s) === "review", "all done -> review early");
  assert(s.firstDone[0] === 1, "p0 finished first");
  assert(act(s, t, 2, { type: "veto", player: t.ids[1], i: 0 }) === true, "veto");
  v = view(s, t, 2);
  assert(cellAt(v, 0, 1).status === "vetoed" && cellAt(v, 0, 1).mine && cellAt(v, 0, 1).need === 1, "vetoed, mine");
  assert(cellAt(v, 0, 0).status === "unique" && cellAt(v, 0, 0).points === 10, "surviving duplicate becomes unique");
  assert(cellAt(view(s, t, 0), 0, 1).mine === false, "other viewers don't see it as theirs");
  // Toggle off and on again.
  assert(act(s, t, 2, { type: "veto", player: t.ids[1], i: 0 }) === true && vetoCount(s, 1, 0) === 0, "unveto");
  assert(act(s, t, 2, { type: "veto", player: t.ids[1], i: 0 }) === true && vetoCount(s, 1, 0) === 1, "reveto");
  // Ready: early advance once everyone online says looks good; unready works.
  assert(act(s, t, 0, { type: "ready" }) === true && act(s, t, 0, { type: "ready" }) === false, "ready once");
  assert(act(s, t, 0, { type: "unready" }) === true && act(s, t, 0, { type: "unready" }) === false, "unready once");
  act(s, t, 0, { type: "ready" });
  act(s, t, 1, { type: "ready" });
  assert(phase(s) === "review", "waits for the last reviewer");
  assert(act(s, t, 2, { type: "veto", player: t.ids[0], i: 0 }) === true, "vetoing after others are ready is fine");
  assert(act(s, t, 2, { type: "veto", player: t.ids[0], i: 0 }) === true, "and taking it back");
  assert(act(s, t, 2, { type: "ready" }) === true && phase(s) === "results", "all ready -> results early");
  // Round 2: p0 10 (cat 0 unique); p1 5 (cat 1 shared) + 10 (cat 2 unique) = 15; p2 5 (cat 1 shared)
  assert(JSON.stringify(scoreOf()) === "[60,25,5]", `round 2 scores ${scoreOf()}`);
  assert(s.history[1].cells[0][1].status === "vetoed" && s.history[1].cells[0][1].vetoes === 1, "veto recorded");

  // Round 3: nobody types; timers only.
  t.advance(RESULTS_MS);
  tick(s, t);
  assert(phase(s) === "answer" && round(s) === 2, "round 3");
  act(s, t, 2, { type: "answer", i: 4, text: word(s, "ig finish") });
  t.advance(ANSWER_MS);
  tick(s, t);
  t.advance(REVIEW_MS);
  tick(s, t);
  assert(phase(s) === "results" && ends() === 0, "round 3 results, not ended yet");
  assert(JSON.stringify(scoreOf()) === "[60,25,15]", `round 3 scores ${scoreOf()}`);
  t.advance(RESULTS_MS);
  assert(tick(s, t) === true && phase(s) === "final", "final after round 3 results");
  assert(ends() === 1 && t.result, "ended exactly once");
  assert(JSON.stringify(t.result.winners) === JSON.stringify([t.ids[0]]), "p0 wins");
  assert(t.result.scores?.[t.ids[1]] === 25 && t.result.scores?.[t.ids[2]] === 15, "scores reported");
  assert(t.result.headline.includes("Player0"), `headline names the winner: ${t.result.headline}`);
  v = view(s, t, "spectator");
  assert(v.history?.length === 3 && v.awards !== null && v.endsAt === null, "final view has history");
  assert(v.awards!.some((a) => a.title === "Most original" && a.players[0] === 0), "most original award");
  assert(v.awards!.some((a) => a.title === "Most vetoed" && a.players[0] === 1), "most vetoed award");
  checkViews(s, t);

  // After the end: everything is ignored and nothing re-ends.
  for (const a of [{ type: "answer", i: 0, text: "x" }, { type: "done" }, { type: "ready" }, { type: "veto", player: t.ids[1], i: 0 }]) {
    assert(act(s, t, 0, a) === false, `post-game ${a.type} ignored`);
  }
  t.advance(999_999);
  assert(!tick(s, t) && phase(s) === "final", "tick is a no-op after the end");
  drop(s, t, 1);
  back(s, t, 1);
  assert(phase(s) === "final" && ends() === 1, "still ended once");
}

// ---------- hostile and invalid actions ----------
{
  const { t, s } = start(3);
  const before = JSON.stringify(s);
  const junk: unknown[] = [
    null,
    undefined,
    "done",
    42,
    true,
    [],
    ["done"],
    {},
    { type: 5 },
    { type: "DONE" },
    { type: "toString" },
    { type: "__proto__" },
    { type: "answer" },
    { type: "answer", i: 0 },
    { type: "answer", i: -1, text: "x" },
    { type: "answer", i: 6, text: "x" },
    { type: "answer", i: 1.5, text: "x" },
    { type: "answer", i: "0", text: "x" },
    { type: "answer", i: NaN, text: "x" },
    { type: "answer", i: Infinity, text: "x" },
    { type: "answer", i: 0, text: 123 },
    { type: "answer", i: 0, text: null },
    { type: "answer", i: 0, text: ["B"] },
    { type: "answer", i: 0, text: { toString: () => "B" } },
    { type: "answer", i: 0, text: "B".repeat(1_000_000) },
    { type: "answer", i: 0, text: "" }, // unchanged
    { type: "answer", i: 0, text: "   \u0000 " }, // sanitizes to unchanged ""
    { type: "veto", player: t.ids[1], i: 0 }, // wrong phase
    { type: "ready" }, // wrong phase
    { type: "unready" },
    { type: "undone" }, // not done
  ];
  for (const a of junk) assert(act(s, t, 0, a) === false, `rejected ${JSON.stringify(a)?.slice(0, 60)}`);
  assert(act(s, t, "stranger", { type: "done" }) === false, "non-participant rejected");
  assert(act(s, t, "spectator", { type: "answer", i: 0, text: "Hi" }) === false, "spectator rejected");
  assert(act(s, t, "__proto__", { type: "done" }) === false, "weird id rejected");
  assert(JSON.stringify(s) === before, "state untouched by junk");

  // Oversize but sane strings are trimmed to 40, control characters stripped.
  assert(act(s, t, 0, { type: "answer", i: 0, text: `  ${"Bb".repeat(30)}\u0007 ` }) === true, "long answer accepted");
  assert(s.answers[0][0].length === MAX_ANSWER, "capped at 40");
  assert(act(s, t, 0, { type: "answer", i: 1, text: "Big\n\n\tbear" }) === true && s.answers[0][1] === "Big bear", "sanitized");
  assert(act(s, t, 0, { type: "answer", i: 1, text: "Big bear " }) === false, "same after sanitizing = no change");

  // Done locks edits; done twice is a no-op.
  act(s, t, 0, { type: "done" });
  assert(act(s, t, 0, { type: "done" }) === false, "double done");
  assert(act(s, t, 0, { type: "answer", i: 2, text: "Bee" }) === false, "locked while done");
  const L = s.plan[0].letter;
  assert(act(s, t, 1, { type: "answer", i: 0, text: `${L}ingo` }) === true, "p1 answers (veto target later)");

  // Late answers (deadline passed, tick not yet run) are refused.
  t.advance(ANSWER_MS);
  assert(act(s, t, 1, { type: "answer", i: 0, text: "Bee" }) === false, "late answer refused");
  assert(act(s, t, 1, { type: "done" }) === false, "late done refused");
  tick(s, t);
  assert(phase(s) === "review", "review");

  // Review-phase junk.
  const reviewJunk: unknown[] = [
    { type: "veto" },
    { type: "veto", player: t.ids[0], i: 0 }, // own answer
    { type: "veto", player: t.ids[1] },
    { type: "veto", player: t.ids[1], i: 9 },
    { type: "veto", player: t.ids[1], i: "0" },
    { type: "veto", player: null, i: 0 },
    { type: "veto", player: ["p1"], i: 0 },
    { type: "veto", player: "spectator", i: 0 },
    { type: "veto", player: "__proto__", i: 0 },
    { type: "veto", player: "constructor", i: 0 },
    { type: "veto", player: t.ids[2], i: 0 }, // p2's answer is blank: nothing to veto
    { type: "answer", i: 0, text: "Bee" }, // wrong phase
    { type: "done" },
    { type: "undone" },
  ];
  for (const a of reviewJunk) assert(act(s, t, 0, a) === false, `review rejected ${JSON.stringify(a)}`);
  assert(act(s, t, 0, { type: "veto", player: t.ids[1], i: 0 }) === true, "real veto works");
  t.advance(REVIEW_MS);
  assert(act(s, t, 2, { type: "veto", player: t.ids[1], i: 0 }) === false, "late veto refused");
  assert(act(s, t, 2, { type: "ready" }) === false, "late ready refused");
  tick(s, t);
  assert(phase(s) === "results", "results");
  for (const a of [{ type: "ready" }, { type: "done" }, { type: "answer", i: 0, text: "B" }]) {
    assert(act(s, t, 0, a) === false, `results-phase ${a.type} rejected`);
  }
}

// ---------- secrecy ----------
{
  const { t, s } = start(3);
  const secret = `${s.plan[0].letter}SECRETWORD`;
  act(s, t, 0, { type: "answer", i: 3, text: secret });
  assert(JSON.stringify(view(s, t, 0)).includes(secret), "author sees their own answer");
  assert(!JSON.stringify(view(s, t, 1)).includes(secret), "other players can't see it");
  assert(!JSON.stringify(view(s, t, "spectator")).includes(secret), "spectators can't see it");
  assert(view(s, t, "spectator").mine === null && view(s, t, 1).board === null, "no answers or board while answering");
  for (const r of s.plan.slice(1)) {
    for (const c of r.categories) assert(!JSON.stringify(view(s, t, 1)).includes(c), "no peeking at later rounds");
  }
  // Once answers freeze, everyone sees them.
  t.advance(ANSWER_MS);
  tick(s, t);
  assert(JSON.stringify(view(s, t, 1)).includes(secret), "visible in review");
  assert(JSON.stringify(view(s, t, "spectator")).includes(secret), "spectators see review");
  // Vetoes are anonymous: only "mine" is personal.
  act(s, t, 1, { type: "veto", player: t.ids[0], i: 3 });
  const spectatorCell = cellAt(view(s, t, "spectator"), 3, 0);
  assert(spectatorCell.vetoes === 1 && spectatorCell.mine === false, "veto count public, voter private");
  assert(!JSON.stringify(view(s, t, 2)).includes('"vetoes":[['), "voter lists never leave the server");
}

// ---------- veto thresholds track who is online ----------
{
  const { t, s } = start(4);
  act(s, t, 0, { type: "answer", i: 0, text: word(s, "anjo") });
  t.advance(ANSWER_MS);
  tick(s, t);
  assert(cellAt(view(s, t, 1), 0, 0).need === 2, "4 players: need 2 of the other 3");
  act(s, t, 1, { type: "veto", player: t.ids[0], i: 0 });
  assert(cellAt(view(s, t, 1), 0, 0).status === "unique", "one veto isn't enough");
  drop(s, t, 3);
  assert(cellAt(view(s, t, 1), 0, 0).need === 1, "with one offline: need 1 of the other 2");
  assert(cellAt(view(s, t, 1), 0, 0).status === "vetoed", "now rejected");
  back(s, t, 3);
  act(s, t, 2, { type: "veto", player: t.ids[0], i: 0 });
  assert(cellAt(view(s, t, 3), 0, 0).status === "vetoed", "two of three vetoes");
  drop(s, t, 0); // the author leaving doesn't change their own threshold (others online = 3)
  assert(cellAt(view(s, t, 1), 0, 0).need === 2, "author offline: still half of the 3 others");
}
{
  const { t, s } = start(2);
  act(s, t, 0, { type: "answer", i: 0, text: word(s, "anjo") });
  t.advance(ANSWER_MS);
  tick(s, t);
  assert(cellAt(view(s, t, 1), 0, 0).need === 1, "2 players: one veto rejects");
}
{
  const { t, s } = start(12);
  act(s, t, 5, { type: "answer", i: 0, text: word(s, "anjo") });
  t.advance(ANSWER_MS);
  tick(s, t);
  assert(cellAt(view(s, t, 0), 0, 5).need === 6, "12 players: need 6 of the other 11");
}

// ---------- disconnects in every phase ----------
{
  // Answer: the straggler leaving lets everyone else move on.
  const { t, s } = start(3);
  act(s, t, 0, { type: "done" });
  act(s, t, 1, { type: "done" });
  assert(phase(s) === "answer", "waiting on p2");
  drop(s, t, 2);
  assert(phase(s) === "review", "p2 left: review starts");
  // Review: p2 comes back and can vote; then p1 leaves while p0 and p2 are ready.
  back(s, t, 2);
  act(s, t, 0, { type: "ready" });
  act(s, t, 2, { type: "ready" });
  assert(phase(s) === "review", "waiting on p1");
  drop(s, t, 1);
  assert(phase(s) === "results", "p1 left: results");
  // Results: back to 3 online; next round starts on time.
  back(s, t, 1);
  t.advance(RESULTS_MS);
  tick(s, t);
  assert(phase(s) === "answer" && round(s) === 1, "round 2 despite the churn");
  // Answer: a returning player is not counted as done.
  drop(s, t, 2);
  act(s, t, 0, { type: "done" });
  back(s, t, 2);
  act(s, t, 1, { type: "done" });
  assert(phase(s) === "answer", "p2 is back and still writing");
  assert(act(s, t, 2, { type: "answer", i: 0, text: word(s, "ack") }) === true, "returning player can answer");
  act(s, t, 2, { type: "done" });
  assert(phase(s) === "review", "now everyone is done");
}
{
  // Nobody online: no vacuous early advance; the timers still move things along.
  const { t, s } = start(3);
  drop(s, t, 0);
  drop(s, t, 1);
  drop(s, t, 2);
  assert(phase(s) === "answer" && !tick(s, t), "no early advance with nobody online");
  t.advance(ANSWER_MS);
  tick(s, t);
  assert(phase(s) === "review", "timer still advances");
  assert(!tick(s, t), "review waits");
  t.advance(REVIEW_MS);
  tick(s, t);
  assert(phase(s) === "results", "results");
}
{
  // Too few players between rounds: hold on, then resume when someone returns.
  const { t, s, ends } = start(3);
  fillAll(s, t, 0, "ox");
  t.advance(ANSWER_MS);
  tick(s, t);
  t.advance(REVIEW_MS);
  tick(s, t);
  drop(s, t, 1);
  drop(s, t, 2);
  t.advance(RESULTS_MS);
  tick(s, t);
  assert(phase(s) === "results" && s.waiting && s.endsAt === t.ctx.now() + REJOIN_MS, "waiting for players");
  assert(view(s, t, 0).waiting && view(s, t, 0).phaseMs === REJOIN_MS, "view says so");
  assert(!tick(s, t), "nothing yet");
  t.ctx.players[2].connected = true; // reconnect noticed by tick even without playerReturned
  assert(tick(s, t) === true && phase(s) === "answer" && round(s) === 1 && !s.waiting, "resumes");
  assert(ends() === 0, "not ended");
}
{
  // ...or call it when nobody comes back.
  const { t, s, ends } = start(3);
  fillAll(s, t, 1, "ox");
  t.advance(ANSWER_MS);
  tick(s, t);
  t.advance(REVIEW_MS);
  tick(s, t);
  drop(s, t, 0);
  drop(s, t, 2);
  t.advance(RESULTS_MS);
  tick(s, t);
  assert(s.waiting, "waiting");
  t.advance(REJOIN_MS);
  tick(s, t);
  assert(phase(s) === "final" && s.endedEarly && ends() === 1, "ended early");
  assert(JSON.stringify(t.result?.winners) === JSON.stringify([t.ids[1]]), "leader wins");
  assert(/shortened/.test(t.result!.headline), `early headline: ${t.result!.headline}`);
  assert(view(s, t, 1).endedEarly && view(s, t, 1).history?.length === 1, "final view after one round");
  checkViews(s, t);
}
{
  // playerReturned during the hold restarts immediately.
  const { t, s } = start(2);
  t.advance(ANSWER_MS);
  tick(s, t);
  t.advance(REVIEW_MS);
  tick(s, t);
  drop(s, t, 1);
  t.advance(RESULTS_MS);
  tick(s, t);
  assert(s.waiting, "2p: waiting for the other");
  back(s, t, 1);
  assert(phase(s) === "answer" && round(s) === 1, "resumed on return");
}

// ---------- ties, nobody scoring, min and max players ----------
{
  // Two players, identical answers every round: shared points, tie.
  const { t, s, ends } = start(2, 7);
  for (let r = 0; r < ROUNDS; r++) {
    for (const who of [0, 1]) fillAll(s, t, who, "ee");
    act(s, t, 0, { type: "done" });
    act(s, t, 1, { type: "done" });
    assert(phase(s) === "review", "both done");
    act(s, t, 0, { type: "ready" });
    act(s, t, 1, { type: "ready" });
    assert(phase(s) === "results", "both ready");
    t.advance(RESULTS_MS);
    tick(s, t);
  }
  assert(phase(s) === "final" && ends() === 1, "2-player game over");
  assert(JSON.stringify(s.scores) === "[90,90]", `30 per round each: ${s.scores}`);
  assert(t.result!.winners.length === 2, "tie: both win");
  assert(/tie/.test(t.result!.headline), `tie headline: ${t.result!.headline}`);
  assert(s.awards.some((a) => a.title === "Great minds" && a.players.length === 2), "great minds shared");
}
{
  const { t, s, ends } = start(3);
  runOut(s, t);
  assert(ends() === 1 && t.result!.winners.length === 0, "nobody scored: no winners");
  assert(/Nobody scored/.test(t.result!.headline), "nobody headline");
  assert(s.awards.length === 0, "no awards for nothing");
}
{
  // Close finish headline.
  const { t, s } = start(2, 3);
  act(s, t, 0, { type: "answer", i: 0, text: word(s, "ingo") });
  runOut(s, t);
  assert(/edges out/.test(t.result!.headline), `close-call headline: ${t.result!.headline}`);
}
{
  // Twelve players: everyone gives the same answer in category 0, p11 adds a unique one.
  const { t, s, ends } = start(12, 99);
  for (let k = 0; k < 12; k++) act(s, t, k, { type: "answer", i: 0, text: word(s, "ubble") });
  act(s, t, 11, { type: "answer", i: 1, text: word(s, "anjo") });
  for (let k = 0; k < 12; k++) act(s, t, k, { type: "done" });
  assert(phase(s) === "review", "12 done -> review");
  const v = view(s, t, 3);
  assert(v.board![0].every((c) => c.status === "shared" && c.same.length === 11), "12-way duplicate");
  for (let k = 0; k < 12; k++) act(s, t, k, { type: "ready" });
  assert(phase(s) === "results", "12 ready -> results");
  assert(s.scores[11] === 15 && s.scores[0] === 5, `12p scores ${s.scores}`);
  checkViews(s, t);
  runOut(s, t);
  assert(ends() === 1 && JSON.stringify(t.result!.winners) === JSON.stringify([t.ids[11]]), "p11 wins");
  assert(/edges out the pack by 10 points/.test(t.result!.headline), `tied runners-up: ${t.result!.headline}`);
  assert(view(s, t, 0).history!.length === 3, "three rounds in history");
}

console.log("letters: all tests passed");
