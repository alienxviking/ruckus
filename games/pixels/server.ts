import type { GameCtx, GameDef } from "../../shared/game";
import { shuffle, topScorers } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { TEAMS, splitTeams, teamOf } from "../../shared/teams";
import { pixelsBot } from "./bot";
import { config } from "./config";
import { EMBLEMS } from "./data";
import {
  COOLDOWN_MS,
  EMBLEM,
  EMBLEM_CELLS,
  MAX_BATCH,
  PAINTS,
  PAINT_MS,
  PERFECT_BONUS,
  INTRO_MS,
  REVEAL_MS,
  ROUNDS,
  SERVER_BURST,
  SPOTS_MS,
  bestMatch,
  boardSize,
  digits,
  type EmblemInfo,
  type Phase,
  type PixelsEvent,
} from "./shared";

// Canvas Clash (Ruckus original): one shared pixel board, a secret 5x5 emblem per
// player per round. Paint yours, deface theirs. When time runs out, each emblem's
// best copy anywhere on the board scores one point per matching pixel.
//
// Network: pixels never trigger a full view. Accepted pixels are coalesced into tiny
// "px" events (at most ~10 a second); the board string only rides in the view on
// phase changes and (re)joins. A revision counter lets clients drop stale boards and
// spot gaps, and refused pixels go back to their painter so optimistic paint can undo.

/** With fewer than two painters online for this long, the game ends. */
export const ABANDON_MS = 10_000;
/** Accepted pixels are broadcast at most this often (the tick sweeps up the rest). */
export const FLUSH_MS = 100;
/** One full-board resync per viewer per this long. */
const SYNC_GAP_MS = 1_000;
/** Emblems in one round share at most this many pixels at any offset. */
const OVERLAP_MAX = 10;

const PHASE_MS: Record<Phase, number> = {
  intro: INTRO_MS,
  paint: PAINT_MS,
  spots: SPOTS_MS,
  reveal: REVEAL_MS,
  final: 0,
};

export interface Spot {
  x: number;
  y: number;
  /** Matching pixels, 0-25. */
  n: number;
}

export interface RoundRecord {
  /** EMBLEMS index per player. */
  e: number[];
  n: number[];
  pts: number[];
}

export interface PixelsState {
  ids: string[];
  w: number;
  h: number;
  phase: Phase;
  round: number;
  endsAt: number;
  /** Colour index per cell (0 = blank), row-major. */
  board: number[];
  enc: string;
  encDirty: boolean;
  /** Bumped per accepted pixel (and per board wipe). */
  rev: number;
  /** Accepted pixels not broadcast yet: [painter, cell, colour, ...]. */
  buf: number[];
  lastFlush: number;
  /** EMBLEMS index per player for this round. Secret until the reveal. */
  emblems: number[];
  /** Per player, every emblem they've had (no repeats for a player). */
  had: number[][];
  /** Paint token bucket per player. */
  tokens: number[];
  tokAt: number[];
  /** Last full-board resync per viewer. */
  syncAt: Record<string, number>;
  spots: Spot[] | null;
  pts: number[] | null;
  totals: number[];
  history: RoundRecord[];
  /** Reveal: who tapped "next". */
  ready: boolean[];
  aloneSince: number | null;
  winners: string[] | null;
  endReason: "done" | "abandoned" | null;
  /** Host settings: rounds in the game and painting time per round. */
  rounds: number;
  paintMs: number;
  /** Red vs Blue: player ids per team (null in solo play). Teammates share one emblem. */
  teams: [string[], string[]] | null;
}

export type PixelsAction =
  /** Flat [cell, colour, ...], up to MAX_BATCH pixels. */
  | { type: "paint"; px: number[] }
  | { type: "next" }
  | { type: "sync" };

export interface RoundSummary {
  emblems: EmblemInfo[];
  n: number[];
  pts: number[];
}

