import { assert, makeTestCtx } from "../../shared/testing";
import game, { buildOrder, greenPoints, levelOf, planTwists, playLength, spinPoints, type BlitzAction, type BlitzState, type BlitzView } from "./server";
import { CATEGORIES, COUNT_SETS, FRUITS, NOT_A_SCRAMBLE, ODD_PAIRS, PAIR_POOLS, RHYMES, SPELLINGS, WORDS } from "./data";
import { exprValue, generate, generateFresh, majorityCounts, molePoints, scramble, SIMON_SAYS } from "./puzzles";
import { nextOf } from "./bot";
import {
  CLOCK_SLACK_MS,
  FIXED_LENGTH,
  INTRO_MS,
  META,
  MICRO_TYPES,
  PLAY_MS,
  READY_MS,
  RESULT_MS,
  REVERSIBLE,
  ROUNDS,
  SIMON_HOLD_POINTS,
  SPEED_SCALE,
  TAP_RATE,
  TWIST_READY_MS,
  WHACK_BOMB_PENALTY,
  angleGap,
  finaleMult,
  fmtTime,
  kindsFor,
  pickRange,
  spinAngle,
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
const NEW_KINDS: MicroType[] = ["green", "simon", "gone", "shade", "lines", "digits", "spell", "rhyme", "dice", "next", "time", "spin", "whack", "spot", "flank", "notin"];

/** Advance fake time to the end of the current phase and tick once. */
function step(s: BlitzState, t: T) {
  t.advance(Math.max(0, s.endsAt - t.ctx.now()));
  game.tick!(s, t.ctx);
}
/** Step until the given phase (and round, when given). */
function stepTo(s: BlitzState, t: T, phase: BlitzState["phase"], round?: number) {
  for (let i = 0; i < 300 && !(phaseOf(s) === phase && (round === undefined || s.round === round)); i++) step(s, t);
  assert(phaseOf(s) === phase, `reached ${phase}`);
}
/** Move into the answering window (after any show), and for green light until it's green. */
function openAnswers(s: BlitzState, t: T) {
  if (t.ctx.now() < s.opensAt) t.advance(s.opensAt - t.ctx.now());
  game.tick!(s, t.ctx);
}
function goGreen(s: BlitzState, t: T) {
  if (t.ctx.now() < s.goAt) t.advance(s.goAt - t.ctx.now());
  game.tick!(s, t.ctx);
}
/** Spin stop: the absolute time (≥ now) the needle points straight at the zone centre. */
function spinCentreAt(s: BlitzState, t: T): number {
  const pz = s.cur!.pz as Extract<Puzzle, { t: "spin" }>;
  const turn = ((((pz.zone - pz.start) * pz.dir) % 360) + 360) % 360;
  let at = s.opensAt + (turn / 360) * pz.period;
  while (at < t.ctx.now()) at += pz.period;
  return at;
}

/** A pick that scores in this round (twist-aware). Null when the right move is to do nothing. */
function rightPick(s: BlitzState): number | null {
  const cur = s.cur!;
  const ans = cur.answer as number;
  if (ans === -1) return null;
  if (cur.twist === "reverse") return (ans + 1) % pickRange(cur.pz);
  return ans;
}
function wrongPick(s: BlitzState): number {
  const cur = s.cur!;
  const ans = cur.answer as number;
  if (ans === -1) return 0;
  if (cur.twist === "reverse") return ans;
  return (ans + 1) % pickRange(cur.pz);
}

/** Right action for choice-like kinds (call after openAnswers; green needs goGreen first). */
function rightAction(s: BlitzState, t: T): BlitzAction | null {
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
    case "green":
      return { type: "hit", r };
    default: {
      const c = rightPick(s);
      return c === null ? null : { type: "pick", r, c };
    }
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
    case "spin":
      // Right at the start: the clock is way off, and the needle starts far from the zone.
      return { type: "stop", r, t: s.phaseAt };
    case "tap":
      return { type: "taps", r, n: 1 };
    case "green":
      return { type: "hit", r }; // before it's green
    default:
      return { type: "pick", r, c: wrongPick(s) };
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
  assert(ODD_PAIRS.length >= 30, "plenty of odd-one-out pairs");
  for (const set of COUNT_SETS) assert(set.length === 3 && new Set(set).size === 3, `count set ${set.join("")}`);
  for (const pool of PAIR_POOLS) assert(new Set(pool).size === pool.length && pool.length >= 20, "pair pools: 20+ distinct emoji");
  assert(new Set(FRUITS).size === FRUITS.length && FRUITS.length >= 2, "fruits distinct");

  assert(SPELLINGS.length >= 50, "50+ spellings");
  const spelled = new Set<string>();
  for (const row of SPELLINGS) {
    assert(row.length === 4 && new Set(row).size === 4, `spelling row ${row.join(" ")}: 4 distinct`);
    assert(row.every((w) => /^[A-Z]+$/.test(w)), `spelling row ${row[0]} is capitals`);
    assert(!spelled.has(row[0]), `${row[0]} twice`);
    spelled.add(row[0]);
  }
  for (const row of SPELLINGS) for (const w of row.slice(1)) assert(!spelled.has(w), `misspelling ${w} is a listed word`);

  const rhymeWords = RHYMES.flatMap((g) => g.words);
  assert(new Set(rhymeWords).size === rhymeWords.length, "each rhyme word in one group only");
  for (const g of RHYMES) {
    assert(g.words.length >= 2, "rhyme groups have 2+ words");
    for (const trap of g.traps) assert(!g.words.includes(trap) && !rhymeWords.includes(trap), `trap ${trap} isn't a rhyme word`);
  }
  for (const c of CATEGORIES) {
    assert(c.members.length >= 3 && c.impostors.length >= 1, `category ${c.ask} big enough`);
    assert(new Set([...c.members, ...c.impostors]).size === c.members.length + c.impostors.length, `category ${c.ask}: no overlap`);
    for (const o of [...c.members, ...c.impostors]) assert(/^\S+ \S/.test(o), `"${o}" is "emoji Name"`);
  }
  assert(new Set(CATEGORIES.map((c) => c.ask)).size === CATEGORIES.length, "category names distinct");
}

// ---------- generators: every type, every difficulty, many seeds ----------
{
  const r = rng(7);
  assert(MICRO_TYPES.length >= 26 && NEW_KINDS.every((k) => MICRO_TYPES.includes(k)), "26+ microgame kinds");
  assert(new Set(MICRO_TYPES.map((k) => META[k].title)).size === MICRO_TYPES.length, "titles distinct");
  assert(new Set(MICRO_TYPES.map((k) => META[k].icon)).size === MICRO_TYPES.length, "icons distinct");
  for (let i = 0; i < 300; i++) {
    for (const level of [0, 0.5, 1]) {
      for (const type of MICRO_TYPES) {
        const g = generate(type, r, level);
        assert(g.pz.t === type, `${type}: puzzle tag`);
        assert(JSON.stringify(g.pz).length < 2000, `${type}: puzzle stays small`);
        assert(!/"answer"/.test(JSON.stringify(g.pz)), `${type}: no answer field in the puzzle`);
        checkPuzzle(g.pz, g.answer, level);
        if (g.show !== undefined) assert(g.show > 0 && g.show < PLAY_MS[type] - 2000, `${type}: show leaves time to answer`);
        if (type === "green") assert(g.goMs! >= 1000 && g.goMs! <= PLAY_MS.green - 1500, "green: go time leaves a window");
      }
    }
  }
  // Deterministic from the seed.
  for (const type of MICRO_TYPES) {
    assert(JSON.stringify(generate(type, rng(99), 0.6)) === JSON.stringify(generate(type, rng(99), 0.6)), `${type}: deterministic`);
  }

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
  // Difficulty really rises.
  const avg = (type: MicroType, level: number, f: (pz: Puzzle) => number) => {
    let sum = 0;
    for (let i = 0; i < 200; i++) sum += f(generate(type, r, level).pz);
    return sum / 200;
  };
  assert(avg("odd", 1, (p) => (p.t === "odd" ? p.cells.length : 0)) > avg("odd", 0, (p) => (p.t === "odd" ? p.cells.length : 0)), "odd grid grows");
  assert(avg("memory", 1, (p) => (p.t === "memory" ? p.len : 0)) > avg("memory", 0, (p) => (p.t === "memory" ? p.len : 0)), "memory grows");
  assert(avg("digits", 1, (p) => (p.t === "digits" ? p.len : 0)) > avg("digits", 0, (p) => (p.t === "digits" ? p.len : 0)), "number flash grows");
  assert(avg("spin", 1, (p) => (p.t === "spin" ? p.width : 0)) < avg("spin", 0, (p) => (p.t === "spin" ? p.width : 0)), "spin zone shrinks");
  assert(avg("spin", 1, (p) => (p.t === "spin" ? p.period : 0)) < avg("spin", 0, (p) => (p.t === "spin" ? p.period : 0)), "spin gets faster");
  assert(
    avg("whack", 1, (p) => (p.t === "whack" ? p.moles.filter((m) => m[3]).length : 0)) >
      avg("whack", 0, (p) => (p.t === "whack" ? p.moles.filter((m) => m[3]).length : 0)),
    "more bombs later",
  );
  const shadeGap = (p: Puzzle) => {
    if (p.t !== "shade") return 0;
    const s = [...p.cells].sort((a, b) => a - b);
    return p.ask === "dark" ? s[1] - s[0] : s[s.length - 1] - s[s.length - 2];
  };
  assert(avg("shade", 1, shadeGap) < avg("shade", 0, shadeGap), "shades get subtler");
  // Themed variety: lots of different content per kind.
  const variety = (type: MicroType) => new Set(Array.from({ length: 200 }, () => JSON.stringify(generate(type, r, 0.5).pz))).size;
  for (const type of MICRO_TYPES) if (type !== "clock" && type !== "tap") assert(variety(type) >= (type === "flank" ? 12 : 40), `${type}: varied puzzles (${variety(type)})`);
}

function checkPuzzle(pz: Puzzle, answer: unknown, level: number) {
  const opts4 = (options: unknown[] | null, what: string) => {
    assert(options && options.length === 4 && distinct(options), `${what}: 4 distinct options`);
    assert(Number.isInteger(answer) && (answer as number) >= 0 && (answer as number) < 4, `${what}: answer index`);
  };
  switch (pz.t) {
    case "odd": {
      const side = Math.sqrt(pz.cells.length);
      assert(Number.isInteger(side) && side >= 4 && side <= 6, "odd: 4x4 to 6x6");
      const a = answer as number;
      const base = pz.cells[(a + 1) % pz.cells.length];
      assert(pz.cells.filter((c) => c !== base).length === 1 && pz.cells[a] !== base, "odd: exactly one differs, and it's the answer");
      break;
    }
    case "count": {
      const field = pz.field!;
      const n = field.filter(([e]) => e === pz.target).length;
      opts4(pz.options, "count");
      assert(pz.options!.every((o) => Number.isInteger(o) && o > 0), "count: positive options");
      assert(pz.options![answer as number] === n, "count: answer is the real count");
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
      opts4(pz.options, "math");
      assert(pz.options[answer as number] === v, `math: ${pz.text} = ${v}`);
      assert(pz.options.every((o) => o > 0), "math: positive options");
      assert(
        pz.options.some((o) => Math.abs(o - v) <= 2 && o !== v),
        "math: a near miss is offered",
      );
      break;
    }
    case "ink":
      assert(pz.word !== pz.ink, "ink: word and ink differ");
      opts4(pz.options, "ink");
      assert(pz.options[answer as number] === pz.ink, "ink: answer is the ink");
      assert(pz.options.includes(pz.word), "ink: trap included");
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
      assert(seq.length === pz.len && pz.len >= 4 && pz.len <= 6, "memory: 4-6 arrows");
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
      opts4(pz.options, "anagram");
      assert(pz.options.filter((o) => sortedLetters(o) === key).length === 1, "anagram: exactly one fits");
      assert(sortedLetters(pz.options[answer as number]) === key && pz.options[answer as number] !== pz.letters, "anagram: answer fits");
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
      opts4(pz.options, "fruit");
      assert(pz.options[answer as number] === val, "fruit: answer");
      assert(pz.options.every((o) => o > 0), "fruit: options");
      break;
    }
    case "green":
      assert(answer === null && pz.go === null, "green: nothing to pick, go hidden");
      if (pz.decoy) assert(pz.decoy[1] !== 2 && pz.decoy[0] >= 500, "green: decoy is never green, never instant");
      if (level < 0.3) assert(pz.decoy === null, "green: no decoys early on");
      break;
    case "simon": {
      assert(pz.options.length === 4 && distinct(pz.options), "simon: 4 distinct options");
      const says = pz.lead === SIMON_SAYS;
      assert(answer === (says ? pz.ask : -1), "simon: answer only when Simon says");
      assert(pz.ask >= 0 && pz.ask < 4, "simon: ask in range");
      if (!says) assert(!/^Simon says/.test(pz.lead), "simon: impostor leads differ");
      break;
    }
    case "gone": {
      const shown = pz.shown!;
      const left = pz.left!;
      opts4(pz.options, "gone");
      assert(shown.length >= 5 && shown.length <= 7 && distinct(shown), "gone: 5-7 distinct emoji");
      assert(left.length === shown.length - 1 && left.every((e) => shown.includes(e)), "gone: one vanished");
      const missing = shown.find((e) => !left.includes(e));
      assert(pz.options![answer as number] === missing, "gone: answer is the missing one");
      assert(pz.options!.every((o, i) => i === answer || !shown.includes(o)), "gone: distractors were never shown");
      break;
    }
    case "shade": {
      const n = pz.cells.length;
      assert([9, 16, 25].includes(n), "shade: 3x3 to 5x5");
      const a = answer as number;
      const target = pz.cells[a];
      const others = pz.cells.filter((_, i) => i !== a);
      const gap = pz.ask === "dark" ? Math.min(...others) - target : target - Math.max(...others);
      assert(gap >= 5, `shade: target stands out by ${gap}`);
      assert(pz.cells.every((l) => l >= 20 && l <= 85), "shade: lightness readable");
      break;
    }
    case "lines": {
      assert(pz.lines.length === 4, "lines: 4");
      const lens = pz.lines.map(([l]) => l);
      const a = answer as number;
      const rest = lens.filter((_, i) => i !== a);
      const gap = pz.ask === "long" ? lens[a] - Math.max(...rest) : Math.min(...rest) - lens[a];
      assert(gap >= 5, `lines: clear winner (${gap})`);
      assert(pz.lines.every(([l, off]) => l > 0 && off >= 0 && l + off <= 100), "lines: inside the track");
      break;
    }
    case "digits": {
      opts4(pz.options, "digits");
      assert(pz.num!.length === pz.len && pz.len >= 4 && pz.len <= 7 && /^[1-9]\d+$/.test(pz.num!), "digits: a number");
      assert(pz.options![answer as number] === pz.num, "digits: answer");
      assert(pz.options!.every((o) => o.length === pz.len && /^[1-9]\d+$/.test(o)), "digits: lookalike options");
      break;
    }
    case "spell": {
      opts4(pz.options, "spell");
      const row = SPELLINGS.find((w) => w[0] === pz.options[answer as number]);
      assert(row && pz.options.every((o) => row.includes(o)), "spell: one right spelling + its misspellings");
      break;
    }
    case "rhyme": {
      opts4(pz.options, "rhyme");
      const g = RHYMES.find((x) => x.words.includes(pz.word))!;
      const fits = pz.options.filter((o) => g.words.includes(o));
      assert(fits.length === 1 && fits[0] === pz.options[answer as number] && fits[0] !== pz.word, "rhyme: exactly one rhymes");
      break;
    }
    case "dice": {
      const [a, b] = pz.hands.map((h) => h.reduce((x, y) => x + y, 0));
      assert(pz.hands.every((h) => h.length >= 3 && h.length <= 4 && h.every((d) => d >= 1 && d <= 6)), "dice: 3-4 dice");
      assert(a !== b && (answer === 0) === a > b, "dice: answer is the bigger hand");
      break;
    }
    case "next": {
      opts4(pz.options, "next");
      assert(pz.options.every((o) => Number.isInteger(o) && o > 0), "next: positive whole options");
      assert(nextOf(pz.seq) === pz.options[answer as number], `next: ${pz.seq} -> ${pz.options[answer as number]} (rule finds ${nextOf(pz.seq)})`);
      break;
    }
    case "time": {
      opts4(pz.options, "time");
      assert(pz.h >= 1 && pz.h <= 12 && pz.m >= 0 && pz.m < 60 && pz.m % 5 === 0, "time: valid");
      assert(pz.options[answer as number] === fmtTime(pz.h, pz.m), "time: answer");
      assert(pz.options.every((o) => /^(1[0-2]|[1-9]):[0-5][05]$/.test(o)), "time: well-formed options");
      if (level === 0) assert(pz.m % 30 === 0, "time: o'clock / half past early on");
      break;
    }
    case "spin": {
      assert(answer === null, "spin: scored by position");
      assert(pz.width >= 25 && pz.width <= 60 && pz.period >= 1200 && pz.period <= 2600, "spin: sane zone and speed");
      assert(angleGap(pz.start, pz.zone) > pz.width, "spin: never starts in the zone");
      assert(PLAY_MS.spin / pz.period >= 1.8, "spin: passes the zone at least once with time to spare");
      break;
    }
    case "whack": {
      const moles = pz.moles.filter((m) => !m[3]);
      assert(moles.length >= 7 && pz.moles.length - moles.length >= 1, "whack: 7+ moles and at least a bomb");
      assert(!pz.moles[0][3], "whack: never opens with a bomb");
      for (const [h, up, down] of pz.moles) assert(h >= 0 && h < pz.holes && up >= 0 && down > up && down < PLAY_MS.whack, "whack: in time and space");
      for (const [i, a] of pz.moles.entries())
        for (const b of pz.moles.slice(i + 1)) assert(a[0] !== b[0] || a[2] + 150 <= b[1] || b[2] + 150 <= a[1], "whack: holes never double-booked");
      break;
    }
    case "spot": {
      assert(pz.a.length === pz.b.length && [9, 16].includes(pz.a.length), "spot: 3x3 or 4x4");
      const diff = pz.a.map((e, i) => (e !== pz.b[i] ? i : -1)).filter((i) => i >= 0);
      assert(diff.length === 1 && diff[0] === answer, "spot: exactly one difference, the answer");
      assert(distinct(pz.a) && distinct(pz.b), "spot: no repeats inside a grid");
      break;
    }
    case "flank": {
      assert(pz.arrows.length % 2 === 1 && pz.arrows.length >= 5, "flank: odd row");
      assert(pz.arrows[Math.floor(pz.arrows.length / 2)] === answer, "flank: answer is the middle");
      break;
    }
    case "notin": {
      opts4(pz.options, "notin");
      const cat = CATEGORIES.find((c) => c.ask === pz.ask)!;
      assert(cat.impostors.includes(pz.options[answer as number]), "notin: answer is the impostor");
      assert(pz.options.filter((o) => cat.members.includes(o)).length === 3, "notin: three members");
      if (level < 0.3) assert(!cat.hard, "notin: easy categories early");
      break;
    }
  }
}

