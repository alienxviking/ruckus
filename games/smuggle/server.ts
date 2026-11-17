import type { GameCtx, GameDef } from "../../shared/game";
import { shuffle } from "../../shared/game";
import { customWords, readSettings } from "../../shared/settings";
import { TEAMS, splitTeams, teamOf } from "../../shared/teams";
import { config } from "./config";
import { CARDS } from "./data";
import {
  ABANDON_MS,
  BUZZ_COST,
  GOT_PTS,
  LOG_MAX,
  MIN_TEAM_TURNS,
  READY_MS,
  TURN_MS,
  type SmuggleAction,
  type SmuggleAward,
  type SmuggleEvent,
  type SmuggleLogEntry,
  type SmugglePhase,
  type SmuggleRole,
  type SmuggleTurnSummary,
  type SmuggleView,
} from "./shared";

// Word Smuggler: two teams alternate turns. The describer sees a secret word and five
// banned words and talks their team to it out loud (on the call). The other team sees the
// same card and buzzes if a banned word slips out. Got it +1, buzz -1, skip 0.
// Turns rotate through each team so everyone describes.

export interface SmuggleState {
  startedAt: number;
  ids: string[];
  teams: [string[], string[]];
  score: [number, number];
  phase: SmugglePhase;
  turn: number;
  totalTurns: number;
  /** Turns each team has taken (rotates the describer). */
  taken: [number, number];
  team: number;
  describer: string;
  endsAt: number;
  turnMs: number;
  /** Built-in card indices, or custom words when `custom` is set. */
  custom: string[] | null;
  deck: number[];
  pos: number;
  cardNo: number;
  log: SmuggleLogEntry[];
  turnPts: number;
  last: SmuggleTurnSummary | null;
  got: Record<string, number>;
  buzzes: Record<string, number>;
  awards: SmuggleAward[];
  winner: number | null;
  lowSince: number | null;
  abandoned: boolean;
}

const MEMORY_CAP = 450;
const isHere = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;

function card(s: SmuggleState): { w: string; ban: string[] } {
  const i = s.deck[s.pos % s.deck.length];
  if (s.custom) return { w: s.custom[i] ?? "?", ban: [] };
  return CARDS[i] ?? { w: "?", ban: [] };
}

/** Deals the next card and remembers it (built-in cards only) so the next game in this room starts fresh. */
function nextCard(s: SmuggleState, ctx: GameCtx) {
  s.pos++;
  s.cardNo++;
  if (s.custom) return;
  const raw = Array.isArray(ctx.memory.used) ? (ctx.memory.used as unknown[]) : [];
  const used = raw.filter((x): x is number => Number.isInteger(x));
  used.push(s.deck[s.pos % s.deck.length]);
  ctx.memory.used = used.slice(-MEMORY_CAP);
}

/** Picks who describes next for `team`, skipping players who are away. Null when nobody is here. */
function pickDescriber(s: SmuggleState, team: number, ctx: GameCtx): string | null {
  const members = s.teams[team];
  for (let k = 0; k < members.length; k++) {
    const id = members[(s.taken[team] + k) % members.length];
    if (isHere(ctx, id)) {
      s.taken[team] += k; // skipped players lose this go; rotation continues after the describer
      return id;
    }
  }
  return null;
}

/** Sets up the "up next" screen for turn `s.turn`, or finishes when turns run out. */
function prepareTurn(s: SmuggleState, ctx: GameCtx) {
  for (let guard = 0; guard < 4; guard++) {
    if (s.turn >= s.totalTurns) return finish(s, ctx, false);
    const team = s.turn % 2;
    const who = pickDescriber(s, team, ctx);
    if (who) {
      s.phase = "ready";
      s.team = team;
      s.describer = who;
      s.endsAt = ctx.now() + READY_MS;
      return;
    }
    s.turn++; // the whole team is away: skip their turn
  }
  finish(s, ctx, true);
}

function startTurn(s: SmuggleState, ctx: GameCtx) {
  s.phase = "turn";
  s.endsAt = ctx.now() + s.turnMs;
  s.log = [];
  s.turnPts = 0;
  nextCard(s, ctx);
  ctx.emit({ k: "start" } satisfies SmuggleEvent);
}

function pushLog(s: SmuggleState, e: SmuggleLogEntry) {
  s.log.push(e);
  if (s.log.length > LOG_MAX) s.log.shift();
}

