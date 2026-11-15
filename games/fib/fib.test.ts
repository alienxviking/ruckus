import { assert, makeTestCtx } from "../../shared/testing";
import { topScorers } from "../../shared/game";
import game, { type FibErrorEvent, type FibState, type FibView, type Phase } from "./server";
import { FACTS } from "./data";
import {
  BLANK,
  HOLD_MS,
  MAX_LIE,
  MIN_OPTIONS,
  PICK_MS,
  POINTS,
  REVEAL_CAP_MS,
  ROUNDS,
  SHORT_GRACE_MS,
  STEP_MS,
  WRITE_MS,
  cleanLie,
  displayText,
  lieProblem,
  normalize,
  sameText,
  truthMatch,
} from "./shared";

type T = ReturnType<typeof makeTestCtx>;

// ---------- helpers ----------

function start(n: number, seed = 42) {
  const t = makeTestCtx(n, seed);
  const s: FibState = game.setup(t.ctx);
  return { t, s };
}

const view = (t: T, s: FibState, id: string) => game.view(s, id, t.ctx) as FibView;
const fact = (s: FibState) => FACTS[s.factOrder[s.round - 1]];
const truthIndex = (s: FibState) => s.options.findIndex((o) => o.kind === "truth");
const tick = (t: T, s: FibState) => game.tick!(s, t.ctx);
/** Read the phase without TypeScript narrowing it (it changes behind our back). */
const phaseOf = (s: FibState): Phase => s.phase;

/** Make the current round use a specific fact. */
function setFact(s: FibState, answer: string) {
  const i = FACTS.findIndex((f) => f.answer === answer);
  assert(i >= 0, `fact ${answer} exists`);
  s.factOrder[s.round - 1] = i;
}

function setOnline(t: T, s: FibState, id: string, online: boolean) {
  const p = t.ctx.players.find((x) => x.id === id)!;
  p.connected = online;
  if (online) game.playerReturned!(s, id, t.ctx);
  else game.playerLeft!(s, id, t.ctx);
}

/** Fibs that can't collide with any answer. */
const fibFor = (round: number, i: number) => `zq fib ${round} ${i}`;

function errorsFor(t: T, id: string): FibErrorEvent[] {
  return t.events.filter((e) => e.to === id).map((e) => e.event as FibErrorEvent);
}

/** Finish the reveal and move on (next round or final). */
function finishReveal(t: T, s: FibState) {
  assert(phaseOf(s) === "reveal", "in reveal");
  t.advance(s.endsAt - t.ctx.now());
  tick(t, s);
}

function roundTrip<V>(v: V): V {
  return JSON.parse(JSON.stringify(v));
}

// ---------- content ----------
{
  assert(FACTS.length >= 70, `at least 70 facts (have ${FACTS.length})`);
  const prompts = new Set<string>();
  for (const f of FACTS) {
    const label = `fact "${f.prompt}"`;
    assert(f.prompt.split(BLANK).length === 2, `${label}: exactly one blank`);
    assert(!prompts.has(f.prompt), `${label}: unique prompt`);
    prompts.add(f.prompt);
    assert(lieProblem(f.answer) === null, `${label}: answer is valid text`);
    assert(cleanLie(f.answer) === f.answer, `${label}: answer is clean`);
    const words = f.answer.split(" ").length;
    assert(words >= 1 && words <= 3, `${label}: answer is 1-3 words`);
    assert([...f.answer].length <= MAX_LIE, `${label}: answer fits`);
    const answers = [f.answer, ...(f.alts ?? [])];
    assert(f.decoys.length === 3, `${label}: three decoys`);
    const norms = f.decoys.map(normalize);
    assert(new Set(norms).size === 3, `${label}: distinct decoys`);
    for (const d of f.decoys) {
      assert(lieProblem(d) === null, `${label}: decoy "${d}" is valid text`);
      assert(truthMatch(d, answers) === null, `${label}: decoy "${d}" is not (close to) a true answer`);
      for (const other of f.decoys) if (other !== d) assert(!sameText(normalize(d), normalize(other)), `${label}: decoys differ`);
    }
    for (const a of f.alts ?? []) assert(normalize(a).length > 0, `${label}: alt "${a}" normalizes`);
    // The answer itself must be refused as a fib.
    assert(truthMatch(f.answer, answers) === "exact", `${label}: answer matches itself`);
    assert(truthMatch(f.answer.toUpperCase() + "!", answers) === "exact", `${label}: case/punctuation-insensitive`);
  }
}

