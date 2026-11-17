import { assert, makeTestCtx } from "../../shared/testing";
import mashup, { SOLO_GRACE_MS, eligibleFor, sliverOf, type MashupEvent, type MashupState, type MashupView } from "./server";
import { DRAW_MS, GUIDE, H, INK_POINTS, MAX_NAME, NAME_MS, NAME_PTS, RESULTS_MS, ROUNDS, STAR_PTS, VOTE_MS, revealMs } from "./shared";

type T = ReturnType<typeof makeTestCtx>;
// Read through functions so TypeScript doesn't narrow values that actions change.
const ph = (s: MashupState): string => s.phase;
const R = (t: T) => t.result;

const setup = (n: number, seed = 7) => {
  const t = makeTestCtx(n, seed);
  const s = mashup.setup(t.ctx);
  return { t, s };
};
const act = (s: MashupState, t: T, id: string, a: unknown) => mashup.action(s, id, a as never, t.ctx);
const view = (s: MashupState, t: T, id: string) => mashup.view(s, id, t.ctx) as MashupView;
const tick = (s: MashupState, t: T) => mashup.tick!(s, t.ctx);
const warp = (s: MashupState, t: T, ms: number) => {
  t.advance(ms);
  return tick(s, t);
};
const setConn = (t: T, id: string, on: boolean) => {
  const p = t.ctx.players.find((x) => x.id === id);
  if (p) p.connected = on;
};

let strokeNo = 0;
/** Draw one stroke for `id` in the current stage, ending at y. */
function draw(s: MashupState, t: T, id: string, y0 = 50, y1 = H - 5) {
  const sid = `s${++strokeNo}`;
  act(s, t, id, { type: "stroke", id: sid, color: "#1c1c1e", size: 9, pts: [100, y0, 200, (y0 + y1) >> 1, 300, y1], end: true });
}

function drawAllStages(s: MashupState, t: T) {
  for (let stage = 0; stage < 3; stage++) {
    assert(ph(s) === "draw" && s.stage === stage, `draw stage ${stage}`);
    for (const id of t.ids) draw(s, t, id);
    for (const id of t.ids) act(s, t, id, { type: "done" });
    tick(s, t); // everyone done -> early advance
  }
}

function nameAll(s: MashupState, t: T) {
  assert(ph(s) === "name", "name phase");
  for (const id of t.ids) {
    const v = view(s, t, id);
    for (const task of v.name ?? []) act(s, t, id, { type: "name", m: task.m, text: `${id} names ${task.m}` });
    act(s, t, id, { type: "done" });
  }
  tick(s, t);
}

function skipReveal(s: MashupState, t: T) {
  assert(ph(s) === "reveal", "reveal phase");
  let guard = 0;
  while (ph(s) === "reveal" && guard++ < 50) warp(s, t, revealMs(s.monsters.length));
}

