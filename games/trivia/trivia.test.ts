import { assert, makeTestCtx } from "../../shared/testing";
import type { GameResult } from "../../shared/types";
import game, { MEMORY_CAP, questionKey, teamScores, type Phase, type TriviaState, type TriviaView } from "./server";
import { QUESTIONS } from "./data";
import {
  ABANDON_MS,
  CATEGORIES,
  DIFFICULTIES,
  INTRO_MS,
  QUESTION_MS,
  REVEAL_MS,
  TOTAL_QUESTIONS,
  speedPoints,
  streakBonus,
} from "./shared";

type Harness = ReturnType<typeof makeTestCtx>;

/** A fresh game plus helpers; also counts ctx.end calls. */
function start(n: number, seed = 42) {
  const t: Harness = makeTestCtx(n, seed);
  const ends: GameResult[] = [];
  const realEnd = t.ctx.end;
  t.ctx.end = (r) => {
    ends.push(r);
    realEnd(r);
  };
  const s: TriviaState = game.setup(t.ctx);
  const g = {
    t,
    s,
    ends,
    phase: (): Phase => s.phase,
    endCount: () => ends.length,
    view: (id: string) => game.view(s, id, t.ctx) as TriviaView,
    act: (id: string, a: unknown) => game.action(s, id, a, t.ctx),
    tick: () => game.tick!(s, t.ctx),
    wait(ms: number) {
      t.advance(ms);
      return game.tick!(s, t.ctx);
    },
    answer(id: string, correct: boolean) {
      const right = s.qs[s.round].answer;
      return game.action(s, id, { type: "answer", choice: correct ? right : (right + 1) % 4, q: s.round + 1 }, t.ctx);
    },
    leave(id: string) {
      t.ctx.player(id)!.connected = false;
      game.playerLeft!(s, id, t.ctx);
    },
    back(id: string) {
      t.ctx.player(id)!.connected = true;
      game.playerReturned!(s, id, t.ctx);
    },
    /** Let the current phase's timer run out. */
    expire() {
      t.advance(Math.max(0, s.endsAt - t.ctx.now()));
      return game.tick!(s, t.ctx);
    },
  };
  return g;
}

/** Every value must survive JSON unchanged: no undefined, NaN, Map, Set, functions. */
function assertPlain(v: unknown, path = "view"): void {
  if (v === null || typeof v === "string" || typeof v === "boolean") return;
  if (typeof v === "number") return assert(Number.isFinite(v), `${path} is not finite`);
  if (Array.isArray(v)) return v.forEach((x, i) => assertPlain(x, `${path}[${i}]`));
  assert(typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype, `${path} is not a plain object`);
  for (const [k, x] of Object.entries(v as object)) {
    assert(x !== undefined, `${path}.${k} is undefined`);
    assertPlain(x, `${path}.${k}`);
  }
}

const noThrow = <T>(fn: () => T, label: string): T => {
  try {
    return fn();
  } catch (e) {
    throw new Error(`${label} threw: ${String(e)}`);
  }
};

// ── Question bank ──
{
  assert(QUESTIONS.length >= 150, `need >= 150 questions, have ${QUESTIONS.length}`);
  const texts = new Set<string>();
  for (const q of QUESTIONS) {
    assert(q.q.trim() === q.q && q.q.length >= 10 && q.q.length <= 120, `question length: ${q.q}`);
    assert(!texts.has(q.q.toLowerCase()), `duplicate question: ${q.q}`);
    texts.add(q.q.toLowerCase());
    assert(q.choices.length === 4, `4 choices: ${q.q}`);
    const lower = q.choices.map((c) => c.trim().toLowerCase());
    assert(new Set(lower).size === 4, `choices must be distinct: ${q.q}`);
    for (const c of q.choices) {
      assert(c.trim() === c && c.length >= 1 && c.length <= 40, `choice length "${c}" in ${q.q}`);
      assert(!/(all|none) of the above/i.test(c), `no "of the above" choices: ${q.q}`);
    }
    assert(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3, `answer index: ${q.q}`);
    assert((CATEGORIES as readonly string[]).includes(q.cat), `category: ${q.q}`);
    assert((DIFFICULTIES as readonly string[]).includes(q.diff), `difficulty: ${q.q}`);
  }
  const counts = CATEGORIES.map((c) => QUESTIONS.filter((q) => q.cat === c).length);
  assert(Math.min(...counts) >= 12, "every category has at least 12 questions");
  assert(Math.max(...counts) - Math.min(...counts) <= 3, "categories are spread evenly");
  for (const c of CATEGORIES) {
    for (const d of DIFFICULTIES) {
      const n = QUESTIONS.filter((q) => q.cat === c && q.diff === d).length;
      assert(n >= 3, `${c} needs >= 3 ${d} questions (has ${n})`);
    }
  }
}

