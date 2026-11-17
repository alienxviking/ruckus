import type { GameCtx, GameDef } from "../../shared/game";
import { shuffle, topScorers } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  ABANDON_MS,
  FLAG_POINTS,
  FREEZE_MS,
  GEM_POINTS,
  MINE_PENALTY,
  PLAY_MS,
  READY_MS,
  SCAN_RADIUS,
  STUN_MS,
  boardSize,
  type BoardChoice,
  neighbors,
  type EndReason,
  type FinalRow,
  type ItemKind,
  type MrAction,
  type MrView,
  type OpEvent,
  type Phase,
  type PlayerRow,
} from "./shared";

// Mine Rush: competitive simultaneous minesweeper (Ruckus original).
// One shared board, everyone digs at once, first come first served. Mines,
// numbers of hidden cells and hidden pickups never leave the server: views
// carry only what has been opened, and every reveal goes out as a tiny event.

export type { MrAction, MrView, MrEvent } from "./shared";

/** Share of the field that is mines, by the host's "Mines" setting. */
const MINE_RATES: Record<string, number> = { few: 0.15, normal: 0.17, lots: 0.21 };
/** Biggest share of the safe cells the starting openings may give away. */
const OPENING_MAX_SHARE = 0.22;
/** The extra openings for big groups should stay small. */
const EXTRA_OPENING_MAX = 30;
const SYNC_EVERY_MS = 1_000;
const MAX_Q = 2 ** 31;

/** Cell states on the server. */
const HIDDEN = 0;
const OPEN = 1;
const BOOM = 2;

export interface MrState {
  w: number;
  h: number;
  mineCount: number;
  safeTotal: number;
  /** 1 = mine (secret). */
  mine: number[];
  /** Neighbouring mines per cell (secret until opened). */
  num: number[];
  /** Hidden pickup per cell ("" = none; secret until opened). */
  item: (ItemKind | "")[];
  /** HIDDEN / OPEN / BOOM per cell. */
  open: number[];
  /** Player index that opened the cell, -1 = the starting openings / nobody. */
  owner: number[];
  opened: number;
  /** Bit p set = player p flagged this (hidden) cell. */
  flagMask: number[];
  flagCount: number[];
  /** Last flag op processed per player (client counter). */
  fq: number[];
  ids: string[];
  ps: PlayerRow[];
  stats: Omit<FinalRow, "right" | "wrong" | "flagPts" | "score">[];
  claimed: [number, ItemKind, number][];
  phase: Phase;
  startsAt: number;
  endsAt: number;
  /** Public op counter. */
  s: number;
  /** View encodings, rebuilt only when `s` or the phase moved on. */
  enc: { key: string; cells: string; own: string };
  aloneSince: number | null;
  /** Last sync reply per viewer (rate limit). */
  syncAt: Record<string, number>;
  fin: FinalRow[] | null;
  why: EndReason | null;
  /** Opening centres (for tests and the sim). */
  openings: number[];
}

// ---------- board generation ----------

const randInt = (ctx: GameCtx, lo: number, hi: number) => lo + Math.floor(ctx.random() * (hi - lo + 1));

function itemCounts(players: number): Record<ItemKind, number> {
  if (players <= 1) return { g: 4, s: 3, f: 0 }; // nobody to freeze when solo
  if (players <= 3) return { g: 3, s: 2, f: 2 };
  return { g: 4, s: 3, f: 3 };
}

/** Flood-open from `start` (a safe hidden cell) through zeros. Calls `visit` for each newly opened cell in BFS order. */
function flood(s: MrState, start: number, visit: (c: number) => void) {
  if (s.open[start] !== HIDDEN || s.mine[start]) return;
  const queue = [start];
  s.open[start] = OPEN;
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi];
    visit(c);
    if (s.num[c] !== 0) continue;
    for (const nb of neighbors(s.w, s.h, c)) {
      if (s.open[nb] === HIDDEN && !s.mine[nb]) {
        s.open[nb] = OPEN;
        queue.push(nb);
      }
    }
  }
}

