import type { GameCtx, GameDef } from "../../shared/game";
import { shuffle, topScorers } from "../../shared/game";
import { POLLS } from "./data";
import {
  ABANDON_MS,
  MAJORITY_MULT,
  PREDICT_MS,
  READ_PTS,
  REVEAL_MS,
  ROUNDS,
  VOTE_MS,
  WOLF_BONUS,
  WOLF_MIN_VOTERS,
  misplaced,
  predPoints,
  selfPoints,
  type PollKind,
} from "./shared";

// Poll Position: each round is a silly poll. VOTE in secret (15s), then PREDICT
// how the room split (20s), then the REVEAL shows the bars and scores.
//
// Scoring (normal rounds): 100 - 15 per voter you placed on the wrong answer,
// plus +50 "lone wolf" if you were the only one to pick your answer (4+ voters).
// Twists: one "Read the room" round (everyone guesses one spotlight player's vote;
// the spotlight guesses how many will read them right) and one "Majority rules"
// round (only voters on the most popular answer score, doubled).
// Per-player data lives in arrays indexed by seat.

export type PollPhase = "vote" | "predict" | "reveal" | "final";

export type PollAction =
  | { type: "vote"; o: number }
  | { type: "pred"; c: number[]; lock?: boolean }
  | { type: "read"; o: number }
  | { type: "self"; n: number; lock?: boolean }
  | { type: "ready" };

export interface PollRow {
  /** Their prediction (normal / majority rounds). */
  pred: number[] | null;
  /** Their read of the spotlight player's vote (room round). */
  read: number | null;
  /** Voters placed on the wrong answer (null = no prediction). */
  miss: number | null;
  /** Prediction points before twists and bonuses. */
  base: number;
  wolf: boolean;
  /** Majority rules: true when they voted with the majority (null in other rounds). */
  side: boolean | null;
  pts: number;
}

export interface PollSpot {
  id: string;
  vote: number;
  /** How many others read the spotlight's vote right, out of `readers`. */
  right: number;
  readers: number;
  guess: number | null;
  pts: number;
}

export interface PollReveal {
  counts: number[];
  /** Per seat (aligned with view.seats). */
  votes: (number | null)[];
  rows: PollRow[];
  /** Most-picked answers (empty when nobody voted). */
  top: number[];
  spot: PollSpot | null;
}

export interface PollRecap {
  q: string;
  opts: string[];
  counts: number[];
  kind: PollKind;
  /** Who scored the most this round. */
  best: { ids: string[]; pts: number } | null;
}

export interface PollAward {
  icon: string;
  title: string;
  ids: string[];
  note: string;
}

export interface PollState {
  startedAt: number;
  ids: string[];
  polls: number[];
  kinds: PollKind[];
  round: number;
  phase: PollPhase;
  endsAt: number;
  vote: (number | null)[];
  pred: (number[] | null)[];
  read: (number | null)[];
  self: number | null;
  locked: boolean[];
  ready: boolean[];
  /** Voters this round (fixed when predicting starts): predictions sum to this. */
  voters: number;
  /** Spotlight seat in a room round (-1 otherwise). */
  spot: number;
  score: number[];
  reveal: PollReveal | null;
  recap: PollRecap[];
  /** Per seat: total voters misplaced, rounds predicted, lone wolves, majority picks. */
  missSum: number[];
  predicted: number[];
  wolves: number[];
  herd: number[];
  awards: PollAward[];
  lowSince: number | null;
  abandoned: boolean;
}

export interface PollSeat {
  id: string;
  score: number;
  voted: boolean;
  locked: boolean;
  ready: boolean;
  away: boolean;
}

export interface PollMine {
  vote: number | null;
  pred: number[] | null;
  read: number | null;
  self: number | null;
  locked: boolean;
}

export interface PollView {
  game: number;
  phase: PollPhase;
  round: number;
  rounds: number;
  kind: PollKind;
  q: string;
  opts: string[];
  endsAt: number;
  phaseMs: number;
  voters: number;
  spot: string | null;
  seats: PollSeat[];
  mine: PollMine | null;
  reveal: PollReveal | null;
  recap: PollRecap[];
  awards: PollAward[];
  /** The game ends at this time unless players come back. */
  endingAt: number | null;
  abandoned: boolean;
}

const PHASE_MS: Record<PollPhase, number> = { vote: VOTE_MS, predict: PREDICT_MS, reveal: REVEAL_MS, final: 0 };

const isHere = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;

