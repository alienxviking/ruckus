import { assert, makeTestCtx } from "../../shared/testing";
import game, { type MrState } from "./server";
import { BOOM, HIDDEN, MINE, MineStore } from "./store";
import {
  ABANDON_MS,
  FLAG_POINTS,
  FREEZE_MS,
  GEM_POINTS,
  MINE_PENALTY,
  PLAY_MS,
  READY_MS,
  STUN_MS,
  neighbors,
  type FullEvent,
  type MrView,
  type NoEvent,
  type OpEvent,
} from "./shared";

type T = ReturnType<typeof makeTestCtx>;

/** Count ctx.end calls (makeTestCtx only keeps the first result). */
function countEnds(t: T) {
  let n = 0;
  const end = t.ctx.end;
  t.ctx.end = (r) => {
    n += 1;
    end(r);
  };
  return () => n;
}

function start(n: number, seed = 42) {
  const t = makeTestCtx(n, seed);
  const ends = countEnds(t);
  const s: MrState = game.setup(t.ctx);
  return { t, s, ends };
}

function toPlay(t: T, s: MrState) {
  t.advance(READY_MS);
  assert(game.tick!(s, t.ctx) === true, "ready -> play broadcasts");
  assert(s.phase === "play", "playing");
}

/** Read-through helpers (TS would otherwise keep narrowing from earlier asserts). */
const openOf = (s: MrState, i: number): number => s.open[i];
const flagCountOf = (s: MrState, p: number): number => s.flagCount[p];
const phaseOf = (s: MrState): string => s.phase;
const view = (s: MrState, id: string, t: T) => game.view(s, id, t.ctx) as MrView;
const hidden = (s: MrState) => s.open.map((o, i) => (o === 0 ? i : -1)).filter((i) => i >= 0);
const safeHidden = (s: MrState) => hidden(s).filter((i) => !s.mine[i]);
const ops = (t: T) => t.events.map((e) => e.event as OpEvent).filter((e) => e.t === "op");
const lastOp = (t: T) => {
  const all = ops(t);
  return all[all.length - 1];
};
/** Safe hidden cells by a predicate, avoiding pickups unless asked. */
function findSafe(s: MrState, pred: (i: number) => boolean = () => true, item = false) {
  return safeHidden(s).find((i) => pred(i) && (item ? true : !s.item[i]));
}

// ---------- setup ----------

for (const n of [1, 2, 3, 4, 8]) {
  const { s, t } = start(n, 7 + n);
  const big = n >= 4;
  assert(s.w === (big ? 30 : 24) && s.h === (big ? 20 : 16), `board size for ${n}`);
  const mines = s.mine.reduce((a, b) => a + b, 0);
  assert(mines === s.mineCount && mines === Math.round(s.w * s.h * 0.17), "~17% mines");
  assert(s.openings.length === (big ? 3 : 1), "extra openings for big groups");
  for (const c of s.openings) {
    assert(s.num[c] === 0 && s.open[c] === 1, "each opening starts on an open zero");
    for (const nb of neighbors(s.w, s.h, c)) assert(s.open[nb] === 1, "zeros open their neighbours");
  }
  assert(s.owner.every((o) => o === -1), "openings belong to nobody");
  assert(s.opened > 8 && s.opened <= s.safeTotal * 0.3, "a foothold, not a giveaway");
  // Every open zero has all its neighbours open (consistent cascades).
  s.open.forEach((o, i) => {
    if (o === 1 && s.num[i] === 0) assert(neighbors(s.w, s.h, i).every((nb) => s.open[nb] === 1), "cascade closure");
  });
  const items = s.item.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
  assert(items.every((i) => !s.mine[i] && s.open[i] === 0), "pickups hide under hidden safe cells");
  const freezes = s.item.filter((k) => k === "f").length;
  assert(n === 1 ? freezes === 0 : freezes >= 2, "no freezes when solo");
  assert(s.item.filter((k) => k === "g").length >= 3 && s.item.filter((k) => k === "s").length >= 2, "gems and scans");
  // Numbers are right.
  for (let i = 0; i < s.w * s.h; i++) {
    assert(s.num[i] === neighbors(s.w, s.h, i).filter((nb) => s.mine[nb]).length, "numbers");
  }
  const v = view(s, t.ids[0], t);
  assert(v.phase === "ready" && v.cells.length === s.w * s.h && v.own.length === s.w * s.h, "view shape");
  assert(JSON.stringify(v).length < 4096, `view stays small (${JSON.stringify(v).length} B)`);
}