// ---------- full game, 3 players ----------
{
  const { t, s } = setup(3);
  assert(s.monsters.length === 3, "one monster per player");
  // Every monster has three distinct artists, and each stage uses every player once.
  for (const mo of s.monsters) assert(new Set(mo.parts.map((p) => p.by)).size === 3, "3 distinct artists");
  for (let k = 0; k < 3; k++) assert(new Set(s.monsters.map((mo) => mo.parts[k].by)).size === 3, "stage is a permutation");

  // Heads: no guide. Draw, finish.
  const v0 = view(s, t, "p0");
  assert(v0.draw && v0.draw.part === 0 && v0.draw.guide === null, "head has no guide");
  drawAllStages(s, t);
  assert(s.monsters.every((mo) => mo.parts.every((p) => !p.blank)), "all parts drawn");

  nameAll(s, t);
  assert(ph(s) === "reveal", "reveal after naming");
  // Events pushed the monster on stage to everyone.
  const pushed = t.events.filter((e) => (e.event as MashupEvent).k === "monsters" && !e.to);
  assert(pushed.length >= 1, "reveal pushes monster");
  skipReveal(s, t);
  assert(ph(s) === "vote", "vote after reveal");

  // At 3 players everyone drew part of every monster, so every monster is votable.
  for (const id of t.ids) assert(eligibleFor(s, id).length === 3, "small-group: all eligible");
  // p0 stars monster 0; p1 and p2 star monster 1. Names: vote for a name not your own.
  act(s, t, "p0", { type: "star", m: 0 });
  act(s, t, "p1", { type: "star", m: 1 });
  act(s, t, "p2", { type: "star", m: 1 });
  for (const id of t.ids) {
    let voted = false;
    s.monsters.forEach((mo, m) =>
      mo.names.forEach((n, i) => {
        if (!voted && n.by && n.by !== id) voted = act(s, t, id, { type: "pick", m, i }) !== undefined && s.votes[id]?.mi === m;
      }),
    );
    assert(voted, `${id} picked a name`);
  }
  assert(s.done.length === 3, "all voted");
  const before = { ...s.scores };
  tick(s, t);
  assert(ph(s) === "results", "results after vote");
  const r = s.results[0];
  // Voters never score from their own star.
  const expect: Record<string, number> = { p0: 0, p1: 0, p2: 0 };
  const starOf: Record<string, number> = { p0: 0, p1: 1, p2: 1 };
  for (const [voter, m] of Object.entries(starOf)) for (const c of s.monsters[m].parts.map((p) => p.by)) if (c !== voter) expect[c] += STAR_PTS;
  for (const voter of t.ids) {
    const v = s.votes[voter];
    const nm = s.monsters[v.mi].names[v.ni];
    expect[nm.by!] += NAME_PTS;
  }
  for (const id of t.ids) assert(r.gains[id] === expect[id], `gain for ${id}: ${r.gains[id]} vs ${expect[id]}`);
  for (const id of t.ids) assert(s.scores[id] === (before[id] ?? 0) + expect[id], "scores add up");
  assert(r.top.length === 1 && r.top[0] === 1, "monster 1 tops the round");

  // Results -> round 2 (via everyone tapping next).
  for (const id of t.ids) act(s, t, id, { type: "next" });
  tick(s, t);
  assert(ph(s) === "draw" && s.round === 1 && s.stage === 0, "round 2 starts");
  assert(s.past.length === 1, "round 1 archived");

  // Round 2 by timers only: nothing drawn.
  for (let k = 0; k < 3; k++) warp(s, t, DRAW_MS);
  assert(ph(s) === "name", "timers move draw stages");
  assert(s.monsters.every((mo) => mo.parts.every((p) => p.blank)), "untouched parts are blank");
  warp(s, t, NAME_MS);
  assert(ph(s) === "reveal", "name timer");
  // Nobody named anything: the game names them, and those names aren't votable.
  assert(s.monsters.every((mo) => mo.names.length === 1 && mo.names[0].by === null), "auto names");
  skipReveal(s, t);
  assert(ph(s) === "vote", "vote");
  assert(act(s, t, "p0", { type: "pick", m: 0, i: 0 }) === false, "auto names aren't votable");
  warp(s, t, VOTE_MS);
  assert(ph(s) === "results", "vote timer");
  assert(!R(t), "no end before final");
  warp(s, t, RESULTS_MS);
  assert(ph(s) === "final" && s.round === ROUNDS - 1, "final");
  assert(R(t), "ended");
  const winners = R(t)!.winners;
  const best = Math.max(...t.ids.map((id) => s.scores[id]));
  assert(winners.length && winners.every((id) => s.scores[id] === best), "winners are top scorers");
  assert(s.final && s.final.hall.length === 1 && s.final.hall[0].round === 0, "hall of fame from round 1");
  // Nothing happens after the end.
  assert(warp(s, t, 10_000) === false, "no ticks after final");
  assert(act(s, t, "p0", { type: "next" }) === false, "no actions after final");
  console.log("✓ 3-player full game");
}