export interface PixelsView {
  phase: Phase;
  round: number;
  rounds: number;
  w: number;
  h: number;
  endsAt: number;
  phaseMs: number;
  /** w*h digits, "0" blank, "1"-"8" paint. */
  board: string;
  rev: number;
  ids: string[];
  /** The viewer's player index, -1 for spectators. */
  you: number;
  /** The viewer's own emblem this round. */
  mine: EmblemInfo | null;
  /** Best spot per player [x, y, matches], from the end of painting on. */
  spots: [number, number, number][] | null;
  /** Everyone's emblems: only once revealed. */
  emblems: EmblemInfo[] | null;
  /** Round points per player: only once revealed. */
  pts: number[] | null;
  totals: number[];
  /** Every round, in the final standings only. */
  history: RoundSummary[] | null;
  /** Player indices who tapped "next" during the reveal. */
  ready: number[];
  abandonAt: number | null;
  winners: string[] | null;
  endReason: "done" | "abandoned" | null;
  /** Red vs Blue: player ids per team (null in solo play). Teammates share one emblem and score. */
  teams: [string[], string[]] | null;
}

// ---------- emblems ----------

const ARTS = EMBLEMS.map((e) => e.art);
let overlapCache: number[][] | null = null;

/** Most pixels emblem b gets for free from a lone copy of emblem a (any offset). */
function shiftedOverlap(a: string, b: string): number {
  let best = 0;
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      let m = 0;
      for (let j = 0; j < EMBLEM; j++) {
        const y = j + dy;
        if (y < 0 || y >= EMBLEM) continue;
        for (let i = 0; i < EMBLEM; i++) {
          const x = i + dx;
          if (x >= 0 && x < EMBLEM && a[y * EMBLEM + x] === b[j * EMBLEM + i]) m++;
        }
      }
      if (m > best) best = m;
    }
  }
  return best;
}

export function overlap(i: number, j: number): number {
  if (!overlapCache) {
    overlapCache = ARTS.map((a, x) =>
      ARTS.map((b, y) => (x === y ? EMBLEM_CELLS : Math.max(shiftedOverlap(a, b), shiftedOverlap(b, a)))),
    );
  }
  return overlapCache[i][j];
}

function info(i: number): EmblemInfo {
  const e = EMBLEMS[i];
  return { name: e.name, icon: e.icon, art: e.art };
}

/**
 * One emblem per player: all distinct, nobody gets one they've had, ideally nothing used
 * earlier in the game, and no two this round that would score off each other. Each rule
 * relaxes in turn if the catalogue can't satisfy it.
 */
export function pickEmblems(s: Pick<PixelsState, "ids" | "had" | "history">, random: () => number): number[] {
  const n = s.ids.length;
  const usedInGame = new Set(s.history.flatMap((r) => r.e));
  const all = EMBLEMS.map((_, i) => i);
  const tiers = [
    { limit: OVERLAP_MAX, fresh: true, own: true },
    { limit: OVERLAP_MAX, fresh: false, own: true },
    { limit: OVERLAP_MAX + 3, fresh: false, own: true },
    { limit: EMBLEM_CELLS, fresh: false, own: false },
  ];
  for (const tier of tiers) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const order = shuffle(all, random);
      const picks: number[] = [];
      for (let p = 0; p < n; p++) {
        const got = order.find(
          (e) =>
            !picks.includes(e) &&
            !(tier.own && s.had[p]?.includes(e)) &&
            !(tier.fresh && usedInGame.has(e)) &&
            picks.every((q) => overlap(e, q) <= tier.limit),
        );
        if (got === undefined) break;
        picks.push(got);
      }
      if (picks.length === n) return picks;
    }
  }
  return shuffle(all, random).slice(0, n);
}

// ---------- board ----------

export function encodeBoard(s: PixelsState): string {
  if (s.encDirty) {
    s.enc = s.board.join("");
    s.encDirty = false;
  }
  return s.enc;
}

/** Broadcast buffered pixels as one event. */
export function flush(s: PixelsState, ctx: GameCtx) {
  if (s.buf.length) {
    ctx.emit({ k: "px", r: s.rev, d: s.buf } satisfies PixelsEvent);
    s.buf = [];
  }
  s.lastFlush = ctx.now();
}

/** Team index per player (solo: -1 each). */
function teamIdx(s: Pick<PixelsState, "ids" | "teams">): number[] {
  return s.ids.map((id) => (s.teams ? teamOf(s.teams, id) : -1));
}