// ---------- phases and early inputs ----------

{
  const { t, s } = start(3);
  const cell = findSafe(s)!;
  assert(game.action(s, t.ids[0], { type: "open", cell }, t.ctx) === false, "no digging before GO");
  const no = t.events.at(-1)!;
  assert((no.event as NoEvent).t === "no" && (no.event as NoEvent).c === cell && no.to === t.ids[0], "private refusal");
  assert(s.open[cell] === 0, "nothing opened early");
  t.advance(READY_MS - 10);
  assert(game.tick!(s, t.ctx) === false, "quiet ticks while waiting");
  t.advance(10);
  assert(game.tick!(s, t.ctx) === true && s.phase === "play", "GO");
  assert(game.tick!(s, t.ctx) === false, "quiet ticks while playing");
}

// ---------- digging: single cells, cascades, ownership ----------

{
  const { t, s } = start(2);
  toPlay(t, s);
  const [a, b] = t.ids;
  const numbered = findSafe(s, (i) => s.num[i] > 0)!;
  const before = s.opened;
  assert(game.action(s, a, { type: "open", cell: numbered }, t.ctx) === false, "reveals don't broadcast full views");
  const e = lastOp(t);
  assert(e && e.p === 0 && e.a === numbered && e.o.length === 1 && e.o[0] === numbered, "one cell op");
  assert(e.n === String(s.num[numbered]) && e.d === 1 && e.sc === 1 && e.x.length === 0, "number and +1");
  assert(e.s === 1 && s.s === 1, "op counter");
  assert(s.opened === before + 1 && s.owner[numbered] === 0, "owned by the digger");
  const v = view(s, b, t);
  assert(v.cells[numbered] === String(s.num[numbered]) && v.own[numbered] === "0" && v.s === 1, "visible to everyone");
  assert(JSON.stringify(e).length < 120, "single reveal event is tiny");

  // First come, first served: the same cell again is refused.
  t.events.length = 0;
  assert(game.action(s, b, { type: "open", cell: numbered }, t.ctx) === false, "taken");
  assert(ops(t).length === 0 && (t.events[0].event as NoEvent).c === numbered, "refusal only");

  // A hidden zero cascades, and every cell scores.
  const zero = findSafe(s, (i) => s.num[i] === 0, true);
  assert(zero !== undefined, "a hidden zero exists");
  {
    const score = s.ps[1].score;
    game.action(s, b, { type: "open", cell: zero }, t.ctx);
    const c = lastOp(t);
    assert(c.o.length > 1 && c.o[0] === zero, "cascade from the click");
    const gems = c.k.filter(([, k]) => k === "g").length;
    assert(s.ps[1].score === score + c.o.length + gems * GEM_POINTS, "1 point per opened cell");
    for (const i of c.o) if (s.num[i] === 0) assert(neighbors(s.w, s.h, i).every((nb) => s.open[nb] === 1), "closure");
    assert(c.n.length === c.o.length, "a digit per cell");
  }
}

// ---------- mines: penalty, stun, explosion is public ----------

{
  const { t, s } = start(2);
  toPlay(t, s);
  const [a, b] = t.ids;
  const mine = hidden(s).find((i) => s.mine[i])!;
  game.action(s, a, { type: "open", cell: mine }, t.ctx);
  const e = lastOp(t);
  assert(e.x.length === 1 && e.x[0] === mine && e.o.length === 0, "boom");
  assert(e.d === -MINE_PENALTY && s.ps[0].score === -MINE_PENALTY, "-10");
  assert(e.st === t.ctx.now() + STUN_MS && s.ps[0].stun === e.st, "stunned 4s");
  assert(view(s, b, t).cells[mine] === "x" && view(s, "spectator", t).cells[mine] === "x", "explosion shows for everyone");
  const safe = findSafe(s)!;
  t.events.length = 0;
  assert(game.action(s, a, { type: "open", cell: safe }, t.ctx) === false && ops(t).length === 0, "stunned can't dig");
  assert(game.action(s, a, { type: "flag", cell: safe, on: true, q: 1 }, t.ctx) === false && !s.flagMask[safe], "or flag");
  assert(game.action(s, b, { type: "open", cell: mine }, t.ctx) === false, "an exploded mine stays exploded");
  t.advance(STUN_MS);
  game.action(s, a, { type: "open", cell: safe }, t.ctx);
  assert(s.open[safe] === 1, "back in action after 4s");
}

