"use client";

// Canvas renderer and slingshot input for Putt Panic.
//
// One requestAnimationFrame loop draws everything. During a roll the scene is a pure function of
// (server time - roll.at), sampled from the replay timeline, so every screen shows the same ball
// in the same spot and a late joiner simply starts mid-roll. The static course (rough, felt,
// hazards, rails, bumpers) is cached in an offscreen canvas and redrawn only on resize or a new hole.

import { useEffect, useEffectEvent, useRef, type PointerEvent as RPointerEvent } from "react";
import type { Player } from "@/shared/types";
import type { PuttView } from "./server";
import {
  BALL_R,
  BLADE_T,
  BOOST_L,
  BOOST_W,
  CIRCLE,
  CUP_R,
  H,
  HUB_R,
  MAX_POWER,
  MAX_ROLL,
  PORTAL_R,
  RECT,
  REVEAL_MS,
  W,
  WALL_T,
  angleRad,
  clamp,
  inShape,
  millAngle,
  railSegments,
  type Hole,
  type Shape,
} from "./shared";
import { ballAt, DROP_MS, strokesAt, type BallPose, type Replay } from "./replay";
import { drawAvatar } from "@/lib/avatar-art";
import { buzz, feedback, sfx } from "@/lib/feedback";

const TAU = Math.PI * 2;
const SANS = "ui-sans-serif, system-ui, sans-serif";
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const PORTAL_COLORS = ["#c084fc", "#fb923c", "#22d3ee"];
const PORTAL_GLYPHS = ["◆", "●", "▲"];
const TRAIL_STEPS = 12;
const TRAIL_GAP = 18;

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

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
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

const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

function shapePath(g: CanvasRenderingContext2D, s: Shape, u: number) {
  g.beginPath();
  addShape(g, s, u);
}

/** Add a shape to the current path (as its own closed sub-path). */
function addShape(g: CanvasRenderingContext2D, s: Shape, u: number) {
  if (s.length === CIRCLE) {
    g.moveTo((s[0] + s[2]) * u, s[1] * u);
    g.arc(s[0] * u, s[1] * u, s[2] * u, 0, TAU);
  } else if (s.length === RECT) g.rect(s[0] * u, s[1] * u, s[2] * u, s[3] * u);
  else {
    g.moveTo(s[0] * u, s[1] * u);
    for (let i = 2; i < s.length; i += 2) g.lineTo(s[i] * u, s[i + 1] * u);
    g.closePath();
  }
}

function greenPath(g: CanvasRenderingContext2D, hole: Hole, u: number) {
  g.beginPath();
  for (const p of hole.green) {
    g.moveTo(p[0] * u, p[1] * u);
    for (let i = 2; i < p.length; i += 2) g.lineTo(p[i] * u, p[i + 1] * u);
    g.closePath();
  }
}

function distToSegs(segs: number[][], x: number, y: number) {
  let best = Infinity;
  for (const [ax, ay, bx, by] of segs) {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0;
    best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
  }
  return best;
}

function inAnyGreen(hole: Hole, x: number, y: number) {
  return hole.green.some((p) => inShape(p, x, y));
}

// ---------- the static course ----------

interface Surface {
  W: number;
  H: number;
  dpr: number;
  /** Device px per world unit. */
  u: number;
  css: number;
  /** Ball radius on screen (device px): never smaller than ~4.5 css px. */
  br: number;
  narrow: boolean;
  /**
   * Portrait: the course is turned 90 degrees so its long axis runs down the screen (tee at the
   * bottom, world +x pointing up). Geometry is drawn through a rotated transform; text never rotates.
   */
  portrait: boolean;
  /** The static course, always rendered landscape (W x H world units at u). */
  base: HTMLCanvasElement;
  baseKey: string;
}

/** Screen position (device px) of a world point. */
const SX = (s: Surface, wx: number, wy: number) => (s.portrait ? wy * s.u : wx * s.u);
const SY = (s: Surface, wx: number, wy: number) => (s.portrait ? (W - wx) * s.u : wy * s.u);

/** Draw in world units x u (landscape orientation); in portrait the context turns it upright. */
function worldT(g: CanvasRenderingContext2D, s: Surface) {
  if (s.portrait) g.setTransform(0, -1, 1, 0, 0, s.H);
  else g.setTransform(1, 0, 0, 1, 0, 0);
}
/** Draw in plain screen pixels (text, labels, anything that must stay upright). */
function screenT(g: CanvasRenderingContext2D) {
  g.setTransform(1, 0, 0, 1, 0, 0);
}

/** A screen-space drag vector (css px) as a world direction. */
export const screenToWorldDir = (portrait: boolean, vx: number, vy: number): [number, number] =>
  portrait ? [-vy, vx] : [vx, vy];

