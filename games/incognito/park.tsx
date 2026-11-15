"use client";

// Canvas renderer, playback buffer, own-walker prediction and controls for Incognito.
//
// The crowd: the server sends every walker's position 20 times a second. The renderer
// keeps a short buffer and draws the crowd ~100ms in the past, blending the two frames
// around that moment, so walkers glide at display refresh rate. The playback clock
// follows the quickest deliveries and slews gently, so network jitter never shows.
//
// You: your own walker runs the exact same walking model locally (shared.ts) from your
// keys or stick, so steering is instant. Since the server applies the same inputs a
// moment later, both paths agree; leftover drift is eased out whenever you stand still.
//
// Every walker is drawn identically from positions alone (facing and the walking bob
// come from motion), so the screen can't tell humans from bots either.

import { useEffect, useEffectEvent, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { IncView, SnipeRec } from "./server";
import {
  DART_MS,
  EXPOSE_MS,
  FX_PULSE,
  LANDMARKS,
  LIGHT_MS,
  LM_R,
  PARKS,
  ROUND_OVER_MS,
  SPRINT_MUL,
  TICK_MS,
  WALK,
  WALKER_R,
  WORLD_H,
  WORLD_W,
  decodePositions,
  inputDir,
  isSnap,
  landmarkAt,
  stepBody,
  type Park as ParkMap,
  type Snap,
} from "./shared";

const TAU = Math.PI * 2;
/** Playback sits this far behind the newest frame the network could have delivered. */
const DELAY_MS = 100;
const EXTRAP_MS = 150;
const KEEP_MS = 500;
const MAX_FRAMES = 60;
const PULSE_MS = 1_400;
const FALL_MS = 520;
const SHRUG_MS = 1_600;
/** World units per walking step (drives the leg swing). */
const STRIDE = 13;
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const SANS = "ui-sans-serif, system-ui, sans-serif";

const COAT = "#c49a5c";
const COAT_DARK = "#7a5a2e";
const HAT = "#34303f";
const HAT_BAND = "#8e2f3c";
const LEGS = "#2b2838";
const SKIN = "#f1cfa6";
const SKIN_DARK = "#b98a62";
const DART_RED = "#ff4d6d";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

// ---------- frames & clock ----------

interface Frame {
  n: number;
  t: number;
  xy: number[];
  f: number[][] | null;
}

/** Maps server time onto performance.now(), smoothly. */
class Clock {
  target = 0;
  offset = 0;
  ready = false;
  at = -1;

  observe(t: number, now: number) {
    const s = now - t;
    if (!this.ready || Math.abs(s - this.target) > 750) {
      this.target = s;
      this.offset = s;
      this.ready = true;
      return;
    }
    // Trust a quicker delivery at once; let a slower trend creep in.
    this.target = s < this.target ? s : this.target + (s - this.target) * 0.03;
  }

  /** Server time on screen (DELAY_MS behind). */
  tick(now: number) {
    const dt = this.at < 0 ? 0 : Math.min(100, Math.max(0, now - this.at));
    this.at = now;
    const diff = this.target - this.offset;
    if (Math.abs(diff) > 400) this.offset = this.target;
    else {
      const max = dt * 0.08;
      this.offset += Math.max(-max, Math.min(max, diff));
    }
    return now - this.offset - DELAY_MS;
  }
}

// ---------- scene ----------

interface Anim {
  x: number;
  y: number;
  ph: number;
  face: number;
  back: boolean;
  /** Smoothed world speed and screen velocity. */
  spd: number;
  svx: number;
  svy: number;
  init: boolean;
}

interface Pred {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ready: boolean;
  round: number;
  w: number;
  at: number;
  stillMs: number;
  farMs: number;
  /** Landmark you stand on (locally) and since when (performance.now). */
  lm: number;
  lmAt: number;
}

interface LocalDart {
  w: number;
  t0: number;
  /** Where it was aimed (world), for the drop when it's refused. */
  x: number;
  y: number;
  failed: number;
  matched: boolean;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t0: number;
  life: number;
  color: string;
  size: number;
}

interface Stick {
  id: number;
  ox: number;
  oy: number;
  kx: number;
  ky: number;
}

interface Press {
  id: number;
  x: number;
  y: number;
  t0: number;
  mouse: boolean;
  moved: boolean;
}

interface Surface {
  W: number;
  H: number;
  dpr: number;
  portrait: boolean;
  /** Device px per world unit, and where the world starts on the canvas. */
  s: number;
  ox: number;
  oy: number;
  park: number;
  bg: HTMLCanvasElement | null;
}

interface Scene {
  clock: Clock;
  frames: Frame[];
  fxCursor: number;
  rt: number;
  round: number;
  anim: Anim[];
  pos: number[];
  pred: Pred;
  pulses: { l: number; t0: number }[];
  bursts: { l: number; t0: number }[];
  sparks: Spark[];
  darts: LocalDart[];
  keys: Set<string>;
  sprintKey: boolean;
  sprintBtn: boolean;
  stick: Stick | null;
  press: Press | null;
  /** Input in world space, as the server will apply it. */
  ix: number;
  iy: number;
  sprint: boolean;
  sent: string;
  hover: number;
  hoverX: number;
  hoverY: number;
  tapAt: number;
  tapX: number;
  tapY: number;
  last: number;
  stillKey: string;
  /** Screen positions (device px) of every walker this frame, for picking. */
  sx: number[];
  sy: number[];
  u: number;
}

function newScene(): Scene {
  return {
    clock: new Clock(),
    frames: [],
    fxCursor: Infinity,
    rt: 0,
    round: -1,
    anim: [],
    pos: [],
    pred: { x: 0, y: 0, vx: 0, vy: 0, ready: false, round: -1, w: -1, at: -1, stillMs: 0, farMs: 0, lm: -1, lmAt: 0 },
    pulses: [],
    bursts: [],
    sparks: [],
    darts: [],
    keys: new Set(),
    sprintKey: false,
    sprintBtn: false,
    stick: null,
    press: null,
    ix: 0,
    iy: 0,
    sprint: false,
    sent: "0,0,0",
    hover: -1,
    hoverX: 0,
    hoverY: 0,
    tapAt: -1e9,
    tapX: 0,
    tapY: 0,
    last: -1,
    stillKey: "",
    sx: [],
    sy: [],
    u: 6,
  };
}

function pushFrame(sc: Scene, snap: Snap, now: number) {
  const f: Frame = { n: snap.n, t: snap.t, xy: decodePositions(snap.p), f: Array.isArray(snap.f) ? snap.f : null };
  const frames = sc.frames;
  let last: Frame | undefined = frames[frames.length - 1];
  if (!last) sc.fxCursor = f.t;
  else if (f.n !== last.n) {
    if (f.n < last.n) return; // a stale frame from an older round
    frames.length = 0;
    sc.fxCursor = f.t - 1;
    last = undefined;
  }
  if (!last || f.t > last.t) {
    sc.clock.observe(f.t, now);
    // The server skipped identical frames: the crowd stood still until one tick before this.
    if (last && snap.q === 1 && f.t - last.t > TICK_MS * 1.5) frames.push({ ...last, t: f.t - TICK_MS, f: null });
    frames.push(f);
  } else if (!frames.some((x) => x.t === f.t)) {
    const i = frames.findIndex((x) => x.t > f.t);
    frames.splice(i, 0, f);
  }
  if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
}

/** Every walker's world position at server time `rt` into `out`. */
function sampleAll(frames: Frame[], rt: number, out: number[]): boolean {
  const n = frames.length;
  if (!n) return false;
  let i = n - 1;
  while (i > 0 && frames[i].t > rt) i--;
  const a = frames[i];
  const len = a.xy.length;
  out.length = len;
  if (a.t >= rt) {
    for (let j = 0; j < len; j++) out[j] = a.xy[j];
    return true;
  }
  const b = frames[i + 1];
  if (!b) {
    // Late frame: keep walking along for a moment.
    const p = frames[i - 1];
    const gap = p ? a.t - p.t : 0;
    if (!p || gap > TICK_MS * 2.5 || p.xy.length !== len) {
      for (let j = 0; j < len; j++) out[j] = a.xy[j];
      return true;
    }
    const e = Math.min(rt - a.t, EXTRAP_MS) / gap;
    for (let j = 0; j < len; j++) out[j] = a.xy[j] + (a.xy[j] - p.xy[j]) * e;
    return true;
  }
  const k = (rt - a.t) / (b.t - a.t);
  for (let j = 0; j < len; j++) out[j] = a.xy[j] + ((b.xy[j] ?? a.xy[j]) - a.xy[j]) * k;
  return true;
}

// ---------- colours ----------

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x94a3b8;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(hex: string, to: number, f: number) {
  const [r, g, b] = hexRgb(hex);
  const c = (v: number) => Math.round(v + (to - v) * f);
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}
function lerpColor(a: string, b: string, t: number) {
  const x = hexRgb(a);
  const y = hexRgb(b);
  const c = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}
function rgba(hex: string, a: number) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ---------- geometry ----------

function layout(W: number, H: number, dpr: number, park: number): Surface {
  const portrait = H > W * 1.05;
  const ww = portrait ? WORLD_H : WORLD_W;
  const wh = portrait ? WORLD_W : WORLD_H;
  const s = Math.min(W / ww, H / wh);
  return { W, H, dpr, portrait, s, ox: (W - ww * s) / 2, oy: (H - wh * s) / 2, park, bg: null };
}
const toSX = (S: Surface, wx: number, wy: number) => (S.portrait ? S.ox + (WORLD_H - wy) * S.s : S.ox + wx * S.s);
const toSY = (S: Surface, wx: number, wy: number) => (S.portrait ? S.oy + wx * S.s : S.oy + wy * S.s);
/** Screen direction -> world direction. */
const toWorldDir = (S: Surface | null, dx: number, dy: number): [number, number] =>
  S?.portrait ? [dy, -dx] : [dx, dy];
const walkerUnit = (S: Surface) => Math.max(5 * S.dpr, Math.min(11 * S.dpr, WALKER_R * S.s * 0.9));

// ---------- background ----------

function seeded(seed: number) {
  let v = seed;
  return () => (v = (v * 16807) % 2147483647) / 2147483647;
}

function renderBackground(S: Surface, park: ParkMap): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = S.W;
  c.height = S.H;
  const g = c.getContext("2d");
  if (!g) return c;
  const X = (x: number, y: number) => toSX(S, x, y);
  const Y = (x: number, y: number) => toSY(S, x, y);
  const k = S.s;
  // Lawn.
  const grad = g.createLinearGradient(0, 0, S.W, S.H);
  grad.addColorStop(0, "#4f9d53");
  grad.addColorStop(1, "#3c8445");
  g.fillStyle = grad;
  g.fillRect(0, 0, S.W, S.H);
  // Mowing stripes (along the world's x axis).
  g.fillStyle = "rgba(255, 255, 255, 0.045)";
  for (let x = 0; x < WORLD_W; x += 100) {
    const a = [X(x, 0), Y(x, 0)];
    const b = [X(x + 50, WORLD_H), Y(x + 50, WORLD_H)];
    g.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  }
  // Grass tufts and flowers.
  const rnd = seeded(97 + S.park * 31);
  for (let i = 0; i < 420; i++) {
    const x = rnd() * WORLD_W;
    const y = rnd() * WORLD_H;
    const sx = X(x, y);
    const sy = Y(x, y);
    if (i % 9 === 0) {
      g.fillStyle = ["#fde68a", "#fbcfe8", "#ffffff", "#c4b5fd"][i % 4];
      g.beginPath();
      g.arc(sx, sy, Math.max(1, 2.2 * k), 0, TAU);
      g.fill();
    } else {
      g.strokeStyle = rnd() < 0.5 ? "rgba(20, 70, 30, 0.35)" : "rgba(160, 220, 140, 0.25)";
      g.lineWidth = Math.max(1, 1.4 * k);
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx + (rnd() - 0.5) * 4 * k, sy - 5 * k);
      g.stroke();
    }
  }
  // Paths: a loop through the landmarks, bending toward the middle.
  const cx = WORLD_W / 2;
  const cy = WORLD_H / 2;
  const ring = park.landmarks
    .map((l, i) => ({ l, i, a: Math.atan2(l.y - cy, l.x - cx) }))
    .filter(({ l }) => Math.hypot(l.x - cx, l.y - cy) > 80)
    .sort((a, b) => a.a - b.a);
  const pathOf = () => {
    const p = new Path2D();
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i].l;
      const b = ring[(i + 1) % ring.length].l;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const qx = mx + (cx - mx) * 0.32;
      const qy = my + (cy - my) * 0.32;
      p.moveTo(X(a.x, a.y), Y(a.x, a.y));
      p.quadraticCurveTo(X(qx, qy), Y(qx, qy), X(b.x, b.y), Y(b.x, b.y));
    }
    // Spokes from a central landmark (if any).
    for (const l of park.landmarks) {
      if (Math.hypot(l.x - cx, l.y - cy) > 80) continue;
      for (const r of ring.slice(0, 4)) {
        p.moveTo(X(l.x, l.y), Y(l.x, l.y));
        p.lineTo(X(r.l.x, r.l.y), Y(r.l.x, r.l.y));
      }
    }
    return p;
  };
  const path = pathOf();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = "#b39a6a";
  g.lineWidth = 30 * k;
  g.stroke(path);
  g.strokeStyle = "#dcc89c";
  g.lineWidth = 24 * k;
  g.stroke(path);
  // Pebbles on the path.
  g.setLineDash([1, 9 * k]);
  g.strokeStyle = "rgba(140, 115, 70, 0.45)";
  g.lineWidth = 3 * k;
  g.stroke(path);
  g.setLineDash([]);
  // Hedge border.
  g.strokeStyle = "#2f6b37";
  g.lineWidth = 12 * k;
  const bx = Math.min(X(0, 0), X(WORLD_W, WORLD_H));
  const by = Math.min(Y(0, 0), Y(WORLD_W, WORLD_H));
  const bw = Math.abs(X(WORLD_W, WORLD_H) - X(0, 0));
  const bh = Math.abs(Y(WORLD_W, WORLD_H) - Y(0, 0));
  roundRect(g, bx + 3 * k, by + 3 * k, bw - 6 * k, bh - 6 * k, 18 * k);
  g.stroke();
  g.strokeStyle = "rgba(120, 190, 110, 0.35)";
  g.lineWidth = 3 * k;
  roundRect(g, bx + 7 * k, by + 7 * k, bw - 14 * k, bh - 14 * k, 14 * k);
  g.stroke();
  // Landmark plazas.
  for (const l of park.landmarks) {
    const sx = X(l.x, l.y);
    const sy = Y(l.x, l.y);
    g.fillStyle = "#a8a08e";
    g.beginPath();
    g.arc(sx, sy, (LM_R + 3) * k, 0, TAU);
    g.fill();
    const pg = g.createRadialGradient(sx, sy - 6 * k, 2, sx, sy, LM_R * k);
    pg.addColorStop(0, "#f4efe2");
    pg.addColorStop(1, "#d8cfba");
    g.fillStyle = pg;
    g.beginPath();
    g.arc(sx, sy, LM_R * k, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(120, 105, 80, 0.35)";
    g.lineWidth = Math.max(1, 1.2 * k);
    for (let r = 0; r < 2; r++) {
      g.beginPath();
      g.arc(sx, sy, (LM_R * (0.45 + r * 0.3)) * k, 0, TAU);
      g.stroke();
    }
    for (let a = 0; a < 8; a++) {
      const an = (a / 8) * TAU;
      g.beginPath();
      g.moveTo(sx + Math.cos(an) * LM_R * 0.45 * k, sy + Math.sin(an) * LM_R * 0.45 * k);
      g.lineTo(sx + Math.cos(an) * LM_R * k, sy + Math.sin(an) * LM_R * k);
      g.stroke();
    }
    // Pedestal.
    g.fillStyle = "#8f8778";
    g.beginPath();
    g.ellipse(sx, sy + 3 * k, 11 * k, 6 * k, 0, 0, TAU);
    g.fill();
    g.fillStyle = "#cfc6b2";
    g.beginPath();
    g.ellipse(sx, sy + 1 * k, 10 * k, 5 * k, 0, 0, TAU);
    g.fill();
  }
  // Obstacles: shadows first, then the things themselves.
  for (const o of park.obstacles) {
    const sx = X(o.x, o.y);
    const sy = Y(o.x, o.y);
    g.fillStyle = "rgba(10, 40, 15, 0.3)";
    g.beginPath();
    g.ellipse(sx + o.r * 0.18 * k, sy + o.r * 0.22 * k, o.r * 1.05 * k, o.r * 0.9 * k, 0, 0, TAU);
    g.fill();
  }
  for (const o of park.obstacles) {
    const sx = X(o.x, o.y);
    const sy = Y(o.x, o.y);
    const r = o.r * k;
    if (o.kind === "fountain") {
      g.fillStyle = "#8d96a6";
      g.beginPath();
      g.arc(sx, sy, r, 0, TAU);
      g.fill();
      const rim = g.createRadialGradient(sx - r * 0.3, sy - r * 0.4, r * 0.2, sx, sy, r);
      rim.addColorStop(0, "#eef1f6");
      rim.addColorStop(1, "#aab3c2");
      g.fillStyle = rim;
      g.beginPath();
      g.arc(sx, sy, r * 0.92, 0, TAU);
      g.fill();
      const water = g.createRadialGradient(sx - r * 0.2, sy - r * 0.25, r * 0.05, sx, sy, r * 0.78);
      water.addColorStop(0, "#9be4ff");
      water.addColorStop(0.6, "#43b3ea");
      water.addColorStop(1, "#2a83c9");
      g.fillStyle = water;
      g.beginPath();
      g.arc(sx, sy, r * 0.76, 0, TAU);
      g.fill();
      g.fillStyle = "#c9d0dc";
      g.beginPath();
      g.arc(sx, sy, r * 0.2, 0, TAU);
      g.fill();
      g.fillStyle = "#e9fbff";
      g.beginPath();
      g.arc(sx, sy - r * 0.04, r * 0.1, 0, TAU);
      g.fill();
    } else {
      // A round, bushy canopy seen from above, lit from the top left.
      const rr = seeded(Math.round(o.x * 7 + o.y * 13));
      g.fillStyle = "#24592c";
      g.beginPath();
      g.arc(sx, sy, r, 0, TAU);
      g.fill();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + rr();
        const d = r * 0.48;
        const bx2 = sx + Math.cos(a) * d;
        const by2 = sy + Math.sin(a) * d;
        const br = r * (0.48 + rr() * 0.12);
        const cg = g.createRadialGradient(bx2 - br * 0.35, by2 - br * 0.4, br * 0.1, bx2, by2, br);
        cg.addColorStop(0, "#6fc56a");
        cg.addColorStop(1, "#2f7a35");
        g.fillStyle = cg;
        g.beginPath();
        g.arc(bx2, by2, br, 0, TAU);
        g.fill();
      }
      const top = g.createRadialGradient(sx - r * 0.25, sy - r * 0.3, r * 0.05, sx, sy, r * 0.62);
      top.addColorStop(0, "#8ad47f");
      top.addColorStop(1, "#3d8c3f");
      g.fillStyle = top;
      g.beginPath();
      g.arc(sx, sy, r * 0.58, 0, TAU);
      g.fill();
      g.fillStyle = "rgba(255, 255, 255, 0.12)";
      g.beginPath();
      g.ellipse(sx - r * 0.3, sy - r * 0.35, r * 0.28, r * 0.16, -0.6, 0, TAU);
      g.fill();
    }
  }
  return c;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

