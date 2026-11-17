import type { GameCtx, GameDef } from "../../shared/game";
import { readSettings } from "../../shared/settings";
import { config } from "./config";
import {
  AWAY_MS,
  FLEETS,
  FORFEIT_MS,
  PLACE_MS,
  SALVO,
  TURN_MS,
  fleetOk,
  randomFill,
  revealMs,
  shipCells,
  type Ship,
} from "./shared";

// Salvo: two players hide a fleet on their own grid, then take turns firing a
// salvo of shots at each other's waters. Ship positions are the only secret:
// view() sends a player their own fleet, and everyone only the ships already
// sunk (all fleets are revealed once the match is over). Shots and results are
// public. Timers are absolute deadlines in state; tick() moves things along:
//   place   -> both confirm (or the clock runs out: the rest is placed at random)
//   turn    -> the mover fires (or the clock runs out: their aimed shots plus random ones fire)
//   resolve -> a short pause while clients animate the shells landing
//   over
// A disconnected mover is fired for after AWAY_MS; someone gone a full minute
// forfeits; with both gone the turn freezes (nobody is waiting).

export type Seat = 0 | 1;
export type Phase = "place" | "turn" | "resolve" | "over";
export type Mode = "fixed" | "fleet";
export type Ending = "sunk" | "forfeit" | "abandoned" | "short";

export interface LastSalvo {
  /** Who fired. The shots landed in the other seat's waters. */
  seat: Seat;
  cells: number[];
  /** Per shot: true = hit. */
  hits: boolean[];
  /** Ships sunk by this salvo: ship index and which shot (index into cells) finished it. */
  sunk: { ship: number; shot: number }[];
  /** True when the server fired it (timer ran out or the mover was away). */
  auto: boolean;
  /** Server time it was fired (clients animate relative to this). */
  at: number;
}

export interface SalvoState {
  seats: [string, string];
  n: number;
  lens: number[];
  mode: Mode;
  phase: Phase;
  /** Each seat's fleet: placed ships (a draft until ready), null where not placed yet. */
  fleets: [(Ship | null)[], (Ship | null)[]];
  ready: [boolean, boolean];
  /** Shots that landed in each seat's waters: 0 unknown, 1 miss, 2 hit. */
  shots: [number[], number[]];
  sunk: [boolean[], boolean[]];
  turn: Seat;
  /** Salvos fired so far; identifies the current turn for clients. */
  seq: number;
  last: LastSalvo | null;
  /** Cells the mover has aimed at (fired for them on a timeout). Never sent to the other seat. */
  aim: number[];
  endsAt: number;
  timerMs: number;
  turnStartedAt: number;
  turnMs: number;
  awaySince: [number | null, number | null];
  champion: Seat | null;
  ending: Ending | null;
  quitter: Seat | null;
  /** Shots fired and hits scored per seat. */
  fired: [number, number];
  hitCount: [number, number];
  salvos: [number, number];
  /** Anti-spam budget for aim/draft messages. */
  spamWindow: number;
  spamCount: number;
}

export type SalvoAction =
  | {
      type: "place";
      ships: (Pick<Ship, "r" | "c" | "d"> | null)[];
      ready: boolean;
    }
  | { type: "unready" }
  | { type: "aim"; cells: number[] }
  | { type: "fire"; cells: number[] };

/** Transient event: where the mover is aiming (sent to everyone but the mover). */
export interface AimEvent {
  type: "aim";
  seat: Seat;
  cells: number[];
  seq: number;
}

export interface ShipView extends Ship {
  /** Index into the fleet (for names). */
  i: number;
}

export interface SalvoView {
  seats: [string, string];
  n: number;
  lens: number[];
  mode: Mode;
  phase: Phase;
  /** Shots in each seat's waters: "." unknown, "o" miss, "x" hit. */
  boards: [string, string];
  /** Ships the viewer may see per seat: their own fleet, everyone's sunk ships, all once over. */
  ships: [ShipView[], ShipView[]];
  sunk: [boolean[], boolean[]];
  ready: [boolean, boolean];
  turn: Seat;
  seq: number;
  last: LastSalvo | null;
  /** Shots the mover fires this turn. */
  shotsNow: number;
  endsAt: number;
  timerMs: number;
  forfeitAt: [number | null, number | null];
  champion: Seat | null;
  ending: Ending | null;
  quitter: Seat | null;
  fired: [number, number];
  hitCount: [number, number];
  salvos: [number, number];
  /** The viewer's own pending aim (so a reload keeps it), only on their turn. */
  myAim: number[];
  you: Seat | null;
}

