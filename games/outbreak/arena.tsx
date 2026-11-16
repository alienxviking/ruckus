"use client";

// Canvas renderer, playback buffer, own-runner prediction and controls for Outbreak.
//
// Everyone else: the server sends every position 20 times a second. The renderer keeps
// a short buffer and draws the world ~100ms in the past, blending the two frames around
// that moment, so runners glide at display refresh rate. Effects (bites, cures, flashes)
// ride in the frames and fire when playback reaches them.
//
// You: your own runner steps the exact movement model the server uses (shared.ts), in
// the same 25ms substeps, from your keys or stick, so steering reacts on the next frame.
// The server applies the same inputs a moment later; leftover drift is eased out.

import { useEffect, useEffectEvent, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { OBView } from "./server";
import {
  FLASH_R,
  FX_BITE,
  FX_CURE,
  FX_FLASH,
  FX_LUNGE,
  FX_PICK,
  F_CURE,
  F_FLASH,
  F_OFF,
  F_SHIELD,
  F_STUN,
  F_ZOMBIE,
  ITEM_CURE,
  LUNGE_CD_MS,
  LUNGE_MS,
  R_S,
  R_Z,
  SUB_MS,
  TICK_MS,
  T,
  WORLD_H,
  WORLD_W,
  decodeFlags,
  decodePositions,
  inputDir,
  isSnap,
  mapOf,
  stepPlayer,
  type MapDef,
  type Snap,
} from "./shared";
import { Timeline, Trail, debugFrame, reconcile } from "../snakes/netsmooth";

const TAU = Math.PI * 2;
const DELAY_MS = 100;
const EXTRAP_MS = 150;
/** Your runner vs the server's copy: path errors under `tol` are rounding, over `snap` a teleport. */
const RECONCILE = { tol: 6, snap: 180, tauMs: 150 };
const KEEP_MS = 600;
const MAX_FRAMES = 60;
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const SANS = "ui-sans-serif, system-ui, sans-serif";
const ZOMBIE_SKIN = "#7fc45a";
const ZOMBIE_DARK = "#3f6b2a";
const CURE_COLOR = "#67e8f9";
const HAZARD = "#facc15";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

// ---------- frames & clock ----------

interface Frame {
  n: number;
  t: number;
  xy: number[];
  fl: number[];
  fx: number[][] | null;
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

interface Anim {
  face: number;
  ph: number;
  spd: number;
  x: number;
  y: number;
  init: boolean;
}

interface Pred {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ready: boolean;
  round: number;
  zombie: boolean;
  acc: number;
  at: number;
  stillMs: number;
  farMs: number;
  lungeUntil: number;
  lx: number;
  ly: number;
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

interface Ring {
  x: number;
  y: number;
  r: number;
  t0: number;
  life: number;
  color: string;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  t0: number;
}

interface Stick {
  id: number;
  ox: number;
  oy: number;
  kx: number;
  ky: number;
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
  map: number;
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
  fl: number[];
  pred: Pred;
  /** Where your runner has been (for reconciling with the server's old copy of you). */
  trail: Trail;
  err: { x: number; y: number };
  sparks: Spark[];
  rings: Ring[];
  floaters: Floater[];
  lunges: number[];
  /** Screen flash: colour and start (performance.now). */
  flash: { color: string; t0: number; text: string } | null;
  shake: { t0: number; amp: number } | null;
  localFlashAt: number;
  keys: Set<string>;
  stick: Stick | null;
  ix: number;
  iy: number;
  sent: string;
  last: number;
  stillKey: string;
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
    fl: [],
    trail: new Trail(3_000),
    err: { x: 0, y: 0 },
    pred: {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      ready: false,
      round: -1,
      zombie: false,
      acc: 0,
      at: -1,
      stillMs: 0,
      farMs: 0,
      lungeUntil: 0,
      lx: 1,
      ly: 0,
    },
    sparks: [],
    rings: [],
    floaters: [],
    lunges: [],
    flash: null,
    shake: null,
    localFlashAt: -1e9,
    keys: new Set(),
    stick: null,
    ix: 0,
    iy: 0,
    sent: "0,0",
    last: -1,
    stillKey: "",
  };
}

function pushFrame(sc: Scene, snap: Snap, now: number) {
  const f: Frame = {
    n: snap.n,
    t: snap.t,
    xy: decodePositions(snap.p),
    fl: decodeFlags(snap.f),
    fx: Array.isArray(snap.fx) ? snap.fx : null,
  };
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
    // The server skipped identical frames: everyone stood still until one tick before this.
    if (last && snap.q === 1 && f.t - last.t > TICK_MS * 1.5) frames.push({ ...last, t: f.t - TICK_MS, fx: null });
    frames.push(f);
  } else {
    const same = frames.find((x) => x.t === f.t);
    if (same) {
      // The view's copy of a frame we already have may carry effects the event didn't.
      if (f.fx && !same.fx) same.fx = f.fx;
      same.fl = f.fl;
    } else {
      const i = frames.findIndex((x) => x.t > f.t);
      frames.splice(i, 0, f);
    }
  }
  if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
}

/** Every position at server time `rt` into `pos` (and the flags in force into `fl`). */
function sampleAll(frames: Frame[], rt: number, pos: number[], fl: number[]): boolean {
  const n = frames.length;
  if (!n) return false;
  let i = n - 1;
  while (i > 0 && frames[i].t > rt) i--;
  const a = frames[i];
  const len = a.xy.length;
  pos.length = len;
  fl.length = a.fl.length;
  for (let j = 0; j < a.fl.length; j++) fl[j] = a.fl[j];
  if (a.t >= rt) {
    for (let j = 0; j < len; j++) pos[j] = a.xy[j];
    return true;
  }
  const b = frames[i + 1];
  if (!b) {
    const p = frames[i - 1];
    const gap = p ? a.t - p.t : 0;
    if (!p || gap > TICK_MS * 2.5 || p.xy.length !== len) {
      for (let j = 0; j < len; j++) pos[j] = a.xy[j];
      return true;
    }
    const e = Math.min(rt - a.t, EXTRAP_MS) / gap;
    for (let j = 0; j < len; j++) pos[j] = a.xy[j] + (a.xy[j] - p.xy[j]) * e;
    return true;
  }
  const k = (rt - a.t) / (b.t - a.t);
  for (let j = 0; j < len; j++) {
    const bv = b.xy[j] ?? a.xy[j];
    // A big jump (a respawn) snaps instead of sliding across the map.
    pos[j] = Math.abs(bv - a.xy[j]) > 80 ? (k < 0.5 ? a.xy[j] : bv) : a.xy[j] + (bv - a.xy[j]) * k;
  }
  return true;
}

// ---------- colours ----------

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x94a3b8;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixHex(a: string, b: string, t: number) {
  const x = hexRgb(a);
  const y = hexRgb(b);
  const c = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}
function rgba(hex: string, a: number) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
function inkFor(bg: string) {
  const [r, g, b] = hexRgb(bg);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#111018" : "#ffffff";
}

// ---------- geometry ----------

function layout(W: number, H: number, dpr: number): Surface {
  const portrait = H > W * 1.05;
  const ww = portrait ? WORLD_H : WORLD_W;
  const wh = portrait ? WORLD_W : WORLD_H;
  const s = Math.min(W / ww, H / wh);
  return { W, H, dpr, portrait, s, ox: (W - ww * s) / 2, oy: (H - wh * s) / 2, map: -1, bg: null };
}
const toSX = (S: Surface, wx: number, wy: number) => (S.portrait ? S.ox + (WORLD_H - wy) * S.s : S.ox + wx * S.s);
const toSY = (S: Surface, wx: number, wy: number) => (S.portrait ? S.oy + wx * S.s : S.oy + wy * S.s);
/** Screen direction -> world direction. */
const toWorldDir = (S: Surface | null, dx: number, dy: number): [number, number] => (S?.portrait ? [dy, -dx] : [dx, dy]);
function worldTransform(g: CanvasRenderingContext2D, S: Surface) {
  if (S.portrait) g.setTransform(0, S.s, -S.s, 0, S.ox + WORLD_H * S.s, S.oy);
  else g.setTransform(S.s, 0, 0, S.s, S.ox, S.oy);
}
/** Body radii on screen: true to scale, but never too small to see on a phone. */
const radS = (S: Surface) => Math.max(9 * S.dpr, R_S * S.s * 1.1);
const radZ = (S: Surface) => Math.max(12 * S.dpr, R_Z * S.s * 1.1);

// ---------- background ----------

function seeded(seed: number) {
  let v = seed;
  return () => (v = (v * 16807) % 2147483647) / 2147483647;
}

function renderBackground(S: Surface, map: MapDef, mapIndex: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = S.W;
  c.height = S.H;
  const g = c.getContext("2d");
  if (!g) return c;
  g.fillStyle = "#0b0d12";
  g.fillRect(0, 0, S.W, S.H);
  worldTransform(g, S);
  const px = 1 / S.s; // one device pixel in world units
  // Floor tiles.
  const tile = 50;
  for (let y = 0; y < WORLD_H; y += tile) {
    for (let x = 0; x < WORLD_W; x += tile) {
      g.fillStyle = ((x + y) / tile) % 2 === 0 ? map.floor[0] : map.floor[1];
      g.fillRect(x, y, tile, tile);
    }
  }
  g.strokeStyle = "rgba(255, 255, 255, 0.035)";
  g.lineWidth = px;
  g.beginPath();
  for (let x = tile; x < WORLD_W; x += tile) {
    g.moveTo(x, 0);
    g.lineTo(x, WORLD_H);
  }
  for (let y = tile; y < WORLD_H; y += tile) {
    g.moveTo(0, y);
    g.lineTo(WORLD_W, y);
  }
  g.stroke();
  // Grime and slime puddles.
  const rnd = seeded(71 + mapIndex * 977);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * WORLD_W;
    const y = rnd() * WORLD_H;
    const r = 8 + rnd() * 26;
    const slime = i % 4 === 0;
    g.fillStyle = slime ? "rgba(132, 204, 22, 0.10)" : "rgba(0, 0, 0, 0.13)";
    g.beginPath();
    g.ellipse(x, y, r, r * (0.5 + rnd() * 0.4), rnd() * Math.PI, 0, TAU);
    g.fill();
  }
  // Wall shadows, then walls.
  g.fillStyle = "rgba(0, 0, 0, 0.35)";
  for (const [x, y, w, h] of map.walls) g.fillRect(x + 4, y + 6, w, h);
  for (const [x, y, w, h] of map.walls) {
    g.fillStyle = "#4b5563";
    g.fillRect(x, y, w, h);
    g.fillStyle = "#6b7685";
    g.fillRect(x, y, w, Math.min(h, 4));
    g.fillStyle = "#353c47";
    g.fillRect(x, y + h - Math.min(h, 3), w, Math.min(h, 3));
  }
  // Doors: hazard-striped gates only survivors fit through.
  for (const [x, y, w, h] of map.doors) {
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.fillStyle = "rgba(250, 204, 21, 0.18)";
    g.fillRect(x, y, w, h);
    g.strokeStyle = rgba(HAZARD, 0.75);
    g.lineWidth = 4;
    for (let d = -h - w; d < w + h; d += 11) {
      g.beginPath();
      g.moveTo(x + d, y + h);
      g.lineTo(x + d + h, y);
      g.stroke();
    }
    g.restore();
    // Door jambs.
    g.fillStyle = HAZARD;
    if (w > h) {
      g.fillRect(x - 2, y - 2, 4, h + 4);
      g.fillRect(x + w - 2, y - 2, 4, h + 4);
    } else {
      g.fillRect(x - 2, y - 2, w + 4, 4);
      g.fillRect(x - 2, y + h - 2, w + 4, 4);
    }
  }
  // A dark frame around the world.
  g.strokeStyle = "#2b3340";
  g.lineWidth = T / 2;
  g.strokeRect(T / 4, T / 4, WORLD_W - T / 2, WORLD_H - T / 2);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}