/** Team mode: one emblem per team, shared by its members (avoiding any a member has had). */
function pickTeamEmblems(s: PixelsState, random: () => number): number[] {
  const team = teamIdx(s);
  const had = [0, 1].map((t) => [...new Set(s.ids.flatMap((_, p) => (team[p] === t ? s.had[p] : [])))]);
  const two = pickEmblems({ ids: ["red", "blue"], had, history: s.history }, random);
  return team.map((t) => two[t]);
}

function startRound(s: PixelsState, ctx: GameCtx) {
  s.round += 1;
  s.board.fill(0);
  s.encDirty = true;
  s.rev += 1;
  s.buf = [];
  s.emblems = s.teams ? pickTeamEmblems(s, ctx.random) : pickEmblems(s, ctx.random);
  s.emblems.forEach((e, p) => s.had[p].push(e));
  s.spots = null;
  s.pts = null;
  s.ready = s.ids.map(() => false);
  s.phase = "intro";
  s.endsAt = ctx.now() + INTRO_MS;
}

/** Score the board: every player's best copy of their emblem. */
export function scoreRound(s: PixelsState) {
  s.spots = s.emblems.map((e) => bestMatch(s.board, s.w, s.h, digits(ARTS[e])));
  s.pts = s.spots.map((sp) => sp.n + (sp.n === EMBLEM_CELLS ? PERFECT_BONUS : 0));
  s.pts.forEach((p, i) => (s.totals[i] += p));
}

const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const nameOf = (ctx: GameCtx, id: string) => ctx.player(id)?.name ?? "Someone";

function scoresById(s: PixelsState): Record<string, number> {
  return Object.fromEntries(s.ids.map((id, i) => [id, s.totals[i]]));
}

/** Team totals (every member holds the team's score, so any member's total will do). */
export function teamTotals(s: Pick<PixelsState, "ids" | "teams" | "totals">): [number, number] {
  const team = teamIdx(s);
  const total = (t: number) => {
    const i = team.indexOf(t);
    return i < 0 ? 0 : s.totals[i];
  };
  return [total(0), total(1)];
}

function finishTeams(s: PixelsState, ctx: GameCtx, teams: [string[], string[]]) {
  const scores = scoresById(s);
  const [a, b] = teamTotals(s);
  let winners: string[];
  let headline: string;
  if (a === b) {
    winners = a > 0 ? [...s.ids] : [];
    headline = a > 0 ? `${TEAMS[0].name} and ${TEAMS[1].name} tie at ${a} points!` : "Canvas Clash ends on a blank canvas";
  } else {
    const w = a > b ? 0 : 1;
    winners = [...teams[w]];
    headline = `${TEAMS[w].name} team wins Canvas Clash, ${Math.max(a, b)} to ${Math.min(a, b)}!`;
  }
  s.winners = winners;
  ctx.end({ winners, headline, scores });
}