// ---------- text helpers ----------
{
  assert(cleanLie("  a\u0000  flock \n of  birds...  ") === "a flock of birds", "cleanLie collapses and trims");
  assert(normalize("The Flock!") === "flock", "normalize drops articles and punctuation");
  assert(normalize("Brad’s Drink") === normalize("brads drink"), "apostrophes ignored");
  assert(truthMatch("flamboyances", ["flamboyance"]) === "exact", "plural is the truth");
  assert(truthMatch("flamboyanse", ["flamboyance"]) === "close", "one typo on a long answer is too close");
  assert(truthMatch("blew", ["blue"]) === null, "short answers need an exact match");
  assert(truthMatch("a flock", ["flamboyance", "flock"]) === "exact", "alts count as the truth");
  assert(displayText("the GREAT  pyramid.") === "The Great Pyramid", "options are Title Case");
  assert(lieProblem("") !== null && lieProblem("   ") !== null, "empty fib refused");
  assert(lieProblem("x".repeat(MAX_LIE + 1)) !== null, "long fib refused");
  assert(lieProblem("x".repeat(MAX_LIE)) === null, "max-length fib ok");
  assert(lieProblem("🙂🙂") !== null, "emoji-only fib refused");
  assert(lieProblem("...") !== null, "punctuation-only fib refused");
}

// ---------- a full game, with scoring checked every round ----------
{
  const { t, s } = start(4);
  const ids = t.ids;
  assert(phaseOf(s) === "write" && s.round === 1 && s.totalRounds === ROUNDS, "starts in round 1 write");
  assert(new Set(s.factOrder).size === ROUNDS, "six different facts");
  const expected = [0, 0, 0, 0];
  for (let r = 1; r <= ROUNDS; r++) {
    assert(phaseOf(s) === "write" && s.round === r, `round ${r} write`);
    ids.forEach((id, i) => assert(game.action(s, id, { type: "lie", text: fibFor(r, i) }, t.ctx) === true, "fib accepted"));
    assert(phaseOf(s) === "pick", "everyone in -> pick early");
    assert(s.options.length === 5, "truth + 4 fibs, no decoys needed");
    const truth = truthIndex(s);
    const fibOf = (i: number) => s.options.findIndex((o) => o.authors.includes(i));
    // p0 and p1 find the truth; p2 falls for p3's fib; p3 falls for p0's fib.
    game.action(s, ids[0], { type: "pick", option: truth }, t.ctx);
    game.action(s, ids[1], { type: "pick", option: truth }, t.ctx);
    game.action(s, ids[2], { type: "pick", option: fibOf(3) }, t.ctx);
    assert(phaseOf(s) === "pick", "still waiting for p3");
    game.action(s, ids[3], { type: "pick", option: fibOf(0) }, t.ctx);
    assert(phaseOf(s) === "reveal", "everyone picked -> reveal early");
    expected[0] += POINTS.truth + POINTS.fooled;
    expected[1] += POINTS.truth;
    expected[3] += POINTS.fooled;
    assert(JSON.stringify(s.scores) === JSON.stringify(expected), `round ${r} scores ${s.scores} vs ${expected}`);
    const h = s.history[s.history.length - 1];
    assert(h.round === r && h.answer === fact(s).answer, "summary recorded");
    assert(h.points[ids[0]] === POINTS.truth + POINTS.fooled, "round points recorded");
    assert(h.steps[h.steps.length - 1] === truth, "truth revealed last");
    assert(h.steps.length === 3, "two picked fibs + truth");
    assert(s.stepMs <= STEP_MS && s.stepMs * h.steps.length <= REVEAL_CAP_MS, "reveal timing capped");
    assert(t.result === null, "not over yet");
    // Reveal doesn't end early.
    t.advance(h.steps.length * s.stepMs + HOLD_MS - 10);
    tick(t, s);
    assert(phaseOf(s) === "reveal", "reveal holds until its deadline");
    t.advance(10);
    tick(t, s);
  }
  assert(phaseOf(s) === "final", "final after six rounds");
  assert(t.result !== null, "ctx.end called");
  const res = t.result!;
  assert(res.winners.length === 1 && res.winners[0] === ids[0], "p0 wins");
  assert(res.scores?.[ids[0]] === 6 * (POINTS.truth + POINTS.fooled), "final scores reported");
  assert(/Player0 wins Fib Finder/.test(res.headline), `headline: ${res.headline}`);
  assert(JSON.stringify(res.winners) === JSON.stringify(topScorers(res.scores!)), "winners = top scorers");
  const v = view(t, s, ids[1]);
  assert(v.awards !== null, "awards at the end");
  assert(v.awards!.liar.count === 6 && v.awards!.liar.ids.length === 2, "p0 and p3 tie for best liar (6 fooled each)");
  assert(v.awards!.detector.count === 6 && v.awards!.detector.ids.join() === "p0,p1", "p0 and p1 found every truth");
  // After the end, everything is ignored.
  const before = JSON.stringify(s);
  assert(game.action(s, ids[0], { type: "lie", text: "late" }, t.ctx) === false, "actions ignored after end");
  assert(game.action(s, ids[0], { type: "pick", option: 0 }, t.ctx) === false, "picks ignored after end");
  t.advance(60_000);
  assert(!tick(t, s), "ticks do nothing after end");
  setOnline(t, s, ids[2], false);
  assert(JSON.stringify(s) === before, "state frozen after end");
  // ctx.end exactly once: a second end attempt can't happen because phase is final.
  const firstResult = t.result;
  tick(t, s);
  assert(t.result === firstResult, "result unchanged");
}

