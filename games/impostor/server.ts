import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { PAIRS } from "./data";
import {
  AWAY_GUESS_MS,
  CLUE_MS,
  GUESS_MS,
  LAPS,
  MAX_CLUE,
  MAX_RAW,
  MAX_ROUNDS,
  MIN_PLAYERS,
  POINTS,
  REVEAL_MS,
  SHORT_GRACE_MS,
  VOTE_MS,
  VOTE_SETTLE_MS,
  cleanText,
  clueProblem,
  guessMatches,
  guessProblem,
} from "./shared";

// Odd One Out: everyone gets the same secret word except one player, who gets a
// related one and doesn't know it. Two laps of one-word clues, a vote, and if the
// odd one is caught, one last guess at the majority word.
//
// Per-player data lives in arrays indexed by seat (position in `ids`), so player
// ids are never used as object keys in state.

export type Phase = "clues" | "vote" | "lastGuess" | "reveal" | "final";
export type ClueStatus = "clue" | "pass" | "away";

export interface ClueEntry {
  by: string;
  /** The clue as typed (cleaned); null for a pass or a skipped (offline) turn. */
  text: string | null;
  status: ClueStatus;
  /** 0-based lap. */
  lap: number;
}

export type Outcome = "escaped" | "guessed" | "caught" | "abandoned";

export interface RoundSummary {
  round: number;
  majorityWord: string;
  oddWord: string;
  oddId: string;
  votes: { voter: string; target: string }[];
  /** Strictly most-voted player, or null on a tie / no votes. */
  caughtId: string | null;
  outcome: Outcome;
  guess: string | null;
  guessCorrect: boolean;
  points: Record<string, number>;
}

export interface ImpostorState {
  ids: string[];
  totalRounds: number;
  round: number;
  phase: Phase;
  /** Hard deadline of the current turn / phase (absolute server time). */
  endsAt: number;
  scores: number[];
  usedPairs: number[];
  wasOdd: boolean[];
  // The current round's secrets.
  majorityWord: string;
  oddWord: string;
  oddSeat: number;
  // Clues: `order` holds seats; turn t belongs to order[t % n], lap floor(t / n).
  order: number[];
  turn: number;
  /** One entry per finished turn, in turn order (so clues[t] is turn t). */
  clues: ClueEntry[];
  /** Voter seat -> target seat, -1 = no vote yet. */
  votes: number[];
  /** When everyone connected had voted (the vote then closes VOTE_SETTLE_MS later). */
  settleAt: number | null;
  caughtSeat: number;
  guess: string | null;
  history: RoundSummary[];
  /** Seat -> when they went offline, 0 while connected. */
  awaySince: number[];
  /** When fewer than MIN_PLAYERS were last seen connected. */
  shortSince: number | null;
  endedEarly: boolean;
}

export type ImpostorAction =
  | { type: "clue"; text: string }
  | { type: "vote"; target: string }
  | { type: "guess"; text: string };

/** Private event sent to one player when their clue or guess is refused. */
export interface ImpostorErrorEvent {
  type: "error";
  message: string;
}

export interface ImpostorView {
  phase: Phase;
  round: number;
  totalRounds: number;
  /** Effective deadline of the current turn / phase (0 when final). */
  endsAt: number;
  /** Turn order (player ids) for this round. */
  order: string[];
  turn: number;
  /** Whose clue turn it is (clues phase only). */
  currentId: string | null;
  clues: ClueEntry[];
  /** The viewer's own word. Null for spectators. Nobody is told whether it's the odd one. */
  myWord: string | null;
  /** Who has voted (vote phase only), never for whom. */
  voted: string[];
  /** Everyone connected has voted: the vote closes in VOTE_SETTLE_MS. */
  allVoted: boolean;
  /** The viewer's own vote. */
  myVote: string | null;
  /** The caught odd one, during their last guess. */
  caughtId: string | null;
  scores: Record<string, number>;
  /** Finished rounds, fully revealed. The current round joins at its reveal. */
  history: RoundSummary[];
  /** When the game ends unless more players reconnect (null when enough are here). */
  shortUntil: number | null;
  endedEarly: boolean;
}