// ---------- pickups ----------

{
  const { t, s } = start(3);
  toPlay(t, s);
  const [a, b, c] = t.ids;
  const gem = s.item.indexOf("g");
  game.action(s, a, { type: "open", cell: gem }, t.ctx);
  let e = lastOp(t);
  assert(e.k.some(([cell, k]) => cell === gem && k === "g"), "gem claimed");
  assert(s.ps[0].score === e.o.length + GEM_POINTS * e.k.filter(([, k]) => k === "g").length, "+15");
  assert(s.claimed.some(([cell, k, p]) => cell === gem && k === "g" && p === 0), "claimed is public");
  assert(view(s, c, t).items.some(([cell]) => cell === gem), "everyone sees the gem's spot");

  // Freeze: everyone else is frozen, the freezer isn't.
  const fr = s.item.indexOf("f");
  game.action(s, b, { type: "open", cell: fr }, t.ctx);
  e = lastOp(t);
  assert(e.fz === t.ctx.now() + FREEZE_MS, "freeze until");
  assert(s.ps[0].frozen === e.fz && s.ps[2].frozen === e.fz && s.ps[1].frozen === 0, "others frozen");
  assert(s.ps[0].frozenBy === 1, "frozen by");
  const safe = findSafe(s)!;
  game.action(s, a, { type: "open", cell: safe }, t.ctx);
  assert(s.open[safe] === 0, "frozen can't dig");
  game.action(s, b, { type: "open", cell: safe }, t.ctx);
  assert(openOf(s, safe) === 1, "the freezer can");
  t.advance(FREEZE_MS);
  const safe2 = findSafe(s)!;
  game.action(s, a, { type: "open", cell: safe2 }, t.ctx);
  assert(s.open[safe2] === 1, "thawed");

  // Scan: flags nearby mines for the scanner only, in a private copy of the event.
  const sc = s.item.indexOf("s");
  t.events.length = 0;
  game.action(s, c, { type: "open", cell: sc }, t.ctx);
  const pub = t.events.find((x) => (x.event as OpEvent).t === "op" && x.except === c)!;
  const mine = t.events.find((x) => (x.event as OpEvent).t === "op" && x.to === c)!;
  assert(pub && mine, "public + private copies");
  assert((pub.event as OpEvent).sm === undefined, "no scan data in the public copy");
  const sm = (mine.event as OpEvent).sm!;
  const x0 = sc % s.w;
  const y0 = Math.floor(sc / s.w);
  const expect = hidden(s).filter((i) => s.mine[i] && Math.abs((i % s.w) - x0) <= 2 && Math.abs(Math.floor(i / s.w) - y0) <= 2);
  assert(sm.length === expect.length && expect.every((i) => sm.includes(i)), "the 5x5 mines");
  const vc = view(s, c, t);
  assert(sm.every((i) => vc.flags.includes(i)), "scanner gets flags");
  for (const id of [a, b, "spectator"]) {
    const v = view(s, id, t);
    assert(sm.every((i) => !v.flags.includes(i) && v.cells[i] === "."), "nobody else learns them");
  }
}

// ---------- flags: private, protective, removed when opened, capped ----------

{
  const { t, s } = start(2);
  toPlay(t, s);
  const [a, b] = t.ids;
  const target = findSafe(s, (i) => s.num[i] > 0)!;
  assert(game.action(s, a, { type: "flag", cell: target, on: true, q: 1 }, t.ctx) === false, "flags never broadcast");
  assert(s.flagCount[0] === 1 && s.fq[0] === 1, "flag stored");
  assert(view(s, a, t).flags.includes(target) && view(s, a, t).fq === 1, "my view has it");
  assert(!view(s, b, t).flags.length && !view(s, "spectator", t).flags.length, "private");
  t.events.length = 0;
  assert(game.action(s, a, { type: "open", cell: target }, t.ctx) === false && s.open[target] === 0, "my flag protects");
  // Same state again is a no-op; a stale q doesn't lower fq.
  game.action(s, a, { type: "flag", cell: target, on: true, q: 0 }, t.ctx);
  assert(s.flagCount[0] === 1 && s.fq[0] === 1, "idempotent");
  // Someone else opens it: the (wrong) flag disappears.
  game.action(s, b, { type: "open", cell: target }, t.ctx);
  assert(openOf(s, target) === 1 && flagCountOf(s, 0) === 0 && !s.flagMask[target], "flag cleared on reveal");
  // Flagging an open cell is refused with the op id.
  t.events.length = 0;
  game.action(s, a, { type: "flag", cell: target, on: true, q: 2 }, t.ctx);
  assert((t.events[0].event as NoEvent).q === 2 && s.fq[0] >= 2, "refused flag op");
  // Unflag works.
  const other = hidden(s)[0];
  game.action(s, a, { type: "flag", cell: other, on: true, q: 3 }, t.ctx);
  game.action(s, a, { type: "flag", cell: other, on: false, q: 4 }, t.ctx);
  assert(flagCountOf(s, 0) === 0 && !s.flagMask[other], "unflagged");
  // Cap: at most one flag per mine.
  const hid = hidden(s);
  let q = 10;
  for (const i of hid.slice(0, s.mineCount + 5)) game.action(s, a, { type: "flag", cell: i, on: true, q: q++ }, t.ctx);
  assert(s.flagCount[0] === s.mineCount, "flag cap");
}