const optCount = (s: PollState) => (POLLS[s.polls[s.round]]?.length ?? 1) - 1;

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** A valid prediction: one integer per answer, summing to the number of voters. */
function validPred(c: unknown, n: number, total: number): c is number[] {
  if (!Array.isArray(c) || c.length !== n) return false;
  let sum = 0;
  for (const x of c) {
    if (!isInt(x, 0, total)) return false;
    sum += x;
  }
  return sum === total;
}

function startVote(s: PollState, ctx: GameCtx) {
  s.phase = "vote";
  s.endsAt = ctx.now() + VOTE_MS;
  s.vote = s.ids.map(() => null);
  s.pred = s.ids.map(() => null);
  s.read = s.ids.map(() => null);
  s.self = null;
  s.locked = s.ids.map(() => false);
  s.ready = s.ids.map(() => false);
  s.voters = 0;
  s.spot = -1;
  s.reveal = null;
}

function startPredict(s: PollState, ctx: GameCtx) {
  const voterSeats = s.ids.map((_, i) => i).filter((i) => s.vote[i] !== null);
  s.voters = voterSeats.length;
  if (s.voters === 0) return startReveal(s, ctx);
  if (s.kinds[s.round] === "room") {
    const here = voterSeats.filter((i) => isHere(ctx, s.ids[i]));
    const pool = here.length ? here : voterSeats;
    s.spot = pool[Math.floor(ctx.random() * pool.length)] ?? voterSeats[0];
  }
  s.phase = "predict";
  s.endsAt = ctx.now() + PREDICT_MS;
}

function startReveal(s: PollState, ctx: GameCtx) {
  const n = optCount(s);
  const kind = s.kinds[s.round];
  const counts = Array.from({ length: n }, () => 0);
  for (const v of s.vote) if (v !== null) counts[v]++;
  const max = Math.max(0, ...counts);
  const top = max > 0 ? counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0) : [];
  const rows: PollRow[] = [];
  let spot: PollSpot | null = null;
  const spotVote = s.spot >= 0 ? s.vote[s.spot] : null;

  for (let i = 0; i < s.ids.length; i++) {
    const v = s.vote[i];
    const row: PollRow = { pred: s.pred[i], read: s.read[i], miss: null, base: 0, wolf: false, side: null, pts: 0 };
    if (kind === "room") {
      if (i !== s.spot && spotVote !== null && row.read === spotVote) row.pts = READ_PTS;
      row.pred = null;
    } else {
      row.read = null;
      if (row.pred && s.voters > 0) {
        row.miss = misplaced(row.pred, counts);
        row.base = predPoints(row.miss);
        s.missSum[i] += row.miss;
        s.predicted[i]++;
      }
      if (kind === "majority") {
        row.side = v !== null && top.includes(v);
        row.pts = row.side ? row.base * MAJORITY_MULT : 0;
      } else {
        row.wolf = v !== null && s.voters >= WOLF_MIN_VOTERS && counts[v] === 1;
        row.pts = row.base + (row.wolf ? WOLF_BONUS : 0);
        if (row.wolf) s.wolves[i]++;
      }
    }
    if (v !== null && top.includes(v) && top.length < n) s.herd[i]++;
    rows.push(row);
  }

  if (kind === "room" && s.spot >= 0 && spotVote !== null) {
    const readers = s.ids.length - 1;
    const right = rows.filter((r, i) => i !== s.spot && r.pts > 0).length;
    const pts = s.self !== null ? selfPoints(Math.abs(s.self - right)) : 0;
    rows[s.spot].pts = pts;
    spot = { id: s.ids[s.spot], vote: spotVote, right, readers, guess: s.self, pts };
  }

  for (let i = 0; i < s.ids.length; i++) s.score[i] += rows[i].pts;
  s.reveal = { counts, votes: s.vote.slice(), rows, top, spot };

  const bestPts = Math.max(0, ...rows.map((r) => r.pts));
  const poll = POLLS[s.polls[s.round]];
  s.recap.push({
    q: poll[0],
    opts: poll.slice(1),
    counts,
    kind,
    best: bestPts > 0 ? { ids: s.ids.filter((_, i) => rows[i].pts === bestPts), pts: bestPts } : null,
  });
  s.phase = "reveal";
  s.endsAt = ctx.now() + REVEAL_MS;
}

