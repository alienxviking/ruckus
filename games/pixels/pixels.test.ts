import { assert, makeTestCtx } from "../../shared/testing";
import type { GameResult } from "../../shared/types";
import { EMBLEMS } from "./data";
import game, {
  ABANDON_MS,
  FLUSH_MS,
  overlap,
  pickEmblems,
  type PixelsState,
  type PixelsView,
} from "./server";
import {
  CLIENT_BURST,
  CLIENT_PACE_MS,
  COOLDOWN_MS,
  EMBLEM_CELLS,
  INTRO_MS,
  MAX_BATCH,
  PAINT_MS,
  PERFECT_BONUS,
  REVEAL_MS,
  ROUNDS,
  SERVER_BURST,
  SPOTS_MS,
  bestMatch,
  boardSize,
  digits,
  type PixelsEvent,
} from "./shared";

// ---------- helpers ----------

type Harness = ReturnType<typeof makeTestCtx>;
/** `assert` without narrowing: state keeps mutating between checks. */
const check = (cond: unknown, msg: string): void => assert(cond, msg);
const view = (s: PixelsState, viewer: string, t: Harness) => game.view(s, viewer, t.ctx) as PixelsView;
const snap = (s: PixelsState) => JSON.stringify(s);
const tick = (t: Harness, s: PixelsState, ms: number) => {
  t.advance(ms);
  return game.tick!(s, t.ctx);
};
const evs = (t: Harness, k: PixelsEvent["k"]) =>
  t.events.filter((e) => (e.event as PixelsEvent).k === k) as { event: PixelsEvent; to?: string }[];

function countEnds(t: Harness) {
  const calls: GameResult[] = [];
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    calls.push(r);
    end(r);
  };
  return calls;
}

function newGame(n: number, seed = 42) {
  const t = makeTestCtx(n, seed);
  const ends = countEnds(t);
  const s: PixelsState = game.setup(t.ctx);
  return { t, s, ends };
}

function painting(n: number, seed = 42) {
  const g = newGame(n, seed);
  check(g.s.phase === "intro", "a round starts with the intro");
  tick(g.t, g.s, INTRO_MS);
  check(g.s.phase === "paint", "intro should give way to painting");
  return g;
}

/** Write an emblem straight onto the board (bypassing cooldowns). */
function stamp(s: PixelsState, art: string, x: number, y: number) {
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) s.board[(y + j) * s.w + x + i] = +art[j * 5 + i];
  s.encDirty = true;
}

/** Paint through the real action, waiting out the cooldown between pixels. */
function paintArt(g: ReturnType<typeof newGame>, who: number, art: string, x: number, y: number) {
  for (let k = 0; k < 25; k++) {
    const cell = (y + Math.floor(k / 5)) * g.s.w + x + (k % 5);
    g.t.advance(COOLDOWN_MS);
    game.action(g.s, g.t.ids[who], { type: "paint", px: [cell, +art[k]] }, g.t.ctx);
  }
}

const artOf = (s: PixelsState, p: number) => EMBLEMS[s.emblems[p]].art;

// ---------- catalogue ----------

{
  check(EMBLEMS.length >= 16, "at least 16 emblems");
  const ids = new Set(EMBLEMS.map((e) => e.id));
  const arts = new Set(EMBLEMS.map((e) => e.art));
  check(ids.size === EMBLEMS.length && arts.size === EMBLEMS.length, "emblem ids and art are unique");
  for (const e of EMBLEMS) {
    check(/^[1-8]{25}$/.test(e.art), `${e.id}: 25 paint colours`);
    const colours = new Set(e.art).size;
    check(colours >= 2 && colours <= 3, `${e.id}: uses 2-3 colours (has ${colours})`);
    check(e.name.length > 0 && e.icon.length > 0, `${e.id}: has a name and icon`);
  }
  check(overlap(0, 0) === EMBLEM_CELLS, "an emblem overlaps itself fully");
  check(overlap(0, 1) === overlap(1, 0), "overlap is symmetric");
}

// ---------- setup, board sizes, emblem picks ----------