// ---------- uneven 5 players: fairness + name assignment ----------
{
  const { t, s } = setup(5, 99);
  for (const id of t.ids) {
    const n = s.monsters.reduce((a, mo) => a + mo.parts.filter((p) => p.by === id).length, 0);
    assert(n === 3, "everyone draws exactly three parts");
  }
  drawAllStages(s, t);
  for (const id of t.ids) {
    const v = view(s, t, id);
    assert(v.name && v.name.length === 2, "two names each");
    for (const task of v.name) assert(!s.monsters[task.m].parts.some((p) => p.by === id), "never name your own at 5 players");
    // Only the monsters you name were pushed to you.
    const mine = t.events.filter((e) => e.to === id && (e.event as MashupEvent).k === "monsters");
    const ms = mine.flatMap((e) => (e.event as Extract<MashupEvent, { k: "monsters" }>).list.map((x) => x.m));
    assert(ms.length === 2 && ms.every((m) => v.name!.some((tk) => tk.m === m)), "only your naming monsters are pushed");
  }
  const counts = s.monsters.map((mo) => mo.namers.length);
  assert(Math.max(...counts) - Math.min(...counts) <= 1, "names spread evenly");
  // Requesting a monster you aren't naming is refused.
  const other = s.monsters.findIndex((mo) => !mo.namers.includes("p0"));
  const n0 = t.events.length;
  act(s, t, "p0", { type: "monsters", r: 0, list: [other] });
  assert(t.events.length === n0, "no peeking at other monsters while naming");
  nameAll(s, t);
  // Eligible stars exclude your own monsters at 5 players.
  skipReveal(s, t);
  for (const id of t.ids) {
    const el = eligibleFor(s, id);
    assert(el.length === 2 && el.every((m) => !s.monsters[m].parts.some((p) => p.by === id)), "eligible = not yours");
    const own = s.monsters.findIndex((mo) => mo.parts.some((p) => p.by === id));
    assert(act(s, t, id, { type: "star", m: own }) === false, "can't star your own");
  }
  // Own name refused.
  const mo = s.monsters.find((x) => x.names.some((n) => n.by === "p0"))!;
  const mi = s.monsters.indexOf(mo);
  assert(act(s, t, "p0", { type: "pick", m: mi, i: mo.names.findIndex((n) => n.by === "p0") }) === false, "can't vote own name");
  // Vote view hides authors except your own flag.
  const vv = JSON.stringify(view(s, t, "p1").vote);
  assert(!vv.includes('"by"'), "vote view has no authors");
  console.log("✓ 5 players: fair parts, names and eligibility");
}

// ---------- 12 players ----------
{
  const { t, s } = setup(12, 3);
  assert(s.monsters.length === 12, "12 monsters");
  drawAllStages(s, t);
  nameAll(s, t);
  assert(s.monsters.every((mo) => mo.names.length === 2), "2 names per monster at 12");
  skipReveal(s, t);
  assert(ph(s) === "vote", "vote at 12");
  for (const id of t.ids) assert(eligibleFor(s, id).length === 9, "9 eligible at 12");
  const size = JSON.stringify(view(s, t, "p0")).length;
  assert(size < 6_000, `vote view small (${size})`);
  console.log("✓ 12 players");
}