// ---------- order: no back-to-back repeats, every kind before a repeat ----------
{
  for (let seed = 1; seed < 200; seed++) {
    for (const mix of ["all", "brainy", "reflex", "chaos"] as const) {
      const pool = kindsFor(mix);
      const order = buildOrder(rng(seed), ROUNDS, pool);
      assert(order.length === ROUNDS, "12 microgames");
      assert(new Set(order).size === Math.min(ROUNDS, pool.length), "every type before any repeat");
      assert(order.every((k) => pool.includes(k)), `${mix}: only kinds in the mix`);
      const long = buildOrder(rng(seed), 60, pool, pool.slice(0, 5));
      assert(
        long.every((v, i) => i === 0 || long[i - 1] !== v),
        `${mix}: never the same type back to back`,
      );
    }
  }
  assert(kindsFor("brainy").length >= 12 && kindsFor("reflex").length >= 12, "both groups are big");
  assert(kindsFor("brainy").every((k) => META[k].group === "brainy") && kindsFor("reflex").every((k) => META[k].group === "reflex"), "groups");
  // Kinds played last time go to the back of the queue.
  const recent = buildOrder(rng(3), 12);
  const next = buildOrder(rng(4), 12, MICRO_TYPES, recent);
  assert(next.every((k) => !recent.includes(k)), "fresh kinds first");
}

