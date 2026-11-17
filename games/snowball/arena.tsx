"use client";

// Canvas renderer, playback buffer, prediction and controls for Snowball Showdown.
//
// Everyone else: the server sends every player's position 20 times a second. The renderer keeps
// a short buffer and draws them ~100 ms in the past, blending the two frames around that moment.
// Snowballs are not streamed: each frame lists the snowballs thrown since the last one (start,
// landing spot, start time) and where earlier ones stopped, and a flight is a pure function of
// that (shared.ts), so every client draws the arcs itself on the same delayed clock.
//
// You: your own kid runs the same walking model locally (shared.ts) from your keys or stick, so
// steering is instant; drift from the server's copy is eased out. Your own throw flies the moment
// you let go (a predicted snowball on your local clock); when the server's frame lists it, the
// predicted ball adopts the server's verdict on where it stops, and a refused throw puffs away.

import { useEffect, useEffectEvent, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { SnowAction, SnowView } from "./server";
import {
  AMMO,
  AMMO_PILE,
  BALL_R,
  BIG_R,
  END_FORT,
  END_GROUND,
  END_PLAYER,
  END_TREE,
  FIELDS,
  FORT_HP,
  FX_FORT,
  FX_OUT,
  FX_PICK,
  FX_PILE,
  MAX_RANGE,
  MIN_RANGE,
  PILE_R,
  PLAYER_R,
  POWER_INFO,
  POWER_KINDS,
  THROW_CD_MS,
  TICK_MS,
  WORLD_H,
  WORLD_W,
  aimPoint,
  decodePositions,
  flightAt,
  fortShape,
  inputDir,
  isSnap,
  makeFlight,
  readStatus,
  spreadPoint,
  stepBody,
  type Field,
  type Flight,
  type Snap,
} from "./shared";
import { Timeline, Trail, debugFrame, reconcile } from "../snakes/netsmooth";
import { drawAvatar } from "@/lib/avatar-art";
import { feedback, sfx } from "@/lib/feedback";

const TAU = Math.PI * 2;
/** Playback sits this far behind the newest frame the network could have delivered. */
const DELAY_MS = 100;
const EXTRAP_MS = 150;
/** You vs the server's copy: path errors under `tol` are rounding, over `snap` a teleport. */
const RECONCILE = { tol: 6, snap: 180, tauMs: 150 };
const KEEP_MS = 600;
const MAX_FRAMES = 60;
const FLOP_MS = 700;
const SPLAT_MS = 2_600;
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const SANS = "ui-sans-serif, system-ui, sans-serif";
/** Inputs go out on change, at most this often (ms). */
const SEND_GAP = 50;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

// ---------- frames & clock ----------

interface Frame {
  n: number;
  t: number;
  xy: number[];
  st: string;
  w: string;
  c: string;
  u: [number, number, number] | null;
  f: number[][] | null;
}

/**
 * Maps server time onto performance.now(), smoothly (see snakes/netsmooth.ts): playback follows
 * the quickest recent delivery, runs behind it by an adaptive delay that covers the measured
 * jitter (rising promptly, falling only after a calm spell), and slews by a few percent at most.
 */
class Clock extends Timeline {
  constructor() {
    super({ period: TICK_MS, start: DELAY_MS, min: TICK_MS + 15, max: 650 });
  }

  /**
   * Playback time for this animation frame: at most a tick's worth of extrapolation past the newest
   * frame in hand; if the buffer runs drier than that, playback waits (up to 200 ms) instead of
   * extrapolating further and snapping back, then carries on smoothly.
   */
  play(now: number, frames: { t: number }[]) {
    return this.tick(now, frames.length ? frames[frames.length - 1].t : Infinity, TICK_MS, 200);
  }
}

// ---------- scene ----------

/** A snowball the server told us about, drawn on the playback clock. */
interface RemoteBall {
  id: number;
  slot: number;
  f: Flight;
  big: boolean;
  /** Drawn by a predicted local ball instead. */
  local: boolean;
  end: { t: number; what: number; which: number } | null;
  done: boolean;
}

/** Your own throw, drawn on your local clock from the moment you let go. */
interface LocalThrow {
  seq: number;
  t0: number;
  flights: Flight[];
  big: boolean;
  /** Server ids, once its frame lists the throw. */
  ids: number[];
  /** Per flight: fraction of the flight where the server says it stops (1 = lands). */
  stop: number[];
  what: number[];
  which: number[];
  done: boolean[];
  refused: number;
  confirmed: boolean;
}

interface Kid {
  /** Facing on screen (for the throwing arm), last throw and hit (performance.now). */
  ax: number;
  ay: number;
  throwAt: number;
  hitAt: number;
  hitX: number;
  hitY: number;
  outAt: number;
  wasOut: boolean;
  /** Walking bob. */
  ph: number;
  lx: number;
  ly: number;
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
  grav: number;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  t0: number;
  big: boolean;
}

interface Splat {
  wx: number;
  wy: number;
  r: number;
  t0: number;
  seed: number;
}

interface Stick {
  id: number;
  ox: number;
  oy: number;
  kx: number;
  ky: number;
  moved: boolean;
}

interface Pred {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ready: boolean;
  round: number;
  at: number;
  stillMs: number;
  farMs: number;
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
  field: number;
  bg: HTMLCanvasElement | null;
}

interface Scene {
  clock: Clock;
  frames: Frame[];
  fxCursor: number;
  rt: number;
  round: number;
  pos: number[];
  balls: Map<number, RemoteBall>;
  throws: LocalThrow[];
  kids: Kid[];
  pred: Pred;
  /** Where you've walked (for reconciling with the server's old copy of you). */
  trail: Trail;
  err: { x: number; y: number };
  parts: Particle[];
  pops: Popup[];
  splats: Splat[];
  keys: Set<string>;
  move: Stick | null;
  aim: Stick | null;
  /** Mouse over the field (CSS px) and when it last moved. */
  mouseX: number;
  mouseY: number;
  mouseAt: number;
  ix: number;
  iy: number;
  sent: string;
  sentAt: number;
  sendTimer: ReturnType<typeof setTimeout> | null;
  seq: number;
  lastThrow: number;
  emptyAt: number;
  last: number;
  shakeAt: number;
  stillKey: string;
  hud: string;
}

function newScene(): Scene {
  return {
    clock: new Clock(),
    frames: [],
    fxCursor: Infinity,
    rt: 0,
    round: -1,
    pos: [],
    balls: new Map(),
    throws: [],
    kids: [],
    pred: { x: 0, y: 0, vx: 0, vy: 0, ready: false, round: -1, at: -1, stillMs: 0, farMs: 0 },
    trail: new Trail(3_000),
    err: { x: 0, y: 0 },
    parts: [],
    pops: [],
    splats: [],
    keys: new Set(),
    move: null,
    aim: null,
    mouseX: -1,
    mouseY: -1,
    mouseAt: -1e9,
    ix: 0,
    iy: 0,
    sent: "0,0",
    sentAt: -1e9,
    sendTimer: null,
    seq: 0,
    lastThrow: -1e9,
    emptyAt: -1e9,
    last: -1,
    shakeAt: -1e9,
    stillKey: "",
    hud: "",
  };
}

function newKid(): Kid {
  return { ax: 0, ay: 1, throwAt: -1e9, hitAt: -1e9, hitX: 0, hitY: 0, outAt: -1e9, wasOut: false, ph: 0, lx: NaN, ly: NaN };
}

/** A frame arrived: buffer it and pick up the snowballs it lists. */
function pushFrame(sc: Scene, snap: Snap, now: number, mySlot: number) {
  const f: Frame = {
    n: snap.n,
    t: snap.t,
    xy: decodePositions(snap.p),
    st: snap.s,
    w: snap.w,
    c: typeof snap.c === "string" ? snap.c : "",
    u: Array.isArray(snap.u) ? snap.u : null,
    f: Array.isArray(snap.f) ? snap.f : null,
  };
  const frames = sc.frames;
  let last: Frame | undefined = frames[frames.length - 1];
  if (!last) sc.fxCursor = f.t;
  else if (f.n !== last.n) {
    if (f.n < last.n) return; // a stale frame from an older round
    frames.length = 0;
    sc.fxCursor = f.t - 1;
    sc.balls.clear();
    sc.throws = [];
    last = undefined;
  }
  if (!last || f.t > last.t) {
    sc.clock.observe(f.t, now);
    // The server skipped identical frames: everyone stood still until one tick before this.
    if (last && snap.q === 1 && f.t - last.t > TICK_MS * 1.5) frames.push({ ...last, t: f.t - TICK_MS, f: null, u: last.u });
    frames.push(f);
  } else if (!frames.some((x) => x.t === f.t)) {
    const i = frames.findIndex((x) => x.t > f.t);
    frames.splice(i, 0, f);
  } else return;
  if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);

  // New snowballs.
  if (Array.isArray(snap.b)) {
    for (const b of snap.b) {
      if (!Array.isArray(b) || b.length < 9 || sc.balls.has(b[0])) continue;
      const [id, slot, x0, y0, tx, ty, rel, big, seq] = b;
      const rb: RemoteBall = {
        id,
        slot,
        f: makeFlight(x0, y0, tx, ty, snap.t + rel),
        big: big === 1,
        local: false,
        end: null,
        done: false,
      };
      if (slot === mySlot && seq > 0) {
        const lt = sc.throws.find((x) => x.seq === seq);
        if (lt && lt.ids.length < lt.flights.length) {
          lt.ids.push(id);
          lt.confirmed = true;
          rb.local = true;
        }
      }
      sc.balls.set(id, rb);
    }
  }
  // Where snowballs stopped.
  if (Array.isArray(snap.e)) {
    for (const e of snap.e) {
      if (!Array.isArray(e) || e.length < 4) continue;
      const rb = sc.balls.get(e[0]);
      if (!rb || rb.end) continue;
      rb.end = { t: snap.t + e[1], what: e[2], which: e[3] };
      if (rb.local) {
        for (const lt of sc.throws) {
          const k = lt.ids.indexOf(rb.id);
          if (k < 0) continue;
          lt.stop[k] = clamp01((rb.end.t - rb.f.t0) / rb.f.T);
          lt.what[k] = e[2];
          lt.which[k] = e[3];
        }
      }
    }
  }
}