for (const n of [2, 3, 5, 6, 8]) {
  const { s, t } = newGame(n, 7 + n);
  const { w, h } = boardSize(n);
  check(s.w === w && s.h === h && s.board.length === w * h, `${n}p board size`);
  check(n >= 6 ? w > 40 : w === 40 && h === 30, `${n}p: 40x30 up to 5 players, bigger from 6`);
  check(new Set(s.emblems).size === n, `${n}p: emblems distinct`);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) check(overlap(s.emblems[i], s.emblems[j]) <= 10, `${n}p: emblems don't overlap much`);
  check(s.board.every((c) => c === 0), "board starts blank");
  const v = view(s, t.ids[0], t);
  check(v.board.length === w * h && /^0+$/.test(v.board), "view carries the blank board");
  check(v.mine?.art === artOf(s, 0), "you see your own emblem");
}

// Nobody repeats an emblem across a long game; picks stay distinct even when the catalogue runs thin.
{
  const s = { ids: Array.from({ length: 8 }, (_, i) => `p${i}`), had: Array.from({ length: 8 }, () => [] as number[]), history: [] as PixelsState["history"] };
  let rnd = 1;
  const random = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < 6; r++) {
    const picks = pickEmblems(s, random);
    check(new Set(picks).size === 8, "picks distinct within a round");
    if (r < 3) picks.forEach((e, p) => check(!s.had[p].includes(e), "no player repeats an emblem in a 3-round game"));
    if (r < 3) check(picks.every((e) => !s.history.some((h) => h.e.includes(e))), "fresh emblems each round when possible");
    picks.forEach((e, p) => s.had[p].push(e));
    s.history.push({ e: picks, n: [], pts: [] });
  }
}

// ---------- painting, cooldown and events ----------

{
  const { s, t } = painting(3);
  const [a, b] = t.ids;
  t.events.length = 0;
  t.advance(FLUSH_MS);
  const rev0 = s.rev;
  const r = game.action(s, a, { type: "paint", px: [0, 3, 1, 4] }, t.ctx);
  check(r === false, "painting never triggers a full view");
  check(s.board[0] === 3 && s.board[1] === 4, "pixels land on the board");
  check(s.rev === rev0 + 2, "each pixel bumps the revision");
  const px = evs(t, "px");
  check(px.length === 1 && !px[0].to, "a quiet board broadcasts straight away, to everyone");
  const e = px[0].event as Extract<PixelsEvent, { k: "px" }>;
  check(e.r === s.rev && JSON.stringify(e.d) === JSON.stringify([0, 0, 3, 0, 1, 4]), "event carries painter, cell, colour");

  // A second batch right after is coalesced until the next tick.
  t.events.length = 0;
  t.advance(20);
  game.action(s, b, { type: "paint", px: [41, 7] }, t.ctx);
  check(evs(t, "px").length === 0, "busy board: pixels wait for the flush");
  check(s.board[41] === 7, "...but the board already has them");
  const v = view(s, a, t);
  check(v.board[41] === "7" && v.rev === s.rev, "a view built meanwhile includes buffered pixels");
  check(game.tick!(s, t.ctx) === false, "a flush tick doesn't broadcast the view");
  const flushed = evs(t, "px");
  check(flushed.length === 1 && (flushed[0].event as { d: number[] }).d.join() === "1,41,7", "tick flushes the buffer");

  // Burst then cooldown.
  t.events.length = 0;
  t.advance(5_000);
  const burst = Array.from({ length: SERVER_BURST + 2 }, (_, i) => [100 + i, 2]).flat();
  game.action(s, a, { type: "paint", px: burst }, t.ctx);
  const no = evs(t, "no");
  check(no.length === 1 && no[0].to === a, "refusals go only to the painter");
  check((no[0].event as { c: number[] }).c.join() === `${100 + SERVER_BURST},${101 + SERVER_BURST}`, "pixels past the burst are refused");
  check(s.board[100 + SERVER_BURST] === 0, "refused pixels don't land");
  t.events.length = 0;
  t.advance(COOLDOWN_MS - 5);
  game.action(s, a, { type: "paint", px: [200, 2] }, t.ctx);
  check(evs(t, "no").length === 1 && s.board[200] === 0, "cooldown enforced");
  t.advance(10);
  game.action(s, a, { type: "paint", px: [200, 2] }, t.ctx);
  check(s.board[200] === 2, "after the cooldown a pixel lands");
  // Repainting the same colour still echoes (the painter's optimistic pixel needs its confirmation).
  t.advance(1_000);
  t.events.length = 0;
  const before = s.rev;
  game.action(s, a, { type: "paint", px: [200, 2] }, t.ctx);
  game.tick!(s, t.ctx);
  check(s.rev === before + 1 && evs(t, "px").length === 1, "same-colour pixel still confirmed");
}

