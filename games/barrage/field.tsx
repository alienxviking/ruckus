"use client";

// Canvas renderer and slingshot input for Barrage.
//
// One requestAnimationFrame loop draws everything. During a volley the scene is a pure function of
// (server time - resolve.at), sampled from the replay timeline, so every screen shows the same
// shell in the same spot and a late joiner simply starts mid-flight. Static layers (sky, the ground
// after the craters so far) are cached in offscreen canvases and redrawn only when they change.

import { useEffect, useEffectEvent, useRef, type PointerEvent as RPointerEvent } from "react";
import type { Player } from "@/shared/types";
import type { BarrageView } from "./server";
import {
  BARREL,
  COL,
  COLS,
  DT,
  FIRE_MS,
  GRAVITY,
  H,
  MAX_POWER,
  MAX_STEPS,
  MAX_X,
  MIN_POWER,
  MIN_X,
  PIVOT_LIFT,
  W,
  clamp,
  decodeRuns,
  groundAt,
  launch,
  type Aim,
} from "./shared";
import {
  boomsBy,
  shellPos,
  shellTrail,
  stepMs,
  tankAlive,
  tankGround,
  tankHp,
  tankX,
  terrainAt,
  turretAngle,
  type Replay,
} from "./replay";
import { avatarText } from "@/shared/types";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const SANS = "ui-sans-serif, system-ui, sans-serif";
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const ACCENT = "#f59e0b";
const TRAIL_MS = 360;
/** Dirt and sparks fall faster than shells: it reads better. */
const DEBRIS_G = 700;

