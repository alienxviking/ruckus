import { shuffle, topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  AWAY_END_MS,
  CASTLES,
  DRAGON_EXTRA_MS,
  DRAGON_MAX,
  DRAGON_MIN,
  FIRST_PLAN_MS,
  INTRO_MS,
  LAST_SUMMARY_MS,
  PLAN_MS,
  ROUNDS,
  STEP_MS,
  SUMMARY_MS,
  TROOPS,
  VALUE_MAX,
  VALUE_MIN,
  evenSplit,
  parseAlloc,
  plural,
  type CastleOutcome,
  type Phase,
  type RoundRecord,
  type Source,
  type WlAction,
  type WlView,
} from "./shared";

export type { WlAction, WlView } from "./shared";

// Warlords: Colonel Blotto with a dragon. Each round everyone secretly splits
// 100 troops over five castles; the biggest army at each castle takes its
// points, and one hidden castle also needs an army bigger than its dragon.

/** Cosmetic castle names (public; the server just picks five per round). */
const CASTLE_NAMES = [
  "Stormkeep", "Ravenhold", "Emberfall", "Frostgate", "Duskwatch", "Ironcrag", "Mistvale", "Thornwall",
  "Goldspire", "Wolfden", "Highmoor", "Saltmarsh", "Ashford", "Briarwood", "Cinderholt", "Eaglecrest",
  "Foxhollow", "Glimmerkeep", "Hollowmere", "Kingsbridge", "Lionsrock", "Moonhaven", "Oakheart", "Pebbleton",
  "Rosewall", "Silverpeak", "Sunreach", "Tidewatch", "Umberhold", "Willowby", "Crowsnest", "Muffinkeep",
  "Puddington", "Snorehold", "Sockford", "Fort Crumpet", "Bogsworth", "Gravyport", "Pickleton", "Noodlegard",
];

export interface WlState {
  order: string[];
  phase: Phase;
  round: number;
  /** Rounds in this game (host setting). */
  rounds: number;
  /** Plan time for rounds 2+ (host setting); round 1 adds FIRST_PLAN_MS - PLAN_MS. */
  planMs: number;
  names: string[];
  values: number[];
  /** Secret until its castle is revealed. */
  dragon: { castle: number; strength: number };
  /** Plan deadline, or when the next reveal step happens. */
  endsAt: number;
  phaseMs: number;
  /** Plan phase: latest draft per seat (secret). */
  drafts: (number[] | null)[];
  locked: boolean[];
  /** Reveal progress, see RevealView.step. */
  step: number;
  /** Every resolved round; the last one is being revealed while phase === "reveal". */
  history: RoundRecord[];
  usedNames: string[];
  /** Since when fewer than two participants have been online. */
  awaySince: number | null;
  endedEarly: boolean;
}

const randInt = (ctx: GameCtx, lo: number, hi: number) => lo + Math.floor(ctx.random() * (hi - lo + 1));
const online = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const onlineCount = (s: WlState, ctx: GameCtx) => s.order.filter((id) => online(ctx, id)).length;

/** Five castle values in VALUE_MIN..VALUE_MAX with at least three distinct values. */
export function rollValues(ctx: GameCtx): number[] {
  for (let tries = 0; tries < 50; tries++) {
    const v = Array.from({ length: CASTLES }, () => randInt(ctx, VALUE_MIN, VALUE_MAX));
    if (new Set(v).size >= 3) return v;
  }
  return shuffle([3, 5, 7, 4, 9], ctx.random);
}

/**
 * Who takes a castle: the biggest army (it must be > 0, and strictly bigger than
 * the dragon if there is one). A tie at the top splits the points, rounded down,
 * at least 1 each. Nobody above the dragon = the dragon keeps it.
 */
export function resolveCastle(troops: readonly number[], value: number, dragon: number | null): CastleOutcome {
  const top = Math.max(0, ...troops);
  if (top <= 0 || (dragon !== null && top <= dragon)) return { winners: [], points: 0 };
  const winners: number[] = [];
  troops.forEach((t, seat) => {
    if (t === top) winners.push(seat);
  });
  return { winners, points: Math.max(1, Math.floor(value / winners.length)) };
}