// ---------- drawing ----------

function drawTag(g: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, px: number, alpha = 1) {
  g.font = `700 ${px}px ${SANS}`;
  const w = g.measureText(text).width + px * 0.8;
  const h = px * 1.35;
  g.globalAlpha = alpha * 0.92;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(x - w / 2, y - h, w, h, h / 2);
  g.fill();
  g.globalAlpha = alpha;
  g.fillStyle = inkFor(bg);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, x, y - h / 2 + px * 0.05);
  g.globalAlpha = 1;
}

interface Body {
  slot: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  fl: number;
}

export interface ArenaData {
  view: OBView;
  mySlot: number;
  colors: string[];
  names: string[];
  avatars: string[];
  reduced: boolean;
  /** You can steer right now. */
  steer: boolean;
  accent: string;
}

function animate(a: Anim, sx: number, sy: number, dt: number, dpr: number) {
  if (!a.init) {
    Object.assign(a, { x: sx, y: sy, init: true });
    return;
  }
  const dx = sx - a.x;
  const dy = sy - a.y;
  a.x = sx;
  a.y = sy;
  const d = Math.hypot(dx, dy);
  const spd = dt > 0 ? d / dpr / dt : 0;
  a.spd += (spd - a.spd) * Math.min(1, dt * 10);
  if (d > 0.3 * dpr) {
    const want = Math.atan2(dy, dx);
    let diff = want - a.face;
    while (diff > Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;
    a.face += diff * Math.min(1, dt * 12);
  }
  a.ph += dt * Math.min(a.spd, 160) * 0.12;
}

function drawSurvivor(g: CanvasRenderingContext2D, b: Body, a: Anim, r: number, color: string, avatar: string, now: number, reduced: boolean) {
  const bob = reduced ? 0 : Math.abs(Math.sin(a.ph)) * r * 0.18 * clamp01(a.spd / 40);
  const x = b.sx;
  const y = b.sy - bob;
  // Shadow.
  g.fillStyle = "rgba(0, 0, 0, 0.35)";
  g.beginPath();
  g.ellipse(b.sx, b.sy + r * 0.75, r * 0.95, r * 0.42, 0, 0, TAU);
  g.fill();
  if (b.fl & F_SHIELD) {
    const p = 0.5 + 0.5 * Math.sin(now / 90);
    g.strokeStyle = rgba(CURE_COLOR, 0.5 + p * 0.4);
    g.lineWidth = r * 0.22;
    g.beginPath();
    g.arc(x, y, r * 1.45, 0, TAU);
    g.stroke();
  }
  // Feet hint in the running direction.
  g.fillStyle = mixHex(color, "#000000", 0.45);
  const fx = Math.cos(a.face);
  const fy = Math.sin(a.face);
  g.beginPath();
  g.arc(x + fx * r * 0.72, y + fy * r * 0.72, r * 0.32, 0, TAU);
  g.fill();
  // Body.
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.strokeStyle = "rgba(10, 10, 20, 0.75)";
  g.lineWidth = Math.max(1.2, r * 0.14);
  g.stroke();
  g.font = `${Math.round(r * 1.25)}px ${EMOJI_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(avatar, x, y + r * 0.06);
  return y;
}

function drawZombie(
  g: CanvasRenderingContext2D,
  b: Body,
  a: Anim,
  r: number,
  color: string,
  now: number,
  reduced: boolean,
  lungeAge: number,
  original: boolean,
) {
  const stunned = (b.fl & F_STUN) !== 0;
  const sway = reduced || stunned ? 0 : Math.sin(a.ph * 0.6 + b.slot) * 0.16;
  const x = b.sx;
  const y = b.sy;
  g.fillStyle = "rgba(0, 0, 0, 0.38)";
  g.beginPath();
  g.ellipse(x, y + r * 0.72, r * 1.05, r * 0.45, 0, 0, TAU);
  g.fill();
  // Lunge streaks.
  if (lungeAge >= 0 && lungeAge < 420) {
    const q = lungeAge / 420;
    g.strokeStyle = rgba(ZOMBIE_SKIN, 0.55 * (1 - q));
    g.lineWidth = r * 0.25;
    g.lineCap = "round";
    for (let i = -1; i <= 1; i++) {
      const ox = Math.cos(a.face + Math.PI / 2) * i * r * 0.55;
      const oy = Math.sin(a.face + Math.PI / 2) * i * r * 0.55;
      g.beginPath();
      g.moveTo(x - Math.cos(a.face) * r * 1.1 + ox, y - Math.sin(a.face) * r * 1.1 + oy);
      g.lineTo(x - Math.cos(a.face) * r * (2.2 + (1 - q) * 1.4) + ox, y - Math.sin(a.face) * r * (2.2 + (1 - q) * 1.4) + oy);
      g.stroke();
    }
  }
  g.save();
  g.translate(x, y);
  g.rotate(a.face);
  // Arms reaching forward: the classic shamble.
  const reach = stunned ? 0.3 : 1 + (reduced ? 0 : Math.sin(now / 160 + b.slot) * 0.08);
  g.fillStyle = ZOMBIE_DARK;
  for (const side of [-1, 1]) {
    g.save();
    g.rotate(sway * side * 0.6);
    g.beginPath();
    g.roundRect(r * 0.2, side * r * 0.62 - r * 0.2, r * 1.15 * reach, r * 0.4, r * 0.2);
    g.fill();
    g.restore();
  }
  g.rotate(sway);
  // Body.
  g.fillStyle = ZOMBIE_SKIN;
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fill();
  g.lineWidth = Math.max(2, r * 0.24);
  g.strokeStyle = color;
  g.stroke();
  g.restore();
  g.font = `${Math.round(r * 1.25)}px ${EMOJI_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(stunned ? "😵" : "🧟", x, y + r * 0.05);
  if (original) {
    g.font = `${Math.round(r * 0.75)}px ${EMOJI_FONT}`;
    g.fillText("☣️", x + r * 0.85, y + r * 0.7);
  }
  if (stunned) {
    // Dizzy stars.
    const n = 3;
    for (let i = 0; i < n; i++) {
      const ang = (reduced ? 0 : now / 260) + (i * TAU) / n;
      g.font = `${Math.round(r * 0.6)}px ${EMOJI_FONT}`;
      g.fillText("⭐", x + Math.cos(ang) * r * 1.15, y - r * 1.05 + Math.sin(ang) * r * 0.35);
    }
  }
  return y;
}

function burst(sc: Scene, x: number, y: number, color: string, n: number, speed: number, now: number, dpr: number) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const v = (0.35 + Math.random() * 0.65) * speed * dpr;
    sc.sparks.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      t0: now,
      life: 450 + Math.random() * 450,
      color,
      size: (2 + Math.random() * 3) * dpr,
    });
  }
}

