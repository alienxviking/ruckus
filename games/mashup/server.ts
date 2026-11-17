import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import { BG, MAX_BATCH, MAX_STROKE_ID, PALETTE, SIZES, type WireStroke } from "../sketch/shared";
import { AUTO_A, AUTO_B } from "./data";
import {
  DRAW_MS,
  GUIDE,
  H,
  INK_POINTS,
  MAX_NAME,
  MAX_STROKES,
  NAMES_PER_PLAYER,
  NAME_MS,
  NAME_PTS,
  RESULTS_MS,
  ROUNDS,
  SKIP_GUARD_MS,
  SLIVER_POINTS,
  STAR_PTS,
  VOTE_MS,
  W,
  cleanText,
  revealMs,
} from "./shared";

// Monster Mashup: exquisite corpse with monsters.
//
// Every round there are as many monsters as players. Monster m's head is drawn
// by order[m], its body by order[m+1] and its legs by order[m+2], so in each of
// the three drawing stages EVERYONE draws at once (a different monster each
// time) and nobody waits. You only ever see the bottom strip of the part above
// yours. Then everyone names two monsters they didn't draw, the monsters are
// revealed one by one, and everyone votes for a favourite monster and name.
//
// Phases per round: draw x3 -> name -> reveal -> vote -> results. Then final.
// Strokes arrive as actions that return false (nobody watches you draw), and
// finished monsters travel as events, once per client, never inside views.

/** How long the game waits with fewer than 2 players connected before ending early. */
export const SOLO_GRACE_MS = 12_000;
/** Strokes one part may ever start (undo doesn't give these back): a flood guard. */
export const MAX_MADE = 1_500;
/** Points the server accepts per part, counting ones later undone: a flood guard. */
export const MAX_POINTS_IN = 20_000;
const MINE_GAP_MS = 1_000;
const ASK_GAP_MS = 300;
const MAX_ASK = 24;

const COLORS: readonly string[] = [...PALETTE.map((p) => p.hex), BG];
const SIZE_SET: readonly number[] = SIZES;
const ID_RE = /^[A-Za-z0-9_-]+$/;

export type Phase = "draw" | "name" | "reveal" | "vote" | "results" | "final";

interface Stroke {
  id: string;
  color: string;
  size: number;
  pts: number[];
  end: boolean;
}

interface Part {
  by: string;
  strokes: Stroke[];
  /** Points on the part now (the ink used). */
  points: number;
  /** Strokes ever started and points ever received (flood guards). */
  made: number;
  pointsIn: number;
  /** Every stroke id seen on this part, so undone strokes can't be appended to. */
  ids: Record<string, true>;
  blank: boolean;
}

interface NameEntry {
  /** Author, or null for a name the game made up. */
  by: string | null;
  text: string;
  votes: number;
}

interface Monster {
  parts: Part[];
  /** Players asked to name this monster, and their drafts. */
  namers: string[];
  drafts: Record<string, string>;
  names: NameEntry[];
  stars: number;
  /** slivers[k]: the bottom strip of part k, shifted so y=0 is the strip's top edge. */
  slivers: DrawStroke[][];
}

/** A finished stroke as the reveal needs it. */
export interface DrawStroke {
  color: string;
  size: number;
  pts: number[];
}

export interface DrawHold {
  /** Monster you're drawing a part of, and which part (0 head, 1 body, 2 legs). */
  m: number;
  part: number;
  /** The bottom strip of the part above (null for heads). */
  guide: DrawStroke[] | null;
  guideBy: string | null;
  guideBlank: boolean;
  /** Strokes the server has on your part (for recovery after a refresh). */
  ink: number;
}

export interface NameTask {
  m: number;
  draft: string;
  blank: boolean[];
}

export interface VoteName {
  text: string;
  /** You wrote it (only ever true in your own view). */
  mine: boolean;
  auto: boolean;
}

export interface MonsterMeta {
  creators: string[];
  blank: boolean[];
  names: VoteName[];
}

export interface RevealView {
  at: number;
  landedAt: number;
  monster: MonsterMeta;
}

