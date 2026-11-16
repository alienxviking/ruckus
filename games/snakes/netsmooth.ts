// Network smoothing shared by the real-time games (snakes, turf, sumo, lava, outbreak, snowball,
// incognito). Pure logic, no DOM, so tests and the latency harness can drive it with fake clocks.
//
// Measured on the live server (Cloudflare, a Wi-Fi client in India): the server's frames are
// stamped on a perfectly regular grid (every 50/110/120 ms), but they reach the browser with
// 100-1500 ms round trips, 60-75% of them in bunches (<5 ms apart) after gaps of up to 1.8 s.
// Anything that times motion off message arrival, or assumes ~100 ms of jitter, stutters there.
// So everything here works from the server's timestamps and adapts slowly and with hysteresis:
//
// - Timeline maps server time onto performance.now(). Its base is the quickest delivery over the
//   last few seconds (a windowed minimum, so one fast outlier or a slow spell can't yank it), and
//   playback runs `delay` behind that, where `delay` covers one frame interval plus a high
//   percentile of how late frames have been. The delay rises promptly when frames run late and
//   only falls after a long calm spell, and both base and delay slew at a few percent, so the
//   picture never jumps and never visibly speeds up or slows down.
// - LeadFilter turns noisy "how far ahead must I run" samples into a steady value (a percentile,
//   hysteresis, slew-limited), so a predicted avatar doesn't surge and lag with every sample.
// - Trail lets a locally simulated avatar compare the server's (old) position with where it
//   actually was back then, so latency isn't mistaken for an error (no rubber-banding).

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function quantile(values: number[], q: number): number {
  if (!values.length) return NaN;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
}

export interface TimelineOptions {
  /** Server frame interval (ms): playback needs a frame on both sides of the time it shows. */
  period: number;
  /** Delay before anything is measured (ms). */
  start?: number;
  min?: number;
  max?: number;
  /** Percentile of lateness the delay covers (0..1). */
  quantile?: number;
}

/** How long a delivery counts towards the quickest-delivery base (ms). */
const BASE_WINDOW_MS = 12_000;
/** How long lateness samples are remembered (ms). */
const LATE_WINDOW_MS = 10_000;
/** The delay only shrinks after wanting less for this long (ms)... */
const CALM_MS = 4_000;
/** ...by at least this fraction (or 20 ms). */
const HYST = 0.2;
/** Playback rate limits while catching up: base +-5%, delay +12% (more buffer) / -4%. */
const BASE_SLEW = 0.05;
const DELAY_UP = 0.12;
const DELAY_DOWN = 0.04;
/** A jump in the base this big (ms) isn't slewed: the clock restarts (tab slept, reconnect). */
const RESYNC_MS = 1_500;

/** Maps server time onto performance.now() for playback, smoothly. */
export class Timeline {
  ready = false;
  /** performance.now() of the last tick() (-1: restart the slew). */
  at = -1;
  /** perf - server of the quickest recent delivery (smoothed). */
  offset = 0;
  /** How far behind the quickest delivery playback runs (ms, smoothed). */
  delay: number;
  /** Where `delay` is heading. */
  goal: number;
  private readonly period: number;
  private readonly min: number;
  private readonly max: number;
  private readonly q: number;
  private deliveries: { at: number; s: number }[] = [];
  private late: { at: number; v: number }[] = [];
  private base = 0;
  private calmSince = -1;
  /** How long the current dry spell has stretched the delay (ms). */
  private stretch = 0;

  constructor(o: TimelineOptions) {
    this.period = o.period;
    this.min = o.min ?? o.period + 10;
    this.max = o.max ?? 650;
    this.q = o.quantile ?? 0.95;
    this.delay = this.goal = clamp(o.start ?? o.period + 60, this.min, this.max);
  }

  /** The quickest-delivery base the playback is heading to (perf - server, ms). */
  get target() {
    return this.base;
  }

