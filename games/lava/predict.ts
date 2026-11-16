// Client-side prediction for your own avatar, plus the adaptive playback delay for everyone else.
// Pure logic (no DOM, no React) so it can be tested against the real server.
//
// Everybody else is drawn ~50-120 ms in the past, blended between snapshots (arena.tsx). You are
// drawn in the future instead: at the sim time your inputs reach the server. Starting from the
// newest snapshot of you, the predictor replays every input you've sent with the physics the
// server runs (physics.ts): acknowledged inputs at exactly the sim time the server applied them,
// newer ones at the time they should land (`lead` ms after sending, learned from the
// acknowledgements). So you react on the very frame you steer or jump, and when the next
// snapshot arrives the replay normally lands in the same place. Bumps and the floor are not
// predicted: the renderer blends server corrections out over ~120 ms and shows your fall the
// moment a snapshot reports it.

import { JUMP_CD_MS, JUMP_CD_STEPS, JUMP_MS, SUB_MS, TICK_MS, faceCentre, jumpAge } from "./shared";
import { BRAKE_FRICTION, FRICTION, applyJump, integrate, type Kin } from "./physics";
import { LeadFilter } from "../snakes/netsmooth";

/**
 * Never replay further than this past the newest snapshot (ms): a stalled connection freezes you.
 * Generous, because real connections deliver in bunches after gaps of 0.5-1.5 s, and your avatar
 * has to keep moving through those gaps instead of freezing and then jumping.
 */
export const MAX_PREDICT_MS = 1_500;
const MAX_EVENTS = 64;
/** Before the first acknowledgement and without a measured round trip: a typical phone one (ms). */
const LEAD_GUESS = 80;

/** Your newest snapshot, as the replay starts from it. */
export interface Base {
  /** Round number (inputs never carry across a new spawn). */
  n: number;
  /** Server sim time of the snapshot. */
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Jump cooldown left (substeps) in that snapshot. */
  cd: number;
}

export interface InputEvent {
  seq: number;
  /** 0 = stick, 1 = jump. */
  kind: 0 | 1;
  /** Stick direction (-1..1), as the server reads it. */
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

export class LavaPredictor {
  seq = 0;
  events: InputEvent[] = [];
  base: Base | null = null;
  private readonly leadF = new LeadFilter(-60, 1_200, { quantile: 0.5, margin: 0, keep: 24, ttl: 30_000, slew: 0.05 });
  /** Round over / match over: players skid to a stop and can't be steered. */
  decided = false;
  clock: ClockLike | null = null;
  private stickX = 0;
  private stickY = 0;
  private faceX = 0;
  private faceY = 1;
  private round = -1;
  /** Sim time of your latest take-off in the last replay (-Infinity: none lately). */
  jumpT = -Infinity;
  /** performance.now() of your last jump press, and how many you've made (for instant effects). */
  jumpedAt = -Infinity;
  jumps = 0;

  private now(perf: number) {
    return this.clock?.ready ? this.clock.serverNow(perf) : NaN;
  }

  attachClock(clock: ClockLike) {
    this.clock = clock;
  }

  private rtt: (() => number | null) | null = null;
  attachRtt(rtt: (() => number | null) | undefined) {
    this.rtt = rtt ?? null;
  }

  /** You moved the stick (x, y as sent: integers -100..100). Returns the input number to send. */
  recordInput(x: number, y: number, perf: number): number {
    const seq = ++this.seq;
    this.push({ seq, kind: 0, x: x / 100, y: y / 100, sent: this.now(perf), t: null });
    return seq;
  }

  /** You pressed jump. Returns the input number to send. */
  recordJump(perf: number): number {
    const seq = ++this.seq;
    this.push({ seq, kind: 1, x: 0, y: 0, sent: this.now(perf), t: null });
    this.jumpedAt = perf;
    this.jumps += 1;
    return seq;
  }

  /** ms until your jump is ready, by the newest snapshot and your own last press. */
  jumpLeft(perf: number): number {
    const now = this.now(perf);
    const b = this.base;
    const server = b && Number.isFinite(now) && b.cd > 0 ? b.t + b.cd * SUB_MS - now - 40 : 0;
    return Math.max(0, server, this.jumpedAt + JUMP_CD_MS - perf);
  }