// A client pacing itself like the real one (190ms, burst 3, sends every 100ms, jittery network) is never refused.
{
  const { s, t } = painting(2, 3);
  const [a] = t.ids;
  t.events.length = 0;
  let tokens = CLIENT_BURST;
  let tokAt = 0;
  let clock = 0;
  const outbox: number[] = [];
  let lastSend = -1e9;
  const sends: { at: number; px: number[] }[] = [];
  let cell = 0;
  for (let step = 0; step < 4000; step++) {
    clock += 10;
    tokens = Math.min(CLIENT_BURST, tokens + (clock - tokAt) / CLIENT_PACE_MS);
    tokAt = clock;
    // A player dragging non-stop.
    while (tokens >= 1) {
      tokens -= 1;
      outbox.push(cell++ % (s.w * s.h), 1 + (cell % 8));
    }
    if (outbox.length && clock - lastSend >= 100) {
      sends.push({ at: clock, px: outbox.splice(0, MAX_BATCH * 2) });
      lastSend = clock;
    }
  }
  // Deliver with 20-180ms of latency, in order (a websocket never reorders).
  let arrive = 0;
  let seed = 9;
  const base = t.ctx.now();
  for (const m of sends) {
    seed = (seed * 48271) % 2147483647;
    arrive = Math.max(arrive, m.at + 20 + (seed % 160));
    const now = base + arrive;
    t.advance(now - t.ctx.now());
    if (t.ctx.now() >= s.endsAt) break;
    game.action(s, a, { type: "paint", px: m.px }, t.ctx);
  }
  check(evs(t, "no").length === 0, "a well-paced client is never refused");
}

// ---------- scoring ----------

{
  const g = painting(3);
  const { s, t } = g;
  const [a, b, c] = t.ids;
  // Player 0 paints a perfect copy through the real action; player 1 gets 20 of 25.
  paintArt(g, 0, artOf(s, 0), 3, 4);
  const art1 = artOf(s, 1);
  stamp(s, art1, 20, 10);
  for (let k = 0; k < 5; k++) s.board[10 * s.w + 20 + k] = 0;
  // Player 2 painted nothing that matches... except whatever the others share with them.
  const expect2 = bestMatch(s.board, s.w, s.h, digits(artOf(s, 2)));
  check(game.tick!(s, t.ctx) === false, "mid-paint ticks stay quiet");
  t.advance(PAINT_MS);
  check(game.tick!(s, t.ctx) === true && s.phase === "spots", "painting ends on time");
  check(s.spots![0].x === 3 && s.spots![0].y === 4 && s.spots![0].n === 25, "perfect copy found at its spot");
  check(s.pts![0] === 25 + PERFECT_BONUS, "perfect copy earns the bonus");
  check(s.spots![1].x === 20 && s.spots![1].y === 10 && s.spots![1].n === 20 && s.pts![1] === 20, "partial copy scores its matches");
  check(s.spots![2].n === expect2.n, "an unpainted emblem scores its best accidental match");
  check(s.totals[0] === 30 && s.totals[1] === 20, "totals updated");

  // Late paint is refused once the deadline passes.
  t.events.length = 0;
  game.action(s, a, { type: "paint", px: [0, 1] }, t.ctx);
  check(s.board[0] !== 1 && evs(t, "no").length === 1, "no painting after time");

  // Spots: still secret. Reveal: everyone's emblems.
  const vs = view(s, b, t);
  check(vs.spots!.length === 3 && vs.emblems === null && vs.pts === null, "spots first, emblems still hidden");
  tick(t, s, SPOTS_MS);
  check(s.phase === "reveal", "spots give way to the reveal");
  const vr = view(s, c, t);
  check(vr.emblems!.length === 3 && vr.emblems![0].art === artOf(s, 0) && vr.pts![0] === 30, "reveal shows emblems and points");
  t.events.length = 0;
  check(game.action(s, a, { type: "next" }, t.ctx) === false, "a 'next' tap is an event, not a full view");
  const ready = evs(t, "ready");
  check(ready.length === 1 && !ready[0].to && JSON.stringify(ready[0].event) === JSON.stringify({ k: "ready", i: 0, round: 1 }), "ready event to everyone");
  check(game.action(s, a, { type: "next" }, t.ctx) === false && evs(t, "ready").length === 1, "next counts once");
  check(view(s, b, t).ready.join() === "0", "ready shown in the view for late joiners");
  game.action(s, b, { type: "next" }, t.ctx);
  check(s.phase === "reveal", "waits for everyone");
  check(game.action(s, c, { type: "next" }, t.ctx) === true, "the last tap broadcasts the new round");
  check(s.phase === "intro" && s.round === 2, "everyone tapped next: next round at once");
  check(s.board.every((x) => x === 0), "fresh board each round");
  check(s.history.length === 1 && s.history[0].pts[0] === 30, "round recorded");
}

