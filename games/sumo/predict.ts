// Client-side prediction for your own disc, plus the adaptive playback delay for everyone else's.
// Pure logic (no DOM, no React) so it can be tested against the real server.
//
// Everybody else's disc is drawn ~50-120 ms in the past, blended between snapshots (rink.tsx).
// Yours is drawn in the future instead: at the sim time your inputs reach the server. Starting
// from the newest snapshot of your disc, the predictor replays every input you've sent with the
// physics the server runs (physics.ts): inputs the server has acknowledged at exactly the sim
// time it applied them, newer ones at the time they should land (`lead` ms after sending, learned
// from the acknowledgements). So the disc reacts on the very frame you steer or dash, and when the
// next snapshot arrives the replay normally lands in the same place. Collisions are not predicted:
// when a snapshot shows a hit, the replay starts from the server's post-hit state and the renderer
// blends the difference out over ~120 ms.

import { CENTER, TICK_MS } from "./shared";
import { BRAKE_FRICTION, FRICTION, SUB_MS, applyDash, integrate, keepOnIce, type Kin } from "./physics";

/** Never replay further than this past the newest snapshot (ms): a stalled connection freezes you. */
export const MAX_PREDICT_MS = 400;
const MAX_EVENTS = 64;
const LEAD_ALPHA = 0.2;
/** Before the first acknowledgement and without a measured round trip: a typical phone one (ms). */
const LEAD_GUESS = 80;

/** Your snapshot of your disc, as the replay starts from it. */
export interface Base {
  /** Round number (inputs never carry across a new spawn). */
  n: number;
  /** Server sim time of the snapshot. */
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heavy: boolean;
  /** Rink radius in that snapshot. */
  r: number;
}

export interface InputEvent {
  seq: number;
  /** 0 = stick, 1 = dash. */
  kind: 0 | 1;
  /** Stick direction (-1..1), as the server reads it (`Math.round(v * 100) / 100`). */
  x: number;
  y: number;
  /** Your clock (server-time estimate) when it was sent; NaN before the clock is ready. */
  sent: number;
  /** Sim time it took effect from, once acknowledged. */
  t: number | null;
}

/** The renderer's clock: maps performance.now() to server time. */
export interface ClockLike {
  ready: boolean;
  serverNow(perf: number): number;
}

export class SumoPredictor {
  seq = 0;
  events: InputEvent[] = [];
  base: Base | null = null;
  /** Sim time your newest input takes effect, minus your clock when you sent it (ms). */
  private leadEst = NaN;
  /** Round over / match over: discs brake and can't be steered. */
  decided = false;
  clock: ClockLike | null = null;
  /** Stick in effect before the oldest event kept. */
  private stickX = 0;
  private stickY = 0;
  /** Facing when nothing else says otherwise (a fresh spawn faces the centre). */
  private faceX = 1;
  private faceY = 0;

  private now(perf: number) {
    return this.clock?.ready ? this.clock.serverNow(perf) : NaN;
  }

  /** Use the renderer's clock to stamp inputs (a method, so React code can call it on a prop). */
  attachClock(clock: ClockLike) {
    this.clock = clock;
  }

  /** You moved the stick (x, y as sent: integers -100..100). Returns the input number to send. */
  recordInput(x: number, y: number, perf: number): number {
    const seq = ++this.seq;
    this.push({ seq, kind: 0, x: x / 100, y: y / 100, sent: this.now(perf), t: null });
    return seq;
  }

  /** You pressed dash. Returns the input number to send. */
  recordDash(perf: number): number {
    const seq = ++this.seq;
    this.push({ seq, kind: 1, x: 0, y: 0, sent: this.now(perf), t: null });
    this.dashedAt = perf;
    this.dashes += 1;
    return seq;
  }

  /** performance.now() of your last dash press, and how many you've made (for instant effects). */
  dashedAt = -Infinity;
  dashes = 0;
  /** Your clock time when the server's newest snapshot says your dash recharges, and whether Turbo is on. */
  serverReadyAt = 0;
  turbo = false;

  /** ms until your dash is ready, by the server's newest word and your own last press. */
  dashLeft(perf: number, cooldownMs: number): number {
    const now = this.now(perf);
    const server = Number.isFinite(now) ? this.serverReadyAt - now : 0;
    return Math.max(0, server, this.dashedAt + cooldownMs - perf);
  }

  private push(ev: InputEvent) {
    this.events.push(ev);
    while (this.events.length > MAX_EVENTS) {
      const old = this.events.shift()!;
      if (old.kind === 0) [this.stickX, this.stickY] = [old.x, old.y];
    }
  }

  /** The server acknowledged input `seq` as taking effect from sim time `t`. */
  ack(seq: number, t: number) {
    for (const ev of this.events) {
      if (ev.seq > seq) break;
      if (ev.t !== null) continue;
      if (ev.seq === seq) {
        ev.t = t;
        if (Number.isFinite(ev.sent)) {
          const sample = t - ev.sent;
          if (sample > -200 && sample < 1_000) {
            this.leadEst = Number.isNaN(this.leadEst) ? sample : this.leadEst + (sample - this.leadEst) * LEAD_ALPHA;
          }
        }
      } else {
        // Overwritten before the server's next tick: it took effect no later than this one.
        ev.t = Math.min(t, Number.isFinite(ev.sent) ? ev.sent + this.lead() : t);
      }
    }
  }