const SEATS: readonly Seat[] = [0, 1];
const SPAM_BURST = 30;

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
const bothAway = (s: SalvoState) => s.awaySince[0] !== null && s.awaySince[1] !== null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
}

function seatOf(s: SalvoState, id: unknown): Seat | null {
  if (typeof id !== "string" || !id) return null;
  if (id === s.seats[0]) return 0;
  if (id === s.seats[1]) return 1;
  return null;
}

function nameOf(s: SalvoState, seat: Seat, ctx: GameCtx): string {
  return ctx.player(s.seats[seat])?.name ?? `Player ${seat + 1}`;
}

function afloat(s: SalvoState, seat: Seat): number {
  return s.sunk[seat].filter((x) => !x).length;
}

/** Unknown cells left in a seat's waters. */
function openCells(s: SalvoState, target: Seat): number[] {
  const out: number[] = [];
  s.shots[target].forEach((v, i) => v === 0 && out.push(i));
  return out;
}

/** Shots `seat` fires this turn: 3, or one per ship still afloat; never more than open cells. */
export function shotsFor(s: SalvoState, seat: Seat): number {
  const base = s.mode === "fleet" ? afloat(s, seat) : SALVO;
  return Math.max(1, Math.min(base, openCells(s, other(seat)).length));
}

/** A cell list: distinct ints on the grid, each still unknown in the target's waters. */
function validCells(s: SalvoState, target: Seat, raw: unknown, max: number): number[] | null {
  if (!Array.isArray(raw) || raw.length > max) return null;
  const seen = new Set<number>();
  for (const v of raw) {
    if (!isInt(v, 0, s.n * s.n - 1) || seen.has(v) || s.shots[target][v] !== 0) return null;
    seen.add(v);
  }
  return [...seen];
}

/** A fleet message: one entry per ship, each null or {r, c, d}; lengths come from the fleet. */
function parseFleet(s: SalvoState, raw: unknown): (Ship | null)[] | null {
  if (!Array.isArray(raw) || raw.length !== s.lens.length) return null;
  const out: (Ship | null)[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (v === null) {
      out.push(null);
      continue;
    }
    if (!isRecord(v) || !isInt(v.r, 0, s.n - 1) || !isInt(v.c, 0, s.n - 1) || (v.d !== 0 && v.d !== 1)) return null;
    out.push({ r: v.r, c: v.c, d: v.d, len: s.lens[i] });
  }
  return fleetOk(out, s.n) ? out : null;
}

function spamOk(s: SalvoState, ctx: GameCtx): boolean {
  const now = ctx.now();
  if (now - s.spamWindow >= 1000) {
    s.spamWindow = now;
    s.spamCount = 0;
  }
  if (s.spamCount >= SPAM_BURST) return false;
  s.spamCount += 1;
  return true;
}

// ---------- clocks ----------

function setClock(s: SalvoState) {
  if (s.phase === "place") {
    const full = s.turnStartedAt + PLACE_MS;
    s.endsAt = full;
    s.timerMs = PLACE_MS;
    // A disconnected player who hasn't confirmed gets a random fleet after AWAY_MS.
    for (const seat of SEATS) {
      const away = s.awaySince[seat];
      if (away !== null && !s.ready[seat]) s.endsAt = Math.min(s.endsAt, Math.max(s.turnStartedAt, away) + AWAY_MS);
    }
    return;
  }
  if (s.phase !== "turn") return;
  const full = s.turnStartedAt + s.turnMs;
  const away = s.awaySince[s.turn];
  if (away === null) {
    s.endsAt = full;
    s.timerMs = s.turnMs;
  } else {
    s.endsAt = Math.min(full, Math.max(s.turnStartedAt, away) + AWAY_MS);
    s.timerMs = AWAY_MS;
  }
}

function beginTurn(s: SalvoState, seat: Seat, ctx: GameCtx) {
  s.phase = "turn";
  s.turn = seat;
  s.aim = [];
  s.turnStartedAt = ctx.now();
  setClock(s);
}

// ---------- placement ----------

