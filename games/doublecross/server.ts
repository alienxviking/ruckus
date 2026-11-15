import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import {
  AWAY_END_MS,
  CHOOSE_MS,
  DRUM_MS,
  HEIST_STAGGER_MS,
  HEIST_TALK_MS,
  HEIST_VERDICT_MS,
  KEEP_MSGS,
  QUICK,
  RESULT_MS,
  ROUNDS,
  SAY_BURST,
  SAY_WINDOW_MS,
  SIT_OUT_MS,
  TALK_MS,
  cleanText,
  heistPot,
  joinNames,
  plural,
  potFor,
  settle,
  tallies,
  type Choice,
  type DcAction,
  type DcEvent,
  type DcView,
  type Msg,
  type Phase,
  type RoundRec,
} from "./shared";

export type { DcAction, DcEvent, DcView } from "./shared";

// Double Cross: split or steal. Each round players sit at private tables (pairs,
// plus one trio when the count is odd), talk in a private chat, then secretly
// pick SPLIT or STEAL. Round 6 is the Heist: everyone at one table.
//
// Privacy: chat lines only ever go to the members of their table (ctx.emit with
// `to`, and the viewer's own table in view()). Choices live in `choice` and are
// only exposed to their owner until the flip, when the round joins `history`.

interface Table {
  seats: number[];
  pot: number;
  msgs: Msg[];
  count: number;
}

export interface DcState {
  order: string[];
  phase: Phase;
  round: number;
  /** Reveal: 0 = drumroll (still secret), 1 = flipped. */
  step: number;
  endsAt: number;
  phaseMs: number;
  tables: Table[];
  /** Table index per seat this round (-1 = sitting out). */
  seatTable: number[];
  sitting: number[];
  ready: boolean[];
  /** SECRET until the flip. */
  choice: (Choice | null)[];
  scores: number[];
  history: RoundRec[];
  /** How often two seats have shared a table (met[a][b]). */
  met: number[][];
  /** How often each seat has been in a trio. */
  trios: number[];
  /** When each seat went offline (null = online). */
  goneAt: (number | null)[];
  /** Since when fewer than two players have been online. */
  awaySince: number | null;
  /** Recent message times per seat (flood guard). */
  says: number[][];
  msgSeq: number;
  /** Bumped on every ready/lock event so clients can order events against views. */
  rev: number;
  endedEarly: boolean;
}

const seatsOf = (s: DcState) => s.order.map((_, i) => i);
const online = (s: DcState, ctx: GameCtx, seat: number) => ctx.player(s.order[seat])?.connected !== false;
const nameOf = (s: DcState, ctx: GameCtx, seat: number) => ctx.player(s.order[seat])?.name ?? "Someone";

/** Track who is away. Returns true when the "too few players" countdown started or stopped. */
function trackAway(s: DcState, ctx: GameCtx): boolean {
  const now = ctx.now();
  let up = 0;
  for (const seat of seatsOf(s)) {
    if (online(s, ctx, seat)) {
      up += 1;
      s.goneAt[seat] = null;
    } else if (s.goneAt[seat] === null) s.goneAt[seat] = now;
  }
  const short = up < 2;
  if (short && s.awaySince === null) {
    s.awaySince = now;
    return true;
  }
  if (!short && s.awaySince !== null) {
    s.awaySince = null;
    return true;
  }
  return false;
}

/** Seats that get dealt in: online, or only briefly away (a refresh shouldn't cost a round). */
function eligible(s: DcState, ctx: GameCtx): number[] {
  const now = ctx.now();
  return seatsOf(s).filter((seat) => {
    if (online(s, ctx, seat)) return true;
    const gone = s.goneAt[seat];
    return gone !== null && now - gone < SIT_OUT_MS;
  });
}

/**
 * Random tables of two (plus one trio for an odd count) that avoid repeat
 * pairings and repeat trio duty as much as possible.
 */