// ── Scoring helpers ──
{
  assert(speedPoints(0) === 1000, "instant answer = 1000");
  assert(speedPoints(7500) === 750, "half time = 750");
  assert(speedPoints(QUESTION_MS) === 500, "buzzer = 500");
  assert(speedPoints(3600) === 880, "3.6s = 500 + round(500 * 0.76)");
  assert(speedPoints(-50) === 1000 && speedPoints(99_999) === 500, "clamped");
  assert([1, 2, 3, 4, 9].map(streakBonus).join() === "0,100,200,300,300", "streak bonus ramps and caps at 300");
}

// ── Question selection: 10 distinct questions, >= 6 categories, shuffled choices, difficulty ramp ──
{
  const positions = [0, 0, 0, 0];
  for (let seed = 1; seed <= 300; seed++) {
    const { s } = start(2, seed);
    assert(s.qs.length === TOTAL_QUESTIONS, "10 questions");
    assert(new Set(s.qs.map((p) => p.id)).size === TOTAL_QUESTIONS, "no repeats");
    const cats = new Set(s.qs.map((p) => QUESTIONS[p.id].cat));
    assert(cats.size >= 6, "at least 6 categories");
    assert(cats.size === TOTAL_QUESTIONS, "one question per category");
    for (const p of s.qs) {
      const src = QUESTIONS[p.id];
      assert(p.order.slice().sort().join() === "0,1,2,3", "order is a permutation");
      assert(src.choices[p.order[p.answer]] === src.choices[src.answer], "answer tracks the shuffle");
      positions[p.answer]++;
    }
    assert(QUESTIONS[s.qs[0].id].diff === "easy" && QUESTIONS[s.qs[9].id].diff === "hard", "easy start, hard finish");
  }
  const total = positions.reduce((a, b) => a + b, 0);
  assert(positions.every((n) => n / total > 0.18), `correct answer lands everywhere: ${positions}`);
  const a = start(2, 7).s.qs.map((p) => p.id).join();
  const b = start(2, 8).s.qs.map((p) => p.id).join();
  assert(a !== b, "different games get different questions");
}

// ── Full 3-player game: phases, scoring, streaks, ranks, a single ctx.end ──
{
  const g = start(3);
  const { s, t } = g;
  assert(g.phase() === "intro" && g.view("p0").question === null, "starts with intro, no question yet");
  assert(!g.tick(), "nothing changes mid-intro");
  assert(g.wait(INTRO_MS - 1) === false && g.phase() === "intro", "intro lasts 3s");
  assert(g.wait(1) === true && g.phase() === "question", "intro -> question");
  for (let r = 0; r < TOTAL_QUESTIONS; r++) {
    assert(g.phase() === "question" && s.round === r, `question ${r + 1} open`);
    const v0 = g.view("p0");
    assert(v0.qNum === r + 1 && v0.total === 10 && v0.question?.choices.length === 4, "question view");
    assert(v0.endsAt - t.ctx.now() === QUESTION_MS && v0.phaseMs === QUESTION_MS, "15 second timer");
    t.advance(1500);
    assert(g.answer("p0", true) === true, "p0 locks in");
    t.advance(1500);
    assert(g.answer("p1", r % 2 === 0) === true, "p1 locks in");
    assert(g.phase() === "question", "still waiting for p2");
    assert(g.wait(QUESTION_MS - 3001) === false && g.phase() === "question", "question runs its full 15s");
    assert(g.wait(1) === true && g.phase() === "reveal", "question -> reveal on timeout");
    const rv = g.view("p2");
    assert(rv.answer === s.qs[r].answer, "reveal shows the answer");
    const [o0, o1, o2] = rv.players.map((p) => p.outcome!);
    assert(o0.correct && o0.ms === 1500 && o0.streak === r + 1, "p0 correct with growing streak");
    assert(o0.points === 950 + streakBonus(r + 1) && o0.bonus === streakBonus(r + 1), "p0 points = speed + streak bonus");
    assert(o1.correct === (r % 2 === 0) && o1.points === (r % 2 === 0 ? 900 : 0), "p1 alternates");
    assert(o1.streak === (r % 2 === 0 ? 1 : 0), "wrong answer resets the streak");
    assert(o1.lost === (r % 2 === 1 ? 1 : 0) && o0.lost === 0 && o2.lost === 0, "broken streak length reported");
    assert(o2.choice === null && !o2.correct && o2.points === 0 && o2.ms === null, "no answer = no points");
    assert(rv.players[0].rank === 1 && rv.players[2].rank === 3, "ranks");
    if (r === 0) assert(rv.players.every((p) => p.prevRank === 1), "everyone started tied");
    assert(g.wait(REVEAL_MS - 1) === false && g.phase() === "reveal", "reveal lasts 5s");
    g.wait(1);
  }
  assert(g.phase() === "final", "final after question 10's reveal");
  assert(g.endCount() === 1, "ctx.end called exactly once");
  const p0 = 10 * 950 + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].reduce((a, k) => a + streakBonus(k), 0);
  assert(p0 === 11_900, "expected p0 total");
  const res = t.result!;
  assert(res.winners.join() === "p0", "p0 wins");
  assert(res.scores?.p0 === 11_900 && res.scores?.p1 === 4_500 && res.scores?.p2 === 0, `scores ${JSON.stringify(res.scores)}`);
  assert(res.headline.includes("Player0") && res.headline.includes("11,900"), res.headline);
  const fv = g.view("p1");
  assert(fv.recap?.length === 10 && fv.asked === 10, "recap of all 10 questions");
  assert(fv.recap.every((q) => q.correct.includes("p0") && !q.correct.includes("p2")), "recap lists who got each right");
  const [f0, f1, f2] = fv.players;
  assert(f0.correct === 10 && f0.fastestMs === 1500 && f0.bestStreak === 10, "p0 final stats");
  assert(f1.correct === 5 && f1.fastestMs === 3000 && f1.bestStreak === 1, "p1 final stats");
  assert(f2.correct === 0 && f2.fastestMs === null, "p2 final stats");
  assert(fv.question === null && fv.answer === null, "final has no live question");
  // After the end nothing moves.
  assert(g.act("p0", { type: "answer", choice: 0, q: 10 }) === false, "actions ignored after end");
  assert(!g.wait(60_000) && g.phase() === "final", "tick idle after end");
  g.leave("p1");
  g.back("p1");
  assert(g.endCount() === 1, "still one ctx.end");
  assertPlain(fv);
}