function layBoard(s: MrState, ctx: GameCtx, players: number) {
  const { w, h } = s;
  const size = w * h;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  let best: { mine: number[]; num: number[]; open: number[]; opened: number; centres: number[] } | null = null;
  for (let attempt = 0; ; attempt++) {
    const centres = [randInt(ctx, cy - 2, cy + 1) * w + randInt(ctx, cx - 3, cx + 2)];
    if (players >= 4) {
      const q = Math.floor(w / 4);
      centres.push(randInt(ctx, 2, h - 3) * w + randInt(ctx, 2, q));
      centres.push(randInt(ctx, 2, h - 3) * w + randInt(ctx, w - 1 - q, w - 3));
    }
    const clear = new Array<boolean>(size).fill(false);
    for (const c of centres) {
      clear[c] = true;
      for (const nb of neighbors(w, h, c)) clear[nb] = true;
    }
    const spots = shuffle(
      Array.from({ length: size }, (_, i) => i).filter((i) => !clear[i]),
      ctx.random,
    );
    s.mine = new Array<number>(size).fill(0);
    for (const i of spots.slice(0, s.mineCount)) s.mine[i] = 1;
    s.num = Array.from({ length: size }, (_, i) => neighbors(w, h, i).reduce((n, nb) => n + s.mine[nb], 0));
    s.open = new Array<number>(size).fill(HIDDEN);
    s.opened = 0;
    const sizes = centres.map((c) => {
      let n = 0;
      flood(s, c, () => (n += 1));
      return n;
    });
    s.opened = sizes.reduce((a, b) => a + b, 0);
    const tooBig = s.opened > s.safeTotal * OPENING_MAX_SHARE || sizes.slice(1).some((n) => n > EXTRA_OPENING_MAX);
    if (!tooBig) {
      s.openings = centres;
      break;
    }
    // Remember the smallest giveaway, for when no attempt fits (sparse mines on a busy field).
    if (!best || s.opened < best.opened) best = { mine: s.mine, num: s.num, open: s.open, opened: s.opened, centres };
    if (attempt >= 60) {
      Object.assign(s, { mine: best.mine, num: best.num, open: best.open, opened: best.opened, openings: best.centres });
      break;
    }
  }

  // Pickups go under safe cells nobody can see yet.
  const counts = itemCounts(players);
  const free = shuffle(
    Array.from({ length: size }, (_, i) => i).filter((i) => !s.mine[i] && s.open[i] === HIDDEN),
    ctx.random,
  );
  s.item = new Array<ItemKind | "">(size).fill("");
  let k = 0;
  for (const kind of ["g", "s", "f"] as ItemKind[]) {
    for (let n = 0; n < counts[kind] && k < free.length; n++) s.item[free[k++]] = kind;
  }
}

// ---------- helpers ----------

const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;

function nameOf(ctx: GameCtx, id: string) {
  return ctx.player(id)?.name ?? "Someone";
}

function cleanFlags(s: MrState, c: number) {
  let m = s.flagMask[c];
  if (!m) return;
  for (let p = 0; m; p++, m >>= 1) if (m & 1) s.flagCount[p] -= 1;
  s.flagMask[c] = 0;
}

function blocked(s: MrState, p: number, now: number) {
  const r = s.ps[p];
  return now < r.stun || now < r.frozen;
}

function nack(ctx: GameCtx, to: string, e: { c?: number; q?: number }) {
  ctx.emit({ t: "no", ...e }, { to });
  return false;
}

function encode(s: MrState) {
  const key = `${s.s}:${s.phase}`;
  if (s.enc.key === key) return s.enc;
  const over = s.phase === "over";
  let cells = "";
  let own = "";
  for (let i = 0; i < s.w * s.h; i++) {
    const o = s.open[i];
    cells += o === OPEN ? String(s.num[i]) : o === BOOM ? "x" : over && s.mine[i] ? "m" : ".";
    own += s.owner[i] < 0 ? "." : String(s.owner[i]);
  }
  s.enc = { key, cells, own };
  return s.enc;
}