export function makeTables(seats: number[], met: number[][], trios: number[], random: () => number): number[][] {
  if (seats.length <= 3) return [shuffle(seats, random)];
  let best: number[][] = [];
  let bestCost = Infinity;
  for (let tries = 0; tries < 240 && bestCost > 0; tries++) {
    const sh = shuffle(seats, random);
    const groups: number[][] = [];
    let k = 0;
    if (sh.length % 2 === 1) {
      groups.push(sh.slice(0, 3));
      k = 3;
    }
    for (; k < sh.length; k += 2) groups.push(sh.slice(k, k + 2));
    let cost = 0;
    for (const g of groups) {
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) {
          const m = met[g[i]]?.[g[j]] ?? 0;
          cost += 10 * m * m;
        }
      }
      if (g.length === 3) for (const seat of g) cost += 3 * (trios[seat] ?? 0);
    }
    if (cost < bestCost) {
      best = groups;
      bestCost = cost;
    }
  }
  return best;
}

function startRound(s: DcState, ctx: GameCtx) {
  trackAway(s, ctx);
  if (s.round >= ROUNDS) return finish(s, ctx, false);
  const seats = eligible(s, ctx);
  if (seats.length < 2) return finish(s, ctx, true);
  s.round += 1;
  const heist = s.round === ROUNDS;
  const groups = heist ? [seats] : makeTables(seats, s.met, s.trios, ctx.random);
  s.tables = groups.map((g) => ({ seats: g, pot: heist ? heistPot(g.length) : potFor(s.round, g.length), msgs: [], count: 0 }));
  s.seatTable = s.order.map(() => -1);
  s.tables.forEach((t, i) => {
    for (const seat of t.seats) s.seatTable[seat] = i;
    if (heist) return;
    for (const a of t.seats) for (const b of t.seats) if (a !== b) s.met[a][b] += 1;
    if (t.seats.length === 3) for (const seat of t.seats) s.trios[seat] += 1;
  });
  s.sitting = seatsOf(s).filter((seat) => s.seatTable[seat] === -1);
  s.ready = s.order.map(() => false);
  s.choice = s.order.map(() => null);
  s.says = s.order.map(() => []);
  s.phase = "talk";
  s.step = 0;
  s.phaseMs = heist ? HEIST_TALK_MS : TALK_MS;
  s.endsAt = ctx.now() + s.phaseMs;
}

function startChoose(s: DcState, ctx: GameCtx) {
  s.phase = "choose";
  s.step = 0;
  s.phaseMs = CHOOSE_MS;
  s.endsAt = ctx.now() + CHOOSE_MS;
}

function startReveal(s: DcState, ctx: GameCtx) {
  s.phase = "reveal";
  s.step = 0;
  s.phaseMs = DRUM_MS;
  s.endsAt = ctx.now() + DRUM_MS;
}

/** How long the flipped cards stay up. The heist flips one card at a time. */
export function resultMs(heist: boolean, crew: number) {
  return heist ? crew * HEIST_STAGGER_MS + HEIST_VERDICT_MS + 3_800 : RESULT_MS;
}

/** The flip: choices become public, pots pay out. No choice = split. */
function flip(s: DcState, ctx: GameCtx) {
  const heist = s.round === ROUNDS;
  const rec: RoundRec = {
    round: s.round,
    heist,
    sitting: s.sitting.slice(),
    tables: s.tables.map((t) => {
      const c = t.seats.map((seat) => s.choice[seat] ?? "split");
      const auto = t.seats.map((seat) => s.choice[seat] === null);
      const { gain, out } = settle(c, t.pot);
      t.seats.forEach((seat, i) => (s.scores[seat] += gain[i]));
      return { seats: t.seats.slice(), pot: t.pot, c, auto, gain, out };
    }),
  };
  s.history.push(rec);
  s.choice = s.order.map(() => null);
  s.step = 1;
  s.phaseMs = resultMs(heist, s.tables[0]?.seats.length ?? 0);
  s.endsAt = ctx.now() + s.phaseMs;
}