function finish(s: PixelsState, ctx: GameCtx) {
  s.phase = "final";
  s.endsAt = ctx.now();
  s.endReason = "done";
  if (s.teams) return finishTeams(s, ctx, s.teams);
  const scores = scoresById(s);
  const winners = topScorers(scores);
  s.winners = winners;
  const best = Math.max(0, ...s.totals);
  const names = winners.map((id) => nameOf(ctx, id));
  const headline =
    winners.length === 0
      ? "Canvas Clash ends on a blank canvas"
      : winners.length === 1
        ? `${names[0]} wins Canvas Clash with ${best} points`
        : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]} tie Canvas Clash at ${best}`;
  ctx.end({ winners, headline, scores });
}

function abandon(s: PixelsState, ctx: GameCtx) {
  flush(s, ctx);
  // A round that was already scored still counts in the standings.
  if (s.spots && s.pts && s.history.length < s.round) {
    s.history.push({ e: s.emblems.slice(), n: s.spots.map((sp) => sp.n), pts: s.pts.slice() });
  }
  s.phase = "final";
  s.endsAt = ctx.now();
  s.endReason = "abandoned";
  s.aloneSince = null;
  const here = s.ids.filter((id) => connected(ctx, id));
  if (s.teams && here.length) {
    // Whoever is left wins for their whole team.
    const t = teamOf(s.teams, here[0]);
    const winners = [...s.teams[t]];
    s.winners = winners;
    ctx.end({ winners, headline: `${TEAMS[t].name} team wins Canvas Clash — the others left`, scores: scoresById(s) });
    return;
  }
  s.winners = here;
  ctx.end({
    winners: here,
    headline: here.length
      ? `${nameOf(ctx, here[0])} wins Canvas Clash — everyone else left`
      : "Canvas Clash ended — everyone left",
    scores: scoresById(s),
  });
}

/** Move to the next phase (deadline reached, or everyone skipped the reveal). */
function advance(s: PixelsState, ctx: GameCtx) {
  const now = ctx.now();
  switch (s.phase) {
    case "intro":
      s.phase = "paint";
      s.endsAt = now + s.paintMs;
      s.tokens = s.ids.map(() => SERVER_BURST);
      s.tokAt = s.ids.map(() => now);
      break;
    case "paint":
      flush(s, ctx);
      scoreRound(s);
      s.phase = "spots";
      s.endsAt = now + SPOTS_MS;
      break;
    case "spots":
      s.phase = "reveal";
      s.endsAt = now + REVEAL_MS;
      s.ready = s.ids.map(() => false);
      break;
    case "reveal":
      s.history.push({ e: s.emblems.slice(), n: s.spots!.map((sp) => sp.n), pts: s.pts!.slice() });
      if (s.round >= s.rounds) finish(s, ctx);
      else startRound(s, ctx);
      break;
    case "final":
      break;
  }
}

/** Everyone still here has tapped "next". */
function allReady(s: PixelsState, ctx: GameCtx): boolean {
  const here = s.ids.map((id, i) => i).filter((i) => connected(ctx, s.ids[i]));
  return here.length > 0 && here.every((i) => s.ready[i]);
}

/** Track "fewer than two painters online". Returns true when that changed. */
function updateAlone(s: PixelsState, ctx: GameCtx): boolean {
  const here = s.ids.filter((id) => connected(ctx, id)).length;
  if (here < 2 && s.aloneSince === null) {
    s.aloneSince = ctx.now();
    return true;
  }
  if (here >= 2 && s.aloneSince !== null) {
    s.aloneSince = null;
    return true;
  }
  return false;
}

function sendBoard(s: PixelsState, viewer: string, ctx: GameCtx): false {
  const now = ctx.now();
  if (now - (s.syncAt[viewer] ?? -Infinity) < SYNC_GAP_MS) return false;
  s.syncAt[viewer] = now;
  ctx.emit({ k: "board", r: s.rev, b: encodeBoard(s) } satisfies PixelsEvent, { to: viewer });
  return false;
}

function paint(s: PixelsState, me: number, px: unknown, ctx: GameCtx): false {
  if (!Array.isArray(px) || px.length < 2 || px.length > MAX_BATCH * 2 || px.length % 2 !== 0) return false;
  const size = s.w * s.h;
  for (let i = 0; i < px.length; i += 2) {
    const cell = px[i];
    const color = px[i + 1];
    if (!Number.isInteger(cell) || cell < 0 || cell >= size) return false;
    if (!Number.isInteger(color) || color < 1 || color > PAINTS) return false;
  }
  const cells = px as number[];
  const now = ctx.now();
  const refused: number[] = [];
  if (s.phase !== "paint" || now >= s.endsAt) {
    for (let i = 0; i < cells.length; i += 2) refused.push(cells[i]);
  } else {
    s.tokens[me] = Math.min(SERVER_BURST, s.tokens[me] + Math.max(0, now - s.tokAt[me]) / COOLDOWN_MS);
    s.tokAt[me] = now;
    for (let i = 0; i < cells.length; i += 2) {
      if (s.tokens[me] < 1) {
        refused.push(cells[i]);
        continue;
      }
      s.tokens[me] -= 1;
      s.board[cells[i]] = cells[i + 1];
      s.rev += 1;
      s.buf.push(me, cells[i], cells[i + 1]);
    }
    if (s.buf.length) s.encDirty = true;
  }
  if (refused.length) ctx.emit({ k: "no", c: refused } satisfies PixelsEvent, { to: s.ids[me] });
  if (s.buf.length && now - s.lastFlush >= FLUSH_MS) flush(s, ctx);
  return false;
}

// ---------- the game ----------

export const pixels: GameDef<PixelsState, PixelsAction> = {
  id: "pixels",

  setup(ctx) {
    const set = readSettings(config.settings, ctx.settings);
    const ids = ctx.players.map((p) => p.id);
    const { w, h } = boardSize(ids.length);
    const s: PixelsState = {
      ids,
      w,
      h,
      phase: "intro",
      round: 0,
      endsAt: 0,
      board: new Array<number>(w * h).fill(0),
      enc: "",
      encDirty: true,
      rev: 0,
      buf: [],
      lastFlush: ctx.now(),
      emblems: [],
      had: ids.map(() => []),
      tokens: ids.map(() => SERVER_BURST),
      tokAt: ids.map(() => ctx.now()),
      syncAt: Object.create(null) as Record<string, number>,
      spots: null,
      pts: null,
      totals: ids.map(() => 0),
      history: [],
      ready: ids.map(() => false),
      aloneSince: null,
      winners: null,
      endReason: null,
      rounds: Number(set.rounds) || ROUNDS,
      paintMs: Number(set.paint) * 1000 || PAINT_MS,
      teams: set.mode === "teams" && ids.length >= 2 ? splitTeams(ids, ctx.random) : null,
    };
    startRound(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.phase === "final") return false;
    const me = s.ids.indexOf(playerId);
    if (me < 0 || !action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as { type?: unknown; px?: unknown };
    switch (a.type) {
      case "paint":
        return paint(s, me, a.px, ctx);
      case "sync":
        return sendBoard(s, playerId, ctx);
      case "next":
        if (s.phase !== "reveal" || s.ready[me]) return false;
        s.ready[me] = true;
        if (allReady(s, ctx)) {
          advance(s, ctx);
          return true;
        }
        ctx.emit({ k: "ready", i: me, round: s.round } satisfies PixelsEvent);
        return false;
      default:
        return false;
    }
  },

  spectatorAction(s, viewerId, action, ctx) {
    if (s.phase === "final" || !action || typeof action !== "object") return false;
    if ((action as { type?: unknown }).type !== "sync") return false;
    return sendBoard(s, viewerId, ctx);
  },

  tick(s, ctx) {
    if (s.phase === "final") return false;
    if (s.buf.length) flush(s, ctx);
    let changed = updateAlone(s, ctx);
    const now = ctx.now();
    if (s.aloneSince !== null && now >= s.aloneSince + ABANDON_MS) {
      abandon(s, ctx);
      return true;
    }
    if (now >= s.endsAt || (s.phase === "reveal" && allReady(s, ctx))) {
      advance(s, ctx);
      changed = true;
    }
    return changed;
  },
  tickMs: FLUSH_MS,

  bot(s, botId, ctx) {
    if (s.phase === "final") return null;
    return pixelsBot(s, pixels.view(s, botId, ctx) as PixelsView, ctx);
  },

  playerLeft(s, _id, ctx) {
    if (s.phase !== "final") updateAlone(s, ctx);
  },

  playerReturned(s, _id, ctx) {
    if (s.phase !== "final") updateAlone(s, ctx);
  },

  view(s, viewerId): PixelsView {
    const you = s.ids.indexOf(viewerId);
    const shown = s.phase === "reveal" || s.phase === "final";
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.rounds,
      w: s.w,
      h: s.h,
      endsAt: s.endsAt,
      phaseMs: s.phase === "paint" ? s.paintMs : PHASE_MS[s.phase],
      board: encodeBoard(s),
      rev: s.rev,
      ids: s.ids,
      you,
      mine: you >= 0 && s.emblems.length ? info(s.emblems[you]) : null,
      spots: s.spots ? s.spots.map((sp) => [sp.x, sp.y, sp.n]) : null,
      emblems: shown ? s.emblems.map(info) : null,
      pts: shown ? s.pts : null,
      totals: s.totals,
      history:
        s.phase === "final" ? s.history.map((r) => ({ emblems: r.e.map(info), n: r.n, pts: r.pts })) : null,
      ready: s.phase === "reveal" ? s.ready.flatMap((r, i) => (r ? [i] : [])) : [],
      abandonAt: s.aloneSince === null ? null : s.aloneSince + ABANDON_MS,
      winners: s.winners,
      endReason: s.endReason,
      teams: s.teams,
    };
  },
};

export default pixels;
