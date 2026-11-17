import { assert, makeTestCtx } from "../../shared/testing";
import game, { type DefuseState, type DefuseView } from "./server";
import { dealFragments, indexFacts, makeBomb, makeManual, publicMod, solve, ManualError, type Answer } from "./rules";
import { BOMB_MS, BRIEF_MS, FACT_MODULE, GLYPHS, MODULE_TYPES, PAD_COLORS, RESULT_MS, factKey, holdDigit, COUNT_STEP_MS, type Fact, type ModView } from "./shared";

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
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function countEnds(t: ReturnType<typeof makeTestCtx>) {
  let n = 0;
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    n += 1;
    end(r);
  };
  return () => n;
}
const view = (s: DefuseState, id: string, t: ReturnType<typeof makeTestCtx>) => clone(game.view(s, id, t.ctx)) as DefuseView;

// ---------- 1. The combined fragments always determine the unique solution ----------
{
  let modules = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const manual = makeManual(r);
    // Every line has its own key: a book can never hold two different versions of a line.
    assert(new Set(manual.map(factKey)).size === manual.length, "manual keys unique");
    const full = indexFacts(manual);
    for (let level = 0; level < 3; level++) {
      const { edge, mods } = makeBomb(r, manual, level);
      assert(mods.length === 3 + level && new Set(mods.map((m) => m.t)).size === mods.length, "3/4/5 distinct modules");
      for (let experts = 1; experts <= 7; experts++) {
        const ids = Array.from({ length: experts }, (_, i) => `e${i}`);
        const frags = dealFragments(
          r,
          manual,
          mods.map((m) => m.t),
          ids,
        );
        // What the experts hold, pooled. Only lines (structured), never the bomb.
        const pooled = indexFacts(ids.flatMap((id) => frags[id].map((i) => clone(manual[i]))));
        // Every relevant line was dealt to somebody; nothing irrelevant was.
        const relevant = manual.filter((f) => mods.some((m) => m.t === FACT_MODULE[f.t]));
        assert(pooled.size === relevant.length, `all ${relevant.length} relevant lines dealt (got ${pooled.size})`);
        if (experts >= 2) {
          for (const t of mods.map((m) => m.t)) {
            const lines = relevant.filter((f) => FACT_MODULE[f.t] === t).length;
            for (const id of ids) {
              const mine = frags[id].filter((i) => FACT_MODULE[manual[i].t] === t).length;
              assert(mine < lines, `with ${experts} experts nobody holds all of ${t}`);
            }
          }
        }
        if (experts === 1) assert(frags.e0.length === relevant.length, "a lone expert gets the whole manual");
        for (const m of mods) {
          // The solver sees only what the defuser sees (public module + edgework), via JSON.
          const pub = clone(publicMod(m));
          if (pub.t === "signal") pub.seq = m.full.slice(); // every stage, in turn
          const a = solve(pub, clone(edge), pooled);
          assert(JSON.stringify(a) === JSON.stringify(m.ans), `pooled fragments solve ${m.t} (seed ${seed})`);
          modules++;
        }
      }
      for (const m of mods) {
        // Uniqueness: the answer is well formed and singular.
        const a = m.ans;
        if (m.t === "wires" && a.t === "wires") assert(a.wire >= 0 && a.wire < m.wires.length, "wire exists");
        if (m.t === "keypad" && a.t === "keypad") assert(new Set(a.order).size === 4 && a.order.length === 4, "keypad order is a permutation");
        if (m.t === "button" && a.t === "button") assert(a.hold ? a.digit >= 1 && a.digit <= 9 : a.digit === 0, "button answer well formed");
        if (m.t === "signal" && a.t === "signal") assert(a.presses.length === m.full.length, "one reply per flash");
        if (m.t === "dial" && a.t === "dial") assert(a.pos >= 0 && a.pos < 8, "dial position in range");
        // And every stage prefix of the signal solves to the prefix of the answer.
        if (m.t === "signal" && a.t === "signal") {
          for (let st = 0; st < m.stages; st++) {
            const pub = { ...(publicMod({ ...m, stage: st }) as Extract<ModView, { t: "signal" }>) };
            const pa = solve(pub, edge, full) as Extract<Answer, { t: "signal" }>;
            assert(pa.presses.join() === a.presses.slice(0, st + 2).join(), "stage prefix");
          }
        }
      }
    }
  }
  // A missing line is detected rather than guessed.
  {
    const r = rng(7);
    const manual = makeManual(r);
    const { edge, mods } = makeBomb(r, manual, 2);
    for (const m of mods) {
      let threw = false;
      try {
        solve(publicMod(m), edge, indexFacts([]));
      } catch (e) {
        threw = e instanceof ManualError;
      }
      assert(threw, `solving ${m.t} with no manual throws`);
    }
    let conflict = false;
    try {
      indexFacts([{ t: "glyph", g: 1, v: 10 }, { t: "glyph", g: 1, v: 11 }]);
    } catch {
      conflict = true;
    }
    assert(conflict, "conflicting copies of a line are refused");
  }
  assert(modules > 10_000, "plenty of modules checked");
  console.log(`defuse: fragments solve ${modules} modules uniquely`);
}