function renderBase(s: Surface, hole: Hole) {
  const c = s.base;
  const g = c.getContext("2d");
  if (!g) return;
  const { u } = s;
  const Wp = c.width;
  const Hp = c.height;
  const rand = rng(hash(hole.id));
  g.clearRect(0, 0, Wp, Hp);

  // Rough: deep grass with a mottled texture.
  const rough = g.createLinearGradient(0, 0, Wp, Hp);
  rough.addColorStop(0, "#164a2c");
  rough.addColorStop(1, "#0f3a22");
  g.fillStyle = rough;
  g.fillRect(0, 0, Wp, Hp);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rand() < 0.5 ? "rgba(0,0,0,0.12)" : "rgba(120,200,120,0.07)";
    const r = (3 + rand() * 9) * u;
    g.beginPath();
    g.ellipse(rand() * Wp, rand() * Hp, r, r * 0.6, rand() * 3, 0, TAU);
    g.fill();
  }

  const edges = hole.green.flatMap((p) => {
    const out: number[][] = [];
    const n = p.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      out.push([p[2 * i], p[2 * i + 1], p[2 * j], p[2 * j + 1]]);
    }
    return out;
  });

  // Trees, bushes and flowers out in the rough.
  const trees: number[][] = [];
  for (let gy = 0; gy < 9; gy++) {
    for (let gx = 0; gx < 15; gx++) {
      const x = (gx + 0.15 + rand() * 0.7) * (W / 15);
      const y = (gy + 0.15 + rand() * 0.7) * (H / 9);
      const r = 16 + rand() * 18;
      if (inAnyGreen(hole, x, y) || distToSegs(edges, x, y) < r + 10) continue;
      if (rand() < 0.3) continue;
      trees.push([x, y, r, rand()]);
    }
  }
  for (const [x, y, r] of trees) {
    g.fillStyle = "rgba(0,0,0,0.28)";
    g.beginPath();
    g.ellipse((x + r * 0.25) * u, (y + r * 0.3) * u, r * u, r * 0.85 * u, 0, 0, TAU);
    g.fill();
  }
  for (const [x, y, r, k] of trees) {
    if (r < 22) {
      // A lumpy bush, sometimes with a sprinkle of flowers.
      for (let i = 0; i < 3; i++) {
        const a = k * 7 + i * 2.1;
        const bx = x + Math.cos(a) * r * 0.32;
        const by = y + Math.sin(a) * r * 0.32;
        const bush = g.createRadialGradient((bx - r * 0.2) * u, (by - r * 0.25) * u, 0, bx * u, by * u, r * 0.6 * u);
        bush.addColorStop(0, "#3d9650");
        bush.addColorStop(1, "#1d5a2f");
        g.fillStyle = bush;
        g.beginPath();
        g.arc(bx * u, by * u, r * 0.6 * u, 0, TAU);
        g.fill();
      }
      if (k < 0.45) {
        g.fillStyle = k < 0.15 ? "#fde68a" : k < 0.3 ? "#f9a8d4" : "#e9d5ff";
        for (let i = 0; i < 3; i++) {
          const a = k * 31 + i * 2.4;
          g.beginPath();
          g.arc((x + Math.cos(a) * r * 0.5) * u, (y + Math.sin(a) * r * 0.45) * u, Math.max(0.8, 1.6 * u), 0, TAU);
          g.fill();
        }
      }
      continue;
    }
    // A round tree canopy in three tones.
    const can = g.createRadialGradient((x - r * 0.35) * u, (y - r * 0.4) * u, r * 0.1 * u, x * u, y * u, r * u);
    can.addColorStop(0, "#4caf5a");
    can.addColorStop(0.65, "#2a7a3e");
    can.addColorStop(1, "#18532a");
    g.fillStyle = can;
    g.beginPath();
    g.arc(x * u, y * u, r * u, 0, TAU);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.beginPath();
    g.arc((x - r * 0.3) * u, (y - r * 0.3) * u, r * 0.45 * u, 0, TAU);
    g.fill();
  }

  // The felt, with mowing stripes and a soft shade along the rails.
  const felt = () => {
    g.fillStyle = "#3aaa58";
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = "rgba(255,255,255,0.045)";
    for (let x = -H; x < W + H; x += 64) {
      g.beginPath();
      g.moveTo(x * u, 0);
      g.lineTo((x + 32) * u, 0);
      g.lineTo((x + 32 - H * 0.6) * u, Hp);
      g.lineTo((x - H * 0.6) * u, Hp);
      g.closePath();
      g.fill();
    }
    const fr = rng(hash(hole.id) + 77);
    for (let i = 0; i < 380; i++) {
      g.fillStyle = fr() < 0.5 ? "rgba(0,40,10,0.06)" : "rgba(255,255,255,0.04)";
      g.fillRect(fr() * Wp, fr() * Hp, Math.max(1, 1.6 * u), Math.max(1, 1.6 * u));
    }
    g.restore();
  };
  g.save();
  greenPath(g, hole, u);
  felt();
  greenPath(g, hole, u);
  g.clip();

  // Mounds and bowls: light and contour rings.
  for (const [x, y, r, gg] of hole.hills ?? []) {
    const up = gg > 0;
    const hl = g.createRadialGradient((x - r * 0.25) * u, (y - r * 0.3) * u, 0, x * u, y * u, r * u);
    hl.addColorStop(0, up ? "rgba(255,255,220,0.2)" : "rgba(0,30,10,0.22)");
    hl.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = hl;
    g.beginPath();
    g.arc(x * u, y * u, r * u, 0, TAU);
    g.fill();
    g.strokeStyle = up ? "rgba(255,255,230,0.13)" : "rgba(0,30,10,0.18)";
    g.lineWidth = Math.max(1, 1.5 * u);
    for (const f of [0.35, 0.68, 1]) {
      g.beginPath();
      g.arc(x * u, y * u, r * f * u, 0, TAU);
      g.stroke();
    }
  }

  // Sand bunkers.
  for (const sd of hole.sand ?? []) {
    shapePath(g, sd, u);
    g.fillStyle = "#e9d49b";
    g.fill();
    g.save();
    g.clip();
    for (let i = 0; i < 70; i++) {
      const bx = sd.length === CIRCLE ? sd[0] - sd[2] + rand() * sd[2] * 2 : sd[0] + rand() * (sd[2] ?? 0);
      const by = sd.length === CIRCLE ? sd[1] - sd[2] + rand() * sd[2] * 2 : sd[1] + rand() * (sd[3] ?? 0);
      g.fillStyle = rand() < 0.5 ? "rgba(150,110,50,0.25)" : "rgba(255,255,240,0.4)";
      g.fillRect(bx * u, by * u, Math.max(1, 1.8 * u), Math.max(1, 1.8 * u));
    }
    g.lineWidth = 7 * u;
    g.strokeStyle = "rgba(160,120,60,0.25)";
    shapePath(g, sd, u);
    g.stroke();
    g.restore();
  }

  // Water, then the dry land (bridges, islands) laid back over it.
  for (const wt of hole.water ?? []) {
    shapePath(g, wt, u);
    const wg = g.createLinearGradient(0, 0, 0, Hp);
    wg.addColorStop(0, "#2a9ee8");
    wg.addColorStop(1, "#1670b8");
    g.fillStyle = wg;
    g.fill();
  }
  if (hole.water?.length) {
    for (const d of hole.dry ?? []) {
      shapePath(g, d, u);
      felt();
    }
    // Depth: darker water toward the shore, then foam where water meets felt.
    for (const wt of hole.water ?? []) {
      g.save();
      shapePath(g, wt, u);
      g.clip();
      g.strokeStyle = "rgba(4,40,90,0.35)";
      g.lineWidth = 18 * u;
      shapePath(g, wt, u);
      g.stroke();
      for (const d of hole.dry ?? []) {
        shapePath(g, d, u);
        g.stroke();
      }
      g.strokeStyle = "rgba(200,240,255,0.75)";
      g.lineWidth = 4 * u;
      shapePath(g, wt, u);
      g.stroke();
      for (const d of hole.dry ?? []) {
        shapePath(g, d, u);
        g.stroke();
      }
      g.restore();
    }
  }

  // Boost pads (the chevrons glow on the live layer).
  for (const [x, y, deg] of hole.boosts ?? []) {
    g.save();
    g.translate(x * u, y * u);
    g.rotate((deg * Math.PI) / 180);
    const w = BOOST_L * u;
    const h = BOOST_W * u;
    g.fillStyle = "rgba(15,23,42,0.82)";
    g.strokeStyle = "rgba(253,224,71,0.7)";
    g.lineWidth = Math.max(1, 2 * u);
    g.beginPath();
    g.roundRect(-w / 2, -h / 2, w, h, 8 * u);
    g.fill();
    g.stroke();
    g.restore();
  }

  // Windmill reach: a faint dashed ring so you can see where the sails sweep.
  for (const m of hole.mills ?? []) {
    g.setLineDash([6 * u, 7 * u]);
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.lineWidth = Math.max(1, 1.6 * u);
    g.beginPath();
    g.arc(m[0] * u, m[1] * u, (m[2] + BALL_R) * u, 0, TAU);
    g.stroke();
    g.setLineDash([]);
  }

  // Inner shade along the rails.
  g.lineJoin = "round";
  greenPath(g, hole, u);
  g.strokeStyle = "rgba(0,30,10,0.22)";
  g.lineWidth = 26 * u;
  g.stroke();
  g.restore();

  // Portal wells.
  (hole.portals ?? []).forEach((p, i) => {
    const col = PORTAL_COLORS[i % PORTAL_COLORS.length];
    for (const [x, y] of [
      [p[0], p[1]],
      [p[2], p[3]],
    ]) {
      const wg = g.createRadialGradient(x * u, y * u, 0, x * u, y * u, (PORTAL_R + 6) * u);
      wg.addColorStop(0, "#05030f");
      wg.addColorStop(0.7, rgba(col, 0.55));
      wg.addColorStop(1, rgba(col, 0));
      g.fillStyle = wg;
      g.beginPath();
      g.arc(x * u, y * u, (PORTAL_R + 6) * u, 0, TAU);
      g.fill();
    }
  });

  // The cup.
  const [cx, cy] = hole.cup;
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.beginPath();
  g.arc(cx * u, cy * u, (CUP_R + 1.6) * u, 0, TAU);
  g.fill();
  const cg = g.createRadialGradient((cx + 3) * u, (cy + 3) * u, 0, cx * u, cy * u, CUP_R * u);
  cg.addColorStop(0, "#020403");
  cg.addColorStop(0.75, "#0b1a10");
  cg.addColorStop(1, "#1f3b28");
  g.fillStyle = cg;
  g.beginPath();
  g.arc(cx * u, cy * u, CUP_R * u, 0, TAU);
  g.fill();

  // Rails: drop shadow, dark edge, wood, highlight.
  const segs = railSegments(hole);
  const stroke = (w: number, color: string, dx = 0, dy = 0) => {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.beginPath();
    for (const [ax, ay, bx, by] of segs) {
      g.moveTo((ax + dx) * u, (ay + dy) * u);
      g.lineTo((bx + dx) * u, (by + dy) * u);
    }
    g.stroke();
  };
  g.lineCap = "round";
  g.lineJoin = "round";
  stroke(WALL_T * u, "rgba(0,0,0,0.32)", 2.5, 3.5);
  stroke((WALL_T + 1.6) * u, "#5a3417");
  stroke(WALL_T * u, "#a86a37");
  stroke(Math.max(1, 3.2 * u), "rgba(255,214,160,0.55)", -1.6, -1.6);
  stroke(Math.max(1, 1 * u), "rgba(60,30,10,0.35)", 1.2, 1.2);

  // Bumper bases (they light up on the live layer).
  for (const [x, y, r] of hole.bumpers ?? []) {
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.beginPath();
    g.arc((x + 2.5) * u, (y + 3.5) * u, r * u, 0, TAU);
    g.fill();
  }

  // Windmill buildings (the sails turn on the live layer, over the roof).
  for (const m of hole.mills ?? []) {
    const [x, y] = m;
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.beginPath();
    g.arc((x + 3) * u, (y + 4) * u, (HUB_R + 2) * u, 0, TAU);
    g.fill();
    const roof = g.createRadialGradient((x - 6) * u, (y - 6) * u, 0, x * u, y * u, (HUB_R + 2) * u);
    roof.addColorStop(0, "#e07a3a");
    roof.addColorStop(1, "#8a3b12");
    g.fillStyle = roof;
    g.beginPath();
    g.arc(x * u, y * u, (HUB_R + 1) * u, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(60,20,5,0.5)";
    g.lineWidth = Math.max(1, 1.2 * u);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      g.beginPath();
      g.moveTo(x * u, y * u);
      g.lineTo((x + Math.cos(a) * (HUB_R + 1)) * u, (y + Math.sin(a) * (HUB_R + 1)) * u);
      g.stroke();
    }
  }
}