/** Fire the effects that playback just reached. */
function playFx(sc: Scene, S: Surface, d: ArenaData, fx: number[], now: number) {
  const [kind] = fx;
  const dpr = S.dpr;
  const reduced = d.reduced;
  if (kind === FX_BITE && fx.length >= 5) {
    const [, victim, biter, x, y] = fx;
    const sx = toSX(S, x, y);
    const sy = toSY(S, x, y);
    sc.rings.push({ x: sx, y: sy, r: 60 * S.s + 20 * dpr, t0: now, life: 650, color: ZOMBIE_SKIN });
    if (!reduced) burst(sc, sx, sy, "#a3e635", 26, 170, now, dpr);
    sc.floaters.push({ x: sx, y: sy, text: "INFECTED!", color: "#a3e635", t0: now });
    if (victim === d.mySlot) {
      sc.flash = { color: "#4d7c0f", t0: now, text: "🧟 You've been bitten!" };
      if (!reduced) sc.shake = { t0: now, amp: 9 * dpr };
    } else if (biter === d.mySlot) {
      sc.flash = { color: "#365314", t0: now, text: "" };
      if (!reduced) sc.shake = { t0: now, amp: 4 * dpr };
    }
  } else if (kind === FX_CURE && fx.length >= 5) {
    const [, cured, , x, y] = fx;
    const sx = toSX(S, x, y);
    const sy = toSY(S, x, y);
    sc.rings.push({ x: sx, y: sy, r: 70 * S.s + 20 * dpr, t0: now, life: 700, color: CURE_COLOR });
    if (!reduced) burst(sc, sx, sy, CURE_COLOR, 24, 150, now, dpr);
    sc.floaters.push({ x: sx, y: sy, text: "CURED! 💉", color: CURE_COLOR, t0: now });
    if (cured === d.mySlot) sc.flash = { color: "#0e7490", t0: now, text: "💉 You're human again!" };
  } else if (kind === FX_FLASH && fx.length >= 4) {
    const [, slot, x, y] = fx;
    if (slot === d.mySlot && now - sc.localFlashAt < 1_500) return; // already shown when you pressed it
    const sx = toSX(S, x, y);
    const sy = toSY(S, x, y);
    sc.rings.push({ x: sx, y: sy, r: FLASH_R * S.s, t0: now, life: 550, color: "#fffbe6" });
    const me = d.mySlot >= 0 ? sc.fl[d.mySlot] : 0;
    if (me & F_ZOMBIE) {
      const mx = sc.pos[d.mySlot * 2];
      const my = sc.pos[d.mySlot * 2 + 1];
      if (mx !== undefined && Math.hypot(mx - x, my - y) < FLASH_R) sc.flash = { color: "#fffbe6", t0: now, text: "😵 Blinded!" };
    }
  } else if (kind === FX_PICK && fx.length >= 3) {
    const [, slot, item] = fx;
    const x = sc.pos[slot * 2];
    const y = sc.pos[slot * 2 + 1];
    if (x === undefined) return;
    const sx = toSX(S, x, y);
    const sy = toSY(S, x, y);
    if (!reduced) burst(sc, sx, sy, item === ITEM_CURE ? CURE_COLOR : "#fde047", 12, 90, now, dpr);
    sc.floaters.push({ x: sx, y: sy, text: item === ITEM_CURE ? "+💉" : "+🔦", color: item === ITEM_CURE ? CURE_COLOR : "#fde047", t0: now });
  } else if (kind === FX_LUNGE && fx.length >= 2) {
    sc.lunges[fx[1]] = now;
  }
}

