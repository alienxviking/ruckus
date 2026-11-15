import { assert, makeTestCtx } from "../../shared/testing";
import game, { buildOrder, type BlitzAction, type BlitzState, type BlitzView } from "./server";
import { COUNT_SETS, FRUITS, NOT_A_SCRAMBLE, ODD_PAIRS, PAIR_POOLS, WORDS } from "./data";
import { exprValue, generate, majorityCounts, scramble } from "./puzzles";
import {
  CLOCK_SLACK_MS,
  COUNT_SHOW_MS,
  INTRO_MS,
  MEMO_LEAD_MS,
  MEMO_STEP_MS,
  MICRO_TYPES,
  PLAY_MS,
  READY_MS,
  RESULT_MS,
  ROUNDS,
  TAP_RATE,
  type MicroType,
  type Puzzle,
} from "./shared";

type T = ReturnType<typeof makeTestCtx>;

/** mulberry32, for generator sweeps outside a test ctx. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Count ctx.end calls (makeTestCtx keeps only the first result). */
function countEnds(t: T) {
  let n = 0;
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    n += 1;
    end(r);
  };
  return () => n;
}

const distinct = <V>(arr: V[]) => new Set(arr.map((v) => JSON.stringify(v))).size === arr.length;
const sortedLetters = (w: string) => w.split("").sort().join("");
/** Phase without TypeScript narrowing (it changes behind the compiler's back). */
const phaseOf = (s: BlitzState): string => s.phase;
const viewOf = (s: BlitzState, id: string, t: T) => game.view(s, id, t.ctx) as BlitzView;

/** Advance fake time to the end of the current phase and tick once. */
function step(s: BlitzState, t: T) {
  t.advance(Math.max(0, s.endsAt - t.ctx.now()));
  game.tick!(s, t.ctx);
}
/** Step until the given phase (and round, when given). */
function stepTo(s: BlitzState, t: T, phase: BlitzState["phase"], round?: number) {
  for (let i = 0; i < 200 && !(phaseOf(s) === phase && (round === undefined || s.round === round)); i++) step(s, t);
  assert(phaseOf(s) === phase, `reached ${phase}`);
}
/** Move into the answering window (after the count flash / memory show). */
function openAnswers(s: BlitzState, t: T) {
  if (t.ctx.now() < s.opensAt) t.advance(s.opensAt - t.ctx.now());
  game.tick!(s, t.ctx);
}

function rightAction(s: BlitzState, t: T): BlitzAction {
  const cur = s.cur!;
  const r = s.round;
  const ans = cur.answer;
  switch (cur.type) {
    case "pair":
      return { type: "pair", r, a: (ans as number[])[1], b: (ans as number[])[0] };
    case "memory":
      return { type: "seq", r, seq: ans as number[] };
    case "clock":
      return { type: "stop", r, t: t.ctx.now() };
    case "tap":
      return { type: "taps", r, n: 3 };
    default:
      return { type: "pick", r, c: ans as number };
  }
}

function wrongAction(s: BlitzState): BlitzAction {
  const cur = s.cur!;
  const r = s.round;
  const ans = cur.answer;
  switch (cur.type) {
    case "pair": {
      const [a] = ans as number[];
      const other = [0, 1, 2].find((c) => !(ans as number[]).includes(c))!;
      return { type: "pair", r, a, b: other };
    }
    case "memory": {
      const seq = (ans as number[]).slice();
      seq[0] = (seq[0] + 1) % 4;
      return { type: "seq", r, seq };
    }
    case "clock":
      return { type: "stop", r, t: s.phaseAt + 200 };
    case "tap":
      return { type: "taps", r, n: 1 };
    case "odd":
      return { type: "pick", r, c: ((ans as number) + 1) % 25 };
    case "bigger":
      return { type: "pick", r, c: 1 - (ans as number) };
    default:
      return { type: "pick", r, c: ((ans as number) + 1) % 4 };
  }
}

// ---------- content ----------
{
  assert(WORDS.length >= 80, "at least 80 anagram words");
  assert(new Set(WORDS).size === WORDS.length, "no duplicate words");
  for (const w of WORDS) assert(/^[A-Z]{5,6}$/.test(w), `word ${w} is 5-6 capital letters`);
  const keys = new Map<string, string>();
  for (const w of WORDS) {
    const k = sortedLetters(w);
    assert(!keys.has(k), `${w} and ${keys.get(k)} are anagrams of each other`);
    keys.set(k, w);
  }
  for (const [a, b] of ODD_PAIRS) assert(a && b && a !== b, `odd pair ${a}/${b} differs`);
  assert(ODD_PAIRS.length >= 20, "plenty of odd-one-out pairs");
  for (const set of COUNT_SETS) assert(set.length === 3 && new Set(set).size === 3, `count set ${set.join("")}`);
  for (const pool of PAIR_POOLS) assert(new Set(pool).size === pool.length && pool.length >= 15, "pair pools: 15+ distinct emoji");
  assert(new Set(FRUITS).size === FRUITS.length && FRUITS.length >= 2, "fruits distinct");
}

