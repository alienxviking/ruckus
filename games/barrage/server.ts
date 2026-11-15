import { shuffle, type GameCtx, type GameDef } from "../../shared/game";
import {
  ABYSS_Y,
  AIM_MS,
  COL,
  COLS,
  DT,
  FIRE_MS,
  FIRST_AIM_MS,
  FORFEIT_MS,
  FUEL,
  GRAVITY,
  H,
  HIT_R,
  MAX_HP,
  MAX_MOVE,
  MAX_POWER,
  MAX_STEPS,
  MAX_TURNS,
  MAX_WIND,
  MAX_X,
  MIN_POWER,
  MIN_X,
  MOVE_MS,
  SPLIT_SPREAD,
  STEP_MS,
  TAIL_MS,
  TANK_R,
  W,
  WEAPONS,
  WEAPON_LIST,
  WIND_ACCEL,
  blastDamage,
  carve,
  clamp,
  encodeRuns,
  groundAt,
  launch,
  tankCy,
  type Aim,
  type Weapon,
} from "./shared";

// Barrage: everyone aims in secret, then every shell flies at once.
//
// The server simulates each volley in one go when the AIM phase ends (fixed 1/60 s steps, all
// shells in lockstep, craters carved the moment they happen) and records what happened as a
// compact timeline: subsampled shell paths, explosions with the damage they dealt, and deaths.
// Clients replay that timeline against a shared clock (resolve.at), so every screen shows the
// same shell in the same place at the same moment.

export type Phase = "aim" | "resolve" | "final";
export type DeathCause = "hp" | "abyss";
/** "bomb" = one of a splitter's three bomblets. */
export type Ordnance = Weapon | "bomb";

interface Tank {
  id: string;
  x: number;
  hp: number;
  alive: boolean;
  why: DeathCause | null;
  diedTurn: number | null;
  fuel: number;
  heavy: number;
  split: number;
  locked: boolean;
  /** Angle of the last shot fired (public; pending aims are secret). */
  angle: number;
  /** Pending shot for this turn (secret until it's fired). */
  aim: Aim;
  dealt: number;
  kills: number;
}

export interface ShellPath {
  /** Firing tank's slot (index in `tanks`). */
  s: number;
  w: Ordnance;
  /** First step and number of steps flown. Step k happens at FIRE_MS + k × STEP_MS. */
  a: number;
  n: number;
  /** Flat int [x, y, ...]: the position every `every` steps from `a`, then the end point (step a + n). */
  p: number[];
  /** How the flight ended: "b" boom, "l" lost off the map, "s" split into bomblets. */
  e: "b" | "l" | "s";
}

export interface Boom {
  /** Step of the explosion. */
  t: number;
  x: number;
  y: number;
  r: number;
  w: Ordnance;
  /** Slot that fired it. */
  s: number;
  /** HP taken: flat [slot, dmg, slot, dmg, ...]. */
  d: number[];
  /** Slot of a tank it hit directly, or -1. */
  hit: number;
}

export interface Death {
  t: number;
  s: number;
  why: DeathCause;
  /** Slot whose shell did it. */
  by: number;
}

export interface ResolveView {
  /** Server time of t = 0 of the timeline. */
  at: number;
  /** Total length (ms), including the linger at the end. */
  dur: number;
  /** Shell paths keep every `every`-th step. */
  every: number;
  wind: number;
  /** Per slot, before the volley: [x, hp, alive (0/1), angle]. */
  from: number[][];
  /** [slot, fromX, toX] (driven during the first MOVE_MS). */
  moves: number[][];
  /** [slot, angle, power, weapon index]: the shots everyone fired. */
  aims: number[][];
  shells: ShellPath[];
  booms: Boom[];
  deaths: Death[];
}

export type EndReason = "last" | "draw" | "turns" | "forfeit";

export interface FinalInfo {
  winners: string[];
  reason: EndReason;
}

export interface BarrageState {
  phase: Phase;
  turn: number;
  wind: number;
  endsAt: number;
  total: number;
  terrain: number[];
  /** 1 = the grass there has been blown away. */
  burnt: number[];
  tanks: Tank[];
  resolve: ResolveView | null;
  /** Terrain as it was before the volley being shown. */
  before: { terrain: number[]; burnt: number[] } | null;
  final: FinalInfo | null;
  /** Since when fewer than two live tanks have a connected driver (AIM phase only). */
  awaySince: number | null;
  over: boolean;
}