// ---------- timeouts drive every phase ----------
{
  const { t, s } = start(3, 7);
  assert(s.endsAt === t.ctx.now() + WRITE_MS, "write deadline");
  t.advance(WRITE_MS - 1);
  assert(!tick(t, s) && phaseOf(s) === "write", "write still open");
  t.advance(1);
  assert(tick(t, s) === true && phaseOf(s) === "pick", "write times out into pick");
  assert(s.options.length === MIN_OPTIONS, "no fibs: truth + 3 house decoys");
  assert(s.options.filter((o) => o.kind === "house").length === 3, "three decoys");
  assert(s.endsAt === t.ctx.now() + PICK_MS, "pick deadline");
  t.advance(PICK_MS);
  tick(t, s);
  assert(phaseOf(s) === "reveal", "pick times out into reveal");
  const h = s.history[0];
  assert(h.steps.length === 1 && s.options[h.steps[0]].kind === "truth", "only the truth to reveal when nobody picked");
  assert(Object.values(h.points).every((p) => p === 0), "nobody scored");
  assert(s.stepMs === STEP_MS, "single step gets the full step time");
  finishReveal(t, s);
  assert(phaseOf(s) === "write" && s.round === 2, "next round");
  // Let the rest of the game time out completely.
  for (let guard = 0; guard < 100 && phaseOf(s) !== "final"; guard++) {
    t.advance(60_000);
    tick(t, s);
  }
  assert(phaseOf(s) === "final", "game ends by timeouts alone");
  assert(t.result !== null && t.result.winners.length === 0, "no winners when nobody scored");
  assert(/Nobody scored/.test(t.result.headline), `headline: ${t.result.headline}`);
}

