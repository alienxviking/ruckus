"use client";

// Canvas renderer, prediction and controls for Puck.
//
// ONE MOMENT. Everything is drawn at the sim time a move you make now reaches the server
// (`serverNow + lead`, lead ~ one round trip). Your paddle sits right under your finger (it runs
// the server's own paddle rule locally, so zero lag), and the puck is run forward from the newest
// snapshot through the shared physics (physics.ts) to that moment, colliding with your paddle's
// actual recent path and the other paddles' extrapolated ones. So when you smack the puck, it
// flies off on screen at once, and the server (which gets your move just in time) agrees. When a
// new snapshot disagrees (someone else's hit), the difference is eased out with a short spring.

import { useEffect, useEffectEvent, useRef, type PointerEvent, type ReactNode } from "react";
import { drawAvatar, preloadAvatars } from "@/lib/avatar-art";
import { feedback, sfx } from "@/lib/feedback";
import { Spring2D, Timeline } from "../snakes/netsmooth";
import { C_PADDLE, stepPaddle, stepPuck, type Kin, type Sweep } from "./physics";
import {
  GOAL_X0,
  GOAL_X1,
  GOAL_W,
  H,
  HALF_MS,
  MID,
  NET_D,
  PUCK_R,
  SPEEDS,
  SUB_MS,
  TICK_MS,
  W,
  clampTo,
  isSnap,
  zoneRect,
  type PuckAction,
  type PuckView,
  type Snap,
} from "./shared";

export interface TableData {
  view: PuckView;
  /** Your slot (-1 = watching). */
  mySlot: number;
  /** Team colours (index = team). */
  teamColors: [string, string];
  names: string[];
  avatars: string[];
  offline: boolean[];
  reduced: boolean;
}

// ---------- scene ----------

interface Frame {
  n: number;
  t: number;
  p: [number, number, number, number];
  d: number[];
  l: number;
  h: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t0: number;
  life: number;
  color: string;
  size: number;
  /** 0 = spark, 1 = confetti, 2 = ring. */
  kind: number;
  rot: number;
}

interface Scene {
  frames: Frame[];
  clock: Timeline;
  spring: Spring2D;
  /** The newest frame the puck was last predicted from, and what it predicted. */
  rawFrom: Frame | null;
  lastT: number;
  lead: number;
  /** Your paddle (world), its target, and where it was at each recent sim moment. */
  me: { x: number; y: number; tx: number; ty: number; n: number; ready: boolean };
  hist: { T: number; x: number; y: number }[];
  others: { x: number; y: number; ok: boolean }[];
  puck: { x: number; y: number; vx: number; vy: number; ok: boolean };
  trail: { x: number; y: number; at: number }[];
  parts: Particle[];
  fxT: number;
  slotFx: number[];
  shakeAt: number;
  shake: number;
  flash: { color: string; at: number } | null;
  goal: { at: number; team: number; text: string; sub: string } | null;
  last: number;
  sendTimer: ReturnType<typeof setTimeout> | null;
  sentAt: number;
  sent: string;
  touch: boolean;
}

function newScene(): Scene {
  return {
    frames: [],
    clock: new Timeline({ period: TICK_MS, start: 140, min: TICK_MS + 15, max: 650 }),
    spring: new Spring2D(45),
    rawFrom: null,
    lastT: 0,
    lead: 100,
    me: { x: W / 2, y: H - 120, tx: W / 2, ty: H - 120, n: -1, ready: false },
    hist: [],
    others: [],
    puck: { x: W / 2, y: MID, vx: 0, vy: 0, ok: false },
    trail: [],
    parts: [],
    fxT: 0,
    slotFx: [],
    shakeAt: -1e9,
    shake: 0,
    flash: null,
    goal: null,
    last: -1,
    sendTimer: null,
    sentAt: 0,
    sent: "",
    touch: false,
  };
}

function pushFrame(sc: Scene, snap: Snap, perf: number) {
  if (!Array.isArray(snap.p) || snap.p.length < 4 || !Array.isArray(snap.d)) return;
  const f: Frame = { n: snap.n, t: snap.t, p: [snap.p[0], snap.p[1], snap.p[2], snap.p[3]], d: snap.d.slice(), l: snap.l ?? -1, h: snap.h ?? snap.t };
  const frames = sc.frames;
  const last = frames[frames.length - 1];
  if (last && f.n !== last.n) {
    if (f.n < last.n) return;
    frames.length = 0;
    sc.spring.reset();
    sc.trail.length = 0;
    sc.rawFrom = null;
  } else if (last && f.t <= last.t) {
    if (frames.some((x) => x.t === f.t)) return;
    frames.splice(Math.max(0, frames.findIndex((x) => x.t > f.t)), 0, f);
    return;
  }
  sc.clock.observe(f.t, perf);
  if (last && snap.q === 1 && f.t - last.t > TICK_MS * 1.5) frames.push({ ...last, t: f.t - TICK_MS });
  frames.push(f);
  if (frames.length > 24) frames.splice(0, frames.length - 24);
}

