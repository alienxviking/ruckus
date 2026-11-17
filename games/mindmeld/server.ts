import type { GameCtx, GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  FIRST_ROUND_MS,
  MAX_ROUNDS,
  REVEAL_MS,
  ROUND_MS,
  bestRound,
  checkWord,
  meldWord,
  type EndReason,
  type MmEvent,
  type Phase,
  type RoundRecord,
} from "./shared";

// Mind Meld (co-op): everyone writes a word at the same time. Then everyone
// tries to write the word that links the previous round's words, until all
// the words match (a meld) or the rounds run out.

/**
 * Below this many participants present, the writing timer pauses. Present =
 * online, or offline with a word already in this round (that word still counts).
 */
const MIN_PRESENT = 2;
/** A meld needs at least this many matching words (one word alone isn't a meld). */
const MIN_MELD = 2;
/** How long a paused game waits for players to come back before giving up. */
export const WAIT_MS = 45_000;
/** The first resume in a round gets at least this much time back (later ones keep what was left). */
export const RESUME_MS = 15_000;
/** Raw submissions longer than this are junk; don't even clean them. */
const RAW_LIMIT = 200;

interface Sub {
  word: string;
  key: string;
  /** False while the player is editing a word they already locked in. */
  locked: boolean;
}

export interface MmState {
  /** Participant ids in seat order; per-player arrays below line up with it. */
  order: string[];
  phase: Phase;
  round: number;
  /** Rounds allowed before the game is lost (host setting). */
  maxRounds: number;
  /** Writing time for round 1 and for later rounds (host setting). */
  firstMs: number;
  roundMs: number;
  /** Deadline of the current writing/reveal phase (ignored while paused). */
  endsAt: number;
  /** Full length of the current phase, for timer bars. */
  phaseMs: number;
  /** Writing time left when the round was paused for missing players. */
  pausedLeft: number | null;
  /** While paused: the game ends at this time unless enough players return. */
  waitUntil: number | null;
  /** The RESUME_MS top-up was already given this round (so a flaky connection can't stretch it). */
  toppedUp: boolean;
  /** This round's secret submissions, by seat. */
  subs: (Sub | null)[];
  history: RoundRecord[];
  reason: EndReason | null;
}

export type MmAction = { type: "submit"; word: string } | { type: "unlock" };

export type LockState = "thinking" | "locked" | "editing";

export interface MmView {
  phase: Phase;
  round: number;
  maxRounds: number;
  /** Deadline of the running phase; null while paused or once the game is over. */
  endsAt: number | null;
  phaseMs: number;
  pausedLeft: number | null;
  waitUntil: number | null;
  /** Writing phase only: who has locked in. Never the words themselves. */
  locks: { id: string; state: LockState }[];
  /** The viewer's own submission this round (null for spectators). */
  me: { word: string | null; locked: boolean } | null;
  /** Every revealed round, oldest first. Public. */
  history: RoundRecord[];
  reason: EndReason | null;
}

const isOnline = (ctx: GameCtx, id: string) => ctx.player(id)?.connected === true;
const onlineCount = (s: MmState, ctx: GameCtx) => s.order.filter((id) => isOnline(ctx, id)).length;
const presentCount = (s: MmState, ctx: GameCtx) =>
  s.order.filter((id, i) => isOnline(ctx, id) || !!s.subs[i]).length;
/** Pause while too few minds are in play, or nobody at all is connected. */
const shouldPause = (s: MmState, ctx: GameCtx) => presentCount(s, ctx) < MIN_PRESENT || onlineCount(s, ctx) === 0;

function startRound(s: MmState, ctx: GameCtx) {
  const now = ctx.now();
  s.phase = "writing";
  s.phaseMs = s.round === 1 ? s.firstMs : s.roundMs;
  s.endsAt = now + s.phaseMs;
  s.subs = s.order.map(() => null);
  s.pausedLeft = null;
  s.waitUntil = null;
  s.toppedUp = false;
  if (shouldPause(s, ctx)) {
    s.pausedLeft = s.phaseMs;
    s.waitUntil = now + WAIT_MS;
  }
}

/** Every connected participant has a locked-in word. */
function everyoneLocked(s: MmState, ctx: GameCtx) {
  return s.order.every((id, i) => !isOnline(ctx, id) || s.subs[i]?.locked === true);
}

function reveal(s: MmState, ctx: GameCtx) {
  const raw = s.order.map((id, i) => {
    const sub = s.subs[i];
    return { id, word: sub?.word ?? null, key: sub?.key ?? null, away: !sub && !isOnline(ctx, id) };
  });

  // Group identical keys; biggest group first, ties by first appearance.
  const groups: { key: string; size: number; first: number }[] = [];
  raw.forEach((e, i) => {
    if (e.key === null) return;
    const g = groups.find((x) => x.key === e.key);
    if (g) g.size += 1;
    else groups.push({ key: e.key, size: 1, first: i });
  });
  groups.sort((a, b) => b.size - a.size || a.first - b.first);

  const sync = groups[0]?.size ?? 0;
  const total = raw.filter((e) => !e.away).length;
  s.history.push({
    round: s.round,
    entries: raw.map((e) => {
      const gi = e.key === null ? -1 : groups.findIndex((g) => g.key === e.key);
      const size = gi === -1 ? 0 : groups[gi].size;
      return { id: e.id, word: e.word, away: e.away, group: size >= 2 ? gi : -1, size };
    }),
    sync,
    total,
    melded: total >= MIN_MELD && sync === total,
  });

  s.subs = s.order.map(() => null);
  s.phase = "reveal";
  s.phaseMs = REVEAL_MS;
  s.endsAt = ctx.now() + REVEAL_MS;
  s.pausedLeft = null;
  s.waitUntil = null;
}