// ---------- chording ----------

{
  const { t, s } = start(2, 99);
  toPlay(t, s);
  const [a, b] = t.ids;
  // An open number with hidden neighbours, some of them safe.
  const num = s.open.findIndex(
    (o, i) =>
      o === 1 &&
      s.num[i] > 0 &&
      neighbors(s.w, s.h, i).some((nb) => s.open[nb] === 0 && !s.mine[nb]) &&
      neighbors(s.w, s.h, i).some((nb) => s.open[nb] === 0 && s.mine[nb]),
  );
  assert(num >= 0, "found a chordable number");
  const around = neighbors(s.w, s.h, num);
  const mines = around.filter((nb) => s.open[nb] === 0 && s.mine[nb]);
  const safes = around.filter((nb) => s.open[nb] === 0 && !s.mine[nb]);
  // Not enough flags: refused.
  t.events.length = 0;
  assert(game.action(s, a, { type: "chord", cell: num }, t.ctx) === false && ops(t).length === 0, "needs flags");
  let q = 1;
  for (const m of mines) game.action(s, a, { type: "flag", cell: m, on: true, q: q++ }, t.ctx);
  assert(mines.length === s.num[num], "all its mines flagged");
  {
    game.action(s, a, { type: "chord", cell: num }, t.ctx);
    assert(safes.every((i) => s.open[i] === 1), "chord opens the rest");
    assert(mines.every((i) => s.open[i] === 0), "flagged mines stay put");
  }
  // Chording a hidden cell or a zero is refused.
  const hiddenCell = hidden(s)[0];
  assert(game.action(s, b, { type: "chord", cell: hiddenCell }, t.ctx) === false && s.open[hiddenCell] === 0, "chord on hidden");
}

{
  // A wrong flag makes a chord blow up.
  const { t, s } = start(2, 5);
  toPlay(t, s);
  const [a] = t.ids;
  const num = s.open.findIndex((o, i) => {
    if (o !== 1 || s.num[i] !== 1) return false;
    const h = neighbors(s.w, s.h, i).filter((nb) => s.open[nb] === 0);
    return h.some((nb) => s.mine[nb]) && h.some((nb) => !s.mine[nb]);
  });
  assert(num >= 0, "found a 1 with a mine and a safe cell around it");
  {
    const around = neighbors(s.w, s.h, num).filter((nb) => s.open[nb] === 0);
    const wrong = around.find((nb) => !s.mine[nb])!;
    const mine = around.find((nb) => s.mine[nb])!;
    game.action(s, a, { type: "flag", cell: wrong, on: true, q: 1 }, t.ctx);
    game.action(s, a, { type: "chord", cell: num }, t.ctx);
    assert(s.open[mine] === 2 && s.ps[0].stun > t.ctx.now(), "wrong flag -> boom + stun");
  }
}

// ---------- a full game, cleared, with flag scoring ----------