export interface MyVote {
  m: number;
  mi: number;
  ni: number;
}

export interface VoteView {
  monsters: MonsterMeta[];
  /** Monsters you may ⭐ (empty for spectators). */
  eligible: number[];
  mine: MyVote;
}

export interface ResultName {
  by: string | null;
  text: string;
  votes: number;
}

export interface ResultMonster {
  creators: string[];
  blank: boolean[];
  stars: number;
  names: ResultName[];
  /** Index of the winning name. */
  best: number;
}

export interface RoundResult {
  round: number;
  monsters: ResultMonster[];
  /** Monsters with the most stars (empty when nobody voted). */
  top: number[];
  gains: Record<string, number>;
}

export interface HallEntry {
  round: number;
  m: number;
  name: string;
  creators: string[];
  blank: boolean[];
  stars: number;
}

export interface Award {
  ids: string[];
  n: number;
}

export interface FinalView {
  scores: Record<string, number>;
  hall: HallEntry[];
  /** Most ⭐ on monsters you drew, and most 🏷️ votes on your names. */
  artist: Award | null;
  namer: Award | null;
  /** Every round's results, for the gallery. */
  rounds: RoundResult[];
}

export interface MashupView {
  phase: Phase;
  round: number;
  rounds: number;
  stage: number;
  endsAt: number;
  phaseMs: number;
  players: string[];
  done: string[];
  count: number;
  scores: Record<string, number>;
  soloEndsAt: number | null;
  endedEarly: boolean;
  draw: DrawHold | null;
  name: NameTask[] | null;
  reveal: RevealView | null;
  vote: VoteView | null;
  results: RoundResult | null;
  final: FinalView | null;
}

export interface MashupState {
  /** Rounds and per-part drawing time for this game (host settings). */
  rounds: number;
  drawMs: number;
  players: string[];
  /** This round's seating: monster m's head is by order[m], body by order[m+1], legs by order[m+2]. */
  order: string[];
  phase: Phase;
  round: number;
  stage: number;
  endsAt: number;
  phaseMs: number;
  done: string[];
  monsters: Monster[];
  /** Earlier rounds' monsters (for the gallery and late requests). */
  past: Monster[][];
  /** Reveal position. */
  rv: number;
  landedAt: number;
  votes: Record<string, MyVote>;
  scores: Record<string, number>;
  results: RoundResult[];
  soloSince: number | null;
  endedEarly: boolean;
  lastMine: Record<string, number>;
  lastAsk: Record<string, number>;
  final: FinalView | null;
}

export type MashupAction =
  | ({ type: "stroke" } & WireStroke)
  | { type: "undo" }
  | { type: "clear" }
  | { type: "mine" }
  | { type: "done" }
  | { type: "edit" }
  | { type: "name"; m: number; text: string }
  | { type: "star"; m: number }
  | { type: "pick"; m: number; i: number }
  | { type: "next" }
  | { type: "monsters"; r: number; list: number[] };

export type MashupEvent =
  | { k: "mine"; round: number; stage: number; strokes: WireStroke[] }
  | { k: "monsters"; r: number; list: { m: number; parts: DrawStroke[][] }[] };

// ---------- helpers ----------

/** A prototype-free record: ids come from clients ("__proto__" is a valid id). */
const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

const isOn = (ctx: GameCtx, id: string) => {
  const p = ctx.player(id);
  return !!p && p.connected !== false;
};

const nameOf = (ctx: GameCtx, id: string) => ctx.player(id)?.name ?? "Someone";

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

function newPart(by: string): Part {
  return { by, strokes: [], points: 0, made: 0, pointsIn: 0, ids: dict(), blank: true };
}

const toDraw = (st: Stroke): DrawStroke => ({ color: st.color, size: st.size, pts: st.pts });

const creatorsOf = (mo: Monster) => mo.parts.map((p) => p.by);