// ---------- truth checks & resubmission ----------
{
  const { t, s } = start(3);
  setFact(s, "flamboyance");
  const [a, b] = t.ids;
  const tries = ["flamboyance", "  The FLAMBOYANCE!! ", "flamboyances", "a stand", "Flock"];
  for (const text of tries) {
    t.events.length = 0;
    assert(game.action(s, a, { type: "lie", text }, t.ctx) === false, `"${text}" refused`);
    const ev = errorsFor(t, a);
    assert(ev.length === 1 && ev[0].type === "fib-error" && ev[0].truth, `"${text}" -> private truth event`);
    assert(/actually the truth/.test(ev[0].message), "truth message");
    assert(s.lies[0] === null, "no state change");
  }
  t.events.length = 0;
  assert(game.action(s, a, { type: "lie", text: "flamboyanse" }, t.ctx) === false, "near-miss refused");
  assert(/too close/.test(errorsFor(t, a)[0].message), "too-close message");
  assert(t.events.every((e) => e.to === a), "events only go to the writer");

  assert(game.action(s, a, { type: "lie", text: "  a   fiesta. " }, t.ctx) === true, "fib accepted");
  assert(s.lies[0] === "a fiesta", "fib cleaned");
  assert(game.action(s, a, { type: "lie", text: "a fiesta" }, t.ctx) === false, "same fib again is a no-op");
  assert(game.action(s, a, { type: "lie", text: "a carnival" }, t.ctx) === true, "fib can be changed");
  assert(String(s.lies[0]) === "a carnival", "fib updated");
  assert(phaseOf(s) === "write", "others still writing");
  assert(view(t, s, a).myLie === "a carnival", "own fib in own view");
  assert(view(t, s, b).myLie === null, "not in others' views");
}

// ---------- hostile input ----------
{
  const { t, s } = start(3);
  const [a] = t.ids;
  const snapshot = () => JSON.stringify(s);
  const before = snapshot();
  const bad: unknown[] = [
    null,
    undefined,
    "lie",
    42,
    [],
    ["lie", "x"],
    {},
    { type: "LIE", text: "x" },
    { type: "lie" },
    { type: "lie", text: 7 },
    { type: "lie", text: null },
    { type: "lie", text: ["x"] },
    { type: "lie", text: { toString: () => "x" } },
    { type: "lie", text: "" },
    { type: "lie", text: "   " },
    { type: "lie", text: "\u0000\u0007" },
    { type: "lie", text: "x".repeat(41) },
    { type: "lie", text: "x".repeat(100_000) },
    { type: "lie", text: "😈😈😈" },
    { type: "lie", text: "<script>" },
    { type: "pick", option: 0 }, // wrong phase
    { type: "__proto__", text: "x" },
  ];
  for (const a2 of bad) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert(game.action(s, a, a2 as any, t.ctx) === false, `rejected ${JSON.stringify(a2)?.slice(0, 40)}`);
  }
  assert(game.action(s, "stranger", { type: "lie", text: "zz" }, t.ctx) === false, "spectator can't act");
  assert(game.action(s, "spectator", { type: "lie", text: "zz" }, t.ctx) === false, "spectator can't act");
  assert(snapshot() === before, "no state change from hostile input");

  // Into the pick phase.
  t.ids.forEach((id, i) => game.action(s, id, { type: "lie", text: fibFor(1, i) }, t.ctx));
  assert(phaseOf(s) === "pick", "pick");
  const pickBefore = snapshot();
  const own = s.options.findIndex((o) => o.authors.includes(0));
  const badPicks: unknown[] = [
    { type: "pick" },
    { type: "pick", option: -1 },
    { type: "pick", option: s.options.length },
    { type: "pick", option: 1.5 },
    { type: "pick", option: NaN },
    { type: "pick", option: Infinity },
    { type: "pick", option: "0" },
    { type: "pick", option: null },
    { type: "pick", option: [0] },
    { type: "pick", option: 1e308 },
    { type: "pick", option: own }, // own fib
    { type: "lie", text: "too late" }, // wrong phase
  ];
  for (const p of badPicks) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert(game.action(s, a, p as any, t.ctx) === false, `rejected ${JSON.stringify(p)}`);
  }
  assert(snapshot() === pickBefore, "no state change from bad picks");
  const truth = truthIndex(s);
  assert(game.action(s, a, { type: "pick", option: truth }, t.ctx) === true, "valid pick");
  const other = s.options.findIndex((o) => o.authors.includes(1));
  assert(game.action(s, a, { type: "pick", option: other }, t.ctx) === false, "picks are final");
  assert(s.picks[0] === truth, "first pick kept");
}