function endTurn(s: SmuggleState, ctx: GameCtx) {
  pushLog(s, { w: card(s).w, r: "time" });
  s.last = { team: s.team, describer: s.describer, log: s.log, pts: s.turnPts };
  s.log = [];
  s.taken[s.team]++;
  s.turn++;
  ctx.emit({ k: "time" } satisfies SmuggleEvent);
  prepareTurn(s, ctx);
}

function bestIds(rec: Record<string, number>, min: number): string[] {
  const best = Math.max(0, ...Object.values(rec));
  if (best < min) return [];
  return Object.keys(rec).filter((id) => rec[id] === best);
}

function finish(s: SmuggleState, ctx: GameCtx, abandoned: boolean) {
  if (s.phase === "final") return;
  s.phase = "final";
  s.abandoned = abandoned;
  s.endsAt = 0;
  s.lowSince = null;
  const [a, b] = s.score;
  s.winner = a === b ? null : a > b ? 0 : 1;
  const awards: SmuggleAward[] = [];
  const star = bestIds(s.got, 2);
  if (star.length && star.length <= 3) {
    awards.push({ icon: "🗣️", title: "Master smuggler", ids: star, note: `${s.got[star[0]]} words described` });
  }
  const eagle = bestIds(s.buzzes, 1);
  if (eagle.length && eagle.length <= 3) {
    awards.push({ icon: "🚨", title: "Eagle ears", ids: eagle, note: `${s.buzzes[eagle[0]]} buzz${s.buzzes[eagle[0]] === 1 ? "" : "es"}` });
  }
  s.awards = awards;
  const scores = Object.fromEntries(s.ids.map((id) => [id, s.score[Math.max(0, teamOf(s.teams, id))]]));
  let headline: string;
  if (s.winner === null) headline = `It's a tie: ${a} words each!`;
  else headline = `${TEAMS[s.winner].name} team smuggles the win, ${Math.max(a, b)} to ${Math.min(a, b)}`;
  if (abandoned) headline = `Not enough players left. ${headline}`;
  ctx.end({ winners: s.winner === null ? [] : s.teams[s.winner].slice(), headline, scores });
}

function isCardNo(v: unknown, s: SmuggleState): boolean {
  return typeof v === "number" && v === s.cardNo;
}