// ---------- helpers to play through views (exactly what the clients see) ----------

/** Solve from the defuser's bomb view and the experts' pooled pages. */
function answersFromViews(s: DefuseState, t: ReturnType<typeof makeTestCtx>) {
  const dv = view(s, s.bomb.defuser, t);
  assert(dv.role === "defuser" && dv.bomb && dv.page === null, "defuser sees the bomb, no manual");
  const pages: Fact[] = [];
  for (const id of s.order) {
    if (id === s.bomb.defuser) continue;
    const ev = view(s, id, t);
    assert(ev.role === "expert" && ev.bomb === null && ev.page, "experts see pages, no bomb");
    pages.push(...ev.page);
  }
  const book = indexFacts(pages);
  return { dv, book };
}

function solveModule(s: DefuseState, t: ReturnType<typeof makeTestCtx>, m: number) {
  const { dv, book } = answersFromViews(s, t);
  const mod = dv.bomb!.mods[m];
  const def = s.bomb.defuser;
  const a = solve(mod, dv.bomb!.edge, book);
  if (a.t === "wires") assert(game.action(s, def, { type: "cut", m, w: a.wire }, t.ctx) === true, "cut");
  else if (a.t === "keypad") for (const k of a.order) assert(game.action(s, def, { type: "key", m, k }, t.ctx) === true, "key");
  else if (a.t === "dial") assert(game.action(s, def, { type: "dial", m, pos: a.pos }, t.ctx) === true, "dial");
  else if (a.t === "button") {
    assert(game.action(s, def, { type: "hold", m }, t.ctx) === false, "hold is quiet");
    if (!a.hold) {
      t.advance(120);
      assert(game.action(s, def, { type: "release", m, n: 1 }, t.ctx) === true, "tap");
    } else {
      // Wait until the counter shows the digit (at least one full step so it's a hold).
      let el = COUNT_STEP_MS;
      while (holdDigit(el + COUNT_STEP_MS / 2) !== a.digit) el += COUNT_STEP_MS;
      t.advance(el + COUNT_STEP_MS / 2);
      assert(game.action(s, def, { type: "release", m, n: a.digit }, t.ctx) === true, "release");
    }
  } else if (a.t === "signal") {
    // Stage by stage: each stage's view shows more flashes.
    let guard = 0;
    while (!view(s, def, t).bomb!.mods[m].done && guard++ < 10) {
      const cur = view(s, def, t).bomb!.mods[m];
      const sa = solve(cur, dv.bomb!.edge, book) as Extract<Answer, { t: "signal" }>;
      for (const c of sa.presses) assert(game.action(s, def, { type: "pad", m, c: PAD_COLORS.indexOf(c) }, t.ctx) === true, "pad");
    }
  }
}