// ── Early advance when every connected player has answered ──
{
  const g = start(3);
  g.wait(INTRO_MS);
  g.answer("p0", true);
  g.answer("p1", false);
  assert(g.phase() === "question", "waits for p2");
  assert(g.answer("p2", true) === true && g.phase() === "reveal", "last answer reveals immediately");
  assert(g.s.endsAt === g.t.ctx.now() + REVEAL_MS, "reveal timer starts now");
  // A disconnected player is not waited for.
  g.expire();
  g.leave("p2");
  g.answer("p0", true);
  assert(g.answer("p1", true) && g.phase() === "reveal", "skips disconnected p2");
  // The last holdout leaving also triggers the reveal.
  g.back("p2");
  g.expire();
  g.answer("p0", true);
  g.answer("p2", true);
  assert(g.phase() === "question", "waiting on p1");
  g.leave("p1");
  assert(g.phase() === "reveal", "p1 leaving reveals right away");
}

// ── Hostile and invalid actions never throw and never change state ──
{
  const g = start(2);
  const valid = () => ({ type: "answer", choice: 1, q: g.s.round + 1 });
  assert(g.act("p0", valid()) === false, "no answers during the intro");
  g.wait(INTRO_MS);
  const huge = "x".repeat(1_000_000);
  const bad: unknown[] = [
    null, undefined, "answer", 42, true, [], [1], {}, { type: "nope" }, { type: "ANSWER", choice: 1, q: 1 },
    { type: "answer" }, { type: "answer", choice: 1 }, { type: "answer", q: 1 },
    { type: "answer", choice: -1, q: 1 }, { type: "answer", choice: 4, q: 1 }, { type: "answer", choice: 1.5, q: 1 },
    { type: "answer", choice: "1", q: 1 }, { type: "answer", choice: NaN, q: 1 }, { type: "answer", choice: Infinity, q: 1 },
    { type: "answer", choice: null, q: 1 }, { type: "answer", choice: [1], q: 1 }, { type: "answer", choice: { n: 1 }, q: 1 },
    { type: "answer", choice: 1, q: 0 }, { type: "answer", choice: 1, q: 2 }, { type: "answer", choice: 1, q: "1" },
    { type: "answer", choice: 1, q: 1.000001 }, { type: "answer", choice: 1, q: null },
    { type: huge, choice: 1, q: 1 }, { type: "answer", choice: new Array(100_000).fill(1), q: 1 },
    [{ type: "answer", choice: 1, q: 1 }],
  ];
  const before = JSON.stringify(g.s);
  for (const a of bad) {
    assert(noThrow(() => g.act("p0", a), `action ${String(JSON.stringify(a)).slice(0, 60)}`) === false, `rejects ${String(JSON.stringify(a)).slice(0, 60)}`);
  }
  assert(g.act("stranger", valid()) === false && g.act("spectator", valid()) === false, "non-participants rejected");
  assert(JSON.stringify(g.s) === before, "state untouched by bad actions");
  // Extra fields (even __proto__ from JSON) are ignored; prototype is not polluted.
  const sneaky = JSON.parse(`{"type":"answer","choice":2,"q":1,"__proto__":{"polluted":true}}`);
  assert(g.act("p0", sneaky) === true, "valid answer with junk fields accepted");
  assert(({} as Record<string, unknown>).polluted === undefined, "no prototype pollution");
  assert(g.view("p0").myChoice === 2, "choice recorded");
  assert(g.act("p0", { type: "answer", choice: 3, q: 1 }) === false, "cannot change an answer");
  assert(g.view("p0").myChoice === 2, "answer unchanged");
  // Late answers (deadline passed, tick not yet run) are refused.
  g.t.advance(QUESTION_MS);
  assert(g.act("p1", valid()) === false, "late answer rejected");
  g.tick();
  assert(g.phase() === "reveal", "revealed");
  assert(g.act("p1", { type: "answer", choice: 1, q: 1 }) === false, "no answers during reveal");
  g.expire();
  assert(g.act("p1", { type: "answer", choice: 1, q: 1 }) === false, "stale question number rejected");
  assert(g.act("p1", { type: "answer", choice: 1, q: 3 }) === false, "future question number rejected");
  assert(g.act("p1", { type: "answer", choice: 0, q: 2 }) === true, "current question accepted");
}