// ---------- generators: every type, many seeds ----------
{
  const r = rng(7);
  const seen = new Set<MicroType>();
  for (let i = 0; i < 400; i++) {
    for (const type of MICRO_TYPES) {
      const g = generate(type, r);
      const pz = g.pz;
      seen.add(type);
      assert(pz.t === type, `${type}: puzzle tag`);
      assert(JSON.stringify(pz).length < 2000, `${type}: puzzle stays small`);
      checkPuzzle(pz, g.answer);
    }
  }
  assert(seen.size === MICRO_TYPES.length && MICRO_TYPES.length >= 10, "10+ microgame types, all generated");

  // Scrambles never spell a known word and differ from the original.
  for (const w of WORDS) {
    for (let i = 0; i < 5; i++) {
      const s = scramble(r, w);
      assert(s !== w && !NOT_A_SCRAMBLE.has(s) && sortedLetters(s) === sortedLetters(w), `scramble of ${w}: ${s}`);
    }
  }
  // Majority counts: clear but not trivial.
  for (let i = 0; i < 300; i++) {
    const { counts, major } = majorityCounts(r);
    const m = counts[major];
    const second = Math.max(...counts.filter((_, d) => d !== major));
    assert(counts.reduce((a, b) => a + b, 0) === 30, "30 arrows");
    assert(second <= m - 2 && second >= m - 4, `majority margin ${counts}`);
  }
}

function checkPuzzle(pz: Puzzle, answer: unknown) {
  switch (pz.t) {
    case "odd": {
      assert(pz.cells.length === 25, "odd: 5x5");
      const a = answer as number;
      const base = pz.cells[(a + 1) % 25];
      assert(
        pz.cells.filter((c) => c !== base).length === 1 && pz.cells[a] !== base,
        "odd: exactly one differs, and it's the answer",
      );
      break;
    }
    case "count": {
      const field = pz.field!;
      const opts = pz.options!;
      const n = field.filter(([e]) => e === pz.target).length;
      assert(opts.length === 4 && distinct(opts) && opts.every((o) => Number.isInteger(o) && o > 0), "count: 4 distinct options");
      assert(opts[answer as number] === n, "count: answer is the real count");
      assert(new Set(field.map(([e]) => e)).size === 3, "count: three kinds");
      assert(field.length <= 24 && distinct(field.map(([, x, y]) => [x, y])), "count: no overlapping spots");
      assert(
        field.every(([, x, y]) => x > 0 && x < 100 && y > 0 && y < 100),
        "count: inside the box",
      );
      break;
    }
    case "math": {
      const m = /^(\d+) ([+−×]) (\d+)$/.exec(pz.text)!;
      assert(m, `math: parse ${pz.text}`);
      const [a, op, b] = [Number(m[1]), m[2], Number(m[3])];
      const v = op === "+" ? a + b : op === "−" ? a - b : a * b;
      assert(pz.options[answer as number] === v, `math: ${pz.text} = ${v}`);
      assert(
        pz.options.length === 4 && distinct(pz.options) && pz.options.every((o) => o > 0),
        "math: 4 distinct positive options",
      );
      assert(
        pz.options.some((o) => Math.abs(o - v) <= 2 && o !== v),
        "math: a near miss is offered",
      );
      break;
    }
    case "ink":
      assert(pz.word !== pz.ink, "ink: word and ink differ");
      assert(pz.options[answer as number] === pz.ink, "ink: answer is the ink");
      assert(pz.options.includes(pz.word) && distinct(pz.options) && pz.options.length === 4, "ink: trap included, distinct");
      break;
    case "clock":
      assert(answer === null && pz.target === 5000, "clock: rank based");
      break;
    case "bigger": {
      const [a, b] = pz.items.map(exprValue);
      assert(Number.isFinite(a) && Number.isFinite(b) && a !== b, `bigger: unequal ${JSON.stringify(pz.items)}`);
      assert((answer === 0) === a > b, "bigger: answer is the bigger");
      break;
    }
    case "memory": {
      const seq = pz.seq!;
      assert(seq.length === pz.len && pz.len >= 4 && pz.len <= 5, "memory: 4-5 arrows");
      assert(
        seq.every((d) => d >= 0 && d <= 3),
        "memory: directions",
      );
      assert(!seq.some((d, i) => i >= 2 && seq[i - 1] === d && seq[i - 2] === d), "memory: no triple repeats");
      assert(JSON.stringify(answer) === JSON.stringify(seq), "memory: answer is the sequence");
      break;
    }
    case "tap":
      assert(answer === null, "tap: rank based");
      break;
    case "pair": {
      assert(pz.cells.length === 16, "pair: 4x4");
      const counts = new Map<string, number>();
      for (const c of pz.cells) counts.set(c, (counts.get(c) ?? 0) + 1);
      const twins = [...counts].filter(([, n]) => n > 1);
      assert(twins.length === 1 && twins[0][1] === 2, "pair: exactly one emoji twice");
      const [i, j] = answer as number[];
      assert(i < j && pz.cells[i] === twins[0][0] && pz.cells[j] === twins[0][0], "pair: answer is the twins, sorted");
      break;
    }
    case "arrows": {
      assert(pz.arrows.length === 30, "arrows: 30");
      const counts = [0, 0, 0, 0];
      for (const [d] of pz.arrows) counts[d]++;
      const max = Math.max(...counts);
      assert(
        counts.filter((c) => c === max).length === 1 && counts[answer as number] === max,
        "arrows: unique majority is the answer",
      );
      assert(distinct(pz.arrows.map(([, x, y]) => [x, y])), "arrows: no overlap");
      break;
    }
    case "anagram": {
      const key = sortedLetters(pz.letters);
      assert(pz.options.length === 4 && distinct(pz.options), "anagram: 4 distinct options");
      assert(pz.options.filter((o) => sortedLetters(o) === key).length === 1, "anagram: exactly one fits");
      assert(
        sortedLetters(pz.options[answer as number]) === key && pz.options[answer as number] !== pz.letters,
        "anagram: answer fits",
      );
      assert(
        pz.options.every((o) => o.length === pz.letters.length),
        "anagram: same-length options",
      );
      break;
    }
    case "fruit": {
      const [l1, l2] = pz.lines;
      const x = l1.r / l1.l.length;
      const y = l2.r - x;
      assert(Number.isInteger(x) && Number.isInteger(y) && y > 0 && x !== y, "fruit: solvable with whole numbers");
      const val = pz.ask.reduce((sum, f) => sum + (f === l1.l[0] ? x : y), 0);
      assert(pz.options[answer as number] === val, "fruit: answer");
      assert(pz.options.length === 4 && distinct(pz.options) && pz.options.every((o) => o > 0), "fruit: options");
      break;
    }
  }
}