function nextRound(s: PollState, ctx: GameCtx) {
  if (s.round + 1 >= s.polls.length) return finish(s, ctx, false);
  s.round++;
  startVote(s, ctx);
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function bestOf(s: PollState, val: (i: number) => number | null, min: number, high: boolean): string[] {
  let best: number | null = null;
  for (let i = 0; i < s.ids.length; i++) {
    const v = val(i);
    if (v === null || (high ? v < min : v > min)) continue;
    if (best === null || (high ? v > best : v < best)) best = v;
  }
  if (best === null) return [];
  return s.ids.filter((_, i) => val(i) === best);
}

function computeAwards(s: PollState): PollAward[] {
  const out: PollAward[] = [];
  const avg = (i: number) => (s.predicted[i] >= 2 ? s.missSum[i] / s.predicted[i] : null);
  const mind = bestOf(s, avg, Infinity, false);
  if (mind.length && mind.length < s.ids.length) {
    const a = avg(s.ids.indexOf(mind[0])) ?? 0;
    out.push({ icon: "🎯", title: "Mind reader", ids: mind, note: `off by ${a.toFixed(1)} voters per poll` });
  }
  const wolf = bestOf(s, (i) => s.wolves[i], 1, true);
  if (wolf.length && wolf.length <= 3) {
    const w = s.wolves[s.ids.indexOf(wolf[0])];
    out.push({ icon: "🐺", title: "Lone wolf", ids: wolf, note: `alone on an answer ${w}×` });
  }
  const herd = bestOf(s, (i) => s.herd[i], 2, true);
  if (herd.length && herd.length <= 3) {
    const h = s.herd[s.ids.indexOf(herd[0])];
    out.push({ icon: "🐑", title: "Crowd pleaser", ids: herd, note: `picked the favourite ${h}×` });
  }
  return out;
}

function finish(s: PollState, ctx: GameCtx, abandoned: boolean) {
  s.phase = "final";
  s.abandoned = abandoned;
  s.endsAt = 0;
  s.reveal = null;
  s.lowSince = null;
  s.awards = computeAwards(s);
  const scores = Object.fromEntries(s.ids.map((id, i) => [id, s.score[i]]));
  const name = (id: string) => ctx.player(id)?.name ?? "Someone";
  const winners = topScorers(scores);
  const best = winners.length ? s.score[s.ids.indexOf(winners[0])] : 0;
  let headline: string;
  if (winners.length === 0) headline = "Nobody read the room. The polls win this time!";
  else if (winners.length === 1) headline = `${name(winners[0])} takes Poll Position with ${best} points`;
  else if (winners.length <= 3) headline = `${joinNames(winners.map(name))} share Poll Position with ${best} points`;
  else headline = `${winners.length}-way tie for Poll Position at ${best} points`;
  if (abandoned) headline = `Not enough players left. ${headline}`;
  ctx.end({ winners, headline, scores });
}

/** True when every connected participant has done this phase's job. */
function everyoneDone(s: PollState, ctx: GameCtx): boolean {
  let here = 0;
  for (let i = 0; i < s.ids.length; i++) {
    if (!isHere(ctx, s.ids[i])) continue;
    here++;
    const done = s.phase === "vote" ? s.vote[i] !== null : s.phase === "predict" ? s.locked[i] : s.ready[i];
    if (!done) return false;
  }
  return here > 0;
}

function advance(s: PollState, ctx: GameCtx) {
  if (s.phase === "vote") startPredict(s, ctx);
  else if (s.phase === "predict") startReveal(s, ctx);
  else if (s.phase === "reveal") nextRound(s, ctx);
}

function maybeAdvance(s: PollState, ctx: GameCtx): boolean {
  if (s.phase === "final" || !everyoneDone(s, ctx)) return false;
  advance(s, ctx);
  return true;
}

export const poll: GameDef<PollState, PollAction> = {
  id: "poll",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const polls = shuffle(
      POLLS.map((_, i) => i),
      ctx.random,
    ).slice(0, ROUNDS);
    const kinds: PollKind[] = polls.map(() => "normal");
    // Twists land mid-game: Read the room in rounds 3-5, Majority rules in rounds 6-7.
    kinds[2 + Math.floor(ctx.random() * 3)] = "room";
    kinds[5 + Math.floor(ctx.random() * 2)] = "majority";
    const zeros = () => ids.map(() => 0);
    const s: PollState = {
      startedAt: ctx.now(),
      ids,
      polls,
      kinds,
      round: 0,
      phase: "vote",
      endsAt: 0,
      vote: [],
      pred: [],
      read: [],
      self: null,
      locked: [],
      ready: [],
      voters: 0,
      spot: -1,
      score: zeros(),
      reveal: null,
      recap: [],
      missSum: zeros(),
      predicted: zeros(),
      wolves: zeros(),
      herd: zeros(),
      awards: [],
      lowSince: null,
      abandoned: false,
    };
    startVote(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.phase === "final") return false;
    const seat = s.ids.indexOf(playerId);
    if (seat < 0) return false;
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as Record<string, unknown>;
    const n = optCount(s);
    const room = s.kinds[s.round] === "room";

    switch (a.type) {
      case "vote": {
        if (s.phase !== "vote" || !isInt(a.o, 0, n - 1) || s.vote[seat] === a.o) return false;
        s.vote[seat] = a.o;
        maybeAdvance(s, ctx);
        return true;
      }
      case "pred": {
        if (s.phase !== "predict" || room || s.locked[seat]) return false;
        if (!validPred(a.c, n, s.voters)) return false;
        if (a.lock !== undefined && a.lock !== true) return false;
        s.pred[seat] = a.c.slice();
        if (!a.lock) return false; // a draft: nothing anyone can see changed
        s.locked[seat] = true;
        maybeAdvance(s, ctx);
        return true;
      }
      case "read": {
        if (s.phase !== "predict" || !room || seat === s.spot || !isInt(a.o, 0, n - 1)) return false;
        if (s.read[seat] === a.o) return false;
        s.read[seat] = a.o;
        s.locked[seat] = true;
        maybeAdvance(s, ctx);
        return true;
      }
      case "self": {
        if (s.phase !== "predict" || !room || seat !== s.spot || s.locked[seat]) return false;
        if (!isInt(a.n, 0, s.ids.length - 1)) return false;
        if (a.lock !== undefined && a.lock !== true) return false;
        s.self = a.n;
        if (!a.lock) return false;
        s.locked[seat] = true;
        maybeAdvance(s, ctx);
        return true;
      }
      case "ready": {
        if (s.phase !== "reveal" || s.ready[seat]) return false;
        s.ready[seat] = true;
        maybeAdvance(s, ctx);
        return true;
      }
    }
    return false;
  },

  tick(s, ctx) {
    if (s.phase === "final") return false;
    const now = ctx.now();
    let changed = false;
    const here = s.ids.reduce((k, id) => k + (isHere(ctx, id) ? 1 : 0), 0);
    if (here < 2) {
      if (s.lowSince === null) {
        s.lowSince = now;
        changed = true;
      } else if (now - s.lowSince >= ABANDON_MS) {
        finish(s, ctx, true);
        return true;
      }
    } else if (s.lowSince !== null) {
      s.lowSince = null;
      changed = true;
    }
    if (now >= s.endsAt) {
      advance(s, ctx);
      return true;
    }
    // Someone who was holding things up may have left.
    return maybeAdvance(s, ctx) || changed;
  },
  tickMs: 250,

  view(s, viewerId, ctx): PollView {
    const seat = s.ids.indexOf(viewerId);
    const poll = POLLS[s.polls[s.round]] ?? ["", ""];
    const final = s.phase === "final";
    return {
      game: s.startedAt,
      phase: s.phase,
      round: s.round + 1,
      rounds: s.polls.length,
      kind: s.kinds[s.round] ?? "normal",
      q: poll[0],
      opts: poll.slice(1),
      endsAt: s.endsAt,
      phaseMs: PHASE_MS[s.phase],
      voters: s.voters,
      spot: s.spot >= 0 && s.phase !== "vote" ? s.ids[s.spot] : null,
      seats: s.ids.map((id, i) => ({
        id,
        score: s.score[i],
        voted: s.vote[i] !== null,
        locked: s.locked[i],
        ready: s.ready[i],
        away: !isHere(ctx, id),
      })),
      mine:
        seat >= 0 && !final
          ? {
              vote: s.vote[seat],
              pred: s.pred[seat],
              read: s.read[seat],
              self: seat === s.spot ? s.self : null,
              locked: s.locked[seat],
            }
          : null,
      reveal: s.phase === "reveal" ? s.reveal : null,
      recap: final ? s.recap : [],
      awards: final ? s.awards : [],
      endingAt: s.lowSince !== null && !final ? s.lowSince + ABANDON_MS : null,
      abandoned: s.abandoned,
    };
  },

  playerLeft(s, _playerId, ctx) {
    if (s.phase === "final") return;
    if (s.lowSince === null && s.ids.filter((id) => isHere(ctx, id)).length < 2) s.lowSince = ctx.now();
  },

  playerReturned(s, _playerId, ctx) {
    if (s.lowSince !== null && s.ids.filter((id) => isHere(ctx, id)).length >= 2) s.lowSince = null;
  },
};

export default poll;