// ---------- secrecy ----------

{
  const { s, t } = newGame(4, 11);
  const secret = (p: number) => [EMBLEMS[s.emblems[p]].name, EMBLEMS[s.emblems[p]].art, EMBLEMS[s.emblems[p]].icon];
  const leaks = (viewer: string, p: number) => {
    const json = JSON.stringify(game.view(s, viewer, t.ctx));
    return secret(p).some((x) => json.includes(`"${x}"`));
  };
  const phases: string[] = [];
  for (let step = 0; step < 3; step++) {
    phases.push(s.phase);
    for (let p = 0; p < 4; p++) {
      check(!leaks("spectator", p), `${s.phase}: spectators can't see emblem ${p}`);
      for (let q = 0; q < 4; q++) if (q !== p) check(!leaks(t.ids[q], p), `${s.phase}: player ${q} can't see emblem ${p}`);
      check(leaks(t.ids[p], p), `${s.phase}: player ${p} sees their own emblem`);
    }
    t.advance(PAINT_MS);
    game.tick!(s, t.ctx);
  }
  check(phases.join() === "intro,paint,spots", "secrecy checked through intro, paint and spots");
  check(s.phase === "reveal" && leaks("spectator", 0), "revealed to everyone after the spots");
  check(view(s, "spectator", t).you === -1 && view(s, "spectator", t).mine === null, "spectator has no emblem");
}

// ---------- full game, ties, end exactly once ----------

{
  const g = newGame(3, 5);
  const { s, t, ends } = g;
  const sizes: number[] = [];
  for (let round = 1; round <= ROUNDS; round++) {
    check(s.round === round && s.phase === "intro", `round ${round} intro`);
    tick(t, s, INTRO_MS);
    check(s.phase === "paint", `round ${round} paint`);
    // p0 and p1 both paint perfect copies every round; p2 paints nothing.
    stamp(s, artOf(s, 0), 0, 0);
    stamp(s, artOf(s, 1), 30, 20);
    tick(t, s, PAINT_MS);
    check(s.phase === "spots", `round ${round} spots`);
    sizes.push(JSON.stringify(view(s, t.ids[0], t)).length);
    tick(t, s, SPOTS_MS);
    check(s.phase === "reveal", `round ${round} reveal`);
    sizes.push(JSON.stringify(view(s, t.ids[0], t)).length);
    check(ends.length === 0, "no end before the last reveal");
    tick(t, s, REVEAL_MS);
  }
  check(s.phase === "final", "final after three rounds");
  check(ends.length === 1, "end called once");
  check(t.result!.winners.length === 2 && t.result!.winners.includes(t.ids[0]) && t.result!.winners.includes(t.ids[1]), "tie: both winners");
  check(t.result!.scores![t.ids[0]] === 90 && /tie/.test(t.result!.headline), "tie headline and scores");
  const vf = view(s, t.ids[2], t);
  check(vf.history!.length === ROUNDS && vf.history![0].emblems.length === 3, "final standings carry every round");
  sizes.push(JSON.stringify(vf).length);
  check(Math.max(...sizes) < 4096, `views stay small (${Math.max(...sizes)} bytes)`);
  // Nothing moves after the end.
  const frozen = snap(s);
  check(game.tick!(s, t.ctx) === false, "no ticks after the end");
  check(game.action(s, t.ids[0], { type: "paint", px: [0, 1] }, t.ctx) === false, "no paint after the end");
  check(game.action(s, t.ids[0], { type: "next" }, t.ctx) === false, "no next after the end");
  t.advance(ABANDON_MS * 3);
  game.tick!(s, t.ctx);
  check(snap(s) === frozen && ends.length === 1, "state frozen after the end");
}