function wrongMove(s: DefuseState, t: ReturnType<typeof makeTestCtx>): boolean {
  const def = s.bomb.defuser;
  const i = s.bomb.mods.findIndex((m) => !m.done);
  const m = s.bomb.mods[i];
  if (m.t === "wires" && m.ans.t === "wires") {
    const w = m.wires.findIndex((_, k) => k !== (m.ans as { wire: number }).wire && !m.cut[k]);
    return game.action(s, def, { type: "cut", m: i, w }, t.ctx) === true;
  }
  if (m.t === "dial" && m.ans.t === "dial") return game.action(s, def, { type: "dial", m: i, pos: (m.ans.pos + 1) % 8 }, t.ctx) === true;
  if (m.t === "keypad" && m.ans.t === "keypad") return game.action(s, def, { type: "key", m: i, k: m.ans.order[3] }, t.ctx) === true;
  if (m.t === "signal" && m.ans.t === "signal") {
    const wrong = PAD_COLORS.findIndex((c) => c !== (m.ans as { presses: string[] }).presses[0]);
    return game.action(s, def, { type: "pad", m: i, c: wrong }, t.ctx) === true;
  }
  if (m.t === "button" && m.ans.t === "button") {
    game.action(s, def, { type: "hold", m: i }, t.ctx);
    if (m.ans.hold) {
      t.advance(50); // a tap when a hold was needed
      return game.action(s, def, { type: "release", m: i, n: 1 }, t.ctx) === true;
    }
    t.advance(2000); // a hold when a tap was needed
    return game.action(s, def, { type: "release", m: i, n: holdDigit(2000) }, t.ctx) === true;
  }
  return false;
}

function readyAll(s: DefuseState, t: ReturnType<typeof makeTestCtx>) {
  for (const id of s.order) game.action(s, id, { type: "ready" }, t.ctx);
}

// ---------- 2. A full game, played through the views ----------
for (const n of [2, 4, 8]) {
  const t = makeTestCtx(n, 100 + n);
  const ends = countEnds(t);
  const s: DefuseState = game.setup(t.ctx);
  assert((s.phase as string) === "brief" && s.bomb.mods.length === 3, "starts in the brief with 3 modules");
  const defusers: string[] = [];

  // Bomb 1: clean defuse after an early start.
  defusers.push(s.bomb.defuser);
  const first = s.order[0];
  assert(game.action(s, first, { type: "ready" }, t.ctx) === true, "ready");
  assert(game.action(s, first, { type: "ready" }, t.ctx) === false, "ready once");
  readyAll(s, t);
  assert((s.phase as string) === "live", "all ready starts early");
  if (n === 2) {
    const ev = view(s, s.order.find((id) => id !== s.bomb.defuser)!, t);
    const rel = s.manual.filter((f) => s.bomb.mods.some((m) => m.t === FACT_MODULE[f.t]));
    assert(ev.page!.length === rel.length, "with 2 players the expert holds the whole manual");
  }
  t.advance(30_000);
  for (let m = 0; m < s.bomb.mods.length; m++) solveModule(s, t, m);
  assert((s.phase as string) === "result" && s.history[0].outcome === "defused", "bomb 1 defused");
  assert(s.history[0].points === 100 + 150, `time bonus (${s.history[0].points})`);
  const ev1 = view(s, s.order.find((id) => id !== s.bomb.defuser)!, t);
  assert(ev1.bomb !== null, "experts see the bomb once it's resolved");
  t.advance(RESULT_MS);
  assert(game.tick!(s, t.ctx) === true && (s.phase as string) === "brief" && s.bomb.no === 1, "result -> next brief");
  assert((s.bomb.mods.length as number) === 4, "bomb 2 has 4 modules");

  // Bomb 2: the brief runs out on its own; one strike, then defused.
  defusers.push(s.bomb.defuser);
  t.advance(BRIEF_MS - 1);
  assert(!game.tick!(s, t.ctx) && (s.phase as string) === "brief", "brief holds until its deadline");
  t.advance(1);
  assert(game.tick!(s, t.ctx) === true && (s.phase as string) === "live", "brief -> live on timer");
  const before = view(s, s.bomb.defuser, t).explodeAt;
  t.advance(10_000);
  assert(wrongMove(s, t), "a wrong move lands");
  assert(s.bomb.strikes === 1 && s.bomb.rate === 1.25, "strike speeds the clock");
  const after = view(s, s.bomb.defuser, t).explodeAt;
  assert(after < before, "explosion comes sooner after a strike");
  assert(t.events.some((e) => (e.event as { k: string }).k === "strike"), "strike event");
  for (let m = 0; m < s.bomb.mods.length; m++) if (!s.bomb.mods[m].done) solveModule(s, t, m);
  assert(s.history[1].outcome === "defused" && s.history[1].strikes === 1, "bomb 2 defused with a strike");
  t.advance(RESULT_MS);
  game.tick!(s, t.ctx);

  // Bomb 3: nobody touches it; the clock runs out.
  defusers.push(s.bomb.defuser);
  assert((s.bomb.mods.length as number) === 5, "bomb 3 has 5 modules");
  readyAll(s, t);
  t.advance(BOMB_MS - 500);
  assert(!game.tick!(s, t.ctx), "still ticking");
  t.advance(600);
  assert(game.tick!(s, t.ctx) === true, "boom");
  assert((s.phase as string) === "over" && s.history[2].outcome === "boom", "bomb 3 exploded, game over");
  assert(t.result && t.result.winners.length === n, "2 of 3 defused: everyone wins");
  assert(t.result.scores![s.order[0]] === s.team && s.team === s.history[0].points + s.history[1].points, "team score");
  assert(ends() === 1, "end once");
  t.advance(60_000);
  assert(!game.tick!(s, t.ctx) && game.action(s, s.order[0], { type: "ready" }, t.ctx) === false, "nothing after the end");
  assert(ends() === 1, "still once");
  // The defuser rotates.
  assert(defusers[0] !== defusers[1] && defusers[1] !== defusers[2], `defuser rotates (${defusers})`);
  if (n >= 3) assert(new Set(defusers).size === 3, "three different defusers");
}