/** The bottom GUIDE px of a part, shifted up so the strip starts at y=0. */
export function sliverOf(part: Part): DrawStroke[] {
  const top = H - GUIDE;
  const out: DrawStroke[] = [];
  let budget = SLIVER_POINTS;
  for (const st of part.strokes) {
    const p = st.pts;
    const n = p.length >> 1;
    const r = st.size / 2;
    const inside = (j: number) => j >= 0 && j < n && p[2 * j + 1] + r >= top;
    let run: number[] = [];
    const flush = () => {
      if (run.length) out.push({ color: st.color, size: st.size, pts: run });
      run = [];
    };
    for (let j = 0; j < n && budget > 0; j++) {
      // Keep the neighbours of points in the strip so lines enter it at the right angle.
      if (inside(j) || inside(j - 1) || inside(j + 1)) {
        run.push(p[2 * j], p[2 * j + 1] - top);
        budget -= 1;
      } else flush();
    }
    flush();
    if (budget <= 0) break;
  }
  return out;
}

/** Monsters this player helped draw. */
function drewIn(s: MashupState, id: string): Set<number> {
  const set = new Set<number>();
  s.monsters.forEach((mo, m) => {
    if (mo.parts.some((p) => p.by === id)) set.add(m);
  });
  return set;
}

/** Monsters a player may ⭐: ones they didn't draw, or every monster when that leaves fewer than 2. */
export function eligibleFor(s: MashupState, id: string): number[] {
  const drew = drewIn(s, id);
  const free = s.monsters.map((_, m) => m).filter((m) => !drew.has(m));
  return free.length >= 2 ? free : s.monsters.map((_, m) => m);
}

function votableNames(s: MashupState, id: string): number {
  let n = 0;
  for (const mo of s.monsters) for (const nm of mo.names) if (nm.by && nm.by !== id) n++;
  return n;
}

function voteComplete(s: MashupState, id: string): boolean {
  const v = s.votes[id];
  const needM = eligibleFor(s, id).length > 0;
  const needN = votableNames(s, id) > 0;
  return (!needM || (!!v && v.m >= 0)) && (!needN || (!!v && v.mi >= 0));
}

function allDone(s: MashupState, ctx: GameCtx): boolean {
  const live = s.players.filter((id) => isOn(ctx, id));
  return live.length > 0 && live.every((id) => s.done.includes(id));
}

function updateSolo(s: MashupState, ctx: GameCtx): boolean {
  const lonely = s.phase !== "final" && s.players.filter((id) => isOn(ctx, id)).length < 2;
  if (lonely && s.soloSince === null) {
    s.soloSince = ctx.now();
    return true;
  }
  if (!lonely && s.soloSince !== null) {
    s.soloSince = null;
    return true;
  }
  return false;
}

function setPhase(s: MashupState, ctx: GameCtx, phase: Phase, ms: number) {
  s.phase = phase;
  s.phaseMs = ms;
  s.endsAt = ctx.now() + ms;
  s.done = [];
}

function packMonster(mo: Monster): DrawStroke[][] {
  return mo.parts.map((p) => p.strokes.map(toDraw));
}

function metaOf(mo: Monster, viewer: string): MonsterMeta {
  return {
    creators: creatorsOf(mo),
    blank: mo.parts.map((p) => p.blank),
    names: mo.names.map((n) => ({ text: n.text, mine: n.by === viewer, auto: n.by === null })),
  };
}

// ---------- flow ----------

function startRound(s: MashupState, ctx: GameCtx, round: number) {
  if (s.monsters.length) s.past.push(s.monsters);
  s.round = round;
  const order = shuffle(s.players, ctx.random);
  const n = order.length;
  s.order = order;
  s.monsters = order.map((_, m) => ({
    parts: [0, 1, 2].map((k) => newPart(order[(m + k) % n])),
    namers: [],
    drafts: dict(),
    names: [],
    stars: 0,
    slivers: [],
  }));
  s.votes = dict();
  startDraw(s, ctx, 0);
}

function startDraw(s: MashupState, ctx: GameCtx, stage: number) {
  s.stage = stage;
  setPhase(s, ctx, "draw", s.drawMs);
}

/** Whatever was drawn so far becomes the part, even if it's blank. */
function finalizeStage(s: MashupState) {
  for (const mo of s.monsters) {
    const part = mo.parts[s.stage];
    part.strokes = part.strokes.filter((st) => st.pts.length > 0);
    for (const st of part.strokes) st.end = true;
    part.blank = part.strokes.length === 0;
    part.ids = dict();
    mo.slivers[s.stage] = sliverOf(part);
  }
}