// A clear winner, and an all-zero game.
{
  const { s, t, ends } = newGame(2, 8);
  for (let round = 1; round <= ROUNDS; round++) {
    tick(t, s, INTRO_MS);
    stamp(s, artOf(s, 1), 10, 10);
    tick(t, s, PAINT_MS);
    tick(t, s, SPOTS_MS);
    tick(t, s, REVEAL_MS);
  }
  check(ends.length === 1 && t.result!.winners.join() === t.ids[1], "the painter wins");
  check(t.result!.headline.includes("Player1") && t.result!.headline.includes("90"), "headline names the winner");
}
{
  // Emblems never contain blank, so an untouched board scores zero for everyone.
  const { s, t } = newGame(2, 4);
  for (let round = 1; round <= ROUNDS; round++) {
    tick(t, s, INTRO_MS);
    tick(t, s, PAINT_MS);
    check(s.spots!.every((sp) => sp.n === 0), "blank board scores nothing");
    tick(t, s, SPOTS_MS);
    tick(t, s, REVEAL_MS);
  }
  check(t.result!.winners.length === 0 && /blank/.test(t.result!.headline), "nobody wins a blank game");
}

// ---------- 8 players: big board, small views ----------

{
  const { s, t } = painting(8, 21);
  check(s.w === 48 && s.h === 36, "8 players paint on 48x36");
  for (let i = 0; i < s.board.length; i++) s.board[i] = 1 + (i % 8);
  s.encDirty = true;
  const v = JSON.stringify(view(s, t.ids[3], t));
  check(v.length < 4096, `8p paint view under 4 KB (${v.length})`);
  for (let k = 0; k < 3; k++) tick(t, s, PAINT_MS);
  check(s.phase === "intro" && s.round === 2, "8p rounds advance");
}

// ---------- hostile actions ----------

{
  const { s, t } = painting(3);
  const [a] = t.ids;
  const size = s.w * s.h;
  const before = snap(s);
  const junk: unknown[] = [
    null,
    undefined,
    42,
    "paint",
    [],
    [{ type: "paint", px: [0, 1] }],
    {},
    { type: null },
    { type: "__proto__" },
    { type: "constructor" },
    { type: "paint" },
    { type: "paint", px: "0,1" },
    { type: "paint", px: [] },
    { type: "paint", px: [0] },
    { type: "paint", px: [0, 1, 2] },
    { type: "paint", px: [0, 0] },
    { type: "paint", px: [0, 9] },
    { type: "paint", px: [0, -1] },
    { type: "paint", px: [0, 1.5] },
    { type: "paint", px: [0.5, 1] },
    { type: "paint", px: [-1, 1] },
    { type: "paint", px: [size, 1] },
    { type: "paint", px: [Number.NaN, 1] },
    { type: "paint", px: [Infinity, 1] },
    { type: "paint", px: ["0", "1"] },
    { type: "paint", px: [0, 1, 1, "x"] },
    { type: "paint", px: [null, 1] },
    { type: "paint", px: { 0: 0, 1: 1, length: 2 } },
    { type: "paint", px: new Array(MAX_BATCH * 2 + 2).fill(1) },
    { type: "paint", px: new Array(5000).fill(1) },
    { type: "next" },
    { type: "nope", px: [0, 1] },
    { type: "guess", text: "a".repeat(5000) },
  ];
  for (const j of junk) check(game.action(s, a, j as never, t.ctx) === false, `junk rejected: ${JSON.stringify(j)?.slice(0, 60)}`);
  check(game.action(s, "stranger", { type: "paint", px: [0, 1] }, t.ctx) === false, "non-participants can't paint");
  check(snap(s) === before, "junk changed nothing");
  check(game.spectatorAction!(s, "spectator", { type: "paint", px: [0, 1] }, t.ctx) === false, "spectators can't paint");
  check(game.spectatorAction!(s, "spectator", null, t.ctx) === false, "spectator junk ignored");
  check(snap(s) === before, "spectator junk changed nothing");

  // Painting before the round starts is refused (and the painter told).
  const g2 = newGame(2);
  g2.t.events.length = 0;
  check(game.action(g2.s, g2.t.ids[0], { type: "paint", px: [0, 1] }, g2.t.ctx) === false, "no painting in the intro");
  check(g2.s.board[0] === 0 && evs(g2.t, "no").length === 1, "intro paint refused");
}