/** Resolve a whole round from everyone's armies. */
export function resolveRound(
  round: number,
  names: string[],
  values: number[],
  alloc: number[][],
  src: Source[],
  dragon: { castle: number; strength: number },
): RoundRecord {
  const gained = alloc.map(() => 0);
  const castles = values.map((value, c) => {
    const out = resolveCastle(
      alloc.map((a) => a[c]),
      value,
      dragon.castle === c ? dragon.strength : null,
    );
    for (const w of out.winners) gained[w] += out.points;
    return out;
  });
  return { round, names, values, alloc, src, dragon, castles, gained };
}

function startPlan(s: WlState, ctx: GameCtx) {
  s.round += 1;
  s.phase = "plan";
  s.values = rollValues(ctx);
  const fresh = CASTLE_NAMES.filter((n) => !s.usedNames.includes(n));
  s.names = shuffle(fresh.length >= CASTLES ? fresh : CASTLE_NAMES, ctx.random).slice(0, CASTLES);
  s.usedNames.push(...s.names);
  s.dragon = { castle: randInt(ctx, 0, CASTLES - 1), strength: randInt(ctx, DRAGON_MIN, DRAGON_MAX) };
  s.drafts = s.order.map(() => null);
  s.locked = s.order.map(() => false);
  s.step = 0;
  s.phaseMs = s.round === 1 ? s.planMs + (FIRST_PLAN_MS - PLAN_MS) : s.planMs;
  s.endsAt = ctx.now() + s.phaseMs;
}

function startReveal(s: WlState, ctx: GameCtx) {
  const src: Source[] = [];
  const alloc = s.order.map((_, seat) => {
    const d = s.drafts[seat];
    src.push(!d ? "auto" : s.locked[seat] ? "lock" : "draft");
    return d ? d.slice() : evenSplit();
  });
  s.history.push(resolveRound(s.round, s.names, s.values, alloc, src, s.dragon));
  s.drafts = s.order.map(() => null);
  s.locked = s.order.map(() => false);
  s.phase = "reveal";
  s.step = 0;
  s.phaseMs = INTRO_MS;
  s.endsAt = ctx.now() + INTRO_MS;
}

/** Final totals per seat over every resolved round. */
const totals = (s: WlState) => s.order.map((_, seat) => s.history.reduce((t, r) => t + (r.gained[seat] ?? 0), 0));