// ---------- effects (precomputed per roll, drawn as functions of time) ----------

interface Fx {
  ms: number;
  kind: "knock" | "sink" | "water" | "portal" | "lip" | "whack";
  x: number;
  y: number;
  color: string;
  text: string;
  big: boolean;
  /** Particle seeds: [angle, speed, size]. */
  bits: number[][];
  /** Portal hop: the far end. */
  x2: number;
  y2: number;
}

function effectsFor(rp: Replay, hole: Hole, view: PuttView, colors: Record<string, string>): Fx[] {
  const out: Fx[] = [];
  const pose: BallPose = { x: 0, y: 0, alpha: 1, scale: 1, seg: -1 };
  const colorOf = (slot: number) => colors[view.balls[slot]?.id ?? ""] ?? "#ffffff";
  const ends: number[][] = [];
  for (const p of hole.portals ?? []) ends.push([p[0], p[1]], [p[2], p[3]]);
  // Only the hardest knock in a burst gets a word; the rest just spark.
  const knocks = rp.fx.filter((f) => f.e[0] === "knock");
  const loudest = (ms: number, e: (string | number)[]) =>
    !knocks.some(
      (o) =>
        o.e !== e &&
        Math.abs(o.ms - ms) < 450 &&
        Math.hypot(Number(o.e[2]) - Number(e[2]), Number(o.e[3]) - Number(e[3])) < 120 &&
        (Number(o.e[6]) > Number(e[6]) || (Number(o.e[6]) === Number(e[6]) && o.ms < ms)),
    );
  rp.fx.forEach(({ ms, e }, i) => {
    const rand = rng(rp.r.at + i * 7919);
    const bits = (n: number, sp: number) =>
      Array.from({ length: n }, () => [rand() * TAU, sp * (0.4 + rand() * 0.8), 1 + rand() * 1.6]);
    const base = { ms, x: 0, y: 0, color: "#ffffff", text: "", big: false, bits: [] as number[][], x2: 0, y2: 0 };
    const t = e[0];
    if (t === "knock") {
      const rel = Number(e[6]) || 0;
      out.push({
        ...base,
        kind: "knock",
        x: Number(e[2]),
        y: Number(e[3]),
        color: colorOf(Number(e[4])),
        text: !loudest(ms, e) ? "" : rel >= 420 ? "BONK!" : rel >= 220 ? "CLACK" : "",
        big: rel >= 420,
        bits: bits(rel >= 220 ? 8 : 5, 40 + rel * 0.18),
      });
    } else if (t === "sink") {
      const slot = Number(e[2]);
      const strokes = strokesAt(rp, slot, ms + 1);
      const ace = strokes === 1;
      out.push({
        ...base,
        ms: ms + DROP_MS * 0.6,
        kind: "sink",
        x: hole.cup[0],
        y: hole.cup[1],
        color: colorOf(slot),
        text: ace ? "HOLE IN ONE!" : strokes < hole.par ? "BIRDIE!" : "SUNK!",
        big: ace,
        bits: bits(ace ? 28 : 16, ace ? 190 : 140),
      });
    } else if (t === "water") {
      out.push({
        ...base,
        kind: "water",
        x: Number(e[3]),
        y: Number(e[4]),
        color: "#7dd3fc",
        text: "SPLASH! +1",
        bits: bits(12, 95),
      });
    } else if (t === "portal") {
      const a = ends[Number(e[3])];
      const b = ends[Number(e[4])];
      if (!a || !b) return;
      out.push({
        ...base,
        kind: "portal",
        x: a[0],
        y: a[1],
        x2: b[0],
        y2: b[1],
        color: PORTAL_COLORS[Math.floor(Number(e[3]) / 2) % PORTAL_COLORS.length],
      });
    } else if (t === "lip") {
      out.push({ ...base, kind: "lip", x: hole.cup[0], y: hole.cup[1], text: "LIPPED OUT!", color: "#fde68a" });
    } else if (t === "whack") {
      const slot = Number(e[2]);
      ballAt(rp, slot, ms, hole.cup, pose);
      out.push({ ...base, kind: "whack", x: pose.x, y: pose.y, text: "WHACK!", color: "#fca5a5", bits: bits(5, 70) });
    }
  });
  return out;
}

// ---------- aim preview ----------

/** How far a ball can travel along (dx, dy) before touching a rail or post (world units). */
function rayHit(hole: Hole, segs: number[][], x: number, y: number, dx: number, dy: number, max: number): number {
  const rw = BALL_R + WALL_T / 2;
  for (let d = 4; d <= max; d += 4) {
    const px = x + dx * d;
    const py = y + dy * d;
    if (distToSegs(segs, px, py) < rw) return d;
    for (const b of hole.bumpers ?? []) if (Math.hypot(px - b[0], py - b[1]) < b[2] + BALL_R) return d;
    for (const m of hole.mills ?? []) if (Math.hypot(px - m[0], py - m[1]) < HUB_R + BALL_R) return d;
  }
  return max;
}

// ---------- the component ----------

interface Drag {
  id: number;
  ax: number;
  ay: number;
  px: number;
  py: number;
  moved: boolean;
}