function finish(s: DcState, ctx: GameCtx, early: boolean) {
  if (s.phase === "final") return;
  s.phase = "final";
  s.step = 1;
  s.endedEarly = early;
  s.awaySince = null;
  s.choice = s.order.map(() => null);
  const scores: Record<string, number> = Object.create(null);
  s.order.forEach((id, seat) => (scores[id] = s.scores[seat]));
  const winners = topScorers(scores);
  const prefix = early ? "Too few players left. " : "";
  let headline: string;
  if (!winners.length) headline = `${prefix}Nobody scored a single point. Trust is dead 💥`;
  else {
    const seats = winners.map((id) => s.order.indexOf(id));
    const pts = s.scores[seats[0]];
    const names = joinNames(seats.map((seat) => nameOf(s, ctx, seat)));
    if (seats.length > 1) headline = `${prefix}${names} share the win with ${plural(pts, "point")} each 🤝`;
    else {
      const clean = tallies(s.history, s.order.length)[seats[0]]?.steals === 0;
      headline = `${prefix}${names} wins Double Cross with ${plural(pts, "point")}${clean ? " and clean hands 😇" : " 🗡️"}`;
    }
  }
  ctx.end({ winners, headline, scores: { ...scores } });
}

/** Every online player at a table passes `done` (and at least one is online). */
function allSeated(s: DcState, ctx: GameCtx, done: (seat: number) => boolean): boolean {
  let any = false;
  for (const t of s.tables) {
    for (const seat of t.seats) {
      if (!online(s, ctx, seat)) continue;
      if (!done(seat)) return false;
      any = true;
    }
  }
  return any;
}

/** Timers, early advances and the away check. Returns true when players would see a change. */
function step(s: DcState, ctx: GameCtx): boolean {
  if (s.phase === "final") return false;
  const now = ctx.now();
  const changed = trackAway(s, ctx);
  if (s.awaySince !== null && now >= s.awaySince + AWAY_END_MS) {
    finish(s, ctx, true);
    return true;
  }
  if (s.phase === "talk") {
    if (now >= s.endsAt || allSeated(s, ctx, (seat) => s.ready[seat])) {
      startChoose(s, ctx);
      return true;
    }
  } else if (s.phase === "choose") {
    if (now >= s.endsAt || allSeated(s, ctx, (seat) => s.choice[seat] !== null)) {
      startReveal(s, ctx);
      return true;
    }
  } else if (now >= s.endsAt) {
    if (s.step === 0) flip(s, ctx);
    else startRound(s, ctx);
    return true;
  }
  return changed;
}

const isNonce = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 2 ** 31;

function say(s: DcState, seat: number, a: Record<string, unknown>, ctx: GameCtx): false {
  const id = s.order[seat];
  const n = isNonce(a.n) ? a.n : null;
  const reject = () => {
    if (n !== null) ctx.emit({ k: "nope", n } satisfies DcEvent, { to: id });
    return false as const;
  };
  if (s.phase !== "talk") return reject();
  const g = s.seatTable[seat];
  const table = s.tables[g];
  if (!table) return reject();

  const m: Msg = { i: 0, s: seat };
  if (a.q !== undefined) {
    if (typeof a.q !== "number" || !Number.isInteger(a.q) || a.q < 0 || a.q >= QUICK.length) return reject();
    m.q = a.q;
  } else {
    const text = cleanText(a.t);
    if (!text) return reject();
    m.t = text;
  }

  const now = ctx.now();
  const recent = s.says[seat].filter((t) => now - t < SAY_WINDOW_MS);
  if (recent.length >= SAY_BURST) {
    s.says[seat] = recent;
    return reject();
  }
  recent.push(now);
  s.says[seat] = recent;

  m.i = ++s.msgSeq;
  if (n !== null) m.n = n;
  table.msgs.push(m);
  if (table.msgs.length > KEEP_MSGS) table.msgs.splice(0, table.msgs.length - KEEP_MSGS);
  table.count += 1;
  // The words go to the table only; everyone else just sees the activity counter tick.
  for (const member of table.seats) ctx.emit({ k: "msg", r: s.round, g, m } satisfies DcEvent, { to: s.order[member] });
  ctx.emit({ k: "chat", r: s.round, g, c: table.count } satisfies DcEvent);
  return false;
}

