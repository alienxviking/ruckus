import { topScorers, type GameCtx, type GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  AWAY_MS,
  BASE,
  GAME_MS,
  GAP_MS,
  IDLE_MS,
  KEEP,
  MAX_LAG_MS,
  RANGE,
  READY_MS,
  RESTART_MS,
  SIZE,
  land,
  motion,
  offsetAt,
  towerPoints,
  type FallEvent,
  type Rect,
  type Row,
  type Speed,
  type StackView,
  type TowerView,
} from "./shared";

export type { StackAction, StackView, StackEvent } from "./shared";

// Tower Stack (Ruckus original). A block slides back and forth over your tower; drop it and
// whatever hangs over the edge is sliced off. Everyone stacks their own tower at once on the
// same seeded sequence of slides. The client animates and predicts; the server re-runs every
// drop from the seed and the claimed drop time (bounded by when it actually arrived), so the
// tower it keeps is the only one that counts.

interface Tower {
  n: number;
  blocks: Rect[];
  spawnAt: number;
  combo: number;
  perfects: number;
  alive: boolean;
  restartAt: number | null;
}

interface Player {
  tower: Tower;
  triesLeft: number;
  best: number;
  bestH: number;
  done: boolean;
  awaySince: number | null;
}

export interface StackState {
  phase: "ready" | "play" | "over";
  startsAt: number;
  endsAt: number;
  seed: number;
  speed: Speed;
  tries: number;
  ids: string[];
  ps: Record<string, Player>;
}

const GAME = "Tower Stack";

const placed = (t: Tower) => t.blocks.length - 1;
const towerScore = (t: Tower) => towerPoints(placed(t), t.perfects);

function newTower(n: number, spawnAt: number): Tower {
  return { n, blocks: [BASE.slice() as Rect], spawnAt, combo: 0, perfects: 0, alive: true, restartAt: null };
}

function nameOf(ctx: GameCtx, id: string) {
  return ctx.player(id)?.name ?? "Someone";
}

function record(p: Player) {
  const sc = towerScore(p.tower);
  if (sc > p.best) p.best = sc;
  if (placed(p.tower) > p.bestH) p.bestH = placed(p.tower);
}

/** Drop the sliding block at `t` ms after it appeared. Assumes the tower is alive. */
function drop(s: StackState, id: string, t: number, ctx: GameCtx) {
  const p = s.ps[id];
  const tw = p.tower;
  const lv = tw.blocks.length;
  const m = motion(s.seed, lv, s.speed);
  const top = tw.blocks[tw.blocks.length - 1];
  const res = land(top, m, offsetAt(m, t), tw.combo);
  const at = tw.spawnAt + t;
  if (res.rect) {
    tw.blocks.push(res.rect);
    tw.combo = res.combo;
    if (res.kind === "perfect") tw.perfects += 1;
    tw.spawnAt = at + GAP_MS;
    record(p);
    return;
  }
  // Collapse.
  tw.alive = false;
  tw.combo = 0;
  record(p);
  ctx.emit({ t: "fall", id, h: placed(tw) } satisfies FallEvent);
  if (p.triesLeft > 0) {
    p.triesLeft -= 1;
    tw.restartAt = at + RESTART_MS;
  } else {
    p.done = true;
  }
}

function retire(p: Player) {
  record(p);
  p.tower.alive = false;
  p.tower.restartAt = null;
  p.triesLeft = 0;
  p.done = true;
}

function finish(s: StackState, ctx: GameCtx) {
  if (s.phase === "over") return;
  s.phase = "over";
  for (const id of s.ids) if (!s.ps[id].done) retire(s.ps[id]);
  const scores: Record<string, number> = {};
  for (const id of s.ids) scores[id] = s.ps[id].best;
  const winners = topScorers(scores);
  const h = (id: string) => s.ps[id].bestH;
  let headline: string;
  if (s.ids.length === 1) {
    const id = s.ids[0];
    headline = `${nameOf(ctx, id)} stacked ${h(id)} high for ${scores[id]} points`;
  } else if (winners.length === 1) {
    headline = `${nameOf(ctx, winners[0])} wins ${GAME} with a ${h(winners[0])}-block tower`;
  } else if (winners.length > 1) {
    headline = `${winners.map((id) => nameOf(ctx, id)).join(" & ")} tie at ${GAME} on ${scores[winners[0]]}`;
  } else {
    headline = "Every tower toppled at the first block";
  }
  ctx.end({ winners, headline, scores });
}

function towerView(t: Tower): TowerView {
  const from = Math.max(0, t.blocks.length - KEEP);
  return {
    n: t.n,
    lv: t.blocks.length,
    top: t.blocks.slice(from),
    from,
    spawnAt: t.spawnAt,
    combo: t.combo,
    perfects: t.perfects,
    score: towerScore(t),
    alive: t.alive,
    restartAt: t.restartAt,
  };
}

// ---------- practice bot ----------

const botAim = new WeakMap<StackState, Map<string, { key: string; t: number }>>();

/** Gaussian-ish noise from three uniforms. */
const noise = (r: () => number) => (r() + r() + r() - 1.5) * 2;

/**
 * Medium bot: aims for the centre with a human reaction time and an error that grows as
 * the blocks speed up, so it builds a decent tower and then topples like people do.
 */