// ---------- 3. Three strikes, and losing the game ----------
{
  const t = makeTestCtx(3, 9);
  const ends = countEnds(t);
  const s: DefuseState = game.setup(t.ctx);
  for (let b = 0; b < 3; b++) {
    readyAll(s, t);
    assert((s.phase as string) === "live", "live");
    let guard = 0;
    while (s.bomb.outcome === null && guard++ < 10) wrongMove(s, t);
    assert(s.bomb.outcome === "boom" && s.bomb.strikes === 3, "three strikes = boom");
    if (b < 2) {
      t.advance(RESULT_MS);
      game.tick!(s, t.ctx);
    }
  }
  assert(t.result && t.result.winners.length === 0 && s.team === 0, "nobody wins with 0 defused");
  assert(ends() === 1, "one end");
}

// ---------- 4. Hostile actions ----------
{
  const t = makeTestCtx(3, 5);
  const s: DefuseState = game.setup(t.ctx);
  const def = s.bomb.defuser;
  const expert = s.order.find((id) => id !== def)!;
  assert(game.action(s, def, { type: "cut", m: 0, w: 0 }, t.ctx) === false, "no moves during the brief");
  readyAll(s, t);
  const snapshot = JSON.stringify(s.bomb);
  const junk: unknown[] = [
    null,
    undefined,
    "cut",
    42,
    [],
    [{ type: "cut" }],
    {},
    { type: "cut" },
    { type: "cut", m: "0", w: 0 },
    { type: "cut", m: 0, w: 1.5 },
    { type: "cut", m: -1, w: 0 },
    { type: "cut", m: 99, w: 0 },
    { type: "cut", m: 0, w: 99 },
    { type: "key", m: 0, k: NaN },
    { type: "pad", m: 0, c: 7 },
    { type: "dial", m: 0, pos: 8 },
    { type: "dial", m: 0, pos: Infinity },
    { type: "release", m: 0, n: 3 },
    { type: "__proto__" },
    { type: "ready" },
  ];
  for (const a of junk) assert(game.action(s, def, a as never, t.ctx) === false, `rejects ${JSON.stringify(a)}`);
  // Module actions aimed at the wrong module type.
  s.bomb.mods.forEach((m, i) => {
    const wrongType = m.t === "wires" ? { type: "key", m: i, k: 0 } : { type: "cut", m: i, w: 0 };
    assert(game.action(s, def, wrongType as never, t.ctx) === false, "wrong module type");
  });
  assert(game.action(s, expert, { type: "cut", m: 0, w: 0 }, t.ctx) === false, "experts can't touch the bomb");
  assert(game.action(s, "spectator", { type: "say", t: "hi" }, t.ctx) === false, "spectators can't act");
  assert(JSON.stringify(s.bomb) === snapshot && s.bomb.strikes === 0, "junk changed nothing");
  // Talk: sanitised, capped, rate-limited, participants only.
  const evs = t.events.length;
  assert(game.action(s, expert, { type: "say", t: `  hello${String.fromCharCode(0, 7)}   there  ` }, t.ctx) === false, "say returns false");
  assert(s.chat.at(-1)!.t === "hello there", `sanitised (${s.chat.at(-1)!.t})`);
  const sent = t.events.slice(evs);
  assert(sent.length === 3 && sent.every((e) => e.to && s.order.includes(e.to)), "talk goes to each participant only");
  game.action(s, expert, { type: "say", t: "again" }, t.ctx);
  assert(s.chat.length === 1, "rate limited");
  t.advance(300);
  game.action(s, expert, { type: "say", t: "x".repeat(5000) }, t.ctx);
  assert(s.chat.length === 1, "oversize rejected");
  game.action(s, expert, { type: "say", t: "y".repeat(300) }, t.ctx);
  assert(s.chat.at(-1)!.t!.length === 100, "capped");
  t.advance(300);
  for (const bad of [{ g: 99 }, { g: -1 }, { c: "purple" }, { t: "   " }, { t: ["a"] }, {}]) game.action(s, expert, { type: "say", ...bad } as never, t.ctx);
  assert((s.chat.length as number) === 2 && s.chatSeq === 2, "bad talk rejected");
  game.action(s, def, { type: "say", g: GLYPHS.length - 1, n: 7 }, t.ctx);
  t.advance(300);
  game.action(s, def, { type: "say", c: "black" }, t.ctx);
  assert(s.chat.at(-2)!.g === GLYPHS.length - 1 && s.chat.at(-2)!.n === 7 && s.chat.at(-1)!.c === "black", "glyph and colour references");
  for (let i = 0; i < 40; i++) {
    t.advance(300);
    game.action(s, expert, { type: "say", t: `m${i}` }, t.ctx);
  }
  assert((s.chat.length as number) === 24, "chat log is capped");
}