// ---------- the walker ----------

interface Look {
  face: number;
  back: boolean;
  ph: number;
  move: number;
  coat: string;
  trim: string;
  /** Lying on the grass: 0 upright .. 1 flat. */
  fall?: number;
  hatless?: boolean;
}

/** A little trench-coated, fedora-wearing walker standing on (x, y). */
function drawWalker(g: CanvasRenderingContext2D, x: number, y: number, u: number, o: Look) {
  const fall = o.fall ?? 0;
  const bob = fall > 0 ? 0 : -Math.abs(Math.sin(o.ph)) * u * 0.22 * o.move;
  const sw = fall > 0 ? 0 : Math.sin(o.ph) * Math.min(1.2, o.move);
  // Shadow (stretches out as they topple).
  g.fillStyle = "rgba(10, 36, 16, 0.32)";
  g.beginPath();
  g.ellipse(x + o.face * fall * u * 1.4, y, u * (0.95 + fall * 1.2), u * (0.36 + fall * 0.12), 0, 0, TAU);
  g.fill();
  g.save();
  g.translate(x, y);
  if (fall > 0) g.rotate(o.face * fall * (Math.PI / 2));
  const top = -u * 2.0 + bob;
  const hem = -u * 0.55 + bob;
  // Legs.
  g.lineCap = "round";
  g.strokeStyle = LEGS;
  g.lineWidth = u * 0.36;
  g.beginPath();
  g.moveTo(-u * 0.3, hem - u * 0.2);
  g.lineTo(-u * 0.3 + sw * u * 0.36, -u * 0.12);
  g.moveTo(u * 0.3, hem - u * 0.2);
  g.lineTo(u * 0.3 - sw * u * 0.36, -u * 0.12);
  g.stroke();
  // Arms (behind the coat edges), swinging against the legs.
  g.fillStyle = o.trim;
  g.beginPath();
  g.ellipse(-u * 0.78, top + u * 0.62 + sw * u * 0.12, u * 0.22, u * 0.44, 0.15, 0, TAU);
  g.ellipse(u * 0.78, top + u * 0.62 - sw * u * 0.12, u * 0.22, u * 0.44, -0.15, 0, TAU);
  g.fill();
  // Trench coat.
  g.fillStyle = o.coat;
  g.beginPath();
  g.moveTo(-u * 0.56, top);
  g.quadraticCurveTo(-u * 0.98, hem - u * 0.25, -u * 0.86, hem);
  g.lineTo(u * 0.86, hem);
  g.quadraticCurveTo(u * 0.98, hem - u * 0.25, u * 0.56, top);
  g.closePath();
  g.fill();
  g.strokeStyle = o.trim;
  g.lineWidth = Math.max(1, u * 0.12);
  g.stroke();
  // Belt and lapel.
  g.beginPath();
  const belt = top + (hem - top) * 0.56;
  g.moveTo(-u * 0.84, belt);
  g.lineTo(u * 0.84, belt);
  if (!o.back) {
    g.moveTo(o.face * u * 0.06, top + u * 0.05);
    g.lineTo(o.face * u * 0.14, hem);
  }
  g.lineWidth = Math.max(1, u * 0.16);
  g.stroke();
  // Head.
  const hx = o.face * u * 0.05;
  const hy = top - u * 0.42;
  g.fillStyle = SKIN;
  g.beginPath();
  g.arc(hx, hy, u * 0.52, 0, TAU);
  g.fill();
  g.strokeStyle = SKIN_DARK;
  g.lineWidth = Math.max(1, u * 0.09);
  g.stroke();
  if (!o.back) {
    // Sunglasses.
    const gx = hx + o.face * u * 0.12;
    g.fillStyle = "#101018";
    g.beginPath();
    g.ellipse(gx - u * 0.19, hy - u * 0.02, u * 0.19, u * 0.14, 0, 0, TAU);
    g.ellipse(gx + u * 0.19, hy - u * 0.02, u * 0.19, u * 0.14, 0, 0, TAU);
    g.fill();
    g.fillRect(gx - u * 0.2, hy - u * 0.06, u * 0.4, u * 0.07);
    g.fillStyle = "rgba(255, 255, 255, 0.55)";
    g.fillRect(gx - u * 0.27, hy - u * 0.1, u * 0.08, u * 0.05);
  }
  if (!o.hatless) drawHat(g, hx, top - u * 0.7, u, o.back);
  g.restore();
}