// ---------- guide sliver + secrecy in draw ----------
{
  const { t, s } = setup(4, 5);
  const headBy = s.monsters[0].parts[0].by;
  // One stroke entirely in the top half (secret), one reaching the bottom strip.
  act(s, t, headBy, { type: "stroke", id: "top1", color: "#e5383b", size: 9, pts: [77, 10, 78, 20, 79, 30], end: true });
  act(s, t, headBy, { type: "stroke", id: "neck", color: "#1c1c1e", size: 9, pts: [250, 100, 250, 300, 260, 380, 270, 399], end: true });
  warp(s, t, DRAW_MS);
  assert(s.stage === 1, "stage 2");
  const bodyBy = s.monsters[0].parts[1].by;
  const v = view(s, t, bodyBy);
  assert(v.draw && v.draw.m === 0 && v.draw.guideBy === headBy, "body artist gets monster 0's guide");
  const g = v.draw.guide!;
  assert(g.length === 1 && g[0].color === "#1c1c1e", "only the neck reaches the strip");
  for (let i = 1; i < g[0].pts.length; i += 2) assert(g[0].pts[i] <= GUIDE, "guide y within strip");
  assert(!JSON.stringify(v).includes("#e5383b"), "top of the head stays secret");
  // Spectators and other players see no strokes during drawing.
  const spec = JSON.stringify(view(s, t, "spectator"));
  assert(!spec.includes("pts"), "spectator sees no strokes");
  // Direct sliver check: a long stroke is clipped to points near the strip.
  const sl = sliverOf({ by: "x", strokes: [{ id: "a", color: "#000", size: 4, pts: [0, 0, 0, 100, 0, 200, 0, 300, 0, 370, 0, 390], end: true }], points: 6, made: 1, pointsIn: 6, ids: {}, blank: false });
  assert(sl.length === 1 && sl[0].pts.length === 6, "clipped to the strip plus one neighbour");
  // Monster requests during drawing are refused.
  const n0 = t.events.length;
  act(s, t, bodyBy, { type: "monsters", r: 0, list: [0, 1] });
  mashup.spectatorAction!(s, "spectator", { type: "monsters", r: 0, list: [0] }, t.ctx);
  assert(t.events.length === n0, "no monsters during draw");
  console.log("✓ guide sliver and drawing secrecy");
}

// ---------- hostile actions ----------
{
  const { t, s } = setup(3, 11);
  const junk: unknown[] = [
    null,
    42,
    "x",
    [],
    {},
    { type: "x" },
    { type: "__proto__" },
    { type: "stroke", id: "s", color: "#000", size: 9, pts: [1, 2, "x", 4] },
    { type: "stroke", id: "y".repeat(400), color: "#1c1c1e", size: 9, pts: [1, 2] },
    { type: "stroke", id: "ok", color: "red", size: 9, pts: [1, 2] },
    { type: "stroke", id: "ok", color: "#1c1c1e", size: 1e9, pts: [1, 2] },
    { type: "stroke", id: "ok", color: "#1c1c1e", size: 9, pts: [601, 2] },
    { type: "stroke", id: "ok", color: "#1c1c1e", size: 9, pts: [1, 401] },
    { type: "stroke", id: "ok", color: "#1c1c1e", size: 9, pts: [1.5, 2] },
    { type: "stroke", id: "ok", color: "#1c1c1e", size: 9, pts: new Array(5000).fill(1) },
    { type: "name", m: 0, text: "x" },
    { type: "star", m: 0 },
    { type: "pick", m: 0, i: 0 },
    { type: "next" },
    { type: "monsters", r: 0, list: "all" },
    { type: "monsters", r: -1, list: [0] },
    { type: "monsters", r: 0, list: new Array(100).fill(0) },
    { type: "edit" },
  ];
  for (const a of junk) assert(!act(s, t, "p0", a), `junk rejected: ${JSON.stringify(a)?.slice(0, 60)}`);
  assert(s.monsters.every((mo) => mo.parts[0].strokes.length === 0), "no junk strokes");
  assert(!act(s, t, "stranger", { type: "done" }), "non-player rejected");
  assert(!mashup.spectatorAction!(s, "spectator", { type: "done" }, t.ctx), "spectator can't act");
  // Ink cap: the server stops at INK_POINTS.
  const pts: number[] = [];
  for (let i = 0; i < 300; i++) pts.push(i % 600, i % 400);
  for (let k = 0; k < 8; k++) act(s, t, "p0", { type: "stroke", id: `ink${k}`, color: "#1c1c1e", size: 4, pts, end: true });
  const part = s.monsters.find((mo) => mo.parts[0].by === "p0")!.parts[0];
  assert(part.points === INK_POINTS, `ink capped (${part.points})`);
  // Undo / clear.
  act(s, t, "p0", { type: "undo" });
  assert(part.strokes.length === 7 && (part.points as number) === INK_POINTS, "undo pops the last (empty) stroke");
  act(s, t, "p0", { type: "clear" });
  assert((part.points as number) === 0 && (part.strokes.length as number) === 0, "clear wipes");
  // Name phase: long / control-char names are cleaned and capped; names for monsters you don't name refused.
  drawAllStages(s, t);
  const task = view(s, t, "p0").name![0];
  act(s, t, "p0", { type: "name", m: task.m, text: "\u0000\u0007  Big   " + "z".repeat(5000) });
  const draft = s.monsters[task.m].drafts["p0"];
  assert(Array.from(draft).length <= MAX_NAME && !draft.includes("\u0000") && draft.startsWith("Big z"), "name cleaned");
  const notMine = s.monsters.findIndex((mo) => !mo.namers.includes("p0"));
  if (notMine >= 0) assert(!act(s, t, "p0", { type: "name", m: notMine, text: "hax" }), "can't name others' monsters");
  assert(!act(s, t, "p0", { type: "name", m: 99, text: "x" }), "bad monster index");
  assert(!act(s, t, "p0", { type: "star", m: 0 }), "no stars during naming");
  // Reveal: skip guard.
  warp(s, t, NAME_MS);
  assert(ph(s) === "reveal", "reveal");
  assert(!act(s, t, "p0", { type: "next" }), "skip blocked right after landing");
  t.advance(1500);
  assert(act(s, t, "p0", { type: "next" }) === true, "skip counted");
  assert(!act(s, t, "p0", { type: "next" }), "skip only once");
  // Monster requests: allowed for revealed monsters only.
  const n0 = t.events.length;
  act(s, t, "p1", { type: "monsters", r: 0, list: [2] });
  assert(t.events.length === n0, "future monster refused");
  act(s, t, "p1", { type: "monsters", r: 0, list: [0] });
  assert(t.events.length === n0 + 1, "revealed monster sent");
  act(s, t, "p1", { type: "monsters", r: 0, list: [0] });
  assert(t.events.length === n0 + 1, "rate limited");
  console.log("✓ hostile actions rejected");
}