// ── Secrecy: no answer or other players' picks before the reveal ──
{
  const g = start(3);
  const { s } = g;
  const intro = JSON.stringify(g.view("p0"));
  for (const p of s.qs) assert(!intro.includes(QUESTIONS[p.id].q), "intro leaks no question text");
  g.wait(INTRO_MS);
  const right = s.qs[0].answer;
  g.act("p0", { type: "answer", choice: right, q: 1 });
  for (const id of ["p1", "p2", "spectator"]) {
    const v = g.view(id);
    assert(v.myChoice === null && v.answer === null, `${id} sees no choice or answer`);
    assert(v.players[0].answered && !v.players[1].answered, `${id} sees who locked in`);
    assert(v.players.every((p) => p.outcome === null), `${id} sees no outcomes`);
    const json = JSON.stringify(v);
    assert(!json.includes('"choice"'), `${id} view has no choices of others`);
    for (const p of s.qs.slice(1)) assert(!json.includes(QUESTIONS[p.id].q), "no upcoming question text");
  }
  assert(g.view("spectator").you === false && g.view("p0").you === true, "spectator flagged");
  assert(g.view("p0").myChoice === right, "you see your own pick");
  // The views must not depend on the secret at all: change the answer key and p0's pick, compare.
  const snapshot = ["p0", "p1", "spectator"].map((id) => JSON.stringify(g.view(id)));
  s.qs[0].answer = (right + 1) % 4;
  assert(JSON.stringify(g.view("p1")) === snapshot[1], "p1 view independent of the answer key");
  assert(JSON.stringify(g.view("spectator")) === snapshot[2], "spectator view independent of the answer key");
  assert(JSON.stringify(g.view("p0")) === snapshot[0], "p0 view independent of the answer key");
  s.qs[0].answer = right;
  s.answers[0] = { choice: (right + 2) % 4, ms: s.answers[0]!.ms };
  assert(JSON.stringify(g.view("p1")) === snapshot[1], "p1 view independent of p0's pick");
  s.answers[0] = { choice: right, ms: s.answers[0]!.ms };
  g.answer("p1", false);
  g.answer("p2", true);
  const rv = g.view("spectator");
  assert(rv.phase === "reveal" && rv.answer === right, "reveal shows the answer to spectators");
  assert(rv.players[1].outcome?.choice === (right + 1) % 4, "reveal shows who picked what");
  for (const id of ["p0", "p1", "p2", "spectator"]) assertPlain(g.view(id));
}

// ── Disconnects and reconnects in every phase; the game never stalls ──
{
  const g = start(3);
  const { s } = g;
  g.leave("p1"); // intro
  g.wait(INTRO_MS);
  assert(g.phase() === "question", "intro advances with someone away");
  g.back("p1"); // question
  assert(g.answer("p1", true), "returning player can answer");
  g.leave("p2");
  assert(g.answer("p0", true) && g.phase() === "reveal", "question resolves without p2");
  g.leave("p0"); // reveal
  g.expire();
  assert(g.phase() === "question" && s.round === 1, "reveal advances with players away");
  g.back("p0");
  g.back("p2");
  g.expire(); // nobody answers: timer resolves it
  assert(g.phase() === "reveal", "timer resolves an unanswered question");
  // Everyone gone: timers keep running, then the game ends gracefully.
  for (const id of g.t.ids) g.leave(id);
  g.tick();
  g.wait(ABANDON_MS - 1000);
  assert(g.phase() !== "final" && g.endCount() === 0, "not ended yet");
  g.back("p0"); // a quick refresh resets the countdown
  g.tick();
  g.leave("p0");
  g.wait(ABANDON_MS - 1000);
  assert(g.phase() !== "final", "countdown restarted after the refresh");
  g.wait(1000);
  assert(g.phase() === "final" && g.endCount() === 1, "ends after everyone is gone for 30s");
  assert(g.t.result!.headline.startsWith("Everyone left"), g.t.result!.headline);
  assert(g.t.result!.winners.join() === "p0,p1", "leaders still win");
  g.back("p0"); // final
  assert(!g.tick() && g.endCount() === 1, "reconnecting after the end is harmless");
}