interface Scene {
  fxKey: string;
  fx: Fx[];
  /** Roll events already turned into sound/haptics (index into rp.fx) for `cueKey`. */
  cueKey: string;
  cueAt: number;
  segs: number[][];
  segsKey: string;
  rayKey: string;
  ray: number;
  drag: Drag | null;
  /** Your ball on screen (css px). */
  my: { x: number; y: number } | null;
  pose: BallPose;
  trail: BallPose;
  labels: number[][];
}

function newScene(): Scene {
  return {
    fxKey: "",
    fx: [],
    cueKey: "",
    cueAt: 0,
    segs: [],
    segsKey: "",
    rayKey: "",
    ray: 0,
    drag: null,
    my: null,
    pose: { x: 0, y: 0, alpha: 1, scale: 1, seg: -1 },
    trail: { x: 0, y: 0, alpha: 1, scale: 1, seg: -1 },
    labels: [],
  };
}

export interface CourseProps {
  view: PuttView;
  hole: Hole;
  rp: Replay | null;
  me: string;
  colors: Record<string, string>;
  byId: Record<string, Player>;
  /** Your current aim (live while you drag), or null. */
  aim: { a: number; p: number } | null;
  /** You can aim right now. */
  aiming: boolean;
  locked: boolean;
  /** Show the "drag to aim" hint. */
  hint: boolean;
  onAim: (a: number, p: number, done: boolean) => void;
  reduced: boolean;
  serverNow: () => number;
  label: string;
  ring: string;
  /** Turn the course upright for tall, narrow screens. */
  portrait: boolean;
}

const fullPull = (css: number) => clamp(css * 0.3, 96, 220);

/**
 * Keep the whole course and the controls under it on screen: ~62% of the height landscape. Portrait
 * takes up to 60% of the visible height, less on short screens (about 300px goes to the room header,
 * status, timer and the control bar).
 */
export const courseMaxWidth = (portrait: boolean) =>
  portrait
    ? `min(100%, calc(max(240px, min(60svh, 100svh - 300px)) * ${H} / ${W}))`
    : `calc(62vh * ${W} / ${H})`;