  /** ms from your clock to the sim time an input sent now takes effect. */
  lead(): number {
    if (!Number.isNaN(this.leadEst)) return this.leadEst;
    // Until an input has been acknowledged: the room's measured round trip. An input lands about
    // one round trip after the quickest snapshot time, less the half tick the server backdates it.
    const rtt = this.rtt?.();
    if (typeof rtt === "number" && Number.isFinite(rtt) && rtt >= 0) return Math.max(0, rtt - TICK_MS / 2);
    return LEAD_GUESS;
  }

  private rtt: (() => number | null) | null = null;

  /** The room's measured round trip (ms; null until measured), for the first guess at `lead`. */
  attachRtt(rtt: (() => number | null) | undefined) {
    this.rtt = rtt ?? null;
  }

  /** The newest snapshot of your disc (null: not on the ice). */
  setBase(b: Base | null) {
    if (b && this.base && b.n !== this.base.n) {
      // A new round: you spawn facing the centre.
      const dx = CENTER - b.x;
      const dy = CENTER - b.y;
      const m = Math.hypot(dx, dy) || 1;
      this.faceX = dx / m;
      this.faceY = dy / m;
    }
    this.base = b;
    if (!b) return;
    // Forget inputs the snapshot has long since absorbed (but remember the stick they left).
    while (this.events.length > 1 && this.events[0].t !== null && this.events[0].t < b.t - 1_000) {
      const old = this.events.shift()!;
      if (old.kind === 0) [this.stickX, this.stickY] = [old.x, old.y];
    }
  }

  /** Your disc at sim time `T`, replayed from the newest snapshot. False when there's no snapshot. */
  predict(T: number, out: Kin): boolean {
    const b = this.base;
    if (!b) return false;
    const lead = this.lead();
    let ix = this.stickX;
    let iy = this.stickY;
    let fx = this.faceX;
    let fy = this.faceY;
    const future: { at: number; ev: InputEvent }[] = [];
    for (const ev of this.events) {
      let at = ev.t ?? (Number.isFinite(ev.sent) ? ev.sent + lead : b.t + SUB_MS);
      if (ev.t === null && at <= b.t) {
        // Not acknowledged by this snapshot, so it hasn't landed yet: it lands with the next
        // substep. (One the server never got at all is given up on after a while.)
        if (at < b.t - 500) continue;
        at = b.t + SUB_MS * 0.5;
      }
      if (ev.t !== null && ev.t <= b.t + SUB_MS * 0.5) {
        // Already part of the snapshot.
        if (ev.kind === 0) {
          ix = ev.x;
          iy = ev.y;
          const m = Math.hypot(ix, iy);
          if (m > 0.05) [fx, fy] = [ix / m, iy / m];
        }
        continue;
      }
      future.push({ at, ev });
    }
    future.sort((p, q) => p.at - q.at || p.ev.seq - q.ev.seq);
    const k: Kin = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
    const end = Math.min(T, b.t + MAX_PREDICT_MS);
    const friction = this.decided ? BRAKE_FRICTION : FRICTION;
    let t = b.t;
    let fi = 0;
    while (t + SUB_MS <= end + 1e-6) {
      const ts = t + SUB_MS;
      let dash = false;
      while (fi < future.length && future[fi].at <= ts + SUB_MS * 0.5) {
        const ev = future[fi++].ev;
        if (ev.kind === 0) {
          ix = ev.x;
          iy = ev.y;
          const m = Math.hypot(ix, iy);
          if (m > 0.05) [fx, fy] = [ix / m, iy / m];
        } else dash = true;
      }
      if (dash && !this.decided) [fx, fy] = applyDash(k, ix, iy, fx, fy);
      integrate(k, ix, iy, b.heavy, friction, !this.decided);
      if (this.decided) keepOnIce(k, b.r);
      t = ts;
    }
    // The bit of a substep left over: slide along.
    const rem = Math.max(0, end - t) / 1000;
    out.x = k.x + k.vx * rem;
    out.y = k.y + k.vy * rem;
    out.vx = k.vx;
    out.vy = k.vy;
    return true;
  }

  /** Where a dash pressed now would push you (unit vector), for an instant effect. */
  dashDir(stickX: number, stickY: number, k: Kin): [number, number] {
    const probe: Kin = { x: 0, y: 0, vx: k.vx, vy: k.vy };
    return applyDash(probe, stickX, stickY, this.faceX, this.faceY);
  }
}

// ---------- adaptive playback delay ----------

const JITTER_WINDOW = 40;

/**
 * How far behind the quickest delivery everyone else's discs are drawn. A frame is needed on
 * both sides of the playback time, so the delay must cover one frame interval plus how late
 * frames typically run behind the quickest one: the 90th percentile of recent lateness.
 */
export class JitterDelay {
  private late: number[] = [];
  /** Current target (ms). */
  value: number;
  constructor(
    readonly min = 55,
    readonly max = 120,
    start = 100,
  ) {
    this.value = start;
  }

  /** A frame arrived `ms` later than the quickest delivery would have brought it. */
  add(ms: number) {
    if (!Number.isFinite(ms)) return;
    this.late.push(Math.max(0, ms));
    if (this.late.length > JITTER_WINDOW) this.late.shift();
    if (this.late.length < 8) return;
    const sorted = this.late.slice().sort((a, b) => a - b);
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
    this.value = Math.min(this.max, Math.max(this.min, TICK_MS + p90 + 8));
  }
}
