// Client-side prediction for your own snake. Pure logic (no DOM, no React) so it can be tested
// against the real server rules.
//
// Timeline: the server moves every snake one cell per step; step k happens at server time
// stepAt + (k - tick) * period. Every other snake is drawn a little in the past (see arena.tsx).
// Your own snake is drawn on a clock `tau` (in steps) that runs about one network trip ahead
// of the server: while the screen glides your head from cell(K) to cell(K+1), a turn you press
// is stamped for step K+2 (the very next cell boundary on your screen) and reaches the server
// before that step runs. The server holds an early turn until its step, so the turn happens on
// exactly the step you saw it on and the prediction never has to be corrected. How far ahead
// to run is learned from the server: every turn reports how many ms before its step it arrived.
//
// Between server frames the predictor walks your snake forward with the server's rules (one
// queued turn per step, growth from pellets, walls, bodies that will certainly still be there).
// When a frame arrives the walk restarts from the server's truth, so any disagreement (someone
// cut you off head-on, a pellet eaten first) is fixed on the next frame.

import type { SnakeView } from "./server";
import { DELTA, GOLDEN_VALUE, MAX_QUEUE, OPPOSITE, TICK_MS, type Dir } from "./shared";
import { LeadFilter } from "./netsmooth";

/**
 * How far the display may run ahead of the newest server frame (steps). Generous: on a real
 * connection frames regularly arrive in bunches after gaps of 0.5-1.5 s, and your snake has to
 * keep gliding along its (deterministic) path through those gaps instead of freezing.
 */
export const MAX_AHEAD = 14;
/** Steps walked forward from each server frame. */
const HORIZON = MAX_AHEAD + 3;
/** A head that moved when a frame arrived (the prediction was wrong) eases over with this time constant (ms)... */
const CORR_MS = 110;
/** ...unless it jumped this far (cells). */
const CORR_SNAP = 2.5;
/** A crashing head pushes this far (cells) into whatever it hits. */
export const LUNGE = 0.32;
/** A turn the server has received but not applied after this long was refused: forget it. */
const STALE_RX_MS = 1_500;
/** A turn the server never acknowledged at all (connection trouble) is forgotten after this. */
const STALE_MS = 4_000;
/** Display clock: errors bigger than this (steps) snap; smaller ones are eased out... */
const SNAP_STEPS = 1.5;
/** ...by running at most this much faster or slower than real time. */
const SLEW = 0.15;

const LEAD_SAMPLES = 16;
const LEAD_TTL_MS = 30_000;
/** Safety margin (ms) on top of the (90th percentile) arrival. */
const LEAD_MARGIN = 8;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * How many ms ahead of `serverNow()` a turn needs to be sent to reach the server in time.
 * Each sample is (ms between pressing and the step's server time) minus (ms the turn arrived
 * before its step), i.e. clock error plus uplink. The estimate is a high percentile of recent
 * samples plus a margin (running a bit too far ahead only shifts your snake a few ms, arriving
 * late costs a correction), and it is filtered: raised promptly, lowered only after a calm spell,
 * and slewed, so one slow or fast turn never makes your snake surge or hang back.
 */
export class LeadEstimator {
  private readonly filter = new LeadFilter(-TICK_MS / 2, 4 * TICK_MS, {
    quantile: 0.9,
    margin: LEAD_MARGIN,
    keep: LEAD_SAMPLES,
    ttl: LEAD_TTL_MS,
    slew: 0.08,
  });
  private oneWay: number[] = [];
  /** Used until a turn has reported back: the quickest downlink seen (assumes a symmetric link). */
  fallback = 20;

  /** A turn reported back: `v` = clock error + uplink (ms). */
  addSample(v: number, now: number) {
    this.filter.add(v, now);
  }

  /** A frame arrived `ms` after its step (by our clock). */
  addOneWay(ms: number) {
    if (!Number.isFinite(ms)) return;
    this.oneWay.push(ms);
    if (this.oneWay.length > 40) this.oneWay.shift();
    this.fallback = Math.max(0, Math.min(...this.oneWay)) + 10;
  }

  /** The lead at wall time `now` (performance.now()). */
  value(now: number): number {
    const v = this.filter.value(now);
    return Number.isNaN(v) ? clamp(this.fallback, -TICK_MS / 2, 4 * TICK_MS) : v;
  }
}