function drawHat(g: CanvasRenderingContext2D, x: number, y: number, u: number, back: boolean) {
  g.fillStyle = HAT;
  g.beginPath();
  g.ellipse(x, y, u * 0.82, u * 0.2, 0, 0, TAU);
  g.fill();
  roundRect(g, x - u * 0.44, y - u * 0.56, u * 0.88, u * 0.6, u * 0.2);
  g.fill();
  g.fillStyle = HAT_BAND;
  g.fillRect(x - u * 0.44, y - u * 0.14, u * 0.88, u * 0.13);
  if (!back) {
    g.fillStyle = "rgba(255, 255, 255, 0.14)";
    g.fillRect(x - u * 0.3, y - u * 0.5, u * 0.18, u * 0.3);
  }
}

/** Readable text colour on a pill of this colour. */
function inkFor(bg: string) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
  const [r, g, b] = m ? [+m[1], +m[2], +m[3]] : hexRgb(bg);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.62 ? "#0e0c1d" : "#ffffff";
}

function drawTag(g: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, px: number, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  g.font = `800 ${px}px ${SANS}`;
  const w = g.measureText(text).width + px * 0.9;
  const h = px * 1.45;
  // Keep the whole tag on the canvas.
  x = Math.max(w / 2 + 2, Math.min(g.canvas.width - w / 2 - 2, x));
  y = Math.max(h + 2, y);
  g.fillStyle = bg;
  roundRect(g, x - w / 2, y - h, w, h, h / 2);
  g.fill();
  g.beginPath();
  g.moveTo(x - px * 0.3, y - 1);
  g.lineTo(x + px * 0.3, y - 1);
  g.lineTo(x, y + px * 0.35);
  g.fill();
  const ink = inkFor(bg);
  g.fillStyle = ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (ink === "#ffffff") {
    g.strokeStyle = "rgba(0, 0, 0, 0.35)";
    g.lineWidth = Math.max(1, px * 0.18);
    g.strokeText(text, x, y - h / 2 + 1);
  }
  g.fillText(text, x, y - h / 2 + 1);
  g.restore();
}

