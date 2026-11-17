import { pick, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import { FAKE_WORDS } from "./data";

// Quick Draw: wait for the signal, then tap faster than everyone else.
//
// Round flow: ready -> wait (-> fake -> wait) -> go -> result -> next round.
// The client never learns when the signal fires: the view has no timestamps
// at all before "go", and fake-outs are planned server-side. Clients time
// their own reaction from the frame that painted "DRAW!" and the server
// sanity-clamps it against its own clock.

export const TARGET = 5;
/** Fewer connected players than this pauses the game (and eventually ends it). */
const MIN_ACTIVE = 2;

export const TIMING = {
  readyMs: 2_000,
  waitMinMs: 1_500,
  waitMaxMs: 5_000,
  fakeChance: 0.3,
  fakeMs: 700,
  /** A fake-out shows this long into the wait... */
  fakeAfterMinMs: 1_000,
  fakeAfterMaxMs: 2_500,
  /** ...and the real signal follows this long after the fake ends (total stays within 2.5-5.0s). */
  postFakeMinMs: 800,
  postFakeMaxMs: 1_800,
  goWindowMs: 2_000,
  resultMs: 3_500,
  minRt: 100,
  rtSlackMs: 50,
  /** How long to wait for players to come back before ending the game. */
  awayGraceMs: 30_000,
  /** Rounds in a row with no taps at all before pausing. */
  idleRounds: 3,
  idleGraceMs: 90_000,
} as const;

export type Phase = "ready" | "wait" | "fake" | "go" | "result" | "paused" | "over";
/** "wait" = jumped the gun, "fake" = fell for a fake-out. */
export type FoulKind = "wait" | "fake";
export type PauseReason = "away" | "idle";
export type EndReason = "target" | "away" | "idle";

/** rt is the reaction time in ms measured by the client, or null when it tapped before it saw the signal. */
export type ReflexAction = { type: "tap"; round: number; rt: number | null };

interface Tap {
  rt: number | null;
  foul: FoulKind | null;
}

export interface RoundEntry {
  id: string;
  /** Valid reaction time in ms; null for fouls and no-draws. */
  rt: number | null;
  foul: FoulKind | null;
  win: boolean;
  /** Disconnected when the round ended (and never tapped). */
  away: boolean;
}

export interface RoundSummary {
  round: number;
  /** Fastest first, then no-draws, then fouls. */
  entries: RoundEntry[];
  winners: string[];
  /** The fake-out word shown this round, if there was one. */
  fakeText: string | null;
}

export interface ReflexState {
  /** Points needed to win (host setting). */
  target: number;
  /** Chance a round has a fake-out (host setting). */
  fakeChance: number;
  /** Random id for this match, so clients never confuse round N of one game with round N of the next. */
  game: string;
  ids: string[];
  scores: Record<string, number>;
  best: Record<string, number | null>;
  fouls: Record<string, number>;
  round: number;
  phase: Phase;
  /** Deadline of the current timed phase (ready, fake, go, result, paused). */
  endsAt: number;
  /** Secret: when the planned fake-out shows (wait only). */
  fakeAt: number | null;
  /** Secret: when the real signal fires (wait only; null while a fake is still to come). */
  goAt: number | null;
  /** Secret: delay from the end of the fake to the real signal. */
  postFakeMs: number;
  fakeText: string | null;
  /** When "go" was actually broadcast (reaction times are clamped against it). */
  signalAt: number | null;
  taps: Record<string, Tap>;
  last: RoundSummary | null;
  idleRounds: number;
  pauseReason: PauseReason | null;
  endReason: EndReason | null;
  winners: string[];
}

export interface ReflexView {
  game: string;
  phase: Phase;
  round: number;
  target: number;
  ids: string[];
  scores: Record<string, number>;
  best: Record<string, number | null>;
  fouls: Record<string, number>;
  /** Who has already tapped this round ("drew") or fouled. Times stay hidden until the result. */
  live: Record<string, "drew" | "foul">;
  /** Only set during the "fake" phase. */
  fakeText: string | null;
  /** Countdown for the "result" and "paused" phases only. Never set before the signal. */
  timer: { endsAt: number; total: number } | null;
  pauseReason: PauseReason | null;
  /** The viewer's own tap this round (null for spectators). */
  you: { status: "none" | "drew" | "foul"; rt: number | null; foul: FoulKind | null } | null;
  /** Last resolved round, shown during "result" and "over". */
  last: RoundSummary | null;
  endReason: EndReason | null;
  winners: string[];
}

/** Null-prototype record: player ids come from clients, so "__proto__" or "constructor" must stay plain keys. */
function dict<T>(ids: readonly string[] = [], init?: T): Record<string, T> {
  const d = Object.create(null) as Record<string, T>;
  if (init !== undefined) for (const id of ids) d[id] = init;
  return d;
}

const online = (ctx: GameCtx, id: string) => ctx.player(id)?.connected === true;
const onlineIds = (s: ReflexState, ctx: GameCtx) => s.ids.filter((id) => online(ctx, id));
const between = (ctx: GameCtx, lo: number, hi: number) => lo + ctx.random() * (hi - lo);
const nameOf = (ctx: GameCtx, id: string) => ctx.player(id)?.name ?? "Someone";

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function clearRound(s: ReflexState) {
  s.taps = dict();
  s.fakeAt = null;
  s.goAt = null;
  s.fakeText = null;
  s.signalAt = null;
}

function pause(s: ReflexState, ctx: GameCtx, reason: PauseReason) {
  clearRound(s);
  s.phase = "paused";
  s.pauseReason = reason;
  s.endsAt = ctx.now() + (reason === "away" ? TIMING.awayGraceMs : TIMING.idleGraceMs);
  if (reason === "away") s.idleRounds = 0;
}

function startRound(s: ReflexState, ctx: GameCtx) {
  if (onlineIds(s, ctx).length < MIN_ACTIVE) return pause(s, ctx, "away");
  if (s.idleRounds >= TIMING.idleRounds) return pause(s, ctx, "idle");
  clearRound(s);
  s.round += 1;
  s.phase = "ready";
  s.pauseReason = null;
  s.endsAt = ctx.now() + TIMING.readyMs;
}

function enterWait(s: ReflexState, ctx: GameCtx) {
  const now = ctx.now();
  s.phase = "wait";
  if (ctx.random() < s.fakeChance) {
    s.fakeAt = now + between(ctx, TIMING.fakeAfterMinMs, TIMING.fakeAfterMaxMs);
    s.postFakeMs = between(ctx, TIMING.postFakeMinMs, TIMING.postFakeMaxMs);
    s.goAt = null;
  } else {
    s.fakeAt = null;
    s.goAt = now + between(ctx, TIMING.waitMinMs, TIMING.waitMaxMs);
  }
}

function enterFake(s: ReflexState, ctx: GameCtx) {
  s.phase = "fake";
  s.fakeAt = null;
  s.fakeText = pick(FAKE_WORDS, ctx.random);
  s.endsAt = ctx.now() + TIMING.fakeMs;
}

function endFake(s: ReflexState, ctx: GameCtx) {
  s.phase = "wait";
  // Scheduled from the moment the fake actually ended, so a slow tick can never
  // merge the fake straight into the real signal.
  s.goAt = ctx.now() + s.postFakeMs;
}

function enterGo(s: ReflexState, ctx: GameCtx) {
  s.phase = "go";
  s.goAt = null;
  s.signalAt = ctx.now();
  s.endsAt = s.signalAt + TIMING.goWindowMs;
}

function resolve(s: ReflexState, ctx: GameCtx) {
  const entries: RoundEntry[] = s.ids.map((id) => {
    const tap = s.taps[id];
    return {
      id,
      rt: tap && !tap.foul ? tap.rt : null,
      foul: tap?.foul ?? null,
      win: false,
      away: !tap && !online(ctx, id),
    };
  });
  let fastest = Infinity;
  for (const e of entries) if (e.rt !== null && e.rt < fastest) fastest = e.rt;
  for (const e of entries) e.win = e.rt !== null && e.rt === fastest;

  const order = (e: RoundEntry) => (e.rt !== null ? 0 : e.foul ? 2 : 1);
  entries.sort(
    (a, b) => order(a) - order(b) || (a.rt ?? 0) - (b.rt ?? 0) || s.ids.indexOf(a.id) - s.ids.indexOf(b.id),
  );

  const winners = entries.filter((e) => e.win).map((e) => e.id);
  for (const id of winners) s.scores[id] += 1;
  for (const e of entries) {
    if (e.rt !== null) {
      const prev = s.best[e.id];
      s.best[e.id] = prev === null || e.rt < prev ? e.rt : prev;
    }
    if (e.foul) s.fouls[e.id] += 1;
  }
  s.idleRounds = Object.keys(s.taps).length === 0 ? s.idleRounds + 1 : 0;
  s.last = { round: s.round, entries, winners, fakeText: s.fakeText };

  if (winners.some((id) => s.scores[id] >= s.target)) return finish(s, ctx, "target");
  s.phase = "result";
  s.endsAt = ctx.now() + TIMING.resultMs;
}

function finish(s: ReflexState, ctx: GameCtx, reason: EndReason) {
  s.phase = "over";
  s.endReason = reason;
  s.pauseReason = null;
  s.fakeAt = null;
  s.goAt = null;

  let winners = topScorers(s.scores);
  let headline: string;
  if (reason === "target") {
    const top = s.scores[winners[0]];
    const names = joinNames(winners.map((id) => nameOf(ctx, id)));
    if (winners.length === 1) {
      const runnerUp = Math.max(0, ...s.ids.filter((id) => id !== winners[0]).map((id) => s.scores[id]));
      const best = s.best[winners[0]];
      headline = `${names} wins Quick Draw ${top}–${runnerUp}` + (best !== null ? ` · best ${best} ms` : "");
    } else {
      headline = `Dead heat! ${names} tie at ${top}`;
    }
  } else if (reason === "away") {
    const here = onlineIds(s, ctx);
    if (here.length > 0) {
      // Whoever stuck around takes it.
      winners = here;
      headline = `${joinNames(here.map((id) => nameOf(ctx, id)))} wins by default · everyone else left`;
    } else {
      headline = winners.length
        ? `Everyone left · ${joinNames(winners.map((id) => nameOf(ctx, id)))} led with ${s.scores[winners[0]]}`
        : "Everyone left · no winner";
    }
  } else {
    headline = winners.length
      ? `Everyone holstered · ${joinNames(winners.map((id) => nameOf(ctx, id)))} led with ${s.scores[winners[0]]}`
      : "Everyone holstered · no winner";
  }
  s.winners = winners;
  ctx.end({ winners, headline, scores: Object.fromEntries(s.ids.map((id) => [id, s.scores[id]])) });
}

/** One time- or presence-driven transition. Returns true when something changed. */
function advanceOnce(s: ReflexState, ctx: GameCtx): boolean {
  const now = ctx.now();
  switch (s.phase) {
    case "ready":
    case "wait":
    case "fake": {
      const here = onlineIds(s, ctx);
      if (here.length < MIN_ACTIVE) {
        // Not enough people to race: void the round rather than hand out a free point.
        pause(s, ctx, "away");
        return true;
      }
      if (s.phase === "ready") {
        if (now < s.endsAt) return false;
        enterWait(s, ctx);
        return true;
      }
      if (here.every((id) => s.taps[id])) {
        // Everyone still here already fouled: no point waiting for the signal.
        resolve(s, ctx);
        return true;
      }
      if (s.phase === "fake") {
        if (now < s.endsAt) return false;
        endFake(s, ctx);
        return true;
      }
      if (s.fakeAt !== null && now >= s.fakeAt) {
        enterFake(s, ctx);
        return true;
      }
      if (s.goAt !== null && now >= s.goAt) {
        enterGo(s, ctx);
        return true;
      }
      return false;
    }
    case "go": {
      const waiting = s.ids.some((id) => online(ctx, id) && !s.taps[id]);
      if (waiting && now < s.endsAt) return false;
      resolve(s, ctx);
      return true;
    }
    case "result":
      if (now < s.endsAt) return false;
      startRound(s, ctx);
      return true;
    case "paused":
      if (s.pauseReason === "away" && onlineIds(s, ctx).length >= MIN_ACTIVE) {
        startRound(s, ctx);
        return true;
      }
      if (now < s.endsAt) return false;
      finish(s, ctx, s.pauseReason ?? "away");
      return true;
    default:
      return false;
  }
}

function step(s: ReflexState, ctx: GameCtx): boolean {
  let changed = false;
  // Deadlines are set relative to "now", so this settles after a transition or two.
  for (let i = 0; i < 8 && advanceOnce(s, ctx); i++) changed = true;
  return changed;
}

/** Fake-out chance per round for each host choice ("some" is the classic rate). */
const FAKE_CHANCE: Record<string, number> = { off: 0, some: TIMING.fakeChance, lots: 0.55 };

// ---------- practice bot ----------

interface BotPlan {
  round: number;
  /** When the bot first saw the current phase, and which phase that was. */
  phase: Phase;
  seenAt: number;
  /** Reaction time it will tap with once it sees DRAW!. */
  rt: number;
  /** Whether it will fall for this round's fake-out. */
  bites: boolean;
}

const botPlans = new WeakMap<ReflexState, Map<string, BotPlan>>();

/**
 * A decent but human gunslinger: reacts in about 230-430 ms from when it sees DRAW!
 * (it only ever reads the public phase), and now and then bites on a fake-out.
 */
function botTap(s: ReflexState, botId: string, ctx: GameCtx): ReflexAction | null {
  if (!s.ids.includes(botId)) return null;
  let plans = botPlans.get(s);
  if (!plans) botPlans.set(s, (plans = new Map()));
  const now = ctx.now();
  let p = plans.get(botId);
  if (!p || p.round !== s.round) {
    p = { round: s.round, phase: s.phase, seenAt: now, rt: 0, bites: false };
    p.rt = Math.round(230 + ctx.random() * 200);
    p.bites = ctx.random() < 0.15;
    plans.set(botId, p);
  }
  if (p.phase !== s.phase) {
    p.phase = s.phase;
    p.seenAt = now;
  }
  if (s.phase === "paused" && s.pauseReason === "idle") {
    return now - p.seenAt > 1_500 ? { type: "tap", round: s.round, rt: null } : null;
  }
  if (s.taps[botId]) return null;
  if (s.phase === "fake" && p.bites && now - p.seenAt >= 250) return { type: "tap", round: s.round, rt: null };
  if (s.phase === "go" && now - p.seenAt >= p.rt) return { type: "tap", round: s.round, rt: p.rt };
  return null;
}

const game: GameDef<ReflexState, unknown> = {
  id: "reflex",

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const set = readSettings(config.settings, ctx.settings);
    const s: ReflexState = {
      target: Number(set.target) || TARGET,
      fakeChance: FAKE_CHANCE[String(set.fakes)] ?? TIMING.fakeChance,
      game: Math.floor(ctx.random() * 2 ** 32).toString(36),
      ids,
      scores: dict(ids, 0),
      best: dict<number | null>(ids, null),
      fouls: dict(ids, 0),
      round: 0,
      phase: "ready",
      endsAt: 0,
      fakeAt: null,
      goAt: null,
      postFakeMs: 0,
      fakeText: null,
      signalAt: null,
      taps: dict(),
      last: null,
      idleRounds: 0,
      pauseReason: null,
      endReason: null,
      winners: [],
    };
    startRound(s, ctx);
    return s;
  },

  action(s, playerId, raw, ctx) {
    if (s.phase === "over" || !s.ids.includes(playerId)) return false;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const a = raw as { type?: unknown; round?: unknown; rt?: unknown };
    if (a.type !== "tap" || !Number.isInteger(a.round) || a.round !== s.round) return false;
    const rt = a.rt ?? null;
    if (rt !== null && (typeof rt !== "number" || !Number.isFinite(rt))) return false;

    switch (s.phase) {
      case "paused":
        if (s.pauseReason !== "idle") return false;
        // Somebody's back at the table.
        s.idleRounds = 0;
        startRound(s, ctx);
        return true;
      case "wait":
      case "fake":
        if (s.taps[playerId]) return false;
        s.taps[playerId] = { rt: null, foul: s.phase };
        step(s, ctx);
        return true;
      case "go": {
        if (s.taps[playerId]) return false;
        if (rt === null) {
          // The client says it tapped before it had painted the signal: that's jumping the gun.
          s.taps[playerId] = { rt: null, foul: "wait" };
        } else {
          const sinceSignal = ctx.now() - (s.signalAt ?? ctx.now());
          const clamped = Math.max(TIMING.minRt, Math.min(rt, sinceSignal + TIMING.rtSlackMs));
          s.taps[playerId] = { rt: Math.round(clamped), foul: null };
        }
        step(s, ctx);
        return true;
      }
      default:
        // "ready" and "result": hands off, nothing to record.
        return false;
    }
  },

  tick(s, ctx) {
    return step(s, ctx);
  },

  bot(s, botId, ctx) {
    return botTap(s, botId, ctx);
  },
  tickMs: 50,

  view(s, viewerId): ReflexView {
    const inRound = s.phase === "wait" || s.phase === "fake" || s.phase === "go";
    const live: Record<string, "drew" | "foul"> = dict();
    if (inRound) for (const id of s.ids) if (s.taps[id]) live[id] = s.taps[id].foul ? "foul" : "drew";
    const playing = s.ids.includes(viewerId);
    const mine = playing && inRound ? s.taps[viewerId] : undefined;
    const timed = s.phase === "result" || s.phase === "paused";
    return {
      game: s.game,
      phase: s.phase,
      round: s.round,
      target: s.target,
      ids: s.ids,
      scores: s.scores,
      best: s.best,
      fouls: s.fouls,
      live,
      fakeText: s.phase === "fake" ? s.fakeText : null,
      timer: timed
        ? {
            endsAt: s.endsAt,
            total:
              s.phase === "result"
                ? TIMING.resultMs
                : s.pauseReason === "idle"
                  ? TIMING.idleGraceMs
                  : TIMING.awayGraceMs,
          }
        : null,
      pauseReason: s.phase === "paused" ? s.pauseReason : null,
      you: playing
        ? {
            status: mine ? (mine.foul ? "foul" : "drew") : "none",
            rt: mine && !mine.foul ? mine.rt : null,
            foul: mine?.foul ?? null,
          }
        : null,
      last: s.phase === "result" || s.phase === "over" ? s.last : null,
      endReason: s.endReason,
      winners: s.winners,
    };
  },

  playerLeft(s, _id, ctx) {
    step(s, ctx);
  },

  playerReturned(s, _id, ctx) {
    step(s, ctx);
  },
};

export default game;