// ---------- secrecy ----------
{
  const { t, s } = start(4, 3);
  setFact(s, "puffling");
  const [a, b, c, d] = t.ids;
  game.action(s, a, { type: "lie", text: "Secret Alpha" }, t.ctx);
  game.action(s, b, { type: "lie", text: "Secret Bravo" }, t.ctx);
  for (const viewer of [b, c, "spectator"]) {
    const json = JSON.stringify(view(t, s, viewer)).toLowerCase();
    assert(!json.includes("secret alpha"), `write: ${viewer} can't see p0's fib`);
    assert(!json.includes("puffling"), `write: ${viewer} can't see the answer`);
    assert(!json.includes("pufflet") && !json.includes("chickling"), `write: no decoys yet`);
  }
  const vc = view(t, s, c);
  assert(vc.submitted.join() === "p0,p1", "only who submitted is visible");
  assert(vc.options.length === 0 && vc.history.length === 0, "nothing else leaks in write");

  game.action(s, c, { type: "lie", text: "Secret Charlie" }, t.ctx);
  game.action(s, d, { type: "lie", text: "Secret Delta" }, t.ctx);
  assert(phaseOf(s) === "pick", "pick");
  for (const viewer of [a, b, c, d, "spectator"]) {
    const v = view(t, s, viewer);
    for (const o of v.options) assert(Object.keys(o).sort().join() === "id,text", "options carry only id and text");
    const json = JSON.stringify(v);
    assert(!/authors|kind|truth|house|pickers/.test(json), `pick: no authorship or truth flags for ${viewer}`);
    assert(v.history.length === 0, "no summary before the reveal");
  }
  const va = view(t, s, a);
  assert(!va.options.some((o) => o.text === "Secret Alpha"), "own fib hidden from own options");
  assert(va.options.length === s.options.length - 1, "everything else is there");
  assert(view(t, s, "spectator").options.length === s.options.length, "spectators see every option");
  assert(view(t, s, "spectator").myLie === null, "spectators have no fib");
  // Ids are positions in a shuffled list: the truth isn't always first.
  const truthPositions = new Set<number>();
  for (let seed = 1; seed <= 30; seed++) {
    const g = start(3, seed);
    g.t.advance(WRITE_MS);
    tick(g.t, g.s);
    truthPositions.add(truthIndex(g.s));
  }
  assert(truthPositions.size >= 3, "truth position varies");

  game.action(s, a, { type: "pick", option: truthIndex(s) }, t.ctx);
  const vb = view(t, s, b);
  assert(vb.picked.join() === "p0" && vb.myPick === null, "only who picked is visible");
  assert(!JSON.stringify(vb).includes(`"myPick":${truthIndex(s)}`), "others' picks hidden");
  assert(view(t, s, a).myPick === truthIndex(s), "own pick visible");
  // Reveal: everything comes out.
  t.advance(PICK_MS);
  tick(t, s);
  const rv = view(t, s, "spectator");
  assert(rv.phase === "reveal" && rv.history.length === 1, "summary at reveal");
  assert(rv.history[0].options.some((o) => o.kind === "truth" && o.text === "Puffling"), "truth revealed");
  assert(rv.history[0].options.find((o) => o.text === "Secret Alpha")?.authors.join() === "p0", "authors revealed");
  assert(rv.revealAt > 0 && rv.stepMs > 0, "reveal clock sent");
  // Every view round-trips through JSON unchanged.
  for (const viewer of [...t.ids, "spectator"]) {
    const v = view(t, s, viewer);
    assert(JSON.stringify(roundTrip(v)) === JSON.stringify(v), "view is JSON-safe");
  }
}