// ---------- twists ----------
{
  let reverse = 0;
  let total = 0;
  for (let seed = 1; seed < 300; seed++) {
    for (const finale of ["double", "boss", "none"] as const) {
      for (const mix of ["all", "chaos"] as const) {
        const order = buildOrder(rng(seed), 12, kindsFor(mix));
        const tw = planTwists(rng(seed + 1), order, finale, mix);
        assert(tw.length === 12 && tw[0] === null, "never on the first");
        assert(tw.some(Boolean), "at least one twist in 12");
        tw.forEach((x, i) => {
          if (!x) return;
          total++;
          assert(!tw[i - 1], "no back-to-back twists");
          assert(finaleMult(i + 1, 12, finale) === 1, "no twist on a finale round");
          if (x === "reverse") {
            reverse++;
            assert(REVERSIBLE.includes(order[i]), `reverse only on reversible kinds (${order[i]})`);
          }
          if (x === "speed") assert(!FIXED_LENGTH.includes(order[i]), "speed only where time can shrink");
        });
      }
    }
  }
  assert(reverse > total / 5, "reverse shows up often");
  const count = (mix: "all" | "chaos") => {
    let n = 0;
    for (let seed = 1; seed < 200; seed++) n += planTwists(rng(seed), buildOrder(rng(seed), 12, kindsFor(mix)), "double", mix).filter(Boolean).length;
    return n;
  };
  assert(count("chaos") > count("all") * 1.4, "chaos has more twists");
  assert(levelOf(1, 12, "all", false) === 0 && levelOf(12, 12, "all", false) === 1 && levelOf(1, 12, "chaos", false) > 0, "levels");
  assert(levelOf(3, 12, "all", true) === 1, "boss is maxed");
}

