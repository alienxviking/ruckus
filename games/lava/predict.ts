// Client-side prediction for Floor is Lava. Pure logic (no DOM, no React) so it can be tested
// against the real server. The same scheme as Ice Sumo (see sumo/predict.ts):
//
// ONE TIMEFRAME. A player sees everyone at the same moment: the sim time at which an input pressed
// now takes effect on the server (`serverNow + lead`). You are replayed up to then from your newest
// snapshot with every input you've sent; everybody else is dead-reckoned from the same snapshot with
// their last known stick (and their jump, if they're in the air), and all of you go through the
// shared physics together, bumps included (a jumper sails over people on the ground, as on the
// server). So a bump you see is the bump the server makes. When a snapshot lands the renderer
// re-predicts and eases the difference out; others are extrapolated at most ~600 ms, then glide
// to a pause. The floor isn't predicted: tiles change as the snapshots say.
//
// Inputs are stamped with the sim time they're meant for (`at` = your clock + lead): the server
// holds an early one until then and counts a late one back up to ~150 ms, so you move on the server
// as you saw yourself move. `lead` is learned from when the server says your inputs arrived.

import { JUMP_CD_MS, JUMP_CD_STEPS, JUMP_MS, PLAYER_R, SUB_MS, TICK_MS, decodeStick, faceCentre, jumpAge, type Snap } from "./shared";
import {
  BRAKE_FRICTION,
  FRICTION,
  MAX_REWIND_STEPS,
  applyJump,
  integrate,
  resolveBump,
  rewindDelta,
  type Kin,
} from "./physics";
import { LeadFilter } from "../snakes/netsmooth";

/**
 * Never replay further than this past the newest snapshot (ms): a stalled connection freezes you.
 * Generous, because real connections deliver in bunches after gaps of 0.5-1.5 s, and your avatar
 * has to keep moving through those gaps instead of freezing and then jumping.
 */
export const MAX_PREDICT_MS = 1_500;
/** Other players are dead-reckoned this far past their snapshot, then glide to a pause. */
export const OTHERS_MS = 600;
/** Friction per substep once another player has been extrapolated OTHERS_MS. */
const PAUSE_FRICTION = 0.9;
const MAX_EVENTS = 64;
/** Before the first acknowledgement and without a measured round trip: a typical phone one (ms). */
const LEAD_GUESS = 80;
/**
 * Stamps aim at the 90th percentile of how long inputs take to arrive, plus this margin (ms):
 * negative, because the server counts a late input back up to ~150 ms (see sumo/predict.ts).
 */
const LEAD_MARGIN = -60;

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
  /** Sim time it was stamped for (NaN: sent unstamped). */
  at: number;
  /** Sim time it took effect from, once acknowledged. */
  t: number | null;
}

/** The renderer's clock: maps performance.now() to server time. */
export interface ClockLike {
  ready: boolean;
  serverNow(perf: number): number;
}

/** One player of a snapshot, for predicting everyone. */
export interface WorldRunner {
  slot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ix: number;
  iy: number;
  /** Jump cooldown left (substeps) in the snapshot. */
  cd: number;
}

export interface World {
  n: number;
  t: number;
  runners: WorldRunner[];
}

export interface PredictedContact {
  a: number;
  b: number;
  x: number;
  y: number;
  j: number;
  /** Sim time of the substep it happened in. */
  t: number;
}

interface Scheduled {
  at: number;
  ev: InputEvent;
  /** Substeps the server will count it back (a stamped stick input arriving late). */
  back: number;
}

interface Schedule {
  ix: number;
  iy: number;
  fx: number;
  fy: number;
  fi: number;
  /** Take-off time of your latest jump (sim time). */
  jumpT: number;
  queued: boolean;
  future: Scheduled[];
}

