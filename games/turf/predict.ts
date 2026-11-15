// Client-side prediction for your own painter. Pure logic (no DOM, no React) so it can be tested
// against the real server rules.
//
// Every other painter is drawn a little in the past (see board.tsx). Your own painter is drawn on
// a clock `tau` (in ticks) that runs about one network trip ahead of the server: while your head
// glides from tile(K) to tile(K+1), a turn you press is stamped for tick K+2, the very next tile
// boundary on your screen, and reaches the server before that tick runs. The server holds an
// early turn until its tick, so the turn lands exactly where you saw it. How far ahead to run is
// learned from the server: each turn reports how many ms before its tick it arrived.
//
// Between frames the predictor walks your painter forward with the server's rules (one queued turn
// per step, two steps a tick while dashing, frozen painters only aim, walls stop you), so the head
// and the paint rolling out under it move the moment you steer. Each frame restarts the walk from
// the server's truth; a freeze someone else triggers is the only thing it can't see coming.

import type { TurfView } from "./server";
import { DX, DY, QUEUE_MAX, TICK_MS } from "./shared";

/** How far the display may run ahead of the newest server frame (ticks). */
const MAX_AHEAD = 2.5;
const HORIZON = 5;
const STALE_RX_MS = 1_500;
const STALE_MS = 4_000;
const SNAP_TICKS = 1.5;
const SLEW = 0.15;
const LEAD_SAMPLES = 8;
const LEAD_TTL_MS = 20_000;
const LEAD_MARGIN = 6;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** How many ms ahead of `serverNow()` a turn must be sent to land on time (see snakes/predict.ts). */
export class LeadEstimator {
  private samples: { v: number; at: number }[] = [];
  private oneWay: number[] = [];
  fallback = 20;

  addSample(v: number, now: number) {
    if (!Number.isFinite(v)) return;
    this.samples.push({ v, at: now });
    if (this.samples.length > LEAD_SAMPLES) this.samples.shift();
  }

  addOneWay(ms: number) {
    if (!Number.isFinite(ms)) return;
    this.oneWay.push(ms);
    if (this.oneWay.length > 40) this.oneWay.shift();
    this.fallback = Math.max(0, Math.min(...this.oneWay)) + 10;
  }

  value(now: number): number {
    let best = -Infinity;
    for (const s of this.samples) if (now - s.at < LEAD_TTL_MS && s.v > best) best = s.v;
    const v = best === -Infinity ? this.fallback : best + LEAD_MARGIN;
    return clamp(v, -TICK_MS / 2, 3 * TICK_MS);
  }
}

export interface PendingTurn {
  seq: number;
  /** Index into DIRS. */
  d: number;
  /** Tick it was stamped for (0 = as soon as possible / a countdown aim). */
  at: number;
  sentAt: number;
}

/** Your head as drawn at one moment (tile units). */
export interface Head {
  x: number;
  y: number;
  /** Direction of travel right now. */
  dir: number;
  /** Heading once the turn you just pressed happens (for the arrow on your head). */
  next: number;
}

const dirBetween = (ax: number, ay: number, bx: number, by: number, dflt: number) =>
  bx > ax ? 1 : bx < ax ? 3 : by > ay ? 2 : by < ay ? 0 : dflt;

export class TurfPredictor {
  seq = 0;
  pending: PendingTurn[] = [];
  readonly lead = new LeadEstimator();

  phase: TurfView["phase"] = "countdown";
  tick = 0;
  stepAt = 0;
  period = TICK_MS;
  w = 1;
  h = 1;
  /** Your painter index (-1 = watching). */
  me = -1;
  x = 0;
  y = 0;
  dir = 0;
  dashUntil = 0;
  frozenUntil = 0;
  /** Tile (y * w + x) after each tick, and the tile passed through on two-step (dash) ticks. */
  private pos = new Map<number, number>();
  private mid = new Map<number, number>();
  private applied = 0;
  private rx = 0;
  private budgets = new Map<number, number>();
  private lastTick = -1;
  private lastAt = 0;
  private playFrom = 0;

  private pCell: number[] = [];
  private pMid: number[] = [];
  private pDir: number[] = [];

  tau = 0;
  private tauAt = -1;

  private reset() {
    this.pending = [];
    this.pos.clear();
    this.mid.clear();
    this.budgets.clear();
    this.applied = 0;
    this.rx = 0;
    this.lastTick = -1;
    this.tauAt = -1;
    this.pCell = [];
    this.pMid = [];
    this.pDir = [];
  }