export interface PendingTurn {
  seq: number;
  dir: Dir;
  /** Step the turn was stamped for (0 = as soon as possible, e.g. during the countdown). */
  at: number;
  /** performance.now() when it was sent. */
  sentAt: number;
}

/** Your snake as drawn at one moment (cell units; add 0.5 for cell centres). */
export interface Shape {
  /** Polyline, head first: [x, y, x, y, ...]. */
  pts: number[];
  hx: number;
  hy: number;
  /** Direction the head is travelling. */
  dx: number;
  dy: number;
  /** Where the eyes look: the move after this one (so a turn shows the instant it's pressed). */
  eyes: Dir;
  /** A queued turn not yet on screen, shown at the cell where it will happen. */
  hint: Dir | null;
  hintX: number;
  hintY: number;
  /** Crashing (predicted): the head pushes `lungeAmt` cells this way and the snake stops. */
  lunge: Dir | null;
  lungeAmt: number;
}

export function emptyShape(): Shape {
  return { pts: [], hx: 0, hy: 0, dx: 1, dy: 0, eyes: "right", hint: null, hintX: 0, hintY: 0, lunge: null, lungeAmt: 0 };
}

const dirFrom = (dx: number, dy: number): Dir | null =>
  dx === 1 && dy === 0 ? "right" : dx === -1 && dy === 0 ? "left" : dx === 0 && dy === 1 ? "down" : dx === 0 && dy === -1 ? "up" : null;

const before = emptyShape();
const after = emptyShape();

export class SnakePredictor {
  /** Last input number used (never reused, even across rounds or a page refresh). */
  seq = 0;
  pending: PendingTurn[] = [];
  readonly lead = new LeadEstimator();

  // ----- the server's truth (newest frame) -----
  round = -1;
  phase: SnakeView["phase"] = "countdown";
  tick = 0;
  stepAt = 0;
  /** Measured ms per step. */
  period = TICK_MS;
  w = 1;
  h = 1;
  alive = false;
  dir: Dir = "right";
  grow = 0;
  /** Cell indices (y * w + x), head first. */
  body: number[] = [];
  private heads = new Map<number, number>();
  private lens = new Map<number, number>();
  private food = new Set<number>();
  private golden = -1;
  /** Other snakes' cells -> first step at which they are certainly free again. */
  private occ = new Map<number, number>();
  private applied = 0;
  private rx = 0;
  /** ms between pressing and the stamped step's server time, per input (play turns only). */
  private budgets = new Map<number, number>();
  private lastTick = -1;
  private lastAt = 0;
  private playFrom = 0;

  // ----- the walk forward from the newest frame -----
  private pHeads: number[] = [];
  private pLens: number[] = [];
  private pDirs: Dir[] = [];
  /** Step each pending turn will land on. */
  private effAt: number[] = [];
  /** Step on which the walk crashes (-1 = none). */
  deathAt = -1;
  private deathDir: Dir = "right";

  // ----- display clock -----
  tau = 0;
  private tauAt = -1;
  /** The renderer's smoothed server clock (see netsmooth.ts); `now` arguments are used until it's ready. */
  private clock: { ready: boolean; serverNow(perf: number): number } | null = null;
  /** Visual offset (cells) of your head, left over from a correction and fading out. */
  private corrX = 0;
  private corrY = 0;
  /** Frames that moved your head as predicted (the prediction was wrong). */
  corrections = 0;

  attachClock(clock: { ready: boolean; serverNow(perf: number): number }) {
    this.clock = clock;
  }

  private clockNow(now: number, perf: number) {
    return this.clock?.ready ? this.clock.serverNow(perf) : now;
  }

  private reset() {
    this.pending = [];
    this.heads.clear();
    this.lens.clear();
    this.budgets.clear();
    this.applied = 0;
    this.rx = 0;
    this.lastTick = -1;
    this.tauAt = -1;
    this.pHeads = [];
    this.pLens = [];
    this.pDirs = [];
    this.effAt = [];
    this.deathAt = -1;
  }