export class LavaPredictor {
  seq = 0;
  events: InputEvent[] = [];
  base: Base | null = null;
  /** How long inputs take to reach the server (its arrival time minus your clock when sent). */
  private readonly leadF = new LeadFilter(0, 900, { quantile: 0.9, margin: LEAD_MARGIN, keep: 32, ttl: 30_000, slew: 0.05 });
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
    const sent = this.now(perf);
    this.push({ seq, kind: 0, x: x / 100, y: y / 100, sent, at: this.stampAt(sent, perf), t: null });
    return seq;
  }

  /** You pressed jump. Returns the input number to send. */
  recordJump(perf: number): number {
    const seq = ++this.seq;
    const sent = this.now(perf);
    this.push({ seq, kind: 1, x: 0, y: 0, sent, at: this.stampAt(sent, perf), t: null });
    this.jumpedAt = perf;
    this.jumps += 1;
    return seq;
  }

  private stampAt(sent: number, perf: number) {
    return Number.isFinite(sent) ? Math.round(sent + this.lead(perf)) : NaN;
  }

  /** The sim time to send with input `seq` (`at`), or undefined when it goes unstamped. */
  stamp(seq: number): number | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const ev = this.events[i];
      if (ev.seq === seq) return Number.isFinite(ev.at) ? ev.at : undefined;
    }
    return undefined;
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

  /**
   * The server acknowledged input `seq` as taking effect from sim time `t`, having arrived at sim
   * time `arrived` (servers before input stamping leave that off).
   */
  ack(seq: number, t: number, arrived?: number, perf: number = performance.now()) {
    for (const ev of this.events) {
      if (ev.seq > seq) break;
      if (ev.t !== null) continue;
      if (ev.seq === seq) {
        ev.t = t;
        if (Number.isFinite(ev.sent)) {
          // How long it took to get there; an older server applies inputs on arrival instead.
          const sample =
            typeof arrived === "number" && Number.isFinite(arrived) ? arrived - ev.sent : t - ev.sent - LEAD_MARGIN;
          if (sample > -200 && sample < 2_000) this.leadF.add(sample, perf);
        }
      } else if (!Number.isFinite(ev.at)) {
        ev.t = Math.min(t, Number.isFinite(ev.sent) ? ev.sent + this.lead() : t);
      }
    }
  }

  /** ms from your clock to the sim time an input sent now takes effect (and the time everyone is drawn at). */
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

  /** Your inputs from snapshot time `bt` (with cooldown `cd` then) on. */
  private schedule(bt: number, cd: number): Schedule {
    const lead = this.lead();
    let ix = this.stickX;
    let iy = this.stickY;
    let fx = this.faceX;
    let fy = this.faceY;
    const future: Scheduled[] = [];
    for (const ev of this.events) {
      let at = ev.t ?? (Number.isFinite(ev.at) ? ev.at : Number.isFinite(ev.sent) ? ev.sent + lead : bt + SUB_MS);
      let back = 0;
      if (ev.t === null && at <= bt) {
        if (at < bt - 500) continue;
        // As on the server: a late stamped stick counts back up to MAX_REWIND_STEPS.
        if (Number.isFinite(ev.at) && ev.kind === 0) back = Math.min(MAX_REWIND_STEPS, Math.max(0, Math.round((bt - at) / SUB_MS) + 1));
        at = bt + SUB_MS * 0.5;
      }
      if (ev.t !== null && ev.t <= bt + SUB_MS * 0.5) {
        if (ev.kind === 0) {
          ix = ev.x;
          iy = ev.y;
          const m = Math.hypot(ix, iy);
          if (m > 0.05) [fx, fy] = [ix / m, iy / m];
        }
        continue;
      }
      future.push({ at, ev, back });
    }
    future.sort((p, q) => p.at - q.at || p.ev.seq - q.ev.seq);
    const age = jumpAge(cd);
    return { ix, iy, fx, fy, fi: 0, jumpT: age >= 0 ? bt - age * SUB_MS : -Infinity, queued: false, future };
  }

  /** You, one substep ending at `ts`: inputs landing then, a jump when the cooldown allows, motion. */
  private stepOwn(k: Kin, sc: Schedule, ts: number, friction: number) {
    while (sc.fi < sc.future.length && sc.future[sc.fi].at <= ts + SUB_MS * 0.5) {
      const { ev, back } = sc.future[sc.fi++];
      if (ev.kind === 0) {
        if (back > 0 && !this.decided) {
          const r = rewindDelta(back, ev.x - sc.ix, ev.y - sc.iy, ts - sc.jumpT < JUMP_MS - 1e-6);
          k.x += r.x;
          k.y += r.y;
          k.vx += r.vx;
          k.vy += r.vy;
        }
        sc.ix = ev.x;
        sc.iy = ev.y;
        const m = Math.hypot(sc.ix, sc.iy);
        if (m > 0.05) [sc.fx, sc.fy] = [sc.ix / m, sc.iy / m];
      } else sc.queued = true;
    }
    // Like the server: a queued jump waits for the cooldown.
    if (sc.queued && !this.decided && ts - sc.jumpT >= JUMP_CD_STEPS * SUB_MS - 1e-6) {
      sc.queued = false;
      sc.jumpT = ts;
      applyJump(k, sc.ix, sc.iy, sc.fx, sc.fy);
    }
    integrate(k, sc.ix, sc.iy, ts - sc.jumpT < JUMP_MS - 1e-6, friction, !this.decided);
  }

  /** You at sim time `T`, replayed from the newest snapshot. False when there's no snapshot. */
  predict(T: number, out: Kin): boolean {
    const b = this.base;
    if (!b) return false;
    const sc = this.schedule(b.t, b.cd);
    const k: Kin = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
    const end = Math.min(T, b.t + MAX_PREDICT_MS);
    const friction = this.decided ? BRAKE_FRICTION : FRICTION;
    let t = b.t;
    while (t + SUB_MS <= end + 1e-6) {
      const ts = t + SUB_MS;
      this.stepOwn(k, sc, ts, friction);
      t = ts;
    }
    const rem = Math.max(0, end - t) / 1000;
    out.x = k.x + k.vx * rem;
    out.y = k.y + k.vy * rem;
    out.vx = k.vx;
    out.vy = k.vy;
    this.jumpT = sc.jumpT;
    return true;
  }

  /**
   * Everyone at sim time `T`, from snapshot `w`: you (slot `mine`, -1 = watching) replayed with
   * your inputs, the others dead-reckoned with their last stick (OTHERS_MS at most, then gliding to
   * a stop), bumps resolved as the server resolves them. Fills `out[slot]`, and `contacts` if given.
   */
  predictWorld(T: number, w: World, mine: number, out: (Kin | undefined)[], contacts?: PredictedContact[]) {
    out.length = 0;
    const rs = w.runners.map((r) => {
      const age = jumpAge(r.cd);
      return { ...r, k: { x: r.x, y: r.y, vx: r.vx, vy: r.vy } as Kin, jumpT: age >= 0 ? w.t - age * SUB_MS : -Infinity };
    });
    const own = mine >= 0 && this.base && this.base.n === w.n ? rs.find((r) => r.slot === mine) : undefined;
    const sc = own ? this.schedule(w.t, own.cd) : null;
    const end = Math.max(w.t, Math.min(T, w.t + MAX_PREDICT_MS));
    const othersEnd = w.t + OTHERS_MS;
    const decided = this.decided;
    const friction = decided ? BRAKE_FRICTION : FRICTION;
    const air: boolean[] = [];
    let t = w.t;
    while (t + SUB_MS <= end + 1e-6) {
      const ts = t + SUB_MS;
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i];
        if (r === own && sc) {
          this.stepOwn(r.k, sc, ts, friction);
          r.jumpT = sc.jumpT;
        } else {
          const inAir = ts - r.jumpT < JUMP_MS - 1e-6;
          if (ts <= othersEnd || decided) integrate(r.k, r.ix, r.iy, inAir, friction, !decided);
          else integrate(r.k, 0, 0, inAir, PAUSE_FRICTION, false);
        }
        air[i] = ts - r.jumpT < JUMP_MS - 1e-6;
      }
      for (let i = 0; i < rs.length; i++) {
        for (let j = i + 1; j < rs.length; j++) {
          // A jumper sails over people on the ground.
          if (air[i] !== air[j]) continue;
          const c = resolveBump(rs[i].k, rs[j].k, PLAYER_R, 1, 0);
          if (c && c.j > 0 && contacts) {
            contacts.push({ a: rs[i].slot, b: rs[j].slot, x: rs[i].k.x + c.nx * PLAYER_R, y: rs[i].k.y + c.ny * PLAYER_R, j: c.j, t: ts });
          }
        }
      }
      t = ts;
    }
    if (sc) this.jumpT = sc.jumpT;
    const rem = Math.max(0, end - t) / 1000;
    for (const r of rs) out[r.slot] = { x: r.k.x + r.k.vx * rem, y: r.k.y + r.k.vy * rem, vx: r.k.vx, vy: r.k.vy };
  }

  /** Facing for the next jump with no stick (unit vector). */
  facing(): [number, number] {
    return [this.faceX, this.faceY];
  }
}

/** A snapshot as everyone to predict from (what arena.tsx builds from each frame). */
export function worldOfSnap(s: Snap): World {
  const runners: WorldRunner[] = [];
  for (const p of s.p) {
    if (!Array.isArray(p) || p.length < 5) continue;
    const [ix, iy] = typeof p[7] === "number" ? decodeStick(p[7]) : [0, 0];
    runners.push({ slot: p[0], x: p[1], y: p[2], vx: p[3], vy: p[4], ix, iy, cd: p[6] ?? 0 });
  }
  return { n: s.n, t: s.t, runners };
}