// ---------- order ----------
{
  for (let seed = 1; seed < 200; seed++) {
    const order = buildOrder(rng(seed));
    assert(order.length === ROUNDS, "12 microgames");
    assert(new Set(order).size === Math.min(ROUNDS, MICRO_TYPES.length), "every type before any repeat");
    const long = buildOrder(rng(seed), 40);
    assert(
      long.every((v, i) => i === 0 || long[i - 1] !== v),
      "never the same type back to back",
    );
  }
}

// ---------- phases, timing and a full game ----------
{
  const t = makeTestCtx(4, 3);
  const ends = countEnds(t);
  const s: BlitzState = game.setup(t.ctx);
  const [p0, p1, p2, p3] = t.ids;
  assert((s.phase as string) === "intro" && (s.round as number) === 0, "starts in the intro");
  assert(game.tick!(s, t.ctx) === false, "nothing happens before the intro ends");
  t.advance(INTRO_MS);
  assert(game.tick!(s, t.ctx) === true && phaseOf(s) === "ready" && s.round === 1, "intro -> ready");

  const seenTypes = new Set<MicroType>();
  let expected0 = 0;
  for (let round = 1; round <= ROUNDS; round++) {
    assert(phaseOf(s) === "ready" && s.round === round, `ready ${round}`);
    const type = s.cur!.type;
    seenTypes.add(type);
    // READY never shows the puzzle.
    const rv = viewOf(s, p0, t);
    assert(rv.puzzle === null && rv.micro?.type === type && !/"answer"/.test(JSON.stringify(rv)), "ready hides the puzzle");
    assert(rv.micro?.double === round > ROUNDS - 3, "last three are double");
    assert(game.action(s, p0, rightAction(s, t), t.ctx) === false, "no answers during ready");
    t.advance(READY_MS - 1);
    assert(game.tick!(s, t.ctx) === false && phaseOf(s) === "ready", "ready lasts its full time");
    t.advance(1);
    assert(game.tick!(s, t.ctx) === true && phaseOf(s) === "play", "ready -> play");
    assert(s.endsAt - s.phaseAt === PLAY_MS[type], "play length per type");

    const pv = viewOf(s, p1, t);
    assert(pv.puzzle !== null && !/"answer"/.test(JSON.stringify(pv)), "play shows the puzzle, not the answer");

    if (type === "clock") {
      t.advance(5000);
      game.action(s, p0, { type: "stop", r: s.round, t: t.ctx.now() }, t.ctx);
      game.action(s, p1, { type: "stop", r: s.round, t: t.ctx.now() - 1200 }, t.ctx); // 3.8s: 1.2s off, still ranked
      assert(phaseOf(s) === "play", "p2 still to go");
      step(s, t);
      const res = s.last!.res;
      assert(res.find((l) => l.id === p0)!.rank === 1 && res.find((l) => l.id === p1)!.rank === 2, "closest ranks first");
      expected0 += 200 * (s.cur!.double ? 2 : 1);
    } else if (type === "tap") {
      for (let i = 0; i < 25; i++) {
        t.advance(200);
        game.action(s, p0, { type: "taps", r: s.round, n: 3 }, t.ctx);
        if (i % 2) game.action(s, p1, { type: "taps", r: s.round, n: 3 }, t.ctx);
      }
      step(s, t);
      assert(phaseOf(s) === "result", "tap frenzy runs out the clock");
      const res = s.last!.res;
      assert(res.find((l) => l.id === p0)!.rank === 1 && res.find((l) => l.id === p1)!.rank === 2, "most taps ranks first");
      expected0 += 200 * (s.cur!.double ? 2 : 1);
    } else {
      openAnswers(s, t);
      assert(game.action(s, p0, rightAction(s, t), t.ctx) === true, `${type}: right answer accepted`);
      assert(game.action(s, p0, rightAction(s, t), t.ctx) === false, `${type}: one answer only`);
      assert(game.action(s, p1, wrongAction(s), t.ctx) === true, `${type}: wrong answer accepted`);
      const v2 = viewOf(s, p2, t);
      assert(v2.answered.includes(p0) && v2.answered.includes(p1) && v2.you?.pick === null, "others see only flags");
      assert(viewOf(s, p0, t).you?.answered === true, "you see your own lock");
      // p3 is the last one: p2 answers, then p3 does too and PLAY ends early.
      game.action(s, p2, wrongAction(s), t.ctx);
      assert(phaseOf(s) === "play", "still waiting for p3");
      game.action(s, p3, wrongAction(s), t.ctx);
      assert(phaseOf(s) === "result", `${type}: ends early once everyone answered`);
      const l0 = s.last!.res.find((l) => l.id === p0)!;
      assert(l0.ok === true && l0.pts === 200 * (s.cur!.double ? 2 : 1), `${type}: instant right answer = 200 (x2 when double)`);
      assert(s.last!.res.find((l) => l.id === p1)!.ok === false, "wrong answer marked");
      expected0 += l0.pts;
    }

    const res = viewOf(s, "spectator", t);
    assert(res.phase === "result" && res.last !== null && res.you === null, "result is public, spectators have no 'you'");
    if (type !== "clock" && type !== "tap") assert(res.last.answer !== null, "result reveals the answer");
    t.advance(RESULT_MS);
    game.tick!(s, t.ctx);
  }

  assert(seenTypes.size === MICRO_TYPES.length, "a match plays every type");
  assert(phaseOf(s) === "final" && s.over, "final after 12");
  assert(t.result !== null && ends() === 1, "ctx.end exactly once");
  assert(t.result.winners.length === 1 && t.result.winners[0] === p0, "p0 wins");
  assert(s.scores[p0] === expected0 && t.result.scores![p0] === expected0, `p0 scored ${expected0}`);
  assert(t.result.headline.includes("Player0") && t.result.headline.includes("wins Blitz"), t.result.headline);
  assert(s.recap.length === ROUNDS && s.recap.every((r) => r.best.includes(p0)), "recap names p0 every round");
  assert(s.hits[p0] === ROUNDS, "p0 hit every round");
  // After the end: frozen.
  assert(game.action(s, p0, { type: "pick", r: s.round, c: 0 }, t.ctx) === false, "no actions after the end");
  t.advance(60_000);
  assert(game.tick!(s, t.ctx) === false && ends() === 1, "no ticks after the end");
  const fv = viewOf(s, p1, t);
  assert(fv.phase === "final" && fv.puzzle === null && fv.recap.length === ROUNDS, "final view");
}