// ---------- disconnects ----------
{
  const { t, s } = setup(4, 21);
  // A disconnected player doesn't hold up a stage.
  setConn(t, "p3", false);
  mashup.playerLeft!(s, "p3", t.ctx);
  for (const id of ["p0", "p1", "p2"]) {
    draw(s, t, id);
    act(s, t, id, { type: "done" });
  }
  tick(s, t);
  assert(s.stage === 1, "stage advances without the absent player");
  assert(s.monsters.some((mo) => mo.parts[0].by === "p3" && mo.parts[0].blank), "absent player's head is blank");
  const v = view(s, t, s.monsters.find((mo) => mo.parts[0].by === "p3")!.parts[1].by);
  assert(v.draw!.guideBlank, "blank guide flagged");
  // Returning mid-stage: the player gets their own view and can recover strokes.
  setConn(t, "p3", true);
  mashup.playerReturned!(s, "p3", t.ctx);
  draw(s, t, "p3");
  act(s, t, "p3", { type: "mine" });
  const mine = t.events.filter((e) => e.to === "p3" && (e.event as MashupEvent).k === "mine");
  assert(mine.length === 1 && (mine[0].event as Extract<MashupEvent, { k: "mine" }>).strokes.length === 1, "mine recovery");
  assert(view(s, t, "p3").draw!.ink === 1, "ink count in view");

  // Name / vote / results with someone gone: done checks skip them.
  warp(s, t, DRAW_MS);
  warp(s, t, DRAW_MS);
  assert(ph(s) === "name", "name");
  setConn(t, "p2", false);
  for (const id of ["p0", "p1", "p3"]) act(s, t, id, { type: "done" });
  tick(s, t);
  assert(ph(s) === "reveal", "name done without p2");
  skipReveal(s, t);
  for (const id of ["p0", "p1", "p3"]) {
    act(s, t, id, { type: "star", m: eligibleFor(s, id)[0] });
    const free = s.monsters.flatMap((mo, m) => mo.names.map((n, i) => ({ m, i, by: n.by }))).find((x) => x.by && x.by !== id);
    if (free) act(s, t, id, { type: "pick", m: free.m, i: free.i });
  }
  tick(s, t);
  assert(ph(s) === "results", `vote done without p2 (${s.phase} ${JSON.stringify(s.done)} ${JSON.stringify(s.votes)})`);

  // Everyone but one leaves: the game ends early after the grace period.
  setConn(t, "p0", false);
  setConn(t, "p1", false);
  mashup.playerLeft!(s, "p1", t.ctx);
  tick(s, t);
  assert(s.soloSince !== null, "solo detected");
  assert(view(s, t, "p3").soloEndsAt !== null, "solo countdown in view");
  // Results timer still moves on meanwhile; the grace ends it.
  for (let i = 0; i < 10 && ph(s) !== "final"; i++) warp(s, t, SOLO_GRACE_MS / 4);
  assert(ph(s) === "final" && s.endedEarly && R(t), "ended early");
  assert(R(t)!.headline.includes("ended early"), "headline says so");
  console.log("✓ disconnects never stall");
}

