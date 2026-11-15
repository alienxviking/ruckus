import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { FACTS, type Fact } from "./data";
import {
  CLOSE_MESSAGE,
  HOLD_MS,
  MAX_LIE,
  MAX_RAW,
  MIN_OPTIONS,
  MIN_PLAYERS,
  PICK_MS,
  POINTS,
  REVEAL_CAP_MS,
  ROUNDS,
  SHORT_GRACE_MS,
  STEP_MS,
  TRUTH_MESSAGE,
  WRITE_MS,
  cleanLie,
  displayText,
  formatPoints,
  lieProblem,
  normalize,
  sameText,
  truthMatch,
} from "./shared";

// Fib Finder: everyone sees a strange-but-true fact with a blank, writes a believable
// fake answer, then hunts for the real one among everybody's fibs. Six rounds.
//
// Per-player data lives in arrays indexed by seat (position in `ids`), so player ids
// are never used as object keys in state.

export type Phase = "write" | "pick" | "reveal" | "final";
export type OptionKind = "truth" | "lie" | "house";

interface OptionState {
  /** Display text (Title Case, so the truth never stands out). */
  text: string;
  /** Normalized form, for merging identical fibs. */
  norm: string;
  kind: OptionKind;
  /** Seats of the players who wrote this fib (several when identical fibs merged). */
  authors: number[];
}

/** One option as revealed after the pick. */
export interface RevealOption {
  text: string;
  kind: OptionKind;
  authors: string[];
  pickers: string[];
}

export interface RoundSummary {
  round: number;
  prompt: string;
  /** The answer as written in the fact (natural case), for filling in the blank. */
  answer: string;
  /** Every option, in the shuffled order the players saw. */
  options: RevealOption[];
  /** Reveal order (indices into `options`): picked house fibs, picked player fibs (least fooled first), then the truth. */
  steps: number[];
  points: Record<string, number>;
}

export interface Award {
  ids: string[];
  count: number;
}

export interface Awards {
  /** Most players fooled over the game. */
  liar: Award;
  /** Most truths found. */
  detector: Award;
}

export interface FibState {
  ids: string[];
  /** FACTS indices for each round. */
  factOrder: number[];
  totalRounds: number;
  round: number;
  phase: Phase;
  /** Deadline of the current phase (absolute server time). */
  endsAt: number;
  scores: number[];
  /** Seat -> this round's fib (cleaned), null when none yet. */
  lies: (string | null)[];
  /** The pick options (built when the pick starts). */
  options: OptionState[];
  /** Seat -> picked option index, -1 = none. */
  picks: number[];
  /** When the reveal walk-through started, and how long each step lasts. */
  revealAt: number;
  stepMs: number;
  history: RoundSummary[];
  /** When fewer than MIN_PLAYERS were last seen connected. */
  shortSince: number | null;
  endedEarly: boolean;
  awards: Awards | null;
}

export type FibAction = { type: "lie"; text: string } | { type: "pick"; option: number };

/** Private event: a fib was refused (`truth` when it matched the real answer). */
export interface FibErrorEvent {
  type: "fib-error";
  message: string;
  truth: boolean;
}

export interface FibOptionView {
  /** Stable id for this round (index in the shuffled option list). */
  id: number;
  text: string;
}

export interface FibView {
  phase: Phase;
  round: number;
  totalRounds: number;
  /** Deadline of the current phase (0 when final). */
  endsAt: number;
  /** The current fact, with a blank. Its answer only ever appears in `history`. */
  prompt: string;
  /** Write phase: who has a fib in (never what it says). */
  submitted: string[];
  /** The viewer's own fib this round (null for spectators). */
  myLie: string | null;
  /** Pick phase: the options this viewer may choose from (their own fib is left out). No authors, no truth flag. */
  options: FibOptionView[];
  /** Pick phase: who has picked (never what). */
  picked: string[];
  myPick: number | null;
  /** Reveal phase: walk-through clock for the last entry in `history`. */
  revealAt: number;
  stepMs: number;
  scores: Record<string, number>;
  /** Finished rounds, fully revealed. The current round joins at its reveal. */
  history: RoundSummary[];
  awards: Awards | null;
  /** When the game ends unless more players reconnect (null when enough are here). */
  shortUntil: number | null;
  endedEarly: boolean;
}