/** Confirm a seat's fleet, filling unplaced ships at random. */
function lockFleet(s: SalvoState, seat: Seat, ctx: GameCtx) {
  s.fleets[seat] = randomFill(s.fleets[seat], s.lens, s.n, ctx.random);
  s.ready[seat] = true;
}

function maybeStart(s: SalvoState, ctx: GameCtx) {
  if (s.phase !== "place" || !s.ready[0] || !s.ready[1]) return;
  beginTurn(s, s.turn, ctx);
}

// ---------- firing ----------

function fire(s: SalvoState, seat: Seat, cells: number[], auto: boolean, ctx: GameCtx) {
  const target = other(seat);
  const fleet = s.fleets[target] as Ship[];
  const cellShip = new Map<number, number>();
  fleet.forEach((ship, i) => shipCells(ship, s.n).forEach((c) => cellShip.set(c, i)));
  const hits: boolean[] = [];
  const sunk: { ship: number; shot: number }[] = [];
  cells.forEach((cell, k) => {
    const ship = cellShip.get(cell);
    const hit = ship !== undefined;
    hits.push(hit);
    s.shots[target][cell] = hit ? 2 : 1;
    if (hit && !s.sunk[target][ship]) {
      if (shipCells(fleet[ship], s.n).every((c) => s.shots[target][c] === 2)) {
        s.sunk[target][ship] = true;
        sunk.push({ ship, shot: k });
      }
    }
  });
  s.fired[seat] += cells.length;
  s.hitCount[seat] += hits.filter(Boolean).length;
  s.salvos[seat] += 1;
  s.seq += 1;
  s.aim = [];
  s.last = { seat, cells, hits, sunk, auto, at: ctx.now() };
  s.phase = "resolve";
  s.endsAt = ctx.now() + revealMs(cells.length);
  s.timerMs = revealMs(cells.length);
}

/** Timer ran out (or the mover is away): fire what they aimed at plus random open cells. */
function autoFire(s: SalvoState, ctx: GameCtx) {
  const target = other(s.turn);
  const need = shotsFor(s, s.turn);
  const chosen = s.aim.filter((c) => s.shots[target][c] === 0).slice(0, need);
  const open = openCells(s, target).filter((c) => !chosen.includes(c));
  while (chosen.length < need && open.length) {
    const k = Math.min(open.length - 1, Math.floor(ctx.random() * open.length));
    chosen.push(open.splice(k, 1)[0]);
  }
  fire(s, s.turn, chosen, true, ctx);
}

function afterReveal(s: SalvoState, ctx: GameCtx) {
  const shooter = s.last?.seat ?? s.turn;
  const target = other(shooter);
  if (s.sunk[target].every(Boolean)) return endMatch(s, shooter, "sunk", ctx);
  beginTurn(s, target, ctx);
}

// ---------- presence ----------

function seatLeft(s: SalvoState, seat: Seat, ctx: GameCtx) {
  if (s.phase === "over" || s.awaySince[seat] !== null) return;
  s.awaySince[seat] = ctx.now();
  setClock(s);
  if (s.phase === "turn" && s.turn === seat) {
    const ev: AimEvent = { type: "aim", seat, cells: [], seq: s.seq };
    ctx.emit(ev, { except: s.seats[seat] });
  }
}

function seatReturned(s: SalvoState, seat: Seat, ctx: GameCtx) {
  const since = s.awaySince[seat];
  if (s.phase === "over" || since === null) return;
  const now = ctx.now();
  if (now - since >= FORFEIT_MS) {
    const otherSince = s.awaySince[other(seat)];
    if (otherSince !== null && now - otherSince >= FORFEIT_MS) endMatch(s, null, "abandoned", ctx);
    else endMatch(s, other(seat), "forfeit", ctx, seat);
    return;
  }
  const wasFrozen = bothAway(s);
  s.awaySince[seat] = null;
  if (checkForfeit(s, ctx, now)) return;
  if (s.phase === "turn" && wasFrozen) beginTurn(s, s.turn, ctx);
  else setClock(s);
}