// ---------- sync ----------

{
  const { s, t } = painting(2);
  game.action(s, t.ids[0], { type: "paint", px: [5, 6] }, t.ctx);
  t.events.length = 0;
  check(game.action(s, t.ids[1], { type: "sync" }, t.ctx) === false, "sync never broadcasts the view");
  const b = evs(t, "board");
  check(b.length === 1 && b[0].to === t.ids[1], "board sent to the asker only");
  const ev = b[0].event as Extract<PixelsEvent, { k: "board" }>;
  check(ev.r === s.rev && ev.b.length === s.w * s.h && ev.b[5] === "6", "board event is current");
  game.action(s, t.ids[1], { type: "sync" }, t.ctx);
  check(evs(t, "board").length === 1, "sync rate-limited");
  t.advance(1_000);
  game.spectatorAction!(s, "spectator", { type: "sync" }, t.ctx);
  check(evs(t, "board").length === 2 && evs(t, "board")[1].to === "spectator", "spectators can resync");
  game.spectatorAction!(s, "__proto__", { type: "sync" }, t.ctx);
  check(Object.getPrototypeOf({}) === Object.prototype, "hostile viewer ids can't touch prototypes");
}

// ---------- disconnects ----------

{
  // Three players: one leaves in every phase, the game carries on.
  const { s, t, ends } = newGame(3, 2);
  const away = t.ctx.players[2];
  const order: string[] = [];
  for (let k = 0; k < 4; k++) {
    order.push(s.phase);
    away.connected = false;
    game.playerLeft!(s, away.id, t.ctx);
    check(s.aloneSince === null, "two still here: no abandon timer");
    if (s.phase === "reveal") {
      game.action(s, t.ids[0], { type: "next" }, t.ctx);
      game.action(s, t.ids[1], { type: "next" }, t.ctx);
      check((s.phase as string) === "intro", "reveal skips without the absent player");
    } else {
      t.advance(PAINT_MS);
      game.tick!(s, t.ctx);
    }
    away.connected = true;
    game.playerReturned!(s, away.id, t.ctx);
  }
  check(order.join() === "intro,paint,spots,reveal", "covered every phase");
  check(s.round === 2 && ends.length === 0, "game rolls on");

  // A reveal where the absent player never taps: the clock still moves on.
  for (let k = 0; k < 3; k++) tick(t, s, PAINT_MS);
  check(s.phase === "reveal", "back at a reveal");
  away.connected = false;
  game.action(s, t.ids[0], { type: "next" }, t.ctx);
  game.action(s, t.ids[1], { type: "next" }, t.ctx);
  check(s.phase === "intro" && s.round === 3, "absent player doesn't block the reveal");
  away.connected = true;
}

for (const phase of ["intro", "paint", "spots", "reveal"]) {
  // Two players: one leaves, comes back in time -> nothing happens; leaves for good -> the other wins.
  const { s, t, ends } = newGame(2, 6);
  while (s.phase !== phase) tick(t, s, PAINT_MS);
  const gone = t.ctx.players[1];
  gone.connected = false;
  game.playerLeft!(s, gone.id, t.ctx);
  check(s.aloneSince !== null && view(s, t.ids[0], t).abandonAt !== null, `${phase}: abandon timer shown`);
  t.advance(ABANDON_MS - 100);
  gone.connected = true;
  game.playerReturned!(s, gone.id, t.ctx);
  check(s.aloneSince === null, `${phase}: back in time clears the timer`);
  gone.connected = false;
  game.playerLeft!(s, gone.id, t.ctx);
  let guard = 0;
  while (!t.result && guard++ < 200) tick(t, s, 500);
  check(ends.length === 1 && t.result!.winners.join() === t.ids[0], `${phase}: the player who stayed wins`);
  check(s.phase === "final" && s.endReason === "abandoned", `${phase}: ended as abandoned`);
  const vf = view(s, t.ids[0], t);
  check(vf.emblems !== null && Array.isArray(vf.history), `${phase}: final view is complete`);
}