function drawDart(g: CanvasRenderingContext2D, x: number, y: number, ang: number, u: number, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.rotate(ang);
  const L = u * 2.1;
  g.strokeStyle = "#e9e4d8";
  g.lineWidth = Math.max(1, u * 0.18);
  g.beginPath();
  g.moveTo(-L, 0);
  g.lineTo(0, 0);
  g.stroke();
  g.fillStyle = "#9aa3b2";
  g.beginPath();
  g.moveTo(u * 0.35, 0);
  g.lineTo(-u * 0.1, -u * 0.13);
  g.lineTo(-u * 0.1, u * 0.13);
  g.fill();
  g.fillStyle = DART_RED;
  g.beginPath();
  g.moveTo(-L, 0);
  g.lineTo(-L - u * 0.5, -u * 0.38);
  g.lineTo(-L + u * 0.35, 0);
  g.lineTo(-L - u * 0.5, u * 0.38);
  g.fill();
  g.restore();
}

function drawCrosshair(g: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, locked: boolean, dpr: number) {
  g.save();
  g.translate(x, y);
  g.rotate(locked ? t / 900 : t / 1600);
  g.strokeStyle = DART_RED;
  g.lineWidth = (locked ? 2.5 : 2) * dpr;
  if (!locked) g.setLineDash([4 * dpr, 3 * dpr]);
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.stroke();
  g.setLineDash([]);
  g.lineWidth = 2 * dpr;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
    g.lineTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3);
    g.stroke();
  }
  g.restore();
  if (locked) {
    g.fillStyle = DART_RED;
    g.beginPath();
    g.arc(x, y, 2 * dpr, 0, TAU);
    g.fill();
  }
}

// ---------- drawing ----------

export interface ParkData {
  view: IncView;
  mySlot: number;
  colors: string[];
  names: string[];
  avatars: string[];
  reduced: boolean;
  /** You can move your walker (intro / play, not sniped). */
  steer: boolean;
  /** You can throw a dart right now. */
  armed: boolean;
  /** Your lit landmarks (bit mask, including ones the server just told you about). */
  lit: number;
  accent: string;
}

/** Facing and walking bob for walker `i` (or your own), from where it is drawn. */
function animate(a: Anim, wx: number, wy: number, S: Surface, dt: number) {
  if (!a.init) {
    a.x = wx;
    a.y = wy;
    a.init = true;
    return;
  }
  const dx = wx - a.x;
  const dy = wy - a.y;
  a.x = wx;
  a.y = wy;
  if (dt <= 0) return;
  const d = Math.hypot(dx, dy);
  const k = Math.min(1, dt * 10);
  a.spd += (d / dt - a.spd) * k;
  const [sdx, sdy] = S.portrait ? [-dy, dx] : [dx, dy];
  a.svx += (sdx / dt - a.svx) * k;
  a.svy += (sdy / dt - a.svy) * k;
  if (d > 12) return; // a jump (new frame after a gap): no stride
  a.ph += (d / STRIDE) * Math.PI;
  const sv = Math.hypot(a.svx, a.svy);
  if (sv > 18) {
    if (Math.abs(a.svx) > sv * 0.3) a.face = a.svx > 0 ? 1 : -1;
    if (a.svy < -sv * 0.65) a.back = true;
    else if (a.svy > -sv * 0.2) a.back = false;
  }
}

function newAnim(i: number): Anim {
  return { x: 0, y: 0, ph: 0, face: i % 2 ? 1 : -1, back: false, spd: 0, svx: 0, svy: 0, init: false };
}

interface Drawn {
  i: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  depth: number;
}