const isOnline = (ctx: GameCtx, id: string) => ctx.player(id)?.connected === true;

function randomIndex(ctx: GameCtx, length: number): number {
  const r = ctx.random();
  return Math.min(length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * length)));
}

const turnsPerRound = (s: ImpostorState) => s.order.length * LAPS;

function currentSeat(s: ImpostorState): number {
  if (s.phase !== "clues" || s.turn >= turnsPerRound(s)) return -1;
  return s.order[s.turn % s.order.length];
}

function voteDeadline(s: ImpostorState): number {
  return s.settleAt === null ? s.endsAt : Math.min(s.endsAt, s.settleAt + VOTE_SETTLE_MS);
}

function guessDeadline(s: ImpostorState): number {
  const away = s.awaySince[s.oddSeat];
  if (!away) return s.endsAt;
  // Offline odd one: a short window (from when they left, or when the phase began) to come back.
  return Math.min(s.endsAt, Math.max(away, s.endsAt - GUESS_MS) + AWAY_GUESS_MS);
}

function deadline(s: ImpostorState): number {
  switch (s.phase) {
    case "vote":
      return voteDeadline(s);
    case "lastGuess":
      return guessDeadline(s);
    case "final":
      return 0;
    default:
      return s.endsAt;
  }
}

function wordOf(s: ImpostorState, seat: number): string {
  return seat === s.oddSeat ? s.oddWord : s.majorityWord;
}

function scoreRecord(s: ImpostorState, values: number[]): Record<string, number> {
  return Object.fromEntries(s.ids.map((id, i) => [id, values[i] ?? 0]));
}

function rejectText(ctx: GameCtx, to: string, message: string): false {
  ctx.emit({ type: "error", message } satisfies ImpostorErrorEvent, { to });
  return false;
}

// ---------- round flow ----------

function chooseOddSeat(s: ImpostorState, ctx: GameCtx): number {
  const seats = s.ids.map((_, i) => i);
  const online = seats.filter((i) => isOnline(ctx, s.ids[i]));
  const fresh = (list: number[]) => list.filter((i) => !s.wasOdd[i]);
  const last = s.history.length ? s.ids.indexOf(s.history[s.history.length - 1].oddId) : -1;
  // Prefer someone connected who hasn't been odd yet; never strand the round on an offline player.
  const pools = [fresh(online), online.filter((i) => i !== last), online, fresh(seats), seats];
  const pool = pools.find((p) => p.length > 0) ?? [0];
  return pool[randomIndex(ctx, pool.length)];
}

function startRound(s: ImpostorState, ctx: GameCtx) {
  s.round += 1;

  let pool = PAIRS.map((_, i) => i).filter((i) => !s.usedPairs.includes(i));
  if (!pool.length) {
    s.usedPairs = [];
    pool = PAIRS.map((_, i) => i);
  }
  const pairIndex = pool[randomIndex(ctx, pool.length)];
  s.usedPairs.push(pairIndex);
  const pair = PAIRS[pairIndex];
  const flip = ctx.random() < 0.5;
  s.majorityWord = flip ? pair[1] : pair[0];
  s.oddWord = flip ? pair[0] : pair[1];

  s.oddSeat = chooseOddSeat(s, ctx);
  s.wasOdd[s.oddSeat] = true;

  s.order = shuffle(
    s.ids.map((_, i) => i),
    () => ctx.random(),
  );
  s.turn = 0;
  s.clues = [];
  s.votes = s.ids.map(() => -1);
  s.settleAt = null;
  s.caughtSeat = -1;
  s.guess = null;
  s.phase = "clues";
  beginTurn(s, ctx);
}