/** Start a game and step to the PLAY phase of the given type. */
function playOf(n: number, type: MicroType, seed = 11) {
  for (let k = 0; k < 50; k++) {
    const t = makeTestCtx(n, seed + k * 101);
    const s: BlitzState = game.setup(t.ctx);
    const idx = s.order.indexOf(type);
    if (idx < 0 || idx === ROUNDS - 1) continue;
    stepTo(s, t, "play", idx + 1);
    return { t, s };
  }
  throw new Error(`no game with ${type}`);
}

// ---------- scoring: speed ----------
{
  const { t, s } = playOf(2, "math");
  const window = s.endsAt - s.opensAt;
  t.advance(window / 2);
  game.action(s, t.ids[0], rightAction(s, t), t.ctx);
  t.advance(window / 2 - 1);
  game.action(s, t.ids[1], rightAction(s, t), t.ctx);
  const [a, b] = s.last!.res;
  assert(a.pts === 150, `half time left = 150 (${a.pts})`);
  assert(b.pts === 100, `last instant = 100 (${b.pts})`);
  assert(a.ms === window / 2, "answer time reported");
}

// ---------- scoring: wrong = 0, no answer = null ----------
{
  const { t, s } = playOf(3, "ink");
  game.action(s, t.ids[0], wrongAction(s), t.ctx);
  step(s, t);
  const res = s.last!.res;
  assert(res[0].ok === false && res[0].pts === 0, "wrong = 0");
  assert(res[1].ok === null && res[1].pts === 0, "no answer = 0");
}