export interface TankView {
  id: string;
  x: number;
  hp: number;
  alive: boolean;
  why: DeathCause | null;
  diedTurn: number | null;
  fuel: number;
  heavy: number;
  split: number;
  locked: boolean;
  angle: number;
  dealt: number;
  kills: number;
}

export interface BarrageView {
  phase: Phase;
  turn: number;
  maxTurns: number;
  wind: number;
  endsAt: number;
  total: number;
  /** Ground heights (during RESOLVE: as they were before the volley). */
  terrain: number[];
  /** Burnt column runs, flat [from, to, ...] (during RESOLVE: before the volley). */
  burnt: number[];
  /** Tanks as they are now (during RESOLVE: after the volley; replay `resolve` to get there). */
  tanks: TankView[];
  /** Your pending shot (AIM phase, live tank only). */
  aim: Aim | null;
  resolve: ResolveView | null;
  final: FinalInfo | null;
  /** If not null, the game wraps up at this time unless players come back. */
  awayAt: number | null;
}

export type BarrageAction =
  | ({ type: "aim" } & Partial<Aim>)
  | ({ type: "fire" } & Partial<Aim>);

const MARGIN = 50;
/** Most path numbers one volley may send (keeps the RESOLVE view well under 25 KB). */
const PATH_BUDGET = 4000;
const STRIDES = [3, 4, 6, 8, 12, 16];
/** A shell can't hit the tank that fired it during its first few steps. */
const SAFE_STEPS = 6;

const connected = (ctx: GameCtx, id: string) => ctx.player(id)?.connected !== false;
const randInt = (random: () => number, lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));

// ---------- terrain ----------

/** Rolling hills from layered smooth value noise. Heights between y = 180 and y = 500. */
export function genTerrain(random: () => number): number[] {
  const raw = new Array<number>(COLS).fill(0);
  const octaves: [number, number][] = [
    [2 + Math.floor(random() * 2), 1],
    [5 + Math.floor(random() * 3), 0.45],
    [13, 0.18],
    [31, 0.06],
  ];
  for (const [cells, amp] of octaves) {
    const v = Array.from({ length: cells + 2 }, () => random() * 2 - 1);
    const off = random();
    for (let c = 0; c < COLS; c++) {
      const u = (c / (COLS - 1)) * cells + off;
      const k = Math.floor(u);
      const f = u - k;
      const s = (1 - Math.cos(f * Math.PI)) / 2;
      raw[c] += (v[k] + (v[k + 1] - v[k]) * s) * amp;
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of raw) {
    lo = Math.min(lo, r);
    hi = Math.max(hi, r);
  }
  const top = 195 + random() * 70;
  const bottom = 430 + random() * 60;
  return raw.map((r) => clamp(Math.round(bottom - ((r - lo) / (hi - lo || 1)) * (bottom - top)), 180, 500));
}

/** Smooth a little ledge under each spawn point so nobody starts on a cliff face. */
function flattenAt(t: number[], x: number) {
  const cc = Math.round(x / COL);
  let sum = 0;
  let n = 0;
  for (let c = cc - 5; c <= cc + 5; c++) {
    if (c < 0 || c >= COLS) continue;
    sum += t[c];
    n++;
  }
  const avg = sum / Math.max(1, n);
  for (let c = cc - 9; c <= cc + 9; c++) {
    if (c < 0 || c >= COLS) continue;
    const w = Math.min(1, Math.max(0, 1 - (Math.abs(c - cc) - 4) / 6));
    t[c] = clamp(Math.round(t[c] + (avg - t[c]) * w), 180, 500);
  }
}

// ---------- setup ----------

function defaultAim(x: number): Aim {
  return { angle: x < W / 2 ? 55 : 125, power: 60, weapon: "shell", move: 0 };
}

function newTank(id: string, x: number): Tank {
  const aim = defaultAim(x);
  return {
    id,
    x,
    hp: MAX_HP,
    alive: true,
    why: null,
    diedTurn: null,
    fuel: FUEL,
    heavy: WEAPONS.heavy.ammo,
    split: WEAPONS.split.ammo,
    locked: false,
    angle: aim.angle,
    aim,
    dealt: 0,
    kills: 0,
  };
}

// ---------- actions ----------

/** The aim after applying the fields in `a`, or null when any field is bad (or none given). */
function parseAim(tank: Tank, a: Record<string, unknown>, allowEmpty: boolean): Aim | null {
  const next: Aim = { ...tank.aim };
  let any = false;
  if ("angle" in a) {
    const v = a.angle;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 180) return null;
    next.angle = v;
    any = true;
  }
  if ("power" in a) {
    const v = a.power;
    if (typeof v !== "number" || !Number.isInteger(v) || v < MIN_POWER || v > MAX_POWER) return null;
    next.power = v;
    any = true;
  }
  if ("weapon" in a) {
    const v = a.weapon;
    if (typeof v !== "string" || !(WEAPON_LIST as readonly string[]).includes(v)) return null;
    const w = v as Weapon;
    if ((w === "heavy" && tank.heavy <= 0) || (w === "split" && tank.split <= 0)) return null;
    next.weapon = w;
    any = true;
  }
  if ("move" in a) {
    const v = a.move;
    if (typeof v !== "number" || !Number.isInteger(v) || v < -MAX_MOVE || v > MAX_MOVE) return null;
    next.move = Math.sign(v) * Math.min(Math.abs(v), tank.fuel);
    any = true;
  }
  return any || allowEmpty ? next : null;
}