/** Start the turn at s.turn, instantly skipping offline players; moves to the vote when done. */
function beginTurn(s: ImpostorState, ctx: GameCtx) {
  const n = s.order.length;
  while (s.turn < turnsPerRound(s)) {
    const seat = s.order[s.turn % n];
    if (isOnline(ctx, s.ids[seat])) {
      s.endsAt = ctx.now() + CLUE_MS;
      return;
    }
    s.clues.push({ by: s.ids[seat], text: null, status: "away", lap: Math.floor(s.turn / n) });
    s.turn += 1;
  }
  startVote(s, ctx);
}

function endTurn(s: ImpostorState, ctx: GameCtx, text: string | null, status: ClueStatus) {
  const seat = currentSeat(s);
  if (seat < 0) return;
  s.clues.push({ by: s.ids[seat], text, status, lap: Math.floor(s.turn / s.order.length) });
  s.turn += 1;
  beginTurn(s, ctx);
}

function startVote(s: ImpostorState, ctx: GameCtx) {
  s.phase = "vote";
  s.endsAt = ctx.now() + VOTE_MS;
  s.votes = s.ids.map(() => -1);
  s.settleAt = null;
  syncSettle(s, ctx);
}

/** Keep `settleAt` in step with "everyone connected has voted". Returns true if it changed. */
function syncSettle(s: ImpostorState, ctx: GameCtx): boolean {
  if (s.phase !== "vote") return false;
  const allIn = s.ids.every((id, i) => s.votes[i] >= 0 || !isOnline(ctx, id));
  const before = s.settleAt;
  if (!allIn) s.settleAt = null;
  else if (s.settleAt === null) s.settleAt = ctx.now();
  return before !== s.settleAt;
}

function resolveVote(s: ImpostorState, ctx: GameCtx) {
  const counts = s.ids.map(() => 0);
  for (const target of s.votes) if (target >= 0) counts[target] += 1;
  const max = Math.max(0, ...counts);
  const leaders = counts.filter((c) => c === max).length;
  s.caughtSeat = max > 0 && leaders === 1 ? counts.indexOf(max) : -1;
  if (s.caughtSeat >= 0 && s.caughtSeat === s.oddSeat) {
    s.phase = "lastGuess";
    s.endsAt = ctx.now() + GUESS_MS;
    s.guess = null;
  } else {
    finishRound(s, ctx, "escaped");
  }
}

function resolveGuess(s: ImpostorState, ctx: GameCtx, guess: string | null) {
  s.guess = guess;
  finishRound(s, ctx, guess !== null && guessMatches(guess, s.majorityWord) ? "guessed" : "caught");
}

function summarize(s: ImpostorState, outcome: Outcome, points: number[]): RoundSummary {
  return {
    round: s.round,
    majorityWord: s.majorityWord,
    oddWord: s.oddWord,
    oddId: s.ids[s.oddSeat],
    votes: s.votes.flatMap((target, voter) =>
      target >= 0 ? [{ voter: s.ids[voter], target: s.ids[target] }] : [],
    ),
    caughtId: s.caughtSeat >= 0 ? s.ids[s.caughtSeat] : null,
    outcome,
    guess: s.guess,
    guessCorrect: outcome === "guessed",
    points: scoreRecord(s, points),
  };
}