// ---------- surface ----------

interface Surface {
  W: number;
  H: number;
  dpr: number;
  s: number;
  ox: number;
  oy: number;
  flip: boolean;
  bg: HTMLCanvasElement | null;
  bgKey: string;
}

const PAD_X = 14;
const PAD_Y = NET_D + 16;

function layout(cw: number, ch: number, dpr: number, flip: boolean): Surface {
  const s = Math.min(cw / (W + PAD_X * 2), ch / (H + PAD_Y * 2));
  return { W: cw, H: ch, dpr, s, ox: (cw - W * s) / 2, oy: (ch - H * s) / 2, flip, bg: null, bgKey: "" };
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const sx = (S: Surface, x: number, _y: number) => S.ox + (S.flip ? W - x : x) * S.s;
const sy = (S: Surface, _x: number, y: number) => S.oy + (S.flip ? H - y : y) * S.s;
/** Canvas px -> world. */
const wx = (S: Surface, px: number) => (S.flip ? W - (px - S.ox) / S.s : (px - S.ox) / S.s);
const wy = (S: Surface, py: number) => (S.flip ? H - (py - S.oy) / S.s : (py - S.oy) / S.s);

// ---------- colours ----------

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex: string, a: number) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ---------- the table (drawn once per size / side) ----------