{
  // Everyone gone: still ends, no winners.
  const { s, t, ends } = painting(2);
  for (const p of t.ctx.players) {
    p.connected = false;
    game.playerLeft!(s, p.id, t.ctx);
  }
  tick(t, s, ABANDON_MS + 100);
  check(ends.length === 1 && t.result!.winners.length === 0, "empty room ends without winners");
}

// ---------- host settings ----------

{
  const t = makeTestCtx(2, 3, { rounds: 2, paint: 45 });
  const s: PixelsState = game.setup(t.ctx);
  check(view(s, t.ids[0], t).rounds === 2, "view shows the host's round count");
  tick(t, s, INTRO_MS);
  check(s.phase === "paint" && s.endsAt === t.ctx.now() + 45_000, "45s painting");
  check(view(s, t.ids[0], t).phaseMs === 45_000, "timer bar uses the host's paint time");
  let guard = 0;
  while (!t.result && guard++ < 50) tick(t, s, 45_000);
  check(t.result && s.round === 2 && s.history.length === 2, "two rounds when the host asks");
  const d = game.setup(makeTestCtx(2).ctx);
  check(d.rounds === ROUNDS && d.paintMs === PAINT_MS, "defaults unchanged");
}

// ---------- practice bots ----------

for (const [humans, bots] of [
  [1, 2],
  [0, 4],
]) {
  const n = humans + bots;
  const t = makeTestCtx(n, 11, {}, bots);
  const s: PixelsState = game.setup(t.ctx);
  let ms = 0;
  while (!t.result && ms < 20 * 60_000) {
    t.advance(100);
    ms += 100;
    for (const id of t.ids) {
      if (!id.startsWith("bot-")) continue;
      const a = game.bot!(s, id, t.ctx);
      if (a) game.action(s, id, a, t.ctx);
    }
    game.tick!(s, t.ctx);
  }
  check(t.result, `bots finish the game (${humans} human + ${bots} bots)`);
  const botTotals = s.ids.flatMap((id, i) => (id.startsWith("bot-") ? [s.totals[i]] : []));
  check(botTotals.every((x) => x > 20), `bots score points (${botTotals.join(", ")})`);
  check(evs(t, "no").length < 5, "bots pace themselves under the cooldown");
  console.log(`  bots: ${humans} human + ${bots} bots in ${Math.round(ms / 1000)}s, totals ${botTotals.join("/")}`);
}

// ---------- Red vs Blue ----------