const isOnline = (ctx: GameCtx, id: string) => ctx.player(id)?.connected === true;

function scoreRecord(s: FibState, values: number[]): Record<string, number> {
  return Object.fromEntries(s.ids.map((id, i) => [id, values[i] ?? 0]));
}

function currentFact(s: FibState): Fact {
  const index = s.factOrder[Math.max(0, Math.min(s.factOrder.length - 1, s.round - 1))] ?? 0;
  return FACTS[index] ?? FACTS[0];
}

function answersOf(fact: Fact): string[] {
  return [fact.answer, ...(fact.alts ?? [])];
}

function reject(ctx: GameCtx, to: string, message: string, truth = false): false {
  ctx.emit({ type: "fib-error", message, truth } satisfies FibErrorEvent, { to });
  return false;
}

/** Everyone connected passes `done` (and at least one participant is connected). */
function everyoneIn(s: FibState, ctx: GameCtx, done: (seat: number) => boolean): boolean {
  let online = 0;
  for (let i = 0; i < s.ids.length; i++) {
    if (!isOnline(ctx, s.ids[i])) continue;
    online += 1;
    if (!done(i)) return false;
  }
  return online > 0;
}

// ---------- round flow ----------

function startRound(s: FibState, ctx: GameCtx) {
  s.round += 1;
  s.phase = "write";
  s.endsAt = ctx.now() + WRITE_MS;
  s.lies = s.ids.map(() => null);
  s.options = [];
  s.picks = s.ids.map(() => -1);
  s.revealAt = 0;
  s.stepMs = 0;
}

function buildOptions(s: FibState, ctx: GameCtx): OptionState[] {
  const fact = currentFact(s);
  const answers = answersOf(fact);
  const options: OptionState[] = [{ text: displayText(fact.answer), norm: normalize(fact.answer), kind: "truth", authors: [] }];
  const clashes = (norm: string) => options.some((o) => sameText(o.norm, norm));

  s.lies.forEach((lie, seat) => {
    if (lie === null) return;
    const norm = normalize(lie);
    // Never let a fib through that matches the truth (it was refused on submission anyway).
    if (!norm || truthMatch(lie, answers) === "exact") return;
    const same = options.find((o) => o.kind === "lie" && sameText(o.norm, norm));
    if (same) same.authors.push(seat);
    else if (!clashes(norm)) options.push({ text: displayText(lie), norm, kind: "lie", authors: [seat] });
  });

  for (const decoy of shuffle([...fact.decoys], () => ctx.random())) {
    if (options.length >= MIN_OPTIONS) break;
    const norm = normalize(decoy);
    if (norm && !clashes(norm) && !truthMatch(decoy, answers)) {
      options.push({ text: displayText(decoy), norm, kind: "house", authors: [] });
    }
  }
  return shuffle(options, () => ctx.random());
}

function startPick(s: FibState, ctx: GameCtx) {
  s.options = buildOptions(s, ctx);
  s.picks = s.ids.map(() => -1);
  s.phase = "pick";
  s.endsAt = ctx.now() + PICK_MS;
}

function resolvePick(s: FibState, ctx: GameCtx) {
  const fact = currentFact(s);
  const points = s.ids.map(() => 0);
  const pickers: number[][] = s.options.map(() => []);
  s.picks.forEach((option, seat) => {
    if (option >= 0 && option < s.options.length) pickers[option].push(seat);
  });
  s.options.forEach((o, i) => {
    for (const seat of pickers[i]) {
      if (o.kind === "truth") points[seat] += POINTS.truth;
      else if (o.kind === "lie") for (const author of o.authors) if (author !== seat) points[author] += POINTS.fooled;
    }
  });
  points.forEach((p, i) => (s.scores[i] += p));

  const rank = (i: number) => (s.options[i].kind === "house" ? 0 : 1);
  const picked = s.options
    .map((o, i) => i)
    .filter((i) => s.options[i].kind !== "truth" && pickers[i].length > 0)
    .sort((a, b) => rank(a) - rank(b) || pickers[a].length - pickers[b].length || a - b);
  const truthIndex = s.options.findIndex((o) => o.kind === "truth");
  const steps = [...picked, truthIndex];

  s.history.push({
    round: s.round,
    prompt: fact.prompt,
    answer: fact.answer,
    options: s.options.map((o, i) => ({
      text: o.text,
      kind: o.kind,
      authors: o.authors.map((seat) => s.ids[seat]),
      pickers: pickers[i].map((seat) => s.ids[seat]),
    })),
    steps,
    points: scoreRecord(s, points),
  });

  s.stepMs = Math.min(STEP_MS, Math.floor(REVEAL_CAP_MS / steps.length));
  s.revealAt = ctx.now();
  s.endsAt = s.revealAt + steps.length * s.stepMs + HOLD_MS;
  s.phase = "reveal";
}