/** Every player's world position at server time `rt` into `out`; also returns the frame used. */
function sampleAll(frames: Frame[], rt: number, out: number[]): Frame | null {
  const n = frames.length;
  if (!n) return null;
  let i = n - 1;
  while (i > 0 && frames[i].t > rt) i--;
  const a = frames[i];
  const len = a.xy.length;
  out.length = len;
  if (a.t >= rt) {
    for (let j = 0; j < len; j++) out[j] = a.xy[j];
    return a;
  }
  const b = frames[i + 1];
  if (!b) {
    // Late frame: keep walking along for a moment.
    const p = frames[i - 1];
    const gap = p ? a.t - p.t : 0;
    if (!p || gap > TICK_MS * 2.5 || p.xy.length !== len) {
      for (let j = 0; j < len; j++) out[j] = a.xy[j];
      return a;
    }
    const e = Math.min(rt - a.t, EXTRAP_MS) / gap;
    for (let j = 0; j < len; j++) out[j] = a.xy[j] + (a.xy[j] - p.xy[j]) * e;
    return a;
  }
  const k = (rt - a.t) / (b.t - a.t);
  for (let j = 0; j < len; j++) out[j] = a.xy[j] + ((b.xy[j] ?? a.xy[j]) - a.xy[j]) * k;
  return a;
}

const fortHp = (w: string) => Array.from(w, (c) => Number(c) || 0);

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
function rgba(hex: string, a: number) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ---------- geometry ----------

function layout(W: number, H: number, dpr: number): Surface {
  const portrait = H > W * 1.05;
  const ww = portrait ? WORLD_H : WORLD_W;
  const wh = portrait ? WORLD_W : WORLD_H;
  const s = Math.min(W / ww, H / wh);
  return { W, H, dpr, portrait, s, ox: (W - ww * s) / 2, oy: (H - wh * s) / 2, field: -1, bg: null };
}
const toSX = (S: Surface, wx: number, wy: number) => (S.portrait ? S.ox + (WORLD_H - wy) * S.s : S.ox + wx * S.s);
const toSY = (S: Surface, wx: number, wy: number) => (S.portrait ? S.oy + wx * S.s : S.oy + wy * S.s);
/** Canvas px -> world. */
const toWX = (S: Surface, px: number, py: number) => (S.portrait ? (py - S.oy) / S.s : (px - S.ox) / S.s);
const toWY = (S: Surface, px: number, py: number) => (S.portrait ? WORLD_H - (px - S.ox) / S.s : (py - S.oy) / S.s);
/** Screen direction -> world direction. */
const toWorldDir = (S: Surface | null, dx: number, dy: number): [number, number] => (S?.portrait ? [dy, -dx] : [dx, dy]);
/** Body radius on screen (device px): never tiny on a phone. */
const kidUnit = (S: Surface) => Math.max(10 * S.dpr, PLAYER_R * S.s * 1.3);

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function capsule(g: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, r: number) {
  const ang = Math.atan2(by - ay, bx - ax);
  g.beginPath();
  g.arc(bx, by, r, ang - Math.PI / 2, ang + Math.PI / 2);
  g.arc(ax, ay, r, ang + Math.PI / 2, ang + (Math.PI * 3) / 2);
  g.closePath();
}

// ---------- the field (cached per size and field) ----------

function renderBackground(S: Surface, field: Field, seed: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = S.W;
  c.height = S.H;
  const g = c.getContext("2d")!;
  const { W, H, dpr } = S;
  const rnd = seeded(seed * 7919 + 17);
  // Snow.
  const sky = g.createLinearGradient(0, 0, W * 0.3, H);
  sky.addColorStop(0, "#f4f9ff");
  sky.addColorStop(1, "#dce9f6");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // Drifts: soft light and shadowed blobs.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = (40 + rnd() * 110) * S.s;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const light = rnd() < 0.55;
    grd.addColorStop(0, light ? "rgba(255,255,255,0.75)" : "rgba(170,196,226,0.28)");
    grd.addColorStop(1, light ? "rgba(255,255,255,0)" : "rgba(170,196,226,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.6, rnd() * Math.PI, 0, TAU);
    g.fill();
  }
  // Sled tracks.
  g.strokeStyle = "rgba(150,180,215,0.25)";
  g.lineWidth = 2.2 * dpr;
  for (let i = 0; i < 3; i++) {
    const y0 = rnd() * H;
    const y1 = rnd() * H;
    for (const off of [-4, 4]) {
      g.beginPath();
      g.moveTo(-10, y0 + off * dpr);
      g.bezierCurveTo(W * 0.35, y0 + (rnd() - 0.5) * H * 0.5, W * 0.65, y1 + (rnd() - 0.5) * H * 0.5, W + 10, y1 + off * dpr);
      g.stroke();
    }
  }
  // Glints.
  for (let i = 0; i < 140; i++) {
    g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.95)" : "rgba(160,200,240,0.55)";
    g.beginPath();
    g.arc(rnd() * W, rnd() * H, (0.6 + rnd() * 1.1) * dpr, 0, TAU);
    g.fill();
  }
  // Trees: top-down pines with snowy tips and a shadow.
  for (const t of field.trees) {
    const x = toSX(S, t.x, t.y);
    const y = toSY(S, t.x, t.y);
    const r = t.r * S.s * 1.15;
    g.fillStyle = "rgba(40,70,110,0.22)";
    g.beginPath();
    g.ellipse(x + r * 0.35, y + r * 0.45, r * 1.05, r * 0.8, 0.4, 0, TAU);
    g.fill();
    const layers: [number, string][] = [
      [1, "#2c5e46"],
      [0.74, "#3a7a58"],
      [0.48, "#4d9a6d"],
    ];
    layers.forEach(([k, col], li) => {
      const pts = 9;
      g.fillStyle = col;
      g.beginPath();
      for (let i = 0; i <= pts * 2; i++) {
        const a = (i / (pts * 2)) * TAU + li * 0.35;
        const rr = (i % 2 ? 0.62 : 1) * r * k;
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      // Snow on the tips.
      g.fillStyle = "rgba(255,255,255,0.85)";
      for (let i = 0; i < pts; i += 2) {
        const a = (i / pts) * TAU + li * 0.35;
        g.beginPath();
        g.arc(x + Math.cos(a) * r * k * 0.86, y + Math.sin(a) * r * k * 0.86, Math.max(1.2 * dpr, r * 0.09), 0, TAU);
        g.fill();
      }
    });
    g.fillStyle = "#f8fbff";
    g.beginPath();
    g.arc(x, y, Math.max(1.5 * dpr, r * 0.16), 0, TAU);
    g.fill();
  }
  // A soft frame so the edge of the field reads as an edge.
  const edge = g.createLinearGradient(0, 0, 0, H);
  edge.addColorStop(0, "rgba(90,120,160,0.18)");
  edge.addColorStop(0.08, "rgba(90,120,160,0)");
  edge.addColorStop(0.92, "rgba(90,120,160,0)");
  edge.addColorStop(1, "rgba(90,120,160,0.2)");
  g.fillStyle = edge;
  g.fillRect(0, 0, W, H);
  return c;
}