function updateAlone(s: MrState, ctx: GameCtx) {
  if (s.phase === "over") return;
  const anyone = s.ids.some((id) => connected(ctx, id));
  if (anyone) s.aloneSince = null;
  else if (s.aloneSince === null) s.aloneSince = ctx.now();
}

/**
 * Open `targets` for player p: safe cells flood through zeros, mines explode.
 * `at` is the clicked cell (cascades ripple out from it). Emits the op event.
 */
function reveal(s: MrState, p: number, at: number, targets: number[], ctx: GameCtx) {
  const now = ctx.now();
  const opened: number[] = [];
  let nums = "";
  const booms: number[] = [];
  const got: [number, ItemKind][] = [];
  for (const t of targets) {
    if (s.open[t] !== HIDDEN) continue;
    if (s.mine[t]) {
      s.open[t] = BOOM;
      s.owner[t] = p;
      cleanFlags(s, t);
      booms.push(t);
      continue;
    }
    flood(s, t, (c) => {
      s.owner[c] = p;
      cleanFlags(s, c);
      opened.push(c);
      nums += String(s.num[c]);
      if (s.item[c]) got.push([c, s.item[c] as ItemKind]);
    });
  }
  if (!opened.length && !booms.length) return false;

  const me = s.ps[p];
  const st = s.stats[p];
  let d = opened.length - booms.length * MINE_PENALTY;
  s.opened += opened.length;
  st.opened += opened.length;
  st.booms += booms.length;
  if (booms.length) me.stun = now + STUN_MS;

  let fz: number | undefined;
  const scanned: number[] = [];
  for (const [c, kind] of got) {
    s.claimed.push([c, kind, p]);
    if (kind === "g") {
      d += GEM_POINTS;
      st.gems += 1;
    } else if (kind === "f") {
      st.freezes += 1;
      fz = now + FREEZE_MS;
      s.ps.forEach((r, q) => {
        if (q === p) return;
        r.frozen = Math.max(r.frozen, fz!);
        r.frozenBy = p;
      });
    } else {
      st.scans += 1;
      const x0 = c % s.w;
      const y0 = (c - x0) / s.w;
      for (let y = Math.max(0, y0 - SCAN_RADIUS); y <= Math.min(s.h - 1, y0 + SCAN_RADIUS); y++) {
        for (let x = Math.max(0, x0 - SCAN_RADIUS); x <= Math.min(s.w - 1, x0 + SCAN_RADIUS); x++) {
          const i = y * s.w + x;
          if (!s.mine[i] || s.open[i] !== HIDDEN) continue;
          const bit = 1 << p;
          if (!(s.flagMask[i] & bit)) {
            if (s.flagCount[p] >= s.mineCount) continue;
            s.flagMask[i] |= bit;
            s.flagCount[p] += 1;
          }
          scanned.push(i);
        }
      }
    }
  }
  me.score += d;
  s.s += 1;

  const e: OpEvent = { t: "op", s: s.s, p, a: at, o: opened, n: nums, x: booms, k: got, d, sc: me.score };
  if (booms.length) e.st = me.stun;
  if (fz !== undefined) e.fz = fz;
  const id = s.ids[p];
  if (got.some(([, k]) => k === "s")) {
    ctx.emit(e, { except: id });
    ctx.emit({ ...e, sm: scanned }, { to: id });
  } else {
    ctx.emit(e);
  }
  return true;
}