// ── A game where everyone answers keeps flowing; tie for the win ──
{
  const g = start(2);
  g.wait(INTRO_MS);
  while (g.phase() !== "final") {
    if (g.phase() === "question") {
      g.t.advance(2000);
      g.answer("p0", true);
      g.answer("p1", true);
      assert(g.phase() === "reveal", "both in -> reveal");
    }
    g.expire();
  }
  const r = g.t.result!;
  assert(r.winners.length === 2 && r.scores?.p0 === r.scores?.p1, "tied winners");
  assert(r.headline.includes("tie") && r.headline.includes("Player0 and Player1"), r.headline);
}

// ── Nobody scores: no winners ──
{
  const g = start(2);
  let guard = 0;
  while (g.phase() !== "final" && guard++ < 100) g.expire();
  assert(g.endCount() === 1 && g.t.result!.winners.length === 0, "no winners when all score 0");
  assert(g.t.result!.headline.startsWith("Nobody scored"), g.t.result!.headline);
}

// ── Solo play (min players) ──
{
  const g = start(1);
  g.wait(INTRO_MS);
  let n = 0;
  while (g.phase() !== "final") {
    if (g.phase() === "question") {
      g.t.advance(4000);
      assert(g.answer("p0", n++ % 3 !== 2), "solo answer");
      assert(g.phase() === "reveal", "solo answer reveals at once");
    }
    g.expire();
  }
  const r = g.t.result!;
  assert(r.winners.join() === "p0", "solo player with points is the winner");
  assert(r.headline.includes("7/10 correct"), r.headline);
  assert(g.view("p0").players[0].correct === 7, "7 right");
}

// ── Max players (12) ──
{
  const g = start(12, 99);
  g.wait(INTRO_MS);
  let rounds = 0;
  while (g.phase() !== "final") {
    if (g.phase() === "question") {
      rounds++;
      g.t.ids.forEach((id, i) => {
        g.t.advance(100);
        g.answer(id, (i + rounds) % 3 !== 0);
      });
      assert(g.phase() === "reveal", "all 12 in -> reveal");
      const v = g.view("p5");
      assert(JSON.stringify(v).length < 12_000, "view stays small");
      const sorted = v.players.slice().sort((a, b) => a.rank - b.rank);
      for (let i = 1; i < sorted.length; i++) assert(sorted[i - 1].score >= sorted[i].score, "ranks follow scores");
    }
    g.expire();
  }
  assert(rounds === 10 && g.endCount() === 1, "12-player game completes");
  assertPlain(g.view("p11"));
}

// ── Tie headlines for 3 and 4+ winners ──
for (const n of [3, 4]) {
  const g = start(n, 5);
  g.wait(INTRO_MS);
  while (g.phase() !== "final") {
    if (g.phase() === "question") {
      g.t.advance(1200);
      for (const id of g.t.ids) g.answer(id, true);
    }
    g.expire();
  }
  const r = g.t.result!;
  assert(r.winners.length === n, `${n}-way tie`);
  if (n === 3) assert(r.headline.startsWith("Player0, Player1 and Player2 tie for the win"), r.headline);
  else assert(r.headline.startsWith("4-way tie for the win"), r.headline);
}

// ── Everyone leaves before scoring: graceful end, no winners ──
{
  const g = start(2);
  g.leave("p0");
  g.leave("p1");
  let guard = 0;
  while (g.phase() !== "final" && guard++ < 1000) g.wait(1000);
  assert(g.endCount() === 1 && g.t.result!.winners.length === 0, "abandoned game ends once with no winners");
  assert(g.t.result!.headline === "Trivia Rush ended: everyone left", g.t.result!.headline);
  assert(guard * 1000 <= ABANDON_MS + 2000, "ends promptly once abandoned");
}

// ── Degenerate: no participants at all never throws and still ends ──
{
  const g = start(0);
  noThrow(() => g.view("spectator"), "view with no players");
  let guard = 0;
  while (g.phase() !== "final" && guard++ < 200) noThrow(() => g.wait(1000), "tick with no players");
  assert(g.endCount() === 1 && g.t.result!.winners.length === 0, "empty game ends");
}