{
  // Solo by default, and team mode needs two players.
  check(newGame(4).s.teams === null, "solo by default");
  const one = makeTestCtx(1, 3, { mode: "teams" });
  check(game.setup(one.ctx).teams === null, "one player can't make two teams");

  for (const n of [2, 3, 4, 5, 7]) {
    const t = makeTestCtx(n, 20 + n, { mode: "teams" });
    const s: PixelsState = game.setup(t.ctx);
    const [a, b] = s.teams!;
    check(a.length + b.length === n && Math.abs(a.length - b.length) <= 1, `${n}p: teams split evenly`);
    check(new Set([...a, ...b]).size === n, `${n}p: everyone on exactly one team`);
    const red = s.ids.indexOf(a[0]);
    const blue = s.ids.indexOf(b[0]);
    for (const id of a) check(s.emblems[s.ids.indexOf(id)] === s.emblems[red], `${n}p: Red shares one emblem`);
    for (const id of b) check(s.emblems[s.ids.indexOf(id)] === s.emblems[blue], `${n}p: Blue shares one emblem`);
    check(s.emblems[red] !== s.emblems[blue] && overlap(s.emblems[red], s.emblems[blue]) <= 10, `${n}p: team emblems differ`);
    const v = view(s, a[a.length - 1], t);
    check(v.teams?.[0].join() === a.join() && v.mine?.art === EMBLEMS[s.emblems[red]].art, `${n}p: teammates see the team emblem`);
  }

  // Red (2) paints its emblem perfectly every round; Blue (1) paints a partial copy. Uneven teams
  // are fair: each team scores its best copy, the same for one painter or five.
  const t = makeTestCtx(3, 5, { mode: "teams", rounds: 2 });
  const ends = countEnds(t);
  const s: PixelsState = game.setup(t.ctx);
  const [red, blue] = s.teams!;
  check(red.length === 2 && blue.length === 1, "3 players: Red gets the extra one");
  const ri = s.ids.indexOf(red[0]);
  const bi = s.ids.indexOf(blue[0]);
  for (let r = 0; r < 2; r++) {
    tick(t, s, INTRO_MS);
    stamp(s, artOf(s, ri), 1, 1);
    const blueArt = artOf(s, bi);
    stamp(s, blueArt, 20, 10);
    s.board[10 * s.w + 20] = (+blueArt[0] % 8) + 1; // one pixel wrong
    tick(t, s, s.paintMs);
    check(s.pts![ri] === EMBLEM_CELLS + PERFECT_BONUS && s.pts![s.ids.indexOf(red[1])] === s.pts![ri], "teammates share the round score");
    check(s.pts![bi] === EMBLEM_CELLS - 1, "Blue scores its best copy");
    tick(t, s, SPOTS_MS);
    tick(t, s, REVEAL_MS);
  }
  check(ends.length === 1 && s.phase === "final", "team game ends");
  const res = t.result!;
  check(res.winners.length === 2 && red.every((id) => res.winners.includes(id)), "winners are the whole Red team");
  check(/^Red team wins/.test(res.headline) && res.headline.includes("60") && res.headline.includes("48"), `team headline: ${res.headline}`);
  check(res.scores![red[0]] === 60 && res.scores![blue[0]] === 48, "per-player scores still reported");

  // Equal teams that tie: everyone shares the win.
  const t2 = makeTestCtx(4, 9, { mode: "teams", rounds: 2 });
  const s2: PixelsState = game.setup(t2.ctx);
  for (let r = 0; r < 2; r++) {
    tick(t2, s2, INTRO_MS);
    stamp(s2, EMBLEMS[s2.emblems[s2.ids.indexOf(s2.teams![0][0])]].art, 1, 1);
    stamp(s2, EMBLEMS[s2.emblems[s2.ids.indexOf(s2.teams![1][0])]].art, 20, 10);
    tick(t2, s2, s2.paintMs);
    tick(t2, s2, SPOTS_MS);
    tick(t2, s2, REVEAL_MS);
  }
  check(t2.result!.winners.length === 4 && /Red and Blue tie/.test(t2.result!.headline), `team tie: ${t2.result!.headline}`);
}

// Bots in Red vs Blue: they finish, cooperate on one copy, and never deface their own team's copy.
for (const [humans, bots] of [
  [0, 4],
  [1, 4],
]) {
  const n = humans + bots;
  const t = makeTestCtx(n, 31, { mode: "teams" }, bots);
  const s: PixelsState = game.setup(t.ctx);
  let ms = 0;
  let selfHarm = 0;
  while (!t.result && ms < 20 * 60_000) {
    t.advance(100);
    ms += 100;
    for (const id of t.ids) {
      if (!id.startsWith("bot-")) continue;
      const a = game.bot!(s, id, t.ctx);
      if (!a) continue;
      if (a.type === "paint" && s.phase === "paint") {
        const art = digits(artOf(s, s.ids.indexOf(id)));
        const before = bestMatch(s.board, s.w, s.h, art).n;
        game.action(s, id, a, t.ctx);
        if (bestMatch(s.board, s.w, s.h, art).n < before) selfHarm++;
      } else game.action(s, id, a, t.ctx);
    }
    game.tick!(s, t.ctx);
  }
  check(t.result, `team bots finish the game (${humans} human + ${bots} bots)`);
  check(selfHarm === 0, `team bots never lower their own team's copy (${selfHarm})`);
  const [a, b] = s.teams!;
  const winTeam = a.every((id) => t.result!.winners.includes(id)) ? a : b;
  check(t.result!.winners.length === winTeam.length || t.result!.winners.length === n, "team bots: winners are a whole team");
  const tot = s.ids.map((_, i) => s.totals[i]);
  check(tot.every((x) => x > 20), `team bots score points (${tot.join(", ")})`);
  check(evs(t, "no").length < 5, "team bots pace themselves under the cooldown");
  console.log(`  team bots: ${humans} human + ${bots} bots in ${Math.round(ms / 1000)}s: ${t.result!.headline}`);
}

console.log("✓ pixels: all tests passed");