function drawScene(g: CanvasRenderingContext2D, sc: Scene, S: Surface, d: ParkData, now: number) {
  const { view } = d;
  const park = PARKS[view.park] ?? PARKS[0];
  const { dpr, W, H } = S;
  const dt = sc.last < 0 ? 0 : Math.min(0.1, (now - sc.last) / 1000);
  sc.last = now;
  const rt = sc.clock.tick(now);
  sc.rt = rt;
  const frames = sc.frames;
  while (frames.length > 2 && frames[1].t < rt - KEEP_MS) frames.shift();
  const u = walkerUnit(S);
  sc.u = u;
  const reduced = d.reduced;

  // Effects ride in the frames and fire when playback reaches them.
  for (const f of frames) {
    if (f.t <= sc.fxCursor || f.t > rt) continue;
    sc.fxCursor = f.t;
    if (!f.f) continue;
    for (const e of f.f) {
      if (Array.isArray(e) && e[0] === FX_PULSE && typeof e[1] === "number") sc.pulses.push({ l: e[1], t0: f.t });
    }
  }

  // ----- where everyone is -----
  const count = view.count;
  if (!sampleAll(frames, rt, sc.pos)) return;
  if (sc.round !== view.round) {
    sc.round = view.round;
    sc.anim = [];
    sc.pulses = [];
    sc.bursts = [];
    sc.darts = [];
  }
  const me = sc.pred;
  const mine = view.you;
  const latest = frames[frames.length - 1];
  const predicting = d.steer && mine >= 0 && latest.n === view.round && latest.xy.length > mine * 2 + 1;
  if (predicting) {
    const sxw = latest.xy[mine * 2];
    const syw = latest.xy[mine * 2 + 1];
    if (!me.ready || me.round !== view.round || me.w !== mine) {
      Object.assign(me, { x: sxw, y: syw, vx: 0, vy: 0, ready: true, round: view.round, w: mine, at: now, stillMs: 0, farMs: 0, lm: -1 });
    }
    const sdt = Math.min(0.1, Math.max(0, (now - me.at) / 1000));
    me.at = now;
    const sp = sc.sprint ? WALK * SPRINT_MUL : WALK;
    const n = Math.max(1, Math.ceil(sdt / 0.01));
    for (let i = 0; i < n; i++) stepBody(me, sc.ix * sp, sc.iy * sp, sdt / n, park);
    // Reconcile with the server's copy of you.
    const prev = frames[frames.length - 2];
    const serverStill = !!prev && prev.n === latest.n && prev.xy[mine * 2] === sxw && prev.xy[mine * 2 + 1] === syw;
    const localStill = sc.ix === 0 && sc.iy === 0 && Math.hypot(me.vx, me.vy) < 1;
    me.stillMs = localStill ? me.stillMs + sdt * 1000 : 0;
    const ex = sxw - me.x;
    const ey = syw - me.y;
    const err = Math.hypot(ex, ey);
    if (err > 160) {
      me.x = sxw;
      me.y = syw;
    } else if (serverStill && me.stillMs > 120 && err > 0.3) {
      const k = 1 - Math.exp(-sdt / 0.12);
      me.x += ex * k;
      me.y += ey * k;
    } else if (err > 36 + Math.hypot(me.vx, me.vy) * 0.5) {
      me.farMs += sdt * 1000;
      if (me.farMs > 300) {
        const k = 1 - Math.exp(-sdt / 0.2);
        me.x += ex * k;
        me.y += ey * k;
      }
    } else me.farMs = 0;
  } else me.ready = false;

  // Snipe records: who's down, who's exposed, which bots shrug.
  const downAt = new Map<number, SnipeRec>();
  const exposed = new Map<number, SnipeRec>();
  const shrugs = new Map<number, SnipeRec>();
  for (const r of view.snipes) {
    if (r.hit >= 0) downAt.set(r.w, r);
    else {
      shrugs.set(r.w, r);
      if (r.sw >= 0) exposed.set(r.sw, r);
    }
  }
  const humans = view.humans;
  const reveal = view.phase === "roundOver" || view.phase === "final";
  const seatOf = new Map<number, number>();
  if (humans) humans.forEach((w, slot) => seatOf.set(w, slot));

  // ----- background -----
  if (!S.bg || S.park !== view.park) {
    S.park = view.park;
    S.bg = renderBackground(S, park);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(S.bg, 0, 0);
  const k = S.s;

  // ----- landmarks: glowing statues -----
  const breathe = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 700);
  const myColor = d.mySlot >= 0 ? (d.colors[d.mySlot] ?? d.accent) : d.accent;
  park.landmarks.forEach((l, li) => {
    const x = toSX(S, l.x, l.y);
    const y = toSY(S, l.x, l.y);
    const mineLit = (d.lit >> li) & 1;
    const R = LM_R * k;
    const glow = g.createRadialGradient(x, y, R * 0.5, x, y, R * (1.7 + breathe * 0.3));
    glow.addColorStop(0, mineLit ? rgba("#ffd34d", 0.7) : "rgba(255, 238, 170, 0.55)");
    glow.addColorStop(1, "rgba(255, 238, 170, 0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(x, y, R * 2, 0, TAU);
    g.fill();
    g.strokeStyle = `rgba(255, 224, 130, ${0.45 + breathe * 0.35})`;
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.arc(x, y, R - 1 * dpr, 0, TAU);
    g.stroke();
    if (mineLit) {
      g.strokeStyle = myColor;
      g.lineWidth = 3 * dpr;
      g.beginPath();
      g.arc(x, y, R + 1.5 * dpr, 0, TAU);
      g.stroke();
    }
    const em = Math.max(14 * dpr, R * 1.15);
    g.font = `${Math.round(em)}px ${EMOJI_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(LANDMARKS[li]?.icon ?? "⭐", x, y - em * 0.28);
    if (mineLit) {
      const bs = Math.max(9 * dpr, R * 0.42);
      g.fillStyle = myColor;
      g.beginPath();
      g.arc(x + R * 0.72, y - R * 0.72, bs * 0.62, 0, TAU);
      g.fill();
      g.strokeStyle = "#0e0c1d";
      g.lineWidth = Math.max(1.5, bs * 0.18);
      g.beginPath();
      g.moveTo(x + R * 0.72 - bs * 0.28, y - R * 0.72);
      g.lineTo(x + R * 0.72 - bs * 0.05, y - R * 0.72 + bs * 0.24);
      g.lineTo(x + R * 0.72 + bs * 0.3, y - R * 0.72 - bs * 0.22);
      g.stroke();
    }
  });

  // Your lighting progress (worked out locally, so it reacts instantly).
  if (predicting && view.phase === "play") {
    const li = landmarkAt(park, me.x, me.y);
    if (li !== me.lm) {
      me.lm = li;
      me.lmAt = now;
    }
    if (li >= 0 && !((d.lit >> li) & 1)) {
      const l = park.landmarks[li];
      const p = clamp01((now - me.lmAt) / LIGHT_MS);
      const x = toSX(S, l.x, l.y);
      const y = toSY(S, l.x, l.y);
      g.lineCap = "round";
      g.strokeStyle = "rgba(14, 12, 29, 0.45)";
      g.lineWidth = 5 * dpr;
      g.beginPath();
      g.arc(x, y, LM_R * k + 4 * dpr, 0, TAU);
      g.stroke();
      g.strokeStyle = p >= 1 ? "#ffffff" : "#ffd34d";
      g.beginPath();
      g.arc(x, y, LM_R * k + 4 * dpr, -Math.PI / 2, -Math.PI / 2 + TAU * p);
      g.stroke();
    }
  } else me.lm = -1;

  // Pulses: everyone sees them, nobody knows who.
  for (let i = sc.pulses.length - 1; i >= 0; i--) {
    const p = sc.pulses[i];
    const age = rt - p.t0;
    if (age > PULSE_MS) {
      sc.pulses.splice(i, 1);
      continue;
    }
    if (age < 0) continue;
    const l = park.landmarks[p.l];
    if (!l) continue;
    const x = toSX(S, l.x, l.y);
    const y = toSY(S, l.x, l.y);
    const q = age / PULSE_MS;
    const R = LM_R * k;
    const flash = g.createRadialGradient(x, y, 0, x, y, R * 2.2);
    flash.addColorStop(0, `rgba(255, 236, 150, ${0.75 * (1 - q)})`);
    flash.addColorStop(1, "rgba(255, 236, 150, 0)");
    g.fillStyle = flash;
    g.beginPath();
    g.arc(x, y, R * 2.2, 0, TAU);
    g.fill();
    for (let ring = 0; ring < (reduced ? 1 : 2); ring++) {
      const qq = clamp01(q * 1.25 - ring * 0.22);
      if (qq <= 0 || qq >= 1) continue;
      g.strokeStyle = `rgba(255, 224, 120, ${0.9 * (1 - qq)})`;
      g.lineWidth = (5 - ring * 2) * dpr * (1 - qq * 0.5);
      g.beginPath();
      g.arc(x, y, R * (1 + easeOut(qq) * 2.4), 0, TAU);
      g.stroke();
    }
  }

  // ----- walkers, back to front -----
  const list: Drawn[] = [];
  for (let i = 0; i < count; i++) {
    let wx = sc.pos[i * 2];
    let wy = sc.pos[i * 2 + 1];
    if (wx === undefined || wy === undefined) continue;
    if (i === mine && predicting) {
      wx = me.x;
      wy = me.y;
    }
    const sx = toSX(S, wx, wy);
    const sy = toSY(S, wx, wy);
    list.push({ i, x: wx, y: wy, sx, sy, depth: sy });
  }
  list.sort((a, b) => a.depth - b.depth);
  sc.sx.length = count;
  sc.sy.length = count;
  sc.sx.fill(NaN);
  sc.sy.fill(NaN);

  const tags: (() => void)[] = [];
  const revealAt = view.phase === "final" ? view.snap.t : view.endsAt - ROUND_OVER_MS;
  const tagPx = Math.round(Math.max(9, Math.min(12, (W / dpr) / 55)) * dpr);
  for (const w of list) {
    const a = (sc.anim[w.i] ??= newAnim(w.i));
    animate(a, w.x, w.y, S, dt);
    sc.sx[w.i] = w.sx;
    sc.sy[w.i] = w.sy;
    const slot = seatOf.get(w.i);
    const down = downAt.get(w.i);
    const exp = exposed.get(w.i);
    let coat = COAT;
    let trim = COAT_DARK;
    let fall = 0;
    let alpha = 1;
    if (down) {
      const color = d.colors[down.hit] ?? "#ffffff";
      const p = (rt - down.at - DART_MS) / FALL_MS;
      if (p > 0) {
        fall = reduced ? 1 : Math.min(1, easeOutBack(clamp01(p)));
        coat = color;
        trim = mix(color, 0, 0.5);
        const name = d.names[down.hit] ?? "?";
        tags.push(() => drawTag(g, w.sx, w.sy - u * 1.3, `💀 ${name}`, rgba(color, 0.92), tagPx, clamp01(p * 2)));
      }
    } else if (reveal && slot !== undefined) {
      const color = d.colors[slot] ?? "#ffffff";
      coat = color;
      trim = mix(color, 0, 0.5);
      // Unmasked one after another.
      const pop = reduced ? 1 : clamp01((rt - revealAt - 300 - slot * 160) / 280);
      if (pop < 1) {
        coat = lerpColor(COAT, color, pop);
      }
      if (pop > 0)
        tags.push(() =>
          drawTag(g, w.sx, w.sy - u * 3.5 + (1 - pop) * 6 * dpr, `${d.avatars[slot] ?? ""} ${d.names[slot] ?? "?"}`, rgba(color, 0.95), tagPx, pop),
        );
    } else if (exp) {
      const p = rt - exp.at - DART_MS;
      if (p >= 0 && p < EXPOSE_MS) {
        const color = d.colors[exp.by] ?? "#ffffff";
        const on = reduced || Math.floor(p / 130) % 2 === 0;
        coat = on ? color : mix(color, 255, 0.45);
        trim = mix(color, 0, 0.45);
        const glowR = u * 3.4;
        const cy = w.sy - u * 1.4;
        const gl = g.createRadialGradient(w.sx, cy, 0, w.sx, cy, glowR);
        gl.addColorStop(0, rgba(color, 0.8));
        gl.addColorStop(1, rgba(color, 0));
        g.fillStyle = gl;
        g.beginPath();
        g.arc(w.sx, cy, glowR, 0, TAU);
        g.fill();
        const name = exp.by === d.mySlot ? "You!" : (d.names[exp.by] ?? "?");
        tags.push(() => drawTag(g, w.sx, w.sy - u * 3.5, `😳 ${name}`, rgba(color, 0.95), tagPx));
      }
    }
    if (reveal && slot === undefined && !down) alpha = 0.45;
    // Out players (and the final reveal) see who's who: a ring in their colour.
    if (humans && !reveal && slot !== undefined && !down) {
      const color = d.colors[slot] ?? "#ffffff";
      g.strokeStyle = color;
      g.lineWidth = 2 * dpr;
      g.beginPath();
      g.ellipse(w.sx, w.sy, u * 1.3, u * 0.55, 0, 0, TAU);
      g.stroke();
      if (slot !== d.mySlot) {
        tags.push(() => drawTag(g, w.sx, w.sy - u * 3.5, d.names[slot] ?? "?", rgba(color, 0.8), Math.round(tagPx * 0.9), 0.9));
      }
    }
    // Your subtle ring.
    if (w.i === mine && !down && d.mySlot >= 0) {
      const intro = view.phase === "intro";
      g.save();
      g.strokeStyle = "rgba(255, 255, 255, 0.35)";
      g.lineWidth = 4 * dpr;
      g.beginPath();
      g.ellipse(w.sx, w.sy, u * 1.35, u * 0.58, 0, 0, TAU);
      g.stroke();
      g.strokeStyle = "#ffffff";
      g.lineWidth = 1.8 * dpr;
      g.setLineDash([4 * dpr, 2.5 * dpr]);
      g.lineDashOffset = reduced ? 0 : -now / 60;
      g.beginPath();
      g.ellipse(w.sx, w.sy, u * 1.35, u * 0.58, 0, 0, TAU);
      g.stroke();
      g.restore();
      if (intro && !reduced) {
        const q = (now % 1200) / 1200;
        g.strokeStyle = `rgba(255, 255, 255, ${0.7 * (1 - q)})`;
        g.lineWidth = 2 * dpr;
        g.beginPath();
        g.ellipse(w.sx, w.sy, u * (1.4 + q * 2.4), u * (0.6 + q * 1.0), 0, 0, TAU);
        g.stroke();
      }
      if (intro) {
        const bob = reduced ? 0 : Math.sin(now / 200) * 2 * dpr;
        tags.push(() => drawTag(g, w.sx, w.sy - u * 3.6 + bob, "YOU", "rgba(14, 12, 29, 0.88)", tagPx));
      }
    }
    if (alpha < 1) g.globalAlpha = alpha;
    drawWalker(g, w.sx, w.sy, u, { face: a.face, back: a.back, ph: a.ph, move: down ? 0 : Math.min(1.3, a.spd / WALK), coat, trim, fall, hatless: fall > 0.5 });
    if (fall > 0.5) {
      // Hat knocked off beside them, and the dart that did it.
      drawHat(g, w.sx - a.face * u * 0.4, w.sy + u * 0.55, u * 0.9, false);
      drawDart(g, w.sx + a.face * u * 1.2, w.sy - u * 0.5, -Math.PI / 2 - a.face * 0.5, u * 0.8);
    }
    g.globalAlpha = 1;
    // A bot that took a dart: it shrugs, and the dart drops at its feet.
    const sh = shrugs.get(w.i);
    if (sh) {
      const p = rt - sh.at - DART_MS;
      if (p >= 0 && p < SHRUG_MS) {
        const q = p / SHRUG_MS;
        drawDart(g, w.sx + u * 0.9, w.sy - u * 0.1, Math.PI * 0.85, u * 0.8, 1 - q * q);
        const pop = reduced ? 1 : Math.min(1, easeOutBack(clamp01(p / 260)));
        tags.push(() => {
          g.save();
          g.globalAlpha = 1 - q * q;
          const bs = Math.round(Math.max(14 * dpr, u * 2.2) * pop);
          g.font = `${bs}px ${EMOJI_FONT}`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          const by = w.sy - u * 3.6 - (reduced ? 0 : q * 8 * dpr);
          g.fillStyle = "rgba(255, 255, 255, 0.92)";
          g.beginPath();
          g.arc(w.sx, by, bs * 0.68, 0, TAU);
          g.fill();
          g.fillStyle = "#000";
          g.fillText("🤷", w.sx, by + bs * 0.06);
          g.restore();
        });
      }
    }
  }
  for (const t of tags) t();

  // ----- darts in flight -----
  const matchedLocal = new Set<LocalDart>();
  for (const r of view.snipes) {
    const target = r.w;
    const tx = sc.sx[target];
    const ty = sc.sy[target];
    if (Number.isNaN(tx)) continue;
    const local = r.by === d.mySlot ? sc.darts.find((x) => x.w === target && !matchedLocal.has(x)) : undefined;
    if (local) {
      matchedLocal.add(local);
      local.matched = true;
      // Your own dart already flew; keep it stuck in the target until the result plays.
      if (now - local.t0 >= DART_MS && rt < r.at + DART_MS) drawDart(g, tx - u * 0.2, ty - u * 1.5, -0.9, u);
      continue;
    }
    const p = (rt - r.at) / DART_MS;
    if (p < 0 || p >= 1) continue;
    flyDart(g, tx, ty - u * 1.4, p, u, S);
  }
  for (let i = sc.darts.length - 1; i >= 0; i--) {
    const dart = sc.darts[i];
    const age = now - dart.t0;
    if (age > 2_500 || (dart.matched && age > DART_MS + 1_500)) {
      sc.darts.splice(i, 1);
      continue;
    }
    if (dart.matched && age >= DART_MS) continue;
    const tx = sc.sx[dart.w];
    const ty = sc.sy[dart.w];
    if (Number.isNaN(tx)) continue;
    if (dart.failed) {
      const q = clamp01((now - dart.failed) / 600);
      drawDart(g, tx + u, ty - u * 0.2 + q * 6 * dpr, Math.PI * 0.8, u, 1 - q);
      if (q >= 1) sc.darts.splice(i, 1);
      continue;
    }
    if (age < DART_MS) flyDart(g, tx, ty - u * 1.4, age / DART_MS, u, S);
    else if (!dart.matched) drawDart(g, tx - u * 0.2, ty - u * 1.5, -0.9, u);
  }

  // ----- your landmark bursts -----
  for (let i = sc.bursts.length - 1; i >= 0; i--) {
    const b = sc.bursts[i];
    const age = now - b.t0;
    if (age > 900) {
      sc.bursts.splice(i, 1);
      continue;
    }
    const l = park.landmarks[b.l];
    if (!l) continue;
    const x = toSX(S, l.x, l.y);
    const y = toSY(S, l.x, l.y);
    const q = age / 900;
    g.strokeStyle = rgba(myColor, 1 - q);
    g.lineWidth = 4 * dpr * (1 - q);
    g.beginPath();
    g.arc(x, y, LM_R * k * (1 + easeOut(q) * 1.6), 0, TAU);
    g.stroke();
  }
  for (let i = sc.sparks.length - 1; i >= 0; i--) {
    const p = sc.sparks[i];
    const age = (now - p.t0) / p.life;
    if (age >= 1) {
      sc.sparks.splice(i, 1);
      continue;
    }
    const tt = (now - p.t0) / 1000;
    const x = p.x + p.vx * tt * dpr;
    const y = p.y + (p.vy * tt + 160 * tt * tt) * dpr;
    g.globalAlpha = 1 - age;
    g.fillStyle = p.color;
    g.beginPath();
    g.arc(x, y, p.size * dpr * (1 - age * 0.5), 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;

  // ----- aiming -----
  const aim = d.armed ? sc.hover : -1;
  if (aim >= 0 && aim !== mine && !downAt.has(aim) && !Number.isNaN(sc.sx[aim])) {
    drawCrosshair(g, sc.sx[aim], sc.sy[aim] - u * 1.4, u * 1.9 + 4 * dpr, now, false, dpr);
  }

  // ----- stick & taps -----
  const st = sc.stick;
  if (st) {
    const R = stickRadius(W / dpr) * dpr;
    const x0 = st.ox * dpr;
    const y0 = st.oy * dpr;
    g.globalAlpha = 0.85;
    g.fillStyle = "rgba(255, 255, 255, 0.14)";
    g.strokeStyle = "rgba(255, 255, 255, 0.55)";
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.arc(x0, y0, R, 0, TAU);
    g.fill();
    g.stroke();
    let kx = (st.kx - st.ox) * dpr;
    let ky = (st.ky - st.oy) * dpr;
    const m = Math.hypot(kx, ky);
    if (m > R) {
      kx = (kx / m) * R;
      ky = (ky / m) * R;
    }
    g.fillStyle = d.accent;
    g.beginPath();
    g.arc(x0 + kx, y0 + ky, R * 0.42, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
  }
  const tapAge = now - sc.tapAt;
  if (tapAge >= 0 && tapAge < 320) {
    g.globalAlpha = 1 - tapAge / 320;
    g.strokeStyle = "#ffffff";
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.arc(sc.tapX * dpr, sc.tapY * dpr, (10 + tapAge / 14) * dpr, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
  }
  // Soft vignette so the edges of the park read as edges.
  if (H > 0) {
    g.strokeStyle = "rgba(0, 0, 0, 0.18)";
    g.lineWidth = 6 * dpr;
    g.strokeRect(0, 0, W, H);
  }
}

function flyDart(g: CanvasRenderingContext2D, tx: number, ty: number, p: number, u: number, S: Surface) {
  // Thrown from the sky, so the throw never points back at the thrower.
  const sx = tx - 90 * S.dpr;
  const sy = ty - 160 * S.dpr;
  const e = easeOut(p);
  const x = sx + (tx - sx) * e;
  const y = sy + (ty - sy) * e - Math.sin(p * Math.PI) * 20 * S.dpr;
  const vx = (tx - sx) * (1 - p) * 2;
  const vy = (ty - sy) * (1 - p) * 2 - Math.cos(p * Math.PI) * 20 * Math.PI * S.dpr;
  drawDart(g, x, y, Math.atan2(vy, vx), u * 1.1);
}

const stickRadius = (cssW: number) => Math.max(30, Math.min(52, cssW * 0.12));

function busy(sc: Scene) {
  return sc.pulses.length > 0 || sc.sparks.length > 0 || sc.bursts.length > 0 || sc.darts.length > 0 || sc.stick !== null;
}

// ---------- component ----------

export interface Controls {
  /** Show SNIPE (fires at the locked target) and SPRINT buttons under the park. */
  show: boolean;
  hint: ReactNode;
}

export function ParkView({
  data,
  onEvent,
  onSteer,
  onFire,
  controls,
  label,
  ringColor,
  children,
}: {
  data: ParkData;
  onEvent: (fn: (e: unknown) => void) => () => void;
  /** Steering changed (world direction as ints in -100..100, plus sprint). */
  onSteer: (x: number, y: number, sprint: boolean) => void;
  /** Throw a dart at walker `w`. */
  onFire: (w: number) => void;
  controls: Controls | null;
  label: string;
  ringColor: string;
  children?: ReactNode;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Scene>(newScene());
  const surface = useRef<Surface | null>(null);
  const [locked, setLocked] = useState({ w: -1, n: 0 });
  const [sprinting, setSprinting] = useState(false);
  const { view } = data;

  const downSet = new Set(view.snipes.filter((r) => r.hit >= 0).map((r) => r.w));
  const lw = locked.n === view.round && data.armed ? locked.w : -1;
  const target = lw >= 0 && lw < view.count && lw !== view.you && !downSet.has(lw) ? lw : -1;

  // ----- frames & events -----
  useEffect(() => {
    if (isSnap(view.snap)) pushFrame(scene.current, view.snap, performance.now());
  }, [view]);

  const onServerEvent = useEffectEvent((e: unknown) => {
    const sc = scene.current;
    if (isSnap(e)) return pushFrame(sc, e, performance.now());
    if (!e || typeof e !== "object") return;
    const ev = e as { k?: unknown; n?: unknown; l?: unknown; m?: unknown; w?: unknown; why?: unknown };
    if (ev.k === "lit" && typeof ev.l === "number" && ev.n === data.view.round) {
      const now = performance.now();
      sc.bursts.push({ l: ev.l, t0: now });
      const S = surface.current;
      const l = (PARKS[data.view.park] ?? PARKS[0]).landmarks[ev.l];
      if (S && l && !data.reduced) {
        const color = data.mySlot >= 0 ? (data.colors[data.mySlot] ?? "#ffd34d") : "#ffd34d";
        for (let i = 0; i < 22; i++) {
          const a = Math.random() * TAU;
          const v = 60 + Math.random() * 120;
          sc.sparks.push({
            x: toSX(S, l.x, l.y),
            y: toSY(S, l.x, l.y),
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v - 90,
            t0: now,
            life: 600 + Math.random() * 500,
            color: i % 3 ? "#ffd34d" : color,
            size: 2 + Math.random() * 2.5,
          });
        }
      }
    } else if (ev.k === "no" && typeof ev.w === "number") {
      const dart = sc.darts.find((x) => x.w === ev.w && !x.failed && !x.matched);
      if (dart) dart.failed = performance.now();
    }
  });
  useEffect(() => onEvent((e) => onServerEvent(e)), [onEvent]);

  // ----- canvas size -----
  useEffect(() => {
    const holder = holderRef.current;
    const canvas = canvasRef.current;
    if (!holder || !canvas) return;
    const fit = () => {
      const r = holder.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
      const W = Math.round(r.width * dpr);
      const H = Math.round(r.height * dpr);
      const cur = surface.current;
      if (cur && cur.W === W && cur.H === H && cur.dpr === dpr) return;
      canvas.width = W;
      canvas.height = H;
      surface.current = layout(W, H, dpr, -1);
      scene.current.stillKey = "";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(holder);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  // ----- the loop -----
  const paint = useEffectEvent((now: number) => {
    const canvas = canvasRef.current;
    const S = surface.current;
    const sc = scene.current;
    if (!canvas || !S || !sc.frames.length) return;
    // Once the final reveal has played out and nothing moves, stop redrawing.
    if (data.view.phase === "final" && !busy(sc) && sc.rt > data.view.snap.t + 3_000) {
      const key = `${S.W}x${S.H}|${data.reduced}|${data.view.snap.t}|${sc.hover}`;
      if (sc.stillKey === key) {
        sc.last = -1;
        return;
      }
      sc.stillKey = key;
    } else sc.stillKey = "";
    const g = canvas.getContext("2d");
    if (!g) return;
    drawScene(g, sc, S, data, now);
    if (target >= 0) {
      const x = sc.sx[target];
      if (!Number.isNaN(x)) drawCrosshair(g, x, sc.sy[target] - sc.u * 1.4, sc.u * 2.1 + 5 * S.dpr, now, true, S.dpr);
    }
  });
  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      paint(t);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        scene.current.clock.at = -1;
        scene.current.last = -1;
        scene.current.pred.at = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // ----- steering -----
  const refreshInput = () => {
    const sc = scene.current;
    let x = 0;
    let y = 0;
    if (sc.stick) {
      const R = stickRadius(holderRef.current?.clientWidth ?? 360);
      const dx = (sc.stick.kx - sc.stick.ox) / R;
      const dy = (sc.stick.ky - sc.stick.oy) / R;
      if (Math.hypot(dx, dy) > 0.3) [x, y] = [dx, dy];
    } else {
      if (sc.keys.has("left")) x -= 1;
      if (sc.keys.has("right")) x += 1;
      if (sc.keys.has("up")) y -= 1;
      if (sc.keys.has("down")) y += 1;
    }
    const [wx, wy] = toWorldDir(surface.current, x, y);
    const m = Math.hypot(wx, wy);
    const ix = m > 0 ? Math.round((wx / m) * 100) : 0;
    const iy = m > 0 ? Math.round((wy / m) * 100) : 0;
    const sprint = (sc.sprintKey || sc.sprintBtn) && m > 0;
    // Predict with exactly what the server will apply.
    [sc.ix, sc.iy] = data.steer ? inputDir(ix, iy) : [0, 0];
    sc.sprint = sprint && data.steer;
    const key = `${ix},${iy},${sprint ? 1 : 0}`;
    if (key === sc.sent) return;
    sc.sent = key;
    onSteer(ix, iy, sprint);
  };

  const fire = (w: number) => {
    const sc = scene.current;
    if (!data.armed || w < 0 || w === data.view.you) return;
    const x = sc.pos[w * 2] ?? 0;
    const y = sc.pos[w * 2 + 1] ?? 0;
    sc.darts.push({ w, t0: performance.now(), x, y, failed: 0, matched: false });
    sc.hover = -1;
    setLocked({ w: -1, n: 0 });
    onFire(w);
  };

  const onKey = useEffectEvent((e: KeyboardEvent, down: boolean) => {
    const sc = scene.current;
    const dir = KEY_DIR[e.code] ?? KEY_DIR[e.key];
    if (!down) {
      if (dir && sc.keys.delete(dir)) refreshInput();
      if (e.key === "Shift" && sc.sprintKey) {
        sc.sprintKey = false;
        refreshInput();
      }
      return;
    }
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (dir) {
      if (!data.steer) return;
      e.preventDefault();
      if (!sc.keys.has(dir)) {
        sc.keys.add(dir);
        refreshInput();
      }
    } else if (e.key === "Shift") {
      if (!sc.sprintKey) {
        sc.sprintKey = true;
        refreshInput();
      }
    } else if ((e.code === "Space" || e.key === " " || e.key === "Enter") && !isButton(e.target) && data.armed) {
      const w = target >= 0 ? target : sc.hover;
      if (w >= 0) {
        e.preventDefault();
        if (!e.repeat) fire(w);
      }
    }
  });
  const onLetGo = useEffectEvent(() => {
    const sc = scene.current;
    sc.keys.clear();
    sc.stick = null;
    sc.sprintKey = false;
    sc.sprintBtn = false;
    setSprinting(false);
    refreshInput();
  });
  useEffect(() => {
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => onLetGo();
    const vis = () => {
      if (document.hidden) onLetGo();
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
  // Losing the ability to steer (sniped, round over) drops whatever was held.
  const onSteerChange = useEffectEvent(() => refreshInput());
  useEffect(() => onSteerChange(), [data.steer]);

  // ----- pointer: drag = stick, click / tap = aim -----
  const pick = (cx: number, cy: number, touch: boolean): number => {
    const sc = scene.current;
    const S = surface.current;
    if (!S) return -1;
    const px = cx * S.dpr;
    const py = cy * S.dpr;
    const reach = Math.max(sc.u * 2.2, (touch ? 24 : 16) * S.dpr);
    let best = -1;
    let bestD = reach;
    for (let i = 0; i < sc.sx.length; i++) {
      if (i === data.view.you || downSet.has(i)) continue;
      const x = sc.sx[i];
      if (Number.isNaN(x)) continue;
      const dd = Math.hypot(px - x, py - (sc.sy[i] - sc.u * 1.4));
      if (dd < bestD) [best, bestD] = [i, dd];
    }
    return best;
  };
  const local = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const sc = scene.current;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (sc.press) return;
    const [x, y] = local(e);
    sc.press = { id: e.pointerId, x, y, t0: performance.now(), mouse: e.pointerType === "mouse", moved: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; dragging still works.
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const sc = scene.current;
    const [x, y] = local(e);
    if (e.pointerType === "mouse") sc.hover = data.armed ? pick(x, y, false) : -1;
    const p = sc.press;
    if (!p || p.id !== e.pointerId) return;
    if (!p.moved && Math.hypot(x - p.x, y - p.y) > (p.mouse ? 6 : 10) && data.steer) {
      p.moved = true;
      sc.stick = { id: p.id, ox: p.x, oy: p.y, kx: x, ky: y };
      sc.hover = -1;
    }
    if (sc.stick && sc.stick.id === e.pointerId) {
      sc.stick.kx = x;
      sc.stick.ky = y;
      refreshInput();
    }
  };
  const release = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const sc = scene.current;
    const p = sc.press;
    if (!p || p.id !== e.pointerId) return;
    sc.press = null;
    if (sc.stick) {
      sc.stick = null;
      refreshInput();
      return;
    }
    if (cancelled || p.moved) return;
    const [x, y] = local(e);
    sc.tapAt = performance.now();
    sc.tapX = x;
    sc.tapY = y;
    if (!data.armed) return;
    const w = pick(x, y, !p.mouse);
    if (p.mouse) {
      // Mouse: the hover crosshair already showed who; a click throws.
      if (w >= 0) fire(w);
    } else if (w >= 0 && w === target) fire(w);
    else setLocked({ w, n: data.view.round });
  };

  const sprintDown = (on: boolean) => {
    const sc = scene.current;
    if (sc.sprintBtn === on) return;
    sc.sprintBtn = on;
    setSprinting(on);
    refreshInput();
  };

  return (
    <>
      <div
        ref={holderRef}
        className="inc-stage relative mx-auto w-full overflow-hidden rounded-2xl ring-2 transition-[box-shadow] duration-300 select-none"
        style={{
          touchAction: data.steer || data.armed ? "none" : "auto",
          cursor: data.armed ? "crosshair" : undefined,
          ["--tw-ring-color" as string]: ringColor,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => release(e, false)}
        onPointerCancel={(e) => release(e, true)}
        onLostPointerCapture={(e) => release(e, true)}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") scene.current.hover = -1;
        }}
      >
        <canvas ref={canvasRef} role="img" aria-label={label} className="absolute inset-0 h-full w-full" />
        {children}
      </div>
      {controls?.show && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn h-12 min-w-28 shrink-0 rounded-2xl px-4 text-base font-black tracking-wide shadow-lg shadow-black/30 select-none active:scale-95 pointer-fine:hidden"
            style={{ borderColor: target >= 0 && data.armed ? DART_RED : undefined, color: target >= 0 && data.armed ? DART_RED : undefined }}
            disabled={!data.armed || target < 0}
            onClick={() => fire(target)}
            aria-keyshortcuts="Space"
          >
            <span aria-hidden>🎯</span> {target >= 0 ? "THROW" : "SNIPE"}
          </button>
          <button
            type="button"
            aria-pressed={sprinting}
            aria-keyshortcuts="Shift"
            disabled={!data.steer}
            className={`btn h-12 min-w-28 shrink-0 touch-none rounded-2xl px-4 text-base font-black tracking-wide shadow-lg shadow-black/30 select-none ${sprinting ? "scale-95 border-orange-300 text-orange-200" : ""}`}
            onPointerDown={(e) => {
              e.preventDefault();
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* synthetic pointer */
              }
              sprintDown(true);
            }}
            onPointerUp={() => sprintDown(false)}
            onPointerCancel={() => sprintDown(false)}
            onLostPointerCapture={() => sprintDown(false)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") sprintDown(true);
            }}
            onKeyUp={() => sprintDown(false)}
          >
            <span aria-hidden>💨</span> SPRINT
          </button>
          <p className="min-w-0 flex-1 basis-40 text-xs text-muted">{controls.hint}</p>
        </div>
      )}
    </>
  );
}

const KEY_DIR: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

function isTyping(t: EventTarget | null) {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")
  );
}

function isButton(t: EventTarget | null) {
  return (
    t instanceof HTMLElement && (t.tagName === "BUTTON" || t.tagName === "A" || t.getAttribute("role") === "button")
  );
}