function finish(s: MrState, ctx: GameCtx, why: EndReason) {
  if (s.phase === "over") return;
  s.phase = "over";
  s.why = why;
  s.endsAt = Math.min(s.endsAt, ctx.now());
  s.aloneSince = null;
  s.fin = s.ids.map((_, p) => {
    let right = 0;
    let wrong = 0;
    const bit = 1 << p;
    for (let i = 0; i < s.flagMask.length; i++) {
      if (!(s.flagMask[i] & bit)) continue;
      if (s.mine[i]) right += 1;
      else wrong += 1;
    }
    const flagPts = (right - wrong) * FLAG_POINTS;
    s.ps[p].score += flagPts;
    return { ...s.stats[p], right, wrong, flagPts, score: s.ps[p].score };
  });

  const scores: Record<string, number> = {};
  s.ids.forEach((id, p) => (scores[id] = s.ps[p].score));
  const winners = why === "abandoned" ? [] : topScorers(scores);
  const best = winners.length ? scores[winners[0]] : 0;
  const names = winners.map((id) => nameOf(ctx, id));
  let headline: string;
  if (why === "abandoned") headline = "Mine Rush ended: everyone left the field";
  else if (!winners.length) headline = "The minefield wins: nobody finished above zero 💣";
  else if (s.ids.length === 1)
    headline =
      why === "cleared"
        ? `${names[0]} cleared the whole field for ${best} points! 🧹`
        : `${names[0]} dug up ${best} points before the clock ran out`;
  else if (winners.length > 1)
    headline = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} tie on ${best} points`;
  else headline = `${names[0]} wins Mine Rush with ${best} points${why === "cleared" ? ": field cleared!" : ""}`;
  ctx.end({ winners, headline, scores });
}

// ---------- practice bot ----------

/** Per bot: when it may act next and its own flag op counter. */
const botMem = new WeakMap<MrState, Map<string, { at: number; q: number }>>();

/**
 * Medium bot, working only from its own view: opens cells a number proves safe, flags cells
 * a number proves are mines, and otherwise digs the least risky looking cell. Sometimes it
 * skips the logic and just guesses, like a hurried human.
 */
function botMove(v: MrView, q: number, random: () => number): MrAction | null {
  const { w, h, cells } = v;
  const flagged = new Set(v.flags);
  const safe: number[] = [];
  const mines: number[] = [];
  /** Highest local mine odds seen for each hidden, unflagged frontier cell. */
  const risk = new Map<number, number>();
  for (let c = 0; c < w * h; c++) {
    const ch = cells.charCodeAt(c) - 48;
    if (ch < 1 || ch > 8) continue;
    let known = 0;
    const unknown: number[] = [];
    for (const nb of neighbors(w, h, c)) {
      const x = cells[nb];
      if (x === "x" || (x === "." && flagged.has(nb))) known += 1;
      else if (x === ".") unknown.push(nb);
    }
    if (!unknown.length) continue;
    const left = ch - known;
    if (left <= 0) safe.push(...unknown);
    else if (left === unknown.length) mines.push(...unknown);
    const odds = left / unknown.length;
    for (const u of unknown) risk.set(u, Math.max(risk.get(u) ?? 0, odds));
  }
  const pick = (list: number[]) => list[Math.floor(random() * list.length)];
  const hurried = random() < 0.08;
  if (!hurried && safe.length) return { type: "open", cell: pick(safe) };
  if (!hurried && mines.length && v.flags.length < v.mines) return { type: "flag", cell: pick(mines), on: true, q };
  // Guess: the safest-looking frontier cell, or a random hidden cell when that looks better.
  const hidden: number[] = [];
  for (let c = 0; c < w * h; c++) if (cells[c] === "." && !flagged.has(c) && !mines.includes(c)) hidden.push(c);
  if (!hidden.length) return null;
  let best = -1;
  let bestRisk = Infinity;
  for (const [c, r] of risk) {
    if (r >= 1 || mines.includes(c)) continue;
    const jitter = r + random() * 0.05;
    if (jitter < bestRisk) {
      bestRisk = jitter;
      best = c;
    }
  }
  const knownMines = cells.split("").filter((x) => x === "x").length + v.flags.length;
  const density = Math.max(0, v.mines - knownMines) / Math.max(1, hidden.length);
  if (best < 0 || bestRisk > density + 0.05) best = pick(hidden);
  return { type: "open", cell: best };
}

function botAction(s: MrState, botId: string, ctx: GameCtx): MrAction | null {
  if (s.phase !== "play") return null;
  const p = s.ids.indexOf(botId);
  if (p < 0) return null;
  const now = ctx.now();
  let mem = botMem.get(s);
  if (!mem) botMem.set(s, (mem = new Map()));
  const me = mem.get(botId) ?? { at: now + 400 + ctx.random() * 800, q: 0 };
  mem.set(botId, me);
  if (now < me.at) return null;
  const v = minerush.view(s, botId, ctx) as MrView;
  const row = v.ps[p];
  if (now < row.stun || now < row.frozen) return null;
  const move = botMove(v, Math.max(me.q, v.fq) + 1, ctx.random);
  if (move?.type === "flag") me.q = move.q;
  // Human-ish pace: flags are quick, digs need a little more thought.
  me.at = now + (move?.type === "flag" ? 350 + ctx.random() * 450 : 550 + ctx.random() * 900);
  return move;
}

// ---------- the game ----------

export const minerush: GameDef<MrState, MrAction> = {
  id: "minerush",

  setup(ctx) {
    const set = readSettings(config.settings, ctx.settings);
    const playMs = (Number(set.minutes) || PLAY_MS / 60_000) * 60_000;
    const n = ctx.players.length;
    const { w, h } = boardSize(n, set.board as BoardChoice);
    const size = w * h;
    const mineCount = Math.round(size * (MINE_RATES[set.mines as string] ?? MINE_RATES.normal));
    const now = ctx.now();
    const s: MrState = {
      w,
      h,
      mineCount,
      safeTotal: size - mineCount,
      mine: [],
      num: [],
      item: [],
      open: [],
      owner: new Array<number>(size).fill(-1),
      opened: 0,
      flagMask: new Array<number>(size).fill(0),
      flagCount: new Array<number>(n).fill(0),
      fq: new Array<number>(n).fill(0),
      ids: ctx.players.map((p) => p.id),
      ps: ctx.players.map(() => ({ score: 0, stun: 0, frozen: 0, frozenBy: -1 })),
      stats: ctx.players.map(() => ({ opened: 0, gems: 0, booms: 0, scans: 0, freezes: 0 })),
      claimed: [],
      phase: "ready",
      startsAt: now + READY_MS,
      endsAt: now + READY_MS + playMs,
      s: 0,
      enc: { key: "", cells: "", own: "" },
      aloneSince: null,
      syncAt: {},
      fin: null,
      why: null,
      openings: [],
    };
    layBoard(s, ctx, n);
    return s;
  },

  action(s, playerId, raw, ctx) {
    const a = raw as unknown;
    if (!a || typeof a !== "object" || Array.isArray(a)) return false;
    const { type, cell } = a as { type?: unknown; cell?: unknown };
    const p = s.ids.indexOf(playerId);
    if (p < 0) return false;
    if (type === "sync") return sendFull(s, playerId, ctx);
    if (type !== "open" && type !== "chord" && type !== "flag") return false;
    if (typeof cell !== "number" || !Number.isInteger(cell) || cell < 0 || cell >= s.w * s.h) return false;

    if (type === "flag") {
      const { on, q } = a as { on?: unknown; q?: unknown };
      if (typeof on !== "boolean" || typeof q !== "number" || !Number.isInteger(q) || q < 0 || q > MAX_Q) return false;
      s.fq[p] = Math.max(s.fq[p], q);
      if (s.phase !== "play" || blocked(s, p, ctx.now()) || s.open[cell] !== HIDDEN) return nack(ctx, playerId, { q });
      const bit = 1 << p;
      const has = (s.flagMask[cell] & bit) !== 0;
      if (has === on) return false;
      if (on && s.flagCount[p] >= s.mineCount) return nack(ctx, playerId, { q });
      s.flagMask[cell] ^= bit;
      s.flagCount[p] += on ? 1 : -1;
      return false; // private: no broadcast, the client already shows it
    }

    if (s.phase !== "play" || blocked(s, p, ctx.now())) return nack(ctx, playerId, { c: cell });
    const bit = 1 << p;
    let targets: number[];
    if (type === "open") {
      if (s.open[cell] !== HIDDEN || s.flagMask[cell] & bit) return nack(ctx, playerId, { c: cell });
      targets = [cell];
    } else {
      // Chord: an open number with exactly that many of your flags around it opens the rest.
      if (s.open[cell] !== OPEN || s.num[cell] === 0) return nack(ctx, playerId, { c: cell });
      const around = neighbors(s.w, s.h, cell);
      const flagged = around.filter((nb) => s.open[nb] === HIDDEN && s.flagMask[nb] & bit).length;
      targets = around.filter((nb) => s.open[nb] === HIDDEN && !(s.flagMask[nb] & bit));
      if (flagged !== s.num[cell] || !targets.length) return nack(ctx, playerId, { c: cell });
    }
    if (!reveal(s, p, cell, targets, ctx)) return nack(ctx, playerId, { c: cell });
    if (s.opened >= s.safeTotal) {
      finish(s, ctx, "cleared");
      return true; // the final board goes out to everyone
    }
    return false; // the op event already told everyone
  },

  spectatorAction(s, viewerId, a, ctx) {
    if (!a || typeof a !== "object" || (a as { type?: unknown }).type !== "sync") return false;
    return sendFull(s, viewerId, ctx);
  },

  tick(s, ctx) {
    if (s.phase === "over") return false;
    const now = ctx.now();
    if (s.aloneSince !== null && now >= s.aloneSince + ABANDON_MS) {
      finish(s, ctx, "abandoned");
      return true;
    }
    if (s.phase === "ready" && now >= s.startsAt) {
      s.phase = "play";
      return true;
    }
    if (s.phase === "play" && now >= s.endsAt) {
      finish(s, ctx, "time");
      return true;
    }
    return false;
  },
  tickMs: 250,

  bot(s, botId, ctx) {
    return botAction(s, botId, ctx);
  },

  playerLeft(s, _id, ctx) {
    updateAlone(s, ctx);
  },

  playerReturned(s, _id, ctx) {
    updateAlone(s, ctx);
  },

  view(s, viewerId): MrView {
    const { cells, own } = encode(s);
    const you = s.ids.indexOf(viewerId);
    const flags: number[] = [];
    if (you >= 0 && s.flagCount[you] > 0) {
      const bit = 1 << you;
      for (let i = 0; i < s.flagMask.length; i++) if (s.flagMask[i] & bit) flags.push(i);
    }
    return {
      phase: s.phase,
      w: s.w,
      h: s.h,
      mines: s.mineCount,
      safe: s.safeTotal,
      opened: s.opened,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      home: s.openings[0] ?? 0,
      s: s.s,
      cells,
      own,
      items: s.claimed,
      ids: s.ids,
      ps: s.ps,
      you,
      flags,
      fq: you >= 0 ? s.fq[you] : 0,
      fin: s.fin,
      why: s.why,
      abandonAt: s.aloneSince === null ? null : s.aloneSince + ABANDON_MS,
    };
  },
};

/** Reply to a "sync": the full view, to that viewer only (rate-limited). */
function sendFull(s: MrState, viewerId: string, ctx: GameCtx) {
  const now = ctx.now();
  if (now - (s.syncAt[viewerId] ?? 0) < SYNC_EVERY_MS) return false;
  if (Object.keys(s.syncAt).length > 64) s.syncAt = {};
  s.syncAt[viewerId] = now;
  ctx.emit({ t: "full", v: minerush.view(s, viewerId, ctx) }, { to: viewerId });
  return false;
}

export default minerush;
