import { topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import { candidates, makePuzzle, shapeOf, type Level, type Size } from "./sudoku";
import {
  AWAY_MS,
  LEVEL_NAME,
  LIMIT_MS,
  PAR_MS,
  READY_MS,
  fmtTime,
  score,
  type BadEvent,
  type BoardRow,
  type MyBoard,
  type NineboxView,
  type RunStatus,
} from "./shared";

export type { NineboxAction, NineboxView, NineboxEvent } from "./shared";

// Nine Box: the classic number-placement logic puzzle, Ruckus style.
// Everyone gets the same seeded grid (exactly one solution) and solves it at their own pace.
// The server checks every number against the solution: wrong ones are refused and count as a
// mistake. Score = solved + speed bonus - mistakes; unsolved grids score for cells filled.

interface Run {
  cells: number[];
  mistakes: number;
  status: RunStatus;
  ms: number;
  awaySince: number | null;
}

export interface NineboxState {
  phase: "ready" | "play" | "over";
  size: Size;
  level: Level;
  maxMistakes: number;
  startsAt: number;
  givens: number[];
  solution: number[];
  /** Empty cells at the start. */
  holes: number;
  ids: string[];
  runs: Record<string, Run>;
}

const GAME = "Nine Box";

function nameOf(ctx: GameCtx, id: string): string {
  return ctx.player(id)?.name ?? "Someone";
}

const filledOf = (s: NineboxState, r: Run) => r.cells.reduce((t, v, i) => t + (v && !s.givens[i] ? 1 : 0), 0);
const limitOf = (s: NineboxState) => LIMIT_MS[s.size][s.level];

function finish(s: NineboxState, r: Run, status: RunStatus, ctx: GameCtx) {
  r.status = status;
  r.ms = Math.max(0, Math.min(limitOf(s), ctx.now() - s.startsAt));
}

function scoreOf(s: NineboxState, r: Run): number {
  return score(r.status === "solved", r.ms, r.mistakes, filledOf(s, r) / Math.max(1, s.holes), PAR_MS[s.size][s.level], limitOf(s));
}

function maybeEnd(s: NineboxState, ctx: GameCtx): boolean {
  if (s.phase !== "play") return false;
  const now = ctx.now();
  const waiting = s.ids.some((id) => {
    const r = s.runs[id];
    return r.status === "play" && (r.awaySince === null || now - r.awaySince < AWAY_MS);
  });
  if (waiting) return false;
  for (const id of s.ids) {
    const r = s.runs[id];
    if (r.status === "play") finish(s, r, "quit", ctx);
  }
  s.phase = "over";
  const scores: Record<string, number> = {};
  for (const id of s.ids) scores[id] = scoreOf(s, s.runs[id]);
  const solvers = s.ids.filter((id) => s.runs[id].status === "solved");
  const winners = topScorers(scores);
  const kind = `${s.size}×${s.size} ${LEVEL_NAME[s.level]}`;
  const how = (id: string) => {
    const r = s.runs[id];
    return `in ${fmtTime(r.ms)} with ${r.mistakes === 0 ? "no" : r.mistakes} mistake${r.mistakes === 1 ? "" : "s"}`;
  };
  let headline: string;
  if (s.ids.length === 1) {
    const id = s.ids[0];
    const r = s.runs[id];
    headline =
      r.status === "solved"
        ? `${nameOf(ctx, id)} solved a ${kind} ${how(id)}`
        : `${nameOf(ctx, id)} filled ${Math.round((100 * filledOf(s, r)) / Math.max(1, s.holes))}% of a ${kind}${r.status === "out" ? " before running out of mistakes" : ""}`;
  } else if (!solvers.length) {
    headline = winners.length === 1 ? `Nobody cracked the ${kind}: ${nameOf(ctx, winners[0])} got furthest` : `Nobody cracked the ${kind}`;
  } else if (winners.length === 1) {
    headline = `${nameOf(ctx, winners[0])} wins ${GAME}: solved ${how(winners[0])}`;
  } else {
    headline = `${winners.map((id) => nameOf(ctx, id)).join(" & ")} tie at ${GAME}`;
  }
  ctx.end({ winners, headline, scores });
  return true;
}

function toMine(r: Run): MyBoard {
  return { cells: r.cells.join(""), mistakes: r.mistakes, status: r.status, ms: r.ms };
}

// ---------- practice bot ----------

const botPlans = new WeakMap<NineboxState, Map<string, { key: string; at: number }>>();

/** Fills the most obvious cell (fewest candidates on its own board) every several seconds. */
function botMove(s: NineboxState, botId: string, ctx: GameCtx) {
  const r = s.runs[botId];
  if (!r || s.phase !== "play" || r.status !== "play") return null;
  const now = ctx.now();
  let plans = botPlans.get(s);
  if (!plans) botPlans.set(s, (plans = new Map()));
  const filled = filledOf(s, r);
  const key = `${filled}:${r.mistakes}`;
  const plan = plans.get(botId);
  if (!plan || plan.key !== key) {
    // Human pace: roughly the par time for the whole grid, give or take.
    const per = PAR_MS[s.size][s.level] / Math.max(1, s.holes);
    const first = filled === 0 && r.mistakes === 0 ? 4_000 : 0;
    plans.set(botId, { key, at: now + first + per * (0.55 + ctx.random() * 0.9) });
    return null;
  }
  if (now < plan.at) return null;
  const sh = shapeOf(s.size);
  const cand = candidates(r.cells, sh);
  let best = -1;
  let bestK = 99;
  for (let i = 0; i < cand.length; i++) {
    if (r.cells[i]) continue;
    let k = 0;
    for (let m = cand[i]; m; m &= m - 1) k++;
    if (k < bestK || (k === bestK && ctx.random() < 0.3)) {
      best = i;
      bestK = k;
    }
  }
  if (best < 0) return null;
  const opts: number[] = [];
  for (let d = 1; d <= sh.n; d++) if (cand[best] & (1 << d)) opts.push(d);
  // Mostly careful; now and then a slip (never the one that would knock it out).
  const safe = s.maxMistakes === 0 || r.mistakes < s.maxMistakes - 1;
  if (opts.length > 1 && safe && ctx.random() < 0.08) {
    const wrong = opts.filter((d) => d !== s.solution[best]);
    if (wrong.length) return { type: "place", i: best, v: wrong[Math.floor(ctx.random() * wrong.length) % wrong.length] };
  }
  // It "works out" the right digit from its candidates, like a person would.
  return { type: "place", i: best, v: s.solution[best] };
}

// ---------- the game ----------

export const ninebox: GameDef<NineboxState, unknown> = {
  id: "ninebox",

  setup(ctx) {
    const set = readSettings(config.settings, ctx.settings);
    const size: Size = set.size === 6 ? 6 : 9;
    const level = (["easy", "medium", "hard"].includes(String(set.level)) ? set.level : "medium") as Level;
    const maxMistakes = [0, 3, 5].includes(Number(set.mistakes)) ? Number(set.mistakes) : 3;
    const pz = makePuzzle(size, level, ctx.random);
    const startsAt = ctx.now() + READY_MS;
    const ids = ctx.players.map((p) => p.id);
    const runs: Record<string, Run> = {};
    for (const id of ids)
      runs[id] = {
        cells: pz.givens.slice(),
        mistakes: 0,
        status: "play",
        ms: 0,
        awaySince: ctx.player(id)?.connected === false ? ctx.now() : null,
      };
    return {
      phase: "ready",
      size,
      level,
      maxMistakes,
      startsAt,
      givens: pz.givens,
      solution: pz.solution,
      holes: pz.givens.filter((v) => !v).length,
      ids,
      runs,
    };
  },

  action(s, playerId, raw, ctx) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
    const a = raw as Record<string, unknown>;
    const r = s.runs[playerId];
    if (!r || s.phase !== "play" || r.status !== "play") return false;
    if (a.type === "quit") {
      finish(s, r, "quit", ctx);
      maybeEnd(s, ctx);
      return true;
    }
    if (a.type !== "place") return false;
    const n = s.size;
    const i = a.i;
    const v = a.v;
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= n * n) return false;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > n) return false;
    if (r.cells[i]) return false;
    if (s.solution[i] !== v) {
      r.mistakes++;
      ctx.emit({ t: "bad", i, v } satisfies BadEvent, { to: playerId });
      if (s.maxMistakes > 0 && r.mistakes >= s.maxMistakes) finish(s, r, "out", ctx);
      maybeEnd(s, ctx);
      return true;
    }
    r.cells[i] = v;
    if (r.cells.every((x) => x)) finish(s, r, "solved", ctx);
    maybeEnd(s, ctx);
    return true;
  },

  tick(s, ctx) {
    if (s.phase === "over") return false;
    const now = ctx.now();
    let changed = false;
    if (s.phase === "ready") {
      if (now < s.startsAt) return false;
      s.phase = "play";
      changed = true;
    }
    if (now >= s.startsAt + limitOf(s)) {
      for (const id of s.ids) {
        const r = s.runs[id];
        if (r.status === "play") {
          finish(s, r, "time", ctx);
          changed = true;
        }
      }
    }
    return maybeEnd(s, ctx) || changed;
  },
  tickMs: 500,

  playerLeft(s, playerId, ctx) {
    const r = s.runs[playerId];
    if (r && r.awaySince === null) r.awaySince = ctx.now();
  },

  playerReturned(s, playerId) {
    const r = s.runs[playerId];
    if (r) r.awaySince = null;
  },

  bot(s, botId, ctx) {
    return botMove(s, botId, ctx);
  },

  view(s, viewerId): NineboxView {
    const board: BoardRow[] = s.ids.map((id) => {
      const r = s.runs[id];
      return {
        id,
        pct: Math.round((100 * filledOf(s, r)) / Math.max(1, s.holes)),
        mistakes: r.mistakes,
        status: r.status,
        secs: Math.round(r.ms / 1000),
      };
    });
    const mine = s.runs[viewerId];
    let watch: NineboxView["watch"] = null;
    if (!mine && s.ids.length && s.phase !== "ready") {
      const lead = s.ids.slice().sort((a, b) => filledOf(s, s.runs[b]) - filledOf(s, s.runs[a]) || s.runs[a].mistakes - s.runs[b].mistakes)[0];
      watch = { id: lead, run: toMine(s.runs[lead]) };
    }
    const hide = s.phase === "ready";
    return {
      phase: s.phase,
      size: s.size,
      level: s.level,
      startsAt: s.startsAt,
      endsAt: s.startsAt + limitOf(s),
      maxMistakes: s.maxMistakes,
      givens: hide ? "" : s.givens.join(""),
      board,
      me: mine ? (hide ? { ...toMine(mine), cells: "" } : toMine(mine)) : null,
      watch,
      ...(s.phase === "over" ? { solution: s.solution.join("") } : {}),
    };
  },
};

export default ninebox;