function drawFort(g: CanvasRenderingContext2D, S: Surface, field: Field, i: number, hp: number, now: number, hitAt: number) {
  const def = field.forts[i];
  const dpr = S.dpr;
  if (hp <= 0) {
    // Rubble.
    const cx = (def.x1 + def.x2) / 2;
    const cy = (def.y1 + def.y2) / 2;
    const rnd = seeded(i * 31 + 7);
    for (let k = 0; k < 6; k++) {
      const wx = cx + (rnd() - 0.5) * (Math.abs(def.x2 - def.x1) + def.th * 1.6);
      const wy = cy + (rnd() - 0.5) * (Math.abs(def.y2 - def.y1) + def.th * 1.6);
      const r = (5 + rnd() * 6) * S.s;
      g.fillStyle = "rgba(120,150,190,0.25)";
      g.beginPath();
      g.ellipse(toSX(S, wx, wy) + r * 0.3, toSY(S, wx, wy) + r * 0.4, r, r * 0.7, 0, 0, TAU);
      g.fill();
      g.fillStyle = "#f2f7fd";
      g.beginPath();
      g.ellipse(toSX(S, wx, wy), toSY(S, wx, wy), r, r * 0.7, 0, 0, TAU);
      g.fill();
    }
    return;
  }
  const sh = fortShape(def, hp)!;
  const ax = toSX(S, sh.ax, sh.ay);
  const ay = toSY(S, sh.ax, sh.ay);
  const bx = toSX(S, sh.bx, sh.by);
  const by = toSY(S, sh.bx, sh.by);
  const r = sh.th * S.s;
  const age = now - hitAt;
  const wob = age < 220 ? Math.sin(age / 18) * (1 - age / 220) * 2 * dpr : 0;
  // Shadow.
  g.fillStyle = "rgba(60,90,135,0.28)";
  capsule(g, ax + r * 0.28, ay + r * 0.42, bx + r * 0.28, by + r * 0.42, r);
  g.fill();
  // Body.
  const grd = g.createLinearGradient(0, Math.min(ay, by) - r, 0, Math.max(ay, by) + r);
  grd.addColorStop(0, "#ffffff");
  grd.addColorStop(1, "#cfe0f2");
  g.fillStyle = grd;
  capsule(g, ax + wob, ay, bx + wob, by, r);
  g.fill();
  g.strokeStyle = "#9db8d6";
  g.lineWidth = Math.max(1, 1.4 * dpr);
  g.stroke();
  // Packed-snow blocks along the wall.
  const len = Math.hypot(bx - ax, by - ay);
  g.save();
  capsule(g, ax + wob, ay, bx + wob, by, r);
  g.clip();
  g.strokeStyle = "rgba(140,170,205,0.55)";
  g.lineWidth = Math.max(1, dpr);
  if (len > 2) {
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const step = Math.max(8 * dpr, 16 * S.s);
    for (let d = -r; d <= len + r; d += step) {
      const px = ax + ux * d + wob;
      const py = ay + uy * d;
      g.beginPath();
      g.moveTo(px - uy * r, py + ux * r);
      g.lineTo(px + uy * r, py - ux * r);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(ax + wob, ay);
    g.lineTo(bx + wob, by);
    g.stroke();
  } else {
    // An igloo: rows of blocks with staggered joints, and a doorway.
    const rows = 4;
    for (let j = 1; j < rows; j++) {
      const yy = ay - r + (2 * r * j) / rows;
      g.beginPath();
      g.moveTo(ax - r + wob, yy);
      g.lineTo(ax + r + wob, yy);
      g.stroke();
    }
    for (let j = 0; j < rows; j++) {
      const y0 = ay - r + (2 * r * j) / rows;
      for (let q = -2; q <= 2; q++) {
        const xx = ax + wob + (q + (j % 2) * 0.5) * r * 0.5;
        g.beginPath();
        g.moveTo(xx, y0);
        g.lineTo(xx, y0 + (2 * r) / rows);
        g.stroke();
      }
    }
    g.fillStyle = "rgba(40,60,100,0.75)";
    g.beginPath();
    g.ellipse(ax + wob, ay + r * 0.82, r * 0.3, r * 0.26, 0, Math.PI, 0);
    g.fill();
  }
  // Cracks for every hit taken.
  const rnd = seeded(i * 97 + 3);
  g.strokeStyle = "rgba(80,110,160,0.7)";
  g.lineWidth = Math.max(1, 1.3 * dpr);
  for (let k = 0; k < FORT_HP - hp; k++) {
    const d = rnd() * Math.max(1, len);
    const ux = len > 2 ? (bx - ax) / len : 1;
    const uy = len > 2 ? (by - ay) / len : 0;
    let px = ax + ux * d + (rnd() - 0.5) * r + wob;
    let py = ay + uy * d + (rnd() - 0.5) * r;
    g.beginPath();
    g.moveTo(px, py);
    for (let j = 0; j < 3; j++) {
      px += (rnd() - 0.5) * r * 0.9;
      py += (rnd() - 0.5) * r * 0.9;
      g.lineTo(px, py);
    }
    g.stroke();
  }
  g.restore();
  // Highlight on top.
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineWidth = Math.max(1, r * 0.22);
  g.lineCap = "round";
  g.beginPath();
  if (len > 2) {
    g.moveTo(ax + wob, ay - r * 0.45);
    g.lineTo(bx + wob, by - r * 0.45);
  } else g.arc(ax + wob, ay, r * 0.55, Math.PI * 1.1, Math.PI * 1.7);
  g.stroke();
  g.lineCap = "butt";
}

function drawKid(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  u: number,
  color: string,
  avatar: string,
  k: Kid,
  out: boolean,
  now: number,
  reduced: boolean,
) {
  const flop = out ? clamp01((now - k.outAt) / FLOP_MS) : 0;
  // Shadow.
  g.fillStyle = "rgba(40,70,110,0.28)";
  g.beginPath();
  g.ellipse(x + u * 0.15, y + u * 0.75, u * (out ? 1.35 : 1.0), u * 0.42, 0, 0, TAU);
  g.fill();
  if (out) {
    // Blinks, then flops into the snow: a snow angel and a dizzy face.
    const blink = flop < 0.55 && !reduced && Math.floor(flop * 12) % 2 === 1;
    if (blink) return;
    const lie = easeOut(clamp01((flop - 0.45) / 0.55));
    g.save();
    g.translate(x, y);
    g.rotate(lie * 1.35);
    g.globalAlpha = 1 - lie * 0.25;
    if (lie > 0.5) {
      g.fillStyle = "rgba(255,255,255,0.85)";
      g.beginPath();
      g.ellipse(0, 0, u * 1.7, u * 1.15, 0, 0, TAU);
      g.fill();
    }
    g.fillStyle = mix(color, 255, 0.35);
    g.beginPath();
    g.ellipse(0, 0, u * (1 + lie * 0.15), u * (1 - lie * 0.25), 0, 0, TAU);
    g.fill();
    g.restore();
    g.globalAlpha = 0.9;
    g.font = `${Math.round(u * 1.2)}px ${EMOJI_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    drawAvatar(g, lie > 0.5 ? "😵" : avatar, x, y - u * (0.9 - lie * 0.6));
    if (lie > 0.5) {
      // Dizzy stars circling.
      g.font = `${Math.round(u * 0.6)}px ${EMOJI_FONT}`;
      for (let i = 0; i < 3; i++) {
        const a = (reduced ? 0 : now / 500) + (i * TAU) / 3;
        g.fillText("⭐", x + Math.cos(a) * u * 0.9, y - u * 0.9 + Math.sin(a) * u * 0.35);
      }
    }
    g.globalAlpha = 1;
    return;
  }
  // Body: a puffy coat in the player's colour.
  const bob = reduced ? 0 : Math.sin(k.ph) * u * 0.06;
  const grd = g.createRadialGradient(x - u * 0.35, y - u * 0.45 + bob, u * 0.1, x, y + bob, u * 1.1);
  grd.addColorStop(0, mix(color, 255, 0.35));
  grd.addColorStop(1, color);
  g.fillStyle = grd;
  g.beginPath();
  g.arc(x, y + bob, u, 0, TAU);
  g.fill();
  g.strokeStyle = mix(color, 0, 0.45);
  g.lineWidth = Math.max(1, u * 0.12);
  g.stroke();
  // Scarf.
  g.strokeStyle = "rgba(255,255,255,0.92)";
  g.lineWidth = u * 0.22;
  g.beginPath();
  g.arc(x, y + bob - u * 0.15, u * 0.62, Math.PI * 0.15, Math.PI * 0.85);
  g.stroke();
  // Throwing arm with a snowball.
  const ta = now - k.throwAt;
  const swing = ta >= 0 && ta < 260 ? Math.sin((ta / 260) * Math.PI) : 0;
  const hx = x + k.ax * u * (0.85 + swing * 0.7);
  const hy = y + bob + k.ay * u * (0.85 + swing * 0.7);
  g.fillStyle = mix(color, 0, 0.25);
  g.beginPath();
  g.arc(hx, hy, u * 0.3, 0, TAU);
  g.fill();
  // Head.
  g.font = `${Math.round(u * 1.35)}px ${EMOJI_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  drawAvatar(g, avatar, x, y - u * 0.75 + bob);
  // Hit flash.
  const ha = now - k.hitAt;
  if (ha >= 0 && ha < 320) {
    g.fillStyle = `rgba(255,255,255,${0.85 * (1 - ha / 320)})`;
    g.beginPath();
    g.arc(x, y + bob - u * 0.3, u * 1.25, 0, TAU);
    g.fill();
  }
}

function drawBall(g: CanvasRenderingContext2D, S: Surface, f: Flight, t: number, big: boolean, color: string | null) {
  const at = flightAt(f, t, { x: 0, y: 0, h: 0, p: 0 });
  const gx = toSX(S, at.x, at.y);
  const gy = toSY(S, at.x, at.y);
  const r = Math.max((big ? 5.5 : 3.4) * S.dpr, (big ? BIG_R : BALL_R) * S.s * 1.5);
  // Shadow on the snow: smaller and fainter the higher it flies.
  const hk = clamp01(at.h / 110);
  g.fillStyle = `rgba(40,70,120,${0.32 - hk * 0.18})`;
  g.beginPath();
  g.ellipse(gx, gy, r * (1.05 - hk * 0.35), r * (0.55 - hk * 0.2), 0, 0, TAU);
  g.fill();
  const lift = at.h * S.s;
  // A faint trail.
  const back = flightAt(f, t - 45, { x: 0, y: 0, h: 0, p: 0 });
  if (back.p < at.p) {
    g.strokeStyle = color ? rgba(color, 0.35) : "rgba(255,255,255,0.5)";
    g.lineWidth = r * 1.1;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(toSX(S, back.x, back.y), toSY(S, back.x, back.y) - back.h * S.s);
    g.lineTo(gx, gy - lift);
    g.stroke();
    g.lineCap = "butt";
  }
  const grd = g.createRadialGradient(gx - r * 0.35, gy - lift - r * 0.35, r * 0.1, gx, gy - lift, r);
  grd.addColorStop(0, "#ffffff");
  grd.addColorStop(1, "#c9dcf0");
  g.fillStyle = grd;
  g.beginPath();
  g.arc(gx, gy - lift, r, 0, TAU);
  g.fill();
  g.strokeStyle = "rgba(90,120,170,0.55)";
  g.lineWidth = Math.max(1, 0.8 * S.dpr);
  g.stroke();
  return at;
}

function drawAim(g: CanvasRenderingContext2D, S: Surface, x0: number, y0: number, tx: number, ty: number, color: string, now: number, triple: boolean) {
  const paths: [number, number][] = [[tx, ty]];
  if (triple) paths.push(spreadPoint(x0, y0, tx, ty, -1), spreadPoint(x0, y0, tx, ty, 1));
  const dpr = S.dpr;
  paths.forEach(([px, py], pi) => {
    const f = makeFlight(x0, y0, px, py, 0);
    const o = { x: 0, y: 0, h: 0, p: 0 };
    const n = 16;
    g.fillStyle = pi === 0 ? "rgba(30,58,110,0.85)" : "rgba(30,58,110,0.5)";
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.lineWidth = Math.max(1, 0.8 * dpr);
    const march = ((now / 600) % 1) / n;
    for (let i = 1; i < n; i++) {
      flightAt(f, f.T * (i / n + march), o);
      g.beginPath();
      g.arc(toSX(S, o.x, o.y), toSY(S, o.x, o.y) - o.h * S.s, Math.max(2 * dpr, 2.6 * S.s), 0, TAU);
      g.fill();
      g.stroke();
    }
    // Landing ring.
    const lx = toSX(S, px, py);
    const ly = toSY(S, px, py);
    const R = Math.max(7 * dpr, (PLAYER_R + BALL_R) * S.s);
    g.strokeStyle = color;
    g.lineWidth = 2 * dpr;
    g.setLineDash([4 * dpr, 3 * dpr]);
    g.beginPath();
    g.ellipse(lx, ly, R, R * 0.7, 0, 0, TAU);
    g.stroke();
    g.setLineDash([]);
  });
}

// ---------- data & effects ----------

export interface ArenaData {
  view: SnowView;
  mySlot: number;
  colors: string[];
  names: string[];
  avatars: string[];
  reduced: boolean;
  accent: string;
  /** Per slot: disconnected right now. */
  offline: boolean[];
  /** Per slot: team index in Red vs Blue (-1 in solo mode). */
  team: number[];
}

function burst(sc: Scene, x: number, y: number, n: number, now: number, color: string, speed: number, size: number) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const v = speed * (0.4 + Math.random() * 0.8);
    sc.parts.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - speed * 0.5,
      t0: now,
      life: 350 + Math.random() * 400,
      color: i % 4 === 0 ? color : "#ffffff",
      size: size * (0.5 + Math.random() * 0.8),
      grav: speed * 2.2,
    });
  }
}