  /** Take in a server frame. `now` = serverNow(), `perf` = performance.now(). */
  ingest(view: TurfView, now: number, perf: number) {
    if (view.tick < this.tick || view.w !== this.w || view.h !== this.h) {
      this.reset();
      this.playFrom = view.tick;
    }
    const wasPlay = this.phase === "play";
    this.phase = view.phase;
    this.w = Math.max(1, view.w);
    this.h = Math.max(1, view.h);
    const prevTick = this.tick;
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
    this.me = view.you;
    const p = this.me >= 0 ? view.players[this.me] : undefined;
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
    if (!p) {
      this.me = -1;
      this.pending = [];
      this.rebuild();
      return;
    }
    const w = this.w;
    const [, x, y, dir, , , dash, frozen] = p;
    // Where you were on the ticks since the last frame (one tile a tick, two while dashing).
    const before = this.pos.get(prevTick);
    const cell = y * w + x;
    if (before !== undefined && view.tick > prevTick) {
      const bx = before % w;
      const by = (before - bx) / w;
      const gap = view.tick - prevTick;
      const dist = Math.abs(x - bx) + Math.abs(y - by);
      if (gap === 1 && dist === 2) {
        const mx = x - DX[dir];
        const my = y - DY[dir];
        if (Math.abs(mx - bx) + Math.abs(my - by) === 1) this.mid.set(view.tick, my * w + mx);
      } else if (gap > 1) {
        // Skipped frames: walk x first, then y, a tile per tick.
        let cx = bx;
        let cy = by;
        for (let t = prevTick + 1; t < view.tick; t++) {
          if (cx !== x) cx += Math.sign(x - cx);
          else if (cy !== y) cy += Math.sign(y - cy);
          this.pos.set(t, cy * w + cx);
        }
      }
    }
    this.pos.set(view.tick, cell);
    for (const k of this.pos.keys()) if (k < view.tick - 16) this.pos.delete(k);
    for (const k of this.mid.keys()) if (k < view.tick - 16) this.mid.delete(k);
    this.x = x;
    this.y = y;
    this.dir = dir;
    this.dashUntil = dash;
    this.frozenUntil = frozen;

    this.pending = this.pending.filter(
      (q) => q.seq > this.applied && !(q.seq <= this.rx && perf - q.sentAt > STALE_RX_MS) && perf - q.sentAt < STALE_MS,
    );
    if (view.phase === "over") this.pending = [];
    this.rebuild();
  }

  /**
   * You pressed a direction (index into DIRS). Returns the action fields to send, or null when
   * the server would ignore it anyway. Mirrors the server's two-deep queue (a third press
   * replaces the last one).
   */
  press(d: number, now: number, perf: number): { seq: number; at?: number } | null {
    if (this.me < 0 || (this.phase !== "countdown" && this.phase !== "play")) return null;
    if (this.phase === "countdown") {
      if (this.pending.length && this.pending[this.pending.length - 1].d === d) return null;
      const seq = ++this.seq;
      this.pending = [{ seq, d, at: 0, sentAt: perf }];
      this.rebuild();
      return { seq };
    }
    const last = this.pending.length ? this.pending[this.pending.length - 1].d : this.dir;
    if (d === last) return null;
    const seq = ++this.seq;
    const tau = this.advance(perf, now);
    if (this.pending.length >= QUEUE_MAX) {
      if (this.pending[0].d === d) this.pending.length = 1;
      else this.pending.length = QUEUE_MAX - 1;
    }
    const prev = this.pending.length ? this.pending[this.pending.length - 1].at : 0;
    const at = Math.max(Math.floor(tau) + 2, this.tick + 1, prev + 1);
    this.budgets.set(seq, this.stepAt + (at - this.tick) * this.period - now);
    if (this.budgets.size > 16) this.budgets.delete(this.budgets.keys().next().value!);
    if (!(this.pending.length === 1 && this.pending[0].d === d)) this.pending.push({ seq, d, at, sentAt: perf });
    this.rebuild();
    return { seq, at };
  }