export const smuggle: GameDef<SmuggleState, SmuggleAction> = {
  id: "smuggle",

  setup(ctx) {
    const set = readSettings(config.settings, ctx.settings);
    const ids = ctx.players.map((p) => p.id);
    const teams = splitTeams(ids, ctx.random);
    const turnMs = Math.max(20_000, Math.min(180_000, (Number(set.time) || TURN_MS / 1000) * 1000));
    const each = Math.max(1, Math.min(3, Number(set.turns) || 1));
    const perTeam = Math.max(MIN_TEAM_TURNS, Math.max(teams[0].length, teams[1].length) * each);
    const custom = customWords(config.settings, ctx.settings, "words");

    let deck: number[];
    if (custom) {
      deck = shuffle(
        custom.map((_, i) => i),
        ctx.random,
      );
    } else {
      // Fresh cards first; cards used in recent games in this room go to the back.
      const raw = ctx.memory.used;
      const used = Array.isArray(raw) ? raw.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < CARDS.length) : [];
      const seen = new Set(used);
      const fresh = CARDS.map((_, i) => i).filter((i) => !seen.has(i));
      deck = [...shuffle(fresh, ctx.random), ...shuffle([...seen], ctx.random)];
    }

    const s: SmuggleState = {
      startedAt: ctx.now(),
      ids,
      teams,
      score: [0, 0],
      phase: "ready",
      turn: 0,
      totalTurns: perTeam * 2,
      taken: [0, 0],
      team: 0,
      describer: teams[0][0] ?? ids[0],
      endsAt: 0,
      turnMs,
      custom,
      deck,
      pos: -1,
      cardNo: 0,
      log: [],
      turnPts: 0,
      last: null,
      got: Object.fromEntries(ids.map((id) => [id, 0])),
      buzzes: Object.fromEntries(ids.map((id) => [id, 0])),
      awards: [],
      winner: null,
      lowSince: null,
      abandoned: false,
    };
    prepareTurn(s, ctx);
    return s;
  },

  action(s, playerId, action, ctx) {
    if (s.phase === "final") return false;
    if (!s.ids.includes(playerId)) return false;
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as Record<string, unknown>;
    switch (a.type) {
      case "start": {
        if (s.phase !== "ready" || playerId !== s.describer) return false;
        startTurn(s, ctx);
        return true;
      }
      case "got":
      case "skip": {
        if (s.phase !== "turn" || playerId !== s.describer || !isCardNo(a.n, s)) return false;
        const w = card(s).w;
        if (a.type === "got") {
          s.score[s.team] += GOT_PTS;
          s.turnPts += GOT_PTS;
          s.got[playerId] = (s.got[playerId] ?? 0) + 1;
          pushLog(s, { w, r: "got" });
          ctx.emit({ k: "got", w } satisfies SmuggleEvent);
        } else {
          pushLog(s, { w, r: "skip" });
          ctx.emit({ k: "skip", w } satisfies SmuggleEvent);
        }
        nextCard(s, ctx);
        return true;
      }
      case "buzz": {
        if (s.phase !== "turn" || !isCardNo(a.n, s)) return false;
        const t = teamOf(s.teams, playerId);
        if (t < 0 || t === s.team) return false;
        const w = card(s).w;
        s.score[s.team] -= BUZZ_COST;
        s.turnPts -= BUZZ_COST;
        s.buzzes[playerId] = (s.buzzes[playerId] ?? 0) + 1;
        pushLog(s, { w, r: "buzz", by: playerId });
        ctx.emit({ k: "buzz", w, by: playerId } satisfies SmuggleEvent);
        nextCard(s, ctx);
        return true;
      }
    }
    return false;
  },

  tick(s, ctx) {
    if (s.phase === "final") return false;
    const now = ctx.now();
    let changed = false;
    const here = s.ids.filter((id) => isHere(ctx, id)).length;
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
    if (s.phase === "ready") {
      // The describer dropped before starting: hand the turn to a teammate who's here.
      if (!isHere(ctx, s.describer)) {
        prepareTurn(s, ctx);
        return true;
      }
      if (now >= s.endsAt) {
        startTurn(s, ctx);
        return true;
      }
    } else if (s.phase === "turn" && now >= s.endsAt) {
      endTurn(s, ctx);
      return true;
    }
    return changed;
  },
  tickMs: 250,

  view(s, viewerId, ctx): SmuggleView {
    const t = teamOf(s.teams, viewerId);
    let role: SmuggleRole = "watch";
    if (t >= 0) role = viewerId === s.describer ? "describer" : t === s.team ? "guesser" : "buzzer";
    const showCard = s.phase === "turn" && (role === "describer" || role === "buzzer");
    const c = showCard ? card(s) : null;
    return {
      game: s.startedAt,
      phase: s.phase,
      turn: Math.min(s.turn + 1, s.totalTurns),
      turns: s.totalTurns,
      team: s.team,
      describer: s.describer,
      endsAt: s.endsAt,
      phaseMs: s.phase === "turn" ? s.turnMs : READY_MS,
      teams: s.teams,
      score: s.score,
      role,
      card: c ? { n: s.cardNo, w: c.w, ban: c.ban } : null,
      cardNo: s.cardNo,
      log: s.phase === "turn" ? s.log : [],
      last: s.last,
      away: s.ids.filter((id) => !isHere(ctx, id)),
      custom: !!s.custom,
      awards: s.phase === "final" ? s.awards : [],
      winner: s.phase === "final" ? s.winner : null,
      endingAt: s.lowSince !== null && s.phase !== "final" ? s.lowSince + ABANDON_MS : null,
      abandoned: s.abandoned,
    };
  },

  playerLeft(s, playerId, ctx) {
    if (s.phase === "final") return;
    // The describer can't keep talking from a dropped connection: end their turn with what they banked.
    if (s.phase === "turn" && playerId === s.describer) endTurn(s, ctx);
    if (s.lowSince === null && s.ids.filter((id) => isHere(ctx, id)).length < 2) s.lowSince = ctx.now();
  },

  playerReturned(s, _playerId, ctx) {
    if (s.lowSince !== null && s.ids.filter((id) => isHere(ctx, id)).length >= 2) s.lowSince = null;
  },
};

export default smuggle;