console.log("trivia: all tests passed");

// ---------- host settings and bots ----------

/** Run a game the way the room does: tick, then let each bot act. */
function runWithBots(t: Harness, s: TriviaState, stepMs = 200, limitMs = 30 * 60_000) {
  for (let elapsed = 0; !t.result && elapsed < limitMs; elapsed += stepMs) {
    t.advance(stepMs);
    game.tick!(s, t.ctx);
    for (const id of t.ids) {
      if (!t.ctx.player(id)?.bot) continue;
      const a = game.bot!(s, id, t.ctx);
      if (a != null) game.action(s, id, a, t.ctx);
    }
  }
}
{
  // Defaults unchanged.
  const t = makeTestCtx(2, 3);
  const s: TriviaState = game.setup(t.ctx);
  assert(s.qs.length === TOTAL_QUESTIONS && s.questionMs === QUESTION_MS, "defaults");
  const v = game.view(s, t.ids[0], t.ctx) as TriviaView;
  assert(v.questionMs === QUESTION_MS && v.total === 10, "view defaults");
}
{
  // 5 questions, 10 seconds each: the game is shorter and the clock and speed points follow.
  const t = makeTestCtx(2, 4, { questions: 5, seconds: 10 });
  const s: TriviaState = game.setup(t.ctx);
  assert(s.qs.length === 5 && new Set(s.qs.map((p) => QUESTIONS[p.id].cat)).size === 5, "5 questions, 5 categories");
  assert(QUESTIONS[s.qs[0].id].diff === "easy" && QUESTIONS[s.qs[4].id].diff === "hard", "ramp squeezed to 5");
  t.advance(INTRO_MS);
  game.tick!(s, t.ctx);
  assert(s.phase === "question" && s.endsAt - t.ctx.now() === 10_000, "10s question");
  assert((game.view(s, t.ids[0], t.ctx) as TriviaView).phaseMs === 10_000, "timer bar length");
  t.advance(5_000);
  game.action(s, t.ids[0], { type: "answer", choice: s.qs[0].answer, q: 1 }, t.ctx);
  game.action(s, t.ids[1], { type: "answer", choice: (s.qs[0].answer + 1) % 4, q: 1 }, t.ctx);
  assert(s.stats[0].score === 750, "half of 10s = 750");
  let guard = 0;
  while (!t.result && guard++ < 500) {
    t.advance(1000);
    game.tick!(s, t.ctx);
  }
  assert(t.result !== null && s.history.length === 5, "ends after 5");
  const u = makeTestCtx(2, 4, { questions: 12, seconds: "fast" });
  const s2: TriviaState = game.setup(u.ctx);
  assert(s2.qs.length === 10 && s2.questionMs === QUESTION_MS, "invalid settings fall back");
  const w = makeTestCtx(1, 4, { questions: 15 });
  assert((game.setup(w.ctx) as TriviaState).qs.length === 15, "15 questions");
}
{
  // All bots: the game finishes, bots answer in time with human-ish delays and score something.
  const t = makeTestCtx(4, 11, {}, 4);
  const s: TriviaState = game.setup(t.ctx);
  runWithBots(t, s);
  assert(t.result !== null && s.history.length === 10, "all-bot game ends");
  const total = s.stats.reduce((a, st) => a + st.correct, 0);
  assert(total > 10 && total < 40, `bots are good but not perfect (${total}/40)`);
  assert(s.stats.every((st) => st.fastestMs === null || st.fastestMs >= 2_500), "no instant answers");
}
{
  // One human (who never answers) plus bots, 5 short questions: still ends.
  const t = makeTestCtx(3, 12, { questions: 5, seconds: 10 }, 2);
  const s: TriviaState = game.setup(t.ctx);
  runWithBots(t, s);
  assert(t.result !== null && s.history.length === 5, "human + bots game ends");
  assert(s.stats[1].correct + s.stats[2].correct > 0 && s.stats[0].correct === 0, "bots answered, the idle human didn't");
  assert(game.bot!(s, "bot-0", t.ctx) == null, "bot is quiet once the game is over");
}

console.log("trivia: settings and bot tests passed");

// ---------- room memory: no repeats until the bank runs out ----------