function botMove(s: StackState, id: string, ctx: GameCtx) {
  const p = s.ps[id];
  if (!p || s.phase !== "play" || !p.tower.alive) return null;
  const tw = p.tower;
  const lv = tw.blocks.length;
  const key = `${tw.n}:${lv}`;
  let aims = botAim.get(s);
  if (!aims) botAim.set(s, (aims = new Map()));
  let aim = aims.get(id);
  if (!aim || aim.key !== key) {
    const m = motion(s.seed, lv, s.speed);
    const react = 450 + ctx.random() * 700;
    // Crossings of the centre happen at distances RANGE, 3*RANGE, 5*RANGE...
    let k = 0;
    while ((RANGE + 2 * RANGE * k) / m.v < react) k++;
    const err = noise(ctx.random) * (3.2 + lv * 0.24);
    aim = { key, t: Math.max(0, (RANGE + 2 * RANGE * k + err) / m.v) };
    aims.set(id, aim);
  }
  if (ctx.now() < tw.spawnAt + aim.t) return null;
  return { type: "drop", lv, t: Math.round(aim.t) };
}

// ---------- the game ----------

export const stack: GameDef<StackState, unknown> = {
  id: "stack",

  setup(ctx) {
    const set = readSettings(config.settings, ctx.settings);
    const speed = (["chill", "normal", "fast"].includes(String(set.speed)) ? set.speed : "normal") as Speed;
    const tries = Math.max(1, Math.min(3, Number(set.tries) || 1));
    const seed = Math.floor(ctx.random() * 2 ** 32) >>> 0;
    const startsAt = ctx.now() + READY_MS;
    const ids = ctx.players.map((p) => p.id);
    const ps: Record<string, Player> = {};
    for (const id of ids) {
      ps[id] = {
        tower: newTower(0, startsAt),
        triesLeft: tries - 1,
        best: 0,
        bestH: 0,
        done: false,
        awaySince: ctx.player(id)?.connected === false ? ctx.now() : null,
      };
    }
    return { phase: "ready", startsAt, endsAt: startsAt + GAME_MS, seed, speed, tries, ids, ps };
  },

  action(s, playerId, raw, ctx) {
    if (s.phase !== "play") return false;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
    const a = raw as Record<string, unknown>;
    const p = s.ps[playerId];
    if (!p || a.type !== "drop" || !p.tower.alive) return false;
    const tw = p.tower;
    if (a.lv !== tw.blocks.length || typeof a.t !== "number" || !Number.isFinite(a.t)) return false;
    const now = ctx.now();
    if (now < tw.spawnAt) return false;
    // Trust the claimed time only as far as the network could explain it.
    const at = Math.min(now, Math.max(tw.spawnAt + a.t, now - MAX_LAG_MS, tw.spawnAt));
    drop(s, playerId, Math.min(IDLE_MS, at - tw.spawnAt), ctx);
    if (s.ids.every((id) => s.ps[id].done)) finish(s, ctx);
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
    if (now >= s.endsAt) {
      finish(s, ctx);
      return true;
    }
    for (const id of s.ids) {
      const p = s.ps[id];
      if (p.done) continue;
      const tw = p.tower;
      if (p.awaySince !== null && now - p.awaySince >= AWAY_MS) {
        retire(p);
        changed = true;
      } else if (tw.alive && now >= tw.spawnAt + IDLE_MS) {
        drop(s, id, IDLE_MS, ctx);
        changed = true;
      } else if (!tw.alive && tw.restartAt !== null && now >= tw.restartAt) {
        p.tower = newTower(tw.n + 1, tw.restartAt);
        changed = true;
      }
    }
    if (s.ids.every((id) => s.ps[id].done)) {
      finish(s, ctx);
      return true;
    }
    return changed;
  },
  tickMs: 200,

  playerLeft(s, playerId, ctx) {
    const p = s.ps[playerId];
    if (p && p.awaySince === null) p.awaySince = ctx.now();
  },

  playerReturned(s, playerId) {
    const p = s.ps[playerId];
    if (p) p.awaySince = null;
  },

  bot(s, botId, ctx) {
    return botMove(s, botId, ctx);
  },

  view(s, viewerId): StackView {
    const rows: Row[] = s.ids.map((id) => {
      const p = s.ps[id];
      const top = p.tower.blocks[p.tower.blocks.length - 1];
      return {
        id,
        h: placed(p.tower),
        best: p.best,
        score: towerScore(p.tower),
        alive: p.tower.alive,
        done: p.done,
        room: Math.round(((top[2] * top[3]) / (SIZE * SIZE)) * 100) / 100,
      };
    });
    const mine = s.ps[viewerId];
    let watch: StackView["watch"] = null;
    if (!mine && s.ids.length) {
      const lead = s.ids
        .slice()
        .sort(
          (a, b) =>
            Number(s.ps[b].tower.alive) - Number(s.ps[a].tower.alive) ||
            towerScore(s.ps[b].tower) - towerScore(s.ps[a].tower),
        )[0];
      watch = { id: lead, tower: towerView(s.ps[lead].tower) };
    }
    return {
      phase: s.phase,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      seed: s.seed,
      speed: s.speed,
      tries: s.tries,
      rows,
      me: mine ? { tower: towerView(mine.tower), best: mine.best, triesLeft: mine.triesLeft } : null,
      watch,
    };
  },
};

export default stack;