// ---------- merging, decoys & reveal order ----------
{
  const { t, s } = start(5, 11);
  setFact(s, "puffling");
  const [a, b, c, d, e] = t.ids;
  game.action(s, a, { type: "lie", text: "Puffin Chick" }, t.ctx);
  game.action(s, b, { type: "lie", text: "puffin   chick!" }, t.ctx); // same fib, merged
  game.action(s, c, { type: "lie", text: "Pufflet" }, t.ctx); // same as a house decoy: the fib wins
  game.action(s, d, { type: "lie", text: "Puffin Chicks" }, t.ctx); // plural of the same fib, merged
  t.advance(WRITE_MS);
  tick(t, s);
  assert(phaseOf(s) === "pick", "pick after timeout (p4 never wrote)");
  const merged = s.options.find((o) => o.kind === "lie" && o.authors.length === 3);
  assert(merged && merged.authors.join() === "0,1,3", "identical fibs merge, crediting every author");
  const pufflet = s.options.filter((o) => normalize(o.text) === "pufflet");
  assert(pufflet.length === 1 && pufflet[0].kind === "lie" && pufflet[0].authors.join() === "2", "fib replaces the matching decoy");
  assert(s.options.length === MIN_OPTIONS, "topped up to four options");
  const house = s.options.findIndex((o) => o.kind === "house");
  assert(house >= 0, "one house decoy added");
  const mergedIdx = s.options.indexOf(merged!);
  const puffletIdx = s.options.indexOf(pufflet[0]);
  assert(view(t, s, a).options.length === 3 && view(t, s, b).options.length === 3, "merged fib hidden from all its authors");
  assert(game.action(s, b, { type: "pick", option: mergedIdx }, t.ctx) === false, "co-author can't pick the merged fib");
  game.action(s, a, { type: "pick", option: puffletIdx }, t.ctx);
  game.action(s, b, { type: "pick", option: house }, t.ctx);
  game.action(s, c, { type: "pick", option: mergedIdx }, t.ctx);
  game.action(s, d, { type: "pick", option: puffletIdx }, t.ctx);
  game.action(s, e, { type: "pick", option: mergedIdx }, t.ctx);
  assert(phaseOf(s) === "reveal", "all picked");
  assert(s.scores.join() === [500, 500, 500, 500, 0].join(), `merged authors each +250 x2, p2 +250 x2: ${s.scores}`);
  const h = s.history[0];
  assert(h.steps.join() === [house, puffletIdx, mergedIdx, truthIndex(s)].join(), "house first, then least-fooled fibs, truth last");
  assert(h.points[b] === 500, "house fibs award nobody (b picked it, scores only from authorship)");
}

// ---------- disconnects never stall ----------
{
  // Write: the last writer drops -> pick starts.
  const { t, s } = start(4, 5);
  const [a, b, c, d] = t.ids;
  [a, b, c].forEach((id, i) => game.action(s, id, { type: "lie", text: fibFor(1, i) }, t.ctx));
  setOnline(t, s, d, false);
  assert(phaseOf(s) === "pick", "write ends when the only holdout disconnects");
  // Pick: d is away; the others pick -> reveal.
  game.action(s, a, { type: "pick", option: truthIndex(s) }, t.ctx);
  game.action(s, b, { type: "pick", option: truthIndex(s) }, t.ctx);
  setOnline(t, s, d, true);
  assert(phaseOf(s) === "pick", "returning player can still pick");
  setOnline(t, s, c, false);
  assert(phaseOf(s) === "pick", "d is back and hasn't picked");
  game.action(s, d, { type: "pick", option: truthIndex(s) }, t.ctx);
  assert(phaseOf(s) === "reveal", "pick ends once everyone connected picked");
  setOnline(t, s, c, true);
  // Reveal: disconnect doesn't matter; the clock moves on.
  setOnline(t, s, a, false);
  finishReveal(t, s);
  assert(phaseOf(s) === "write" && s.round === 2, "reveal moves on with someone away");
  setOnline(t, s, a, true);
  // A disconnected player can't act (the room drops their messages); the game times out around them.
  setOnline(t, s, b, false);
  [a, c, d].forEach((id, i) => game.action(s, id, { type: "lie", text: fibFor(2, i) }, t.ctx));
  assert(phaseOf(s) === "pick", "write ends without the away player");
  setOnline(t, s, b, true);
  t.advance(PICK_MS);
  tick(t, s);
  assert(phaseOf(s) === "reveal", "pick times out");
}
{
  // Everyone gone: no instant cascade; the game waits on its timers and then ends early.
  const { t, s } = start(3, 9);
  t.ids.forEach((id) => setOnline(t, s, id, false));
  assert(phaseOf(s) === "write", "nobody online doesn't count as everyone done");
  assert(s.shortSince !== null, "short-handed timer running");
  assert(view(t, s, "p0").shortUntil === s.shortSince! + SHORT_GRACE_MS, "warning in the view");
  t.advance(SHORT_GRACE_MS - 1);
  tick(t, s);
  assert(phaseOf(s) === "write", "still waiting");
  t.advance(1);
  tick(t, s);
  assert(phaseOf(s) === "final" && s.endedEarly, "ends early");
  assert(t.result !== null && /ended early/i.test(t.result.headline), `headline: ${t.result?.headline}`);
}
{
  // Short-handed, then someone comes back: the game carries on.
  const { t, s } = start(3, 4);
  setOnline(t, s, "p2", false);
  assert(s.shortSince !== null, "two left: warning");
  t.advance(SHORT_GRACE_MS - 1000);
  tick(t, s);
  setOnline(t, s, "p2", true);
  assert(s.shortSince === null, "warning cleared");
  t.advance(5000);
  tick(t, s);
  assert(phaseOf(s) !== "final", "game continues");
}
{
  // Ending early mid-game keeps finished rounds' scores and names a winner.
  const { t, s } = start(3, 21);
  t.ids.forEach((id, i) => game.action(s, id, { type: "lie", text: fibFor(1, i) }, t.ctx));
  game.action(s, "p0", { type: "pick", option: truthIndex(s) }, t.ctx);
  t.advance(PICK_MS);
  tick(t, s);
  finishReveal(t, s);
  setOnline(t, s, "p1", false);
  setOnline(t, s, "p2", false);
  t.advance(SHORT_GRACE_MS);
  tick(t, s);
  assert(phaseOf(s) === "final" && s.endedEarly, "ended early");
  assert(t.result!.winners.join() === "p0" && /Ended early: Player0 wins/.test(t.result!.headline), t.result!.headline);
  assert(view(t, s, "p0").history.length === 1, "only finished rounds count");
}

