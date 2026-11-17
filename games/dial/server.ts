import type { GameCtx, GameDef } from "../../shared/game";
import { shuffle, topScorers } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import { SPECTRUMS } from "./data";
import {
  ABANDON_MS,
  AWAY_GRACE_MS,
  CLUE_MS,
  DIAL_EMIT_MIN_MS,
  DIAL_START,
  GUESS_MS,
  REVEAL_MS,
  TARGET_MAX,
  TARGET_MIN,
  TEAM_PLAYERS,
  BANDS,
  cleanClue,
  clueProblem,
  isDialValue,
  pointsFor,
  teamVerdict,
  type DialEvent,
} from "./shared";

// On the Dial: one clue-giver sees a hidden target on a spectrum (Cold <-> Hot)
// and gives a clue; everyone else drags a live needle to where they think it sits.
//
// Phases per round: clue (60s) -> guess (40s, ends early once every present
// guesser locked) -> reveal (7s). After the last round: final (ctx.end).
// Per-player data lives in arrays indexed by seat, so player ids never become
// object keys on the server.
//
// Two players: the clue-giver gets the only guesser's points, so scores would
// always tie. A two-player game is therefore co-op: one team score (the points
// guessed across all rounds), and the pair wins together with half the maximum.

export type DialPhase = "clue" | "guess" | "reveal" | "final";

export type DialAction =
  | { type: "reroll" }
  | { type: "clue"; text: string }
  | { type: "dial"; v: number }
  | { type: "lock"; v?: number };

export interface DialRow {
  id: string;
  /** Where their needle ended up (null = never touched it). */
  v: number | null;
  dist: number | null;
  pts: number;
}

export interface DialReveal {
  target: number;
  /** Clue-giver's points: the rounded average of the guessers who guessed. */
  giverPts: number;
  /** Guessers, closest first. */
  rows: DialRow[];
}

export interface DialRecap {
  giver: string;
  left: string;
  right: string;
  clue: string | null;
  target: number;
  giverPts: number;
  best: { id: string; dist: number } | null;
  skipped: boolean;
}

export interface DialNotice {
  id: string;
  why: "timeout" | "away";
}

export interface DialState {
  /** When this game started: tells one game from the next ("Play again"). */
  startedAt: number;
  ids: string[];
  /** Seat of the clue-giver for each round. */
  order: number[];
  round: number;
  phase: DialPhase;
  endsAt: number;
  /** Guessing time in ms (host setting). */
  guessMs: number;
  deck: number[];
  spec: number;
  rerolled: boolean;
  target: number;
  /** When the current clue turn began (an absent clue-giver gets a grace period from here). */
  turnAt: number;
  clue: string | null;
  needle: (number | null)[];
  locked: boolean[];
  /** Last needle broadcast per seat, and whether a newer value still has to go out. */
  lastEmit: number[];
  emitPending: boolean[];
  score: number[];
  /** When each seat disconnected (null = connected). */
  away: (number | null)[];
  reveal: DialReveal | null;
  recap: DialRecap[];
  notice: DialNotice | null;
  /** Since when fewer than two participants are connected. */
  lowSince: number | null;
  /**
   * When the game ends unless players come back. Only set (and shown) once the
   * shortage has lasted AWAY_GRACE_MS, so an ordinary refresh doesn't flash a warning.
   */
  endingAt: number | null;
  abandoned: boolean;
}

export interface DialSeat {
  id: string;
  score: number;
  /** Last known needle position this round (public: needles are live for everyone). */
  v: number | null;
  locked: boolean;
  away: boolean;
}