{
  const { t, s, ends } = start(3, 1234);
  toPlay(t, s);
  const [a, b, c] = t.ids;
  // b flags 3 mines correctly and 1 safe cell wrongly; that safe cell is left for last.
  const someMines = hidden(s).filter((i) => s.mine[i]).slice(0, 3);
  let q = 1;
  for (const m of someMines) game.action(s, b, { type: "flag", cell: m, on: true, q: q++ }, t.ctx);
  // a hits a mine once.
  const boom = hidden(s).find((i) => s.mine[i] && !someMines.includes(i))!;
  game.action(s, a, { type: "open", cell: boom }, t.ctx);
  t.advance(STUN_MS);
  let guard = 0;
  let turn = 0;
  while (!t.result && guard++ < 5000) {
    const left = safeHidden(s);
    if (!left.length) break;
    const who = [a, b, c][turn++ % 3];
    const p = s.ids.indexOf(who);
    if (s.ps[p].stun > t.ctx.now() || s.ps[p].frozen > t.ctx.now()) {
      t.advance(500);
      continue;
    }
    const cell = left.find((i) => !(s.flagMask[i] & (1 << p)))!;
    const r = game.action(s, who, { type: "open", cell }, t.ctx);
    if (r === true) break;
  }
  assert(t.result, "game ends when every safe cell is open");
  assert(ends() === 1, "ctx.end exactly once");
  assert(s.phase === "over" && s.why === "cleared", "cleared");
  assert(s.fin && s.fin[1].right === 3 && s.fin[1].wrong === 0 && s.fin[1].flagPts === 3 * FLAG_POINTS, "flags score at the end");
  const scores = t.result.scores!;
  const best = Math.max(...Object.values(scores));
  assert(t.result.winners.every((id) => scores[id] === best) && t.result.winners.length >= 1, "winners are top scorers");
  assert(s.fin.every((f, p) => f.score === scores[s.ids[p]]), "final rows match scores");
  // Points add up: opened + gems*15 - booms*10 + flags.
  for (const [p, f] of s.fin.entries()) {
    assert(f.score === f.opened + f.gems * GEM_POINTS - f.booms * MINE_PENALTY + f.flagPts, `score adds up for ${p}`);
  }
  // The final board reveals the mines nobody hit.
  const v = view(s, c, t);
  assert(v.fin && v.why === "cleared" && v.cells.includes("m") && v.cells[boom] === "x", "final board");
  assert(game.action(s, a, { type: "open", cell: someMines[0] }, t.ctx) === false, "no digging after the end");
  t.advance(PLAY_MS);
  assert(game.tick!(s, t.ctx) === false, "no ticks after the end");
  assert(ends() === 1, "still once");
}

// ---------- time runs out; wrong flags cost ----------

{
  const { t, s, ends } = start(2, 77);
  toPlay(t, s);
  const [a, b] = t.ids;
  const wrong = findSafe(s)!;
  const right = hidden(s).find((i) => s.mine[i])!;
  game.action(s, a, { type: "flag", cell: wrong, on: true, q: 1 }, t.ctx);
  game.action(s, a, { type: "flag", cell: right, on: true, q: 2 }, t.ctx);
  const cell = findSafe(s, (i) => s.num[i] > 0 && i !== wrong)!;
  game.action(s, b, { type: "open", cell }, t.ctx);
  t.advance(PLAY_MS - 1);
  assert(game.tick!(s, t.ctx) === false, "not yet");
  t.advance(1);
  assert(game.tick!(s, t.ctx) === true && s.phase === "over" && s.why === "time", "time's up");
  assert(s.fin![0].right === 1 && s.fin![0].wrong === 1 && s.fin![0].flagPts === 0, "+2 -2");
  assert(t.result!.winners.length === 1 && t.result!.winners[0] === b, "b wins 1-0");
  assert(ends() === 1, "once");
  const v = view(s, a, t);
  assert(v.flags.includes(wrong) && v.flags.includes(right), "final view keeps my flags for ✓/✗");
}

// ---------- ties, nobody above zero, solo ----------

{
  const { t, s } = start(2, 3);
  toPlay(t, s);
  t.advance(PLAY_MS);
  game.tick!(s, t.ctx);
  assert(t.result!.winners.length === 0 && /nobody/i.test(t.result!.headline), "0-0: nobody wins");
}
{
  const { t, s } = start(2, 3);
  toPlay(t, s);
  const cells = safeHidden(s).filter((i) => s.num[i] > 0 && !s.item[i]);
  game.action(s, t.ids[0], { type: "open", cell: cells[0] }, t.ctx);
  game.action(s, t.ids[1], { type: "open", cell: cells[1] }, t.ctx);
  t.advance(PLAY_MS);
  game.tick!(s, t.ctx);
  assert(t.result!.winners.length === 2 && /tie/.test(t.result!.headline), "1-1 tie");
}
{
  const { t, s, ends } = start(1, 11);
  toPlay(t, s);
  const cell = findSafe(s, (i) => s.num[i] > 0)!;
  game.action(s, t.ids[0], { type: "open", cell }, t.ctx);
  t.advance(PLAY_MS);
  game.tick!(s, t.ctx);
  assert(t.result!.winners[0] === t.ids[0] && /Player0/.test(t.result!.headline), "solo headline");
  assert(ends() === 1, "solo ends once");
}