function endDraw(s: MashupState, ctx: GameCtx) {
  finalizeStage(s);
  if (s.stage < 2) startDraw(s, ctx, s.stage + 1);
  else startName(s, ctx);
}

/**
 * Each player names up to NAMES_PER_PLAYER monsters. order[i] drew monsters
 * i, i-1 and i-2, so naming i+1, i+2, ... avoids your own monsters, and every
 * offset is a bijection, so each monster gets the same number of namers. Only
 * tiny groups (3-4) fall back to monsters you drew a part of.
 */
function assignNamers(s: MashupState) {
  const n = s.order.length;
  const offsets: number[] = [];
  for (let d = 1; d <= n - 3; d++) offsets.push(d);
  offsets.push(0, -1, -2);
  const k = Math.min(NAMES_PER_PLAYER, n);
  s.order.forEach((id, i) => {
    for (const d of offsets.slice(0, k)) {
      const m = (((i + d) % n) + n) % n;
      if (!s.monsters[m].namers.includes(id)) s.monsters[m].namers.push(id);
    }
  });
}

function tasksFor(s: MashupState, id: string): number[] {
  const out: number[] = [];
  s.monsters.forEach((mo, m) => {
    if (mo.namers.includes(id)) out.push(m);
  });
  return out;
}

function sendMonsters(s: MashupState, ctx: GameCtx, r: number, list: number[], to?: string) {
  const src = r === s.round ? s.monsters : s.past[r];
  if (!src || !list.length) return;
  const ev: MashupEvent = { k: "monsters", r, list: list.map((m) => ({ m, parts: packMonster(src[m]) })) };
  ctx.emit(ev, to ? { to } : undefined);
}

function startName(s: MashupState, ctx: GameCtx) {
  assignNamers(s);
  setPhase(s, ctx, "name", NAME_MS);
  // Namers need to see the monsters they're naming: the only monsters anyone sees early.
  for (const id of s.players) sendMonsters(s, ctx, s.round, tasksFor(s, id), id);
}

function autoName(ctx: GameCtx, taken: Set<string>): string {
  for (let i = 0; i < 6; i++) {
    const a = AUTO_A[Math.floor(ctx.random() * AUTO_A.length)];
    const b = AUTO_B[Math.floor(ctx.random() * AUTO_B.length)];
    const t = `${a} ${b}`;
    if (!taken.has(t)) return t;
  }
  return `${AUTO_A[0]} ${AUTO_B[Math.floor(ctx.random() * AUTO_B.length)]}`;
}

function endName(s: MashupState, ctx: GameCtx) {
  const taken = new Set<string>();
  for (const mo of s.monsters) {
    const names: NameEntry[] = [];
    for (const id of mo.namers) {
      const text = cleanText(mo.drafts[id] ?? "", MAX_NAME);
      if (text && !names.some((n) => n.text.toLowerCase() === text.toLowerCase())) names.push({ by: id, text, votes: 0 });
    }
    if (!names.length) {
      // Nobody named it: the game christens it (not votable).
      names.push({ by: null, text: autoName(ctx, taken), votes: 0 });
    }
    for (const n of names) taken.add(n.text);
    mo.names = shuffle(names, ctx.random);
    mo.drafts = dict();
  }
  startReveal(s, ctx);
}

function land(s: MashupState, ctx: GameCtx) {
  s.landedAt = ctx.now();
  setPhase(s, ctx, "reveal", revealMs(s.monsters.length));
  sendMonsters(s, ctx, s.round, [s.rv]);
}

function startReveal(s: MashupState, ctx: GameCtx) {
  s.rv = 0;
  land(s, ctx);
}

function advanceReveal(s: MashupState, ctx: GameCtx) {
  s.rv += 1;
  if (s.rv >= s.monsters.length) startVote(s, ctx);
  else land(s, ctx);
}

