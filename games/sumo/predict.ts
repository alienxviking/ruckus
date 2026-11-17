// Client-side prediction for Ice Sumo. Pure logic (no DOM, no React) so it can be tested against
// the real server.
//
// ONE TIMEFRAME. Everything a player sees is drawn at the same moment: the sim time at which an
// input pressed now takes effect on the server (`serverNow + lead`). Your own disc is replayed up
// to then from its newest snapshot with every input you've sent; every other disc is dead-reckoned
// up to then from the same snapshot with its last known stick, and all of them run through the
// shared physics together (physics.ts), contacts included. So when your disc meets another one on
// screen they bounce the way the server will bounce them, instead of a predicted disc running into
// a disc drawn half a second in the past. When a snapshot lands, the renderer re-predicts and eases
// the difference out (Spring2D); others are extrapolated at most ~600 ms, then glide to a pause.
//
// Inputs are stamped: each carries the sim time it is meant for (`at` = your clock + lead). The
// server holds an early one until then and applies a late one at once, as if on time but at most
// ~150 ms back, so your disc moves on the server exactly as you saw it (no rubber-banding) as long
// as inputs arrive within that window. `lead` is learned from when the server says they arrived.

import { CENTER, DISC_R, F_HEAVY, HEAVY_MASS, HEAVY_SCALE, TICK_MS, decodeStick, type Snap } from "./shared";
import {
  BRAKE_FRICTION,
  DASH_IMPULSE,
  FRICTION,
  MAX_REWIND_STEPS,
  rewindDelta,
  SUB_MS,
  applyDash,
  integrate,
  keepOnIce,
  resolveContact,
  type Kin,
} from "./physics";
import { LeadFilter } from "../snakes/netsmooth";

/**
 * Never replay further than this past the newest snapshot (ms): a stalled connection freezes you.
 * Generous, because real connections deliver in bunches after gaps of 0.5-1.5 s, and your avatar
 * has to keep moving through those gaps instead of freezing and then jumping.
 */
export const MAX_PREDICT_MS = 1_500;
/** Other discs are dead-reckoned this far past their snapshot, then glide to a pause. */
export const OTHERS_MS = 600;
/** Friction per substep once another disc has been extrapolated OTHERS_MS: it glides to a pause. */
const PAUSE_FRICTION = 0.97;
const MAX_EVENTS = 64;
/** Before the first acknowledgement and without a measured round trip: a typical phone one (ms). */
const LEAD_GUESS = 80;
/**
 * Stamps aim at the 90th percentile of how long inputs take to arrive, plus this margin (ms). It's
 * negative: the server applies a late input as if it had arrived on time (up to ~150 ms back), so
 * aiming a little short still gets nearly every input exactly where you saw it, and keeps the
 * present you're shown (and the other discs' extrapolation) a bit closer to the server.
 */
const LEAD_MARGIN = -60;

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

/** One disc of a snapshot, for predicting the whole rink. */
export interface WorldDisc {
  slot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Its owner's stick as of the snapshot (others keep steering the same way). */
  ix: number;
  iy: number;
  heavy: boolean;
}

/** A snapshot of the whole rink. */
export interface World {
  n: number;
  t: number;
  /** Rink radius. */
  r: number;
  discs: WorldDisc[];
}

/** A contact the prediction resolved (for on-screen effects). */
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
  /** Substeps the server will count it back (a stamped input arriving late). */
  back: number;
}

/** Your inputs from a snapshot on, and the stick/facing in effect while replaying them. */
interface Schedule {
  ix: number;
  iy: number;
  fx: number;
  fy: number;
  fi: number;
  future: Scheduled[];
}