// ---------- everyone gone: timers still finish the game ----------
{
  const { t, s } = setup(3, 8);
  for (const id of t.ids) setConn(t, id, false);
  let guard = 0;
  while (!R(t) && guard++ < 200) warp(s, t, 5_000);
  assert(R(t) && ph(s) === "final", "finishes with nobody around");
  console.log("✓ empty room ends");
}

// ---------- ties and secrecy of names ----------
{
  const { t, s } = setup(6, 13);
  drawAllStages(s, t);
  nameAll(s, t);
  // During reveal, only the monster on stage is in the view, without authors.
  const rv = JSON.stringify(view(s, t, "spectator"));
  assert(!rv.includes('"by"'), "reveal has no authors");
  skipReveal(s, t);
  // Two monsters get one star each: a tie.
  const a = eligibleFor(s, "p0")[0];
  const b = eligibleFor(s, "p1").find((m) => m !== a)!;
  act(s, t, "p0", { type: "star", m: a });
  act(s, t, "p1", { type: "star", m: b });
  warp(s, t, VOTE_MS);
  const r = s.results[0];
  assert(r.top.length === 2 && r.top.includes(a) && r.top.includes(b), "tie at the top");
  console.log("✓ ties and name secrecy");
}

// ---------- min weirdness: 2 and 1 players don't crash ----------
{
  for (const n of [1, 2]) {
    const { t, s } = setup(n, 2);
    let guard = 0;
    while (!R(t) && guard++ < 300) warp(s, t, 5_000);
    assert(R(t), `n=${n} finishes`);
  }
  console.log("✓ tiny groups don't crash");
}

// ---------- host settings ----------
{
  const t = makeTestCtx(3, 8, { rounds: 1, draw: 45 });
  const s: MashupState = mashup.setup(t.ctx);
  assert(s.rounds === 1 && (mashup.view(s, "p0", t.ctx) as { rounds: number }).rounds === 1, "1 round");
  assert(s.endsAt - t.ctx.now() === 45_000 && s.phaseMs === 45_000, "45s drawing");
  for (let k = 0; k < 3; k++) warp(s, t, 45_000);
  assert(ph(s) === "name", "45s timers move draw stages");
  warp(s, t, NAME_MS);
  skipReveal(s, t);
  warp(s, t, VOTE_MS);
  warp(s, t, RESULTS_MS);
  assert(ph(s) === "final" && R(t), "1-round game ends after round 1");
  const td = makeTestCtx(3, 8, { rounds: 9, draw: 1 });
  const sd: MashupState = mashup.setup(td.ctx);
  assert(sd.rounds === ROUNDS && sd.drawMs === DRAW_MS, "bad settings fall back");
}

console.log("✓ mashup tests passed");