  /** A frame stamped `t` (server ms) arrived at `perf` (performance.now()). */
  observe(t: number, perf: number) {
    if (!Number.isFinite(t) || !Number.isFinite(perf)) return;
    const s = perf - t;
    if (!this.ready || Math.abs(s - this.base) > RESYNC_MS * 2) {
      this.deliveries = [{ at: perf, s }];
      this.late = [];
      this.base = this.offset = s;
      this.ready = true;
      this.at = -1;
      return;
    }
    this.deliveries.push({ at: perf, s });
    while (this.deliveries.length > 1 && perf - this.deliveries[0].at > BASE_WINDOW_MS) this.deliveries.shift();
    if (this.deliveries.length > 400) this.deliveries.shift();
    let base = Infinity;
    for (const d of this.deliveries) if (d.s < base) base = d.s;
    this.base = base;
    this.late.push({ at: perf, v: s - base });
    while (this.late.length > 1 && perf - this.late[0].at > LATE_WINDOW_MS) this.late.shift();
    if (this.late.length > 300) this.late.shift();
    if (this.late.length < 6) return;
    const want = clamp(this.period + quantile(this.late.map((l) => l.v), this.q) + 8, this.min, this.max);
    if (want > this.goal) {
      this.goal = want;
      this.calmSince = -1;
    } else if (want < this.goal - Math.max(20, this.goal * HYST)) {
      if (this.calmSince < 0) this.calmSince = perf;
      else if (perf - this.calmSince > CALM_MS) {
        // Step down 10% a second while it stays calm.
        this.goal = Math.max(want, this.goal * (1 - HYST * 0.5));
        this.calmSince = perf - CALM_MS + 1_000;
      }
    } else this.calmSince = -1;
  }

  /**
   * Move the playback clock to `perf`; returns the server time to draw. `newest` = server time of
   * the newest frame in hand: playback never runs more than `slack` ms past it. If the buffer runs
   * dry, the delay stretches instead (playback waits where it is and carries on from there when
   * frames come), so a late burst never makes the picture jump ahead; the goal is raised to match
   * so it doesn't happen again straight away.
   */
  tick(perf: number, newest = Infinity, slack = 0, maxStretch = Infinity): number {
    const dt = this.at < 0 ? 0 : clamp(perf - this.at, 0, 100);
    this.at = perf;
    const diff = this.base - this.offset;
    if (Math.abs(diff) > RESYNC_MS) this.offset = this.base;
    else this.offset += clamp(diff, -dt * BASE_SLEW, dt * BASE_SLEW);
    this.delay += clamp(this.goal - this.delay, -dt * DELAY_DOWN, dt * DELAY_UP);
    let rt = perf - this.offset - this.delay;
    const over = rt - (newest + slack);
    if (over > 0 && Number.isFinite(over)) {
      // At most `maxStretch` past the goal: a game whose server skips frames while nothing moves
      // can't tell a quiet world from a late frame, so it only waits so long.
      const add = Math.min(over, Math.max(0, maxStretch - this.stretch));
      if (add > 0) {
        this.stretch += add;
        this.delay += add;
        this.goal = clamp(Math.max(this.goal, this.delay), this.min, this.max);
        this.calmSince = -1;
        rt -= add;
      }
    } else this.stretch = 0;
    return rt;
  }

  /** Server time now, as the quickest delivery would say (no playback delay). */
  serverNow(perf: number): number {
    return perf - this.offset;
  }

  /** Forget the slew position (e.g. after the tab was hidden): next tick starts fresh. */
  pause() {
    this.at = -1;
  }
}

/**
 * A steady "how far ahead" value from noisy samples: the given percentile of recent samples plus
 * a margin, raised promptly, lowered only after a calm spell, and slewed so the value moves at
 * most `slew` ms per ms of wall time.
 */
export class LeadFilter {
  private samples: { v: number; at: number }[] = [];
  private goal = NaN;
  private cur = NaN;
  private curAt = -1;
  private calmSince = -1;

  constructor(
    readonly lo: number,
    readonly hi: number,
    readonly opts: { quantile?: number; margin?: number; keep?: number; ttl?: number; slew?: number } = {},
  ) {}

  get count() {
    return this.samples.length;
  }