function drawScene(g: CanvasRenderingContext2D, sc: Scene, S: Surface, d: ArenaData, now: number) {
  const { view } = d;
  const map = mapOf(view.map);
  const { dpr, W, H } = S;
  const dt = sc.last < 0 ? 0 : Math.min(0.1, (now - sc.last) / 1000);
  sc.last = now;
  const rt = sc.clock.play(now, sc.frames);
  sc.rt = rt;
  const frames = sc.frames;
  while (frames.length > 2 && frames[1].t < rt - KEEP_MS) frames.shift();
  const reduced = d.reduced;

  if (sc.round !== view.round) {
    sc.round = view.round;
    sc.anim = [];
    sc.lunges = [];
    sc.rings = [];
    sc.floaters = [];
  }
  if (!sampleAll(frames, rt, sc.pos, sc.fl)) return;
  for (const f of frames) {
    if (f.t <= sc.fxCursor || f.t > rt) continue;
    sc.fxCursor = f.t;
    if (f.fx) for (const e of f.fx) if (Array.isArray(e)) playFx(sc, S, d, e, now);
  }

  // ----- you: predicted -----
  const me = sc.pred;
  const mine = d.mySlot;
  const latest = frames[frames.length - 1];
  const predicting = d.steer && mine >= 0 && latest.n === view.round && latest.xy.length > mine * 2 + 1;
  if (predicting) {
    const sxw = latest.xy[mine * 2];
    const syw = latest.xy[mine * 2 + 1];
    const lf = latest.fl[mine] ?? 0;
    const zombie = (lf & F_ZOMBIE) !== 0;
    if (!me.ready || me.round !== view.round || me.zombie !== zombie) {
      Object.assign(me, { x: sxw, y: syw, vx: 0, vy: 0, ready: true, round: view.round, zombie, acc: 0, at: now, stillMs: 0, farMs: 0, lungeUntil: 0 });
      sc.trail.clear();
    }
    const sdt = Math.min(100, Math.max(0, now - me.at));
    me.at = now;
    const frozen = (zombie && view.phase === "intro") || (lf & F_STUN) !== 0;
    me.acc += sdt;
    while (me.acc >= SUB_MS) {
      me.acc -= SUB_MS;
      const lunging = zombie && !frozen && now - me.acc < me.lungeUntil;
      stepPlayer(me, frozen ? 0 : sc.ix, frozen ? 0 : sc.iy, zombie, lunging ? [me.lx, me.ly] : null, frozen, SUB_MS / 1000, map);
    }
    // Reconcile with the server's copy of you.
    const prev = frames[frames.length - 2];
    const serverStill = !!prev && prev.n === latest.n && prev.xy[mine * 2] === sxw && prev.xy[mine * 2 + 1] === syw;
    const localStill = sc.ix === 0 && sc.iy === 0 && Math.hypot(me.vx, me.vy) < 1;
    me.stillMs = localStill || frozen ? me.stillMs + sdt : 0;
    // The server's copy is old by a jittery network trip (often 100-600 ms), so it's compared
    // with the path you actually walked, not with where you are now: latency isn't an error,
    // only being blocked, bitten or stunned on the server is, and that's eased out, not snapped.
    sc.trail.push(now, me.x, me.y);
    reconcile(me, sc.trail, sxw, syw, sdt, { ...RECONCILE, still: serverStill && me.stillMs > 120 }, sc.err);
    debugFrame("outbreak", { t: now, x: me.x + me.vx * (me.acc / 1000), y: me.y + me.vy * (me.acc / 1000), rt });
  } else {
    me.ready = false;
    sc.trail.clear();
  }

  // ----- background -----
  if (!S.bg || S.map !== view.map) {
    S.map = view.map;
    S.bg = renderBackground(S, map, view.map);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  let shx = 0;
  let shy = 0;
  if (sc.shake) {
    const q = (now - sc.shake.t0) / 380;
    if (q >= 1) sc.shake = null;
    else {
      const amp = sc.shake.amp * (1 - q);
      shx = (Math.random() * 2 - 1) * amp;
      shy = (Math.random() * 2 - 1) * amp;
    }
  }
  g.fillStyle = "#0b0d12";
  g.fillRect(0, 0, W, H);
  g.setTransform(1, 0, 0, 1, shx, shy);
  g.drawImage(S.bg, 0, 0);
  const k = S.s;

  // ----- items -----
  for (const [id, kind, x, y] of view.items) {
    const sx = toSX(S, x, y);
    const sy = toSY(S, x, y) - (reduced ? 0 : Math.sin(now / 300 + id) * 3 * dpr);
    const color = kind === ITEM_CURE ? CURE_COLOR : "#fde047";
    const R = Math.max(12 * dpr, 20 * k);
    const glow = g.createRadialGradient(sx, sy, 0, sx, sy, R * 1.4);
    glow.addColorStop(0, rgba(color, 0.55));
    glow.addColorStop(1, rgba(color, 0));
    g.fillStyle = glow;
    g.beginPath();
    g.arc(sx, sy, R * 1.4, 0, TAU);
    g.fill();
    g.font = `${Math.round(R * 1.05)}px ${EMOJI_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(kind === ITEM_CURE ? "💉" : "🔦", sx, sy);
  }

  // ----- bodies, back to front -----
  const n = Math.floor(sc.pos.length / 2);
  const list: Body[] = [];
  for (let i = 0; i < n; i++) {
    let x = sc.pos[i * 2];
    let y = sc.pos[i * 2 + 1];
    let fl = sc.fl[i] ?? 0;
    if (i === mine && predicting) {
      x = me.x + me.vx * (me.acc / 1000);
      y = me.y + me.vy * (me.acc / 1000);
      fl = latest.fl[i] ?? fl;
    }
    list.push({ slot: i, x, y, sx: toSX(S, x, y), sy: toSY(S, x, y), fl });
  }
  list.sort((a, b) => a.sy - b.sy);
  const rs = radS(S);
  const rz = radZ(S);
  const tagPx = Math.round(Math.max(9, Math.min(12, W / dpr / 60)) * dpr);
  const tags: (() => void)[] = [];
  const originals = new Set(view.originals);
  for (const b of list) {
    const a = (sc.anim[b.slot] ??= { face: 0, ph: 0, spd: 0, x: 0, y: 0, init: false });
    animate(a, b.sx, b.sy, dt, dpr);
    const color = d.colors[b.slot] ?? "#94a3b8";
    const zombie = (b.fl & F_ZOMBIE) !== 0;
    const off = (b.fl & F_OFF) !== 0;
    const r = zombie ? rz : rs;
    g.globalAlpha = off ? 0.45 : 1;
    if (b.slot === mine) {
      // Your marker: a pulsing ring on the floor.
      const p = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 220);
      g.strokeStyle = `rgba(255, 255, 255, ${0.55 + p * 0.4})`;
      g.lineWidth = 2.5 * dpr;
      g.beginPath();
      g.ellipse(b.sx, b.sy + r * 0.6, r * (1.5 + p * 0.15), r * (0.75 + p * 0.08), 0, 0, TAU);
      g.stroke();
    }
    const lungeAge = sc.lunges[b.slot] !== undefined ? now - sc.lunges[b.slot] : -1;
    const top = zombie
      ? drawZombie(g, b, a, r, color, now, reduced, lungeAge, originals.has(b.slot))
      : drawSurvivor(g, b, a, r, color, d.avatars[b.slot] ?? "🙂", now, reduced);
    if (!zombie && b.fl & (F_CURE | F_FLASH)) {
      g.font = `${Math.round(r * 0.85)}px ${EMOJI_FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      if (b.fl & F_CURE) g.fillText("💉", b.sx + r * 0.95, top - r * 0.6);
      if (b.fl & F_FLASH) g.fillText("🔦", b.sx - r * 0.95, top - r * 0.6);
    }
    g.globalAlpha = 1;
    const label = b.slot === mine ? "YOU" : (d.names[b.slot] ?? "?").slice(0, 9) + (off ? " 🔌" : "");
    const tx = b.sx;
    const ty = top - r - 3 * dpr;
    tags.push(() => drawTag(g, tx, ty, label, b.slot === mine ? "#ffffff" : zombie ? mixHex(color, ZOMBIE_SKIN, 0.55) : color, tagPx, off ? 0.6 : 0.95));
  }
  for (const t of tags) t();

  // ----- effects -----
  for (let i = sc.rings.length - 1; i >= 0; i--) {
    const ring = sc.rings[i];
    const q = (now - ring.t0) / ring.life;
    if (q >= 1) {
      sc.rings.splice(i, 1);
      continue;
    }
    g.strokeStyle = rgba(ring.color, 0.85 * (1 - q));
    g.lineWidth = (6 - 4 * q) * dpr;
    g.beginPath();
    g.arc(ring.x, ring.y, ring.r * easeOut(q), 0, TAU);
    g.stroke();
    if (ring.color === "#fffbe6") {
      g.fillStyle = rgba(ring.color, 0.35 * (1 - q));
      g.fill();
    }
  }
  for (let i = sc.sparks.length - 1; i >= 0; i--) {
    const p = sc.sparks[i];
    const age = now - p.t0;
    if (age > p.life) {
      sc.sparks.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 1 - dt * 3;
    p.vy *= 1 - dt * 3;
    g.globalAlpha = 1 - age / p.life;
    g.fillStyle = p.color;
    g.beginPath();
    g.arc(p.x, p.y, p.size, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  for (let i = sc.floaters.length - 1; i >= 0; i--) {
    const f = sc.floaters[i];
    const q = (now - f.t0) / 1_100;
    if (q >= 1) {
      sc.floaters.splice(i, 1);
      continue;
    }
    const px = Math.round(13 * dpr);
    g.font = `900 ${px}px ${SANS}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.globalAlpha = q < 0.75 ? 1 : 1 - (q - 0.75) / 0.25;
    g.lineWidth = 3 * dpr;
    g.strokeStyle = "rgba(0, 0, 0, 0.7)";
    const y = f.y - 22 * dpr - easeOut(q) * 22 * dpr;
    g.strokeText(f.text, f.x, y);
    g.fillStyle = f.color;
    g.fillText(f.text, f.x, y);
    g.globalAlpha = 1;
  }

  // ----- the stick -----
  if (sc.stick) {
    const st = sc.stick;
    const R = stickRadius(W / dpr) * dpr;
    const ox = st.ox * dpr;
    const oy = st.oy * dpr;
    let kx = st.kx * dpr - ox;
    let ky = st.ky * dpr - oy;
    const m = Math.hypot(kx, ky);
    if (m > R) [kx, ky] = [(kx / m) * R, (ky / m) * R];
    g.fillStyle = "rgba(255, 255, 255, 0.08)";
    g.strokeStyle = "rgba(255, 255, 255, 0.35)";
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.arc(ox, oy, R, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = "rgba(255, 255, 255, 0.55)";
    g.beginPath();
    g.arc(ox + kx, oy + ky, R * 0.42, 0, TAU);
    g.fill();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);

  // ----- heartbeat: a zombie is near you -----
  const myFl = mine >= 0 ? (predicting ? (latest.fl[mine] ?? 0) : (sc.fl[mine] ?? 0)) : F_ZOMBIE;
  if (mine >= 0 && view.phase === "play" && !(myFl & F_ZOMBIE)) {
    const mx = predicting ? me.x : sc.pos[mine * 2];
    const my = predicting ? me.y : sc.pos[mine * 2 + 1];
    let near = Infinity;
    for (let i = 0; i < n; i++) {
      if (i === mine || !((sc.fl[i] ?? 0) & F_ZOMBIE) || (sc.fl[i] ?? 0) & F_STUN) continue;
      near = Math.min(near, Math.hypot(sc.pos[i * 2] - mx, sc.pos[i * 2 + 1] - my));
    }
    const fear = clamp01((260 - near) / 200);
    if (fear > 0) {
      const rate = 1.1 + fear * 1.4; // beats per second
      const ph = ((now / 1000) * rate) % 1;
      const thump = reduced ? 0.5 : Math.max(Math.exp(-ph * 14), 0.7 * Math.exp(-Math.max(0, ph - 0.18) * 14) * (ph > 0.18 ? 1 : 0));
      const alpha = fear * (0.28 + 0.4 * thump);
      const grad = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.hypot(W, H) * 0.56);
      grad.addColorStop(0, "rgba(220, 38, 38, 0)");
      grad.addColorStop(1, `rgba(220, 38, 38, ${alpha})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }
  }

  // ----- screen flash (you were bitten, cured, blinded) -----
  if (sc.flash) {
    const q = (now - sc.flash.t0) / 1_300;
    if (q >= 1) sc.flash = null;
    else {
      g.fillStyle = rgba(sc.flash.color, 0.55 * (1 - easeOut(q)));
      g.fillRect(0, 0, W, H);
      if (sc.flash.text) {
        const px = Math.round(Math.max(18, Math.min(34, W / dpr / 14)) * dpr);
        g.font = `900 ${px}px ${SANS}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.globalAlpha = q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3;
        g.lineWidth = 5 * dpr;
        g.strokeStyle = "rgba(0, 0, 0, 0.75)";
        const y = H * 0.5 - (1 - easeOut(Math.min(1, q * 4))) * 20 * dpr;
        g.strokeText(sc.flash.text, W / 2, y);
        g.fillStyle = "#ffffff";
        g.fillText(sc.flash.text, W / 2, y);
        g.globalAlpha = 1;
      }
    }
  }
}

const stickRadius = (cssW: number) => Math.max(30, Math.min(52, cssW * 0.12));

function busy(sc: Scene) {
  return sc.sparks.length > 0 || sc.rings.length > 0 || sc.floaters.length > 0 || sc.flash !== null || sc.stick !== null;
}

// ---------- component ----------

export interface UseButton {
  /** "lunge" for zombies, "flash" for survivors (enabled only while carrying one). */
  kind: "lunge" | "flash";
  enabled: boolean;
}

export function ArenaView({
  data,
  onEvent,
  onSteer,
  onUse,
  use,
  hint,
  label,
  ringColor,
  children,
}: {
  data: ArenaData;
  onEvent: (fn: (e: unknown) => void) => () => void;
  /** Steering changed (world direction as ints in -100..100). */
  onSteer: (x: number, y: number) => void;
  onUse: () => void;
  use: UseButton | null;
  hint: ReactNode;
  label: string;
  ringColor: string;
  children?: ReactNode;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Scene>(newScene());
  const surface = useRef<Surface | null>(null);
  const [lunged, setLunged] = useState({ n: 0, ready: true });
  const [pressed, setPressed] = useState(false);
  const { view } = data;

  // ----- frames -----
  useEffect(() => {
    if (isSnap(view.snap)) pushFrame(scene.current, view.snap, performance.now());
  }, [view]);
  const onServerEvent = useEffectEvent((e: unknown) => {
    if (isSnap(e)) pushFrame(scene.current, e, performance.now());
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
    // Once the final scene has settled, stop redrawing.
    if (data.view.phase === "final" && !busy(sc) && sc.rt > data.view.snap.t + 2_000) {
      const key = `${S.W}x${S.H}|${data.reduced}|${data.view.snap.t}`;
      if (sc.stillKey === key) {
        sc.last = -1;
        return;
      }
      sc.stillKey = key;
    } else sc.stillKey = "";
    const g = canvas.getContext("2d");
    if (!g) return;
    drawScene(g, sc, S, data, now);
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
      if (Math.hypot(dx, dy) > 0.25) [x, y] = [dx, dy];
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
    // Predict with exactly what the server will apply.
    [sc.ix, sc.iy] = data.steer ? inputDir(ix, iy) : [0, 0];
    const key = `${ix},${iy}`;
    if (key === sc.sent) return;
    sc.sent = key;
    onSteer(ix, iy);
  };

  const lungeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (lungeTimer.current) clearTimeout(lungeTimer.current);
    },
    [],
  );
  const doUse = () => {
    if (!use?.enabled) return;
    const sc = scene.current;
    const now = performance.now();
    const S = surface.current;
    if (use.kind === "lunge") {
      if (!lunged.ready) return;
      // Lunge at once on your screen; the server does the same a moment later.
      const me = sc.pred;
      let [dx, dy] = [sc.ix, sc.iy];
      if (dx === 0 && dy === 0) {
        const m = Math.hypot(me.vx, me.vy);
        [dx, dy] = m > 1 ? [me.vx / m, me.vy / m] : [me.lx, me.ly];
      }
      me.lx = dx;
      me.ly = dy;
      me.lungeUntil = now + LUNGE_MS;
      if (data.mySlot >= 0) sc.lunges[data.mySlot] = now;
      setLunged((l) => ({ n: l.n + 1, ready: false }));
      if (lungeTimer.current) clearTimeout(lungeTimer.current);
      lungeTimer.current = setTimeout(() => setLunged((l) => ({ ...l, ready: true })), LUNGE_CD_MS);
    } else if (S && sc.pred.ready) {
      // Your flash goes off on your screen right away.
      sc.localFlashAt = now;
      const sx = toSX(S, sc.pred.x, sc.pred.y);
      const sy = toSY(S, sc.pred.x, sc.pred.y);
      sc.rings.push({ x: sx, y: sy, r: FLASH_R * S.s, t0: now, life: 550, color: "#fffbe6" });
      sc.flash = { color: "#fffbe6", t0: now - 600, text: "" };
    }
    onUse();
  };

  const onKey = useEffectEvent((e: KeyboardEvent, down: boolean) => {
    const sc = scene.current;
    const dir = KEY_DIR[e.code] ?? KEY_DIR[e.key];
    if (!down) {
      if (dir && sc.keys.delete(dir)) refreshInput();
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
    } else if ((e.code === "Space" || e.key === " " || e.key === "Shift") && !isButton(e.target) && use) {
      e.preventDefault();
      if (!e.repeat) doUse();
    }
  });
  const onLetGo = useEffectEvent(() => {
    const sc = scene.current;
    sc.keys.clear();
    sc.stick = null;
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
  // Losing the ability to steer (round over) drops whatever was held.
  const onSteerChange = useEffectEvent(() => refreshInput());
  useEffect(() => onSteerChange(), [data.steer]);

  // ----- pointer: drag anywhere on the arena = a floating stick -----
  const local = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const sc = scene.current;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (sc.stick || !data.steer) return;
    const [x, y] = local(e);
    sc.stick = { id: e.pointerId, ox: x, oy: y, kx: x, ky: y };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; dragging still works.
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const sc = scene.current;
    if (!sc.stick || sc.stick.id !== e.pointerId) return;
    const [x, y] = local(e);
    // The stick's base follows a finger that drags far past the rim.
    const R = stickRadius(e.currentTarget.clientWidth);
    const dx = x - sc.stick.ox;
    const dy = y - sc.stick.oy;
    const m = Math.hypot(dx, dy);
    if (m > R * 1.6) {
      sc.stick.ox = x - (dx / m) * R * 1.6;
      sc.stick.oy = y - (dy / m) * R * 1.6;
    }
    sc.stick.kx = x;
    sc.stick.ky = y;
    refreshInput();
  };
  const release = (e: PointerEvent<HTMLDivElement>) => {
    const sc = scene.current;
    if (!sc.stick || sc.stick.id !== e.pointerId) return;
    sc.stick = null;
    refreshInput();
  };

  const lungeReady = lunged.ready;
  const btnEnabled = !!use?.enabled && (use.kind !== "lunge" || lungeReady);

  return (
    <>
      <div
        ref={holderRef}
        className="ob-stage relative mx-auto w-full overflow-hidden rounded-2xl ring-2 transition-[box-shadow] duration-300 select-none"
        style={{ touchAction: data.steer ? "none" : "auto", ["--tw-ring-color" as string]: ringColor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <canvas ref={canvasRef} role="img" aria-label={label} className="absolute inset-0 h-full w-full" />
        {children}
      </div>
      {(use || hint) && (
        <div className="flex flex-wrap items-center gap-2">
          {use && (
            <button
              type="button"
              aria-keyshortcuts="Space"
              disabled={!btnEnabled}
              className={`btn relative h-12 min-w-32 shrink-0 touch-none overflow-hidden rounded-2xl px-4 text-base font-black tracking-wide shadow-lg shadow-black/30 select-none ${pressed ? "scale-95" : ""}`}
              style={
                btnEnabled
                  ? { borderColor: use.kind === "lunge" ? "#84cc16" : "#fde047", color: use.kind === "lunge" ? "#bef264" : "#fef08a" }
                  : undefined
              }
              onPointerDown={(e) => {
                e.preventDefault();
                setPressed(true);
                doUse();
              }}
              onPointerUp={() => setPressed(false)}
              onPointerCancel={() => setPressed(false)}
              onPointerLeave={() => setPressed(false)}
              onKeyDown={(e) => {
                if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                  e.preventDefault();
                  doUse();
                }
              }}
            >
              {use.kind === "lunge" && !lungeReady && (
                <span
                  key={lunged.n}
                  className="ob-cd absolute inset-y-0 left-0 bg-lime-400/20"
                  style={{ animationDuration: `${LUNGE_CD_MS}ms` }}
                  aria-hidden
                />
              )}
              <span className="relative">
                {use.kind === "lunge" ? (
                  <>
                    <span aria-hidden>🧟</span> {lungeReady ? "LUNGE" : "RECHARGING"}
                  </>
                ) : (
                  <>
                    <span aria-hidden>🔦</span> {use.enabled ? "FLASH" : "NO FLASH"}
                  </>
                )}
              </span>
            </button>
          )}
          <p className="min-w-0 flex-1 basis-40 text-xs text-muted">{hint}</p>
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
  return t instanceof HTMLElement && (t.tagName === "BUTTON" || t.tagName === "A" || t.getAttribute("role") === "button");
}