// ---------- stop the clock: ranking with ties, the clamp, the cap ----------
{
  const { t, s } = playOf(5, "clock");
  const [a, b, c, d, e] = t.ids;
  const start = s.phaseAt;
  t.advance(5_100);
  const now = t.ctx.now();
  game.action(s, a, { type: "stop", r: s.round, t: start + 4_950 }, t.ctx); // 0.05 off
  game.action(s, b, { type: "stop", r: s.round, t: start + 5_050 }, t.ctx); // 0.05 off: tie with a
  game.action(s, c, { type: "stop", r: s.round, t: now - 999_999 }, t.ctx); // clamped to now - 1500 = 3.6s
  game.action(s, d, { type: "stop", r: s.round, t: now + 99_999 }, t.ctx); // clamped to now = 5.1s
  assert(s.answers[c].v === 5_100 - CLOCK_SLACK_MS, "stop time clamped to the slack window");
  assert(s.answers[d].v === 5_100, "stop time can't be in the future");
  assert(phaseOf(s) === "play", "e hasn't stopped yet");
  step(s, t);
  const by = Object.fromEntries(s.last!.res.map((l) => [l.id, l]));
  assert(by[a].rank === 1 && by[b].rank === 1, "tie shares first");
  assert(by[a].pts === by[b].pts && by[a].pts === 200 * (s.cur!.double ? 2 : 1), "tied players get the same points");
  assert(by[d].rank === 3, "next rank skips (1, 1, 3)");
  assert(by[c].rank === 4 && by[c].pts > 0, "1.4s off still scores");
  assert(by[e].ok === null && by[e].pts === 0, "never stopped = 0");
}
{
  const { t, s } = playOf(2, "clock");
  t.advance(300);
  // A stop "before the start" clamps to the start; way off (5s) scores nothing.
  game.action(s, t.ids[0], { type: "stop", r: s.round, t: s.phaseAt - 5_000 }, t.ctx);
  assert(s.answers[t.ids[0]].v === 0, "never before the start");
  step(s, t);
  assert(s.last!.res[0].ok === false && s.last!.res[0].pts === 0, "too far off scores nothing");
}

// ---------- tap frenzy: rate cap, ties, no early end ----------
{
  const { t, s } = playOf(3, "tap");
  const [a, b, c] = t.ids;
  const r = s.round;
  // Spam immediately: capped at the burst allowance.
  for (let i = 0; i < 30; i++)
    assert(game.action(s, a, { type: "taps", r, n: 20 }, t.ctx) === false, "tap batches never broadcast");
  assert(s.taps[a] <= 3, `burst cap (${s.taps[a]})`);
  t.advance(1_000);
  for (let i = 0; i < 30; i++) game.action(s, a, { type: "taps", r, n: 20 }, t.ctx);
  assert(s.taps[a] === TAP_RATE + 3, `15/s cap (${s.taps[a]})`);
  // Live race goes out on a tick, throttled.
  assert(game.tick!(s, t.ctx) === true, "tick broadcasts the race");
  assert(game.tick!(s, t.ctx) === false, "not again right away");
  assert(viewOf(s, b, t).live![a] === TAP_RATE + 3, "everyone sees live counts");
  t.advance(3_900);
  for (let i = 0; i < 30; i++) game.action(s, a, { type: "taps", r, n: 20 }, t.ctx);
  game.action(s, b, { type: "taps", r, n: 5 }, t.ctx);
  game.action(s, c, { type: "taps", r, n: 5 }, t.ctx);
  assert(s.taps[a] === Math.floor((TAP_RATE * PLAY_MS.tap) / 1000), `total cap (${s.taps[a]})`);
  assert(game.action(s, a, { type: "taps", r, n: 0 }, t.ctx) === false, "zero taps rejected");
  assert(game.action(s, a, { type: "taps", r, n: 21 }, t.ctx) === false, "oversize batch rejected");
  assert(game.action(s, a, { type: "taps", r, n: 2.5 }, t.ctx) === false, "fractional batch rejected");
  assert(phaseOf(s) === "play", "no early end in tap frenzy");
  step(s, t);
  const by = Object.fromEntries(s.last!.res.map((l) => [l.id, l]));
  assert(by[a].rank === 1 && by[b].rank === 2 && by[c].rank === 2, "tie for second");
  assert(by[b].pts === 150 * (s.cur!.double ? 2 : 1) && by[b].pts === by[c].pts, "tied tappers share points");
  assert(by[a].v === 75, "taps reported");
}