  add(v: number, perf: number) {
    if (!Number.isFinite(v)) return;
    const { keep = 16, ttl = 30_000, quantile: q = 0.9, margin = 6 } = this.opts;
    this.samples.push({ v, at: perf });
    while (this.samples.length > keep || (this.samples.length > 1 && perf - this.samples[0].at > ttl)) this.samples.shift();
    // Few samples: trust the worst one; plenty: a high percentile (one freak delay doesn't stick).
    const vs = this.samples.map((s) => s.v);
    const base = vs.length < 5 ? Math.max(...vs) : quantile(vs, q);
    const want = clamp(base + margin, this.lo, this.hi);
    if (Number.isNaN(this.goal) || want > this.goal) {
      if (Number.isNaN(this.goal)) this.cur = want;
      this.goal = want;
      this.calmSince = -1;
    } else if (want < this.goal - Math.max(8, Math.abs(this.goal) * 0.15)) {
      if (this.calmSince < 0) this.calmSince = perf;
      else if (perf - this.calmSince > 3_000) {
        this.goal = want;
        this.calmSince = -1;
      }
    } else this.calmSince = -1;
  }

  /**
   * The value at wall time `perf` (performance.now()); NaN until a sample arrived. Without `perf`:
   * the value as of the last call that had one (or the target, if nothing drives the slew).
   */
  value(perf?: number): number {
    if (Number.isNaN(this.goal)) return NaN;
    if (perf === undefined && this.curAt < 0) return this.goal;
    if (perf !== undefined && Number.isFinite(perf)) {
      const dt = this.curAt < 0 ? 0 : clamp(perf - this.curAt, 0, 250);
      if (perf >= this.curAt) {
        const slew = (this.opts.slew ?? 0.06) * dt;
        this.cur += clamp(this.goal - this.cur, -slew, slew);
        this.curAt = perf;
      }
    }
    return this.cur;
  }

  /** Where the value is heading. */
  get target() {
    return this.goal;
  }
}

/**
 * Recent positions of a locally simulated avatar, for reconciling with the server. The server's
 * position is always old by an unknown, jittery amount, so instead of comparing it with where you
 * are now, it is compared with the closest point of the path you actually walked over the last
 * `span` ms: moving in a straight line under any latency gives no error; being blocked, pushed or
 * stunned on the server does.
 */
export class Trail {
  private t: number[] = [];
  private x: number[] = [];
  private y: number[] = [];
  constructor(readonly span = 1_600) {}

  clear() {
    this.t.length = this.x.length = this.y.length = 0;
  }

  push(perf: number, x: number, y: number) {
    const n = this.t.length;
    if (n && perf - this.t[n - 1] < 8) {
      this.x[n - 1] = x;
      this.y[n - 1] = y;
      return;
    }
    this.t.push(perf);
    this.x.push(x);
    this.y.push(y);
    while (this.t.length > 2 && perf - this.t[0] > this.span) {
      this.t.shift();
      this.x.shift();
      this.y.shift();
    }
  }

  /** The whole remembered path moved by (dx, dy): a correction applied to the avatar. */
  shift(dx: number, dy: number) {
    for (let i = 0; i < this.x.length; i++) {
      this.x[i] += dx;
      this.y[i] += dy;
    }
  }

  /** Server says (sx, sy): the error vector from the nearest point of the path (0,0 if on it). */
  error(sx: number, sy: number, out: { x: number; y: number }): number {
    const n = this.t.length;
    if (!n) {
      out.x = out.y = 0;
      return 0;
    }
    let best = Infinity;
    let bx = 0;
    let by = 0;
    for (let i = 0; i < n; i++) {
      const ax = this.x[i];
      const ay = this.y[i];
      let px = ax;
      let py = ay;
      if (i + 1 < n) {
        const ex = this.x[i + 1] - ax;
        const ey = this.y[i + 1] - ay;
        const l2 = ex * ex + ey * ey;
        if (l2 > 1e-9) {
          const u = clamp(((sx - ax) * ex + (sy - ay) * ey) / l2, 0, 1);
          px = ax + ex * u;
          py = ay + ey * u;
        }
      }
      const d = (sx - px) * (sx - px) + (sy - py) * (sy - py);
      if (d < best) {
        best = d;
        bx = px;
        by = py;
      }
    }
    out.x = sx - bx;
    out.y = sy - by;
    return Math.sqrt(best);
  }
}