// ---------- ties, min & max players ----------
{
  const { t, s } = start(3, 13);
  for (let r = 1; r <= ROUNDS; r++) {
    t.ids.forEach((id, i) => game.action(s, id, { type: "lie", text: fibFor(r, i) }, t.ctx));
    // p0 and p1 both find the truth; p2 picks p0's fib in odd rounds and p1's in even rounds.
    game.action(s, "p0", { type: "pick", option: truthIndex(s) }, t.ctx);
    game.action(s, "p1", { type: "pick", option: truthIndex(s) }, t.ctx);
    const victim = r % 2 ? 0 : 1;
    game.action(s, "p2", { type: "pick", option: s.options.findIndex((o) => o.authors.includes(victim)) }, t.ctx);
    finishReveal(t, s);
  }
  assert(t.result !== null, "ended");
  assert(t.result.winners.join() === "p0,p1", "tie: both win");
  assert(/tie for the win/.test(t.result.headline), t.result.headline);
  assert(t.result.scores!.p0 === t.result.scores!.p1, "equal scores");
}
for (const n of [3, 10]) {
  const { t, s } = start(n, 17 + n);
  let guard = 0;
  while (phaseOf(s) !== "final" && guard++ < 50) {
    t.ids.forEach((id, i) => game.action(s, id, { type: "lie", text: fibFor(s.round, i) }, t.ctx));
    assert(phaseOf(s) === "pick", `${n} players: pick`);
    assert(s.options.length === Math.max(MIN_OPTIONS, n + 1), `${n} players: options`);
    t.ids.forEach((id, i) => {
      const options = view(t, s, id).options;
      game.action(s, id, { type: "pick", option: options[(i + s.round) % options.length].id }, t.ctx);
    });
    assert(phaseOf(s) === "reveal", `${n} players: reveal`);
    const steps = s.history[s.history.length - 1].steps.length;
    assert(steps * s.stepMs <= REVEAL_CAP_MS, `${n} players: reveal walk-through capped`);
    for (const id of [...t.ids, "spectator"]) {
      const v = view(t, s, id);
      assert(JSON.stringify(roundTrip(v)) === JSON.stringify(v), "JSON-safe view");
    }
    finishReveal(t, s);
  }
  assert(phaseOf(s) === "final" && t.result !== null, `${n} players: game completes`);
  const total = Object.values(t.result.scores!).reduce((x, y) => x + y, 0);
  const fromHistory = s.history.reduce((sum, h) => sum + Object.values(h.points).reduce((x, y) => x + y, 0), 0);
  assert(total === fromHistory, `${n} players: scores add up`);
}

console.log(`fib: all tests passed (${FACTS.length} facts)`);