// ---------- 5. Secrecy ----------
{
  const t = makeTestCtx(5, 77);
  const s: DefuseState = game.setup(t.ctx);
  readyAll(s, t);
  const def = s.bomb.defuser;
  const experts = s.order.filter((id) => id !== def);
  const serial = s.bomb.edge.serial;
  const dv = JSON.stringify(view(s, def, t));
  assert(!dv.includes('"ans"') && !dv.includes('"full"') && !dv.includes('"page":[') && !dv.includes("frags"), "defuser view: no answers, no manual");
  const spec = view(s, "spectator", t);
  assert(spec.role === "spectator" && spec.bomb && spec.page === null && spec.chat === null, "spectators: bomb only");
  assert(!JSON.stringify(spec).includes('"ans"'), "spectators: no answers");
  for (const id of experts) {
    const v = view(s, id, t);
    const js = JSON.stringify(v);
    assert(v.bomb === null && !js.includes(serial) && !js.includes('"edge"'), "experts never see the bomb");
    // Their page holds exactly their own lines.
    const mine = new Set(s.bomb.frags[id].map((i) => factKey(s.manual[i])));
    assert(v.page!.every((f) => mine.has(factKey(f))) && v.page!.length === mine.size, "own lines only");
  }
  // A signal module never shows flashes beyond the current stage.
  const sig = s.bomb.mods.find((m) => m.t === "signal");
  if (sig && sig.t === "signal") {
    const pub = view(s, def, t).bomb!.mods.find((m) => m.t === "signal")!;
    assert(pub.t === "signal" && pub.seq.length === 2, "only stage 1 flashes");
  }
  // Manual lines that are only in one expert's pages are not in another's view.
  const a = experts[0];
  const b = experts[1];
  const onlyA = s.bomb.frags[a].filter((i) => !s.bomb.frags[b].includes(i));
  const vb = view(s, b, t);
  assert(onlyA.length > 0, "experts' pages differ");
  for (const i of onlyA) assert(!vb.page!.some((f) => factKey(f) === factKey(s.manual[i])), "no leaks between experts");
}