/**
 * Reconcile a locally simulated avatar (x, y) with the server's position for it, without
 * rubber-banding: errors within `tol` of the walked path are latency, not mistakes; real errors
 * are eased out with time constant `tauMs`; only a huge one (`snap`) teleports. Returns how far
 * the avatar was moved this frame. `still` = both the server and you have stood still a while:
 * then settle exactly onto the server's spot.
 */
export function reconcile(
  me: { x: number; y: number },
  trail: Trail,
  sx: number,
  sy: number,
  dtMs: number,
  o: { tol: number; snap: number; tauMs: number; still?: boolean },
  scratch: { x: number; y: number },
): number {
  if (o.still) {
    const ex = sx - me.x;
    const ey = sy - me.y;
    const k = 1 - Math.exp(-dtMs / 100);
    me.x += ex * k;
    me.y += ey * k;
    trail.shift(ex * k, ey * k);
    return Math.hypot(ex, ey) * k;
  }
  const err = trail.error(sx, sy, scratch);
  if (err > o.snap) {
    const dx = sx - me.x;
    const dy = sy - me.y;
    me.x = sx;
    me.y = sy;
    trail.clear();
    return Math.hypot(dx, dy);
  }
  if (err <= o.tol) return 0;
  // Only the part beyond the tolerance is an error; ease it out.
  const k = (1 - Math.exp(-dtMs / o.tauMs)) * (1 - o.tol / err);
  const dx = scratch.x * k;
  const dy = scratch.y * k;
  me.x += dx;
  me.y += dy;
  trail.shift(dx, dy);
  return Math.hypot(dx, dy);
}

/**
 * A visual offset that fades out like a critically damped spring: when a correction lands, the
 * offset takes it (the picture doesn't move), and then glides back to zero starting at the speed
 * it already had. Unlike a plain exponential fade, which starts at its fastest, the picture never
 * changes speed abruptly, so corrections show as a gentle drift rather than a twitch.
 */
export class Spring2D {
  x = 0;
  y = 0;
  private vx = 0;
  private vy = 0;
  /** `ms`: time constant (the offset is ~95% gone after ~5x this). */
  constructor(readonly ms: number) {}

  /**
   * Take a correction: the shown position stays where it was, and with `dvx`/`dvy` (the old
   * minus the new velocity, units per ms) so does the shown velocity.
   */
  add(dx: number, dy: number, dvx = 0, dvy = 0) {
    this.x += dx;
    this.y += dy;
    this.vx += dvx;
    this.vy += dvy;
  }

  reset() {
    this.x = this.y = this.vx = this.vy = 0;
  }

  /** Advance by `dt` ms. */
  step(dt: number) {
    if (dt <= 0) return;
    const w = 1 / this.ms;
    const e = Math.exp(-w * dt);
    const bx = this.vx + w * this.x;
    const by = this.vy + w * this.y;
    this.x = (this.x + bx * dt) * e;
    this.y = (this.y + by * dt) * e;
    this.vx = (this.vx - w * bx * dt) * e;
    this.vy = (this.vy - w * by * dt) * e;
    if (Math.abs(this.x) < 1e-4 && Math.abs(this.y) < 1e-4 && Math.abs(this.vx) < 1e-6 && Math.abs(this.vy) < 1e-6) this.reset();
  }

  get size() {
    return Math.hypot(this.x, this.y);
  }
}

// ---------- ?debug=1: per-frame samples for measuring smoothness in a real browser ----------

const DEBUG = typeof window !== "undefined" && /[?&]debug=1(&|$)/.test(window.location.search);

/**
 * With `?debug=1` in the page URL, renderers record what they drew each animation frame into
 * `window.__ruckusDebug.frames` (your avatar's position, the playback clock), so a test driver can
 * check the motion is smooth. Without it this does nothing.
 */
export function debugFrame(game: string, sample: Record<string, number>) {
  if (!DEBUG) return;
  const w = window as unknown as { __ruckusDebug?: { game: string; frames: Record<string, number>[] } };
  const d = (w.__ruckusDebug ??= { game, frames: [] });
  d.game = game;
  d.frames.push(sample);
  if (d.frames.length > 6000) d.frames.splice(0, 1000);
}