/** A game whose round `idx`(0-based) is `type`, optionally with a twist forced on it. */
function playOf(n: number, type: MicroType, seed = 11, settings = {}, twist: "reverse" | "speed" | "double" | null = null) {
  for (let k = 0; k < 80; k++) {
    const t = makeTestCtx(n, seed + k * 101, settings);
    const s: BlitzState = game.setup(t.ctx);
    const idx = s.order.indexOf(type);
    if (idx < 0 || idx === s.rounds - 1) continue;
    s.twists = s.twists.map((x, i) => (i === idx ? twist : null));
    stepTo(s, t, "play", idx + 1);
    return { t, s };
  }
  throw new Error(`no game with ${type}`);
}

// ---------- a full match, every round: right, wrong, timing, secrecy ----------
for (const seed of [3, 4, 5]) {
  const t = makeTestCtx(4, seed);
  const ends = countEnds(t);
  const s: BlitzState = game.setup(t.ctx);
  const [p0, p1, p2, p3] = t.ids;
  assert(phaseOf(s) === "intro" && s.round === 0, "starts in the intro");
  assert(!JSON.stringify(viewOf(s, p0, t)).includes("twists"), "twists stay secret");
  assert(game.tick!(s, t.ctx) === false, "nothing happens before the intro ends");
  t.advance(INTRO_MS);
  assert(game.tick!(s, t.ctx) === true && phaseOf(s) === "ready" && (s.round as number) === 1, "intro -> ready");

  let expected0 = 0;
  for (let round = 1; round <= ROUNDS; round++) {
    assert(phaseOf(s) === "ready" && s.round === round, `ready ${round}`);
    const cur = s.cur!;
    const type = cur.type;
    const rv = viewOf(s, p0, t);
    assert(rv.puzzle === null && rv.micro?.type === type && !/"answer"/.test(JSON.stringify(rv)), "ready hides the puzzle");
    assert(rv.micro?.mult === cur.mult && cur.mult === finaleMult(round, ROUNDS, "double") * (cur.twist === "double" ? 2 : 1), "multiplier");
    assert(rv.micro?.twist === cur.twist, "the twist is announced on its own card");
    const readyMs = READY_MS + (cur.twist ? TWIST_READY_MS : 0);
    assert(s.endsAt - s.phaseAt === readyMs, "ready length (longer with a twist)");
    assert(game.action(s, p0, wrongAction(s), t.ctx) === false, "no answers during ready");
    t.advance(readyMs - 1);
    assert(game.tick!(s, t.ctx) === false && phaseOf(s) === "ready", "ready lasts its full time");
    t.advance(1);
    assert(game.tick!(s, t.ctx) === true && phaseOf(s) === "play", "ready -> play");
    assert(s.endsAt - s.phaseAt === playLength(cur, 1), "play length");
    if (!FIXED_LENGTH.includes(type)) {
      const plain = cur.show + Math.round((PLAY_MS[type] - cur.show) * (1 - 0.15 * cur.level));
      assert(cur.twist === "speed" ? s.endsAt - s.phaseAt < plain : s.endsAt - s.phaseAt === plain, `${type}: later = quicker`);
    }

    const pv = viewOf(s, p1, t);
    assert(pv.puzzle !== null && !/"answer"/.test(JSON.stringify(pv)), "play shows the puzzle, not the answer");
    const full = 200 * cur.mult;

    if (type === "clock") {
      t.advance(5000);
      game.action(s, p0, { type: "stop", r: s.round, t: t.ctx.now() }, t.ctx);
      game.action(s, p1, { type: "stop", r: s.round, t: t.ctx.now() - 1200 }, t.ctx);
      step(s, t);
      expected0 += full;
    } else if (type === "tap") {
      for (let i = 0; i < 25; i++) {
        t.advance(200);
        game.action(s, p0, { type: "taps", r: s.round, n: 3 }, t.ctx);
        if (i % 2) game.action(s, p1, { type: "taps", r: s.round, n: 3 }, t.ctx);
      }
      step(s, t);
      expected0 += full;
    } else if (type === "whack") {
      const pz = cur.pz as Extract<Puzzle, { t: "whack" }>;
      const order = pz.moles.map((m, i) => [m, i] as const).sort((a, b) => a[0][1] - b[0][1]);
      for (const [[, up], i] of order) {
        if (t.ctx.now() < s.opensAt + up) t.advance(s.opensAt + up - t.ctx.now());
        if (!pz.moles[i][3]) game.action(s, p0, { type: "whack", r: s.round, i }, t.ctx);
        else game.action(s, p1, { type: "whack", r: s.round, i }, t.ctx);
      }
      step(s, t);
      assert(phaseOf(s) === "result", "whack runs its time");
      expected0 += full;
    } else if (type === "spin") {
      const at = spinCentreAt(s, t);
      game.action(s, p1, wrongAction(s), t.ctx);
      t.advance(at - t.ctx.now());
      game.action(s, p0, { type: "stop", r: s.round, t: at }, t.ctx);
      game.action(s, p2, wrongAction(s), t.ctx);
      game.action(s, p3, wrongAction(s), t.ctx);
      assert(phaseOf(s) === "result", "spin ends once everyone stopped");
      expected0 += full;
    } else if (type === "green") {
      openAnswers(s, t);
      assert(viewOf(s, p0, t).puzzle?.t === "green" && (viewOf(s, p0, t).puzzle as { go: unknown }).go === null, "green: hidden go");
      game.action(s, p1, wrongAction(s), t.ctx); // jumps the gun
      goGreen(s, t);
      game.action(s, p0, { type: "hit", r: s.round }, t.ctx);
      t.advance(500);
      game.action(s, p2, { type: "hit", r: s.round }, t.ctx);
      game.action(s, p3, { type: "hit", r: s.round }, t.ctx);
      assert(phaseOf(s) === "result", "green ends once everyone tapped");
      expected0 += full;
    } else if (cur.answer === -1) {
      openAnswers(s, t);
      game.action(s, p1, wrongAction(s), t.ctx);
      step(s, t);
      expected0 += SIMON_HOLD_POINTS * cur.mult;
    } else {
      openAnswers(s, t);
      const right = rightAction(s, t)!;
      assert(game.action(s, p0, right, t.ctx) === true, `${type}: right answer accepted`);
      assert(game.action(s, p0, right, t.ctx) === false, `${type}: one answer only`);
      assert(game.action(s, p1, wrongAction(s), t.ctx) === true, `${type}: wrong answer accepted`);
      const v2 = viewOf(s, p2, t);
      assert(v2.answered.includes(p0) && v2.answered.includes(p1) && v2.you?.pick === null, "others see only flags");
      game.action(s, p2, wrongAction(s), t.ctx);
      assert(phaseOf(s) === "play", "still waiting for p3");
      game.action(s, p3, wrongAction(s), t.ctx);
      assert(phaseOf(s) === "result", `${type}: ends early once everyone answered`);
      expected0 += full;
    }
    const by = Object.fromEntries(s.last!.res.map((l) => [l.id, l]));
    if (type !== "tap" && type !== "clock") {
      assert(by[p0].ok === true && by[p0].pts === (cur.answer === -1 ? SIMON_HOLD_POINTS * cur.mult : full), `${type}: p0 perfect (${by[p0].pts})`);
      assert(by[p1].ok === false && by[p1].pts === 0, `${type}: p1 wrong`);
    }
    const res = viewOf(s, "spectator", t);
    assert(res.phase === "result" && res.last !== null && res.you === null, "result is public, spectators have no 'you'");
    t.advance(RESULT_MS);
    game.tick!(s, t.ctx);
  }

  assert(phaseOf(s) === "final" && s.over, "final after 12");
  assert(t.result !== null && ends() === 1, "ctx.end exactly once");
  assert(t.result.winners.length === 1 && t.result.winners[0] === p0, "p0 wins");
  assert(s.scores[p0] === expected0 && t.result.scores![p0] === expected0, `p0 scored ${expected0} (${s.scores[p0]})`);
  assert(s.recap.length === ROUNDS && s.recap.every((r) => r.best.includes(p0)), "recap names p0 every round");
  assert(game.action(s, p0, { type: "pick", r: s.round, c: 0 }, t.ctx) === false, "no actions after the end");
  t.advance(60_000);
  assert(game.tick!(s, t.ctx) === false && ends() === 1, "no ticks after the end");
}