const sameAim = (a: Aim, b: Aim) => a.angle === b.angle && a.power === b.power && a.weapon === b.weapon && a.move === b.move;

function liveDrivers(s: BarrageState, ctx: GameCtx) {
  return s.tanks.filter((t) => t.alive && connected(ctx, t.id));
}

// ---------- the volley ----------

/** Drive up to |move| units (and fuel), stopping at the map edges and at the lip of a bottomless pit. */
function drive(t: number[], x: number, move: number, fuel: number): number {
  const dir = Math.sign(move);
  const dist = Math.min(Math.abs(move), fuel);
  let at = x;
  for (let i = 0; i < dist; i++) {
    const nx = at + dir;
    if (nx < MIN_X || nx > MAX_X || groundAt(t, nx) > ABYSS_Y - 6) break;
    at = nx;
  }
  return at;
}

interface Flying {
  s: number;
  w: Ordnance;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  pts: number[];
  done: boolean;
  e: "b" | "l" | "s";
  n: number;
}

/** First contact along the segment (x0,y0)→(x1,y1) with a live tank or the ground. */
function firstContact(s: BarrageState, f: Flying, step: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let best = 2;
  let hit = -1;
  const a = dx * dx + dy * dy;
  s.tanks.forEach((t, i) => {
    if (!t.alive || (i === f.s && step - f.a <= SAFE_STEPS)) return;
    const ox = x0 - t.x;
    const oy = y0 - tankCy(s.terrain, t.x);
    const c = ox * ox + oy * oy - HIT_R * HIT_R;
    let k: number;
    if (c <= 0) k = 0;
    else {
      if (a === 0) return;
      const b = 2 * (dx * ox + dy * oy);
      const disc = b * b - 4 * a * c;
      if (disc < 0) return;
      k = (-b - Math.sqrt(disc)) / (2 * a);
      if (k < 0 || k > 1) return;
    }
    if (k < best) {
      best = k;
      hit = i;
    }
  });
  for (let j = 1; j <= 4; j++) {
    const k = j / 4;
    if (k >= best) break;
    const px = x0 + dx * k;
    const py = y0 + dy * k;
    if (px < 0 || px > W) break;
    if (py >= groundAt(s.terrain, px)) {
      best = k;
      hit = -1;
      break;
    }
  }
  if (best > 1) return null;
  return { x: x0 + dx * best, y: y0 + dy * best, hit };
}

function explode(
  s: BarrageState,
  x: number,
  y: number,
  w: Ordnance,
  slot: number,
  step: number,
  hit: number,
  booms: Boom[],
  deaths: Death[],
) {
  const spec = w === "bomb" ? WEAPONS.split : WEAPONS[w];
  const X = Math.round(x);
  const Y = Math.round(y);
  const boom: Boom = { t: step, x: X, y: Y, r: spec.r, w, s: slot, d: [], hit };
  const firer = s.tanks[slot];
  s.tanks.forEach((t, i) => {
    if (!t.alive) return;
    const dist = Math.hypot(X - t.x, Y - tankCy(s.terrain, t.x));
    const dmg = Math.min(t.hp, blastDamage(spec.max, spec.r, dist - TANK_R));
    if (dmg <= 0) return;
    t.hp -= dmg;
    boom.d.push(i, dmg);
    if (i !== slot && firer) firer.dealt += dmg;
  });
  carve(s.terrain, s.burnt, X, Y, spec.r);
  booms.push(boom);
  // Tanks settle onto the new ground right away; too deep means the abyss.
  s.tanks.forEach((t, i) => {
    if (!t.alive) return;
    let why: DeathCause | null = null;
    if (t.hp <= 0) why = "hp";
    else if (groundAt(s.terrain, t.x) > ABYSS_Y) why = "abyss";
    if (!why) return;
    t.alive = false;
    t.hp = 0;
    t.why = why;
    t.diedTurn = s.turn;
    deaths.push({ t: step, s: i, why, by: slot });
    if (i !== slot && firer) firer.kills += 1;
  });
}