  private push(ev: InputEvent) {
    this.events.push(ev);
    while (this.events.length > MAX_EVENTS) {
      const old = this.events.shift()!;
      if (old.kind === 0) [this.stickX, this.stickY] = [old.x, old.y];
    }
  }

  /** The server acknowledged input `seq` as taking effect from sim time `t`. */
  ack(seq: number, t: number, perf: number = performance.now()) {
    for (const ev of this.events) {
      if (ev.seq > seq) break;
      if (ev.t !== null) continue;
      if (ev.seq === seq) {
        ev.t = t;
        if (Number.isFinite(ev.sent)) {
          const sample = t - ev.sent;
          // Filtered (median, hysteresis, slewed): one slow or quick input mustn't shove your avatar.
          if (sample > -200 && sample < 2_000) this.leadF.add(sample, perf);
        }
      } else {
        ev.t = Math.min(t, Number.isFinite(ev.sent) ? ev.sent + this.lead() : t);
      }
    }
  }

  /** ms from your clock to the sim time an input sent now takes effect. */
  lead(perf?: number): number {
    const v = this.leadF.value(perf);
    if (!Number.isNaN(v)) return v;
    const rtt = this.rtt?.();
    if (typeof rtt === "number" && Number.isFinite(rtt) && rtt >= 0) return Math.max(0, rtt - TICK_MS / 2);
    return LEAD_GUESS;
  }

  /** The newest snapshot of you (null: not in the arena). */
  setBase(b: Base | null) {
    if (b && b.n !== this.round) {
      // A new round: you spawn facing the centre (like the server).
      this.round = b.n;
      [this.faceX, this.faceY] = faceCentre(b.x, b.y);
    }
    this.base = b;
    if (!b) return;
    while (this.events.length > 1 && this.events[0].t !== null && this.events[0].t < b.t - 1_000) {
      const old = this.events.shift()!;
      if (old.kind === 0) [this.stickX, this.stickY] = [old.x, old.y];
    }
  }

  /** You at sim time `T`, replayed from the newest snapshot. False when there's no snapshot. */
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
        if (at < b.t - 500) continue;
        at = b.t + SUB_MS * 0.5;
      }
      if (ev.t !== null && ev.t <= b.t + SUB_MS * 0.5) {
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
    // Take-off time of the jump in the snapshot (if any), in sim time.
    const age = jumpAge(b.cd);
    let jumpT = age >= 0 ? b.t - age * SUB_MS : -Infinity;
    let queued = false;
    const end = Math.min(T, b.t + MAX_PREDICT_MS);
    const friction = this.decided ? BRAKE_FRICTION : FRICTION;
    let t = b.t;
    let fi = 0;
    while (t + SUB_MS <= end + 1e-6) {
      const ts = t + SUB_MS;
      while (fi < future.length && future[fi].at <= ts + SUB_MS * 0.5) {
        const ev = future[fi++].ev;
        if (ev.kind === 0) {
          ix = ev.x;
          iy = ev.y;
          const m = Math.hypot(ix, iy);
          if (m > 0.05) [fx, fy] = [ix / m, iy / m];
        } else queued = true;
      }
      // Like the server: a queued jump waits for the cooldown.
      if (queued && !this.decided && ts - jumpT >= JUMP_CD_STEPS * SUB_MS - 1e-6) {
        queued = false;
        jumpT = ts;
        applyJump(k, ix, iy, fx, fy);
      }
      integrate(k, ix, iy, ts - jumpT < JUMP_MS - 1e-6, friction, !this.decided);
      t = ts;
    }
    const rem = Math.max(0, end - t) / 1000;
    out.x = k.x + k.vx * rem;
    out.y = k.y + k.vy * rem;
    out.vx = k.vx;
    out.vy = k.vy;
    this.jumpT = jumpT;
    return true;
  }

  /** Facing for the next jump with no stick (unit vector). */
  facing(): [number, number] {
    return [this.faceX, this.faceY];
  }
}