/** Play a whole game (nobody answers), so every picked question gets asked. */
function playThrough(t: Harness, s: TriviaState) {
  for (let i = 0; !t.result && i < 200; i++) {
    t.advance(Math.max(1, s.endsAt - t.ctx.now()));
    game.tick!(s, t.ctx);
  }
  assert(t.result !== null, "game finished");
}
{
  const memory: Record<string, unknown> = {};
  const keys = QUESTIONS.map((q) => questionKey(q.q));
  const distinct = new Set(keys).size;
  const seen = new Set<string>();
  let asked = 0;
  let games = 0;
  const started = Date.now();
  // Play games of 15 until the whole bank has been asked: no question may come back before then.
  while (seen.size < distinct) {
    const t = makeTestCtx(2, 1000 + games, { questions: 15 }, 0, memory);
    const s: TriviaState = game.setup(t.ctx);
    const fresh = s.qs.filter((p) => !seen.has(keys[p.id])).length;
    const left = distinct - seen.size;
    assert(fresh === Math.min(s.qs.length, left), `game ${games}: ${s.qs.length - fresh} repeats with ${left} unseen left`);
    for (const p of s.qs) assert(p.order.length === 4 && p.order[p.answer] === QUESTIONS[p.id].answer, "choices still shuffled");
    playThrough(t, s);
    for (const p of s.qs) seen.add(keys[p.id]);
    asked += s.qs.length;
    games++;
    assert(games < 500, "bank exhausted in a sane number of games");
  }
  assert(asked < distinct + 15, `no repeats before the bank ran out (${asked} asked for ${distinct})`);
  const list = memory.seen as string[];
  assert(Array.isArray(list) && list.length === Math.min(distinct, MEMORY_CAP), "memory holds every asked key");
  const bytes = JSON.stringify(memory).length;
  assert(bytes < 20_000, `memory stays small (${bytes} bytes)`);

  // Bank exhausted: the next game recycles the least recently asked questions first.
  const oldest = new Set(list.slice(0, Math.ceil(list.length / 3)));
  const t = makeTestCtx(2, 7, {}, 0, memory);
  const s: TriviaState = game.setup(t.ctx);
  assert(s.qs.length === TOTAL_QUESTIONS && new Set(s.qs.map((p) => p.id)).size === TOTAL_QUESTIONS, "recycled game is full");
  assert(new Set(s.qs.map((p) => QUESTIONS[p.id].cat)).size === TOTAL_QUESTIONS, "recycled game keeps one per category");
  assert(s.qs.every((p) => oldest.has(keys[p.id])), "recycles the least recently asked");
  playThrough(t, s);
  const newest = (memory.seen as string[]).slice(-TOTAL_QUESTIONS);
  assert(s.qs.every((p) => newest.includes(keys[p.id])), "recycled questions move to the newest end");

  // Selection stays fast even against a full memory.
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) game.setup(makeTestCtx(4, i, {}, 0, memory).ctx);
  const per = (Date.now() - t0) / 200;
  assert(per < 5, `setup takes ${per.toFixed(2)} ms`);
  console.log(
    `trivia: memory ok (${distinct} questions in ${games} games, ${bytes} bytes, ${Date.now() - started} ms, setup ${per.toFixed(2)} ms)`,
  );
}
{
  // Plenty left unseen: a fresh room still gets one question per category and the difficulty ramp.
  const memory: Record<string, unknown> = {};
  for (let i = 0; i < 5; i++) {
    const t = makeTestCtx(2, 50 + i, {}, 0, memory);
    const s: TriviaState = game.setup(t.ctx);
    assert(new Set(s.qs.map((p) => QUESTIONS[p.id].cat)).size === TOTAL_QUESTIONS, "category spread with memory");
    assert(QUESTIONS[s.qs[0].id].diff === "easy" && QUESTIONS[s.qs[9].id].diff === "hard", "ramp with memory");
    playThrough(t, s);
  }
}
{
  // Junk in memory is ignored; the list never grows past the cap.
  const memory: Record<string, unknown> = { seen: [1, null, "zzz", { a: 1 }] };
  const t = makeTestCtx(2, 3, {}, 0, memory);
  const s: TriviaState = game.setup(t.ctx);
  assert(s.qs.length === TOTAL_QUESTIONS, "junk memory still gives a full game");
  playThrough(t, s);
  assert((memory.seen as string[]).length === TOTAL_QUESTIONS, "junk dropped, asked kept");
  const big: Record<string, unknown> = {
    seen: Array.from({ length: MEMORY_CAP + 50 }, (_, i) => questionKey(QUESTIONS[i % QUESTIONS.length].q)),
  };
  const u = makeTestCtx(2, 4, {}, 0, big);
  const s2: TriviaState = game.setup(u.ctx);
  playThrough(u, s2);
  assert((big.seen as string[]).length <= MEMORY_CAP, "memory capped");
}