export class SumoPredictor {
  seq = 0;
  events: InputEvent[] = [];
  base: Base | null = null;
  /** How long inputs take to reach the server (its arrival time minus your clock when sent). */
  private readonly leadF = new LeadFilter(0, 900, { quantile: 0.9, margin: LEAD_MARGIN, keep: 32, ttl: 30_000, slew: 0.05 });
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
    const sent = this.now(perf);
    this.push({ seq, kind: 0, x: x / 100, y: y / 100, sent, at: this.stampAt(sent, perf), t: null });
    return seq;
  }

  /** You pressed dash. Returns the input number to send. */
  recordDash(perf: number): number {
    const seq = ++this.seq;
    const sent = this.now(perf);
    this.push({ seq, kind: 1, x: 0, y: 0, sent, at: this.stampAt(sent, perf), t: null });
    this.dashedAt = perf;
    this.dashes += 1;
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
          // How long it took to get there. An older server (no arrival time, no stamping) applies
          // inputs when they arrive: then aim exactly at when it took effect.
          const sample =
            typeof arrived === "number" && Number.isFinite(arrived) ? arrived - ev.sent : t - ev.sent - LEAD_MARGIN;
          if (sample > -200 && sample < 2_000) this.leadF.add(sample, perf);
        }
      } else if (!Number.isFinite(ev.at)) {
        // Unstamped and overwritten before the server's next tick: it took effect no later than this one.
        ev.t = Math.min(t, Number.isFinite(ev.sent) ? ev.sent + this.lead() : t);
      }
    }
  }

  /** ms from your clock to the sim time an input sent now takes effect (and the time everything is drawn at). */
  lead(perf?: number): number {
    const v = this.leadF.value(perf);
    if (!Number.isNaN(v)) return v;
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

  /**
   * Your inputs as of snapshot time `bt`: the stick and facing already in effect, and the ones
   * still to land, in order, with the sim time each lands.
   */
  private schedule(bt: number) {
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
        // Not acknowledged by this snapshot, so it hasn't landed yet: it lands with the next
        // substep (the server applies a late input at once). A stamped one counts, as on the
        // server, as if it had landed on time, up to MAX_REWIND_STEPS back. One the server never
        // got is given up on.
        if (at < bt - 500) continue;
        if (Number.isFinite(ev.at)) back = Math.min(MAX_REWIND_STEPS, Math.max(0, Math.round((bt - at) / SUB_MS) + 1));
        at = bt + SUB_MS * 0.5;
      }
      if (ev.t !== null && ev.t <= bt + SUB_MS * 0.5) {
        // Already part of the snapshot.
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
    return { ix, iy, fx, fy, fi: 0, future };
  }

  /**
   * Your disc, one substep ending at `ts`: the inputs landing then (a late one with the server's
   * bounded catch-up), a dash, then the shared motion step.
   */
  private stepOwn(k: Kin, sc: Schedule, ts: number, heavy: boolean, friction: number) {
    const decided = this.decided;
    let dash = false;
    while (sc.fi < sc.future.length && sc.future[sc.fi].at <= ts + SUB_MS * 0.5) {
      const { ev, back } = sc.future[sc.fi++];
      if (ev.kind === 0) {
        if (back > 0 && !decided) {
          const r = rewindDelta(back, ev.x - sc.ix, ev.y - sc.iy, heavy);
          k.x += r.x;
          k.y += r.y;
          k.vx += r.vx;
          k.vy += r.vy;
        }
        sc.ix = ev.x;
        sc.iy = ev.y;
        const m = Math.hypot(sc.ix, sc.iy);
        if (m > 0.05) [sc.fx, sc.fy] = [sc.ix / m, sc.iy / m];
      } else {
        dash = true;
        if (back > 0 && !decided) {
          const [ux, uy] = applyDash({ x: 0, y: 0, vx: k.vx, vy: k.vy }, sc.ix, sc.iy, sc.fx, sc.fy);
          const r = rewindDelta(back, 0, 0, heavy, ux * DASH_IMPULSE, uy * DASH_IMPULSE);
          k.x += r.x;
          k.y += r.y;
        }
      }
    }
    if (dash && !decided) [sc.fx, sc.fy] = applyDash(k, sc.ix, sc.iy, sc.fx, sc.fy);
    integrate(k, sc.ix, sc.iy, heavy, friction, !decided);
  }

  /** Your disc at sim time `T`, replayed from the newest snapshot. False when there's no snapshot. */
  predict(T: number, out: Kin): boolean {
    const b = this.base;
    if (!b) return false;
    const sc = this.schedule(b.t);
    const k: Kin = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
    const end = Math.min(T, b.t + MAX_PREDICT_MS);
    const friction = this.decided ? BRAKE_FRICTION : FRICTION;
    let t = b.t;
    while (t + SUB_MS <= end + 1e-6) {
      const ts = t + SUB_MS;
      this.stepOwn(k, sc, ts, b.heavy, friction);
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

  /**
   * The whole rink at sim time `T`, from snapshot `w`: your disc (slot `mine`, -1 = watching)
   * replayed with your inputs, everyone else dead-reckoned with their last stick (for at most
   * OTHERS_MS, then gliding to a stop), all through the shared physics with contacts resolved as
   * the server resolves them. Fills `out[slot]` (undefined = not on the ice) and, if given,
   * `contacts` with the hits along the way.
   */
  predictWorld(T: number, w: World, mine: number, out: (Kin | undefined)[], contacts?: PredictedContact[]) {
    out.length = 0;
    const discs = w.discs.map((d) => ({ ...d, k: { x: d.x, y: d.y, vx: d.vx, vy: d.vy } as Kin }));
    const own = mine >= 0 && this.base && this.base.n === w.n ? discs.find((d) => d.slot === mine) : undefined;
    const sc = own ? this.schedule(w.t) : null;
    const end = Math.max(w.t, Math.min(T, w.t + MAX_PREDICT_MS));
    const othersEnd = w.t + OTHERS_MS;
    const decided = this.decided;
    const friction = decided ? BRAKE_FRICTION : FRICTION;
    let t = w.t;
    while (t + SUB_MS <= end + 1e-6) {
      const ts = t + SUB_MS;
      for (const d of discs) {
        if (d === own && sc) this.stepOwn(d.k, sc, ts, d.heavy, friction);
        else if (ts <= othersEnd || decided) integrate(d.k, d.ix, d.iy, d.heavy, friction, !decided);
        else integrate(d.k, 0, 0, d.heavy, PAUSE_FRICTION, false);
      }
      for (let i = 0; i < discs.length; i++) {
        for (let j = i + 1; j < discs.length; j++) {
          const a = discs[i];
          const b = discs[j];
          const ra = a.heavy ? DISC_R * HEAVY_SCALE : DISC_R;
          const rb = b.heavy ? DISC_R * HEAVY_SCALE : DISC_R;
          const c = resolveContact(a.k, b.k, ra, rb, a.heavy ? HEAVY_MASS : 1, b.heavy ? HEAVY_MASS : 1, 1, 0);
          if (c && c.j > 0 && contacts) contacts.push({ a: a.slot, b: b.slot, x: a.k.x + c.nx * ra, y: a.k.y + c.ny * ra, j: c.j, t: ts });
        }
      }
      if (decided) for (const d of discs) keepOnIce(d.k, w.r);
      t = ts;
    }
    const rem = Math.max(0, end - t) / 1000;
    for (const d of discs) out[d.slot] = { x: d.k.x + d.k.vx * rem, y: d.k.y + d.k.vy * rem, vx: d.k.vx, vy: d.k.vy };
  }

  /** Where a dash pressed now would push you (unit vector), for an instant effect. */
  dashDir(stickX: number, stickY: number, k: Kin): [number, number] {
    const probe: Kin = { x: 0, y: 0, vx: k.vx, vy: k.vy };
    return applyDash(probe, stickX, stickY, this.faceX, this.faceY);
  }
}

/** A snapshot as a rink to predict from (what rink.tsx builds from each frame). */
export function worldOfSnap(s: Snap): World {
  const discs: WorldDisc[] = [];
  for (const p of s.p) {
    if (!Array.isArray(p) || p.length < 5) continue;
    const [ix, iy] = typeof p[7] === "number" ? decodeStick(p[7]) : [0, 0];
    discs.push({ slot: p[0], x: p[1], y: p[2], vx: p[3], vy: p[4], ix, iy, heavy: ((p[5] ?? 0) & F_HEAVY) !== 0 });
  }
  return { n: s.n, t: s.t, r: s.r, discs };
}