// ---------- 6. Disconnects never stall the game ----------
{
  // Defuser drops mid-bomb: after 15s the next connected expert takes over, with the pages shared out.
  const t = makeTestCtx(4, 31);
  const s: DefuseState = game.setup(t.ctx);
  readyAll(s, t);
  const def = s.bomb.defuser;
  const di = s.order.indexOf(def);
  t.ctx.players[di].connected = false;
  game.playerLeft!(s, def, t.ctx);
  t.advance(14_000);
  game.tick!(s, t.ctx);
  assert(s.bomb.defuser === def, "grace period");
  t.advance(1_000);
  assert(game.tick!(s, t.ctx) === true && s.bomb.defuser !== def, "handed over");
  const relevant = s.manual.filter((f) => s.bomb.mods.some((m) => m.t === FACT_MODULE[f.t])).length;
  const pooled = new Set(Object.entries(s.bomb.frags).filter(([id]) => id !== def).flatMap(([, f]) => f));
  assert(pooled.size === relevant, "the remaining experts still hold the whole manual");
  // ...and they can finish the bomb through their views.
  t.ctx.players[di].connected = true;
  game.playerReturned!(s, def, t.ctx);
  for (let m = 0; m < s.bomb.mods.length; m++) {
    // The returning player is now an expert with no pages; still solvable.
    solveModule(s, t, m);
  }
  assert(s.bomb.outcome === "defused", "defused after the hand-over");
}
{
  // An expert drops: their pages go to someone else, so nothing is lost.
  const t = makeTestCtx(4, 32);
  const s: DefuseState = game.setup(t.ctx);
  const exp = s.order.find((id) => id !== s.bomb.defuser)!;
  const ei = s.order.indexOf(exp);
  t.ctx.players[ei].connected = false;
  game.playerLeft!(s, exp, t.ctx);
  // The others ready up; the brief starts without the missing player.
  for (const id of s.order) if (id !== exp) game.action(s, id, { type: "ready" }, t.ctx);
  assert((s.phase as string) === "live", "brief doesn't wait for the disconnected");
  t.advance(15_000);
  assert(game.tick!(s, t.ctx) === true, "pages shared");
  const lost = s.bomb.frags[exp];
  const others = s.order.filter((id) => id !== exp && id !== s.bomb.defuser).flatMap((id) => s.bomb.frags[id]);
  assert(lost.every((i) => others.includes(i)), "the away expert's lines are covered");
  for (let m = 0; m < s.bomb.mods.length; m++) {
    const { dv } = answersFromViews(s, t);
    void dv;
    solveModule(s, t, m);
  }
  assert(s.bomb.outcome === "defused", "defused without them");
  // Back for the next bomb: dealt in again.
  t.ctx.players[ei].connected = true;
  game.playerReturned!(s, exp, t.ctx);
  t.advance(RESULT_MS);
  game.tick!(s, t.ctx);
  assert((s.phase as string) === "brief" && (s.bomb.frags[exp]?.length ?? 0) + (s.bomb.defuser === exp ? 1 : 0) > 0, "returning player is dealt in");
}
{
  // Everyone but one leaves: the game ends instead of stalling (in every phase).
  for (const phase of ["brief", "live", "result"] as const) {
    const t = makeTestCtx(3, 40);
    const ends = countEnds(t);
    const s: DefuseState = game.setup(t.ctx);
    if (phase !== "brief") readyAll(s, t);
    if (phase === "result") for (let m = 0; m < s.bomb.mods.length; m++) solveModule(s, t, m);
    assert((s.phase as string) === phase, `in ${phase}`);
    for (let i = 1; i < 3; i++) {
      t.ctx.players[i].connected = false;
      game.playerLeft!(s, t.ids[i], t.ctx);
    }
    for (let k = 0; k < 100 && !t.result; k++) {
      t.advance(1000);
      game.tick!(s, t.ctx);
    }
    assert(t.result && s.over && s.abandoned, `abandoned game ends (${phase})`);
    assert(ends() === 1, "once");
  }
}
{
  // A stuck hold (socket died mid-press) is dropped quietly.
  const t = makeTestCtx(2, 3);
  const s: DefuseState = game.setup(t.ctx);
  readyAll(s, t);
  const bi = s.bomb.mods.findIndex((m) => m.t === "button");
  if (bi >= 0) {
    game.action(s, s.bomb.defuser, { type: "hold", m: bi }, t.ctx);
    t.advance(16_000);
    game.tick!(s, t.ctx);
    assert(s.bomb.mods[bi].holdAt === null && s.bomb.strikes === 0, "stale hold cleared without a strike");
  }
  // A hold released on an implausible number is a strike even if it's the right digit.
  const s2: DefuseState = (() => {
    for (let seed = 1; seed < 200; seed++) {
      const t2 = makeTestCtx(2, seed);
      const x: DefuseState = game.setup(t2.ctx);
      const m = x.bomb.mods.find((mm) => mm.t === "button" && mm.ans.t === "button" && mm.ans.hold);
      if (m) return Object.assign(x, { _t: t2 });
    }
    throw new Error("no hold button found");
  })();
  const t2 = (s2 as unknown as { _t: ReturnType<typeof makeTestCtx> })._t;
  readyAll(s2, t2);
  const i2 = s2.bomb.mods.findIndex((mm) => mm.t === "button");
  const ans = s2.bomb.mods[i2].ans as { digit: number };
  game.action(s2, s2.bomb.defuser, { type: "hold", m: i2 }, t2.ctx);
  let el = COUNT_STEP_MS;
  while (holdDigit(el + COUNT_STEP_MS / 2) === ans.digit || holdDigit(el + COUNT_STEP_MS / 2 - 320) === ans.digit || holdDigit(el + COUNT_STEP_MS / 2 + 320) === ans.digit) el += COUNT_STEP_MS;
  t2.advance(el + COUNT_STEP_MS / 2);
  game.action(s2, s2.bomb.defuser, { type: "release", m: i2, n: ans.digit }, t2.ctx);
  assert(s2.bomb.strikes === 1, "claimed digit must match the timing");
}