function startVote(s: MashupState, ctx: GameCtx) {
  s.votes = dict();
  setPhase(s, ctx, "vote", VOTE_MS);
  // Anyone who could not vote at all counts as done right away.
  s.done = s.players.filter((id) => voteComplete(s, id));
}

function tally(s: MashupState): RoundResult {
  const gains = dict<number>();
  for (const id of s.players) gains[id] = 0;
  for (const voter of s.players) {
    const v = s.votes[voter];
    if (!v) continue;
    const mo = s.monsters[v.m];
    if (mo) {
      mo.stars += 1;
      for (const c of new Set(creatorsOf(mo))) if (c !== voter) gains[c] = (gains[c] ?? 0) + STAR_PTS;
    }
    const nm = s.monsters[v.mi]?.names[v.ni];
    if (nm) {
      nm.votes += 1;
      if (nm.by && nm.by !== voter) gains[nm.by] = (gains[nm.by] ?? 0) + NAME_PTS;
    }
  }
  for (const id of Object.keys(gains)) s.scores[id] = (s.scores[id] ?? 0) + gains[id];
  const most = Math.max(0, ...s.monsters.map((mo) => mo.stars));
  const monsters: ResultMonster[] = s.monsters.map((mo) => {
    let best = 0;
    mo.names.forEach((n, i) => {
      if (n.votes > mo.names[best].votes) best = i;
    });
    return {
      creators: creatorsOf(mo),
      blank: mo.parts.map((p) => p.blank),
      stars: mo.stars,
      names: mo.names.map((n) => ({ by: n.by, text: n.text, votes: n.votes })),
      best,
    };
  });
  return {
    round: s.round,
    monsters,
    top: most > 0 ? s.monsters.map((_, m) => m).filter((m) => s.monsters[m].stars === most) : [],
    gains,
  };
}

function endVote(s: MashupState, ctx: GameCtx) {
  s.results.push(tally(s));
  setPhase(s, ctx, "results", RESULTS_MS);
}

function endResults(s: MashupState, ctx: GameCtx) {
  if (s.round + 1 < s.rounds) startRound(s, ctx, s.round + 1);
  else finish(s, ctx);
}

function award(counts: Record<string, number>, players: string[]): Award | null {
  const n = Math.max(0, ...players.map((id) => counts[id] ?? 0));
  const ids = players.filter((id) => counts[id] === n);
  // An award everyone shares isn't an award.
  return n > 0 && (ids.length < players.length || players.length === 1) ? { n, ids } : null;
}