// ---------- small helpers ----------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgbCache = new Map<string, [number, number, number]>();
function rgb(hex: string): [number, number, number] {
  const hit = rgbCache.get(hex);
  if (hit) return hit;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x94a3b8;
  const out: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  rgbCache.set(hex, out);
  return out;
}
const rgba = (hex: string, a: number) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
/** Mix toward black (f > 0) or white (f < 0). */
function tint(hex: string, f: number) {
  const [r, g, b] = rgb(hex);
  const t = f >= 0 ? 0 : 255;
  const k = Math.abs(f);
  return `rgb(${Math.round(r + (t - r) * k)},${Math.round(g + (t - g) * k)},${Math.round(b + (t - b) * k)})`;
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

// ---------- cached layers ----------

interface Surface {
  /** Backing store size (device px). */
  W: number;
  H: number;
  dpr: number;
  /** Device px per world unit. */
  u: number;
  /** CSS width of the field. */
  css: number;
  /** Sprite scale: tanks are drawn at least ~18 css px wide on small screens. */
  sc: number;
  narrow: boolean;
  sky: HTMLCanvasElement;
  cloud: HTMLCanvasElement;
  terrain: HTMLCanvasElement;
  dirt: CanvasPattern | null;
}

function renderSky(Wp: number, Hp: number, u: number) {
  const c = makeCanvas(Wp, Hp);
  const g = c.getContext("2d");
  if (!g) return c;
  const sky = g.createLinearGradient(0, 0, 0, Hp);
  sky.addColorStop(0, "#0c0920");
  sky.addColorStop(0.36, "#221747");
  sky.addColorStop(0.66, "#4f2c68");
  sky.addColorStop(0.86, "#a24c63");
  sky.addColorStop(1, "#d9745c");
  g.fillStyle = sky;
  g.fillRect(0, 0, Wp, Hp);
  const r = rng(11);
  for (let i = 0; i < 80; i++) {
    const x = r() * Wp;
    const y = Math.pow(r(), 1.6) * Hp * 0.55;
    const a = (0.25 + r() * 0.65) * (1 - y / (Hp * 0.6));
    g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    const s = Math.max(1, (0.5 + r() * 1.3) * u * 1.4);
    g.fillRect(x, y, s, s);
  }
  // A low sun with a soft glow.
  // A warm glow low on the horizon, and a small moon high up where no tank ever sits.
  const glow = g.createRadialGradient(640 * u, 420 * u, 0, 640 * u, 420 * u, 420 * u);
  glow.addColorStop(0, "rgba(255,170,100,0.28)");
  glow.addColorStop(1, "rgba(255,150,90,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, Wp, Hp);
  const mx = 868 * u;
  const my = 74 * u;
  const halo = g.createRadialGradient(mx, my, 0, mx, my, 70 * u);
  halo.addColorStop(0, "rgba(255,236,200,0.22)");
  halo.addColorStop(1, "rgba(255,236,200,0)");
  g.fillStyle = halo;
  g.fillRect(mx - 70 * u, my - 70 * u, 140 * u, 140 * u);
  const disc = g.createRadialGradient(mx - 5 * u, my - 6 * u, 2 * u, mx, my, 22 * u);
  disc.addColorStop(0, "#fff8e6");
  disc.addColorStop(1, "#f5d9a8");
  g.fillStyle = disc;
  g.beginPath();
  g.arc(mx, my, 22 * u, 0, TAU);
  g.fill();
  g.fillStyle = "rgba(190,150,110,0.25)";
  for (const [cx, cy, cr] of [[-7, -4, 5], [6, 5, 4], [4, -9, 2.5]]) {
    g.beginPath();
    g.arc(mx + cx * u, my + cy * u, cr * u, 0, TAU);
    g.fill();
  }
  // Two layers of far mountains.
  const ridge = (base: number, amp: number, seed: number, color: string) => {
    const rr = rng(seed);
    const ph = [rr() * TAU, rr() * TAU, rr() * TAU];
    g.beginPath();
    g.moveTo(0, Hp);
    for (let x = 0; x <= W; x += 8) {
      const y =
        base +
        amp * (0.55 * Math.sin(x * 0.006 + ph[0]) + 0.3 * Math.sin(x * 0.017 + ph[1]) + 0.15 * Math.sin(x * 0.041 + ph[2]));
      g.lineTo(x * u, y * u);
    }
    g.lineTo(Wp, Hp);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };
  ridge(300, 60, 3, "rgba(58,37,96,0.92)");
  ridge(360, 48, 5, "rgba(40,27,72,0.96)");
  return c;
}

function renderCloud(u: number) {
  const w = 170 * u;
  const h = 64 * u;
  const c = makeCanvas(w, h);
  const g = c.getContext("2d");
  if (!g) return c;
  const blob = (x: number, y: number, rx: number, ry: number, a: number) => {
    const gr = g.createRadialGradient(x * u, y * u, 0, x * u, y * u, rx * u);
    gr.addColorStop(0, `rgba(240,228,255,${a})`);
    gr.addColorStop(1, "rgba(240,228,255,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(x * u, y * u, rx * u, ry * u, 0, 0, TAU);
    g.fill();
  };
  blob(52, 38, 44, 22, 0.16);
  blob(92, 30, 52, 28, 0.2);
  blob(128, 40, 38, 20, 0.14);
  blob(86, 44, 70, 16, 0.12);
  return c;
}

function renderDirt(dpr: number) {
  const size = Math.round(96 * dpr);
  const c = makeCanvas(size, size);
  const g = c.getContext("2d");
  if (!g) return c;
  const r = rng(29);
  for (let i = 0; i < 180; i++) {
    const s = (0.8 + r() * 1.8) * dpr;
    g.fillStyle = r() < 0.6 ? "rgba(20,8,2,0.22)" : "rgba(255,214,170,0.1)";
    g.fillRect(r() * size, r() * size, s, s);
  }
  for (let i = 0; i < 10; i++) {
    g.fillStyle = "rgba(255,220,190,0.07)";
    g.beginPath();
    g.ellipse(r() * size, r() * size, (2 + r() * 3) * dpr, (1.2 + r() * 1.5) * dpr, r() * 3, 0, TAU);
    g.fill();
  }
  return c;
}

function surfacePath(g: CanvasRenderingContext2D, t: ArrayLike<number>, u: number, dy: number, c0 = 0, c1 = COLS - 1) {
  g.beginPath();
  for (let c = c0; c <= c1; c++) {
    const x = c * COL * u;
    const y = (t[c] + dy) * u;
    if (c === c0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
}

function renderTerrain(s: Surface, t: ArrayLike<number>, burnt: ArrayLike<number>) {
  const g = s.terrain.getContext("2d");
  if (!g) return;
  const { W: Wp, H: Hp, u, dpr } = s;
  g.clearRect(0, 0, Wp, Hp);
  g.save();
  g.beginPath();
  g.moveTo(0, Hp);
  for (let c = 0; c < COLS; c++) g.lineTo(c * COL * u, t[c] * u);
  g.lineTo(Wp, Hp);
  g.closePath();
  const dirt = g.createLinearGradient(0, 170 * u, 0, Hp);
  dirt.addColorStop(0, "#a06a43");
  dirt.addColorStop(0.45, "#714429");
  dirt.addColorStop(1, "#3a2115");
  g.fillStyle = dirt;
  g.fill();
  g.clip();
  if (s.dirt) {
    g.fillStyle = s.dirt;
    g.fillRect(0, 0, Wp, Hp);
  }
  g.lineJoin = "round";
  // Soil layers that follow the hills.
  surfacePath(g, t, u, 13);
  g.strokeStyle = "rgba(38,18,8,0.32)";
  g.lineWidth = 16 * u;
  g.stroke();
  surfacePath(g, t, u, 42);
  g.strokeStyle = "rgba(255,206,160,0.06)";
  g.lineWidth = 7 * u;
  g.stroke();
  surfacePath(g, t, u, 70);
  g.strokeStyle = "rgba(20,8,4,0.18)";
  g.lineWidth = 12 * u;
  g.stroke();
  // The abyss: the ground fades into darkness at the bottom.
  const ab = g.createLinearGradient(0, 470 * u, 0, Hp);
  ab.addColorStop(0, "rgba(10,6,22,0)");
  ab.addColorStop(1, "rgba(10,6,22,0.95)");
  g.fillStyle = ab;
  g.fillRect(0, 470 * u, Wp, Hp - 470 * u);
  g.restore();
  // Grass where the ground is untouched, charred dirt where it's been blown up.
  g.lineCap = "round";
  g.lineJoin = "round";
  let c = 0;
  while (c < COLS) {
    const b = burnt[c] === 1;
    let e = c;
    while (e + 1 < COLS && (burnt[e + 1] === 1) === b) e++;
    const c0 = Math.max(0, c - 1);
    const c1 = Math.min(COLS - 1, e + (e + 1 < COLS ? 1 : 0));
    if (b) {
      // Scorched crater lip: dark char with a hot, lighter edge so craters read against the hills.
      surfacePath(g, t, u, 1.2, c0, c1);
      g.strokeStyle = "#2a160d";
      g.lineWidth = Math.max(2.2 * dpr, 5 * u);
      g.stroke();
      surfacePath(g, t, u, -0.6, c0, c1);
      g.strokeStyle = "rgba(255,170,110,0.55)";
      g.lineWidth = Math.max(0.9 * dpr, 1.4 * u);
      g.stroke();
    } else {
      surfacePath(g, t, u, 0.6, c0, c1);
      g.strokeStyle = "#2f8f4c";
      g.lineWidth = Math.max(2.4 * dpr, 5.5 * u);
      g.stroke();
      surfacePath(g, t, u, -0.8, c0, c1);
      g.strokeStyle = "#7ee29a";
      g.lineWidth = Math.max(1 * dpr, 1.8 * u);
      g.stroke();
    }
    c = e + 1;
  }
}

// ---------- explosion effects (precomputed per volley, drawn as functions of time) ----------

interface Bit {
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  color: string;
}

interface Blast {
  ms: number;
  x: number;
  y: number;
  r: number;
  /** Screen shake strength in css px. */
  kick: number;
  dirt: Bit[];
  sparks: Bit[];
  smoke: Bit[];
}

const DIRT_COLORS = ["#8a5a36", "#6b4127", "#a8754b", "#4f2f1d", "#3f8f52"];

function makeBlast(seed: number, ms: number, x: number, y: number, r: number, kind: string): Blast {
  const rand = rng(seed);
  const big = kind === "heavy" || kind === "kill";
  const nd = kind === "heavy" ? 26 : kind === "bomb" ? 9 : kind === "kill" ? 16 : 16;
  const ns = kind === "heavy" ? 18 : kind === "bomb" ? 7 : 12;
  const nk = kind === "heavy" ? 7 : kind === "bomb" ? 3 : 5;
  const speed = big ? 1.3 : kind === "bomb" ? 0.8 : 1;
  const dirt: Bit[] = [];
  for (let i = 0; i < nd; i++) {
    const a = -Math.PI * (0.08 + rand() * 0.84);
    const v = (110 + rand() * 260) * speed;
    dirt.push({
      ox: (rand() - 0.5) * r * 0.5,
      oy: (rand() - 0.5) * r * 0.3,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      size: 1.6 + rand() * 2.6,
      life: 0.8 + rand() * 0.6,
      color: DIRT_COLORS[Math.floor(rand() * (kind === "kill" ? 4 : DIRT_COLORS.length))],
    });
  }
  const sparks: Bit[] = [];
  for (let i = 0; i < ns; i++) {
    const a = rand() * TAU;
    const v = (200 + rand() * 380) * speed;
    sparks.push({ ox: 0, oy: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, size: 1, life: 0.3 + rand() * 0.35, color: "" });
  }
  const smoke: Bit[] = [];
  for (let i = 0; i < nk; i++) {
    smoke.push({
      ox: (rand() - 0.5) * r * 0.9,
      oy: (rand() - 0.6) * r * 0.5,
      vx: (rand() - 0.5) * 24,
      vy: -(18 + rand() * 30),
      size: r * (0.35 + rand() * 0.3),
      life: 1.3 + rand() * 0.8,
      color: "",
    });
  }
  const kick = kind === "heavy" ? 11 : kind === "kill" ? 8 : kind === "bomb" ? 2.5 : 5;
  return { ms, x, y, r, kick, dirt, sparks, smoke };
}

function blastsFor(rp: Replay): Blast[] {
  const out: Blast[] = rp.r.booms.map((b, i) => makeBlast(rp.r.at + i * 7919, rp.boomMs[i], b.x, b.y, b.r, b.w));
  for (const d of rp.r.deaths) {
    if (d.why !== "hp") continue;
    const ms = stepMs(d.t);
    const x = rp.x1[d.s];
    const gy = groundAt(rp.snaps[boomsBy(rp, ms)], x);
    out.push(makeBlast(rp.r.at + d.s * 104729 + 17, ms + 160, x, gy - 9, 30, "kill"));
  }
  return out;
}

function drawBlast(g: CanvasRenderingContext2D, b: Blast, age: number, ground: ArrayLike<number>) {
  const t = age / 1000;
  // Smoke first: it sits behind the fire.
  for (const p of b.smoke) {
    const st = t - 0.08;
    if (st <= 0 || st >= p.life) continue;
    const k = st / p.life;
    const x = b.x + p.ox + p.vx * st;
    const y = b.y + p.oy + p.vy * st;
    const rad = p.size * (0.6 + 0.9 * easeOut(k));
    g.fillStyle = `rgba(52,44,66,${(0.4 * (1 - k)).toFixed(3)})`;
    g.beginPath();
    g.arc(x, y, rad, 0, TAU);
    g.fill();
  }
  g.globalCompositeOperation = "lighter";
  if (age < 650) {
    const grow = easeOut(age / 120);
    const fade = 1 - age / 650;
    const R = b.r * (0.3 + 0.8 * grow);
    const gr = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, R);
    gr.addColorStop(0, `rgba(255,250,228,${(0.95 * fade).toFixed(3)})`);
    gr.addColorStop(0.35, `rgba(255,208,110,${(0.85 * fade).toFixed(3)})`);
    gr.addColorStop(0.7, `rgba(255,100,48,${(0.5 * fade).toFixed(3)})`);
    gr.addColorStop(1, "rgba(255,80,40,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(b.x, b.y, R, 0, TAU);
    g.fill();
  }
  for (const p of b.sparks) {
    if (t >= p.life) continue;
    const x = b.x + p.vx * t;
    const y = b.y + p.vy * t + 0.5 * 350 * t * t;
    const a = 1 - t / p.life;
    g.strokeStyle = `rgba(255,214,120,${a.toFixed(3)})`;
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - p.vx * 0.03, y - (p.vy + 350 * t) * 0.03);
    g.stroke();
  }
  g.globalCompositeOperation = "source-over";
  if (age < 420) {
    const k = age / 420;
    g.strokeStyle = `rgba(255,236,200,${(0.65 * (1 - k)).toFixed(3)})`;
    g.lineWidth = 3.5 * (1 - k) + 0.3;
    g.beginPath();
    g.arc(b.x, b.y, b.r * (0.5 + 1.1 * easeOut(k)), 0, TAU);
    g.stroke();
  }
  for (const p of b.dirt) {
    if (t >= p.life) continue;
    const x = b.x + p.ox + p.vx * t;
    let y = b.y + p.oy + p.vy * t + 0.5 * DEBRIS_G * t * t;
    const floor = groundAt(ground, clamp(x, 0, W));
    let a = Math.min(1, 1.6 * (1 - t / p.life));
    if (y > floor && p.vy + DEBRIS_G * t > 0) {
      y = floor;
      a *= 0.6;
    }
    g.globalAlpha = a;
    g.fillStyle = p.color;
    g.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
  }
  g.globalAlpha = 1;
}

// ---------- tanks ----------

interface TankDraw {
  slot: number;
  id: string;
  x: number;
  gy: number;
  ang: number;
  hp: number;
  alive: boolean;
  wreck: boolean;
  alpha: number;
  recoil: number;
  color: string;
  mine: boolean;
  locked: boolean;
  offline: boolean;
  crown: boolean;
}

function tiltAt(t: ArrayLike<number>, x: number) {
  return clamp(Math.atan2(groundAt(t, x + 9) - groundAt(t, x - 9), 18), -0.55, 0.55);
}

function pivotOf(x: number, gy: number, tilt: number, sc: number): [number, number] {
  return [x + PIVOT_LIFT * sc * Math.sin(tilt), gy - PIVOT_LIFT * sc * Math.cos(tilt)];
}

function drawTank(g: CanvasRenderingContext2D, d: TankDraw, tilt: number, sc: number) {
  const dark = d.wreck ? "#120f17" : tint(d.color, 0.55);
  const [px, py] = pivotOf(d.x, d.gy, tilt, sc);
  const a = d.wreck ? (d.ang > 90 ? 196 : -16) * DEG : d.ang * DEG;
  const len = (BARREL - d.recoil) * sc;
  g.globalAlpha = d.alpha;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(px + Math.cos(a) * len, py - Math.sin(a) * len);
  g.strokeStyle = dark;
  g.lineWidth = 4.4 * sc;
  g.stroke();
  g.strokeStyle = d.wreck ? "#37323f" : "#ece8ff";
  g.lineWidth = 2.1 * sc;
  g.stroke();

  g.save();
  g.translate(d.x, d.gy);
  g.rotate(tilt);
  g.scale(sc, sc);
  roundRect(g, -13.5, -6.2, 27, 6.6, 3.2);
  g.fillStyle = d.wreck ? "#141119" : "#1b1630";
  g.fill();
  g.fillStyle = d.wreck ? "#2a2531" : "#40385f";
  for (const wx of [-9, -3, 3, 9]) {
    g.beginPath();
    g.arc(wx, -2.9, 2, 0, TAU);
    g.fill();
  }
  g.beginPath();
  g.moveTo(-12.2, -5.6);
  g.lineTo(12.2, -5.6);
  g.lineTo(9, -11.6);
  g.lineTo(-9, -11.6);
  g.closePath();
  g.fillStyle = d.wreck ? "#2d2834" : d.color;
  g.fill();
  g.lineWidth = 1.1;
  g.strokeStyle = dark;
  g.stroke();
  g.beginPath();
  g.arc(0, -11.4, 5.9, Math.PI, 0);
  g.closePath();
  g.fillStyle = d.wreck ? "#25212c" : tint(d.color, -0.28);
  g.fill();
  g.stroke();
  if (!d.wreck) {
    g.strokeStyle = "rgba(255,255,255,0.4)";
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(-7.6, -10.3);
    g.lineTo(7.6, -10.3);
    g.stroke();
  }
  g.restore();
  g.globalAlpha = 1;
}

/** Wisps of smoke curling up from a wreck. */
function drawWreckSmoke(g: CanvasRenderingContext2D, x: number, gy: number, sc: number, now: number, seed: number, still: boolean) {
  for (let k = 0; k < 3; k++) {
    const ph = still ? 0.35 + k * 0.22 : (now / 2200 + k / 3 + seed * 0.37) % 1;
    const y = gy - 14 * sc - ph * 46;
    const xx = x + Math.sin(ph * 4 + seed) * 6;
    g.fillStyle = `rgba(64,58,78,${(0.32 * (1 - ph)).toFixed(3)})`;
    g.beginPath();
    g.arc(xx, y, (4 + ph * 10) * Math.min(1.6, sc), 0, TAU);
    g.fill();
  }
}

// ---------- the preview arc ----------

/** First ~30% of the shot's path, without wind. */
function previewArc(t: ArrayLike<number>, x: number, angle: number, power: number): number[] {
  const L = launch(t, x, angle, power);
  let px = L.x;
  let py = L.y;
  let vy = L.vy;
  const vx = L.vx;
  const pts = [px, py];
  for (let k = 1; k <= MAX_STEPS; k++) {
    vy += GRAVITY * DT;
    px += vx * DT;
    py += vy * DT;
    pts.push(px, py);
    if (px < 0 || px > W || py > H || py >= groundAt(t, px)) break;
  }
  // About the first 30% of the flight (but always enough to read the direction).
  const n = pts.length / 2;
  const keep = Math.min(n, Math.max(Math.ceil(n * 0.3), 22));
  return pts.slice(0, keep * 2);
}

// ---------- the component ----------

interface Drag {
  id: number;
  /** Anchor and pointer, css px relative to the field. */
  ax: number;
  ay: number;
  px: number;
  py: number;
  moved: boolean;
  fromTank: boolean;
}

interface Scene {
  blastKey: string;
  blasts: Blast[];
  terrainKey: string;
  buf: Float32Array;
  staticSrc: number[] | null;
  staticBurnt: number[];
  staticId: number;
  cloudOff: number;
  lastT: number;
  drag: Drag | null;
  previewKey: string;
  preview: number[];
  trail: number[];
  /** Your tank on screen (css px), for grabbing the slingshot. */
  my: { x: number; y: number } | null;
}

function newScene(): Scene {
  return {
    blastKey: "",
    blasts: [],
    terrainKey: "",
    buf: new Float32Array(COLS),
    staticSrc: null,
    staticBurnt: new Array<number>(COLS).fill(0),
    staticId: 0,
    cloudOff: 0,
    lastT: 0,
    drag: null,
    previewKey: "",
    preview: [],
    trail: new Array<number>(1024).fill(0),
    my: null,
  };
}

const CLOUDS = [
  [80, 70, 1.1, 0.6],
  [330, 40, 0.8, 0.9],
  [560, 95, 1.25, 0.5],
  [790, 55, 0.9, 0.75],
  [1010, 120, 0.7, 1],
  [1180, 30, 1, 0.65],
];

export interface FieldProps {
  view: BarrageView;
  rp: Replay | null;
  me: string;
  colors: Record<string, string>;
  byId: Record<string, Player>;
  /** Your current aim (live while you drag), or null when you have no shot this turn. */
  aim: Aim | null;
  /** You can aim right now (alive, AIM phase, not locked). */
  aiming: boolean;
  /** Show the "drag to aim" hint. */
  hint: boolean;
  onAim: (patch: { angle: number; power: number }) => void;
  reduced: boolean;
  serverNow: () => number;
  label: string;
  ring: string;
}

const fullPull = (css: number) => clamp(css * 0.3, 110, 260);

export function Field(props: FieldProps) {
  const { aiming, onAim, label, ring } = props;
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surface = useRef<Surface | null>(null);
  const scene = useRef<Scene>(newScene());

  // Backing store matches the element (crisp at any devicePixelRatio).
  useEffect(() => {
    const holder = holderRef.current;
    const canvas = canvasRef.current;
    if (!holder || !canvas) return;
    const fit = () => {
      const r = holder.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
      const Wp = Math.round(r.width * dpr);
      const Hp = Math.round(r.height * dpr);
      const cur = surface.current;
      if (cur && cur.W === Wp && cur.H === Hp && cur.dpr === dpr) return;
      canvas.width = Wp;
      canvas.height = Hp;
      const u = Wp / W;
      const dirtTile = renderDirt(dpr);
      const g = canvas.getContext("2d");
      surface.current = {
        W: Wp,
        H: Hp,
        dpr,
        u,
        css: r.width,
        sc: Math.max(1, (21 * dpr) / (27 * u)),
        narrow: r.width < 520,
        sky: renderSky(Wp, Hp, u),
        cloud: renderCloud(u),
        terrain: makeCanvas(Wp, Hp),
        dirt: g ? g.createPattern(dirtTile, "repeat") : null,
      };
      scene.current.terrainKey = "";
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

  const paint = useEffectEvent((now: number) => {
    const canvas = canvasRef.current;
    const s = surface.current;
    if (!canvas || !s) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    draw(g, s, scene.current, props, now);
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
        scene.current.lastT = 0;
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

  // ----- slingshot -----
  const local = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!aiming || (e.pointerType === "mouse" && e.button !== 0)) return;
    const [x, y] = local(e);
    const my = scene.current.my;
    const s = surface.current;
    const grab = Math.max(40, s ? (22 * s.sc * s.u) / s.dpr : 40);
    const fromTank = !!my && Math.hypot(x - my.x, y - my.y) < grab;
    scene.current.drag = {
      id: e.pointerId,
      ax: fromTank && my ? my.x : x,
      ay: fromTank && my ? my.y : y,
      px: x,
      py: y,
      moved: false,
      fromTank,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't always be captured; dragging still works inside the field.
    }
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = scene.current.drag;
    if (!d || d.id !== e.pointerId) return;
    const [x, y] = local(e);
    d.px = x;
    d.py = y;
    const vx = x - d.ax;
    const vy = y - d.ay;
    const len = Math.hypot(vx, vy);
    if (!d.moved && len < 8) return;
    d.moved = true;
    if (len < 3 || !aiming) return;
    let ang = Math.atan2(vy, -vx) / DEG;
    if (ang < 0) ang = ang < -90 ? 180 : 0;
    const full = fullPull(e.currentTarget.getBoundingClientRect().width);
    const power = clamp(
      Math.round(MIN_POWER + (Math.min(len, full) / full) * (MAX_POWER - MIN_POWER)),
      MIN_POWER,
      MAX_POWER,
    );
    onAim({ angle: clamp(Math.round(ang), 0, 180), power });
  };
  const endDrag = (e: RPointerEvent<HTMLDivElement>) => {
    const d = scene.current.drag;
    if (d && d.id === e.pointerId) scene.current.drag = null;
  };

  return (
    <div
      ref={holderRef}
      className="relative mx-auto w-full overflow-hidden rounded-xl ring-2 transition-[box-shadow] duration-300 select-none"
      style={{
        aspectRatio: `${W} / ${H}`,
        maxWidth: `calc(62vh * ${W} / ${H})`,
        touchAction: aiming ? "none" : "auto",
        cursor: aiming ? "crosshair" : "default",
        ["--tw-ring-color" as string]: ring,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <canvas ref={canvasRef} role="img" aria-label={label} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

// ---------- drawing a frame ----------

function draw(g: CanvasRenderingContext2D, s: Surface, sc: Scene, p: FieldProps, now: number) {
  const { view, rp, me, colors, byId, aim, aiming, reduced } = p;
  const { u, dpr } = s;
  const dt = sc.lastT ? Math.min(0.1, (now - sc.lastT) / 1000) : 0;
  sc.lastT = now;
  const wind = rp ? rp.r.wind : view.wind;
  sc.cloudOff += dt * wind * (reduced ? 1.5 : 4);
  const e = rp ? p.serverNow() - rp.r.at : 0;

  // ----- ground -----
  let tKey: string;
  let burnt: ArrayLike<number>;
  if (rp) {
    tKey = terrainAt(rp, e, sc.buf);
    burnt = rp.burnt[boomsBy(rp, e)];
  } else {
    if (sc.staticSrc !== view.terrain) {
      sc.staticSrc = view.terrain;
      sc.staticBurnt = decodeRuns(view.burnt);
      sc.staticId += 1;
    }
    for (let c = 0; c < COLS; c++) sc.buf[c] = view.terrain[c] ?? H;
    tKey = `v${sc.staticId}`;
    burnt = sc.staticBurnt;
  }
  if (tKey !== sc.terrainKey) {
    renderTerrain(s, sc.buf, burnt);
    sc.terrainKey = tKey;
  }
  const ground = sc.buf;

  if (rp && sc.blastKey !== rp.key) {
    sc.blastKey = rp.key;
    sc.blasts = blastsFor(rp);
  }

  // ----- camera shake -----
  let ox = 0;
  let oy = 0;
  let flash = 0;
  if (rp) {
    let amp = 0;
    for (const b of sc.blasts) {
      const age = e - b.ms;
      if (age < 0 || age > 480) continue;
      amp += b.kick * Math.pow(1 - age / 480, 2);
      if (age < 110) flash += (b.r / 34) * 0.1 * (1 - age / 110);
    }
    if (!reduced && amp > 0) {
      amp = Math.min(14, amp) * dpr;
      ox = Math.sin(e * 0.093 + 1.3) * amp;
      oy = Math.cos(e * 0.117) * amp * 0.7;
    }
  }

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(s.sky, 0, 0);

  // Clouds drift with the wind.
  const span = W + 400;
  for (const [cx, cy, size, depth] of CLOUDS) {
    let x = (cx + sc.cloudOff * depth) % span;
    if (x < 0) x += span;
    x -= 200;
    const w = s.cloud.width * size;
    const h = s.cloud.height * size;
    g.globalAlpha = 0.5 + depth * 0.5;
    g.drawImage(s.cloud, x * u - w / 2, cy * u - h / 2, w, h);
  }
  g.globalAlpha = 1;

  g.drawImage(s.terrain, ox, oy);
  g.setTransform(u, 0, 0, u, ox, oy);

  // ----- tanks -----
  const tanks: TankDraw[] = [];
  view.tanks.forEach((t, i) => {
    const color = colors[t.id] ?? "#94a3b8";
    const offline = byId[t.id]?.connected === false;
    const crown = view.phase === "final" && !!view.final?.winners.includes(t.id) && t.alive;
    if (rp) {
      if (!rp.alive0[i]) {
        if (t.why === "hp") {
          const x = rp.x0[i];
          tanks.push(base(i, t.id, x, groundAt(ground, x), rp.ang0[i], 0, false, true, color, offline, false));
        }
        return;
      }
      const x = tankX(rp, i, e);
      const gy = tankGround(rp, i, e);
      const alive = tankAlive(rp, i, e);
      const d = rp.death[i];
      const dead = !alive && d;
      if (dead && d.why === "abyss" && gy > H + 30) return;
      const fireAge = e - FIRE_MS;
      const td = base(i, t.id, x, gy, turretAngle(rp, i, e), tankHp(rp, i, e), alive, !!dead && d.why === "hp", color, offline, false);
      if (rp.fired[i] !== null && fireAge >= 0 && fireAge < 240) td.recoil = 5 * (1 - fireAge / 240);
      if (dead && d.why === "abyss") td.alpha = clamp(1 - (gy - 540) / 60, 0, 1);
      tanks.push(td);
      return;
    }
    if (!t.alive && t.why !== "hp") return;
    const ang = t.id === me && aim && t.alive ? aim.angle : t.angle;
    const td = base(i, t.id, t.x, groundAt(ground, t.x), ang, t.hp, t.alive, !t.alive, color, offline, crown);
    td.locked = view.phase === "aim" && t.locked;
    tanks.push(td);
  });
  for (const d of tanks) d.mine = d.id === me;
  tanks.sort((a, b) => Number(a.alive) - Number(b.alive) || Number(a.mine) - Number(b.mine));

  for (const d of tanks) {
    if (!d.wreck) continue;
    drawTank(g, d, tiltAt(ground, d.x), s.sc);
    drawWreckSmoke(g, d.x, d.gy, s.sc, now, d.slot, reduced);
  }

  // Your move: a ghost tank where you'll drive to, then the preview arc from there.
  const mineT = view.tanks.find((t) => t.id === me);
  if (aim && mineT?.alive && view.phase === "aim" && !rp) {
    const color = colors[me] ?? "#fff";
    const dest = clamp(mineT.x + aim.move, MIN_X, MAX_X);
    if (dest !== mineT.x) {
      const gy0 = groundAt(ground, mineT.x) - 4;
      const gy1 = groundAt(ground, dest) - 4;
      g.setLineDash([4, 4]);
      g.strokeStyle = rgba(color, 0.7);
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(mineT.x, gy0);
      g.lineTo(dest, gy1);
      g.stroke();
      g.setLineDash([]);
      const ghost = base(-1, me, dest, groundAt(ground, dest), aim.angle, 0, true, false, color, false, false);
      ghost.alpha = 0.38;
      drawTank(g, ghost, tiltAt(ground, dest), s.sc);
    }
    if (aiming) {
      const key = `${dest}|${aim.angle}|${aim.power}|${tKey}`;
      if (key !== sc.previewKey) {
        sc.previewKey = key;
        sc.preview = previewArc(ground, dest, aim.angle, aim.power);
      }
      const pts = sc.preview;
      const n = pts.length >> 1;
      for (let k = 2; k < n; k += 3) {
        const a = 0.95 - (k / n) * 0.7;
        g.beginPath();
        g.arc(pts[2 * k], pts[2 * k + 1], (2.3 * dpr) / u, 0, TAU);
        g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        g.fill();
        g.strokeStyle = `rgba(14,12,29,${(a * 0.6).toFixed(3)})`;
        g.lineWidth = (1 * dpr) / u;
        g.stroke();
      }
    }
  }

  for (const d of tanks) if (!d.wreck) drawTank(g, d, tiltAt(ground, d.x), s.sc);

  // ----- the volley -----
  if (rp) {
    // Muzzle flashes.
    const fa = e - FIRE_MS;
    if (fa >= 0 && fa < 170) {
      g.globalCompositeOperation = "lighter";
      for (const d of tanks) {
        if (rp.fired[d.slot] === null) continue;
        const [px, py] = pivotOf(d.x, d.gy, tiltAt(ground, d.x), s.sc);
        const a = d.ang * DEG;
        const mx = px + Math.cos(a) * BARREL * s.sc;
        const my = py - Math.sin(a) * BARREL * s.sc;
        const k = 1 - fa / 170;
        const R = (8 + 10 * (1 - k)) * Math.min(1.6, s.sc);
        const gr = g.createRadialGradient(mx, my, 0, mx, my, R);
        gr.addColorStop(0, `rgba(255,248,220,${k})`);
        gr.addColorStop(0.5, `rgba(255,190,90,${0.7 * k})`);
        gr.addColorStop(1, "rgba(255,120,40,0)");
        g.fillStyle = gr;
        g.beginPath();
        g.arc(mx, my, R, 0, TAU);
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
    }

    // Shells and their trails.
    const pos = [0, 0];
    const shells = rp.r.shells;
    for (let i = 0; i < shells.length; i++) {
      const sh = shells[i];
      if (e < rp.shellT0[i] || e >= rp.shellT1[i] + TRAIL_MS) continue;
      const color = colors[view.tanks[sh.s]?.id] ?? ACCENT;
      const len = shellTrail(rp, i, e - TRAIL_MS, Math.min(e, rp.shellT1[i] - 0.01), sc.trail);
      if (len >= 4) {
        const tx = sc.trail[0];
        const ty = sc.trail[1];
        const hx = sc.trail[len - 2];
        const hy = sc.trail[len - 1];
        const grad = g.createLinearGradient(tx, ty, hx, hy);
        grad.addColorStop(0, rgba(color, 0));
        grad.addColorStop(1, rgba(color, 0.75));
        g.beginPath();
        g.moveTo(tx, ty);
        for (let k = 2; k < len; k += 2) g.lineTo(sc.trail[k], sc.trail[k + 1]);
        g.lineCap = "round";
        g.lineJoin = "round";
        g.strokeStyle = grad;
        g.lineWidth = (sh.w === "heavy" ? 5 : 3.4) * (dpr / u) * 0.9;
        g.stroke();
        const core = g.createLinearGradient(tx, ty, hx, hy);
        core.addColorStop(0, "rgba(255,255,255,0)");
        core.addColorStop(1, "rgba(255,255,255,0.85)");
        g.strokeStyle = core;
        g.lineWidth = (1.3 * dpr) / u;
        g.stroke();
      }
      if (!shellPos(rp, i, e, pos)) continue;
      const rad = ((sh.w === "heavy" ? 4.6 : sh.w === "bomb" ? 2.4 : 3.2) * dpr) / u;
      if (pos[1] < -rad) {
        // Above the top edge: a marker so you can still follow it.
        g.fillStyle = color;
        const mx = clamp(pos[0], 6, W - 6);
        const m = (5 * dpr) / u;
        g.beginPath();
        g.moveTo(mx, 2 / u + 0.5);
        g.lineTo(mx - m, 2 / u + m * 1.4);
        g.lineTo(mx + m, 2 / u + m * 1.4);
        g.closePath();
        g.fill();
        continue;
      }
      g.globalCompositeOperation = "lighter";
      const glow = g.createRadialGradient(pos[0], pos[1], 0, pos[0], pos[1], rad * 3.2);
      glow.addColorStop(0, rgba(color, 0.9));
      glow.addColorStop(1, rgba(color, 0));
      g.fillStyle = glow;
      g.beginPath();
      g.arc(pos[0], pos[1], rad * 3.2, 0, TAU);
      g.fill();
      g.globalCompositeOperation = "source-over";
      g.fillStyle = "#fffaf0";
      g.beginPath();
      g.arc(pos[0], pos[1], rad, 0, TAU);
      g.fill();
    }
    // Splitters pop at the top of their arc.
    for (let i = 0; i < shells.length; i++) {
      const sh = shells[i];
      if (sh.e !== "s") continue;
      const age = e - rp.shellT1[i];
      if (age < 0 || age > 300) continue;
      const k = age / 300;
      const m = sh.p.length;
      g.strokeStyle = `rgba(255,240,180,${(0.9 * (1 - k)).toFixed(3)})`;
      g.lineWidth = (2 * dpr) / u;
      g.beginPath();
      g.arc(sh.p[m - 2], sh.p[m - 1], 4 + 16 * easeOut(k), 0, TAU);
      g.stroke();
    }
    for (const b of sc.blasts) {
      const age = e - b.ms;
      if (age < 0 || age > 2300) continue;
      drawBlast(g, b, age, ground);
    }
  }

  // ----- screen-space overlays -----
  g.setTransform(1, 0, 0, 1, ox, oy);
  if (flash > 0 && !reduced) {
    g.fillStyle = `rgba(255,236,210,${Math.min(0.22, flash).toFixed(3)})`;
    g.fillRect(-ox, -oy, s.W, s.H);
  }

  drawLabels(g, s, tanks, byId, view.phase === "aim" && !rp, now, reduced);

  // Remember where your tank is (css px) for grabbing the slingshot.
  const myDraw = tanks.find((d) => d.mine && d.alive);
  sc.my = myDraw ? { x: (myDraw.x * u) / dpr, y: ((myDraw.gy - 8 * s.sc) * u) / dpr } : null;

  if (aiming && myDraw) {
    const drag = sc.drag && sc.drag.moved ? sc.drag : null;
    const [pvx, pvy] = pivotOf(myDraw.x, myDraw.gy, tiltAt(ground, myDraw.x), s.sc);
    const px = pvx * u;
    const py = pvy * u;
    if (drag && aim) {
      // The rubber band: pulled back away from the shot, longer = more power.
      const full = fullPull(s.css) * dpr;
      const k = (aim.power - MIN_POWER) / (MAX_POWER - MIN_POWER);
      const a = aim.angle * DEG;
      const bx = px - Math.cos(a) * full * (0.12 + 0.88 * k);
      const by = py + Math.sin(a) * full * (0.12 + 0.88 * k);
      g.strokeStyle = "rgba(245,158,11,0.9)";
      g.lineWidth = 2.2 * dpr;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(px - 6 * dpr * Math.sin(a), py - 6 * dpr * Math.cos(a));
      g.lineTo(bx, by);
      g.lineTo(px + 6 * dpr * Math.sin(a), py + 6 * dpr * Math.cos(a));
      g.stroke();
      g.fillStyle = "#fff7e6";
      g.strokeStyle = ACCENT;
      g.lineWidth = 2 * dpr;
      g.beginPath();
      g.arc(bx, by, 6 * dpr, 0, TAU);
      g.fill();
      g.stroke();
      g.font = `800 ${Math.round(12 * dpr)}px ${SANS}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const lx = clamp(bx, 30 * dpr, s.W - 30 * dpr);
      const ly = clamp(by + (by > py ? 16 : -16) * dpr, 10 * dpr, s.H - 10 * dpr);
      pill(g, `${aim.angle}° · ${aim.power}`, lx, ly, dpr, "rgba(14,12,29,0.8)", "#fff7e6");
    } else if (p.hint) {
      const bob = reduced ? 0 : Math.sin(now / 260) * 2 * dpr;
      const ring = (18 + (reduced ? 0 : (now / 40) % 14)) * dpr;
      g.strokeStyle = `rgba(245,158,11,${reduced ? 0.6 : (0.8 * (1 - ((now / 40) % 14) / 14)).toFixed(3)})`;
      g.lineWidth = 2 * dpr;
      g.beginPath();
      g.arc(px, py, ring, 0, TAU);
      g.stroke();
      g.font = `700 ${Math.round(11 * dpr)}px ${SANS}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const hy = myDraw.gy * u + 22 * dpr + bob;
      pill(
        g,
        s.narrow ? "drag back to aim" : "drag back from your tank to aim",
        clamp(px, 80 * dpr, s.W - 80 * dpr),
        Math.min(hy, s.H - 12 * dpr),
        dpr,
        "rgba(14,12,29,0.82)",
        "#fde68a",
      );
    }
  }

  if (rp) drawDamage(g, s, rp, e, tanks);

  // "FIRE!" as the volley launches.
  if (rp) {
    const k = (e - FIRE_MS + 120) / 900;
    if (k > 0 && k < 1) {
      const scale = reduced ? 1 : 0.7 + 0.45 * easeOut(Math.min(1, k * 4));
      g.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      g.font = `900 ${Math.round(Math.min(46, s.css * 0.075) * dpr * scale)}px ${SANS}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineJoin = "round";
      g.strokeStyle = "rgba(14,12,29,0.85)";
      g.lineWidth = 6 * dpr;
      g.strokeText("FIRE!", s.W / 2 - ox, s.H * 0.24 - oy);
      g.fillStyle = "#fde68a";
      g.fillText("FIRE!", s.W / 2 - ox, s.H * 0.24 - oy);
      g.globalAlpha = 1;
    }
  }

  // Wind gauge (stays put while the screen shakes).
  g.setTransform(1, 0, 0, 1, 0, 0);
  drawWind(g, s, wind);
}

function base(
  slot: number,
  id: string,
  x: number,
  gy: number,
  ang: number,
  hp: number,
  alive: boolean,
  wreck: boolean,
  color: string,
  offline: boolean,
  crown: boolean,
): TankDraw {
  return { slot, id, x, gy, ang, hp, alive, wreck, alpha: offline && alive ? 0.55 : 1, recoil: 0, color, mine: false, locked: false, offline, crown };
}

function pill(g: CanvasRenderingContext2D, text: string, x: number, y: number, dpr: number, bg: string, fg: string) {
  const w = g.measureText(text).width + 12 * dpr;
  const h = 18 * dpr;
  g.fillStyle = bg;
  roundRect(g, x - w / 2, y - h / 2, w, h, h / 2);
  g.fill();
  g.fillStyle = fg;
  g.fillText(text, x, y + 0.5 * dpr);
}

function shortName(name: string) {
  return name.length > 9 ? `${name.slice(0, 8)}…` : name;
}

function hpColor(hp: number) {
  return hp > 60 ? "#4ade80" : hp > 30 ? "#fbbf24" : "#f87171";
}

function drawLabels(
  g: CanvasRenderingContext2D,
  s: Surface,
  tanks: TankDraw[],
  byId: Record<string, Player>,
  aimPhase: boolean,
  now: number,
  reduced: boolean,
) {
  const { u, dpr, narrow } = s;
  const font = narrow ? `${Math.round(12 * dpr)}px ${SANS}, ${EMOJI}` : `700 ${Math.round(11 * dpr)}px ${SANS}, ${EMOJI}`;
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const barW = (narrow ? 22 : 34) * dpr;
  const barH = 4 * dpr;
  // Stagger names that would overlap.
  const items = tanks
    .filter((d) => d.alpha > 0.05 && d.slot >= 0)
    .map((d) => {
      const pl = byId[d.id];
      const text = pl ? (narrow ? avatarText(pl.avatar) : `${avatarText(pl.avatar)} ${shortName(pl.name)}`) : "?";
      const w = g.measureText(text).width + (d.mine ? 12 : 4) * dpr;
      const x = clamp(d.x * u, w / 2 + 2 * dpr, s.W - w / 2 - 2 * dpr);
      const top = (d.gy - 26 * s.sc) * u;
      return { d, text, w, x, top, row: 0 };
    })
    .sort((a, b) => a.x - b.x);
  const lastEnd = [-Infinity, -Infinity, -Infinity];
  for (const it of items) {
    let row = 0;
    while (row < 2 && it.x - it.w / 2 < lastEnd[row] + 3 * dpr) row++;
    it.row = row;
    lastEnd[row] = Math.max(lastEnd[row], it.x + it.w / 2);
  }
  for (const it of items) {
    const { d } = it;
    const barX = clamp(d.x * u, barW / 2 + 2 * dpr, s.W - barW / 2 - 2 * dpr);
    const barY = Math.max(it.top - 4 * dpr, (narrow ? 22 : 24) * dpr);
    g.globalAlpha = d.alive ? Math.max(0.5, d.alpha) : 0.6;
    if (d.alive) {
      g.fillStyle = "rgba(14,12,29,0.8)";
      roundRect(g, barX - barW / 2 - dpr, barY - barH / 2 - dpr, barW + 2 * dpr, barH + 2 * dpr, 2 * dpr);
      g.fill();
      g.fillStyle = hpColor(d.hp);
      roundRect(g, barX - barW / 2, barY - barH / 2, (barW * clamp(d.hp, 0, 100)) / 100, barH, 1.5 * dpr);
      g.fill();
    }
    const ny = barY - (narrow ? 11 : 11) * dpr - it.row * 15 * dpr;
    if (d.mine && d.alive) {
      g.fillStyle = d.color;
      roundRect(g, it.x - it.w / 2, ny - 8 * dpr, it.w, 16 * dpr, 8 * dpr);
      g.fill();
      g.fillStyle = "#0e0c1d";
      g.fillText(it.text, it.x, ny + 0.5 * dpr);
    } else {
      g.lineJoin = "round";
      g.lineWidth = 3 * dpr;
      g.strokeStyle = "rgba(14,12,29,0.85)";
      g.strokeText(it.text, it.x, ny);
      g.fillStyle = d.alive ? d.color : "#a39dc8";
      g.fillText(it.text, it.x, ny);
    }
    if (aimPhase && d.alive && (d.locked || d.offline)) {
      const bx = barX + barW / 2 + 7 * dpr;
      g.fillStyle = d.locked ? "#22c55e" : "#64748b";
      g.beginPath();
      g.arc(bx, barY, 5.5 * dpr, 0, TAU);
      g.fill();
      g.strokeStyle = "#0e0c1d";
      g.lineWidth = 1.6 * dpr;
      g.beginPath();
      if (d.locked) {
        g.moveTo(bx - 2.6 * dpr, barY);
        g.lineTo(bx - 0.6 * dpr, barY + 2 * dpr);
        g.lineTo(bx + 2.8 * dpr, barY - 2.2 * dpr);
      } else {
        g.moveTo(bx - 2.5 * dpr, barY);
        g.lineTo(bx + 2.5 * dpr, barY);
      }
      g.stroke();
    }
    if (d.crown) {
      const bob = reduced ? 0 : Math.sin(now / 300) * 2.5 * dpr;
      g.font = `${Math.round(18 * dpr)}px ${EMOJI}`;
      g.fillText("👑", it.x, ny - 17 * dpr + bob);
      g.font = font;
    }
  }
  g.globalAlpha = 1;
}

function drawDamage(g: CanvasRenderingContext2D, s: Surface, rp: Replay, e: number, tanks: TankDraw[]) {
  const { u, dpr } = s;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  const where = (slot: number) => tanks.find((d) => d.slot === slot);
  // Hits per tank, newest first: the newest number sits lowest, older ones have already floated up.
  const hits = new Map<number, { dmg: number; age: number }[]>();
  for (let bi = rp.r.booms.length - 1; bi >= 0; bi--) {
    const age = e - rp.boomMs[bi];
    if (age < 0 || age > 1500) continue;
    const d = rp.r.booms[bi].d;
    for (let k = 0; k + 1 < d.length; k += 2) {
      const list = hits.get(d[k]) ?? [];
      list.push({ dmg: d[k + 1], age });
      hits.set(d[k], list);
    }
  }
  for (const [slot, list] of hits) {
    const d = where(slot);
    if (!d) continue;
    const x = clamp(d.x * u, 24 * dpr, s.W - 24 * dpr);
    const base = (Math.min(d.gy, H) - 34 * s.sc) * u - 16 * dpr;
    let lift = 0;
    for (const { dmg, age } of list) {
      const pop = age < 160 ? 1.35 - 0.35 * (age / 160) : 1;
      const size = (dmg >= 30 ? 19 : dmg >= 15 ? 16 : 13) * dpr;
      const rise = (age / 1500) * 26 * dpr;
      const y = Math.max(14 * dpr, base - Math.max(lift, rise));
      lift = Math.max(lift, rise) + size * 0.95;
      g.globalAlpha = age < 1100 ? 1 : 1 - (age - 1100) / 400;
      g.font = `900 ${Math.round(size * pop)}px ${SANS}`;
      g.strokeStyle = "rgba(60,0,10,0.9)";
      g.lineWidth = 4 * dpr;
      g.strokeText(`-${dmg}`, x, y);
      g.fillStyle = dmg >= 30 ? "#ffe066" : "#ffffff";
      g.fillText(`-${dmg}`, x, y);
    }
  }
  // Knock-outs get a tag under the wreck (or where it dropped out of sight).
  for (const dd of rp.r.deaths) {
    const age = e - stepMs(dd.t) - 150;
    if (age < 0 || age > 1800) continue;
    const d = where(dd.s);
    const x = clamp((d ? d.x : rp.x1[dd.s]) * u, 50 * dpr, s.W - 50 * dpr);
    const gy = dd.why === "abyss" ? H : d ? d.gy : H;
    const y = Math.min(s.H - 12 * dpr, gy * u + 16 * dpr) - (age / 1800) * 8 * dpr;
    const k = Math.min(1, age / 140);
    g.globalAlpha = (age < 1400 ? 1 : 1 - (age - 1400) / 400) * k;
    g.font = `900 ${Math.round(12 * dpr)}px ${SANS}`;
    pill(g, dd.why === "abyss" ? "💀 into the abyss" : "💀 KO", x, y, dpr, "rgba(153,27,27,0.92)", "#fff");
  }
  g.globalAlpha = 1;
}

function drawWind(g: CanvasRenderingContext2D, s: Surface, wind: number) {
  const { dpr } = s;
  const cx = s.W / 2;
  const cy = 15 * dpr;
  const w = 124 * dpr;
  const h = 22 * dpr;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  g.fillStyle = "rgba(14,12,29,0.6)";
  roundRect(g, x0, cy - h / 2, w, h, h / 2);
  g.fill();
  g.font = `800 ${Math.round(10 * dpr)}px ${SANS}`;
  g.textBaseline = "middle";
  if (wind === 0) {
    g.textAlign = "center";
    g.fillStyle = "#a39dc8";
    g.fillText("WIND · CALM", cx, cy + 0.5 * dpr);
    return;
  }
  g.textAlign = "left";
  g.fillStyle = "#a39dc8";
  g.fillText("WIND", x0 + 10 * dpr, cy + 0.5 * dpr);
  const strength = Math.abs(wind);
  const dir = Math.sign(wind);
  const color = strength >= 7 ? "#f87171" : strength >= 4 ? "#fbbf24" : "#86efac";
  // The arrow lives between the label and the number; longer = stronger.
  const left = x0 + 48 * dpr;
  const right = x1 - 26 * dpr;
  const mid = (left + right) / 2;
  const len = Math.min(right - left, (10 + (strength / 10) * 30) * dpr);
  const ax0 = mid - (dir * len) / 2;
  const ax1 = mid + (dir * len) / 2;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 2.6 * dpr;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(ax0, cy);
  g.lineTo(ax1 - dir * 4 * dpr, cy);
  g.stroke();
  g.beginPath();
  g.moveTo(ax1, cy);
  g.lineTo(ax1 - dir * 6 * dpr, cy - 4.5 * dpr);
  g.lineTo(ax1 - dir * 6 * dpr, cy + 4.5 * dpr);
  g.closePath();
  g.fill();
  g.textAlign = "center";
  g.fillStyle = "#fff";
  g.fillText(String(strength), x1 - 14 * dpr, cy + 0.5 * dpr);
}