// ---------- scoring: speed ----------
{
  const { t, s } = playOf(2, "math");
  const window = s.endsAt - s.opensAt;
  t.advance(window / 2);
  game.action(s, t.ids[0], rightAction(s, t)!, t.ctx);
  t.advance(window / 2 - 1);
  game.action(s, t.ids[1], rightAction(s, t)!, t.ctx);
  const [a, b] = s.last!.res;
  assert(a.pts === 150 * s.cur!.mult, `half time left = 150 (${a.pts})`);
  assert(b.pts === 100 * s.cur!.mult, `last instant = 100 (${b.pts})`);
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

// ---------- twists in play ----------
{
  // Reverse: any wrong answer scores; the real answer is the trap.
  for (const type of REVERSIBLE) {
    const { t, s } = playOf(3, type, 17, {}, "reverse");
    openAnswers(s, t);
    assert(viewOf(s, t.ids[0], t).micro?.twist === "reverse", "view says reverse");
    const ans = s.cur!.answer as number;
    const n = pickRange(s.cur!.pz);
    game.action(s, t.ids[0], { type: "pick", r: s.round, c: (ans + 1) % n }, t.ctx);
    game.action(s, t.ids[1], { type: "pick", r: s.round, c: ans }, t.ctx);
    step(s, t);
    const [a, b] = s.last!.res;
    assert(a.ok === true && a.pts > 0, `${type} reverse: a wrong answer scores`);
    assert(b.ok === false && b.pts === 0, `${type} reverse: the real answer is the trap`);
    assert(s.last!.twist === "reverse" && s.recap.at(-1)!.twist === "reverse", "result and recap remember the twist");
  }
  // Speed: less time.
  const sp = playOf(2, "math", 23, {}, "speed");
  assert(sp.s.endsAt - sp.s.phaseAt === Math.round(PLAY_MS.math * (1 - 0.15 * sp.s.cur!.level) * SPEED_SCALE), "speed twist cuts the time");
  // Double: ×2.
  const db = playOf(2, "ink", 23, {}, "double");
  openAnswers(db.s, db.t);
  game.action(db.s, db.t.ids[0], rightAction(db.s, db.t)!, db.t.ctx);
  assert(db.s.cur!.mult === 2 && db.s.answers[db.t.ids[0]].pts === 400, "double twist pays ×2");
}

// ---------- stop the clock: ranking with ties, the clamp, the cap ----------
{
  const { t, s } = playOf(5, "clock");
  const [a, b, c, d, e] = t.ids;
  const start = s.phaseAt;
  t.advance(5_100);
  const now = t.ctx.now();
  game.action(s, a, { type: "stop", r: s.round, t: start + 4_950 }, t.ctx);
  game.action(s, b, { type: "stop", r: s.round, t: start + 5_050 }, t.ctx);
  game.action(s, c, { type: "stop", r: s.round, t: now - 999_999 }, t.ctx);
  game.action(s, d, { type: "stop", r: s.round, t: now + 99_999 }, t.ctx);
  assert(s.answers[c].v === 5_100 - CLOCK_SLACK_MS, "stop time clamped to the slack window");
  assert(s.answers[d].v === 5_100, "stop time can't be in the future");
  step(s, t);
  const by = Object.fromEntries(s.last!.res.map((l) => [l.id, l]));
  assert(by[a].rank === 1 && by[b].rank === 1, "tie shares first");
  assert(by[a].pts === by[b].pts && by[a].pts === 200 * s.cur!.mult, "tied players get the same points");
  assert(by[d].rank === 3, "next rank skips (1, 1, 3)");
  assert(by[c].rank === 4 && by[c].pts > 0, "1.4s off still scores");
  assert(by[e].ok === null && by[e].pts === 0, "never stopped = 0");
}

// ---------- tap frenzy: rate cap, ties, no early end ----------
{
  const { t, s } = playOf(3, "tap");
  const [a, b, c] = t.ids;
  const r = s.round;
  for (let i = 0; i < 30; i++) assert(game.action(s, a, { type: "taps", r, n: 20 }, t.ctx) === false, "tap batches never broadcast");
  assert(s.taps[a] <= 3, `burst cap (${s.taps[a]})`);
  t.advance(1_000);
  for (let i = 0; i < 30; i++) game.action(s, a, { type: "taps", r, n: 20 }, t.ctx);
  assert(s.taps[a] === TAP_RATE + 3, `15/s cap (${s.taps[a]})`);
  assert(game.tick!(s, t.ctx) === true, "tick broadcasts the race");
  assert(game.tick!(s, t.ctx) === false, "not again right away");
  t.advance(3_900);
  for (let i = 0; i < 30; i++) game.action(s, a, { type: "taps", r, n: 20 }, t.ctx);
  game.action(s, b, { type: "taps", r, n: 5 }, t.ctx);
  game.action(s, c, { type: "taps", r, n: 5 }, t.ctx);
  assert(s.taps[a] === Math.floor((TAP_RATE * PLAY_MS.tap) / 1000), `total cap (${s.taps[a]})`);
  assert(game.action(s, a, { type: "taps", r, n: 21 }, t.ctx) === false, "oversize batch rejected");
  step(s, t);
  const by = Object.fromEntries(s.last!.res.map((l) => [l.id, l]));
  assert(by[a].rank === 1 && by[b].rank === 2 && by[c].rank === 2, "tie for second");
}

// ---------- shows: count flash, memory, what's missing, number flash ----------
for (const type of ["count", "memory", "gone", "digits"] as const) {
  const { t, s } = playOf(3, type);
  assert(s.opensAt - s.phaseAt === s.cur!.show && s.cur!.show > 0, `${type}: show stage`);
  const v = viewOf(s, t.ids[0], t);
  const pz = v.puzzle!;
  if (pz.t === "count") assert(pz.field !== null && pz.options === null, "count flash: field, no options");
  if (pz.t === "memory") assert(pz.seq !== null, "memory: sequence shown");
  if (pz.t === "gone") assert(pz.shown !== null && pz.left === null && pz.options === null, "gone: line-up, no options");
  if (pz.t === "digits") assert(pz.num !== null && pz.options === null, "digits: number, no options");
  assert(game.action(s, t.ids[0], rightAction(s, t)!, t.ctx) === false, `${type}: no answer during the show`);
  openAnswers(s, t);
  const after = viewOf(s, t.ids[0], t).puzzle!;
  if (after.t === "count") assert(after.field === null && after.options !== null, "count: options, no field");
  if (after.t === "memory") assert(after.seq === null, "memory: hidden for input");
  if (after.t === "gone") assert(after.shown === null && after.left !== null && after.options !== null, "gone: leftovers + options");
  if (after.t === "digits") assert(after.num === null && after.options !== null, "digits: options, no number");
  assert(game.action(s, t.ids[0], rightAction(s, t)!, t.ctx) === true, `${type}: answer after the show`);
  assert(s.answers[t.ids[0]].pts === 200 * s.cur!.mult, `${type}: speed measured from when answers open`);
  step(s, t);
  const rv = JSON.stringify(viewOf(s, t.ids[1], t).puzzle);
  assert(!rv.includes(":null"), `${type}: result shows everything again`);
}

// ---------- green light ----------
{
  const { t, s } = playOf(3, "green");
  const [a, b, c] = t.ids;
  openAnswers(s, t);
  const json = JSON.stringify(viewOf(s, b, t));
  assert(!json.includes(String(s.goAt)), "the go time never leaks early");
  game.action(s, a, { type: "hit", r: s.round }, t.ctx);
  t.advance(s.goAt - t.ctx.now() - 1);
  assert(game.tick!(s, t.ctx) === false, "still red");
  t.advance(1);
  assert(game.tick!(s, t.ctx) === true && s.goSent, "turns green with a broadcast");
  assert((viewOf(s, b, t).puzzle as { go: number }).go === s.goSentAt, "view shows green");
  t.advance(250);
  game.action(s, b, { type: "hit", r: s.round }, t.ctx);
  t.advance(1_000);
  game.action(s, c, { type: "hit", r: s.round }, t.ctx);
  const by = Object.fromEntries(s.last!.res.map((l) => [l.id, l]));
  assert(by[a].ok === false && by[a].pts === 0 && by[a].ms === null, "false start = 0");
  assert(by[b].pts === 200 * s.cur!.mult && by[b].ms === 250, "fast = 200");
  assert(by[c].pts === 100 * s.cur!.mult && by[c].ms === 1250, "slow = 100");
  assert(greenPoints(650) > 100 && greenPoints(650) < 200, "in between");
}

// ---------- simon says ----------
{
  let held = false;
  let said = false;
  for (let seed = 1; seed < 40 && !(held && said); seed++) {
    const { t, s } = playOf(4, "simon", seed);
    const [a, b, c, d] = t.ids;
    openAnswers(s, t);
    const ans = s.cur!.answer as number;
    const pz = s.cur!.pz as Extract<Puzzle, { t: "simon" }>;
    if (ans === -1) {
      held = true;
      assert(pz.lead !== SIMON_SAYS, "not Simon");
      game.action(s, a, { type: "pick", r: s.round, c: pz.ask }, t.ctx);
      t.ctx.player(d)!.connected = false;
      assert(phaseOf(s) === "play", "simon: waits");
      step(s, t);
      const by = Object.fromEntries(s.last!.res.map((l) => [l.id, l]));
      assert(by[a].ok === false && by[a].pts === 0, "simon: tapping when he didn't say = 0");
      assert(by[b].ok === true && by[b].pts === SIMON_HOLD_POINTS * s.cur!.mult && by[c].pts === by[b].pts, "simon: hands off scores");
      assert(by[d].ok === null && by[d].pts === 0, "simon: gone players don't score for holding still");
    } else {
      said = true;
      assert(pz.lead === SIMON_SAYS, "Simon says");
      game.action(s, a, { type: "pick", r: s.round, c: ans }, t.ctx);
      game.action(s, b, { type: "pick", r: s.round, c: (ans + 1) % 4 }, t.ctx);
      step(s, t);
      const by = Object.fromEntries(s.last!.res.map((l) => [l.id, l]));
      assert(by[a].pts === 200 * s.cur!.mult && by[b].pts === 0 && by[c].ok === null && by[c].pts === 0, "simon says: normal scoring");
    }
  }
  assert(held && said, "both kinds of Simon round seen");
}

// ---------- whack-a-mole ----------
{
  const { t, s } = playOf(3, "whack");
  const [a, b, c] = t.ids;
  const pz = s.cur!.pz as Extract<Puzzle, { t: "whack" }>;
  const r = s.round;
  const moles = pz.moles.map((m, i) => ({ m, i })).filter(({ m }) => !m[3]);
  const bombs = pz.moles.map((m, i) => ({ m, i })).filter(({ m }) => m[3]);
  // Before a mole is up: rejected.
  const first = moles[1];
  game.action(s, a, { type: "whack", r, i: first.i }, t.ctx);
  assert(!(s.whacks[a] ?? []).includes(first.i), "can't whack a mole that isn't up");
  for (const h of [-1, pz.moles.length, 1.5, "0", null]) game.action(s, a, { type: "whack", r, i: h } as BlitzAction, t.ctx);
  assert((s.whacks[a] ?? []).length === 0, "junk whacks rejected");
  const all = [...pz.moles.entries()].sort((x, y) => x[1][1] - y[1][1]);
  for (const [i, m] of all) {
    if (t.ctx.now() < s.opensAt + m[1]) t.advance(s.opensAt + m[1] - t.ctx.now());
    if (!m[3]) {
      game.action(s, a, { type: "whack", r, i }, t.ctx);
      game.action(s, a, { type: "whack", r, i }, t.ctx); // twice: counts once
    }
    if (i === moles[0].i || m[3]) game.action(s, b, { type: "whack", r, i }, t.ctx);
  }
  assert(s.whacks[a].length === moles.length, "each mole counts once");
  assert(phaseOf(s) === "play", "whack runs its full time");
  step(s, t);
  const by = Object.fromEntries(s.last!.res.map((l) => [l.id, l]));
  const mult = s.cur!.mult;
  assert(by[a].pts === 200 * mult && by[a].v === moles.length, "clean sweep = 200");
  assert(by[b].pts === Math.max(0, molePoints(moles.length) - bombs.length * WHACK_BOMB_PENALTY) * mult, "bombs cost points");
  assert(by[b].ok === (by[b].pts > 0 ? true : false), "bomb-only whacker missed");
  assert(by[c].ok === null && by[c].pts === 0, "no whacks = null");
}

// ---------- spin stop ----------
{
  const { t, s } = playOf(4, "spin");
  const [a, b, c, d] = t.ids;
  const pz = s.cur!.pz as Extract<Puzzle, { t: "spin" }>;
  const at = spinCentreAt(s, t);
  t.advance(at - t.ctx.now() + 50);
  game.action(s, a, { type: "stop", r: s.round, t: at }, t.ctx);
  // Edge of the zone: one step in from the boundary.
  const edgeMs = ((pz.width / 2 - 1) / 360) * pz.period;
  game.action(s, b, { type: "stop", r: s.round, t: at - edgeMs }, t.ctx);
  game.action(s, c, { type: "stop", r: s.round, t: at - pz.period / 2 }, t.ctx);
  const by = Object.fromEntries(Object.entries(s.answers));
  assert(by[a].pts === 200 * s.cur!.mult && by[a].ok, "dead centre = 200");
  assert(by[b].ok && by[b].pts > 100 * s.cur!.mult && by[b].pts < 120 * s.cur!.mult, `edge ≈ 100 (${by[b].pts})`);
  assert(!by[c].ok && by[c].pts === 0, "opposite side misses");
  assert(Math.round(spinAngle(pz, at - s.opensAt)) % 360 === pz.zone % 360 || angleGap(spinAngle(pz, at - s.opensAt), pz.zone) < 0.01, "helper");
  assert(spinPoints(0, 40) === 200 && spinPoints(20, 40) === 100 && spinPoints(21, 40) === 0, "spin points");
  game.action(s, d, { type: "stop", r: s.round, t: -1e12 }, t.ctx);
  assert(s.answers[d].v !== null, "clamped, still recorded");
}

// ---------- spot the difference: either grid, same index ----------
{
  const { t, s } = playOf(2, "spot");
  openAnswers(s, t);
  assert(game.action(s, t.ids[0], { type: "pick", r: s.round, c: (s.cur!.pz as { a: string[] }).a.length }, t.ctx) === false, "out of range");
  assert(game.action(s, t.ids[0], { type: "pick", r: s.round, c: s.cur!.answer as number }, t.ctx), "in range");
}

// ---------- find the pair ----------
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
  const n = (s.cur!.pz as { cells: string[] }).cells.length;
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
    { type: "pick", r, c: n },
    { type: "pick", r, c: NaN },
    { type: "pick", r, c: Infinity },
    { type: "pick", r: r + 1, c: 0 },
    { type: "pick", r: String(r), c: 0 },
    { type: "pair", r, a: 0, b: 1 },
    { type: "seq", r, seq: [0, 1, 2, 3] },
    { type: "stop", r, t: 0 },
    { type: "taps", r, n: 1 },
    { type: "hit", r },
    { type: "whack", r, i: 0 },
    { type: "__proto__", r, c: 0 },
    { type: "pick", r, c: { valueOf: 3 } },
    { type: "x".repeat(10_000), r, c: 0 },
  ];
  for (const h of hostile) assert(game.action(s, a, h as BlitzAction, t.ctx) === false, `rejects ${JSON.stringify(h)?.slice(0, 60)}`);
  assert(Object.keys(s.answers).length === 0, "nothing landed");
  assert(game.action(s, "stranger", { type: "pick", r, c: 0 }, t.ctx) === false, "non-players can't answer");
  assert(game.action(s, "__proto__", { type: "pick", r, c: 0 }, t.ctx) === false, "weird ids can't answer");
  t.advance(s.endsAt - t.ctx.now());
  assert(game.action(s, a, { type: "pick", r, c: 0 }, t.ctx) === false, "too late");
}
for (const type of NEW_KINDS) {
  // Every new kind rejects the wrong action shapes.
  const { t, s } = playOf(2, type, 29);
  openAnswers(s, t);
  const r = s.round;
  const bad: unknown[] = [
    { type: "pick", r, c: 99 },
    { type: "pair", r, a: 0, b: 1 },
    { type: "seq", r, seq: [0] },
    { type: "taps", r, n: 1 },
    ...(type === "green" ? [] : [{ type: "hit", r }]),
    ...(type === "whack" ? [] : [{ type: "whack", r, i: 0 }]),
    ...(type === "spin" ? [] : [{ type: "stop", r, t: t.ctx.now() }]),
    { type: "stop", r, t: "x" },
  ];
  for (const h of bad) assert(game.action(s, t.ids[0], h as BlitzAction, t.ctx) === false, `${type} rejects ${JSON.stringify(h)}`);
  assert(Object.keys(s.answers).length === 0 && Object.keys(s.whacks).length === 0, `${type}: nothing landed`);
}