export function Course(props: CourseProps) {
  const { aiming, onAim, label, ring, portrait } = props;
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surface = useRef<Surface | null>(null);
  const scene = useRef<Scene>(newScene());

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
      if (cur && cur.W === Wp && cur.H === Hp && cur.dpr === dpr && cur.portrait === portrait) return;
      canvas.width = Wp;
      canvas.height = Hp;
      const u = portrait ? Hp / W : Wp / W;
      surface.current = {
        W: Wp,
        H: Hp,
        dpr,
        u,
        css: r.width,
        br: Math.max(BALL_R * u, 4.6 * dpr),
        narrow: r.width < 520,
        portrait,
        base: makeCanvas(W * u, H * u),
        baseKey: "",
      };
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(holder);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [portrait]);

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
      if (!document.hidden) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // ----- slingshot: drag anywhere, pull back like a catapult -----
  const local = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const aimFrom = (d: Drag, width: number): [number, number] | null => {
    const len = Math.hypot(d.ax - d.px, d.ay - d.py);
    if (len < 6) return null;
    // Pull back on screen and the ball goes the other way on screen, whichever way the course is turned.
    const [vx, vy] = screenToWorldDir(portrait, d.ax - d.px, d.ay - d.py);
    let a = Math.round((Math.atan2(vy, vx) * 1800) / Math.PI);
    if (a < 0) a += 3600;
    const p = clamp(Math.round((Math.min(len, fullPull(width)) / fullPull(width)) * MAX_POWER), 1, MAX_POWER);
    return [a % 3600, p];
  };
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!aiming || (e.pointerType === "mouse" && e.button !== 0)) return;
    const [x, y] = local(e);
    scene.current.drag = { id: e.pointerId, ax: x, ay: y, px: x, py: y, moved: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't always be captured; dragging still works inside the course.
    }
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = scene.current.drag;
    if (!d || d.id !== e.pointerId) return;
    const [x, y] = local(e);
    d.px = x;
    d.py = y;
    const shot = aimFrom(d, e.currentTarget.getBoundingClientRect().width);
    if (!shot || !aiming) return;
    d.moved = true;
    onAim(shot[0], shot[1], false);
  };
  const endDrag = (e: RPointerEvent<HTMLDivElement>) => {
    const d = scene.current.drag;
    if (!d || d.id !== e.pointerId) return;
    scene.current.drag = null;
    const shot = d.moved ? aimFrom(d, e.currentTarget.getBoundingClientRect().width) : null;
    if (shot && aiming) onAim(shot[0], shot[1], true);
  };

  return (
    <div
      ref={holderRef}
      className="relative mx-auto w-full overflow-hidden rounded-xl ring-2 transition-[box-shadow] duration-300 select-none"
      style={{
        aspectRatio: portrait ? `${H} / ${W}` : `${W} / ${H}`,
        maxWidth: courseMaxWidth(portrait),
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

function draw(g: CanvasRenderingContext2D, s: Surface, sc: Scene, p: CourseProps, now: number) {
  const { view, hole, rp, me, colors, byId, aim, aiming, locked, reduced } = p;
  const { u, dpr, br } = s;
  const sNow = p.serverNow();
  const e = rp ? sNow - rp.r.at : 0;
  const clock = (sNow - view.t0) / 1000;

  const baseKey = `${hole.id}|${s.W}x${s.H}`;
  if (s.baseKey !== baseKey) {
    renderBase(s, hole);
    s.baseKey = baseKey;
  }
  if (sc.segsKey !== hole.id) {
    sc.segs = railSegments(hole);
    sc.segsKey = hole.id;
  }
  if (rp && sc.fxKey !== `${rp.key}|${hole.id}`) {
    sc.fx = effectsFor(rp, hole, view, colors);
    sc.fxKey = `${rp.key}|${hole.id}`;
  }
  if (rp) rollFeedback(sc, rp, view.balls.findIndex((b) => b.id === me), e);
  worldT(g, s);
  g.drawImage(s.base, 0, 0);

  // ----- living water -----
  if (hole.water?.length) {
    g.save();
    greenPath(g, hole, u);
    g.clip();
    for (const wt of hole.water) {
      g.save();
      g.beginPath();
      addShape(g, wt, u);
      for (const d of hole.dry ?? []) addShape(g, d, u);
      g.clip("evenodd");
      g.strokeStyle = "rgba(255,255,255,0.22)";
      g.lineWidth = Math.max(1, 2.4 * u);
      g.lineCap = "round";
      const t = reduced ? 0 : clock;
      for (let i = 0; i < 26; i++) {
        const yy = (i * 47 + 13) % H;
        const xx = ((i * 131 + t * (12 + (i % 3) * 7)) % (W + 120)) - 60;
        const wob = Math.sin(t * 1.7 + i) * 3;
        g.beginPath();
        g.moveTo(xx * u, (yy + wob) * u);
        g.quadraticCurveTo((xx + 11) * u, (yy - 6 + wob) * u, (xx + 22) * u, (yy + wob) * u);
        g.stroke();
      }
      g.restore();
    }
    g.restore();
  }

  // ----- boost chevrons -----
  (hole.boosts ?? []).forEach(([x, y, deg], i) => {
    const hit = rp ? lastFx(rp, "boost", i, e, 400) : -1;
    const flash = hit >= 0 ? clamp(1 - (e - hit) / 400, 0, 1) : 0;
    g.save();
    g.translate(x * u, y * u);
    g.rotate((deg * Math.PI) / 180);
    for (let k = 0; k < 3; k++) {
      const phase = reduced ? 0.6 : (Math.sin(clock * 6 - k * 1.1) + 1) / 2;
      const a = Math.min(1, 0.35 + phase * 0.55 + flash);
      g.strokeStyle = `rgba(253,224,71,${a.toFixed(3)})`;
      g.lineWidth = Math.max(1.5, 4.5 * u);
      g.lineCap = "round";
      g.lineJoin = "round";
      const cx = (-16 + k * 15) * u;
      g.beginPath();
      g.moveTo(cx - 6 * u, -11 * u);
      g.lineTo(cx + 5 * u, 0);
      g.lineTo(cx - 6 * u, 11 * u);
      g.stroke();
    }
    if (flash > 0) {
      g.fillStyle = `rgba(253,224,71,${(flash * 0.35).toFixed(3)})`;
      g.beginPath();
      g.roundRect((-BOOST_L / 2) * u, (-BOOST_W / 2) * u, BOOST_L * u, BOOST_W * u, 8 * u);
      g.fill();
    }
    g.restore();
  });

  // ----- portals -----
  (hole.portals ?? []).forEach((pt, i) => {
    const col = PORTAL_COLORS[i % PORTAL_COLORS.length];
    for (let end = 0; end < 2; end++) {
      const x = pt[end * 2];
      const y = pt[end * 2 + 1];
      const spin = reduced ? 0 : clock * (end ? -2.4 : 2.4);
      g.lineCap = "round";
      for (let k = 0; k < 3; k++) {
        const r = (PORTAL_R - 2 - k * 4) * u;
        g.strokeStyle = rgba(col, 0.85 - k * 0.2);
        g.lineWidth = Math.max(1.2, (3 - k * 0.6) * u);
        g.beginPath();
        g.arc(x * u, y * u, r, spin + k * 1.3, spin + k * 1.3 + Math.PI * 1.25);
        g.stroke();
      }
      g.save();
      screenT(g);
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.font = `700 ${Math.max(8 * dpr, 9 * u)}px ${SANS}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(PORTAL_GLYPHS[i % PORTAL_GLYPHS.length], SX(s, x, y), SY(s, x, y) + 0.5);
      g.restore();
    }
  });

  // ----- bumpers -----
  (hole.bumpers ?? []).forEach(([x, y, r], i) => {
    const hit = rp ? lastFx(rp, "bump", i, e, 300) : -1;
    const f = hit >= 0 ? clamp(1 - (e - hit) / 260, 0, 1) : 0;
    const k = 1 + f * 0.14;
    const R = r * u * k;
    const bg = g.createRadialGradient((x - r * 0.3) * u, (y - r * 0.35) * u, 0, x * u, y * u, R);
    bg.addColorStop(0, f > 0 ? "#fff1f2" : "#fb7185");
    bg.addColorStop(0.55, "#e11d48");
    bg.addColorStop(1, "#9f1239");
    g.fillStyle = bg;
    g.beginPath();
    g.arc(x * u, y * u, R, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.lineWidth = Math.max(1.2, 2.6 * u);
    g.beginPath();
    g.arc(x * u, y * u, R * 0.62, 0, TAU);
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.95)";
    g.beginPath();
    g.arc(x * u, y * u, R * 0.22, 0, TAU);
    g.fill();
    if (f > 0) {
      g.strokeStyle = `rgba(255,240,245,${(f * 0.8).toFixed(3)})`;
      g.lineWidth = Math.max(1.5, 3 * u);
      g.beginPath();
      g.arc(x * u, y * u, R + (1 - f) * 14 * u, 0, TAU);
      g.stroke();
    }
  });

  // ----- balls (and their trails) -----
  const n = view.balls.length;
  const pose = sc.pose;
  const tr = sc.trail;
  const poses: { slot: number; x: number; y: number; alpha: number; scale: number }[] = [];
  for (let i = 0; i < n; i++) {
    const b = view.balls[i];
    if (rp) {
      ballAt(rp, i, e, hole.cup, pose);
      if (pose.alpha <= 0) continue;
      poses.push({ slot: i, x: pose.x, y: pose.y, alpha: pose.alpha, scale: pose.scale });
    } else {
      if (b.sunk || b.out) continue;
      poses.push({ slot: i, x: b.x, y: b.y, alpha: 1, scale: 1 });
    }
  }
  const mySlot = view.balls.findIndex((b) => b.id === me);
  const myPose = poses.find((q) => q.slot === mySlot) ?? null;
  sc.my = myPose ? { x: SX(s, myPose.x, myPose.y) / dpr, y: SY(s, myPose.x, myPose.y) / dpr } : null;

  // Trails while rolling.
  if (rp && e > REVEAL_MS) {
    for (const q of poses) {
      ballAt(rp, q.slot, e, hole.cup, pose);
      if (pose.seg < 0) continue;
      const color = colors[view.balls[q.slot].id] ?? "#ffffff";
      let px = pose.x;
      let py = pose.y;
      for (let j = 1; j <= TRAIL_STEPS; j++) {
        const te = e - j * TRAIL_GAP;
        if (te < REVEAL_MS) break;
        ballAt(rp, q.slot, te, hole.cup, tr);
        if (tr.seg !== pose.seg || tr.alpha <= 0) break;
        const k = 1 - j / (TRAIL_STEPS + 1);
        g.strokeStyle = rgba(color, 0.45 * k);
        g.lineWidth = br * 1.5 * k;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(px * u, py * u);
        g.lineTo(tr.x * u, tr.y * u);
        g.stroke();
        px = tr.x;
        py = tr.y;
      }
    }
  }

  // Aim arrows: everyone's shot is revealed just before launch.
  if (rp && e < REVEAL_MS + 120) {
    const f = easeOut(e / (REVEAL_MS * 0.7));
    const fade = e > REVEAL_MS ? 1 - (e - REVEAL_MS) / 120 : 1;
    for (const q of poses) {
      const shot = rp.shot[q.slot];
      if (!shot) continue;
      const color = colors[view.balls[q.slot].id] ?? "#ffffff";
      if (shot[1] <= 0) {
        g.save();
        screenT(g);
        g.globalAlpha = fade;
        g.font = `${Math.round(Math.max(12 * dpr, 18 * u))}px ${EMOJI}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("💤", SX(s, q.x, q.y) + br * 1.6, SY(s, q.x, q.y) - br * 1.8);
        g.restore();
        continue;
      }
      const len = Math.min(170, 30 + shot[1] * 1.4) * f;
      drawArrow(g, q.x * u, q.y * u, angleRad(shot[0]), len * u, color, br, fade);
    }
  }

  // My aim preview (while aiming, or locked in and waiting).
  if (!rp && aim && aim.p > 0 && myPose && view.phase === "aim") {
    const ang = angleRad(aim.a);
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const max = (aim.p / MAX_POWER) * MAX_ROLL;
    const key = `${aim.a}|${aim.p}|${myPose.x}|${myPose.y}|${hole.id}`;
    if (sc.rayKey !== key) {
      sc.ray = rayHit(hole, sc.segs, myPose.x, myPose.y, dx, dy, max);
      sc.rayKey = key;
    }
    const color = colors[me] ?? "#ffffff";
    const reach = sc.ray;
    const step = 15;
    const t = reduced ? 0 : (now / 1000) * 40;
    for (let d = BALL_R + 6 + (t % step); d < reach; d += step) {
      const k = 1 - d / (max + 60);
      g.fillStyle = locked ? rgba(color, 0.5 * k + 0.2) : `rgba(255,255,255,${(0.35 + 0.6 * k).toFixed(3)})`;
      g.beginPath();
      g.arc((myPose.x + dx * d) * u, (myPose.y + dy * d) * u, Math.max(1.4 * dpr, 2.6 * u), 0, TAU);
      g.fill();
    }
    const ex = (myPose.x + dx * reach) * u;
    const ey = (myPose.y + dy * reach) * u;
    g.strokeStyle = reach < max - 1 ? "rgba(255,255,255,0.85)" : rgba(color, 0.9);
    g.lineWidth = Math.max(1.5, 2.2 * u);
    g.beginPath();
    g.arc(ex, ey, Math.max(br * 0.9, 6 * u), 0, TAU);
    g.stroke();
    // The putter, drawn back behind the ball in proportion to the power.
    const back = br + (6 + aim.p * 0.22) * u;
    const hx = myPose.x * u - dx * back;
    const hy = myPose.y * u - dy * back;
    g.strokeStyle = "rgba(226,232,240,0.95)";
    g.lineWidth = Math.max(2, 3 * u);
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(hx - dy * 9 * u, hy + dx * 9 * u);
    g.lineTo(hx + dy * 9 * u, hy - dx * 9 * u);
    g.stroke();
    g.strokeStyle = "rgba(148,163,184,0.9)";
    g.lineWidth = Math.max(1, 1.6 * u);
    g.beginPath();
    g.moveTo(hx + dy * 8 * u, hy - dx * 8 * u);
    g.lineTo(hx + dy * 8 * u - dx * 26 * u, hy - dx * 8 * u - dy * 26 * u);
    g.stroke();
    // Power ring around the ball.
    const pr = br + 6 * dpr;
    g.strokeStyle = "rgba(0,0,0,0.35)";
    g.lineWidth = 3.5 * dpr;
    g.beginPath();
    g.arc(myPose.x * u, myPose.y * u, pr, 0, TAU);
    g.stroke();
    const pc = aim.p < 50 ? "#4ade80" : aim.p < 80 ? "#facc15" : "#f87171";
    g.strokeStyle = pc;
    g.beginPath();
    // The ring fills clockwise from the top of the screen.
    const top = s.portrait ? 0 : -Math.PI / 2;
    g.arc(myPose.x * u, myPose.y * u, pr, top, top + (aim.p / MAX_POWER) * TAU);
    g.stroke();
    if (sc.drag) {
      g.save();
      screenT(g);
      g.font = `800 ${Math.round(12 * dpr)}px ${SANS}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const off = (back + 18 * dpr) / u;
      const tx = SX(s, myPose.x - dx * off, myPose.y - dy * off);
      const ty = SY(s, myPose.x - dx * off, myPose.y - dy * off);
      g.lineWidth = 3 * dpr;
      g.strokeStyle = "rgba(0,0,0,0.6)";
      g.strokeText(`${aim.p}%`, tx, ty);
      g.fillStyle = pc;
      g.fillText(`${aim.p}%`, tx, ty);
      g.restore();
    }
  }

  // The drag band (relative drag: where you pressed → where your finger is).
  if (sc.drag && aiming) {
    const d = sc.drag;
    g.save();
    screenT(g);
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 2 * dpr;
    g.setLineDash([4 * dpr, 5 * dpr]);
    g.beginPath();
    g.moveTo(d.ax * dpr, d.ay * dpr);
    g.lineTo(d.px * dpr, d.py * dpr);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = "rgba(255,255,255,0.25)";
    g.beginPath();
    g.arc(d.ax * dpr, d.ay * dpr, 7 * dpr, 0, TAU);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.beginPath();
    g.arc(d.px * dpr, d.py * dpr, 4 * dpr, 0, TAU);
    g.fill();
    g.restore();
  }

  // The flag stands in the cup; it jiggles when someone holes out.
  drawFlag(g, s, hole, rp, e, clock, reduced);

  // Balls: mine last so it sits on top.
  poses.sort((a, b) => Number(a.slot === mySlot) - Number(b.slot === mySlot));
  for (const q of poses) {
    const b = view.balls[q.slot];
    const color = colors[b.id] ?? "#ffffff";
    drawBall(g, q.x * u, q.y * u, br * q.scale, color, q.alpha);
    if (!rp && view.phase === "aim" && b.locked) {
      g.save();
      screenT(g);
      drawCheck(g, SX(s, q.x, q.y) + br * 0.9, SY(s, q.x, q.y) - br * 0.9, dpr);
      g.restore();
    }
  }
  if (myPose && (view.phase === "aim" || view.phase === "roll")) {
    const pulse = reduced ? 0.5 : (Math.sin(now / 260) + 1) / 2;
    g.strokeStyle = `rgba(255,255,255,${(0.55 + 0.4 * pulse).toFixed(3)})`;
    g.lineWidth = 2 * dpr;
    if (aiming) g.setLineDash([3 * dpr, 3 * dpr]);
    g.beginPath();
    g.arc(myPose.x * u, myPose.y * u, br * myPose.scale + (3 + pulse * 2.5) * dpr, 0, TAU);
    g.stroke();
    g.setLineDash([]);
  }

  // Windmill sails over everything that rolls under them.
  for (const m of hole.mills ?? []) drawMill(g, s, m, clock);

  // Avatars next to the balls (yours first), placed where they cover no other ball or label.
  g.save();
  screenT(g);
  sc.labels.length = 0;
  const fs = Math.round(Math.max(11 * dpr, 15 * u));
  g.font = `${fs}px ${EMOJI}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const half = fs * 0.5;
  const gap = br + fs * 0.62;
  const spots = [
    [0, -gap],
    [gap * 0.95, -gap * 0.55],
    [-gap * 0.95, -gap * 0.55],
    [gap * 1.1, 0],
    [-gap * 1.1, 0],
    [0, gap],
  ];
  for (const q of [...poses].reverse()) {
    if (q.alpha < 0.6) continue;
    const pl = byId[view.balls[q.slot].id];
    const bx = SX(s, q.x, q.y);
    const by = SY(s, q.x, q.y);
    let placed: number[] | null = null;
    for (const [ox, oy] of spots) {
      const x = bx + ox;
      const y = by + oy;
      const box = [x - half, y - half, x + half, y + half];
      if (box[0] < 0 || box[2] > s.W || box[1] < 0 || box[3] > s.H) continue;
      if (sc.labels.some((l) => l[0] < box[2] && l[2] > box[0] && l[1] < box[3] && l[3] > box[1])) continue;
      const hitsBall = poses.some((o) => {
        if (o === q) return false;
        const ox2 = SX(s, o.x, o.y);
        const oy2 = SY(s, o.x, o.y);
        const cx = clamp(ox2, box[0], box[2]);
        const cy = clamp(oy2, box[1], box[3]);
        return Math.hypot(cx - ox2, cy - oy2) < br + 1.5 * dpr;
      });
      if (hitsBall) continue;
      placed = box;
      break;
    }
    if (!placed) continue;
    sc.labels.push(placed);
    g.globalAlpha = q.alpha;
    drawAvatar(g, pl?.avatar ?? "🙂", (placed[0] + placed[2]) / 2, (placed[1] + placed[3]) / 2);
    g.globalAlpha = 1;
  }
  g.restore();

  // Effects.
  if (rp) drawEffects(g, s, hole, sc.fx, e, reduced);

  // First-shot hint.
  if (p.hint && aiming && !sc.drag) {
    screenT(g);
    const text = s.narrow ? "Drag back anywhere to aim" : "Drag back anywhere on the course to aim, like a slingshot";
    g.font = `700 ${Math.round(12.5 * dpr)}px ${SANS}`;
    const tw = g.measureText(text).width + 22 * dpr;
    const th = 24 * dpr;
    const x = s.W / 2;
    const y = s.H - th / 2 - 8 * dpr;
    g.fillStyle = "rgba(10,8,25,0.72)";
    g.beginPath();
    g.roundRect(x - tw / 2, y - th / 2, tw, th, th / 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, x, y + 0.5);
  }
}

/** Edge-triggered sound/haptics for the roll's events as they play out; buzz only for your ball. */
function rollFeedback(sc: Scene, rp: Replay, mySlot: number, e: number) {
  if (sc.cueKey !== rp.key) {
    // A new roll (or joining mid-roll): skip whatever already happened.
    sc.cueKey = rp.key;
    let i = 0;
    while (i < rp.fx.length && rp.fx[i].ms <= e) i++;
    sc.cueAt = i;
    return;
  }
  while (sc.cueAt < rp.fx.length && rp.fx[sc.cueAt].ms <= e) {
    const ev = rp.fx[sc.cueAt++].e;
    const t = ev[0];
    if (t === "knock") {
      const hard = (Number(ev[6]) || 0) >= 220;
      if (mySlot >= 0 && (Number(ev[4]) === mySlot || Number(ev[5]) === mySlot)) feedback(hard ? "hit" : "bump");
      else sfx("bump");
    } else if (t === "bump") {
      sfx("bump");
    } else {
      const me = mySlot >= 0 && Number(ev[t === "boost" ? 3 : 2]) === mySlot;
      if (t === "sink") {
        if (me) feedback("score");
        else sfx("pop");
      } else if (t === "water") {
        if (me) {
          sfx("out");
          buzz("hit");
        }
      } else if (t === "whack") {
        if (me) feedback("hit");
        else sfx("bump");
      } else if (me && (t === "lip" || t === "portal" || t === "boost")) {
        sfx(t === "lip" ? "bump" : "pop");
      }
    }
  }
}

/** Ms of the latest event of `type` for `index` at or before e (within `win` ms, 0 = any), or -1. */
function lastFx(rp: Replay, type: string, index: number, e: number, win: number): number {
  let best = -1;
  for (const f of rp.fx) {
    if (f.ms > e) break;
    if (f.e[0] === type && Number(f.e[2]) === index && (!win || e - f.ms < win)) best = f.ms;
  }
  return best;
}

function drawArrow(g: CanvasRenderingContext2D, x: number, y: number, a: number, len: number, color: string, br: number, alpha: number) {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const x0 = x + dx * br * 1.4;
  const y0 = y + dy * br * 1.4;
  const x1 = x + dx * (br * 1.4 + len);
  const y1 = y + dy * (br * 1.4 + len);
  g.globalAlpha = Math.max(0, alpha);
  g.strokeStyle = "rgba(0,0,0,0.45)";
  g.lineWidth = br * 0.9;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = br * 0.55;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  const hs = br * 1.3;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x1 + dx * hs, y1 + dy * hs);
  g.lineTo(x1 - dy * hs * 0.75, y1 + dx * hs * 0.75);
  g.lineTo(x1 + dy * hs * 0.75, y1 - dx * hs * 0.75);
  g.closePath();
  g.fill();
  g.globalAlpha = 1;
}

function drawBall(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number) {
  if (r <= 0.3) return;
  g.globalAlpha = alpha;
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.beginPath();
  g.ellipse(x + r * 0.35, y + r * 0.45, r * 1.02, r * 0.85, 0, 0, TAU);
  g.fill();
  const bg = g.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r);
  bg.addColorStop(0, tint(color, -0.65));
  bg.addColorStop(0.45, color);
  bg.addColorStop(1, tint(color, 0.35));
  g.fillStyle = bg;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.5)";
  g.lineWidth = Math.max(1, r * 0.12);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath();
  g.arc(x - r * 0.36, y - r * 0.4, r * 0.24, 0, TAU);
  g.fill();
  g.globalAlpha = 1;
}

function drawCheck(g: CanvasRenderingContext2D, x: number, y: number, dpr: number) {
  const r = 6 * dpr;
  g.fillStyle = "#16a34a";
  g.strokeStyle = "#ffffff";
  g.lineWidth = 1.5 * dpr;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.stroke();
  g.lineWidth = 1.8 * dpr;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x - r * 0.45, y);
  g.lineTo(x - r * 0.1, y + r * 0.38);
  g.lineTo(x + r * 0.5, y - r * 0.35);
  g.stroke();
}

function drawMill(g: CanvasRenderingContext2D, s: Surface, m: number[], clock: number) {
  const { u } = s;
  const [x, y, len, , count] = m;
  const base = millAngle(m, clock);
  for (let i = 0; i < count; i++) {
    const a = base + (i / count) * TAU;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    // Shadow.
    g.strokeStyle = "rgba(0,0,0,0.25)";
    g.lineWidth = BLADE_T * u;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo((x + 3) * u, (y + 4) * u);
    g.lineTo((x + ux * len + 3) * u, (y + uy * len + 4) * u);
    g.stroke();
    // A lattice sail on the trailing side of the spar.
    const side = m[3] >= 0 ? -1 : 1;
    const nx = -uy * side;
    const ny = ux * side;
    g.fillStyle = "rgba(245,240,230,0.42)";
    g.beginPath();
    g.moveTo((x + ux * len * 0.32) * u, (y + uy * len * 0.32) * u);
    g.lineTo((x + ux * len * 0.98) * u, (y + uy * len * 0.98) * u);
    g.lineTo((x + ux * len * 0.98 + nx * 13) * u, (y + uy * len * 0.98 + ny * 13) * u);
    g.lineTo((x + ux * len * 0.32 + nx * 13) * u, (y + uy * len * 0.32 + ny * 13) * u);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(120,80,40,0.55)";
    g.lineWidth = Math.max(1, 1 * u);
    for (let k = 1; k <= 4; k++) {
      const f = 0.32 + (k / 5) * 0.66;
      g.beginPath();
      g.moveTo((x + ux * len * f) * u, (y + uy * len * f) * u);
      g.lineTo((x + ux * len * f + nx * 13) * u, (y + uy * len * f + ny * 13) * u);
      g.stroke();
    }
    // The solid spar (this is what bats balls).
    g.strokeStyle = "#5b3a1e";
    g.lineWidth = BLADE_T * u;
    g.beginPath();
    g.moveTo(x * u, y * u);
    g.lineTo((x + ux * len) * u, (y + uy * len) * u);
    g.stroke();
    g.strokeStyle = "#c08a52";
    g.lineWidth = BLADE_T * 0.55 * u;
    g.beginPath();
    g.moveTo(x * u, y * u);
    g.lineTo((x + ux * len) * u, (y + uy * len) * u);
    g.stroke();
  }
  // Hub cap.
  g.fillStyle = "#3b2412";
  g.beginPath();
  g.arc(x * u, y * u, 7 * u, 0, TAU);
  g.fill();
  g.fillStyle = "#e5c08f";
  g.beginPath();
  g.arc(x * u, y * u, 3.5 * u, 0, TAU);
  g.fill();
}

function drawFlag(g: CanvasRenderingContext2D, s: Surface, hole: Hole, rp: Replay | null, e: number, clock: number, reduced: boolean) {
  const { u, dpr } = s;
  const [cx, cy] = hole.cup;
  let jig = 0;
  if (rp) {
    for (const f of rp.fx) {
      if (f.e[0] !== "sink") continue;
      const age = e - (f.ms + DROP_MS);
      if (age >= 0 && age < 900) jig = Math.max(jig, 1 - age / 900);
    }
  }
  const lean = reduced ? 0 : Math.sin(clock * 22) * jig * 0.25;
  const pole = Math.max(30 * dpr, 46 * u);
  // Upright on screen whichever way the course is turned.
  const bx = SX(s, cx, cy);
  const by = SY(s, cx, cy);
  g.save();
  screenT(g);
  const top = [bx + Math.sin(0.35 + lean) * pole, by - Math.cos(0.35 + lean) * pole];
  g.strokeStyle = "rgba(0,0,0,0.3)";
  g.lineWidth = Math.max(1.5, 2.2 * u);
  g.beginPath();
  g.moveTo(bx, by);
  g.lineTo(top[0] + pole * 0.5, top[1] + pole * 0.85);
  g.stroke();
  g.strokeStyle = "#f8fafc";
  g.lineWidth = Math.max(1.5, 2.4 * u);
  g.beginPath();
  g.moveTo(bx, by);
  g.lineTo(top[0], top[1]);
  g.stroke();
  const wave = reduced ? 0 : Math.sin(clock * 5) * 3 * u;
  const fw = Math.max(16 * dpr, 24 * u);
  const fh = Math.max(10 * dpr, 15 * u);
  g.fillStyle = "#ef4444";
  g.beginPath();
  g.moveTo(top[0], top[1]);
  g.quadraticCurveTo(top[0] + fw * 0.5, top[1] + wave + fh * 0.15, top[0] + fw, top[1] + fh * 0.45 + wave);
  g.quadraticCurveTo(top[0] + fw * 0.5, top[1] + fh * 0.75 - wave, top[0], top[1] + fh);
  g.closePath();
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.25)";
  g.beginPath();
  g.moveTo(top[0], top[1]);
  g.lineTo(top[0] + fw * 0.5, top[1] + fh * 0.2 + wave * 0.5);
  g.lineTo(top[0], top[1] + fh * 0.45);
  g.closePath();
  g.fill();
  g.restore();
}