export interface DialView {
  /** Identifies this game (changes on "Play again"). */
  game: number;
  phase: DialPhase;
  /** 1-based. */
  round: number;
  rounds: number;
  giver: string;
  /** Clue-giver of the following round, if any. */
  next: string | null;
  endsAt: number;
  phaseMs: number;
  left: string;
  right: string;
  rerolled: boolean;
  /** Only the clue-giver sees this before the reveal. */
  target: number | null;
  clue: string | null;
  seats: DialSeat[];
  reveal: DialReveal | null;
  /** Every finished round; only sent in the final phase. */
  recap: DialRecap[];
  notice: DialNotice | null;
  /** The disconnected clue-giver's turn is skipped at this time. */
  skipAt: number | null;
  /** The game ends at this time unless more players reconnect. */
  endingAt: number | null;
  role: "giver" | "guesser" | "spectator";
  abandoned: boolean;
  /** Two-player co-op: the shared team score so far, and what it takes to win. Null otherwise. */
  team: DialTeam | null;
}

export interface DialTeam {
  score: number;
  goal: number;
  max: number;
}

function phaseMs(s: DialState): number {
  return s.phase === "clue" ? CLUE_MS : s.phase === "guess" ? s.guessMs : s.phase === "reveal" ? REVEAL_MS : 0;
}

const isHere = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;

function giverSeat(s: DialState): number {
  return s.order[s.round] ?? 0;
}

function team(s: DialState): DialTeam | null {
  if (s.ids.length !== TEAM_PLAYERS) return null;
  const max = s.order.length * BANDS[0].pts;
  // With one guesser the clue-giver's points are exactly the guesser's points.
  return { score: s.recap.reduce((n, r) => n + r.giverPts, 0), goal: Math.ceil(max / 2), max };
}

/** When an absent clue-giver's turn gets skipped: AWAY_GRACE_MS after they left or their turn began. */
function skipTime(s: DialState): number | null {
  const away = s.away[giverSeat(s)];
  if (s.phase !== "clue" || away === null || s.lowSince !== null) return null;
  return Math.max(away, s.turnAt) + AWAY_GRACE_MS;
}

function drawSpectrum(s: DialState, ctx: GameCtx): number {
  if (s.deck.length === 0) {
    s.deck = shuffle(
      SPECTRUMS.map((_, i) => i).filter((i) => i !== s.spec),
      ctx.random,
    );
  }
  return s.deck.pop() ?? 0;
}

function startClue(s: DialState, ctx: GameCtx) {
  s.phase = "clue";
  s.spec = drawSpectrum(s, ctx);
  s.rerolled = false;
  s.turnAt = ctx.now();
  const span = TARGET_MAX - TARGET_MIN + 1;
  s.target = Math.min(TARGET_MAX, TARGET_MIN + Math.floor(ctx.random() * span));
  s.clue = null;
  s.needle = s.ids.map(() => null);
  s.locked = s.ids.map(() => false);
  s.emitPending = s.ids.map(() => false);
  s.reveal = null;
  s.endsAt = ctx.now() + CLUE_MS;
}

function startGuess(s: DialState, ctx: GameCtx, clue: string) {
  s.clue = clue;
  s.phase = "guess";
  s.notice = null;
  s.endsAt = ctx.now() + s.guessMs;
}

/** A guesser we still wait for: connected, or only briefly away. */
function isActive(s: DialState, seat: number, now: number): boolean {
  const away = s.away[seat];
  return away === null || now - away < AWAY_GRACE_MS;
}

/** Ends the guess phase early once every present guesser has locked. */
function maybeEndGuess(s: DialState, ctx: GameCtx): boolean {
  if (s.phase !== "guess") return false;
  const now = ctx.now();
  const giver = giverSeat(s);
  let active = 0;
  for (let i = 0; i < s.ids.length; i++) {
    if (i === giver || !isActive(s, i, now)) continue;
    if (!s.locked[i]) return false;
    active++;
  }
  if (active === 0) return false; // nobody here to guess: let the timer decide
  startReveal(s, ctx);
  return true;
}

function emitNeedle(s: DialState, ctx: GameCtx, seat: number) {
  const v = s.needle[seat];
  s.emitPending[seat] = false;
  if (v === null) return;
  s.lastEmit[seat] = ctx.now();
  const id = s.ids[seat];
  ctx.emit({ k: "dial", id, v } satisfies DialEvent, { except: id });
}