// ---------- secrecy for every kind ----------
for (const type of MICRO_TYPES) {
  const { t, s } = playOf(3, type, 5);
  const [a, b] = t.ids;
  openAnswers(s, t);
  if (type !== "tap" && type !== "clock" && type !== "whack") game.action(s, a, wrongAction(s), t.ctx);
  for (const viewer of [b, "spectator"]) {
    const v = viewOf(s, viewer, t);
    const json = JSON.stringify(v);
    assert(!/"answer"/.test(json) && v.last === null, `${type}: no answer in play view`);
    assert(v.you === null || v.you.pick === null, `${type}: others' picks never leak`);
    assert(json.length < 4_000, `${type}: play view small (${json.length})`);
  }
  if (phaseOf(s) !== "result") step(s, t);
  stepTo(s, t, "ready", s.round + 1);
  const nextPz = JSON.stringify(s.cur!.pz);
  const rv = JSON.stringify(viewOf(s, b, t));
  assert(!rv.includes(nextPz) && viewOf(s, b, t).puzzle === null, `ready after ${type}: puzzle hidden`);
}

// ---------- disconnects never stall ----------
{
  const t = makeTestCtx(3, 9);
  const ends = countEnds(t);
  const s: BlitzState = game.setup(t.ctx);
  const [a, b, c] = t.ids;
  for (const id of [a, b, c]) t.ctx.player(id)!.connected = false;
  stepTo(s, t, "final");
  assert(t.result !== null && ends() === 1, "game ends with nobody around");
  assert(t.result.winners.length === 0 && /nobody/i.test(t.result.headline), "no points, no winners (nobody to hold still for Simon)");
}