function names(ids: string[], ctx: GameCtx) {
  const n = ids.map((id) => ctx.player(id)?.name ?? "Someone");
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

function finish(s: WlState, ctx: GameCtx, early: boolean) {
  s.phase = "final";
  s.endedEarly = early;
  s.step = CASTLES + 1;
  s.awaySince = null;
  const t = totals(s);
  const scores: Record<string, number> = {};
  s.order.forEach((id, seat) => (scores[id] = t[seat]));
  const winners = topScorers(scores);
  const prefix = early ? "Too few warlords left. " : "";
  let headline: string;
  if (!winners.length) headline = `${prefix}The dragons keep the realm: nobody scored 🐉`;
  else if (winners.length === 1)
    headline = `${prefix}${names(winners, ctx)} conquers the realm with ${plural(scores[winners[0]], "point")} 🏰`;
  else headline = `${prefix}${names(winners, ctx)} share the realm with ${plural(scores[winners[0]], "point")} each 🏰`;
  ctx.end({ winners, headline, scores });
}

/** Track whether enough warlords are online. Returns true when that changed what players see. */
function updateAway(s: WlState, ctx: GameCtx): boolean {
  const short = onlineCount(s, ctx) < 2;
  if (short && s.awaySince === null) {
    s.awaySince = ctx.now();
    return true;
  }
  if (!short && s.awaySince !== null) {
    s.awaySince = null;
    return true;
  }
  return false;
}

/** Every online warlord has locked in (and at least one is online). */
function everyoneLocked(s: WlState, ctx: GameCtx) {
  let any = false;
  for (let seat = 0; seat < s.order.length; seat++) {
    if (!online(ctx, s.order[seat])) continue;
    if (!s.locked[seat]) return false;
    any = true;
  }
  return any;
}

/** Advance timers and early-advance checks. Returns true when state changed. */
function step(s: WlState, ctx: GameCtx): boolean {
  if (s.phase === "final") return false;
  const now = ctx.now();
  const changed = updateAway(s, ctx);
  if (s.awaySince !== null && now >= s.awaySince + AWAY_END_MS) {
    finish(s, ctx, true);
    return true;
  }
  if (s.phase === "plan") {
    if (now >= s.endsAt || everyoneLocked(s, ctx)) {
      startReveal(s, ctx);
      return true;
    }
    return changed;
  }
  // Reveal: intro -> one castle per step -> summary -> next round / final.
  if (now < s.endsAt) return changed;
  if (s.step < CASTLES) {
    s.step += 1;
    s.phaseMs = STEP_MS + (s.dragon.castle === s.step - 1 ? DRAGON_EXTRA_MS : 0);
  } else if (s.step === CASTLES) {
    s.step += 1;
    s.phaseMs = s.round >= s.rounds ? LAST_SUMMARY_MS : SUMMARY_MS;
  } else {
    if (s.round >= s.rounds) finish(s, ctx, false);
    else startPlan(s, ctx);
    return true;
  }
  s.endsAt = now + s.phaseMs;
  return true;
}

// ---------- practice bot ----------

/** When each bot may lock in this round (keyed by state), so it "plans" like a person. */
const botReadyAt = new WeakMap<WlState, Map<string, { round: number; at: number }>>();

/**
 * Medium bot: commits to two to four of the more valuable castles (with some noise, so it
 * isn't predictable), spreads most troops over them by value and drops a few stray troops
 * elsewhere. It only uses what its view shows (castle values), never the dragon or others' plans.
 */
export function botPlan(values: readonly number[], random: () => number): number[] {
  const ranked = values
    .map((v, c) => ({ c, w: v * (0.7 + random() * 0.6) }))
    .sort((a, b) => b.w - a.w)
    .map((x) => x.c);
  const r = random();
  const k = r < 0.35 ? 2 : r < 0.8 ? 3 : 4;
  const chosen = ranked.slice(0, k);
  const alloc = values.map(() => 0);
  let left = TROOPS;
  for (const c of ranked.slice(k)) {
    if (random() < 0.5) {
      const n = Math.floor(random() * 5);
      alloc[c] = n;
      left -= n;
    }
  }
  const weights = chosen.map((c) => values[c] * (0.8 + random() * 0.4));
  const total = weights.reduce((t, w) => t + w, 0);
  let given = 0;
  chosen.forEach((c, i) => {
    const n = Math.floor((left * weights[i]) / total);
    alloc[c] = n;
    given += n;
  });
  alloc[chosen[0]] += left - given;
  return alloc;
}

function botMove(s: WlState, botId: string, ctx: GameCtx): WlAction | null {
  if (s.phase !== "plan") return null;
  const v = warlords.view(s, botId, ctx) as WlView;
  if (!v.me || v.me.locked) return null;
  let timers = botReadyAt.get(s);
  if (!timers) botReadyAt.set(s, (timers = new Map()));
  const now = ctx.now();
  const t = timers.get(botId);
  if (!t || t.round !== v.round) {
    // Think for a few seconds, but always lock well before the deadline.
    const think = Math.min(2_500 + ctx.random() * 6_000, Math.max(0, (v.endsAt ?? now) - now - 3_000));
    timers.set(botId, { round: v.round, at: now + think });
    return null;
  }
  if (now < t.at) return null;
  return { type: "lock", alloc: botPlan(v.values, ctx.random) };
}

export const warlords: GameDef<WlState, WlAction> = {
  id: "warlords",

  setup(ctx) {
    const set = readSettings(config.settings, ctx.settings);
    const s: WlState = {
      order: ctx.players.map((p) => p.id),
      phase: "plan",
      round: 0,
      rounds: Number(set.rounds) || ROUNDS,
      planMs: (Number(set.planSec) || PLAN_MS / 1000) * 1000,
      names: [],
      values: [],
      dragon: { castle: 0, strength: DRAGON_MIN },
      endsAt: 0,
      phaseMs: 0,
      drafts: [],
      locked: [],
      step: 0,
      history: [],
      usedNames: [],
      awaySince: null,
      endedEarly: false,
    };
    startPlan(s, ctx);
    updateAway(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.phase !== "plan") return false;
    const seat = s.order.indexOf(playerId);
    if (seat === -1) return false;
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as { type?: unknown; alloc?: unknown };

    if (a.type === "plan") {
      // Draft autosave: secret, so nobody else's view changes.
      if (s.locked[seat]) return false;
      const alloc = parseAlloc(a.alloc);
      if (!alloc) return false;
      s.drafts[seat] = alloc;
      return false;
    }

    if (a.type === "lock") {
      if (s.locked[seat]) return false;
      let alloc = s.drafts[seat];
      if (a.alloc !== undefined) {
        alloc = parseAlloc(a.alloc);
        if (!alloc) return false;
      }
      if (!alloc) return false;
      s.drafts[seat] = alloc;
      s.locked[seat] = true;
      step(s, ctx); // the last lock starts the battle
      return true;
    }

    if (a.type === "unlock") {
      if (!s.locked[seat]) return false;
      s.locked[seat] = false;
      return true;
    }

    return false;
  },

  tick(s, ctx) {
    return step(s, ctx);
  },

  bot(s, botId, ctx) {
    return botMove(s, botId, ctx);
  },
  tickMs: 200,

  view(s, viewerId): WlView {
    const seat = s.order.indexOf(viewerId);
    const plan = s.phase === "plan";
    const revealing = s.phase === "reveal";
    const cur = revealing ? s.history[s.history.length - 1] : null;
    const shown = cur ? Math.min(s.step, CASTLES) : 0;
    // The round being revealed joins the public history once every castle is out.
    const history = cur && shown < CASTLES ? s.history.slice(0, -1) : s.history;

    const scores = s.order.map((_, i) =>
      s.history.reduce((t, r) => {
        if (r !== cur) return t + r.gained[i];
        let part = 0;
        for (let c = 0; c < shown; c++) if (r.castles[c].winners.includes(i)) part += r.castles[c].points;
        return t + part;
      }, 0),
    );

    return {
      phase: s.phase,
      round: s.round,
      rounds: s.rounds,
      order: s.order,
      names: s.names,
      values: s.values,
      endsAt: s.phase === "final" ? null : s.endsAt,
      phaseMs: s.phaseMs,
      locked: plan ? s.locked : [],
      me:
        seat === -1
          ? null
          : {
              seat,
              draft: plan ? s.drafts[seat] : null,
              locked: plan ? s.locked[seat] : false,
              alloc: cur ? cur.alloc[seat] : null,
            },
      reveal: cur
        ? {
            step: s.step,
            castles: cur.castles.slice(0, shown).map((o, c) => ({
              troops: cur.alloc.map((a) => a[c]),
              winners: o.winners,
              points: o.points,
              dragon: cur.dragon.castle === c ? cur.dragon.strength : null,
            })),
            dragon: cur.dragon.castle < shown ? cur.dragon : null,
            src: cur.src,
            gained: s.step > CASTLES ? cur.gained : null,
          }
        : null,
      history,
      scores,
      awayEndsAt: s.awaySince === null ? null : s.awaySince + AWAY_END_MS,
      endedEarly: s.endedEarly,
    };
  },

  playerLeft(s, _id, ctx) {
    step(s, ctx);
  },

  playerReturned(s, _id, ctx) {
    step(s, ctx);
  },
};

export default warlords;