function startReveal(s: DialState, ctx: GameCtx) {
  const giver = giverSeat(s);
  s.emitPending = s.ids.map(() => false); // the reveal view carries final positions
  const rows: DialRow[] = [];
  let sum = 0;
  let guessed = 0;
  for (let i = 0; i < s.ids.length; i++) {
    if (i === giver) continue;
    const v = s.needle[i];
    if (v === null) {
      rows.push({ id: s.ids[i], v: null, dist: null, pts: 0 });
      continue;
    }
    const dist = Math.abs(v - s.target);
    const pts = pointsFor(dist);
    s.score[i] += pts;
    sum += pts;
    guessed++;
    rows.push({ id: s.ids[i], v, dist, pts });
  }
  const giverPts = guessed ? Math.round(sum / guessed) : 0;
  s.score[giver] += giverPts;
  rows.sort((a, b) => (a.dist ?? 1000) - (b.dist ?? 1000));
  const top = rows[0];
  s.reveal = { target: s.target, giverPts, rows };
  s.recap.push({
    giver: s.ids[giver],
    left: SPECTRUMS[s.spec][0],
    right: SPECTRUMS[s.spec][1],
    clue: s.clue,
    target: s.target,
    giverPts,
    best: top && top.dist !== null ? { id: top.id, dist: top.dist } : null,
    skipped: false,
  });
  s.phase = "reveal";
  s.endsAt = ctx.now() + REVEAL_MS;
}

function skipRound(s: DialState, ctx: GameCtx, why: DialNotice["why"]) {
  const giver = giverSeat(s);
  s.notice = { id: s.ids[giver], why };
  s.recap.push({
    giver: s.ids[giver],
    left: SPECTRUMS[s.spec][0],
    right: SPECTRUMS[s.spec][1],
    clue: null,
    target: s.target,
    giverPts: 0,
    best: null,
    skipped: true,
  });
  nextRound(s, ctx);
}