function finishReveal(s: MmState, ctx: GameCtx) {
  const last = s.history[s.history.length - 1];
  if (last?.melded) {
    s.phase = "melded";
    s.reason = "meld";
    const n = last.round;
    ctx.end({
      winners: [...s.order],
      headline: `Mind Meld in ${n} round${n === 1 ? "" : "s"} on “${meldWord(last)}”! 🧠`,
    });
  } else if (s.round >= s.maxRounds) {
    s.phase = "failed";
    s.reason = "rounds";
    const best = bestRound(s.history);
    ctx.end({
      winners: [],
      headline:
        best && best.sync >= 2
          ? `No meld this time... best was ${best.sync} of ${best.total} in sync`
          : "No meld this time...",
    });
  } else {
    s.round += 1;
    startRound(s, ctx);
  }
}

function abandon(s: MmState, ctx: GameCtx) {
  s.phase = "failed";
  s.reason = "players";
  s.pausedLeft = null;
  s.waitUntil = null;
  ctx.end({ winners: [], headline: "No meld this time... too many minds went offline 💤" });
}

/** Advance timers and early-reveal checks. Returns true when state changed. */
function step(s: MmState, ctx: GameCtx): boolean {
  const now = ctx.now();
  if (s.phase === "reveal") {
    if (now < s.endsAt) return false;
    finishReveal(s, ctx);
    return true;
  }
  if (s.phase !== "writing") return false;

  // Time ran out while the clock was running (e.g. someone dropped between the
  // deadline and the next tick): reveal rather than pausing an expired round.
  if (s.pausedLeft === null && now >= s.endsAt) {
    reveal(s, ctx);
    return true;
  }

  if (shouldPause(s, ctx)) {
    if (s.pausedLeft === null) {
      s.pausedLeft = Math.max(0, s.endsAt - now);
      s.waitUntil = now + WAIT_MS;
      return true;
    }
    if (now >= (s.waitUntil ?? now)) {
      abandon(s, ctx);
      return true;
    }
    return false;
  }

  let changed = false;
  if (s.pausedLeft !== null) {
    let left = s.pausedLeft;
    if (left < RESUME_MS && !s.toppedUp) {
      left = RESUME_MS;
      s.toppedUp = true;
    }
    s.endsAt = now + left;
    s.pausedLeft = null;
    s.waitUntil = null;
    changed = true;
  }
  if (now >= s.endsAt || everyoneLocked(s, ctx)) {
    reveal(s, ctx);
    return true;
  }
  return changed;
}

function lockState(sub: Sub | null): LockState {
  return !sub ? "thinking" : sub.locked ? "locked" : "editing";
}

export const mindmeld: GameDef<MmState, MmAction> = {
  id: "mindmeld",

  setup(ctx) {
    const settings = readSettings(config.settings, ctx.settings);
    const roundMs = (Number(settings.time) || ROUND_MS / 1000) * 1000;
    // Round 1 has nothing to link yet, so it is shorter: 40s by default.
    const firstMs = Math.round((roundMs * FIRST_ROUND_MS) / ROUND_MS);
    const s: MmState = {
      order: ctx.players.map((p) => p.id),
      phase: "writing",
      round: 1,
      maxRounds: Number(settings.rounds) || MAX_ROUNDS,
      firstMs,
      roundMs,
      endsAt: 0,
      phaseMs: firstMs,
      pausedLeft: null,
      waitUntil: null,
      toppedUp: false,
      subs: [],
      history: [],
      reason: null,
    };
    startRound(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.phase !== "writing") return false;
    const seat = s.order.indexOf(playerId);
    if (seat === -1) return false;
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as { type?: unknown; word?: unknown };

    if (a.type === "submit") {
      if (typeof a.word !== "string" || a.word.length > RAW_LIMIT) return false;
      const check = checkWord(a.word, s.history);
      if (!check.ok) {
        ctx.emit({ kind: "error", msg: check.msg } satisfies MmEvent, { to: playerId });
        return false;
      }
      const cur = s.subs[seat];
      if (cur?.locked && cur.word === check.word) return false;
      s.subs[seat] = { word: check.word, key: check.key, locked: true };
      step(s, ctx); // the last word in reveals everything
      return true;
    }

    if (a.type === "unlock") {
      const cur = s.subs[seat];
      if (!cur?.locked) return false;
      cur.locked = false;
      return true;
    }

    return false;
  },

  tick(s, ctx) {
    return step(s, ctx);
  },
  tickMs: 250,

  view(s, viewerId): MmView {
    const seat = s.order.indexOf(viewerId);
    const writing = s.phase === "writing";
    const mine = writing && seat !== -1 ? s.subs[seat] : null;
    return {
      phase: s.phase,
      round: s.round,
      maxRounds: s.maxRounds,
      endsAt: (writing && s.pausedLeft === null) || s.phase === "reveal" ? s.endsAt : null,
      phaseMs: s.phaseMs,
      pausedLeft: writing ? s.pausedLeft : null,
      waitUntil: writing ? s.waitUntil : null,
      locks: writing ? s.order.map((id, i) => ({ id, state: lockState(s.subs[i]) })) : [],
      me: seat === -1 ? null : { word: mine?.word ?? null, locked: mine?.locked ?? false },
      history: s.history,
      reason: s.reason,
    };
  },

  playerLeft(s, _playerId, ctx) {
    step(s, ctx);
  },

  playerReturned(s, _playerId, ctx) {
    step(s, ctx);
  },
};

export default mindmeld;