/** A snowball stopped (on screen now): splat, flash, knockback. */
function impact(
  sc: Scene,
  S: Surface,
  d: ArenaData,
  wx: number,
  wy: number,
  h: number,
  what: number,
  which: number,
  big: boolean,
  dir: [number, number],
  now: number,
  thrower: number,
) {
  const x = toSX(S, wx, wy);
  const y = toSY(S, wx, wy) - h * S.s;
  const dpr = S.dpr;
  const n = d.reduced ? 5 : big ? 22 : 12;
  burst(sc, x, y, n, now, "#cfe3f7", (big ? 130 : 90) * dpr, (big ? 3 : 2.2) * dpr);
  if (what === END_GROUND || what === END_TREE) {
    sc.splats.push({ wx, wy, r: big ? 13 : 8, t0: now, seed: Math.floor(Math.random() * 1e6) });
    if (sc.splats.length > 40) sc.splats.shift();
  }
  if (what === END_PLAYER && which >= 0) {
    const k = sc.kids[which];
    if (k) {
      k.hitAt = now;
      k.hitX = dir[0];
      k.hitY = dir[1];
    }
    sc.pops.push({ x, y: y - 10 * dpr, text: big ? "SPLAT!!" : "SPLAT!", color: d.colors[which] ?? "#fff", t0: now, big });
    // You got hit, or your throw landed: a thud and a buzz. Others' hits: just a soft sound.
    if (which === d.mySlot || (thrower === d.mySlot && d.mySlot >= 0)) feedback("hit");
    else sfx("bump");
    if (which === d.mySlot) {
      sc.shakeAt = now;
      // The server already pushed you back; push your predicted kid the same way.
      const p = sc.pred;
      const m = Math.hypot(dir[0], dir[1]) || 1;
      const push = big ? 420 : 260;
      p.vx += (dir[0] / m) * push;
      p.vy += (dir[1] / m) * push;
    }
  }
  if (what === END_FORT && thrower === d.mySlot && d.mySlot >= 0) sfx("bump");
  if (what === END_FORT && !d.reduced) burst(sc, x, y, 6, now, "#a9c4e0", 70 * dpr, 3 * dpr);
}

function busy(sc: Scene) {
  return sc.parts.length > 0 || sc.pops.length > 0 || sc.balls.size > 0 || sc.throws.length > 0 || sc.move !== null || sc.aim !== null;
}

const stickRadius = (cssW: number) => Math.max(30, Math.min(52, cssW * 0.12));

// ---------- the scene ----------

interface Drawn {
  slot: number;
  x: number;
  y: number;
  out: boolean;
}