// ---------- 7. Every module type appears, and edge cases of the generator ----------
{
  const seen = new Set<string>();
  for (let seed = 1; seed <= 30; seed++) {
    const t = makeTestCtx(2, seed);
    const s: DefuseState = game.setup(t.ctx);
    for (const m of s.bomb.mods) seen.add(m.t);
  }
  assert(MODULE_TYPES.every((m) => seen.has(m)), "every module type shows up on early bombs");
}

// ---------- 8. Host settings: the bomb timer ----------
{
  const t = makeTestCtx(3, 5, { clock: 120 });
  const s: DefuseState = game.setup(t.ctx);
  assert(s.bombMs === 120_000 && s.bomb.left === 120_000, "2:00 clock honoured");
  for (const id of t.ids) game.action(s, id, { type: "ready" }, t.ctx);
  assert(s.phase === "live", "all ready goes live");
  assert(view(s, t.ids[0], t).bombMs === 120_000, "view carries the clock");
  t.advance(120_000 + 10);
  game.tick!(s, t.ctx);
  assert(s.history.length === 1 && s.history[0].outcome === "boom", "short clock blows up sooner");
  const td = makeTestCtx(3, 5, { clock: 999 });
  assert((game.setup(td.ctx) as DefuseState).bombMs === BOMB_MS, "bad clock falls back to 3:00");
}

console.log("defuse: all tests passed");