// ---------- hostile input ----------

{
  const { t, s } = start(3);
  toPlay(t, s);
  const before = JSON.stringify(s);
  t.events.length = 0;
  const big = "a".repeat(5000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const junk: any[] = [
    null, undefined, 42, "open", big, [], [1, 2], {}, { type: "x" }, { type: null }, { type: "__proto__" },
    { type: "constructor" }, { type: "open" }, { type: "open", cell: "4" }, { type: "open", cell: 1.5 },
    { type: "open", cell: NaN }, { type: "open", cell: -1 }, { type: "open", cell: 1e9 }, { type: "open", cell: Infinity },
    { type: "open", cell: [3] }, { type: "chord", cell: { $gt: 1 } }, { type: "flag", cell: 0 },
    { type: "flag", cell: 0, on: "yes", q: 1 }, { type: "flag", cell: 0, on: true, q: -1 },
    { type: "flag", cell: 0, on: true, q: 1.5 }, { type: "flag", cell: 0, on: true, q: 1e12 },
    { type: "flag", cell: 0, on: true, q: "1" }, { type: "guess", text: big }, { type: big, cell: 1 },
    { type: "place", cell: "4" }, { type: "stroke", pts: new Array(5000).fill(1) },
  ];
  for (const a of junk) assert(game.action(s, t.ids[0], a, t.ctx) === false, `rejects ${String(JSON.stringify(a)).slice(0, 40)}`);
  assert(game.action(s, "stranger", { type: "open", cell: findSafe(s)! }, t.ctx) === false, "non-players can't dig");
  assert(game.spectatorAction!(s, "spectator", { type: "open", cell: 0 }, t.ctx) === false, "spectators can't dig");
  assert(JSON.stringify(s) === before, "no state change from junk");
  assert(t.events.length === 0, "junk gets no replies");
}

// ---------- secrecy ----------

{
  const { t, s } = start(4, 21);
  toPlay(t, s);
  const [a, b] = t.ids;
  // Some play: a few reveals, a boom, flags.
  for (const cell of safeHidden(s).slice(0, 12)) game.action(s, a, { type: "open", cell }, t.ctx);
  const mine = hidden(s).find((i) => s.mine[i])!;
  game.action(s, b, { type: "open", cell: mine }, t.ctx);
  game.action(s, a, { type: "flag", cell: hidden(s).find((i) => s.mine[i])!, on: true, q: 1 }, t.ctx);
  for (const id of [...t.ids, "spectator"]) {
    const v = view(s, id, t);
    const json = JSON.stringify(v);
    assert(!/"(mine|num|item|flagMask|openings)"/.test(json), "no secret fields");
    for (let i = 0; i < s.w * s.h; i++) {
      if (s.open[i] === 0) assert(v.cells[i] === ".", "hidden cells are blank");
    }
    const hiddenItems = s.item.map((k, i) => (k && s.open[i] === 0 ? i : -1)).filter((i) => i >= 0);
    assert(v.items.every(([c]) => !hiddenItems.includes(c)), "hidden pickups stay hidden");
    if (id !== a) assert(v.flags.length === 0, "someone else's flags stay private");
  }
  // Public events never mention hidden mines.
  for (const e of t.events) {
    const ev = e.event as OpEvent;
    if (ev.t !== "op") continue;
    for (const c of ev.o) assert(!s.mine[c], "opened cells are safe");
    if (!e.to) assert(ev.sm === undefined, "scan data only to the scanner");
  }
}

// ---------- sync replies ----------

{
  const { t, s } = start(2);
  toPlay(t, s);
  t.events.length = 0;
  assert(game.action(s, t.ids[1], { type: "sync" }, t.ctx) === false, "sync doesn't broadcast");
  const full = t.events[0];
  assert(full.to === t.ids[1] && (full.event as FullEvent).t === "full" && (full.event as FullEvent).v.you === 1, "full view to them");
  game.action(s, t.ids[1], { type: "sync" }, t.ctx);
  assert(t.events.length === 1, "rate limited");
  game.spectatorAction!(s, "spectator", { type: "sync" }, t.ctx);
  const spec = t.events[1];
  assert(spec.to === "spectator" && (spec.event as FullEvent).v.you === -1 && (spec.event as FullEvent).v.flags.length === 0, "spectator sync");
}

// ---------- disconnects never stall ----------

{
  // During the countdown: the game still starts.
  const { t, s } = start(2);
  t.ctx.players[1].connected = false;
  game.playerLeft!(s, t.ids[1], t.ctx);
  assert(s.aloneSince === null, "someone is still here");
  toPlay(t, s);
  game.action(s, t.ids[0], { type: "open", cell: findSafe(s)! }, t.ctx);
  t.ctx.players[1].connected = true;
  game.playerReturned!(s, t.ids[1], t.ctx);
  game.action(s, t.ids[1], { type: "open", cell: findSafe(s)! }, t.ctx);
  assert(s.stats[1].opened >= 1, "back and digging");
}
{
  // Everyone gone: the game ends after a grace period; coming back in time cancels it.
  const { t, s, ends } = start(2);
  toPlay(t, s);
  for (const p of t.ctx.players) {
    p.connected = false;
    game.playerLeft!(s, p.id, t.ctx);
  }
  assert(s.aloneSince !== null && view(s, "spectator", t).abandonAt === s.aloneSince + ABANDON_MS, "countdown to abandon");
  t.advance(ABANDON_MS - 1000);
  game.tick!(s, t.ctx);
  t.ctx.players[0].connected = true;
  game.playerReturned!(s, t.ids[0], t.ctx);
  assert(s.aloneSince === null, "cancelled");
  t.advance(5000);
  assert(game.tick!(s, t.ctx) === false && s.phase === "play", "still playing");
  t.ctx.players[0].connected = false;
  game.playerLeft!(s, t.ids[0], t.ctx);
  t.advance(ABANDON_MS);
  assert(game.tick!(s, t.ctx) === true && phaseOf(s) === "over" && s.why === "abandoned", "abandoned");
  assert(ends() === 1 && t.result!.winners.length === 0, "ended once, no winner");
  game.playerReturned!(s, t.ids[0], t.ctx);
  assert(phaseOf(s) === "over" && s.aloneSince === null, "returning after the end changes nothing");
}

// ---------- client store: views + deltas, optimistic flags and digs ----------

{
  const { t, s } = start(2, 31);
  toPlay(t, s);
  const [a, b] = t.ids;
  const st = new MineStore();
  st.applyView(view(s, a, t));
  assert(st.s === 0 && st.me === 0 && st.w === s.w, "store adopts the first view");
  for (let i = 0; i < s.w * s.h; i++) assert((st.cells[i] === HIDDEN) === (s.open[i] === 0), "same open cells");

  // Our dig shows as pending at once, and clears when the op comes back.
  const cell = findSafe(s, (i) => s.num[i] > 0)!;
  st.dig([cell], cell, 0);
  assert(st.pending.has(cell), "pending immediately");
  const v0 = view(s, a, t); // a view from before the op (arrives late)
  t.events.length = 0;
  game.action(s, a, { type: "open", cell }, t.ctx);
  assert(st.applyOp(lastOp(t), 10) === "ok" && st.cells[cell] === s.num[cell] && !st.pending.has(cell), "op applied");
  assert(st.ps[0].score === 1 && st.own[cell] === 0 && st.anim[cell] > 0, "score, owner, reveal animation");
  st.applyView(v0);
  const seqOf = (x: MineStore): number => x.s;
  assert(st.cells[cell] === s.num[cell] && seqOf(st) === 1, "an older view never rolls the board back");
  assert(st.applyOp(lastOp(t), 20) === "stale", "duplicate op ignored");

  // A skipped op is detected (ask for a sync), and a full view catches up.
  const c2 = findSafe(s, (i) => s.num[i] > 0)!;
  game.action(s, b, { type: "open", cell: c2 }, t.ctx);
  const missed = lastOp(t);
  const c3 = findSafe(s, (i) => s.num[i] > 0)!;
  game.action(s, b, { type: "open", cell: c3 }, t.ctx);
  assert(st.applyOp(lastOp(t), 30) === "gap", "gap detected");
  assert(st.cells[c2] === HIDDEN && st.cells[c3] !== HIDDEN, "missed op not there yet");
  st.applyView(view(s, a, t));
  assert(st.cells[c2] !== HIDDEN && seqOf(st) === missed.s + 1, "full view fills the hole");

  // Optimistic flags survive a stale view, and the server's view takes over once it has caught up.
  const f1 = hidden(s).find((i) => s.mine[i])!;
  const q1 = st.flag(f1, true);
  assert(st.flags[f1] === 1, "flag shows instantly");
  st.applyView(view(s, a, t)); // server hasn't seen op q1 yet
  assert(st.flags[f1] === 1, "pending flag kept over an older view");
  game.action(s, a, { type: "flag", cell: f1, on: true, q: q1 }, t.ctx);
  st.applyView(view(s, a, t));
  assert(st.flags[f1] === 1 && st.flagCount() === 1, "confirmed");
  // Refused flag ops are undone.
  const opened = s.open.findIndex((o) => o === 1);
  const f2 = hidden(s).find((i) => i !== f1)!;
  const q2 = st.flag(f2, true);
  t.events.length = 0;
  game.action(s, a, { type: "flag", cell: opened, on: true, q: q2 }, t.ctx); // server refuses (cell is open)
  st.nack(t.events[0].event as NoEvent);
  assert(st.flags[f2] === 0, "refused flag rolled back");
  // A refused dig clears its pending cells.
  st.dig([f2], f2, 0);
  st.nack({ t: "no", c: f2 });
  assert(!st.pending.has(f2), "refused dig cleared");
  st.dig([f2], f2, 0);
  st.prune(5_000);
  assert(!st.pending.has(f2), "unanswered dig times out");

  // Someone else opening my flagged cell removes the flag; a boom shows and stuns.
  const mine = hidden(s).find((i) => s.mine[i] && i !== f1)!;
  game.action(s, b, { type: "open", cell: mine }, t.ctx);
  st.applyOp(lastOp(t), 40);
  assert(st.cells[mine] === BOOM && st.ps[1].stun > t.ctx.now() && st.fx.some((f) => f.kind === "boom"), "boom");

  // Scan copies carry private mines; the final view shows the rest of the mines.
  t.advance(STUN_MS);
  const sc = s.item.indexOf("s");
  t.events.length = 0;
  game.action(s, a, { type: "open", cell: sc }, t.ctx);
  const mineCopy = t.events.find((e) => e.to === a)!.event as OpEvent;
  st.applyOp(mineCopy, 50);
  for (const m of mineCopy.sm!) assert(st.flags[m] === 1, "scan flags arrive with the op");
  t.advance(PLAY_MS);
  game.tick!(s, t.ctx);
  st.applyView(view(s, a, t));
  assert(st.cells.some((c) => c === MINE), "remaining mines revealed at the end");
}

// ---------- 8 players: bits, traffic budget ----------

{
  const { t, s } = start(8, 8);
  toPlay(t, s);
  const v = view(s, t.ids[7], t);
  assert(v.you === 7 && v.ids.length === 8, "8 seats");
  game.action(s, t.ids[7], { type: "flag", cell: hidden(s)[0], on: true, q: 1 }, t.ctx);
  assert(s.flagMask[hidden(s)[0]] === 1 << 7, "8th player's flag bit");
  // Busy game: each player digs 3 cells a second for 10 seconds. Every op goes to every client.
  t.events.length = 0;
  let bytes = 0;
  for (let sec = 0; sec < 10; sec++) {
    for (let k = 0; k < 3; k++) {
      for (let p = 0; p < 8; p++) {
        const left = safeHidden(s).filter((i) => !s.flagMask[i]);
        if (!left.length) break;
        game.action(s, t.ids[p], { type: "open", cell: left[Math.floor(left.length / 2)] }, t.ctx);
      }
    }
    t.advance(1000);
  }
  for (const e of t.events) bytes += JSON.stringify({ t: "ev", e: e.event, now: 1_700_000_000_000 }).length;
  const kbps = bytes / 10 / 1024;
  assert(kbps < 8, `busy 8-player game stays under 8 KB/s per client (${kbps.toFixed(2)})`);
  const full = JSON.stringify({ t: "game", view: view(s, t.ids[0], t), now: 1 }).length;
  assert(full < 4096, `full view under 4 KB (${full} B)`);
  console.log(`  traffic: busy 8p ≈ ${kbps.toFixed(2)} KB/s per client, full view ${full} B`);
}

console.log("✓ minerush tests passed");