export const doublecross: GameDef<DcState, DcAction> = {
  id: "doublecross",

  setup(ctx) {
    const n = ctx.players.length;
    const s: DcState = {
      order: ctx.players.map((p) => p.id),
      phase: "talk",
      round: 0,
      step: 0,
      endsAt: 0,
      phaseMs: 0,
      tables: [],
      seatTable: [],
      sitting: [],
      ready: [],
      choice: [],
      scores: Array.from({ length: n }, () => 0),
      history: [],
      met: Array.from({ length: n }, () => Array.from({ length: n }, () => 0)),
      trios: Array.from({ length: n }, () => 0),
      goneAt: Array.from({ length: n }, () => null),
      awaySince: null,
      says: [],
      msgSeq: 0,
      rev: 0,
      endedEarly: false,
    };
    startRound(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.phase === "final") return false;
    const seat = s.order.indexOf(playerId);
    if (seat === -1) return false;
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as Record<string, unknown>;

    if (a.type === "say") return say(s, seat, a, ctx);

    if (a.type === "ready") {
      if (s.phase !== "talk" || s.seatTable[seat] < 0) return false;
      if (typeof a.v !== "boolean" || s.ready[seat] === a.v) return false;
      s.ready[seat] = a.v;
      if (step(s, ctx)) return true; // the last one ready moves everyone to the choice
      // Otherwise just a tiny event, not a full view for everyone.
      ctx.emit({ k: "ready", r: s.round, s: seat, v: a.v, x: ++s.rev } satisfies DcEvent);
      return false;
    }

    if (a.type === "choose") {
      if (s.phase !== "choose" || s.seatTable[seat] < 0) return false;
      if (a.c !== "split" && a.c !== "steal") return false;
      const was = s.choice[seat];
      if (was === a.c) return false;
      s.choice[seat] = a.c;
      // What you picked is for your ears only; everyone else just learns that you locked in.
      ctx.emit({ k: "pick", r: s.round, c: a.c } satisfies DcEvent, { to: playerId });
      if (was !== null) return false;
      if (step(s, ctx)) return true; // the last lock flips the cards
      ctx.emit({ k: "lock", r: s.round, s: seat, x: ++s.rev } satisfies DcEvent);
      return false;
    }

    return false;
  },

  tick(s, ctx) {
    return step(s, ctx);
  },
  tickMs: 250,

  view(s, viewerId): DcView {
    const seat = s.order.indexOf(viewerId);
    const final = s.phase === "final";
    const g = seat >= 0 && !final ? (s.seatTable[seat] ?? -1) : -1;
    // Your own pick is yours to see; everyone else's waits for the flip.
    const ownChoice = s.phase === "choose" || (s.phase === "reveal" && s.step === 0);
    return {
      phase: s.phase,
      round: s.round,
      rounds: ROUNDS,
      heist: s.round === ROUNDS,
      step: s.step,
      endsAt: final ? null : s.endsAt,
      phaseMs: s.phaseMs,
      order: s.order,
      tables: final ? [] : s.tables.map((t) => ({ seats: t.seats, pot: t.pot })),
      sitting: final ? [] : s.sitting,
      ready: s.phase === "talk" ? s.ready : [],
      locked: s.phase === "choose" ? s.choice.map((c) => c !== null) : [],
      chatter: final ? [] : s.tables.map((t) => t.count),
      rev: s.rev,
      scores: s.scores,
      history: s.history,
      me:
        seat === -1
          ? null
          : {
              seat,
              table: g,
              msgs: g >= 0 ? s.tables[g].msgs : [],
              choice: ownChoice ? s.choice[seat] : null,
            },
      awayEndsAt: s.awaySince === null || final ? null : s.awaySince + AWAY_END_MS,
      endedEarly: s.endedEarly,
    };
  },

  playerLeft(s, playerId, ctx) {
    const seat = s.order.indexOf(playerId);
    if (seat >= 0 && s.goneAt[seat] === null) s.goneAt[seat] = ctx.now();
    step(s, ctx);
  },

  playerReturned(s, playerId, ctx) {
    const seat = s.order.indexOf(playerId);
    if (seat >= 0) s.goneAt[seat] = null;
    step(s, ctx);
  },
};

export default doublecross;