function renderBackground(S: Surface, colors: [string, string], bottomTeam: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = S.W;
  c.height = S.H;
  const g = c.getContext("2d")!;
  const s = S.s;
  const x0 = S.ox;
  const y0 = S.oy;
  const tw = W * s;
  const th = H * s;
  const bottomC = colors[bottomTeam];
  const topC = colors[1 - bottomTeam];
  const rr = 46 * s;

  // Nets behind each end (drawn first, the rail cuts over them).
  for (const [end, col] of [
    [0, topC],
    [1, bottomC],
  ] as const) {
    const gx = x0 + GOAL_X0 * s;
    const gy = end === 0 ? y0 - NET_D * s : y0 + th;
    g.fillStyle = rgba(col, 0.14);
    g.fillRect(gx, gy, GOAL_W * s, NET_D * s);
    g.strokeStyle = rgba(col, 0.35);
    g.lineWidth = Math.max(1, s);
    g.beginPath();
    for (let i = 0; i <= GOAL_W; i += 20) {
      g.moveTo(gx + i * s, gy);
      g.lineTo(gx + i * s, gy + NET_D * s);
    }
    for (let j = 0; j <= NET_D; j += 12) {
      g.moveTo(gx, gy + j * s);
      g.lineTo(gx + GOAL_W * s, gy + j * s);
    }
    g.stroke();
  }

  // Surface.
  g.save();
  g.beginPath();
  g.roundRect(x0, y0, tw, th, rr);
  g.clip();
  const grad = g.createLinearGradient(0, y0, 0, y0 + th);
  grad.addColorStop(0, rgba(topC, 0.2));
  grad.addColorStop(0.42, "#0a0f1c");
  grad.addColorStop(0.58, "#0a0f1c");
  grad.addColorStop(1, rgba(bottomC, 0.2));
  g.fillStyle = "#0a0f1c";
  g.fillRect(x0, y0, tw, th);
  g.fillStyle = grad;
  g.fillRect(x0, y0, tw, th);
  // Air holes.
  g.fillStyle = "rgba(255,255,255,0.05)";
  const step = 30;
  const dot = Math.max(0.7, 1.6 * s);
  for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) g.fillRect(x0 + x * s - dot / 2, y0 + y * s - dot / 2, dot, dot);
  // Centre line and circle.
  g.strokeStyle = "rgba(255,255,255,0.22)";
  g.lineWidth = Math.max(1.5, 4 * s);
  g.beginPath();
  g.moveTo(x0, y0 + th / 2);
  g.lineTo(x0 + tw, y0 + th / 2);
  g.stroke();
  g.beginPath();
  g.arc(x0 + tw / 2, y0 + th / 2, 80 * s, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.22)";
  g.beginPath();
  g.arc(x0 + tw / 2, y0 + th / 2, 8 * s, 0, Math.PI * 2);
  g.fill();
  // Creases.
  for (const [cy, col, dir] of [
    [y0, topC, 1],
    [y0 + th, bottomC, -1],
  ] as const) {
    g.strokeStyle = rgba(col, 0.55);
    g.fillStyle = rgba(col, 0.08);
    g.lineWidth = Math.max(1.5, 4 * s);
    g.beginPath();
    g.arc(x0 + tw / 2, cy, 150 * s, dir > 0 ? 0 : Math.PI, dir > 0 ? Math.PI : Math.PI * 2);
    g.fill();
    g.stroke();
    // Faceoff dots.
    g.fillStyle = rgba(col, 0.5);
    g.beginPath();
    g.arc(x0 + tw / 2, cy + dir * 330 * s, 6 * s, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // Rails.
  g.lineWidth = Math.max(3, 10 * s);
  g.strokeStyle = "#1e2638";
  g.beginPath();
  g.roundRect(x0, y0, tw, th, rr);
  g.stroke();
  g.lineWidth = Math.max(1, 2.5 * s);
  for (const [end, col] of [
    [0, topC],
    [1, bottomC],
  ] as const) {
    g.strokeStyle = rgba(col, 0.85);
    g.shadowColor = col;
    g.shadowBlur = 10 * S.dpr;
    g.beginPath();
    const yy = end === 0 ? y0 : y0 + th;
    g.moveTo(x0 + rr, yy);
    g.lineTo(x0 + GOAL_X0 * s, yy);
    g.moveTo(x0 + GOAL_X1 * s, yy);
    g.lineTo(x0 + tw - rr, yy);
    g.stroke();
    // Half the side rails in this end's colour.
    g.beginPath();
    const ya = end === 0 ? y0 + rr : y0 + th / 2;
    const yb = end === 0 ? y0 + th / 2 : y0 + th - rr;
    g.moveTo(x0, ya);
    g.lineTo(x0, yb);
    g.moveTo(x0 + tw, ya);
    g.lineTo(x0 + tw, yb);
    g.stroke();
    // Goal mouth glow.
    g.lineWidth = Math.max(2, 6 * s);
    g.strokeStyle = col;
    g.beginPath();
    g.moveTo(x0 + GOAL_X0 * s, yy);
    g.lineTo(x0 + GOAL_X1 * s, yy);
    g.globalAlpha = 0.35;
    g.stroke();
    g.globalAlpha = 1;
    g.lineWidth = Math.max(1, 2.5 * s);
  }
  g.shadowBlur = 0;
  // Posts.
  g.fillStyle = "#e2e8f0";
  for (const yy of [y0, y0 + th]) {
    for (const xx of [GOAL_X0, GOAL_X1]) {
      g.beginPath();
      g.arc(x0 + xx * s, yy, Math.max(2, 6 * s), 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}

// ---------- prediction ----------

interface Contact {
  kind: number;
  slot: number;
  x: number;
  y: number;
  power: number;
  t: number;
}

/** The longest the puck is run past its newest snapshot (ms). */
const MAX_AHEAD = 700;
/** Other paddles are extrapolated at most this far (ms). */
const OTHERS_AHEAD = 120;

function paddleVel(frames: Frame[], f: Frame, slot: number): [number, number] {
  const prev = frames[frames.length - 2];
  if (!prev || prev.n !== f.n || f.t - prev.t < 10 || f.t - prev.t > 200) return [0, 0];
  const dt = f.t - prev.t;
  return [(f.d[slot * 2] - prev.d[slot * 2]) / dt, (f.d[slot * 2 + 1] - prev.d[slot * 2 + 1]) / dt];
}

/** Your paddle at sim time `t`, from where you've had it on screen. */
function histAt(sc: Scene, t: number, fx: number, fy: number): [number, number] {
  const h = sc.hist;
  if (!h.length || t <= h[0].T) return h.length ? [h[0].x, h[0].y] : [fx, fy];
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].T <= t) {
      const a = h[i];
      const b = h[i + 1];
      if (!b) return [a.x, a.y];
      const k = (t - a.T) / Math.max(1e-6, b.T - a.T);
      return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k];
    }
  }
  return [h[0].x, h[0].y];
}

const sweeps: Sweep[] = [];