function drawEffects(g: CanvasRenderingContext2D, s: Surface, hole: Hole, fx: Fx[], e: number, reduced: boolean) {
  const { u, dpr } = s;
  // Effects live in screen space so spray rises, confetti falls and words read upright.
  g.save();
  screenT(g);
  for (const f of fx) {
    const age = e - f.ms;
    if (age < 0 || age > 1300) continue;
    const t = age / 1000;
    const x = SX(s, f.x, f.y);
    const y = SY(s, f.x, f.y);
    if (f.kind === "knock") {
      if (age < 260) {
        const k = age / 260;
        g.strokeStyle = `rgba(255,255,255,${(0.9 * (1 - k)).toFixed(3)})`;
        g.lineWidth = Math.max(1.5, 2.5 * u);
        g.beginPath();
        g.arc(x, y, (6 + k * (f.big ? 26 : 16)) * u, 0, TAU);
        g.stroke();
      }
      if (!reduced) {
        for (const [a, sp, sz] of f.bits) {
          if (t > 0.35) break;
          const d = sp * t;
          g.fillStyle = `rgba(255,250,220,${(1 - t / 0.35).toFixed(3)})`;
          g.beginPath();
          g.arc(x + Math.cos(a) * d * u, y + Math.sin(a) * d * u, sz * 1.2 * u + 0.6 * dpr, 0, TAU);
          g.fill();
        }
      }
    } else if (f.kind === "water") {
      // Ripples stay on the water; the spray flies wherever.
      g.save();
      worldT(g, s);
      g.beginPath();
      for (const wt of hole.water ?? []) addShape(g, wt, u);
      g.clip();
      screenT(g);
      for (let k = 0; k < 3; k++) {
        const tt = age - k * 120;
        if (tt < 0 || tt > 900) continue;
        const q = tt / 900;
        g.strokeStyle = `rgba(220,245,255,${(0.85 * (1 - q)).toFixed(3)})`;
        g.lineWidth = Math.max(1.2, 2.6 * u * (1 - q * 0.5));
        g.beginPath();
        g.ellipse(x, y, (6 + q * 38) * u, (5 + q * 30) * u, 0, 0, TAU);
        g.stroke();
      }
      g.restore();
      if (!reduced) {
        for (const [a, sp, sz] of f.bits) {
          if (t > 0.6) break;
          const d = sp * t;
          const lift = 160 * t - 420 * t * t;
          g.fillStyle = `rgba(200,240,255,${(1 - t / 0.6).toFixed(3)})`;
          g.beginPath();
          g.arc(x + Math.cos(a) * d * u, y + (Math.sin(a) * d * 0.5 - lift) * u, (sz + 0.8) * u + 0.5 * dpr, 0, TAU);
          g.fill();
        }
      }
    } else if (f.kind === "sink") {
      if (age < 600) {
        const k = age / 600;
        g.strokeStyle = rgba(f.color, 0.9 * (1 - k));
        g.lineWidth = Math.max(2, 4 * u * (1 - k));
        g.beginPath();
        g.arc(x, y, (CUP_R + k * (f.big ? 70 : 42)) * u, 0, TAU);
        g.stroke();
      }
      if (!reduced) {
        for (let i = 0; i < f.bits.length; i++) {
          const [a, sp, sz] = f.bits[i];
          if (t > 1.1) break;
          const d = sp * (1 - Math.exp(-t * 3)) * 0.6;
          const fall = 50 * t * t;
          g.fillStyle = i % 3 === 0 ? "#ffffff" : i % 3 === 1 ? f.color : "#fde047";
          g.globalAlpha = 1 - t / 1.1;
          g.save();
          g.translate(x + Math.cos(a) * d * u, y + (Math.sin(a) * d + fall) * u);
          g.rotate(a + t * 8);
          g.fillRect(-sz * 1.6 * u - dpr, -sz * 0.8 * u - 0.5 * dpr, sz * 3.2 * u + 2 * dpr, sz * 1.6 * u + dpr);
          g.restore();
          g.globalAlpha = 1;
        }
      }
    } else if (f.kind === "portal") {
      if (age < 450) {
        const k = age / 450;
        for (const [px, py] of [
          [f.x, f.y],
          [f.x2, f.y2],
        ]) {
          g.strokeStyle = rgba(f.color, 0.95 * (1 - k));
          g.lineWidth = Math.max(2, 3.5 * u);
          g.beginPath();
          g.arc(SX(s, px, py), SY(s, px, py), (PORTAL_R + k * 26) * u, 0, TAU);
          g.stroke();
          g.fillStyle = rgba("#ffffff", 0.5 * (1 - k));
          g.beginPath();
          g.arc(SX(s, px, py), SY(s, px, py), PORTAL_R * u * (1 - k * 0.5), 0, TAU);
          g.fill();
        }
      }
    }
    if (f.text) {
      const k = clamp(age / 1100, 0, 1);
      const pop = age < 160 ? 0.6 + (age / 160) * 0.55 : 1.15 - Math.min(0.15, (age - 160) / 800);
      const size = Math.round((f.big ? 17 : 12.5) * dpr * pop);
      const rise = (reduced ? 0 : 26 * k) * dpr;
      g.font = `900 ${size}px ${SANS}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const tw = g.measureText(f.text).width;
      const tx = clamp(x, tw / 2 + 4 * dpr, s.W - tw / 2 - 4 * dpr);
      const ty = clamp(y - 22 * dpr - rise, size, s.H - size);
      g.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      g.lineWidth = 4 * dpr;
      g.lineJoin = "round";
      g.strokeStyle = "rgba(10,8,25,0.85)";
      g.strokeText(f.text, tx, ty);
      g.fillStyle = f.color;
      g.fillText(f.text, tx, ty);
      g.globalAlpha = 1;
    }
  }
  g.restore();
}