interface Shot {
  slot: number;
  angle: number;
  power: number;
  weapon: Weapon;
}

/** Fly every shell in lockstep. Mutates terrain, burnt and tanks; returns the timeline. */
export function simulate(s: BarrageState, shots: Shot[]) {
  const ax = s.wind * WIND_ACCEL;
  const booms: Boom[] = [];
  const deaths: Death[] = [];
  const flying: Flying[] = shots.map((shot) => {
    const L = launch(s.terrain, s.tanks[shot.slot].x, shot.angle, shot.power);
    return { s: shot.slot, w: shot.weapon, x: L.x, y: L.y, vx: L.vx, vy: L.vy, a: 0, pts: [L.x, L.y], done: false, e: "l", n: 0 };
  });
  let lastStep = 0;
  const finish = (f: Flying, step: number, e: Flying["e"]) => {
    f.done = true;
    f.e = e;
    f.n = step - f.a;
    lastStep = Math.max(lastStep, step);
  };
  for (let step = 1; step <= MAX_STEPS; step++) {
    let active = false;
    const spawned: Flying[] = [];
    for (const f of flying) {
      if (f.done) continue;
      active = true;
      const x0 = f.x;
      const y0 = f.y;
      f.vx += ax * DT;
      f.vy += GRAVITY * DT;
      f.x += f.vx * DT;
      f.y += f.vy * DT;
      const c = firstContact(s, f, step, x0, y0, f.x, f.y);
      if (c) {
        f.x = c.x;
        f.y = c.y;
        f.pts.push(c.x, c.y);
        finish(f, step, "b");
        explode(s, c.x, c.y, f.w, f.s, step, c.hit, booms, deaths);
        continue;
      }
      f.pts.push(f.x, f.y);
      if (f.x < 0 || f.x > W || f.y > H) {
        finish(f, step, "l");
        continue;
      }
      if (f.w === "split" && f.vy >= 0) {
        finish(f, step, "s");
        for (const k of [-1, 0, 1]) {
          spawned.push({
            s: f.s,
            w: "bomb",
            x: f.x,
            y: f.y,
            vx: f.vx + k * SPLIT_SPREAD,
            vy: f.vy,
            a: step,
            pts: [f.x, f.y],
            done: false,
            e: "l",
            n: 0,
          });
        }
      }
    }
    flying.push(...spawned);
    if (!active && spawned.length === 0) break;
  }
  for (const f of flying) if (!f.done) finish(f, MAX_STEPS, "l");

  // Subsample the paths so the view stays small (every 3rd step unless the volley is huge).
  let every = STRIDES[STRIDES.length - 1];
  for (const stride of STRIDES) {
    const nums = flying.reduce((sum, f) => sum + 2 * (Math.floor(f.n / stride) + 2), 0);
    if (nums <= PATH_BUDGET) {
      every = stride;
      break;
    }
  }
  const shells: ShellPath[] = flying.map((f) => {
    const p: number[] = [];
    for (let k = 0; k < f.n; k += every) p.push(Math.round(f.pts[2 * k]), Math.round(f.pts[2 * k + 1]));
    p.push(Math.round(f.pts[2 * f.n]), Math.round(f.pts[2 * f.n + 1]));
    return { s: f.s, w: f.w, a: f.a, n: f.n, p, e: f.e };
  });
  return { shells, booms, deaths, lastStep, every };
}