  /** Take in a server frame. `now` = serverNow(), `perf` = performance.now(). */
  ingest(view: SnakeView, me: string, now: number, perf: number) {
    now = this.clockNow(now, perf);
    const round = this.round;
    const had = this.tauAt >= 0 && this.phase === "play" && this.shape(this.tau, before);
    this.ingestFrame(view, me, now, perf);
    if (had && this.round === round && this.phase === "play" && this.shape(this.tau, after)) {
      const dx = before.hx - after.hx;
      const dy = before.hy - after.hy;
      if (Math.hypot(dx, dy) > 0.01) {
        this.corrections += 1;
        // Ease the head over instead of jumping (a big jump, say a respawn, just jumps).
        this.corrX += dx;
        this.corrY += dy;
        if (Math.hypot(this.corrX, this.corrY) > CORR_SNAP) this.corrX = this.corrY = 0;
      }
    } else this.corrX = this.corrY = 0;
  }

  private ingestFrame(view: SnakeView, me: string, now: number, perf: number) {
    if (view.round !== this.round || view.tick < this.tick) {
      this.reset();
      this.round = view.round;
      this.playFrom = view.tick;
    }
    const wasPlay = this.phase === "play";
    this.phase = view.phase;
    this.w = Math.max(1, view.w);
    this.h = Math.max(1, view.h);
    this.tick = view.tick;
    if (view.phase === "play" && typeof view.at === "number") {
      if (!wasPlay) this.playFrom = view.tick;
      if (view.tick > this.lastTick) {
        if (this.lastTick >= 0 && view.at > this.lastAt) {
          const per = (view.at - this.lastAt) / (view.tick - this.lastTick);
          if (per > TICK_MS * 0.7 && per < TICK_MS * 1.5) this.period += (per - this.period) * 0.1;
        }
        this.lastTick = view.tick;
        this.lastAt = view.at;
        this.lead.addOneWay(now - view.at);
      }
      this.stepAt = view.at;
    }

    const w = this.w;
    const mine = view.snakes.find((s) => s.id === me);
    if (view.me) {
      const [applied, rx, slack] = view.me;
      this.seq = Math.max(this.seq, applied, rx);
      if (rx > this.rx) {
        const budget = this.budgets.get(rx);
        if (budget !== undefined && Math.abs(slack) < 999) this.lead.addSample(budget - slack, perf);
      }
      this.applied = applied;
      this.rx = rx;
    }
    this.alive = !!mine && mine.alive && mine.body.length >= 4;
    if (!mine || !this.alive) {
      this.pending = [];
      this.rebuild();
      return;
    }
    const cells: number[] = [];
    for (let i = 0; i + 1 < mine.body.length; i += 2) cells.push(mine.body[i + 1] * w + mine.body[i]);
    this.body = cells;
    this.dir = mine.dir;
    this.grow = Math.max(0, mine.len - cells.length);
    for (let i = 0; i < cells.length; i++) this.heads.set(view.tick - i, cells[i]);
    this.lens.set(view.tick, cells.length);
    for (const k of this.heads.keys()) if (k < view.tick - cells.length - 8) this.heads.delete(k);
    for (const k of this.lens.keys()) if (k < view.tick - 16) this.lens.delete(k);

    this.pending = this.pending.filter(
      (p) =>
        p.seq > this.applied &&
        !(p.seq <= this.rx && perf - p.sentAt > STALE_RX_MS) &&
        perf - p.sentAt < STALE_MS,
    );
    if (view.phase !== "countdown" && view.phase !== "play") this.pending = [];

    this.food.clear();
    for (let i = 0; i + 1 < view.food.length; i += 2) this.food.add(view.food[i + 1] * w + view.food[i]);
    this.golden = view.golden ? view.golden[1] * w + view.golden[0] : -1;
    this.occ.clear();
    for (const o of view.snakes) {
      if (o.id === me || !o.alive) continue;
      const n = o.body.length >> 1;
      const g = Math.max(0, o.len - n);
      for (let i = 0; i < n; i++) {
        const c = o.body[2 * i + 1] * w + o.body[2 * i];
        const free = view.tick + n - i + g;
        if ((this.occ.get(c) ?? 0) < free) this.occ.set(c, free);
      }
    }
    this.rebuild();
  }

  /** Direction the snake ends up heading once everything queued has happened. */
  lastDir(): Dir {
    return this.pending.length ? this.pending[this.pending.length - 1].dir : this.dir;
  }