function drawScene(g: CanvasRenderingContext2D, sc: Scene, S: Surface, d: ArenaData, now: number, steer: boolean, armed: boolean) {
  const { view } = d;
  const field = FIELDS[view.field] ?? FIELDS[0];
  const { dpr, W, H } = S;
  sc.last = now;
  const rt = sc.clock.play(now, sc.frames);
  sc.rt = rt;
  const frames = sc.frames;
  while (frames.length > 2 && frames[1].t < rt - KEEP_MS) frames.shift();
  const reduced = d.reduced;
  const u = kidUnit(S);
  const latest = frames[frames.length - 1];
  const count = view.ids.length;
  while (sc.kids.length < count) sc.kids.push(newKid());

  if (sc.round !== view.round) {
    sc.round = view.round;
    sc.splats = [];
    sc.parts = [];
    sc.pops = [];
    sc.kids = view.ids.map(() => newKid());
  }

  // Effects ride in the frames and fire when playback reaches them.
  for (const f of frames) {
    if (f.t <= sc.fxCursor || f.t > rt) continue;
    sc.fxCursor = f.t;
    if (!f.f) continue;
    for (const e of f.f) {
      if (!Array.isArray(e)) continue;
      if (e[0] === FX_OUT && typeof e[1] === "number") {
        const k = sc.kids[e[1]];
        if (k) {
          k.outAt = now;
          k.wasOut = true;
        }
        if (e[1] === d.mySlot) feedback("out");
        else sfx("out");
      } else if (e[0] === FX_PICK && typeof e[1] === "number") {
        const x = toSX(S, f.xy[e[1] * 2], f.xy[e[1] * 2 + 1]);
        const y = toSY(S, f.xy[e[1] * 2], f.xy[e[1] * 2 + 1]);
        const kind = POWER_KINDS[e[2]] ?? "big";
        burst(sc, x, y, reduced ? 6 : 18, now, "#7dd3fc", 110 * dpr, 2.6 * dpr);
        sc.pops.push({ x, y: y - u * 2.4, text: `${POWER_INFO[kind].icon} ${POWER_INFO[kind].label}!`, color: "#7dd3fc", t0: now, big: false });
        if (e[1] === d.mySlot) feedback("score");
        else sfx("pop");
      } else if (e[0] === FX_PILE && typeof e[1] === "number") {
        const x = toSX(S, f.xy[e[1] * 2], f.xy[e[1] * 2 + 1]);
        const y = toSY(S, f.xy[e[1] * 2], f.xy[e[1] * 2 + 1]);
        burst(sc, x, y, reduced ? 4 : 12, now, "#e0f2fe", 80 * dpr, 2.6 * dpr);
        sc.pops.push({ x, y: y - u * 2.4, text: `+${AMMO_PILE} ❄`, color: "#e0f2fe", t0: now, big: false });
        if (e[1] === d.mySlot) feedback("pop");
      } else if (e[0] === FX_FORT && typeof e[1] === "number") {
        const fd = field.forts[e[1]];
        if (fd) {
          const cx = (fd.x1 + fd.x2) / 2;
          const cy = (fd.y1 + fd.y2) / 2;
          burst(sc, toSX(S, cx, cy), toSY(S, cx, cy), reduced ? 6 : 26, now, "#bcd4ec", 150 * dpr, 3.5 * dpr);
          sfx("hit");
        }
      }
    }
  }

  // ----- where everyone is -----
  const a = sampleAll(frames, rt, sc.pos);
  if (!a || !latest) return;
  const mine = d.mySlot;
  const meStatus = mine >= 0 ? readStatus(latest.st, mine) : null;
  const me = sc.pred;
  const predicting = steer && mine >= 0 && latest.n === view.round && latest.xy.length > mine * 2 + 1;
  if (predicting) {
    const sxw = latest.xy[mine * 2];
    const syw = latest.xy[mine * 2 + 1];
    if (!me.ready || me.round !== view.round) {
      Object.assign(me, { x: sxw, y: syw, vx: 0, vy: 0, ready: true, round: view.round, at: now, stillMs: 0, farMs: 0 });
      sc.trail.clear();
    }
    const sdt = Math.min(0.1, Math.max(0, (now - me.at) / 1000));
    me.at = now;
    const hp = fortHp(latest.w);
    const n = Math.max(1, Math.ceil(sdt / 0.0125));
    for (let i = 0; i < n; i++) stepBody(me, sc.ix, sc.iy, sdt / n, field, hp);
    // Reconcile with the server's copy of you.
    const prev = frames[frames.length - 2];
    const serverStill = !!prev && prev.n === latest.n && prev.xy[mine * 2] === sxw && prev.xy[mine * 2 + 1] === syw;
    const localStill = sc.ix === 0 && sc.iy === 0 && Math.hypot(me.vx, me.vy) < 1;
    me.stillMs = localStill ? me.stillMs + sdt * 1000 : 0;
    // The server's copy is old by a jittery network trip (often 100-600 ms), so it's compared
    // with the path you actually walked, not with where you are now: latency isn't an error,
    // only being blocked or knocked on the server is, and that's eased out, not snapped.
    sc.trail.push(now, me.x, me.y);
    reconcile(me, sc.trail, sxw, syw, sdt * 1000, { ...RECONCILE, still: serverStill && me.stillMs > 100 }, sc.err);
    debugFrame("snowball", { t: now, x: me.x, y: me.y, rt });
    sc.pos[mine * 2] = me.x;
    sc.pos[mine * 2 + 1] = me.y;
  } else me.ready = false;

  // ----- background, piles, forts, power-up, splats -----
  if (!S.bg || S.field !== view.field) {
    S.field = view.field;
    S.bg = renderBackground(S, field, view.field + 1);
  }
  const shake = now - sc.shakeAt < 260 && !reduced ? (1 - (now - sc.shakeAt) / 260) * 4 * dpr : 0;
  g.setTransform(1, 0, 0, 1, shake ? Math.sin(now / 17) * shake : 0, shake ? Math.cos(now / 23) * shake : 0);
  g.drawImage(S.bg, 0, 0);

  for (const sp of sc.splats) {
    const age = now - sp.t0;
    if (age > SPLAT_MS) continue;
    const x = toSX(S, sp.wx, sp.wy);
    const y = toSY(S, sp.wx, sp.wy);
    const rnd = seeded(sp.seed);
    g.globalAlpha = 1 - age / SPLAT_MS;
    g.fillStyle = "#ffffff";
    for (let i = 0; i < 6; i++) {
      const aa = rnd() * TAU;
      const dd = rnd() * sp.r * S.s;
      g.beginPath();
      g.ellipse(x + Math.cos(aa) * dd, y + Math.sin(aa) * dd * 0.6, sp.r * S.s * (0.3 + rnd() * 0.4), sp.r * S.s * 0.25, 0, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  sc.splats = sc.splats.filter((sp) => now - sp.t0 <= SPLAT_MS);

  // Snow piles: scoop for a stockpile.
  field.piles.forEach(([px, py], i) => {
    const ready = a.c[i] === "1";
    const x = toSX(S, px, py);
    const y = toSY(S, px, py);
    const r = PILE_R * S.s * (ready ? 1 : 0.6);
    g.fillStyle = "rgba(60,90,140,0.22)";
    g.beginPath();
    g.ellipse(x + r * 0.2, y + r * 0.35, r * 1.05, r * 0.7, 0, 0, TAU);
    g.fill();
    for (const [ox, oy, k] of [
      [-0.35, 0.1, 0.62],
      [0.35, 0.12, 0.58],
      [0, -0.15, 0.7],
    ] as const) {
      const grd = g.createRadialGradient(x + ox * r - r * 0.2, y + oy * r - r * 0.25, 0, x + ox * r, y + oy * r, r * k);
      grd.addColorStop(0, "#ffffff");
      grd.addColorStop(1, ready ? "#d6e7f7" : "#c3d3e4");
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x + ox * r, y + oy * r, r * k, 0, TAU);
      g.fill();
    }
    if (ready) {
      const tw = reduced ? 0.8 : 0.6 + 0.4 * Math.sin(now / 300 + i);
      g.globalAlpha = tw;
      g.font = `bold ${Math.round(Math.max(11 * dpr, r * 0.75))}px ${SANS}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#3b82f6";
      g.fillText("❄", x, y - r * 0.1);
      g.globalAlpha = 1;
    }
  });

  const hpNow = fortHp(a.w);
  // Forts flash when hit: remember when (from balls that stopped on them).
  field.forts.forEach((_, i) => drawFort(g, S, field, i, hpNow[i] ?? 0, now, fortHits[i] ?? -1e9));

  if (a.u) {
    const [kind, px, py] = a.u;
    const x = toSX(S, px, py);
    const y = toSY(S, px, py);
    const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 250);
    const R = Math.max(14 * dpr, 26 * S.s);
    const glow = g.createRadialGradient(x, y, R * 0.2, x, y, R * (1.5 + pulse * 0.4));
    glow.addColorStop(0, "rgba(125,211,252,0.7)");
    glow.addColorStop(1, "rgba(125,211,252,0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(x, y, R * 2, 0, TAU);
    g.fill();
    g.font = `${Math.round(R * 1.4)}px ${EMOJI_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(POWER_INFO[POWER_KINDS[kind] ?? "big"].icon, x, y - (reduced ? 0 : Math.sin(now / 300) * 2 * dpr));
  }

  // ----- players -----
  const drawn: Drawn[] = [];
  for (let slot = 0; slot < count; slot++) {
    const wx = sc.pos[slot * 2];
    const wy = sc.pos[slot * 2 + 1];
    if (wx === undefined || Number.isNaN(wx)) continue;
    const hp = Number(a.st[slot * 3]) || 0;
    const out = hp <= 0 && view.phase !== "countdown";
    const k = sc.kids[slot];
    if (out && !k.wasOut) {
      // Already out when we got here (joined mid-round): no flop.
      k.wasOut = true;
      k.outAt = now - FLOP_MS;
    }
    if (!out) k.wasOut = false;
    const x = toSX(S, wx, wy);
    const y = toSY(S, wx, wy);
    if (!Number.isNaN(k.lx)) {
      const dd = Math.hypot(x - k.lx, y - k.ly);
      if (dd < 30 * dpr) k.ph += dd / (5 * dpr);
    }
    k.lx = x;
    k.ly = y;
    drawn.push({ slot, x, y, out });
  }
  drawn.sort((p, q) => Number(q.out) - Number(p.out) || p.y - q.y);
  if (predicting && mine >= 0) {
    // Your spot: a ring on the snow.
    const md = drawn.find((p) => p.slot === mine);
    if (md && !md.out) {
      g.strokeStyle = "rgba(255,255,255,0.95)";
      g.lineWidth = 2.5 * dpr;
      g.beginPath();
      g.ellipse(md.x, md.y + u * 0.65, u * 1.45, u * 0.62, 0, 0, TAU);
      g.stroke();
      g.strokeStyle = d.colors[mine] ?? d.accent;
      g.lineWidth = 1.5 * dpr;
      g.stroke();
    }
  }
  for (const p of drawn) {
    const k = sc.kids[p.slot];
    let x = p.x;
    let y = p.y;
    const ha = now - k.hitAt;
    if (ha >= 0 && ha < 200 && !reduced) {
      // Recoil along the hit.
      const [dx, dy] = S.portrait ? [-k.hitY, k.hitX] : [k.hitX, k.hitY];
      const m = Math.hypot(dx, dy) || 1;
      const kick = Math.sin((ha / 200) * Math.PI) * u * 0.35;
      x += (dx / m) * kick;
      y += (dy / m) * kick;
    }
    drawKid(g, x, y, u, d.colors[p.slot] ?? "#94a3b8", d.avatars[p.slot] ?? "🙂", k, p.out, now, reduced);
    if (d.offline[p.slot] && !p.out) {
      g.font = `${Math.round(u * 0.9)}px ${EMOJI_FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("🔌", x + u * 0.95, y - u * 0.95);
    }
    // Name tag and hearts.
    if (!p.out || now - k.outAt < FLOP_MS + 400) {
      const hp = Number(a.st[p.slot * 3]) || 0;
      const isMe = p.slot === mine;
      const label = isMe ? "You" : (d.names[p.slot] ?? "");
      const fs = Math.round(Math.max(9.5 * dpr, u * 0.62));
      g.font = `700 ${fs}px ${SANS}`;
      g.textAlign = "center";
      g.textBaseline = "top";
      const ty = y + u * 1.12;
      const tw = Math.min(g.measureText(label).width, 90 * dpr);
      g.fillStyle = "rgba(15,23,42,0.62)";
      g.beginPath();
      g.roundRect(x - tw / 2 - 4 * dpr, ty - 1 * dpr, tw + 8 * dpr, fs + 3 * dpr, 4 * dpr);
      g.fill();
      g.fillStyle = isMe ? "#ffffff" : mix(d.colors[p.slot] ?? "#94a3b8", 255, 0.35);
      g.fillText(label, x, ty + 0.5 * dpr, 90 * dpr);
      if (!p.out && view.phase !== "countdown") {
        const pr = Math.max(2.6 * dpr, u * 0.2);
        const gap = pr * 2.7;
        // Hugging the top edge: hearts go under the name tag instead.
        const hy = y - u * 1.95 > pr * 1.6 ? y - u * 1.95 : ty + fs + 3 * dpr + pr * 1.4;
        for (let i = 0; i < view.maxHp; i++) {
          const hx = x + (i - (view.maxHp - 1) / 2) * gap;
          g.fillStyle = i < hp ? "#f43f5e" : "rgba(30,41,59,0.35)";
          g.beginPath();
          g.arc(hx, hy, pr, 0, TAU);
          g.fill();
          g.strokeStyle = "rgba(255,255,255,0.9)";
          g.lineWidth = Math.max(1, 0.9 * dpr);
          g.stroke();
        }
      }
    }
  }

  // ----- snowballs -----
  const o = { x: 0, y: 0, h: 0, p: 0 };
  for (const rb of sc.balls.values()) {
    if (rb.done) continue;
    if (rb.local) {
      if (rb.end && rt >= rb.end.t + 1500) rb.done = true;
      continue;
    }
    if (rt < rb.f.t0) continue;
    const endT = rb.end ? rb.end.t : rb.f.t0 + rb.f.T;
    if (rt >= endT) {
      if (rb.end || rt > endT + 300) {
        flightAt(rb.f, endT, o);
        const what = rb.end?.what ?? END_GROUND;
        if (what === END_FORT && rb.end) fortHits[rb.end.which] = now;
        impact(sc, S, d, o.x, o.y, o.h, what, rb.end?.which ?? -1, rb.big, [rb.f.tx - rb.f.x0, rb.f.ty - rb.f.y0], now, rb.slot);
        rb.done = true;
        continue;
      }
      // Landed but the verdict hasn't arrived yet: rest there a moment.
      drawBall(g, S, rb.f, endT, rb.big, d.colors[rb.slot] ?? null);
      continue;
    }
    drawBall(g, S, rb.f, rt, rb.big, d.colors[rb.slot] ?? null);
  }
  for (const [id, rb] of sc.balls) if (rb.done) sc.balls.delete(id);

  // Your own throws, on your local clock.
  for (const lt of sc.throws) {
    const age = now - lt.t0;
    lt.flights.forEach((f, i) => {
      if (lt.done[i]) return;
      const t = f.t0 + age;
      const p = (t - f.t0) / f.T;
      if (lt.refused) {
        lt.done[i] = true;
        flightAt(f, t, o);
        burst(sc, toSX(S, o.x, o.y), toSY(S, o.x, o.y) - o.h * S.s, 6, now, "#94a3b8", 60 * dpr, 2 * dpr);
        return;
      }
      const stop = lt.stop[i] ?? 1;
      const known = lt.what[i] !== undefined;
      if (p >= stop && (known || p >= 1.3 || (!lt.confirmed && p >= 1))) {
        flightAt(f, f.t0 + f.T * Math.min(stop, 1), o);
        const what = known ? lt.what[i] : END_GROUND;
        if (what === END_FORT) fortHits[lt.which[i]] = now;
        impact(sc, S, d, o.x, o.y, o.h, what, known ? lt.which[i] : -1, lt.big, [f.tx - f.x0, f.ty - f.y0], now, mine);
        lt.done[i] = true;
        return;
      }
      drawBall(g, S, f, Math.min(t, f.t0 + f.T * stop), lt.big, mine >= 0 ? (d.colors[mine] ?? null) : null);
    });
  }
  sc.throws = sc.throws.filter((lt) => lt.done.some((x) => !x) && now - lt.t0 < 4000);

  // ----- aim preview -----
  if (armed && mine >= 0 && me.ready) {
    let target: [number, number] | null = null;
    if (sc.aim && sc.aim.moved) target = aimFromStick(sc.aim, S, me);
    else if (!sc.aim && now - sc.mouseAt < 4000 && sc.mouseX >= 0) {
      const wx = toWX(S, sc.mouseX * dpr, sc.mouseY * dpr);
      const wy = toWY(S, sc.mouseX * dpr, sc.mouseY * dpr);
      target = aimPoint(me.x, me.y, wx, wy, 1, 0);
    }
    if (target) {
      const triple = meStatus?.power === 1 && meStatus.charges > 0;
      drawAim(g, S, me.x, me.y, target[0], target[1], d.colors[mine] ?? d.accent, reduced ? 0 : now, triple);
    }
  }

  // ----- particles & popups -----
  for (const p of sc.parts) {
    const age = (now - p.t0) / 1000;
    const k = age / (p.life / 1000);
    if (k >= 1) continue;
    g.globalAlpha = 1 - k;
    g.fillStyle = p.color;
    g.beginPath();
    g.arc(p.x + p.vx * age, p.y + p.vy * age + 0.5 * p.grav * age * age, p.size * (1 - k * 0.4), 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  sc.parts = sc.parts.filter((p) => now - p.t0 < p.life);
  for (const p of sc.pops) {
    const age = (now - p.t0) / 900;
    if (age >= 1) continue;
    const fs = Math.round(Math.max(12 * dpr, u * (p.big ? 1.25 : 0.95)));
    g.font = `900 ${fs}px ${SANS}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.globalAlpha = 1 - Math.max(0, age - 0.6) / 0.4;
    const yy = Math.max(fs, p.y - easeOut(Math.min(1, age * 1.6)) * 18 * dpr);
    const half = g.measureText(p.text).width / 2 + 3 * dpr;
    p.x = Math.max(half, Math.min(W - half, p.x));
    g.lineWidth = 3 * dpr;
    g.strokeStyle = "rgba(15,23,42,0.75)";
    g.strokeText(p.text, p.x, yy);
    g.fillStyle = p.color;
    g.fillText(p.text, p.x, yy);
  }
  g.globalAlpha = 1;
  sc.pops = sc.pops.filter((p) => now - p.t0 < 900);

  // ----- sticks -----
  g.setTransform(1, 0, 0, 1, 0, 0);
  for (const st of [sc.move, sc.aim]) {
    if (!st) continue;
    const R = stickRadius(W / dpr) * dpr * (st === sc.aim ? 1.25 : 1);
    const x0 = st.ox * dpr;
    const y0 = st.oy * dpr;
    g.globalAlpha = 0.85;
    g.fillStyle = "rgba(15,23,42,0.16)";
    g.strokeStyle = st === sc.aim ? rgba(d.accent, 0.9) : "rgba(255,255,255,0.8)";
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
    g.fillStyle = st === sc.aim ? "#ffffff" : rgba(d.accent, 0.95);
    g.beginPath();
    g.arc(x0 + kx, y0 + ky, R * 0.4, 0, TAU);
    g.fill();
    if (st === sc.aim) {
      g.font = `${Math.round(R * 0.42)}px ${EMOJI_FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("❄️", x0 + kx, y0 + ky);
    }
    g.globalAlpha = 1;
  }
  // Blizzard: blowing snow.
  if (view.sudden && view.phase === "fight" && !reduced) {
    g.fillStyle = "rgba(255,255,255,0.8)";
    for (let i = 0; i < 60; i++) {
      const sx = ((i * 137.5 + now * (0.18 + (i % 5) * 0.05)) % (W + 40)) - 20;
      const sy = ((i * 89.3 + now * 0.07 + Math.sin(now / 500 + i) * 20) % (H + 40)) - 20;
      g.beginPath();
      g.arc(sx, sy, (1 + (i % 3)) * dpr, 0, TAU);
      g.fill();
    }
  }
  if (H > 0) {
    g.strokeStyle = "rgba(15,23,42,0.18)";
    g.lineWidth = 6 * dpr;
    g.strokeRect(0, 0, W, H);
  }
}

/** When each fort was last hit (performance.now), for the wobble. Module-level: one arena at a time. */
const fortHits: number[] = [];

/** Throw stick -> landing spot: direction from the drag, distance from its length. */
function aimFromStick(st: Stick, S: Surface, me: { x: number; y: number }): [number, number] {
  const R = stickRadius(S.W / S.dpr) * 1.25;
  const dx = st.kx - st.ox;
  const dy = st.ky - st.oy;
  const m = Math.hypot(dx, dy) || 1;
  const k = clamp01((m - 10) / (R - 10));
  const range = MIN_RANGE + (MAX_RANGE - MIN_RANGE) * k;
  const [wx, wy] = toWorldDir(S, dx / m, dy / m);
  return aimPoint(me.x, me.y, me.x + wx * range, me.y + wy * range, wx, wy);
}

// ---------- component ----------

export interface Hud {
  hp: number;
  ammo: number;
  power: number;
  charges: number;
  empty: number;
}

export function Arena({
  data,
  act,
  onEvent,
  canSteer,
  canThrow,
  label,
  ringColor,
  hint,
  children,
}: {
  data: ArenaData;
  act: (a: SnowAction) => void;
  onEvent: (fn: (e: unknown) => void) => () => void;
  /** You can walk (alive, fight or round over). */
  canSteer: boolean;
  /** You can throw right now (alive, fight). */
  canThrow: boolean;
  label: string;
  ringColor: string;
  hint: ReactNode;
  children?: ReactNode;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Scene>(newScene());
  const surface = useRef<Surface | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [presses, setPresses] = useState(0);
  const { view } = data;

  // ----- frames & events -----
  const onSnap = useEffectEvent((snap: Snap) => pushFrame(scene.current, snap, performance.now(), data.mySlot));
  useEffect(() => {
    if (isSnap(view.snap)) onSnap(view.snap);
  }, [view]);
  const onServerEvent = useEffectEvent((e: unknown) => {
    if (isSnap(e)) return onSnap(e);
    if (!e || typeof e !== "object") return;
    const ev = e as { k?: unknown; s?: unknown };
    if (ev.k === "no" && typeof ev.s === "number") {
      const lt = scene.current.throws.find((x) => x.seq === ev.s);
      if (lt && !lt.confirmed) lt.refused = performance.now();
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
      surface.current = layout(W, H, dpr);
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
    if (data.view.phase === "final" && !busy(sc) && sc.rt > data.view.snap.t + 2_500) {
      const key = `${S.W}x${S.H}|${data.reduced}|${data.view.snap.t}`;
      if (sc.stillKey === key) {
        sc.last = -1;
        return;
      }
      sc.stillKey = key;
    } else sc.stillKey = "";
    const g = canvas.getContext("2d");
    if (!g) return;
    drawScene(g, sc, S, data, now, canSteer, canThrow);
    // The ammo / hp row under the field (only re-renders when it changes).
    const latest = sc.frames[sc.frames.length - 1];
    if (data.mySlot >= 0 && latest) {
      const st = readStatus(latest.st, data.mySlot);
      const pending = pendingThrows(sc, now);
      const ammo = Math.max(0, st.ammo - pending);
      const empty = sc.emptyAt;
      const key = `${st.hp}|${ammo}|${st.power}|${st.charges}|${empty}`;
      if (key !== sc.hud) {
        sc.hud = key;
        setHud({ hp: st.hp, ammo, power: st.power, charges: st.charges, empty });
      }
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
    const sc = scene.current;
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      if (sc.sendTimer) clearTimeout(sc.sendTimer);
    };
  }, []);

  // ----- walking -----
  const sendInput = (force = false) => {
    const sc = scene.current;
    if (sc.sendTimer) clearTimeout(sc.sendTimer);
    sc.sendTimer = null;
    const S = surface.current;
    let x = 0;
    let y = 0;
    if (sc.move) {
      const R = stickRadius(holderRef.current?.clientWidth ?? 360);
      const dx = (sc.move.kx - sc.move.ox) / R;
      const dy = (sc.move.ky - sc.move.oy) / R;
      const m = Math.hypot(dx, dy);
      if (m > 0.2) [x, y] = m > 1 ? [dx / m, dy / m] : [dx, dy];
    } else {
      if (sc.keys.has("left")) x -= 1;
      if (sc.keys.has("right")) x += 1;
      if (sc.keys.has("up")) y -= 1;
      if (sc.keys.has("down")) y += 1;
      const m = Math.hypot(x, y);
      if (m > 1) [x, y] = [x / m, y / m];
    }
    const [wx, wy] = toWorldDir(S, x, y);
    const ix = canSteer ? Math.round(wx * 100) : 0;
    const iy = canSteer ? Math.round(wy * 100) : 0;
    // Predict with exactly what the server will apply.
    [sc.ix, sc.iy] = inputDir(ix, iy);
    const key = `${ix},${iy}`;
    if (key === sc.sent && !force) return;
    const now = perfNow();
    if (!force && now - sc.sentAt < SEND_GAP) {
      sc.sendTimer = setTimeout(() => sendInput(), SEND_GAP - (now - sc.sentAt));
      return;
    }
    sc.sent = key;
    sc.sentAt = now;
    act({ type: "in", x: ix, y: iy });
  };

  // ----- throwing -----
  const throwAt = (tx: number, ty: number) => {
    const sc = scene.current;
    const now = performance.now();
    const me = sc.pred;
    const mine = data.mySlot;
    if (!canThrow || mine < 0 || !me.ready) return;
    if (now - sc.lastThrow < THROW_CD_MS) return;
    const latest = sc.frames[sc.frames.length - 1];
    if (!latest) return;
    const st = readStatus(latest.st, mine);
    const pending = pendingThrows(sc, now);
    if (st.ammo - pending <= 0) {
      sc.emptyAt = now;
      return;
    }
    const [ax, ay] = aimPoint(me.x, me.y, tx, ty, 1, 0);
    const big = st.power === 0 && st.charges > pending;
    const triple = st.power === 1 && st.charges > pending;
    const x0 = Math.round(me.x);
    const y0 = Math.round(me.y);
    const pts: [number, number][] = [[ax, ay]];
    if (triple) pts.push(spreadPoint(x0, y0, ax, ay, -1), spreadPoint(x0, y0, ax, ay, 1));
    const seq = ++sc.seq;
    sc.throws.push({
      seq,
      t0: now,
      flights: pts.map(([px, py]) => makeFlight(x0, y0, px, py, 0)),
      big,
      ids: [],
      stop: pts.map(() => 1),
      what: [],
      which: [],
      done: pts.map(() => false),
      refused: 0,
      confirmed: false,
    });
    sc.lastThrow = now;
    const k = sc.kids[mine];
    if (k) {
      k.throwAt = now;
      const S = surface.current;
      const [dx, dy] = S?.portrait ? [-(ay - y0), ax - x0] : [ax - x0, ay - y0];
      const m = Math.hypot(dx, dy) || 1;
      k.ax = dx / m;
      k.ay = dy / m;
    }
    setPresses((n) => n + 1);
    act({ type: "throw", x: ax, y: ay, s: seq });
  };

  /** Tap to throw: at the nearest opponent (never a teammate), leading them a little. */
  const autoThrow = () => {
    const sc = scene.current;
    const me = sc.pred;
    const mine = data.mySlot;
    if (!me.ready || mine < 0) return;
    const a = sc.frames[sc.frames.length - 1];
    if (!a) return;
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < data.view.ids.length; i++) {
      if (i === mine || (Number(a.st[i * 3]) || 0) <= 0) continue;
      if (data.team[i] >= 0 && data.team[i] === data.team[mine]) continue; // a teammate
      const dd = Math.hypot(sc.pos[i * 2] - me.x, sc.pos[i * 2 + 1] - me.y);
      if (dd < bd) [bd, best] = [dd, i];
    }
    if (best < 0) return throwAt(me.x + 200, me.y);
    let tx = sc.pos[best * 2];
    let ty = sc.pos[best * 2 + 1];
    const f = sc.frames;
    if (f.length >= 2) {
      const p = f[f.length - 2];
      const q = f[f.length - 1];
      const dtm = (q.t - p.t) / 1000;
      if (dtm > 0 && dtm < 0.2 && p.n === q.n) {
        const vx = (q.xy[best * 2] - p.xy[best * 2]) / dtm;
        const vy = (q.xy[best * 2 + 1] - p.xy[best * 2 + 1]) / dtm;
        const T = makeFlight(me.x, me.y, tx, ty, 0).T / 1000;
        tx += vx * T * 0.7;
        ty += vy * T * 0.7;
      }
    }
    throwAt(tx, ty);
  };

  const onKey = useEffectEvent((e: KeyboardEvent, down: boolean) => {
    const sc = scene.current;
    const dir = KEY_DIR[e.code] ?? KEY_DIR[e.key];
    if (!down) {
      if (dir && sc.keys.delete(dir)) sendInput();
      return;
    }
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (dir) {
      if (!canSteer && data.mySlot < 0) return;
      e.preventDefault();
      if (!sc.keys.has(dir)) {
        sc.keys.add(dir);
        sendInput();
      }
    } else if ((e.code === "Space" || e.key === " ") && !isButton(e.target) && data.mySlot >= 0) {
      e.preventDefault();
      if (e.repeat) return;
      const S = surface.current;
      if (S && performance.now() - sc.mouseAt < 4000 && sc.mouseX >= 0) {
        throwAt(toWX(S, sc.mouseX * S.dpr, sc.mouseY * S.dpr), toWY(S, sc.mouseX * S.dpr, sc.mouseY * S.dpr));
      } else autoThrow();
    }
  });
  const onLetGo = useEffectEvent(() => {
    const sc = scene.current;
    sc.keys.clear();
    sc.move = null;
    sc.aim = null;
    sendInput();
  });
  const onResend = useEffectEvent(() => {
    const sc = scene.current;
    if (canSteer && (sc.ix !== 0 || sc.iy !== 0)) sendInput(true);
  });
  useEffect(() => {
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => onLetGo();
    const vis = () => {
      if (document.hidden) onLetGo();
    };
    // A held direction is re-sent now and then, in case the server dropped it (e.g. a reconnect).
    const iv = setInterval(() => onResend(), 1000);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(iv);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
  // Losing the ability to walk (knocked out, match over) stops you; regaining it resumes a held key.
  const onSteerChange = useEffectEvent(() => sendInput(true));
  useEffect(() => {
    if (data.mySlot >= 0) onSteerChange();
  }, [canSteer, data.mySlot]);

  // ----- pointer: mouse aims & clicks; touch: left half walks, right half aims (release throws) -----
  const local = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top, r.width] as const;
  };
  const capture = (e: PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; dragging still works.
    }
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const sc = scene.current;
    if (data.mySlot < 0) return;
    const [x, y, w] = local(e);
    if (e.pointerType === "mouse") {
      if (e.button !== 0) return;
      sc.mouseX = x;
      sc.mouseY = y;
      sc.mouseAt = performance.now();
      const S = surface.current;
      if (S) throwAt(toWX(S, x * S.dpr, y * S.dpr), toWY(S, x * S.dpr, y * S.dpr));
      return;
    }
    if (x < w / 2) {
      if (sc.move || !canSteer) return;
      sc.move = { id: e.pointerId, ox: x, oy: y, kx: x, ky: y, moved: false };
      capture(e);
    } else {
      if (sc.aim) return;
      sc.aim = { id: e.pointerId, ox: x, oy: y, kx: x, ky: y, moved: false };
      capture(e);
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const sc = scene.current;
    const [x, y] = local(e);
    if (e.pointerType === "mouse") {
      sc.mouseX = x;
      sc.mouseY = y;
      sc.mouseAt = performance.now();
      return;
    }
    if (sc.move && sc.move.id === e.pointerId) {
      sc.move.kx = x;
      sc.move.ky = y;
      sendInput();
    } else if (sc.aim && sc.aim.id === e.pointerId) {
      sc.aim.kx = x;
      sc.aim.ky = y;
      if (Math.hypot(x - sc.aim.ox, y - sc.aim.oy) > 12) sc.aim.moved = true;
    }
  };
  const release = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const sc = scene.current;
    if (sc.move && sc.move.id === e.pointerId) {
      sc.move = null;
      sendInput();
      return;
    }
    const st = sc.aim;
    if (!st || st.id !== e.pointerId) return;
    sc.aim = null;
    if (cancelled) return;
    const S = surface.current;
    const pulled = Math.hypot(st.kx - st.ox, st.ky - st.oy);
    if (!st.moved) autoThrow();
    else if (pulled > 12 && S && sc.pred.ready) {
      const [tx, ty] = aimFromStick(st, S, sc.pred);
      throwAt(tx, ty);
    }
    // Dragged out and back to the middle: cancelled.
  };

  const me = data.mySlot;
  const ammoMax = hud ? Math.max(AMMO, hud.ammo) : AMMO;
  const emptyFlash = hud && hud.empty > 0;
  return (
    <>
      <div
        ref={holderRef}
        className="sb-stage relative mx-auto w-full overflow-hidden rounded-2xl ring-2 transition-[box-shadow] duration-300 select-none"
        style={{
          touchAction: me >= 0 && view.phase !== "final" ? "none" : "auto",
          cursor: canThrow ? "crosshair" : undefined,
          ["--tw-ring-color" as string]: ringColor,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => release(e, false)}
        onPointerCancel={(e) => release(e, true)}
        onLostPointerCapture={(e) => release(e, true)}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") scene.current.mouseAt = -1e9;
        }}
      >
        <canvas ref={canvasRef} role="img" aria-label={label} className="absolute inset-0 h-full w-full" />
        {children}
      </div>
      {me >= 0 && view.phase !== "final" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-panel px-3 py-2" aria-live="polite">
            <span className="sr-only">
              {hud ? `${hud.hp} of ${view.maxHp} hearts, ${hud.ammo} snowball${hud.ammo === 1 ? "" : "s"}` : ""}
              {hud && hud.power >= 0 ? `, ${POWER_INFO[POWER_KINDS[hud.power]].label} ×${hud.charges}` : ""}
            </span>
            <span className="flex gap-0.5" aria-hidden>
              {Array.from({ length: view.maxHp }, (_, i) => (
                <span key={i} className={`text-base leading-none ${hud && i < hud.hp ? "" : "opacity-25 grayscale"}`}>
                  ❤️
                </span>
              ))}
            </span>
            <span className="h-5 w-px bg-line" aria-hidden />
            <span key={hud?.empty ?? 0} className={`flex gap-1 ${emptyFlash ? "sb-shake" : ""}`} aria-hidden>
              {Array.from({ length: ammoMax }, (_, i) => (
                <span
                  key={i}
                  className={`inline-block size-4 rounded-full border transition-all duration-200 ${
                    hud && i < hud.ammo ? "border-sky-200 bg-white shadow-[inset_-2px_-2px_0_rgba(125,160,200,0.6)]" : "scale-75 border-line bg-transparent"
                  }`}
                />
              ))}
            </span>
            {hud && hud.power >= 0 && (
              <span className="animate-pop text-sm font-bold text-sky-200" aria-hidden>
                {POWER_INFO[POWER_KINDS[hud.power]].icon}×{hud.charges}
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn h-11 shrink-0 rounded-2xl px-4 font-black tracking-wide select-none"
            disabled={!canThrow}
            aria-keyshortcuts="Space"
            onClick={() => autoThrow()}
            style={{ borderColor: canThrow ? data.accent + "aa" : undefined }}
          >
            <span key={presses} className={presses ? "animate-pop inline-block" : "inline-block"} aria-hidden>
              ❄️
            </span>{" "}
            Throw at nearest
          </button>
          <p className="min-w-0 flex-1 basis-48 text-xs text-muted">{hint}</p>
        </div>
      )}
    </>
  );
}

/** performance.now(), for event handlers. */
const perfNow = () => performance.now();

function pendingThrows(sc: Scene, now: number) {
  let n = 0;
  for (const lt of sc.throws) if (!lt.confirmed && !lt.refused && now - lt.t0 < 1500) n += 1;
  return n;
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