// ---------- host settings ----------
{
  const t = makeTestCtx(2, 7, { rounds: 6, pace: "relaxed" });
  const s: BlitzState = game.setup(t.ctx);
  assert(s.rounds === 6 && s.order.length === 6, "6 microgames");
  let doubles = 0;
  let guard = 0;
  while (!t.result && guard++ < 200) {
    if (phaseOf(s) === "ready" && finaleMult(s.round, 6, "double") === 2) doubles++;
    if (phaseOf(s) === "play" && s.phaseAt === t.ctx.now()) {
      const cur = s.cur!;
      assert(s.endsAt - s.phaseAt === playLength(cur, 1.5), `relaxed pace stretches ${cur.type}`);
      if (!FIXED_LENGTH.includes(cur.type)) assert(playLength(cur, 1.5) > playLength(cur, 1), "relaxed is longer");
    }
    step(s, t);
  }
  assert(t.result && s.recap.length === 6, "6-microgame match ends after 6");
  assert(doubles === 3, "last 3 still double");
  const bad = game.setup(makeTestCtx(2, 7, { rounds: 99, mix: "lol", finale: 3 }).ctx);
  assert(bad.rounds === ROUNDS && bad.pace === 1 && bad.mix === "all" && bad.finale === "double", "invalid settings fall back to defaults");
}
for (const mix of ["brainy", "reflex", "chaos"] as const) {
  for (let seed = 1; seed < 30; seed++) {
    const s = game.setup(makeTestCtx(2, seed, { mix, rounds: 18 }).ctx);
    assert(s.order.every((k) => kindsFor(mix).includes(k)), `${mix}: kinds honoured`);
    assert(s.order.every((k, i) => i === 0 || s.order[i - 1] !== k), `${mix}: no back-to-back`);
  }
}
{
  // Boss finale: the last microgame is ×3 and maxed out; nothing else is doubled by the finale.
  const t = makeTestCtx(2, 8, { finale: "boss", rounds: 6 });
  const s: BlitzState = game.setup(t.ctx);
  stepTo(s, t, "ready", 6);
  assert(s.cur!.boss && s.cur!.mult === 3 && s.cur!.level === 1, "boss round");
  assert(viewOf(s, t.ids[0], t).micro?.boss === true && viewOf(s, t.ids[0], t).finale === "boss", "view knows");
  assert(s.recap.every((r) => r.mult === (r.twist === "double" ? 2 : 1)), "no finale doubles before the boss");
  const none = makeTestCtx(2, 8, { finale: "none", rounds: 6 });
  const s2: BlitzState = game.setup(none.ctx);
  stepTo(s2, none, "final");
  assert(s2.recap.every((r) => r.mult === (r.twist === "double" ? 2 : 1)), "finale off: no ×2 rounds");
}