  /**
   * You pressed a direction. Returns the action fields to send, or null when the server
   * would ignore it anyway (a reversal, a repeat, a full queue, no live snake).
   */
  press(dir: Dir, now: number, perf: number): { seq: number; at?: number } | null {
    now = this.clockNow(now, perf);
    if (!this.alive || (this.phase !== "countdown" && this.phase !== "play")) return null;
    if (this.pending.length >= MAX_QUEUE) return null;
    const last = this.lastDir();
    if (dir === last || dir === OPPOSITE[last]) return null;
    const seq = ++this.seq;
    let at = 0;
    if (this.phase === "play") {
      const tau = this.advance(perf, now);
      const prev = this.effAt.length ? this.effAt[this.effAt.length - 1] : 0;
      at = Math.max(Math.floor(tau) + 2, this.tick + 1, prev + 1);
      this.budgets.set(seq, this.stepAt + (at - this.tick) * this.period - now);
      if (this.budgets.size > 16) this.budgets.delete(this.budgets.keys().next().value!);
    }
    this.pending.push({ seq, dir, at, sentAt: perf });
    this.rebuild();
    return at > 0 ? { seq, at } : { seq };
  }

  /** Walk the snake forward from the newest frame with the server's rules. */
  private rebuild() {
    this.pHeads = [];
    this.pLens = [];
    this.pDirs = [];
    this.effAt = [];
    this.deathAt = -1;
    let next = this.tick + 1;
    for (const p of this.pending) {
      const e = Math.max(p.at, next);
      this.effAt.push(e);
      next = e + 1;
    }
    if (!this.alive || this.phase !== "play") return;
    const { w, h } = this;
    const body = this.body.slice();
    let grow = this.grow;
    let dir = this.dir;
    let qi = 0;
    const eaten = new Set<number>();
    for (let t = this.tick + 1; t <= this.tick + HORIZON; t++) {
      if (qi < this.pending.length && this.effAt[qi] <= t) dir = this.pending[qi++].dir;
      const head = body[0];
      const [dx, dy] = DELTA[dir];
      const x = (head % w) + dx;
      const y = Math.floor(head / w) + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) {
        this.deathAt = t;
        this.deathDir = dir;
        return;
      }
      const c = y * w + x;
      const keep = grow > 0 ? body.length : body.length - 1;
      let hit = (this.occ.get(c) ?? 0) > t;
      for (let j = 0; j < keep && !hit; j++) if (body[j] === c) hit = true;
      if (hit) {
        this.deathAt = t;
        this.deathDir = dir;
        return;
      }
      body.unshift(c);
      if (grow > 0) grow -= 1;
      else body.pop();
      if (!eaten.has(c)) {
        if (this.food.has(c)) {
          grow += 1;
          eaten.add(c);
        } else if (c === this.golden) {
          grow += GOLDEN_VALUE;
          eaten.add(c);
        }
      }
      this.pHeads.push(c);
      this.pLens.push(body.length);
      this.pDirs.push(dir);
    }
  }

  /** Head cell after step `t` (server truth up to `tick`, the walk beyond it), or -1. */
  headAt(t: number): number {
    if (t <= this.tick) return this.heads.get(t) ?? -1;
    const j = t - this.tick - 1;
    return j < this.pHeads.length ? this.pHeads[j] : -1;
  }

  private lenAt(t: number): number {
    if (t <= this.tick) return this.lens.get(t) ?? this.body.length;
    const j = t - this.tick - 1;
    return j < this.pLens.length ? this.pLens[j] : (this.pLens[this.pLens.length - 1] ?? this.body.length);
  }

  /** Direction of the move that ends at step `t`, if known. */
  private stepDir(t: number): Dir | null {
    if (t > this.tick) {
      const j = t - this.tick - 1;
      return j < this.pDirs.length ? this.pDirs[j] : null;
    }
    const a = this.headAt(t - 1);
    const b = this.headAt(t);
    if (a < 0 || b < 0) return null;
    return dirFrom((b % this.w) - (a % this.w), Math.floor(b / this.w) - Math.floor(a / this.w));
  }

  /** The turn that shows next on screen (or where you're heading): for the D-pad and tap-to-turn. */
  upcoming(): Dir {
    if (this.phase !== "play") return this.lastDir();
    const K = Math.floor(this.tau);
    return this.stepDir(K + 2) ?? this.stepDir(K + 1) ?? this.dir;
  }

  /** Advance the display clock to `perf` and return it (steps). */
  advance(perf: number, now: number): number {
    now = this.clockNow(now, perf);
    if (this.tauAt >= 0 && perf > this.tauAt) {
      const k = Math.exp(-(perf - this.tauAt) / CORR_MS);
      this.corrX *= k;
      this.corrY *= k;
    }
    if (this.phase !== "play" || !this.alive) {
      this.tau = this.tick;
      this.tauAt = perf;
      return this.tau;
    }
    const target = this.tick + (now - this.stepAt + this.lead.value(perf)) / this.period - 1;
    const dt = this.tauAt < 0 ? 0 : clamp(perf - this.tauAt, 0, 100);
    if (this.tauAt < 0 || Math.abs(target - this.tau) > SNAP_STEPS) this.tau = target;
    else {
      this.tau += dt / this.period;
      const max = (SLEW * dt) / this.period;
      this.tau += clamp(target - this.tau, -max, max);
    }
    this.tauAt = perf;
    this.tau = clamp(this.tau, Math.max(this.playFrom, this.tick - 3), this.tick + MAX_AHEAD);
    return this.tau;
  }

  /** Your snake as drawn: `shape` plus what's left of the last correction, fading out. */
  shapeSmooth(tau: number, out: Shape): boolean {
    if (!this.shape(tau, out)) return false;
    if (this.corrX !== 0 || this.corrY !== 0) {
      out.hx += this.corrX;
      out.hy += this.corrY;
      out.pts[0] += this.corrX;
      out.pts[1] += this.corrY;
    }
    return true;
  }

  /** Your snake at display time `tau`. False when there's nothing to draw. */
  shape(tau: number, out: Shape): boolean {
    if (!this.alive || !this.body.length) return false;
    const { w } = this;
    let u = tau;
    out.lunge = null;
    out.lungeAmt = 0;
    if (this.deathAt >= 0 && u > this.deathAt - 1) {
      out.lunge = this.deathDir;
      out.lungeAmt = Math.min(LUNGE, u - (this.deathAt - 1));
      u = this.deathAt - 1;
    }
    const K = Math.floor(u);
    const f = u - K;
    const a = this.headAt(K);
    if (a < 0) return false;
    const b = this.headAt(K + 1);
    const ax = a % w;
    const ay = (a - ax) / w;
    let hx = ax;
    let hy = ay;
    if (b >= 0 && f > 0) {
      const bx = b % w;
      hx += (bx - ax) * f;
      hy += ((b - bx) / w - ay) * f;
    }
    // The tail: it follows the head's path, standing still on steps where the snake grows.
    const ttK = K - this.lenAt(K) + 1;
    const ttK1 = b >= 0 ? K + 2 - this.lenAt(K + 1) : ttK;
    const ut = ttK + (ttK1 - ttK) * f;
    const pts = out.pts;
    pts.length = 0;
    pts.push(hx, hy);
    for (let t = Math.ceil(u) - 1; t > ut; t--) {
      const c = this.headAt(t);
      if (c < 0) break;
      const cx = c % w;
      pts.push(cx, (c - cx) / w);
    }
    const tk = Math.floor(ut);
    const ta = this.headAt(tk);
    const tb = this.headAt(tk + 1);
    if (ta >= 0) {
      const tx = ta % w;
      const ty = (ta - tx) / w;
      const fr = ut - tk;
      if (tb >= 0 && fr > 0) {
        const bx = tb % w;
        pts.push(tx + (bx - tx) * fr, ty + ((tb - bx) / w - ty) * fr);
      } else pts.push(tx, ty);
    }
    out.hx = hx;
    out.hy = hy;
    const travel = (b >= 0 ? this.stepDir(K + 1) : null) ?? this.stepDir(K) ?? this.dir;
    [out.dx, out.dy] = DELTA[travel];
    const next = this.phase === "play" ? this.stepDir(K + 2) : this.pending.length ? this.pending[0].dir : null;
    out.eyes = out.lunge ?? next ?? travel;
    out.hint = null;
    if (this.phase === "play" && !out.lunge && next && next !== travel && b >= 0) {
      out.hint = next;
      const bx = b % w;
      out.hintX = bx;
      out.hintY = (b - bx) / w;
    }
    return true;
  }
}