function finishRound(s: ImpostorState, ctx: GameCtx, outcome: Exclude<Outcome, "abandoned">) {
  const points = s.ids.map(() => 0);
  if (outcome === "escaped") points[s.oddSeat] = POINTS.escape;
  else if (outcome === "guessed") points[s.oddSeat] = POINTS.guess;
  else {
    for (let i = 0; i < s.ids.length; i++) {
      if (i !== s.oddSeat) points[i] = POINTS.catch + (s.votes[i] === s.oddSeat ? POINTS.sharpEye : 0);
    }
  }
  points.forEach((p, i) => (s.scores[i] += p));
  s.history.push(summarize(s, outcome, points));
  s.phase = "reveal";
  s.endsAt = ctx.now() + REVEAL_MS;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function endGame(s: ImpostorState, ctx: GameCtx, early: boolean) {
  if (s.phase === "final") return;
  if (early && s.phase !== "reveal") {
    // Reveal the unfinished round's words in the recap; nobody scores for it.
    s.history.push(summarize(s, "abandoned", s.ids.map(() => 0)));
  }
  const played = s.history.filter((h) => h.outcome !== "abandoned").length;
  s.endedEarly = early && played < s.totalRounds;
  s.phase = "final";
  s.endsAt = 0;

  const scores = scoreRecord(s, s.scores);
  const winners = topScorers(scores);
  const name = (id: string) => ctx.player(id)?.name ?? "Someone";
  const best = winners.length ? scores[winners[0]] : 0;
  const pts = `${best} point${best === 1 ? "" : "s"}`;
  const prefix = s.endedEarly ? "Ended early: " : "";
  let headline: string;
  if (!winners.length) headline = s.endedEarly ? "Odd One Out ended early before anyone scored" : "Nobody scored in Odd One Out";
  else if (winners.length === 1) headline = `${prefix}${name(winners[0])} wins Odd One Out with ${pts}`;
  else headline = `${prefix}${joinNames(winners.map(name))} tie for the win with ${pts}`;
  ctx.end({ winners, headline, scores });
}

/** Track who is offline (and since when) and whether enough players remain. */
function syncPresence(s: ImpostorState, ctx: GameCtx): boolean {
  const now = ctx.now();
  let changed = false;
  let online = 0;
  s.ids.forEach((id, i) => {
    if (isOnline(ctx, id)) {
      online += 1;
      if (s.awaySince[i]) {
        s.awaySince[i] = 0;
        changed = true;
      }
    } else if (!s.awaySince[i]) {
      s.awaySince[i] = now;
      changed = true;
    }
  });
  if (online < MIN_PLAYERS) {
    if (s.shortSince === null) {
      s.shortSince = now;
      changed = true;
    }
  } else if (s.shortSince !== null) {
    s.shortSince = null;
    changed = true;
  }
  return changed;
}

// ---------- actions ----------

function giveClue(s: ImpostorState, seat: number, text: unknown, ctx: GameCtx) {
  if (s.phase !== "clues" || currentSeat(s) !== seat) return false;
  const me = s.ids[seat];
  if (typeof text !== "string") return rejectText(ctx, me, "Type a one-word clue.");
  if (text.length > MAX_RAW) return rejectText(ctx, me, `One word, ${MAX_CLUE} characters max.`);
  const earlier = s.clues.flatMap((c) => (c.text === null ? [] : [c.text]));
  const problem = clueProblem(text, wordOf(s, seat), earlier);
  if (problem) return rejectText(ctx, me, problem);
  endTurn(s, ctx, cleanText(text), "clue");
  return true;
}

function castVote(s: ImpostorState, seat: number, target: unknown, ctx: GameCtx) {
  if (s.phase !== "vote" || typeof target !== "string") return false;
  const t = s.ids.indexOf(target);
  if (t < 0 || t === seat || s.votes[seat] === t) return false;
  s.votes[seat] = t;
  syncSettle(s, ctx);
  return true;
}

function makeGuess(s: ImpostorState, seat: number, text: unknown, ctx: GameCtx) {
  if (s.phase !== "lastGuess" || seat !== s.oddSeat) return false;
  const me = s.ids[seat];
  if (typeof text !== "string") return rejectText(ctx, me, "Type your guess.");
  if (text.length > MAX_RAW) return rejectText(ctx, me, "That guess is far too long.");
  const problem = guessProblem(text);
  if (problem) return rejectText(ctx, me, problem);
  resolveGuess(s, ctx, cleanText(text));
  return true;
}

export const impostor: GameDef<ImpostorState, ImpostorAction> = {
  id: "impostor",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const s: ImpostorState = {
      ids,
      totalRounds: Math.min(MAX_ROUNDS, ids.length),
      round: 0,
      phase: "clues",
      endsAt: 0,
      scores: ids.map(() => 0),
      usedPairs: [],
      wasOdd: ids.map(() => false),
      majorityWord: "",
      oddWord: "",
      oddSeat: 0,
      order: [],
      turn: 0,
      clues: [],
      votes: ids.map(() => -1),
      settleAt: null,
      caughtSeat: -1,
      guess: null,
      history: [],
      awaySince: ids.map(() => 0),
      shortSince: null,
      endedEarly: false,
    };
    syncPresence(s, ctx);
    startRound(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.phase === "final") return false;
    const seat = s.ids.indexOf(playerId);
    if (seat < 0) return false;
    const a: unknown = action;
    if (!a || typeof a !== "object" || Array.isArray(a)) return false;
    const { type } = a as { type?: unknown };
    if (type === "clue") return giveClue(s, seat, (a as { text?: unknown }).text, ctx);
    if (type === "vote") return castVote(s, seat, (a as { target?: unknown }).target, ctx);
    if (type === "guess") return makeGuess(s, seat, (a as { text?: unknown }).text, ctx);
    return false;
  },

  tick(s, ctx) {
    if (s.phase === "final") return false;
    const now = ctx.now();
    let changed = syncPresence(s, ctx);
    if (s.shortSince !== null && now - s.shortSince >= SHORT_GRACE_MS) {
      endGame(s, ctx, true);
      return true;
    }
    switch (s.phase) {
      case "clues": {
        const seat = currentSeat(s);
        if (seat < 0) {
          beginTurn(s, ctx); // defensive: never sit on a finished lap
          return true;
        }
        if (!isOnline(ctx, s.ids[seat])) {
          endTurn(s, ctx, null, "away");
          return true;
        }
        if (now >= s.endsAt) {
          endTurn(s, ctx, null, "pass");
          return true;
        }
        break;
      }
      case "vote":
        if (syncSettle(s, ctx)) changed = true;
        if (now >= voteDeadline(s)) {
          resolveVote(s, ctx);
          return true;
        }
        break;
      case "lastGuess":
        if (now >= guessDeadline(s)) {
          resolveGuess(s, ctx, null);
          return true;
        }
        break;
      case "reveal":
        if (now >= s.endsAt) {
          if (s.round >= s.totalRounds) endGame(s, ctx, false);
          else startRound(s, ctx);
          return true;
        }
        break;
    }
    return changed;
  },
  tickMs: 250,

  view(s, viewerId): ImpostorView {
    const seat = s.ids.indexOf(viewerId);
    const cur = currentSeat(s);
    const vote = s.phase === "vote";
    const myVote = seat >= 0 && (vote || s.phase === "lastGuess") ? s.votes[seat] : -1;
    return {
      phase: s.phase,
      round: s.round,
      totalRounds: s.totalRounds,
      endsAt: deadline(s),
      order: s.order.map((i) => s.ids[i]),
      turn: s.turn,
      currentId: cur >= 0 ? s.ids[cur] : null,
      clues: s.clues,
      myWord: seat >= 0 ? wordOf(s, seat) : null,
      voted: vote ? s.ids.filter((_, i) => s.votes[i] >= 0) : [],
      allVoted: vote && s.settleAt !== null,
      myVote: myVote >= 0 ? s.ids[myVote] : null,
      caughtId: s.phase === "lastGuess" && s.caughtSeat >= 0 ? s.ids[s.caughtSeat] : null,
      scores: scoreRecord(s, s.scores),
      history: s.history,
      shortUntil: s.shortSince === null ? null : s.shortSince + SHORT_GRACE_MS,
      endedEarly: s.endedEarly,
    };
  },

  playerLeft(s, playerId, ctx) {
    if (s.phase === "final") return;
    syncPresence(s, ctx);
    const seat = s.ids.indexOf(playerId);
    if (seat < 0) return;
    if (s.phase === "clues" && currentSeat(s) === seat && !isOnline(ctx, playerId)) {
      endTurn(s, ctx, null, "away");
    } else if (s.phase === "vote") {
      syncSettle(s, ctx);
    }
  },

  playerReturned(s, _playerId, ctx) {
    if (s.phase === "final") return;
    syncPresence(s, ctx);
    syncSettle(s, ctx);
  },
};

export default impostor;