// ---------- count flash and memory: hidden after the show, answers only after ----------
{
  const { t, s } = playOf(3, "count");
  const v = viewOf(s, t.ids[0], t);
  assert(v.puzzle?.t === "count" && v.puzzle.field !== null && v.puzzle.options === null, "flash: field, no options");
  assert(game.action(s, t.ids[0], rightAction(s, t), t.ctx) === false, "no answer during the flash");
  t.advance(COUNT_SHOW_MS);
  assert(game.tick!(s, t.ctx) === true, "flash ends with a broadcast");
  const after = viewOf(s, t.ids[0], t);
  assert(after.puzzle?.t === "count" && after.puzzle.field === null && after.puzzle.options !== null, "then options, no field");
  assert(game.action(s, t.ids[0], rightAction(s, t), t.ctx) === true, "answer after the flash");
  assert(s.answers[t.ids[0]].pts === 200 * (s.cur!.double ? 2 : 1), "speed measured from when answers open");
  step(s, t);
  const rv = viewOf(s, t.ids[1], t);
  assert(rv.puzzle?.t === "count" && rv.puzzle.field !== null && rv.puzzle.options !== null, "result shows both again");
}
{
  const { t, s } = playOf(2, "memory");
  const len = s.cur!.pz.t === "memory" ? s.cur!.pz.len : 0;
  assert(s.opensAt - s.phaseAt === MEMO_LEAD_MS + len * MEMO_STEP_MS, "show length matches the sequence");
  const v = viewOf(s, t.ids[0], t);
  assert(v.puzzle?.t === "memory" && v.puzzle.seq !== null, "sequence shown");
  assert(game.action(s, t.ids[0], rightAction(s, t), t.ctx) === false, "no input during the show");
  openAnswers(s, t);
  const after = viewOf(s, t.ids[0], t);
  assert(after.puzzle?.t === "memory" && after.puzzle.seq === null && after.puzzle.len === len, "sequence hidden for input");
  const short = (s.cur!.answer as number[]).slice(0, len - 1);
  assert(game.action(s, t.ids[0], { type: "seq", r: s.round, seq: short }, t.ctx) === false, "wrong length rejected");
  assert(game.action(s, t.ids[0], { type: "seq", r: s.round, seq: [...short, 9] }, t.ctx) === false, "bad direction rejected");
  assert(game.action(s, t.ids[0], rightAction(s, t), t.ctx) === true, "right sequence");
  game.action(s, t.ids[1], wrongAction(s), t.ctx);
  assert(phaseOf(s) === "result" && s.last!.res[0].ok === true && s.last!.res[1].ok === false, "memory scored");
}

// ---------- find the pair: order doesn't matter; same cell twice is junk ----------
{
  const { t, s } = playOf(2, "pair");
  const [i, j] = s.cur!.answer as number[];
  assert(game.action(s, t.ids[0], { type: "pair", r: s.round, a: i, b: i }, t.ctx) === false, "same cell twice rejected");
  assert(game.action(s, t.ids[0], { type: "pair", r: s.round, a: j, b: i }, t.ctx) === true, "reversed pair ok");
  assert(s.answers[t.ids[0]].ok, "reversed pair is right");
}