/** Early end of the write / pick phase once everyone connected is done. */
function advanceIfDone(s: FibState, ctx: GameCtx): boolean {
  if (s.phase === "write" && everyoneIn(s, ctx, (i) => s.lies[i] !== null)) {
    startPick(s, ctx);
    return true;
  }
  if (s.phase === "pick" && everyoneIn(s, ctx, (i) => s.picks[i] >= 0)) {
    resolvePick(s, ctx);
    return true;
  }
  return false;
}

function computeAwards(s: FibState): Awards {
  const fooled = s.ids.map(() => 0);
  const found = s.ids.map(() => 0);
  for (const h of s.history) {
    for (const o of h.options) {
      if (o.kind === "lie") {
        for (const author of o.authors) {
          const seat = s.ids.indexOf(author);
          if (seat >= 0) fooled[seat] += o.pickers.length;
        }
      } else if (o.kind === "truth") {
        for (const picker of o.pickers) {
          const seat = s.ids.indexOf(picker);
          if (seat >= 0) found[seat] += 1;
        }
      }
    }
  }
  const best = (values: number[]): Award => {
    const count = Math.max(0, ...values);
    return { ids: count > 0 ? s.ids.filter((_, i) => values[i] === count) : [], count };
  };
  return { liar: best(fooled), detector: best(found) };
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function endGame(s: FibState, ctx: GameCtx, early: boolean) {
  if (s.phase === "final") return;
  // An unfinished round (write/pick) simply doesn't count.
  s.endedEarly = early && s.history.length < s.totalRounds;
  s.phase = "final";
  s.endsAt = 0;
  s.awards = computeAwards(s);

  const scores = scoreRecord(s, s.scores);
  const winners = topScorers(scores);
  const name = (id: string) => ctx.player(id)?.name ?? "Someone";
  const best = winners.length ? scores[winners[0]] : 0;
  const pts = `${formatPoints(best)} points`;
  const prefix = s.endedEarly ? "Ended early: " : "";
  let headline: string;
  if (!winners.length) {
    headline = s.endedEarly ? "Fib Finder ended early before anyone scored" : "Nobody scored a single point in Fib Finder";
  } else if (winners.length === 1) {
    headline = `${prefix}${name(winners[0])} wins Fib Finder with ${pts} 🤥`;
  } else {
    headline = `${prefix}${joinNames(winners.map(name))} tie for the win with ${pts}`;
  }
  ctx.end({ winners, headline, scores });
}

/** Track whether enough players remain connected. Returns true when that changed. */
function syncPresence(s: FibState, ctx: GameCtx): boolean {
  const online = s.ids.filter((id) => isOnline(ctx, id)).length;
  if (online < Math.min(MIN_PLAYERS, s.ids.length)) {
    if (s.shortSince === null) {
      s.shortSince = ctx.now();
      return true;
    }
  } else if (s.shortSince !== null) {
    s.shortSince = null;
    return true;
  }
  return false;
}

// ---------- actions ----------

function submitLie(s: FibState, seat: number, text: unknown, ctx: GameCtx): boolean {
  if (s.phase !== "write") return false;
  const me = s.ids[seat];
  if (typeof text !== "string") return reject(ctx, me, "Type a fib first.");
  if (text.length > MAX_RAW) return reject(ctx, me, `Keep it to ${MAX_LIE} characters.`);
  const problem = lieProblem(text);
  if (problem) return reject(ctx, me, problem);
  const clean = cleanLie(text);
  const match = truthMatch(clean, answersOf(currentFact(s)));
  if (match === "exact") return reject(ctx, me, TRUTH_MESSAGE, true);
  if (match === "close") return reject(ctx, me, CLOSE_MESSAGE, true);
  if (s.lies[seat] === clean) return false;
  s.lies[seat] = clean;
  advanceIfDone(s, ctx);
  return true;
}

function makePick(s: FibState, seat: number, option: unknown, ctx: GameCtx): boolean {
  if (s.phase !== "pick") return false;
  if (typeof option !== "number" || !Number.isInteger(option) || option < 0 || option >= s.options.length) return false;
  if (s.picks[seat] >= 0) return false; // picks are final
  if (s.options[option].authors.includes(seat)) return false; // can't pick your own fib
  s.picks[seat] = option;
  advanceIfDone(s, ctx);
  return true;
}

export const fib: GameDef<FibState, FibAction> = {
  id: "fib",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const factOrder = shuffle(
      FACTS.map((_, i) => i),
      () => ctx.random(),
    ).slice(0, ROUNDS);
    const s: FibState = {
      ids,
      factOrder,
      totalRounds: factOrder.length,
      round: 0,
      phase: "write",
      endsAt: 0,
      scores: ids.map(() => 0),
      lies: ids.map(() => null),
      options: [],
      picks: ids.map(() => -1),
      revealAt: 0,
      stepMs: 0,
      history: [],
      shortSince: null,
      endedEarly: false,
      awards: null,
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
    if (type === "lie") return submitLie(s, seat, (a as { text?: unknown }).text, ctx);
    if (type === "pick") return makePick(s, seat, (a as { option?: unknown }).option, ctx);
    return false;
  },

  tick(s, ctx) {
    if (s.phase === "final") return false;
    const now = ctx.now();
    const changed = syncPresence(s, ctx);
    if (s.shortSince !== null && now - s.shortSince >= SHORT_GRACE_MS) {
      endGame(s, ctx, true);
      return true;
    }
    switch (s.phase) {
      case "write":
        if (now >= s.endsAt) {
          startPick(s, ctx);
          return true;
        }
        break;
      case "pick":
        if (now >= s.endsAt) {
          resolvePick(s, ctx);
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
    // Defensive: covers anyone who dropped without a playerLeft call.
    if (advanceIfDone(s, ctx)) return true;
    return changed;
  },
  tickMs: 250,

  view(s, viewerId): FibView {
    const seat = s.ids.indexOf(viewerId);
    const pick = s.phase === "pick";
    return {
      phase: s.phase,
      round: s.round,
      totalRounds: s.totalRounds,
      endsAt: s.phase === "final" ? 0 : s.endsAt,
      prompt: currentFact(s).prompt,
      submitted: s.phase === "write" ? s.ids.filter((_, i) => s.lies[i] !== null) : [],
      myLie: seat >= 0 && s.phase !== "final" ? s.lies[seat] : null,
      options: pick
        ? s.options.flatMap((o, id) => (seat >= 0 && o.authors.includes(seat) ? [] : [{ id, text: o.text }]))
        : [],
      picked: pick ? s.ids.filter((_, i) => s.picks[i] >= 0) : [],
      myPick: pick && seat >= 0 && s.picks[seat] >= 0 ? s.picks[seat] : null,
      revealAt: s.phase === "reveal" ? s.revealAt : 0,
      stepMs: s.phase === "reveal" ? s.stepMs : 0,
      scores: scoreRecord(s, s.scores),
      history: s.history,
      awards: s.awards,
      shortUntil: s.shortSince === null || s.phase === "final" ? null : s.shortSince + SHORT_GRACE_MS,
      endedEarly: s.endedEarly,
    };
  },

  playerLeft(s, _playerId, ctx) {
    if (s.phase === "final") return;
    syncPresence(s, ctx);
    advanceIfDone(s, ctx);
  },

  playerReturned(s, _playerId, ctx) {
    if (s.phase === "final") return;
    syncPresence(s, ctx);
  },
};

export default fib;