function nextRound(s: DialState, ctx: GameCtx) {
  if (s.round + 1 >= s.order.length) return finish(s, ctx, false);
  s.round += 1;
  startClue(s, ctx);
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function finish(s: DialState, ctx: GameCtx, abandoned: boolean) {
  s.phase = "final";
  s.abandoned = abandoned;
  s.endsAt = 0;
  s.reveal = null;
  s.lowSince = null;
  s.endingAt = null;
  const scores = Object.fromEntries(s.ids.map((id, i) => [id, s.score[i]]));
  const name = (id: string) => ctx.player(id)?.name ?? "Someone";
  const t = team(s);
  if (t) {
    const verdict = teamVerdict(t.score, t.goal, t.max);
    const pair = joinNames(s.ids.map(name));
    let line = verdict.won
      ? `${verdict.title} ${pair} scored ${t.score}/${t.max} as a team`
      : `${verdict.title}: ${pair} scored ${t.score}/${t.max}, ${t.goal} needed to win`;
    if (abandoned) line = `Not enough players left. ${line}`;
    ctx.end({ winners: verdict.won ? [...s.ids] : [], headline: line, scores });
    return;
  }
  const winners = topScorers(scores);
  const best = winners.length ? s.score[s.ids.indexOf(winners[0])] : 0;
  const pts = `${best} ${best === 1 ? "point" : "points"}`;
  let headline: string;
  if (winners.length === 0) headline = "Nobody scored a point. The dial wins this time!";
  else if (winners.length === 1) headline = `${name(winners[0])} wins On the Dial with ${pts}`;
  else if (winners.length <= 3) headline = `${joinNames(winners.map(name))} tie for the win with ${pts}`;
  else headline = `${winners.length}-way tie at the top with ${pts}`;
  if (abandoned) headline = `Not enough players left. ${headline}`;
  ctx.end({ winners, headline, scores });
}

/** Keep `away` in step with the room's connection flags (in case a hook was missed). */
function syncAway(s: DialState, ctx: GameCtx): boolean {
  let changed = false;
  const now = ctx.now();
  for (let i = 0; i < s.ids.length; i++) {
    const here = isHere(ctx, s.ids[i]);
    if (!here && s.away[i] === null) {
      s.away[i] = now;
      changed = true;
    } else if (here && s.away[i] !== null) {
      s.away[i] = null;
      changed = true;
    }
  }
  return changed;
}

export const dial: GameDef<DialState, DialAction> = {
  id: "dial",

  setup(ctx) {
    const settings = readSettings(config.settings, ctx.settings);
    const ids = ctx.players.map((p) => p.id);
    const n = ids.length;
    const seats = ids.map((_, i) => i);
    // Clues per player: "auto" gives small games (2-3 players) two each, bigger ones one.
    const laps = settings.laps === "auto" ? (n <= 3 ? 2 : 1) : Number(settings.laps) || 1;
    let order = shuffle(seats, ctx.random);
    for (let lap = 1; lap < laps; lap++) {
      // Never the same giver twice in a row.
      const next = shuffle(seats, ctx.random);
      if (n > 1 && next[0] === order[order.length - 1]) [next[0], next[1]] = [next[1], next[0]];
      order = order.concat(next);
    }
    const s: DialState = {
      startedAt: ctx.now(),
      ids,
      order,
      round: 0,
      phase: "clue",
      endsAt: 0,
      guessMs: (Number(settings.guess) || GUESS_MS / 1000) * 1000,
      deck: shuffle(
        SPECTRUMS.map((_, i) => i),
        ctx.random,
      ),
      spec: 0,
      rerolled: false,
      target: DIAL_START,
      turnAt: ctx.now(),
      clue: null,
      needle: ids.map(() => null),
      locked: ids.map(() => false),
      lastEmit: ids.map(() => 0),
      emitPending: ids.map(() => false),
      score: ids.map(() => 0),
      away: ids.map((id) => (isHere(ctx, id) ? null : ctx.now())),
      reveal: null,
      recap: [],
      notice: null,
      lowSince: null,
      endingAt: null,
      abandoned: false,
    };
    startClue(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.phase === "final") return false;
    const seat = s.ids.indexOf(playerId);
    if (seat < 0) return false;
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as Record<string, unknown>;
    const giver = giverSeat(s);

    switch (a.type) {
      case "reroll": {
        if (s.phase !== "clue" || seat !== giver || s.rerolled) return false;
        s.spec = drawSpectrum(s, ctx);
        s.rerolled = true;
        return true;
      }
      case "clue": {
        if (s.phase !== "clue" || seat !== giver) return false;
        if (typeof a.text !== "string" || a.text.length > 400) return false;
        const text = cleanClue(a.text);
        if (clueProblem(text)) return false;
        startGuess(s, ctx, text);
        return true;
      }
      case "dial": {
        if (s.phase !== "guess" || seat === giver || s.locked[seat]) return false;
        if (!isDialValue(a.v) || s.needle[seat] === a.v) return false;
        s.needle[seat] = a.v;
        // High-frequency: everyone else hears about it as an event; no full re-send.
        if (ctx.now() - s.lastEmit[seat] >= DIAL_EMIT_MIN_MS) emitNeedle(s, ctx, seat);
        else s.emitPending[seat] = true; // too fast: tick() sends the latest value
        return false;
      }
      case "lock": {
        if (s.phase !== "guess" || seat === giver || s.locked[seat]) return false;
        if (a.v !== undefined) {
          if (!isDialValue(a.v)) return false;
          s.needle[seat] = a.v;
        } else if (s.needle[seat] === null) {
          s.needle[seat] = DIAL_START; // locked without touching it: commits to where it sits
        }
        s.locked[seat] = true;
        s.emitPending[seat] = false; // the re-sent view carries it
        maybeEndGuess(s, ctx);
        return true;
      }
    }
    return false;
  },

  tick(s, ctx) {
    if (s.phase === "final") return false;
    const now = ctx.now();
    let changed = syncAway(s, ctx);

    if (s.ids.length < 2) {
      finish(s, ctx, true);
      return true;
    }
    const here = s.ids.reduce((n, id) => n + (isHere(ctx, id) ? 1 : 0), 0);
    if (here < 2) {
      if (s.lowSince === null) {
        s.lowSince = now;
        changed = true;
      } else if (now - s.lowSince >= ABANDON_MS) {
        finish(s, ctx, true);
        return true;
      }
      if (s.endingAt === null && now - s.lowSince >= AWAY_GRACE_MS) {
        s.endingAt = s.lowSince + ABANDON_MS;
        changed = true;
      }
    } else if (s.lowSince !== null) {
      s.lowSince = null;
      s.endingAt = null;
      changed = true;
    }

    switch (s.phase) {
      case "clue": {
        if (now >= s.endsAt) {
          skipRound(s, ctx, "timeout");
          return true;
        }
        // An absent clue-giver gets a grace period from the start of their own turn.
        // Not while fewer than two are connected: then the abandonment timer decides,
        // so a shared outage doesn't burn through everyone's turns.
        const skipAt = skipTime(s);
        if (skipAt !== null && now >= skipAt) {
          skipRound(s, ctx, "away");
          return true;
        }
        return changed;
      }
      case "guess":
        if (now >= s.endsAt) {
          startReveal(s, ctx);
          return true;
        }
        for (let i = 0; i < s.ids.length; i++) if (s.emitPending[i]) emitNeedle(s, ctx, i);
        return maybeEndGuess(s, ctx) || changed;
      case "reveal":
        if (now >= s.endsAt) {
          nextRound(s, ctx);
          return true;
        }
        return changed;
    }
    return changed;
  },
  tickMs: 250,

  view(s, viewerId): DialView {
    const seat = s.ids.indexOf(viewerId);
    const giver = giverSeat(s);
    const live = s.phase === "clue" || s.phase === "guess";
    const role = seat < 0 ? "spectator" : seat === giver && s.phase !== "final" ? "giver" : "guesser";
    const [left, right] = SPECTRUMS[s.spec] ?? ["", ""];
    return {
      game: s.startedAt,
      phase: s.phase,
      round: s.round + 1,
      rounds: s.order.length,
      giver: s.ids[giver] ?? "",
      next: s.round + 1 < s.order.length ? s.ids[s.order[s.round + 1]] : null,
      endsAt: s.endsAt,
      phaseMs: phaseMs(s),
      left,
      right,
      rerolled: s.rerolled,
      // The secret: only the clue-giver sees it until the reveal.
      target: s.phase === "reveal" || (live && role === "giver") ? s.target : null,
      clue: s.clue,
      seats: s.ids.map((id, i) => ({
        id,
        score: s.score[i],
        v: s.needle[i],
        locked: s.locked[i],
        away: s.away[i] !== null,
      })),
      reveal: s.phase === "reveal" ? s.reveal : null,
      recap: s.phase === "final" ? s.recap : [],
      notice: s.phase === "clue" ? s.notice : null,
      skipAt: skipTime(s),
      endingAt: s.phase !== "final" ? s.endingAt : null,
      role,
      abandoned: s.abandoned,
      team: team(s),
    };
  },

  playerLeft(s, playerId, ctx) {
    const seat = s.ids.indexOf(playerId);
    if (seat < 0 || s.phase === "final") return;
    if (s.away[seat] === null) s.away[seat] = ctx.now();
    if (s.lowSince === null && s.ids.filter((id) => isHere(ctx, id)).length < 2) s.lowSince = ctx.now();
  },

  playerReturned(s, playerId, ctx) {
    const seat = s.ids.indexOf(playerId);
    if (seat < 0) return;
    s.away[seat] = null;
    if (s.lowSince !== null && s.ids.filter((id) => isHere(ctx, id)).length >= 2) {
      s.lowSince = null;
      s.endingAt = null;
    }
  },
};

export default dial;