function startResolve(s: BarrageState, ctx: GameCtx) {
  const now = ctx.now();
  const before = { terrain: s.terrain.slice(), burnt: s.burnt.slice() };
  const from = s.tanks.map((t) => [t.x, t.hp, t.alive ? 1 : 0, t.angle]);
  const moves: number[][] = [];
  const shots: Shot[] = [];
  s.tanks.forEach((t, i) => {
    // Disconnected drivers sit this one out.
    if (!t.alive || !connected(ctx, t.id)) return;
    if (t.aim.move !== 0) {
      const to = drive(s.terrain, t.x, t.aim.move, t.fuel);
      if (to !== t.x) {
        moves.push([i, t.x, to]);
        t.fuel -= Math.abs(to - t.x);
        t.x = to;
      }
    }
    let weapon = t.aim.weapon;
    if (weapon === "heavy") {
      if (t.heavy > 0) t.heavy -= 1;
      else weapon = "shell";
    } else if (weapon === "split") {
      if (t.split > 0) t.split -= 1;
      else weapon = "shell";
    }
    shots.push({ slot: i, angle: t.aim.angle, power: t.aim.power, weapon });
    t.angle = t.aim.angle;
  });
  const sim = simulate(s, shots);
  const dur = Math.ceil(shots.length ? FIRE_MS + sim.lastStep * STEP_MS + TAIL_MS : MOVE_MS + 1200);
  s.resolve = {
    at: now,
    dur,
    every: sim.every,
    wind: s.wind,
    from,
    moves,
    aims: shots.map((x) => [x.slot, x.angle, x.power, WEAPON_LIST.indexOf(x.weapon)]),
    shells: sim.shells,
    booms: sim.booms,
    deaths: sim.deaths,
  };
  s.before = before;
  s.phase = "resolve";
  s.endsAt = now + dur;
  s.total = dur;
  for (const t of s.tanks) t.locked = false;
}

// ---------- ending ----------

const nameOf = (ctx: GameCtx, id: string) => ctx.player(id)?.name ?? "Someone";

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "Nobody";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function finish(s: BarrageState, ctx: GameCtx, winners: string[], reason: EndReason, headline: string) {
  if (s.over) return;
  s.over = true;
  s.phase = "final";
  s.final = { winners, reason };
  s.resolve = null;
  s.before = null;
  s.awaySince = null;
  s.endsAt = 0;
  s.total = 0;
  for (const t of s.tanks) t.locked = false;
  const scores: Record<string, number> = {};
  for (const t of s.tanks) scores[t.id] = t.hp;
  ctx.end({ winners, headline, scores });
}

function bestHp(tanks: Tank[]): Tank[] {
  const best = Math.max(...tanks.map((t) => t.hp));
  return tanks.filter((t) => t.hp === best);
}

function finishResolve(s: BarrageState, ctx: GameCtx) {
  const startedAlive = s.resolve ? s.resolve.from.flatMap((f, i) => (f[2] === 1 ? [s.tanks[i].id] : [])) : [];
  s.resolve = null;
  s.before = null;
  const alive = s.tanks.filter((t) => t.alive);
  if (alive.length === 0) {
    const names = startedAlive.map((id) => nameOf(ctx, id));
    const headline =
      names.length === 2
        ? `${joinNames(names)} take each other out. It's a draw!`
        : `Mutual destruction! ${joinNames(names)} go down together`;
    return finish(s, ctx, startedAlive, "draw", headline);
  }
  if (alive.length === 1) {
    return finish(s, ctx, [alive[0].id], "last", `${nameOf(ctx, alive[0].id)}'s tank is the last one rolling`);
  }
  if (s.turn >= MAX_TURNS) {
    const top = bestHp(alive);
    const names = top.map((t) => nameOf(ctx, t.id));
    const headline =
      top.length === 1
        ? `${names[0]} wins Barrage with ${top[0].hp} HP left after ${MAX_TURNS} turns`
        : `${joinNames(names)} tie on ${top[0].hp} HP after ${MAX_TURNS} turns`;
    return finish(s, ctx, top.map((t) => t.id), "turns", headline);
  }
  // Next turn: the wind drifts, specials go back in the rack, moves reset.
  s.turn += 1;
  s.wind = clamp(s.wind + randInt(ctx.random, -4, 4), -MAX_WIND, MAX_WIND);
  for (const t of s.tanks) {
    t.locked = false;
    t.aim = { ...t.aim, weapon: "shell", move: 0 };
  }
  s.phase = "aim";
  s.endsAt = ctx.now() + AIM_MS;
  s.total = AIM_MS;
}

function forfeit(s: BarrageState, ctx: GameCtx) {
  const here = liveDrivers(s, ctx);
  if (here.length === 1) {
    return finish(s, ctx, [here[0].id], "forfeit", `${nameOf(ctx, here[0].id)} holds the field. Everyone else left`);
  }
  const alive = s.tanks.filter((t) => t.alive);
  const top = alive.length ? bestHp(alive) : [];
  const names = top.map((t) => nameOf(ctx, t.id));
  finish(
    s,
    ctx,
    top.map((t) => t.id),
    "forfeit",
    top.length ? `Barrage ends as the players drift off. ${joinNames(names)} had the most armour left` : "Barrage ends. Everyone left",
  );
}