// ---------- room memory: fresh kinds and puzzles next game ----------
{
  const memory: Record<string, unknown> = {};
  const s1 = game.setup(makeTestCtx(2, 1, {}, 0, memory).ctx);
  const s2 = game.setup(makeTestCtx(2, 2, {}, 0, memory).ctx);
  assert(s2.order.every((k) => !s1.order.includes(k)), "second game opens with kinds the first didn't play");
  // Puzzle content isn't repeated soon.
  const seen: string[] = [];
  const r = rng(5);
  const words = Array.from({ length: 40 }, () => generateFresh("spell", r, 0.5, seen).key);
  assert(new Set(words).size === 40, "40 spellings in a row without a repeat");
  for (let i = 0; i < 500; i++) generateFresh("math", r, 0.5, seen, 300);
  assert(seen.length === 300, "memory is capped");
  // Across games in a room, puzzles are remembered.
  const mem: Record<string, unknown> = {};
  for (let g = 0; g < 3; g++) {
    const t = makeTestCtx(1, 100 + g, {}, 0, mem);
    const s: BlitzState = game.setup(t.ctx);
    stepTo(s, t, "final");
  }
  const keys = mem.seen as string[];
  assert(Array.isArray(keys) && keys.length > 10 && new Set(keys).size === keys.length, "no repeated puzzle keys across 3 games");
  // Junk memory is repaired, never trusted.
  const junk = { kinds: [1, null, { x: 1 }], seen: "nope" } as Record<string, unknown>;
  const sj = game.setup(makeTestCtx(1, 3, {}, 0, junk).ctx);
  assert(sj.order.length === ROUNDS && Array.isArray(junk.kinds), "junk memory ignored");
}

// ---------- practice bots play every kind ----------
{
  const botKinds = new Map<MicroType, { acted: number; scored: number }>();
  let games = 0;
  for (const [humans, bots, seed, settings] of [
    [1, 2, 5, { rounds: 18 }],
    [0, 4, 9, { rounds: 18, mix: "chaos", finale: "boss" }],
    [0, 3, 21, { rounds: 18, mix: "brainy" }],
    [0, 3, 22, { rounds: 18, mix: "reflex" }],
    [0, 3, 23, { rounds: 18 }],
    [0, 3, 24, { rounds: 18 }],
  ] as const) {
    const t = makeTestCtx(humans + bots, seed, settings, bots);
    const s: BlitzState = game.setup(t.ctx);
    let ms = 0;
    let early = 0;
    while (!t.result && ms < 10 * 60_000) {
      t.advance(100);
      ms += 100;
      game.tick!(s, t.ctx);
      for (const p of t.ctx.players) {
        if (!p.bot) continue;
        const a = game.bot!(s, p.id, t.ctx);
        if (!a) continue;
        if (phaseOf(s) !== "play" || t.ctx.now() < s.opensAt) early++;
        const type = s.cur!.type;
        const before = JSON.stringify([s.answers[p.id], s.whacks[p.id], s.taps[p.id]]);
        game.action(s, p.id, a, t.ctx);
        const after = JSON.stringify([s.answers[p.id], s.whacks[p.id], s.taps[p.id]]);
        const k = botKinds.get(type) ?? { acted: 0, scored: 0 };
        if (before !== after) k.acted++;
        botKinds.set(type, k);
      }
      if (phaseOf(s) === "result" && s.phaseAt === t.ctx.now()) {
        const k = botKinds.get(s.last!.type) ?? { acted: 0, scored: 0 };
        k.scored += s.last!.res.filter((l) => l.id.startsWith("bot-") && l.pts > 0).length;
        botKinds.set(s.last!.type, k);
      }
    }
    games++;
    assert(t.result, `bots finish a match (${humans}+${bots}, ${JSON.stringify(settings)})`);
    assert(early === 0, "bots wait for answers to open");
    const botIds = t.ctx.players.filter((p) => p.bot).map((p) => p.id);
    assert(botIds.reduce((sum, id) => sum + (t.result!.scores?.[id] ?? 0), 0) > 0, "bots score points");
    // Medium skill: they score, but they miss and fumble some (and never max out).
    const misses = s.recap.length * botIds.length - botIds.reduce((n, id) => n + (s.hits[id] ?? 0), 0);
    assert(misses >= 2, `bots aren't perfect (${misses} misses)`);
  }
  for (const type of MICRO_TYPES) {
    const k = botKinds.get(type);
    if (!k) continue; // not dealt in these games
    if (type !== "simon") assert(k.acted > 0, `bots play ${type}`);
    if (k.acted >= 6) assert(k.scored > 0, `bots sometimes score at ${type}`);
  }
  assert(botKinds.size >= 24, `bots met most kinds (${botKinds.size})`);
  assert(games === 6, "all bot games ran");
}
// Bots solve each new kind from their own view (and get most of them right).
for (const type of NEW_KINDS) {
  let right = 0;
  let tries = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const t = makeTestCtx(2, seed * 7, {}, 1);
    const s: BlitzState = game.setup(t.ctx);
    const idx = s.order.indexOf(type);
    if (idx < 0 || idx === s.rounds - 1) continue;
    s.twists = s.twists.map(() => null);
    stepTo(s, t, "play", idx + 1);
    const bot = t.ctx.players.find((p) => p.bot)!.id;
    while (phaseOf(s) === "play") {
      t.advance(100);
      game.tick!(s, t.ctx);
      const a = game.bot!(s, bot, t.ctx);
      if (a) game.action(s, bot, a, t.ctx);
    }
    tries++;
    if ((s.last!.res.find((l) => l.id === bot)?.pts ?? 0) > 0) right++;
  }
  if (tries >= 8) assert(right / tries >= 0.45, `bot at ${type}: ${right}/${tries}`);
}
assert(nextOf([2, 4, 8, 16]) === 32 && nextOf([3, 7, 11, 15]) === 19 && nextOf([1, 4, 9, 16]) === 25 && nextOf([2, 3, 5, 8, 13]) === 21, "nextOf rules");

console.log("✓ blitz tests passed");