function checkForfeit(s: SalvoState, ctx: GameCtx, now: number): boolean {
  if (s.phase === "over") return false;
  for (const seat of SEATS) {
    const since = s.awaySince[seat];
    if (since === null || now - since < FORFEIT_MS) continue;
    const otherSince = s.awaySince[other(seat)];
    if (otherSince === null) {
      endMatch(s, other(seat), "forfeit", ctx, seat);
      return true;
    }
    if (now - otherSince >= FORFEIT_MS) {
      endMatch(s, null, "abandoned", ctx);
      return true;
    }
  }
  return false;
}

function syncPresence(s: SalvoState, ctx: GameCtx): boolean {
  let changed = false;
  for (const seat of SEATS) {
    const p = ctx.player(s.seats[seat]);
    const away = !p || !p.connected;
    if (away === (s.awaySince[seat] !== null)) continue;
    changed = true;
    if (away) seatLeft(s, seat, ctx);
    else seatReturned(s, seat, ctx);
  }
  return changed;
}

function endMatch(s: SalvoState, winner: Seat | null, ending: Ending, ctx: GameCtx, quitter: Seat | null = null) {
  if (s.phase === "over") return;
  s.phase = "over";
  s.champion = winner;
  s.ending = ending;
  s.quitter = quitter;
  s.endsAt = 0;
  s.timerMs = 0;
  s.aim = [];
  // Fleets that were never confirmed still need to exist for the reveal.
  for (const seat of SEATS)
    if (s.seats[seat] && !s.ready[seat]) s.fleets[seat] = randomFill(s.fleets[seat], s.lens, s.n, ctx.random);

  const sunkBy = (seat: Seat) => s.sunk[other(seat)].filter(Boolean).length;
  let headline: string;
  if (ending === "short") headline = "Salvo needs 2 players";
  else if (ending === "abandoned") headline = "Salvo abandoned: both players left";
  else if (winner === null) headline = "Salvo ends in a draw";
  else if (ending === "forfeit")
    headline = `${nameOf(s, winner, ctx)} wins Salvo (${nameOf(s, other(winner), ctx)} left)`;
  else {
    const acc = s.fired[winner] ? Math.round((s.hitCount[winner] / s.fired[winner]) * 100) : 0;
    headline = `${nameOf(s, winner, ctx)} sinks the whole fleet in ${s.salvos[winner]} salvos (${acc}% hits)`;
  }
  const scores: Record<string, number> = {};
  for (const seat of SEATS) if (s.seats[seat]) scores[s.seats[seat]] = sunkBy(seat);
  ctx.end({
    winners: winner === null ? [] : [s.seats[winner]].filter(Boolean),
    headline,
    scores,
  });
}

// ---------- practice bot ----------
// Hunt / target with a placement-density map, built only from what the bot's
// seat can see: its own shots (miss / hit) and which enemy ships are sunk.
// Every way each unsunk ship could still lie (not over a miss or a sunk ship)
// adds weight to the cells it covers; placements through unexplained hits
// count far more, so after a hit it works along the ship (target mode), and
// otherwise it hunts the most likely open water. Medium strength: now and then
// it takes a good-but-not-best cell, and it spreads a salvo's shots apart
// while hunting. Paced like a human (thinks 1-2.5s; places in 2-4s).

export function botTargets(
  board: number[],
  n: number,
  lens: number[],
  sunkShips: Ship[],
  sunk: boolean[],
  count: number,
  random: () => number,
): number[] {
  const blocked = new Set<number>();
  for (const sh of sunkShips) for (const c of shipCells(sh, n)) blocked.add(c);
  const hitOpen = new Set<number>();
  board.forEach((v, i) => {
    if (v === 2 && !blocked.has(i)) hitOpen.add(i);
  });
  const weight = new Array<number>(n * n).fill(0);
  const remaining = lens.filter((_, i) => !sunk[i]);
  for (const len of remaining) {
    for (const d of [0, 1] as const) {
      for (let r = 0; r < (d ? n - len + 1 : n); r++) {
        for (let c = 0; c < (d ? n : n - len + 1); c++) {
          const cells = shipCells({ r, c, d, len }, n);
          let ok = true;
          let through = 0;
          for (const i of cells) {
            if (board[i] === 1 || blocked.has(i)) {
              ok = false;
              break;
            }
            if (hitOpen.has(i)) through++;
          }
          if (!ok) continue;
          const w = through ? 40 * through * through : 1;
          for (const i of cells) if (board[i] === 0) weight[i] += w;
        }
      }
    }
  }
  const targeting = hitOpen.size > 0;
  const picks: number[] = [];
  for (let k = 0; k < count; k++) {
    const ranked: { i: number; w: number }[] = [];
    for (let i = 0; i < n * n; i++) {
      if (board[i] !== 0 || picks.includes(i)) continue;
      let w = weight[i] + random() * 0.5;
      // While hunting, spread a salvo's shots apart so they cover more water.
      if (!targeting) {
        for (const p of picks) {
          const dist = Math.abs((p % n) - (i % n)) + Math.abs(Math.floor(p / n) - Math.floor(i / n));
          if (dist < 3) w *= 0.4;
        }
      }
      ranked.push({ i, w });
    }
    if (!ranked.length) break;
    ranked.sort((a, b) => b.w - a.w);
    // Medium: usually the best cell, sometimes one of the next few.
    const slip = !targeting && random() < 0.3 ? Math.floor(random() * Math.min(6, ranked.length)) : 0;
    picks.push(ranked[slip].i);
  }
  return picks;
}