/** The puck at sim time T, run forward from frame `f`. */
function predictPuck(sc: Scene, f: Frame, T: number, d: TableData, contacts: Contact[] | null): Kin {
  const p: Kin = { x: f.p[0], y: f.p[1], vx: f.p[2], vy: f.p[3] };
  const view = d.view;
  if (view.phase !== "live") return p;
  const sp = SPEEDS[view.speed] ?? SPEEDS.normal;
  const n = view.ids.length;
  const vel: [number, number][] = [];
  for (let i = 0; i < n; i++) vel.push(paddleVel(sc.frames, f, i));
  const rects = view.ids.map((_, i) => zoneRect(view.team[i], view.zone[i], view.r[i]));
  const at = (i: number, t: number): [number, number] => {
    if (i === d.mySlot) return histAt(sc, t, f.d[i * 2], f.d[i * 2 + 1]);
    const e = Math.min(OTHERS_AHEAD, Math.max(0, t - f.t));
    return clampTo(rects[i], f.d[i * 2] + vel[i][0] * e, f.d[i * 2 + 1] + vel[i][1] * e);
  };
  const end = Math.min(T, f.t + MAX_AHEAD);
  let t = f.t;
  while (t + SUB_MS <= end) {
    sweeps.length = 0;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = at(i, t);
      const [x1, y1] = at(i, t + SUB_MS);
      sweeps.push({ slot: i, x0, y0, x1, y1, r: view.r[i] });
    }
    const ts = t + SUB_MS;
    const scored = stepPuck(p, sweeps, sp.max, sp.friction, contacts ? (kind, slot, x, y, power) => contacts.push({ kind, slot, x, y, power, t: ts }) : undefined);
    t = ts;
    if (scored >= 0) {
      p.vx = p.vy = 0;
      return p;
    }
  }
  const rem = Math.max(0, end - t) / 1000;
  p.x += p.vx * rem;
  p.y += p.vy * rem;
  return p;
}

// ---------- effects ----------

function burst(sc: Scene, x: number, y: number, n: number, color: string, speed: number, now: number, kind = 0) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.3 + Math.random() * 0.8);
    sc.parts.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - (kind === 1 ? speed * 0.6 : 0),
      t0: now,
      life: kind === 1 ? 1400 + Math.random() * 900 : 260 + Math.random() * 260,
      color,
      size: kind === 1 ? 5 + Math.random() * 6 : 2 + Math.random() * 3,
      kind,
      rot: Math.random() * 6,
    });
  }
  if (sc.parts.length > 420) sc.parts.splice(0, sc.parts.length - 420);
}

function ring(sc: Scene, x: number, y: number, color: string, now: number, size: number) {
  sc.parts.push({ x, y, vx: 0, vy: 0, t0: now, life: 380, color, size, kind: 2, rot: 0 });
}

// ---------- drawing ----------