// ---------- hostile actions ----------
{
  const { t, s } = playOf(2, "odd");
  const [a] = t.ids;
  const r = s.round;
  const hostile: unknown[] = [
    null,
    undefined,
    0,
    "pick",
    [],
    [{ type: "pick", r, c: 0 }],
    {},
    { type: "pick" },
    { type: "pick", r },
    { type: "pick", r, c: "1" },
    { type: "pick", r, c: 1.5 },
    { type: "pick", r, c: -1 },
    { type: "pick", r, c: 25 },
    { type: "pick", r, c: NaN },
    { type: "pick", r, c: Infinity },
    { type: "pick", r: r + 1, c: 0 },
    { type: "pick", r: String(r), c: 0 },
    { type: "pick", r: null, c: 0 },
    { type: "pair", r, a: 0, b: 1 },
    { type: "seq", r, seq: [0, 1, 2, 3] },
    { type: "stop", r, t: 0 },
    { type: "taps", r, n: 1 },
    { type: "__proto__", r, c: 0 },
    { type: "constructor", r, c: 0 },
    { type: "pick", r, c: { valueOf: 3 } },
    { type: "x".repeat(10_000), r, c: 0 },
  ];
  for (const h of hostile)
    assert(game.action(s, a, h as BlitzAction, t.ctx) === false, `rejects ${JSON.stringify(h)?.slice(0, 60)}`);
  assert(Object.keys(s.answers).length === 0, "nothing landed");
  assert(game.action(s, "stranger", { type: "pick", r, c: 0 }, t.ctx) === false, "non-players can't answer");
  assert(game.action(s, "__proto__", { type: "pick", r, c: 0 }, t.ctx) === false, "weird ids can't answer");
  t.advance(s.endsAt - t.ctx.now());
  assert(game.action(s, a, { type: "pick", r, c: 0 }, t.ctx) === false, "too late");
}
{
  // Wrong type for the microgame and wrong-shaped stops/seqs.
  const { t, s } = playOf(2, "clock");
  const r = s.round;
  for (const h of [
    { type: "pick", r, c: 0 },
    { type: "stop", r, t: "5000" },
    { type: "stop", r, t: NaN },
    { type: "stop", r, t: Infinity },
    { type: "stop", r },
  ])
    assert(game.action(s, t.ids[0], h as BlitzAction, t.ctx) === false, `clock rejects ${JSON.stringify(h)}`);
  const m = playOf(2, "memory");
  openAnswers(m.s, m.t);
  for (const seq of [null, "0123", [0, 1], new Array(10_000).fill(0), [0, 1, 2, "3", 0], [0.5, 1, 2, 3, 0]])
    assert(
      game.action(m.s, m.t.ids[0], { type: "seq", r: m.s.round, seq } as BlitzAction, m.t.ctx) === false,
      "memory rejects junk seqs",
    );
}

// ---------- secrecy ----------
{
  for (const type of MICRO_TYPES) {
    const { t, s } = playOf(3, type, 5);
    const [a, b] = t.ids;
    openAnswers(s, t);
    if (type !== "tap" && type !== "clock") game.action(s, a, wrongAction(s), t.ctx);
    for (const viewer of [b, "spectator"]) {
      const v = viewOf(s, viewer, t);
      const json = JSON.stringify(v);
      assert(!/"answer"/.test(json) && v.last === null, `${type}: no answer in play view`);
      assert(v.you === null || v.you.pick === null, `${type}: others' picks never leak`);
      assert(json.length < 4_000, `${type}: play view small (${json.length})`);
    }
    // Ready of the next microgame doesn't leak its puzzle.
    stepTo(s, t, "ready", s.round + 1);
    const nextPz = JSON.stringify(s.cur!.pz);
    const rv = JSON.stringify(viewOf(s, b, t));
    assert(!rv.includes(nextPz) && viewOf(s, b, t).puzzle === null, `ready after ${type}: puzzle hidden`);
    if (s.cur!.pz.t === "odd")
      assert(
        !rv.includes(s.cur!.pz.cells.find((c, i, all) => all.indexOf(c) === i && all.lastIndexOf(c) === i)!),
        "odd emoji hidden",
      );
    if (s.cur!.pz.t === "anagram") assert(!rv.includes(s.cur!.pz.letters), "scramble hidden");
  }
}