const botMemory = new WeakMap<SalvoState, Map<string, { key: string; at: number }>>();

function botMove(s: SalvoState, botId: string, ctx: GameCtx): SalvoAction | null {
  const me = seatOf(s, botId);
  if (me === null) return null;
  let mem = botMemory.get(s);
  if (!mem) botMemory.set(s, (mem = new Map()));
  const now = ctx.now();
  const key = s.phase === "place" ? "place" : s.phase === "turn" && s.turn === me ? `turn-${s.seq}` : null;
  if (key === null || (s.phase === "place" && s.ready[me])) return null;
  const m = mem.get(botId);
  if (!m || m.key !== key) {
    const think = s.phase === "place" ? 2000 + ctx.random() * 2000 : 1000 + ctx.random() * 1500;
    mem.set(botId, { key, at: now + think });
    return null;
  }
  if (now < m.at) return null;
  if (s.phase === "place") {
    const fleet = randomFill([], s.lens, s.n, ctx.random);
    return {
      type: "place",
      ships: fleet.map(({ r, c, d }) => ({ r, c, d })),
      ready: true,
    };
  }
  // Only public information: the shots in the enemy's waters and their sunk ships.
  const target = other(me);
  const fleet = s.fleets[target] as Ship[];
  const sunkShips = fleet.filter((_, i) => s.sunk[target][i]);
  const cells = botTargets(s.shots[target], s.n, s.lens, sunkShips, s.sunk[target], shotsFor(s, me), ctx.random);
  return { type: "fire", cells };
}

// ---------- the game ----------