function drawPaddle(g: CanvasRenderingContext2D, S: Surface, x: number, y: number, r: number, color: string, avatar: string, mine: boolean, dim: boolean, now: number) {
  const X = sx(S, x, y);
  const Y = sy(S, x, y);
  const R = r * S.s;
  g.globalAlpha = dim ? 0.45 : 1;
  // Shadow.
  g.fillStyle = "rgba(0,0,0,0.45)";
  g.beginPath();
  g.ellipse(X + R * 0.12, Y + R * 0.18, R * 1.02, R * 0.98, 0, 0, Math.PI * 2);
  g.fill();
  // Body.
  const grad = g.createRadialGradient(X - R * 0.3, Y - R * 0.35, R * 0.1, X, Y, R);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, rgba(color, 0.75));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(X, Y, R, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = Math.max(1.5, R * 0.1);
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.stroke();
  // Knob with the avatar.
  g.fillStyle = "#0b1020";
  g.beginPath();
  g.arc(X, Y, R * 0.58, 0, Math.PI * 2);
  g.fill();
  drawAvatar(g, avatar, X, Y, R * 1.0);
  if (mine) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    g.lineWidth = Math.max(2, R * 0.08);
    g.strokeStyle = `rgba(255,255,255,${0.35 + 0.4 * pulse})`;
    g.beginPath();
    g.arc(X, Y, R + 5 * S.dpr + pulse * 3 * S.dpr, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalAlpha = 1;
}

function draw(g: CanvasRenderingContext2D, sc: Scene, S: Surface, d: TableData, perf: number) {
  const view = d.view;
  const latest = sc.frames[sc.frames.length - 1];
  if (!latest) return;
  const dt = sc.last < 0 ? 16 : Math.min(100, perf - sc.last);
  sc.last = perf;
  const reduced = d.reduced;
  const colors = d.teamColors;
  const mine = d.mySlot;
  const myTeam = mine >= 0 ? view.team[mine] : 0;

  // ----- the moment we draw -----
  sc.clock.tick(perf, latest.t, TICK_MS, 200);
  const T = Math.max(sc.lastT, sc.clock.serverNow(perf) + sc.lead);
  const prevT = sc.lastT;
  sc.lastT = T;

  // ----- your paddle -----
  if (mine >= 0) {
    const rect = zoneRect(view.team[mine], view.zone[mine], view.r[mine]);
    if (!sc.me.ready || sc.me.n !== latest.n) {
      const x = latest.d[mine * 2];
      const y = latest.d[mine * 2 + 1];
      if (!sc.me.ready || Math.hypot(x - sc.me.x, y - sc.me.y) > 40) {
        Object.assign(sc.me, { x, y, tx: x, ty: y });
        sc.hist.length = 0;
      }
      sc.me.ready = true;
      sc.me.n = latest.n;
    }
    if (view.phase !== "final") {
      [sc.me.x, sc.me.y] = stepPaddle(sc.me.x, sc.me.y, sc.me.tx, sc.me.ty, rect, dt / 1000);
    } else {
      sc.me.x = latest.d[mine * 2];
      sc.me.y = latest.d[mine * 2 + 1];
    }
    sc.hist.push({ T, x: sc.me.x, y: sc.me.y });
    while (sc.hist.length > 2 && sc.hist[0].T < T - 1_500) sc.hist.shift();
  }

  // ----- the puck -----
  const contacts: Contact[] = [];
  const raw = predictPuck(sc, latest, T, d, contacts);
  if (sc.rawFrom && sc.rawFrom !== latest && sc.rawFrom.n === latest.n && view.phase === "live") {
    // A new snapshot: what the old one says now vs the new one; ease the difference out.
    const old = predictPuck(sc, sc.rawFrom, T, d, null);
    const ex = old.x - raw.x;
    const ey = old.y - raw.y;
    if (Math.hypot(ex, ey) < 260) sc.spring.add(ex, ey);
    else sc.spring.reset();
  }
  sc.rawFrom = latest;
  sc.spring.step(dt);
  const P = sc.puck;
  P.x = raw.x + sc.spring.x;
  P.y = raw.y + sc.spring.y;
  P.vx = raw.vx;
  P.vy = raw.vy;
  P.ok = true;
  const speed = Math.hypot(P.vx, P.vy);

  // ----- hits: effects the moment they happen in the picture -----
  for (const c of contacts) {
    if (c.t <= prevT || view.phase !== "live") continue;
    if (c.kind === C_PADDLE) {
      if (perf - (sc.slotFx[c.slot] ?? -1e9) < 160) continue;
      sc.slotFx[c.slot] = perf;
      const col = colors[view.team[c.slot]] ?? "#fff";
      const hard = c.power > 900;
      burst(sc, c.x, c.y, reduced ? 4 : hard ? 16 : 8, col, hard ? 420 : 240, perf);
      ring(sc, c.x, c.y, col, perf, PUCK_R * (hard ? 2.6 : 1.8));
      if (hard && !reduced) {
        sc.shakeAt = perf;
        sc.shake = Math.min(7, c.power / 300);
      }
      if (c.slot === mine) feedback(hard ? "hit" : "bump");
      else sfx("bump");
    } else if (c.power > 500) {
      burst(sc, c.x, c.y, reduced ? 2 : 6, "#e2e8f0", 160, perf);
      if (c.power > 1100) sfx("bump");
    }
  }

  // ----- other paddles -----
  const n = view.ids.length;
  for (let i = 0; i < n; i++) {
    if (i === mine) continue;
    const o = (sc.others[i] ??= { x: latest.d[i * 2], y: latest.d[i * 2 + 1], ok: false });
    const [vx, vy] = paddleVel(sc.frames, latest, i);
    const e = Math.min(OTHERS_AHEAD, Math.max(0, T - latest.t));
    const tx = latest.d[i * 2] + vx * e;
    const ty = latest.d[i * 2 + 1] + vy * e;
    if (!o.ok) [o.x, o.y, o.ok] = [tx, ty, true];
    const k = 1 - Math.exp(-dt / 35);
    o.x += (tx - o.x) * k;
    o.y += (ty - o.y) * k;
  }

  // ----- paint -----
  const bottomTeam = S.flip ? 1 : 0;
  const key = `${S.W}x${S.H}|${S.flip}|${colors.join()}`;
  if (!S.bg || S.bgKey !== key) {
    S.bg = renderBackground(S, colors, bottomTeam);
    S.bgKey = key;
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, S.W, S.H);
  const sh = perf - sc.shakeAt < 240 ? (1 - (perf - sc.shakeAt) / 240) * sc.shake * S.dpr : 0;
  if (sh) g.setTransform(1, 0, 0, 1, Math.sin(perf / 13) * sh, Math.cos(perf / 17) * sh);
  g.drawImage(S.bg, 0, 0);

  // Big faint score in each half.
  const s = S.s;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `900 ${Math.round(150 * s)}px ui-sans-serif, system-ui, sans-serif`;
  for (const team of [0, 1]) {
    const yy = (team === 0) !== S.flip ? MID + 200 : MID - 200;
    g.fillStyle = rgba(colors[team], 0.1);
    g.fillText(String(view.score[team]), S.ox + (W / 2) * s, S.oy + yy * s);
  }

  // Puck trail.
  const tr = sc.trail;
  tr.push({ x: P.x, y: P.y, at: perf });
  while (tr.length && perf - tr[0].at > 160) tr.shift();
  if (view.phase === "live" && tr.length > 1 && speed > 250 && !reduced) {
    const col = latest.l >= 0 ? colors[view.team[latest.l]] : "#e2e8f0";
    for (let i = 1; i < tr.length; i++) {
      const k = i / tr.length;
      g.strokeStyle = rgba(col, 0.45 * k * Math.min(1, speed / 1200));
      g.lineWidth = PUCK_R * 2 * s * (0.3 + 0.7 * k);
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(sx(S, tr[i - 1].x, tr[i - 1].y), sy(S, tr[i - 1].x, tr[i - 1].y));
      g.lineTo(sx(S, tr[i].x, tr[i].y), sy(S, tr[i].x, tr[i].y));
      g.stroke();
    }
  }

  // 7-second rule: a ring around a puck that's been in one half too long.
  if (view.phase === "live") {
    const left = HALF_MS - (T - latest.h);
    if (left < 3_500 && left > 0) {
      const X = sx(S, P.x, P.y);
      const Y = sy(S, P.x, P.y);
      const half = P.y >= MID ? 0 : 1;
      g.strokeStyle = rgba(colors[half], 0.9);
      g.lineWidth = 4 * S.dpr;
      g.beginPath();
      g.arc(X, Y, (PUCK_R + 14) * s, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * left) / 3_500);
      g.stroke();
      g.font = `800 ${Math.round(13 * S.dpr)}px ui-sans-serif, system-ui, sans-serif`;
      g.fillStyle = "#fff";
      g.fillText(`${Math.ceil(left / 1000)}`, X, Y - (PUCK_R + 28) * s);
    }
  }

  // Paddles (yours last, on top).
  for (let i = 0; i < n; i++) {
    if (i === mine) continue;
    const o = sc.others[i];
    if (!o) continue;
    drawPaddle(g, S, o.x, o.y, view.r[i], colors[view.team[i]], d.avatars[i], false, d.offline[i], perf);
  }

  // Puck.
  {
    const X = sx(S, P.x, P.y);
    const Y = sy(S, P.x, P.y);
    const R = PUCK_R * s;
    const glow = g.createRadialGradient(X, Y, R * 0.5, X, Y, R * 2.4);
    glow.addColorStop(0, "rgba(255,255,255,0.35)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(X, Y, R * 2.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#f8fafc";
    g.beginPath();
    g.arc(X, Y, R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = latest.l >= 0 ? colors[view.team[latest.l]] : "#94a3b8";
    g.lineWidth = Math.max(2, R * 0.22);
    g.beginPath();
    g.arc(X, Y, R * 0.72, 0, Math.PI * 2);
    g.stroke();
  }

  if (mine >= 0) drawPaddle(g, S, sc.me.x, sc.me.y, view.r[mine], colors[myTeam], d.avatars[mine], true, false, perf);

  // Name tags while the puck is dead.
  if (view.phase === "set" || view.phase === "goal") {
    g.font = `700 ${Math.round(11 * S.dpr)}px ui-sans-serif, system-ui, sans-serif`;
    for (let i = 0; i < n; i++) {
      const x = i === mine ? sc.me.x : sc.others[i]?.x;
      const y = i === mine ? sc.me.y : sc.others[i]?.y;
      if (x === undefined || y === undefined) continue;
      const X = sx(S, x, y);
      const Y = sy(S, x, y) + (view.r[i] * s + 12 * S.dpr) * (sy(S, x, y) > S.H / 2 ? 1 : -1);
      const label = i === mine ? "YOU" : d.names[i];
      g.fillStyle = "rgba(5,6,10,0.7)";
      const w = g.measureText(label).width + 10 * S.dpr;
      g.beginPath();
      g.roundRect(X - w / 2, Y - 9 * S.dpr, w, 18 * S.dpr, 9 * S.dpr);
      g.fill();
      g.fillStyle = i === mine ? "#fff" : colors[view.team[i]];
      g.fillText(label, X, Y + 0.5);
    }
  }

  // Particles.
  const keep: Particle[] = [];
  for (const p of sc.parts) {
    const age = perf - p.t0;
    if (age > p.life) continue;
    keep.push(p);
    const k = age / p.life;
    const t = age / 1000;
    if (p.kind === 2) {
      g.strokeStyle = rgba(p.color, 1 - k);
      g.lineWidth = 3 * S.dpr * (1 - k);
      g.beginPath();
      g.arc(sx(S, p.x, p.y), sy(S, p.x, p.y), p.size * s * (0.6 + k), 0, Math.PI * 2);
      g.stroke();
      continue;
    }
    const grav = p.kind === 1 ? 900 : 0;
    const drag = p.kind === 1 ? 0.6 : 2.5;
    const f = (1 - Math.exp(-drag * t)) / drag;
    const x = p.x + p.vx * f;
    const y = p.y + p.vy * f + 0.5 * grav * t * t * (p.kind === 1 ? (S.flip ? -1 : 1) : 0);
    g.globalAlpha = 1 - k * k;
    g.fillStyle = p.color;
    if (p.kind === 1) {
      g.save();
      g.translate(sx(S, x, y), sy(S, x, y));
      g.rotate(p.rot + t * 6);
      g.fillRect((-p.size / 2) * S.dpr, (-p.size / 4) * S.dpr, p.size * S.dpr, (p.size / 2) * S.dpr);
      g.restore();
    } else {
      g.beginPath();
      g.arc(sx(S, x, y), sy(S, x, y), p.size * S.dpr * (1 - k * 0.6), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  sc.parts = keep;

  // Goal flash and banner.
  if (sc.flash) {
    const age = perf - sc.flash.at;
    if (age > 600) sc.flash = null;
    else {
      g.fillStyle = rgba(sc.flash.color, 0.35 * (1 - age / 600));
      g.fillRect(0, 0, S.W, S.H);
    }
  }
  const goal = sc.goal;
  if (goal) {
    const age = perf - goal.at;
    if (age > 2_100) sc.goal = null;
    else {
      const pop = reduced ? 1 : Math.min(1, age / 160) * (1 + 0.25 * Math.max(0, 1 - Math.abs(age - 200) / 200));
      const fade = age > 1_700 ? 1 - (age - 1_700) / 400 : 1;
      g.globalAlpha = fade;
      g.save();
      g.translate(S.W / 2, S.H / 2);
      g.scale(pop, pop);
      g.rotate(reduced ? 0 : -0.06);
      const big = Math.min(S.W * 0.24, 110 * S.dpr);
      g.font = `900 italic ${Math.round(big)}px ui-sans-serif, system-ui, sans-serif`;
      g.lineWidth = big * 0.12;
      g.strokeStyle = "rgba(5,6,10,0.85)";
      g.strokeText(goal.text, 0, 0);
      g.fillStyle = colors[goal.team];
      g.fillText(goal.text, 0, 0);
      g.font = `800 ${Math.round(big * 0.2)}px ui-sans-serif, system-ui, sans-serif`;
      g.lineWidth = big * 0.05;
      g.strokeText(goal.sub, 0, big * 0.62);
      g.fillStyle = "#fff";
      g.fillText(goal.sub, 0, big * 0.62);
      g.restore();
      g.globalAlpha = 1;
    }
  }
}

/** performance.now(), for event handlers. */
const perfNow = () => performance.now();

// ---------- component ----------

export function Table({
  data,
  act,
  onEvent,
  rtt,
  label,
  hint,
  children,
}: {
  data: TableData;
  act: (a: PuckAction) => void;
  onEvent: (fn: (e: unknown) => void) => () => void;
  rtt?: () => number | null;
  label: string;
  hint: ReactNode;
  children?: ReactNode;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Scene>(newScene());
  const surface = useRef<Surface | null>(null);
  const { view, mySlot } = data;
  const flip = mySlot >= 0 && view.team[mySlot] === 1;

  // ----- frames -----
  const onSnap = useEffectEvent((snap: Snap) => pushFrame(scene.current, snap, performance.now()));
  useEffect(() => {
    if (isSnap(view.snap)) onSnap(view.snap);
  }, [view]);
  useEffect(
    () =>
      onEvent((e) => {
        if (isSnap(e)) onSnap(e);
      }),
    [onEvent],
  );

  // ----- goals: flash, confetti, banner -----
  const scoreKey = `${view.score[0]}-${view.score[1]}`;
  const seenScore = useRef(scoreKey);
  const onGoal = useEffectEvent(() => {
    const rec = view.log[view.log.length - 1];
    if (!rec) return;
    const sc = scene.current;
    const now = performance.now();
    const col = data.teamColors[rec.team];
    sc.flash = { color: col, at: now };
    const gy = rec.team === 0 ? 0 : H;
    burst(sc, W / 2, gy, data.reduced ? 12 : 90, col, 700, now, 1);
    if (!data.reduced) burst(sc, W / 2, gy, 40, "#ffffff", 500, now, 1);
    if (!data.reduced) {
      sc.shakeAt = now;
      sc.shake = 9;
    }
    const who = rec.slot >= 0 ? data.names[rec.slot] : rec.last >= 0 ? `own goal · ${data.names[rec.last]}` : "";
    sc.goal = { at: now, team: rec.team, text: "GOAL!", sub: `${who}${who ? "  ·  " : ""}${view.score[0]}–${view.score[1]}`.trim() };
    if (mySlot >= 0) feedback(view.team[mySlot] === rec.team ? "score" : "out");
    else sfx("score");
  });
  useEffect(() => {
    if (seenScore.current === scoreKey) return;
    seenScore.current = scoreKey;
    onGoal();
  }, [scoreKey]);

  // ----- canvas size -----
  useEffect(() => {
    preloadAvatars();
    const holder = holderRef.current;
    const canvas = canvasRef.current;
    if (!holder || !canvas) return;
    const fit = () => {
      const r = holder.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
      const cw = Math.round(r.width * dpr);
      const ch = Math.round(r.height * dpr);
      const cur = surface.current;
      if (cur && cur.W === cw && cur.H === ch && cur.dpr === dpr && cur.flip === flip) return;
      canvas.width = cw;
      canvas.height = ch;
      surface.current = layout(cw, ch, dpr, flip);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(holder);
    return () => ro.disconnect();
  }, [flip]);

  // ----- the loop -----
  const paint = useEffectEvent((perf: number) => {
    const canvas = canvasRef.current;
    const S = surface.current;
    const sc = scene.current;
    if (!canvas || !S) return;
    const r = rtt?.();
    const want = typeof r === "number" && Number.isFinite(r) ? Math.min(300, Math.max(30, r * 0.9)) : 100;
    sc.lead += (want - sc.lead) * 0.02;
    const g = canvas.getContext("2d");
    if (g) draw(g, sc, S, data, perf);
  });
  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      paint(t);
    };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        scene.current.clock.pause();
        scene.current.last = -1;
        raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", onVis);
    const sc = scene.current;
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      if (sc.sendTimer) clearTimeout(sc.sendTimer);
    };
  }, []);

  // ----- input -----
  const canMove = mySlot >= 0 && view.phase !== "final";
  const send = () => {
    const sc = scene.current;
    if (sc.sendTimer) clearTimeout(sc.sendTimer);
    sc.sendTimer = null;
    const x = Math.round(sc.me.tx);
    const y = Math.round(sc.me.ty);
    const key = `${x},${y}`;
    if (key === sc.sent) return;
    const now = perfNow();
    if (now - sc.sentAt < 33) {
      sc.sendTimer = setTimeout(send, 33 - (now - sc.sentAt));
      return;
    }
    sc.sent = key;
    sc.sentAt = now;
    act({ type: "m", x, y });
  };
  const aim = (e: PointerEvent<HTMLDivElement>) => {
    const S = surface.current;
    const canvas = canvasRef.current;
    if (!S || !canvas || !canMove) return;
    const rect = canvas.getBoundingClientRect();
    const touch = e.pointerType !== "mouse";
    // Fingers hide what they touch: the paddle rides a little above your fingertip.
    const px = (e.clientX - rect.left) * S.dpr;
    const py = (e.clientY - rect.top - (touch ? 46 : 0)) * S.dpr;
    const zr = zoneRect(view.team[mySlot], view.zone[mySlot], view.r[mySlot]);
    const [x, y] = clampTo(zr, wx(S, px), wy(S, py));
    scene.current.me.tx = x;
    scene.current.me.ty = y;
    send();
  };

  return (
    <>
      <div
        ref={holderRef}
        className="pk-stage relative mx-auto w-full touch-none select-none overflow-hidden rounded-2xl"
        style={{ cursor: canMove ? "none" : "default" }}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse") {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* synthetic pointers can't be captured */
            }
          }
          aim(e);
        }}
        onPointerMove={(e) => {
          if (e.pointerType === "mouse" || e.buttons || e.pressure > 0) aim(e);
        }}
      >
        <canvas ref={canvasRef} role="img" aria-label={label} className="absolute inset-0 h-full w-full" />
        {children}
      </div>
      <p className="text-center text-xs text-muted">{hint}</p>
    </>
  );
}