function headline(ctx: GameCtx, winners: string[], pts: number, early: boolean): string {
  const tail = early ? " (ended early)" : "";
  if (!winners.length) return `Monster Mashup is over: the monsters left without a single vote${tail}`;
  const names = winners.map((id) => nameOf(ctx, id));
  if (names.length === 1) return `${names[0]} is the mad scientist of the night with ${pts} points${tail}`;
  const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} share the lab with ${pts} points each${tail}`;
}

function finish(s: MashupState, ctx: GameCtx) {
  if (s.phase === "final") return;
  s.phase = "final";
  s.endsAt = 0;
  s.phaseMs = 0;
  s.done = [];
  s.soloSince = null;
  const scores = dict<number>();
  for (const id of s.players) scores[id] = s.scores[id] ?? 0;
  const starCount = dict<number>();
  const nameCount = dict<number>();
  const hall: HallEntry[] = [];
  for (const r of s.results) {
    r.monsters.forEach((mo) => {
      for (const c of new Set(mo.creators)) starCount[c] = (starCount[c] ?? 0) + mo.stars;
      for (const n of mo.names) if (n.by) nameCount[n.by] = (nameCount[n.by] ?? 0) + n.votes;
    });
    if (r.top.length) {
      // Ties go to the monster whose winning name got the most votes.
      let m = r.top[0];
      for (const t of r.top) {
        const a = r.monsters[t];
        const b = r.monsters[m];
        if ((a.names[a.best]?.votes ?? 0) > (b.names[b.best]?.votes ?? 0)) m = t;
      }
      const mo = r.monsters[m];
      hall.push({ round: r.round, m, name: mo.names[mo.best]?.text ?? "", creators: mo.creators, blank: mo.blank, stars: mo.stars });
    }
  }
  s.final = { scores, hall, artist: award(starCount, s.players), namer: award(nameCount, s.players), rounds: s.results };
  const winners = topScorers(scores);
  ctx.end({ winners, headline: headline(ctx, winners, winners.length ? scores[winners[0]] : 0, s.endedEarly), scores });
}

/** Move on from the current phase (deadline passed or everyone is done). */
function advance(s: MashupState, ctx: GameCtx) {
  switch (s.phase) {
    case "draw":
      return endDraw(s, ctx);
    case "name":
      return endName(s, ctx);
    case "reveal":
      return advanceReveal(s, ctx);
    case "vote":
      return endVote(s, ctx);
    case "results":
      return endResults(s, ctx);
  }
}

// ---------- actions ----------

function onStroke(part: Part, a: Record<string, unknown>): boolean {
  const { id, color, size, pts, end } = a;
  if (typeof id !== "string" || id.length < 1 || id.length > MAX_STROKE_ID || !ID_RE.test(id)) return false;
  if (typeof color !== "string" || !COLORS.includes(color)) return false;
  if (typeof size !== "number" || !SIZE_SET.includes(size)) return false;
  if (end !== undefined && typeof end !== "boolean") return false;
  if (!Array.isArray(pts) || pts.length > MAX_BATCH || pts.length % 2 !== 0) return false;
  for (let i = 0; i < pts.length; i++) {
    const v: unknown = pts[i];
    if (!isInt(v) || v < 0 || v > (i % 2 === 0 ? W : H)) return false;
  }
  const n = pts.length / 2;

  let st: Stroke | undefined;
  if (part.ids[id]) {
    for (let i = part.strokes.length - 1; i >= 0; i--) {
      if (part.strokes[i].id === id) {
        st = part.strokes[i];
        break;
      }
    }
    if (!st || st.end) return false;
    if (n === 0 && !end) return false;
  } else if (n === 0 || part.strokes.length >= MAX_STROKES || part.made >= MAX_MADE) {
    return false;
  }
  if (part.pointsIn + n > MAX_POINTS_IN) return false;
  part.pointsIn += n;

  // Out of ink: the overflow is ignored. A stroke started with no ink left is
  // still recorded (empty) so undo stays in step with the artist's canvas.
  const room = Math.max(0, INK_POINTS - part.points);
  const add = n <= room ? (pts as number[]) : (pts as number[]).slice(0, room * 2);
  if (!st) {
    part.strokes.push({ id, color, size, pts: add.slice(), end: end === true });
    part.ids[id] = true;
    part.made += 1;
  } else {
    for (const v of add) st.pts.push(v);
    if (end) st.end = true;
  }
  part.points += add.length / 2;
  return false; // nobody watches you draw
}

function myPart(s: MashupState, id: string): Part | undefined {
  for (const mo of s.monsters) if (mo.parts[s.stage]?.by === id) return mo.parts[s.stage];
  return undefined;
}

function onDraw(s: MashupState, id: string, a: Record<string, unknown>, ctx: GameCtx): boolean {
  const part = myPart(s, id);
  if (!part) return false;
  const now = ctx.now();
  const open = now < s.endsAt;
  const done = s.done.includes(id);
  switch (a.type) {
    case "stroke":
      return open && !done ? onStroke(part, a) : false;
    case "undo": {
      if (!open || done) return false;
      const st = part.strokes.pop();
      if (st) part.points -= st.pts.length / 2;
      return false;
    }
    case "clear":
      if (!open || done) return false;
      part.strokes = [];
      part.points = 0;
      return false;
    case "mine": {
      if (now - (s.lastMine[id] ?? -Infinity) < MINE_GAP_MS) return false;
      s.lastMine[id] = now;
      const strokes: WireStroke[] = part.strokes.map((st) => ({ id: st.id, color: st.color, size: st.size, pts: st.pts.slice(), end: true }));
      ctx.emit({ k: "mine", round: s.round, stage: s.stage, strokes } satisfies MashupEvent, { to: id });
      return false;
    }
    case "done":
      if (!open || done) return false;
      s.done.push(id);
      return true;
    case "edit":
      if (!open || !done) return false;
      s.done = s.done.filter((x) => x !== id);
      return true;
    default:
      return false;
  }
}

function onName(s: MashupState, id: string, a: Record<string, unknown>, ctx: GameCtx): boolean {
  const open = ctx.now() < s.endsAt;
  const done = s.done.includes(id);
  switch (a.type) {
    case "name": {
      if (!open || done || !isInt(a.m) || typeof a.text !== "string") return false;
      const mo = s.monsters[a.m];
      if (!mo || !mo.namers.includes(id)) return false;
      mo.drafts[id] = cleanText(a.text, MAX_NAME);
      return false; // a draft: nobody else needs to know
    }
    case "done":
      if (!open || done) return false;
      s.done.push(id);
      return true;
    case "edit":
      if (!open || !done) return false;
      s.done = s.done.filter((x) => x !== id);
      return true;
    default:
      return false;
  }
}

function onVote(s: MashupState, id: string, a: Record<string, unknown>, ctx: GameCtx): boolean {
  if (ctx.now() >= s.endsAt) return false;
  const v = s.votes[id] ?? { m: -1, mi: -1, ni: -1 };
  if (a.type === "star") {
    if (!isInt(a.m) || !eligibleFor(s, id).includes(a.m)) return false;
    if (v.m === a.m) return false;
    v.m = a.m;
  } else if (a.type === "pick") {
    if (!isInt(a.m) || !isInt(a.i)) return false;
    const nm = s.monsters[a.m]?.names[a.i];
    if (!nm || nm.by === id || nm.by === null) return false;
    if (v.mi === a.m && v.ni === a.i) return false;
    v.mi = a.m;
    v.ni = a.i;
  } else return false;
  s.votes[id] = v;
  const was = s.done.includes(id);
  const now = voteComplete(s, id);
  if (was === now) return false; // the voter already sees their pick; nothing public changed
  if (now) s.done.push(id);
  else s.done = s.done.filter((x) => x !== id);
  return true;
}

/** May this viewer see the finished drawings of monster m of round r? */
function canSee(s: MashupState, viewer: string, r: number, m: number): boolean {
  if (r < s.round) return !!s.past[r]?.[m];
  if (r !== s.round || !s.monsters[m]) return false;
  switch (s.phase) {
    case "name":
      return s.monsters[m].namers.includes(viewer);
    case "reveal":
      return m <= s.rv;
    case "vote":
    case "results":
    case "final":
      return true;
    default:
      return false;
  }
}

function onAsk(s: MashupState, viewer: string, a: Record<string, unknown>, ctx: GameCtx): boolean {
  const { r, list } = a;
  if (!isInt(r) || r < 0 || r > s.round || !Array.isArray(list) || !list.length || list.length > MAX_ASK) return false;
  const now = ctx.now();
  if (now - (s.lastAsk[viewer] ?? -Infinity) < ASK_GAP_MS) return false;
  const ok: number[] = [];
  for (const m of list) if (isInt(m) && !ok.includes(m) && canSee(s, viewer, r, m)) ok.push(m);
  if (!ok.length) return false;
  s.lastAsk[viewer] = now;
  sendMonsters(s, ctx, r, ok, viewer);
  return false;
}

// ---------- the game ----------

export const mashup: GameDef<MashupState, MashupAction> = {
  id: "mashup",

  setup(ctx) {
    const set = readSettings(config.settings, ctx.settings);
    const s: MashupState = {
      rounds: Number(set.rounds) || ROUNDS,
      drawMs: (Number(set.draw) || DRAW_MS / 1000) * 1000,
      players: ctx.players.map((p) => p.id),
      order: [],
      phase: "draw",
      round: 0,
      stage: 0,
      endsAt: 0,
      phaseMs: 0,
      done: [],
      monsters: [],
      past: [],
      rv: 0,
      landedAt: 0,
      votes: dict(),
      scores: dict(),
      results: [],
      soloSince: null,
      endedEarly: false,
      lastMine: dict(),
      lastAsk: dict(),
      final: null,
    };
    for (const id of s.players) s.scores[id] = 0;
    startRound(s, ctx, 0);
    updateSolo(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (!s.players.includes(playerId)) return false;
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as unknown as Record<string, unknown>;
    if (a.type === "monsters") return onAsk(s, playerId, a, ctx);
    switch (s.phase) {
      case "draw":
        return onDraw(s, playerId, a, ctx);
      case "name":
        return onName(s, playerId, a, ctx);
      case "vote":
        return onVote(s, playerId, a, ctx);
      case "reveal":
      case "results": {
        if (a.type !== "next" || s.done.includes(playerId)) return false;
        if (s.phase === "reveal" && ctx.now() - s.landedAt < SKIP_GUARD_MS) return false;
        s.done.push(playerId);
        return true;
      }
      default:
        return false;
    }
  },

  // Spectators may ask for monsters they're allowed to see (read-only).
  spectatorAction(s, viewerId, action, ctx) {
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as Record<string, unknown>;
    if (a.type !== "monsters") return false;
    return onAsk(s, viewerId, a, ctx);
  },

  tick(s, ctx) {
    if (s.phase === "final") return false;
    const changed = updateSolo(s, ctx);
    if (s.soloSince !== null && ctx.now() - s.soloSince >= SOLO_GRACE_MS) {
      s.endedEarly = true;
      if (s.phase === "draw") finalizeStage(s);
      finish(s, ctx);
      return true;
    }
    if (ctx.now() >= s.endsAt || allDone(s, ctx)) {
      advance(s, ctx);
      return true;
    }
    return changed;
  },
  tickMs: 250,

  playerLeft(s, playerId, ctx) {
    if (s.players.includes(playerId)) updateSolo(s, ctx);
  },

  playerReturned(s, playerId, ctx) {
    if (s.players.includes(playerId)) updateSolo(s, ctx);
  },

  view(s, viewerId): MashupView {
    const isP = s.players.includes(viewerId);
    const v: MashupView = {
      phase: s.phase,
      round: s.round,
      rounds: s.rounds,
      stage: s.stage,
      endsAt: s.endsAt,
      phaseMs: s.phaseMs,
      players: s.players,
      done: s.done,
      count: s.monsters.length,
      scores: s.scores,
      soloEndsAt: s.soloSince === null ? null : s.soloSince + SOLO_GRACE_MS,
      endedEarly: s.endedEarly,
      draw: null,
      name: null,
      reveal: null,
      vote: null,
      results: null,
      final: null,
    };
    if (s.phase === "draw" && isP) {
      const m = s.monsters.findIndex((mo) => mo.parts[s.stage]?.by === viewerId);
      if (m >= 0) {
        const mo = s.monsters[m];
        const above = s.stage > 0 ? mo.parts[s.stage - 1] : null;
        v.draw = {
          m,
          part: s.stage,
          guide: above ? (mo.slivers[s.stage - 1] ?? []) : null,
          guideBy: above ? above.by : null,
          guideBlank: !!above && above.blank,
          ink: mo.parts[s.stage].strokes.length,
        };
      }
    } else if (s.phase === "name" && isP) {
      v.name = tasksFor(s, viewerId).map((m) => ({
        m,
        draft: s.monsters[m].drafts[viewerId] ?? "",
        blank: s.monsters[m].parts.map((p) => p.blank),
      }));
    } else if (s.phase === "reveal") {
      v.reveal = { at: s.rv, landedAt: s.landedAt, monster: metaOf(s.monsters[s.rv], viewerId) };
    } else if (s.phase === "vote") {
      v.vote = {
        monsters: s.monsters.map((mo) => metaOf(mo, viewerId)),
        eligible: isP ? eligibleFor(s, viewerId) : [],
        mine: (isP && s.votes[viewerId]) || { m: -1, mi: -1, ni: -1 },
      };
    } else if (s.phase === "results") {
      v.results = s.results[s.results.length - 1] ?? null;
    } else if (s.phase === "final") {
      v.final = s.final;
    }
    return v;
  },
};

export default mashup;