// ---------- disconnects in every phase never stall ----------
{
  const t = makeTestCtx(3, 9);
  const ends = countEnds(t);
  const s: BlitzState = game.setup(t.ctx);
  const [a, b, c] = t.ids;
  const drop = (id: string) => {
    t.ctx.player(id)!.connected = false;
    game.playerLeft?.(s, id, t.ctx);
  };
  const back = (id: string) => {
    t.ctx.player(id)!.connected = true;
    game.playerReturned?.(s, id, t.ctx);
  };
  drop(c); // intro
  stepTo(s, t, "ready", 1);
  back(c);
  drop(b); // ready
  stepTo(s, t, "play", 1);
  // Only a and c are here: their answers end PLAY early (unless it's tap frenzy).
  openAnswers(s, t);
  if (s.cur!.type !== "tap") {
    const act = s.cur!.type === "clock" ? { type: "stop", r: s.round, t: t.ctx.now() } : wrongAction(s);
    game.action(s, a, act as BlitzAction, t.ctx);
    game.action(s, c, act as BlitzAction, t.ctx);
    assert(phaseOf(s) === "result", "disconnected players don't hold up the round");
  }
  stepTo(s, t, "play", 2);
  drop(a); // play: b gone, a gone, c here
  drop(c); // play: nobody here at all
  assert(game.tick!(s, t.ctx) === false && phaseOf(s) === "play", "with nobody connected the timer still runs (no instant skip)");
  stepTo(s, t, "result", 2);
  back(a);
  back(b);
  back(c); // result
  // Everyone gone for the rest: the game still reaches the end on timers alone.
  drop(a);
  drop(b);
  drop(c);
  stepTo(s, t, "final");
  assert(t.result !== null && ends() === 1, "game ends with nobody around");
  assert(t.result.winners.length === 0 && /nobody/i.test(t.result.headline), "no points, no winners");
}

// ---------- solo practice and a full room ----------
{
  const t = makeTestCtx(1, 21);
  const s: BlitzState = game.setup(t.ctx);
  const [a] = t.ids;
  for (let round = 1; round <= ROUNDS; round++) {
    stepTo(s, t, "play", round);
    if (s.cur!.type === "tap") {
      t.advance(1_000);
      game.action(s, a, { type: "taps", r: s.round, n: 5 }, t.ctx);
    } else if (s.cur!.type === "clock") {
      t.advance(5_000);
      game.action(s, a, { type: "stop", r: s.round, t: t.ctx.now() }, t.ctx);
    } else {
      openAnswers(s, t);
      game.action(s, a, rightAction(s, t), t.ctx);
    }
    if (s.cur!.type !== "tap") assert(phaseOf(s) === "result", "solo answer ends the microgame at once");
  }
  stepTo(s, t, "final");
  assert(t.result!.winners[0] === a && /practice/.test(t.result!.headline), `solo headline: ${t.result!.headline}`);
}
{
  const t = makeTestCtx(12, 33);
  const s: BlitzState = game.setup(t.ctx);
  let guard = 0;
  while (!t.result && guard++ < 500) {
    if (phaseOf(s) === "play") {
      openAnswers(s, t);
      if (s.cur!.type === "tap") {
        t.advance(1_000);
        t.ids.forEach((id, i) => game.action(s, id, { type: "taps", r: s.round, n: 1 + (i % 4) }, t.ctx));
      } else if (s.cur!.type === "clock") {
        t.advance(4_000);
        t.ids.forEach((id, i) => game.action(s, id, { type: "stop", r: s.round, t: t.ctx.now() - i * 37 }, t.ctx));
      } else {
        t.ids.forEach((id, i) => game.action(s, id, i % 3 === 0 ? rightAction(s, t) : wrongAction(s), t.ctx));
      }
      for (const id of t.ids) assert(JSON.stringify(viewOf(s, id, t)).length < 6_000, "12-player view stays small");
    }
    step(s, t);
  }
  assert(t.result, "12-player game finishes");
  const json = JSON.stringify(viewOf(s, t.ids[0], t));
  assert(json.length < 6_000, `final view small (${json.length})`);
}

// ---------- ties for the win ----------
{
  const t = makeTestCtx(2, 44);
  const s: BlitzState = game.setup(t.ctx);
  let guard = 0;
  while (!t.result && guard++ < 500) {
    if (phaseOf(s) === "play") {
      openAnswers(s, t);
      if (s.cur!.type === "tap") {
        t.advance(1_000);
        for (const id of t.ids) game.action(s, id, { type: "taps", r: s.round, n: 4 }, t.ctx);
      } else {
        // Both answer at the same instant with the same answer.
        for (const id of t.ids) game.action(s, id, rightAction(s, t), t.ctx);
      }
    }
    step(s, t);
  }
  assert(t.result!.winners.length === 2, "tied players both win");
  assert(/tie/.test(t.result!.headline), `tie headline: ${t.result!.headline}`);
}

// ---------- views are plain JSON ----------
{
  const { t, s } = playOf(3, "arrows");
  const v = viewOf(s, t.ids[0], t);
  assert(JSON.stringify(JSON.parse(JSON.stringify(v))) === JSON.stringify(v), "view round-trips");
  assert(Object.getPrototypeOf(v.scores) === Object.prototype, "plain objects in views");
}

console.log("✓ blitz tests passed");