/** Track whether too few drivers are around (AIM phase). True when that changed. */
function updateAway(s: BarrageState, ctx: GameCtx): boolean {
  if (s.over || s.phase !== "aim") return false;
  const short = liveDrivers(s, ctx).length < 2;
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

// ---------- the game ----------

export const barrage: GameDef<BarrageState, BarrageAction> = {
  id: "barrage",

  setup(ctx) {
    const terrain = genTerrain(ctx.random);
    const n = Math.max(1, ctx.players.length);
    const span = (W - 2 * MARGIN) / n;
    const xs = Array.from({ length: n }, (_, i) =>
      clamp(Math.round(MARGIN + span * (i + 0.5) + (ctx.random() - 0.5) * span * 0.4), MIN_X + 10, MAX_X - 10),
    );
    for (const x of xs) flattenAt(terrain, x);
    const spots = shuffle(xs, ctx.random);
    const now = ctx.now();
    return {
      phase: "aim",
      turn: 1,
      wind: randInt(ctx.random, -5, 5),
      endsAt: now + FIRST_AIM_MS,
      total: FIRST_AIM_MS,
      terrain,
      burnt: new Array<number>(COLS).fill(0),
      tanks: ctx.players.map((p, i) => newTank(p.id, spots[i])),
      resolve: null,
      before: null,
      final: null,
      awaySince: null,
      over: false,
    };
  },

  action(s, playerId, action, ctx) {
    if (s.over || s.phase !== "aim") return false;
    const tank = s.tanks.find((t) => t.id === playerId);
    if (!tank || !tank.alive || tank.locked) return false;
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const a = action as unknown as Record<string, unknown>;
    if (a.type === "aim") {
      const next = parseAim(tank, a, false);
      if (next && !sameAim(next, tank.aim)) tank.aim = next;
      // Only you can see your pending shot, and your screen already shows it: no broadcast.
      return false;
    }
    if (a.type === "fire") {
      const next = parseAim(tank, a, true);
      if (!next) return false;
      tank.aim = next;
      tank.locked = true;
      const live = liveDrivers(s, ctx);
      if (live.length > 0 && live.every((t) => t.locked)) startResolve(s, ctx);
      return true;
    }
    return false;
  },

  tick(s, ctx) {
    if (s.over) return false;
    const now = ctx.now();
    let changed = updateAway(s, ctx);
    if (s.phase === "aim") {
      if (s.awaySince !== null && now >= s.awaySince + FORFEIT_MS) {
        forfeit(s, ctx);
        return true;
      }
      const live = liveDrivers(s, ctx);
      if (now >= s.endsAt || (live.length > 0 && live.every((t) => t.locked))) {
        startResolve(s, ctx);
        changed = true;
      }
    } else if (s.phase === "resolve" && now >= s.endsAt) {
      finishResolve(s, ctx);
      updateAway(s, ctx);
      changed = true;
    }
    return changed;
  },
  tickMs: 100,

  playerLeft(s, _id, ctx) {
    updateAway(s, ctx);
  },

  playerReturned(s, _id, ctx) {
    updateAway(s, ctx);
  },

  view(s, viewerId): BarrageView {
    const mine = s.tanks.find((t) => t.id === viewerId);
    // During RESOLVE clients replay the volley from the ground as it was before it.
    const ground = s.phase === "resolve" && s.before ? s.before : s;
    return {
      phase: s.phase,
      turn: s.turn,
      maxTurns: MAX_TURNS,
      wind: s.wind,
      endsAt: s.endsAt,
      total: s.total,
      terrain: ground.terrain,
      burnt: encodeRuns(ground.burnt),
      tanks: s.tanks.map((t) => ({
        id: t.id,
        x: t.x,
        hp: t.hp,
        alive: t.alive,
        why: t.why,
        diedTurn: t.diedTurn,
        fuel: t.fuel,
        heavy: t.heavy,
        split: t.split,
        locked: t.locked,
        angle: t.angle,
        dealt: t.dealt,
        kills: t.kills,
      })),
      aim: s.phase === "aim" && mine?.alive ? { ...mine.aim } : null,
      resolve: s.phase === "resolve" ? s.resolve : null,
      final: s.final,
      awayAt: s.awaySince === null || s.over ? null : s.awaySince + FORFEIT_MS,
    };
  },
};

export default barrage;