// ---------- Red vs Blue ----------
{
  assert(game.setup(makeTestCtx(4, 1).ctx).teams === null, "solo by default");
  assert(game.setup(makeTestCtx(1, 1, { mode: "teams" }).ctx).teams === null, "1 player: no teams");
  for (const n of [2, 3, 4, 5, 8]) {
    const t = makeTestCtx(n, n, { mode: "teams" });
    const s: TriviaState = game.setup(t.ctx);
    assert(s.teams !== null, `${n}: teams`);
    const [a, b] = s.teams;
    assert(a.length - b.length >= 0 && a.length - b.length <= 1, `${n}: even split`);
    assert(new Set([...a, ...b]).size === n, `${n}: everyone on exactly one team`);
    const v = game.view(s, t.ids[0], t.ctx) as TriviaView;
    assert(v.teams !== null && v.teams[0].ids.length === a.length && v.teams[0].score === 0, `${n}: view shows teams`);
    assertPlain(v);
  }
}
/** Open the next question and have each team answer right or wrong after 1s. */
function teamRound(t: Harness, s: TriviaState, redRight: boolean, blueRight: boolean) {
  t.advance(Math.max(0, s.endsAt - t.ctx.now()));
  game.tick!(s, t.ctx);
  assert(s.phase === "question", "question open");
  t.advance(1_000);
  const right = s.qs[s.round].answer;
  s.teams!.forEach((ids, team) => {
    const ok = team === 0 ? redRight : blueRight;
    for (const id of ids) game.action(s, id, { type: "answer", choice: ok ? right : (right + 1) % 4, q: s.round + 1 }, t.ctx);
  });
  assert((s.phase as Phase) === "reveal", "everyone in -> reveal");
}
{
  // 2 vs 2: team score = members' points added up; the whole winning team wins.
  const t = makeTestCtx(4, 9, { mode: "teams", questions: 5 });
  const s: TriviaState = game.setup(t.ctx);
  const [red, blue] = s.teams!;
  teamRound(t, s, true, false);
  let v = game.view(s, blue[0], t.ctx) as TriviaView;
  const per = speedPoints(1_000, s.questionMs);
  assert(v.teams![0].score === per * 2 && v.teams![0].gain === per * 2, "red total = both members");
  assert(v.teams![1].score === 0 && v.teams![1].gain === 0 && v.teams![1].rank === 2, "blue behind");
  teamRound(t, s, true, true);
  teamRound(t, s, false, true);
  teamRound(t, s, true, false);
  teamRound(t, s, false, false);
  v = game.view(s, red[0], t.ctx) as TriviaView;
  const sum = (ids: string[]) => ids.reduce((acc, id) => acc + s.stats[s.ids.indexOf(id)].score, 0);
  assert(v.teams![0].score === sum(red) && v.teams![1].score === sum(blue), "team score is the members' sum");
  t.advance(REVEAL_MS);
  game.tick!(s, t.ctx);
  assert(t.result !== null, "game over");
  assert(t.result.winners.length === red.length && red.every((id) => t.result!.winners.includes(id)), "whole red team wins");
  assert(/^Red team wins! [\d,]+ to [\d,]+$/.test(t.result.headline), `headline: ${t.result.headline}`);
  assert(Object.keys(t.result.scores!).length === 4, "per-player scores kept");
}
{
  // Uneven teams (2 vs 1): the smaller team's total is scaled up, so a lone player who
  // matches the pair answer for answer ties them.
  const t = makeTestCtx(3, 5, { mode: "teams", questions: 5 });
  const s: TriviaState = game.setup(t.ctx);
  assert(s.teams![0].length === 2 && s.teams![1].length === 1, "2 vs 1");
  for (let r = 0; r < 5; r++) teamRound(t, s, true, true);
  const v = game.view(s, t.ids[0], t.ctx) as TriviaView;
  assert(v.teams![0].score === v.teams![1].score, `scaled tie ${v.teams![0].score} vs ${v.teams![1].score}`);
  t.advance(REVEAL_MS);
  game.tick!(s, t.ctx);
  assert(t.result!.winners.length === 3 && t.result!.headline.startsWith("Red and Blue tie"), `tie: ${t.result!.headline}`);
}
{
  // Bots in team mode: a mixed game finishes and the winners are exactly the leading team.
  for (const seed of [1, 2, 3]) {
    const t = makeTestCtx(5, seed, { mode: "teams" }, 4);
    const s: TriviaState = game.setup(t.ctx);
    runWithBots(t, s);
    assert(t.result !== null && s.history.length === 10, "bot team game ends");
    const [a, b] = teamScores(s);
    const w = t.result.winners.slice().sort().join();
    if (a !== b) assert(w === s.teams![a > b ? 0 : 1].slice().sort().join(), "winners = leading team");
    assert(/team wins|tie/.test(t.result.headline), `team headline: ${t.result.headline}`);
    assertPlain(game.view(s, t.ids[0], t.ctx));
  }
  // Nobody scores: nobody wins.
  const t = makeTestCtx(4, 2, { mode: "teams", questions: 5 });
  const s: TriviaState = game.setup(t.ctx);
  playThrough(t, s);
  assert(t.result!.winners.length === 0, "0-0: no winners");
}

console.log("trivia: memory and team tests passed");