  /** Walk forward from the newest frame with the server's rules. */
  private rebuild() {
    this.pCell = [];
    this.pMid = [];
    this.pDir = [];
    if (this.me < 0 || this.phase !== "play") return;
    const { w, h } = this;
    let x = this.x;
    let y = this.y;
    let dir = this.dir;
    let qi = 0;
    const due = (t: number) => {
      if (qi < this.pending.length && this.pending[qi].at <= t) dir = this.pending[qi++].d;
    };
    for (let t = this.tick + 1; t <= this.tick + HORIZON; t++) {
      const when = this.stepAt + (t - this.tick) * this.period;
      let midCell = -1;
      if (when < this.frozenUntil) due(t);
      else {
        const steps = when < this.dashUntil ? 2 : 1;
        for (let st = 0; st < steps; st++) {
          due(t);
          const nx = x + DX[dir];
          const ny = y + DY[dir];
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
            x = nx;
            y = ny;
          }
          if (steps === 2 && st === 0) midCell = y * w + x;
        }
      }
      this.pCell.push(y * w + x);
      this.pMid.push(midCell);
      this.pDir.push(dir);
    }
  }

  /** Tile after tick `t` (-1 = unknown). */
  cellAt(t: number): number {
    if (t <= this.tick) return this.pos.get(t) ?? -1;
    const j = t - this.tick - 1;
    return j < this.pCell.length ? this.pCell[j] : -1;
  }

  /** Tile passed through during tick `t` on a two-step (dash) tick, else -1. */
  midAt(t: number): number {
    if (t <= this.tick) return this.mid.get(t) ?? -1;
    const j = t - this.tick - 1;
    const m = j < this.pMid.length ? this.pMid[j] : -1;
    // A blocked first step leaves you where you were: not a real middle tile.
    return m >= 0 && m !== this.cellAt(t - 1) && m !== this.cellAt(t) ? m : -1;
  }

  private dirAt(t: number): number {
    if (t > this.tick) {
      const j = t - this.tick - 1;
      if (j < this.pDir.length) return this.pDir[j];
    }
    return this.pending.length && this.phase !== "play" ? this.pending[this.pending.length - 1].d : this.dir;
  }

  /** Heading once everything you queued has happened (the D-pad highlight). */
  heading(): number {
    return this.pending.length ? this.pending[this.pending.length - 1].d : this.dir;
  }

  /** Advance the display clock to `perf` and return it (ticks). */
  advance(perf: number, now: number): number {
    if (this.phase !== "play" || this.me < 0) {
      this.tau = this.tick;
      this.tauAt = perf;
      return this.tau;
    }
    const target = this.tick + (now - this.stepAt + this.lead.value(perf)) / this.period - 1;
    const dt = this.tauAt < 0 ? 0 : clamp(perf - this.tauAt, 0, 100);
    if (this.tauAt < 0 || Math.abs(target - this.tau) > SNAP_TICKS) this.tau = target;
    else {
      this.tau += dt / this.period;
      const max = (SLEW * dt) / this.period;
      this.tau += clamp(target - this.tau, -max, max);
    }
    this.tauAt = perf;
    this.tau = clamp(this.tau, Math.max(this.playFrom, this.tick - 4), this.tick + MAX_AHEAD);
    return this.tau;
  }

  /** Your head at display time `tau`. False when you have no painter. */
  head(tau: number, out: Head): boolean {
    if (this.me < 0) return false;
    const w = this.w;
    const K = Math.floor(tau);
    const f = tau - K;
    let a = this.cellAt(K);
    if (a < 0) a = this.y * w + this.x;
    const b = this.cellAt(K + 1);
    const m = this.midAt(K + 1);
    let ax = a % w;
    let ay = (a - ax) / w;
    let bx = ax;
    let by = ay;
    let u = 0;
    if (b >= 0 && b !== a) {
      bx = b % w;
      by = (b - bx) / w;
      u = f;
      if (m >= 0) {
        const mx = m % w;
        const my = (m - mx) / w;
        if (f < 0.5) {
          bx = mx;
          by = my;
          u = f * 2;
        } else {
          ax = mx;
          ay = my;
          u = f * 2 - 1;
        }
      }
    }
    out.x = ax + (bx - ax) * u;
    out.y = ay + (by - ay) * u;
    const travel = dirBetween(ax, ay, bx, by, b >= 0 ? this.dirAt(K + 1) : this.dir);
    out.dir = travel;
    out.next = this.phase === "play" ? this.dirAt(K + 2) : this.dirAt(K);
    return true;
  }
}