export const salvo: GameDef<SalvoState, SalvoAction> = {
  id: "salvo",

  setup(ctx) {
    const [a, b] = ctx.players;
    const settings = readSettings(config.settings, ctx.settings);
    const n = Number(settings.grid) === 8 ? 8 : 10;
    const lens = FLEETS[n].map((f) => f.len);
    const mode: Mode = settings.salvo === "fleet" ? "fleet" : "fixed";
    const turnMs = (Number(settings.turn) || TURN_MS / 1000) * 1000;
    const now = ctx.now();
    return {
      seats: [a?.id ?? "", b?.id ?? ""],
      n,
      lens,
      mode,
      phase: "place",
      fleets: [lens.map(() => null), lens.map(() => null)],
      ready: [false, false],
      shots: [new Array<number>(n * n).fill(0), new Array<number>(n * n).fill(0)],
      sunk: [lens.map(() => false), lens.map(() => false)],
      turn: ctx.random() < 0.5 ? 0 : 1,
      seq: 0,
      last: null,
      aim: [],
      endsAt: now + PLACE_MS,
      timerMs: PLACE_MS,
      turnStartedAt: now,
      turnMs,
      awaySince: [null, null],
      champion: null,
      ending: null,
      quitter: null,
      fired: [0, 0],
      hitCount: [0, 0],
      salvos: [0, 0],
      spamWindow: 0,
      spamCount: 0,
    };
  },

  action(s, playerId, raw, ctx) {
    if (s.phase === "over" || !s.seats[0] || !s.seats[1] || !isRecord(raw)) return false;
    const seat = seatOf(s, playerId);
    if (seat === null) return false;

    if (raw.type === "place") {
      if (s.phase !== "place" || s.ready[seat] || typeof raw.ready !== "boolean") return false;
      const fleet = parseFleet(s, raw.ships);
      if (!fleet || (raw.ready && fleet.some((x) => x === null))) return false;
      if (!raw.ready && !spamOk(s, ctx)) return false;
      s.fleets[seat] = fleet;
      if (raw.ready) {
        s.ready[seat] = true;
        setClock(s);
        maybeStart(s, ctx);
        return true;
      }
      return false; // a draft: nothing anyone else can see changed
    }

    if (raw.type === "unready") {
      if (s.phase !== "place" || !s.ready[seat]) return false;
      s.ready[seat] = false;
      setClock(s);
      return true;
    }

    if (s.phase !== "turn" || seat !== s.turn) return false;
    const need = shotsFor(s, seat);

    if (raw.type === "aim") {
      const cells = validCells(s, other(seat), raw.cells, need);
      if (!cells || !spamOk(s, ctx)) return false;
      s.aim = cells;
      const ev: AimEvent = { type: "aim", seat, cells, seq: s.seq };
      ctx.emit(ev, { except: playerId });
      return false;
    }

    if (raw.type === "fire") {
      const cells = validCells(s, other(seat), raw.cells, need);
      if (!cells || cells.length !== need) return false;
      fire(s, seat, cells, false, ctx);
      return true;
    }
    return false;
  },

  tick(s, ctx) {
    if (s.phase === "over") return false;
    if (!s.seats[0] || !s.seats[1]) {
      endMatch(s, null, "short", ctx);
      return true;
    }
    const now = ctx.now();
    const changed = syncPresence(s, ctx);
    if (s.ending !== null) return true;
    if (checkForfeit(s, ctx, now)) return true;

    if (s.phase === "place" && now >= s.endsAt) {
      // Lock in whoever ran out of time (or is away); the rest keep the full clock.
      const full = now >= s.turnStartedAt + PLACE_MS;
      for (const seat of SEATS) if (!s.ready[seat] && (full || s.awaySince[seat] !== null)) lockFleet(s, seat, ctx);
      setClock(s);
      maybeStart(s, ctx);
      return true;
    }
    if (s.phase === "resolve" && now >= s.endsAt) {
      afterReveal(s, ctx);
      return true;
    }
    if (s.phase === "turn" && now >= s.endsAt && !bothAway(s)) {
      autoFire(s, ctx);
      return true;
    }
    return changed;
  },
  tickMs: 200,

  view(s, viewerId): SalvoView {
    const over = s.phase === "over";
    const you = seatOf(s, viewerId);
    const shipsFor = (seat: Seat): ShipView[] => {
      const out: ShipView[] = [];
      s.fleets[seat].forEach((ship, i) => {
        if (ship && (over || seat === you || s.sunk[seat][i])) out.push({ ...ship, i });
      });
      return out;
    };
    const board = (seat: Seat) => s.shots[seat].map((v) => (v === 2 ? "x" : v === 1 ? "o" : ".")).join("");
    const forfeitAt = (seat: Seat) => {
      const since = s.awaySince[seat];
      return over || since === null ? null : since + FORFEIT_MS;
    };
    return {
      seats: s.seats,
      n: s.n,
      lens: s.lens,
      mode: s.mode,
      phase: s.phase,
      boards: [board(0), board(1)],
      ships: [shipsFor(0), shipsFor(1)],
      sunk: s.sunk,
      ready: s.ready,
      turn: s.turn,
      seq: s.seq,
      last: s.last,
      shotsNow: s.phase === "turn" ? shotsFor(s, s.turn) : 0,
      endsAt: s.endsAt,
      timerMs: s.timerMs,
      forfeitAt: [forfeitAt(0), forfeitAt(1)],
      champion: s.champion,
      ending: s.ending,
      quitter: s.quitter,
      fired: s.fired,
      hitCount: s.hitCount,
      salvos: s.salvos,
      myAim: s.phase === "turn" && you === s.turn ? s.aim : [],
      you,
    };
  },

  playerLeft(s, playerId, ctx) {
    const seat = seatOf(s, playerId);
    if (seat !== null) seatLeft(s, seat, ctx);
  },

  playerReturned(s, playerId, ctx) {
    const seat = seatOf(s, playerId);
    if (seat !== null) seatReturned(s, seat, ctx);
  },

  bot: botMove,
};

export default salvo;
