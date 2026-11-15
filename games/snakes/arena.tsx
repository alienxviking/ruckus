"use client";

// Canvas renderer and touch input for Snake Brawl. React re-renders only when a
// new view arrives; drawing happens in a requestAnimationFrame loop that slides
// heads and tails between server ticks and plays the little effects.

import { useEffect, useEffectEvent, useRef, type PointerEvent, type ReactNode } from "react";
import type { Player } from "@/shared/types";
import type { SnakeV, SnakeView } from "./server";
import { DELTA, GHOST_MS, ROUND_MS, TICK_MS, type Dir } from "./shared";

const TAU = Math.PI * 2;
const SLIDE_MS = TICK_MS * 0.85;
const POP_MS = 850;
const FOOD = "#fff3dc";
const FOOD_GLOW = "255, 205, 150";
const GOLD = "#ffd34d";
const GOLD_GLOW = "255, 196, 40";
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

interface Frames {
  prev: SnakeView | null;
  cur: SnakeView | null;
  /** performance.now() when `cur` arrived. */
  at: number;
}

interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  at: number;
}

interface Surface {
  /** Grid the sprites were drawn for (both grids are 4:3, so the pixel size alone can't tell). */
  w: number;
  h: number;
  /** Backing-store size in device pixels. */
  W: number;
  H: number;
  dpr: number;
  /** Device pixels per cell. */
  cell: number;
  /** CSS pixels per cell (for pointer maths). */
  cssCell: number;
  board: HTMLCanvasElement;
  glow: HTMLCanvasElement;
  gold: HTMLCanvasElement;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function renderBoard(w: number, h: number, W: number, H: number) {
  const c = makeCanvas(W, H);
  const g = c.getContext("2d");
  if (!g) return c;
  g.fillStyle = "#110e22";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#17142c";
  const cx = W / w;
  const cy = H / h;
  for (let y = 0; y < h; y++) {
    for (let x = y % 2; x < w; x += 2) {
      const x0 = Math.round(x * cx);
      const y0 = Math.round(y * cy);
      g.fillRect(x0, y0, Math.round((x + 1) * cx) - x0, Math.round((y + 1) * cy) - y0);
    }
  }
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.72);
  v.addColorStop(0, "rgba(14, 12, 29, 0)");
  v.addColorStop(1, "rgba(14, 12, 29, 0.55)");
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  return c;
}

function renderGlow(radius: number, rgb: string) {
  const size = Math.max(2, Math.ceil(radius * 2));
  const c = makeCanvas(size, size);
  const g = c.getContext("2d");
  if (!g) return c;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${rgb}, 0.6)`);
  grad.addColorStop(0.35, `rgba(${rgb}, 0.22)`);
  grad.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

const shadeCache = new Map<string, string>();
/** The colour mixed toward black (f = 0..1), as rgb(). */
function shade(hex: string, f: number) {
  const key = `${hex}|${f}`;
  const hit = shadeCache.get(key);
  if (hit) return hit;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x94a3b8;
  const ch = (v: number) => Math.round(v * (1 - f));
  const out = `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
  shadeCache.set(key, out);
  return out;
}

/** Cell-unit polyline for a snake, sliding head and tail from the previous frame. */
function snakePoints(sn: SnakeV, prev: SnakeV | undefined, a: number): number[] {
  const b = sn.body;
  if (!prev || !prev.alive || !sn.alive || prev.body.length < 4 || b.length < 4 || a >= 1) return b;
  const pts = [lerp(prev.body[0], b[0], a), lerp(prev.body[1], b[1], a)];
  for (let i = 2; i < b.length; i++) pts.push(b[i]);
  const pt = prev.body.length - 2;
  pts.push(lerp(prev.body[pt], b[b.length - 2], a), lerp(prev.body[pt + 1], b[b.length - 1], a));
  return pts;
}

function tracePath(g: CanvasRenderingContext2D, pts: number[], cell: number) {
  g.beginPath();
  g.moveTo((pts[0] + 0.5) * cell, (pts[1] + 0.5) * cell);
  for (let i = 2; i < pts.length; i += 2) g.lineTo((pts[i] + 0.5) * cell, (pts[i + 1] + 0.5) * cell);
}

function drawBody(g: CanvasRenderingContext2D, pts: number[], cell: number, color: string, dark: string) {
  tracePath(g, pts, cell);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = dark;
  g.lineWidth = cell * 0.86;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = cell * 0.66;
  g.stroke();
  g.strokeStyle = "rgba(255, 255, 255, 0.22)";
  g.lineWidth = cell * 0.18;
  g.stroke();
}

function drawHead(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: Dir,
  cell: number,
  color: string,
  dark: string,
  dead: boolean,
) {
  const cx = (x + 0.5) * cell;
  const cy = (y + 0.5) * cell;
  g.beginPath();
  g.arc(cx, cy, cell * 0.52, 0, TAU);
  g.fillStyle = dark;
  g.fill();
  g.beginPath();
  g.arc(cx, cy, cell * 0.41, 0, TAU);
  g.fillStyle = color;
  g.fill();
  const [dx, dy] = DELTA[dir];
  const px = -dy;
  const py = dx;
  for (const side of [-1, 1]) {
    const ex = cx + (dx * 0.14 + px * 0.22 * side) * cell;
    const ey = cy + (dy * 0.14 + py * 0.22 * side) * cell;
    if (dead) {
      const r = cell * 0.1;
      g.strokeStyle = "#0e0c1d";
      g.lineWidth = Math.max(1, cell * 0.07);
      g.beginPath();
      g.moveTo(ex - r, ey - r);
      g.lineTo(ex + r, ey + r);
      g.moveTo(ex + r, ey - r);
      g.lineTo(ex - r, ey + r);
      g.stroke();
      continue;
    }
    g.beginPath();
    g.arc(ex, ey, cell * 0.16, 0, TAU);
    g.fillStyle = "#ffffff";
    g.fill();
    g.beginPath();
    g.arc(ex + dx * cell * 0.06, ey + dy * cell * 0.06, cell * 0.085, 0, TAU);
    g.fillStyle = "#0e0c1d";
    g.fill();
  }
}

function star(g: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number, rot: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
}

function roundedRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Which side of a head a label goes on: beside vertical snakes, above (or below) horizontal ones. */
type Place = "above" | "below" | "left" | "right";
const PLACE: Record<Place, readonly [number, number]> = { above: [0, -1], below: [0, 1], left: [-1, 0], right: [1, 0] };
function placeFor(x: number, y: number, dir: Dir, w: number): Place {
  if (dir === "up" || dir === "down") return x <= w - 5 ? "right" : "left";
  return y >= 2 ? "above" : "below";
}
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A "YOU" tag pointing at a head from the given side. */
function drawYouTag(g: CanvasRenderingContext2D, hx: number, hy: number, place: Place, s: Surface, bob: number, alpha: number) {
  const { cell, dpr, W, H } = s;
  const font = Math.round(Math.max(10 * dpr, cell * 0.78));
  g.font = `800 ${font}px ui-sans-serif, system-ui, sans-serif`;
  const tw = g.measureText("YOU").width;
  const pw = tw + font * 0.9;
  const ph = font * 1.45;
  const cx = (hx + 0.5) * cell;
  const cy = (hy + 0.5) * cell;
  const [vx, vy] = PLACE[place];
  const gap = cell * 0.7 + font * 0.45 + bob;
  const left = clampTo(vx === 0 ? cx - pw / 2 : vx > 0 ? cx + gap : cx - gap - pw, 2, W - pw - 2);
  const top = clampTo(vy === 0 ? cy - ph / 2 : vy > 0 ? cy + gap : cy - gap - ph, 2, H - ph - 2);
  g.globalAlpha = alpha;
  g.fillStyle = "#ffffff";
  roundedRect(g, left, top, pw, ph, ph / 2);
  g.fill();
  const tip = font * 0.38;
  const bx = clampTo(cx, left + ph / 2, left + pw - ph / 2);
  const by = clampTo(cy, top + tip, top + ph - tip);
  g.beginPath();
  if (place === "above") {
    g.moveTo(bx - tip, top + ph - 1);
    g.lineTo(bx + tip, top + ph - 1);
    g.lineTo(bx, top + ph + tip);
  } else if (place === "below") {
    g.moveTo(bx - tip, top + 1);
    g.lineTo(bx + tip, top + 1);
    g.lineTo(bx, top - tip);
  } else if (place === "right") {
    g.moveTo(left + 1, by - tip);
    g.lineTo(left + 1, by + tip);
    g.lineTo(left - tip, by);
  } else {
    g.moveTo(left + pw - 1, by - tip);
    g.lineTo(left + pw - 1, by + tip);
    g.lineTo(left + pw + tip, by);
  }
  g.fill();
  g.fillStyle = "#0e0c1d";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("YOU", left + pw / 2, top + ph / 2 + font * 0.04);
  g.globalAlpha = 1;
}

function drawChevron(g: CanvasRenderingContext2D, hx: number, hy: number, dir: Dir, cell: number, color: string, alpha: number) {
  const [dx, dy] = DELTA[dir];
  const cx = (hx + 0.5 + dx * 1.35) * cell;
  const cy = (hy + 0.5 + dy * 1.35) * cell;
  const px = -dy;
  const py = dx;
  g.globalAlpha = alpha;
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.5, cell * 0.16);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(cx - dx * cell * 0.18 + px * cell * 0.3, cy - dy * cell * 0.18 + py * cell * 0.3);
  g.lineTo(cx + dx * cell * 0.18, cy + dy * cell * 0.18);
  g.lineTo(cx - dx * cell * 0.18 - px * cell * 0.3, cy - dy * cell * 0.18 - py * cell * 0.3);
  g.stroke();
  g.globalAlpha = 1;
}

interface Scene {
  frames: Frames;
  surface: Surface;
  pops: Pop[];
  foodSeen: Map<number, number>;
  /** Direction you just steered (shown until the server moves your snake). */
  intent: Dir | null;
  me: string;
  colors: Record<string, string>;
  byId: Record<string, Player>;
  now: number;
  serverNow: number;
  reduced: boolean;
}

function drawScene(g: CanvasRenderingContext2D, sc: Scene) {
  const { frames, surface: s, now, serverNow, reduced, me } = sc;
  const view = frames.cur;
  if (!view) return;
  const { cell, dpr } = s;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, s.W, s.H);

  const mine = view.snakes.find((x) => x.id === me);
  const myDeathAge = mine && !mine.alive && mine.diedAt ? serverNow - mine.diedAt : Infinity;
  if (!reduced && myDeathAge >= 0 && myDeathAge < 420) {
    const amp = cell * 0.3 * (1 - myDeathAge / 420);
    g.translate(Math.sin(now * 0.09) * amp, Math.cos(now * 0.113) * amp);
  }
  g.drawImage(s.board, 0, 0);

  // Food: soft glow, pop in when spawned, gentle breathing.
  const glowR = cell * 1.15;
  for (let i = 0; i < view.food.length; i += 2) {
    const x = view.food[i];
    const y = view.food[i + 1];
    const born = sc.foodSeen.get(y * view.w + x) ?? 0;
    const t = clamp01((now - born) / 260);
    if (t <= 0) continue;
    const k = t < 1 ? easeOutBack(t) : 1;
    const cx = (x + 0.5) * cell;
    const cy = (y + 0.5) * cell;
    const breathe = reduced ? 1 : 1 + 0.09 * Math.sin(now / 330 + x * 1.7 + y * 2.3);
    g.globalAlpha = Math.min(1, t * 1.4);
    g.drawImage(s.glow, cx - glowR * k, cy - glowR * k, glowR * 2 * k, glowR * 2 * k);
    g.beginPath();
    g.arc(cx, cy, cell * 0.2 * k * breathe, 0, TAU);
    g.fillStyle = FOOD;
    g.fill();
    g.globalAlpha = 1;
  }

  // Golden pellet: spinning star with a pulsing halo.
  if (view.golden) {
    const [x, y] = view.golden;
    const cx = (x + 0.5) * cell;
    const cy = (y + 0.5) * cell;
    const pulse = reduced ? 1 : 1 + 0.18 * Math.sin(now / 180);
    const r = cell * 2 * pulse;
    g.drawImage(s.gold, cx - r, cy - r, r * 2, r * 2);
    if (!reduced) {
      const ring = (now % 1300) / 1300;
      g.globalAlpha = 0.6 * (1 - ring);
      g.strokeStyle = GOLD;
      g.lineWidth = Math.max(1, cell * 0.08);
      g.beginPath();
      g.arc(cx, cy, cell * (0.5 + ring * 1.3), 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
    }
    star(g, cx, cy, cell * 0.56, cell * 0.25, reduced ? 0 : now / 700);
    g.fillStyle = GOLD;
    g.fill();
    g.strokeStyle = "#fff7cc";
    g.lineWidth = Math.max(1, cell * 0.07);
    g.stroke();
  }

  // Snakes: ghosts of the freshly dead first, then the living (yours on top).
  const prev = frames.prev;
  const a = prev ? clamp01((now - frames.at) / SLIDE_MS) : 1;
  const champ = view.phase === "roundOver" || view.phase === "final" ? view.lastRoundWinner : null;
  const ordered = view.snakes
    .filter((sn) => sn.body.length >= 2)
    .sort((p, q) => Number(p.alive) - Number(q.alive) || Number(p.id === me) - Number(q.id === me));
  for (const sn of ordered) {
    const color = sc.colors[sn.id] ?? "#94a3b8";
    const dark = shade(color, 0.55);
    if (!sn.alive) {
      const age = serverNow - sn.diedAt;
      if (age < 0 || age > GHOST_MS) continue;
      const k = age / GHOST_MS;
      const flicker = reduced ? 1 : 0.7 + 0.3 * Math.cos(age / 35);
      g.globalAlpha = (1 - k) * flicker;
      const flash = age < 150 ? "#ffffff" : color;
      drawBody(g, sn.body, cell, flash, dark);
      drawHead(g, sn.body[0], sn.body[1], sn.dir, cell, flash, dark, true);
      g.globalAlpha = 1;
      // Burst at the head.
      const b = clamp01(age / 650);
      const hx = (sn.body[0] + 0.5) * cell;
      const hy = (sn.body[1] + 0.5) * cell;
      g.globalAlpha = 1 - b;
      g.strokeStyle = color;
      g.lineWidth = Math.max(1, cell * 0.2 * (1 - b));
      g.beginPath();
      g.arc(hx, hy, cell * (0.6 + 2.6 * easeOut(b)), 0, TAU);
      g.stroke();
      if (!reduced) {
        g.fillStyle = color;
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * TAU + (sn.diedAt % 7);
          const d = cell * (0.5 + 3 * easeOut(b) * (0.7 + (i % 3) * 0.15));
          const sz = cell * 0.24 * (1 - b);
          g.fillRect(hx + Math.cos(ang) * d - sz / 2, hy + Math.sin(ang) * d - sz / 2, sz, sz);
        }
      }
      g.globalAlpha = 1;
      continue;
    }
    const old = prev?.snakes.find((o) => o.id === sn.id);
    const pts = snakePoints(sn, old, a);
    const winner = sn.id === champ;
    if (winner) {
      g.save();
      g.shadowColor = color;
      g.shadowBlur = cell * (1.2 + (reduced ? 0 : 0.5 * Math.sin(now / 200)));
      drawBody(g, pts, cell, color, dark);
      g.restore();
    } else {
      drawBody(g, pts, cell, color, dark);
    }
    // Your own snake looks where you just steered, before the server has moved it.
    const eyes = sn.id === me && sc.intent ? sc.intent : sn.dir;
    drawHead(g, pts[0], pts[1], eyes, cell, color, dark, false);
    if (sn.id === me && view.phase !== "countdown") {
      g.globalAlpha = 0.9;
      g.strokeStyle = "#ffffff";
      g.lineWidth = Math.max(1, cell * 0.09);
      g.beginPath();
      g.arc((pts[0] + 0.5) * cell, (pts[1] + 0.5) * cell, cell * 0.68, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
    }
    if (winner) {
      const font = Math.round(Math.max(12 * dpr, cell * 1.1));
      g.font = `${font}px ${EMOJI_FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const lift = 1.2 + (reduced ? 0 : Math.sin(now / 240) * 0.12);
      const [vx, vy] = PLACE[placeFor(pts[0], pts[1], sn.dir, view.w)];
      g.fillText("👑", (pts[0] + 0.5 + vx * lift) * cell, (pts[1] + 0.5 + vy * lift) * cell);
    }
  }

  // Who's who: arrows and labels before the round starts (and the YOU tag a moment after).
  const playAge = view.phase === "play" ? serverNow - (view.endsAt - ROUND_MS) : Infinity;
  if (view.phase === "countdown" || playAge < 1600) {
    const fade = view.phase === "countdown" ? 1 : clamp01(1 - playAge / 1600);
    const bob = reduced ? 0 : Math.sin(now / 210) * cell * 0.14;
    for (const sn of view.snakes) {
      if (!sn.alive || sn.body.length < 2) continue;
      const color = sc.colors[sn.id] ?? "#94a3b8";
      const place = placeFor(sn.body[0], sn.body[1], sn.dir, view.w);
      if (view.phase === "countdown") {
        const heading = sn.id === me && sc.intent ? sc.intent : sn.dir;
        drawChevron(g, sn.body[0], sn.body[1], heading, cell, color, reduced ? 0.9 : 0.6 + 0.35 * Math.sin(now / 160));
      }
      if (sn.id === me) {
        drawYouTag(g, sn.body[0], sn.body[1], place, s, bob, fade);
      } else if (view.phase === "countdown") {
        const font = Math.round(Math.max(12 * dpr, cell * 1.05));
        g.font = `${font}px ${EMOJI_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        const [vx, vy] = PLACE[place];
        g.fillText(
          sc.byId[sn.id]?.avatar ?? "🐍",
          (sn.body[0] + 0.5 + vx * 1.3) * cell,
          (sn.body[1] + 0.5 + vy * 1.2) * cell,
        );
      }
    }
  }

  // Floating +N where someone ate.
  if (sc.pops.length) {
    const font = Math.round(Math.max(11 * dpr, cell * 0.95));
    g.font = `800 ${font}px ui-sans-serif, system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    for (const p of sc.pops) {
      const k = clamp01((now - p.at) / POP_MS);
      const x = (p.x + 0.5) * cell;
      const y = Math.max(font * 0.7, (p.y + 0.5) * cell - cell * (0.7 + 1.5 * easeOut(k)));
      g.globalAlpha = 1 - k * k;
      g.strokeStyle = "rgba(14, 12, 29, 0.85)";
      g.lineWidth = Math.max(2, font * 0.22);
      g.strokeText(p.text, x, y);
      g.fillStyle = p.color;
      g.fillText(p.text, x, y);
    }
    g.globalAlpha = 1;
  }

  // Red flash when you crash.
  if (myDeathAge >= 0 && myDeathAge < 650) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    const k = 1 - myDeathAge / 650;
    const v = g.createRadialGradient(s.W / 2, s.H / 2, Math.min(s.W, s.H) * 0.2, s.W / 2, s.H / 2, Math.max(s.W, s.H) * 0.7);
    v.addColorStop(0, "rgba(255, 60, 90, 0)");
    v.addColorStop(1, `rgba(255, 60, 90, ${0.45 * k})`);
    g.fillStyle = v;
    g.fillRect(0, 0, s.W, s.H);
  }
}

export function Arena({
  view,
  me,
  colors,
  byId,
  intent,
  serverNow,
  reduced,
  steerable,
  onSteer,
  label,
  ringColor,
  children,
}: {
  view: SnakeView;
  me: string;
  colors: Record<string, string>;
  byId: Record<string, Player>;
  /** Direction you just steered, until the server applies it (null = none). */
  intent: Dir | null;
  serverNow: () => number;
  reduced: boolean;
  /** True when the viewer has a live snake and input matters. */
  steerable: boolean;
  onSteer: (dir: Dir) => void;
  label: string;
  ringColor: string;
  children?: ReactNode;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frames = useRef<Frames>({ prev: null, cur: null, at: 0 });
  const pops = useRef<Pop[]>([]);
  const foodSeen = useRef<Map<number, number>>(new Map());
  const surface = useRef<Surface | null>(null);
  /** What the canvas last showed once the board went still (final screen), to skip identical redraws. */
  const stillKey = useRef("");
  const gesture = useRef<{ id: number; x: number; y: number; moved: boolean; last: Dir | null; touch: boolean } | null>(null);
  const { w, h } = view;

  // Take in each new frame: remember the previous one for sliding, spot pellets and growth.
  useEffect(() => {
    const f = frames.current;
    const prev = f.cur;
    const now = performance.now();
    const fresh = !prev || prev.tick !== view.tick || prev.round !== view.round || prev.phase !== view.phase;
    if (!fresh) {
      f.cur = view;
      return;
    }
    const sameRound = !!prev && prev.round === view.round;
    f.prev = sameRound && prev.phase === "play" && view.phase === "play" && view.tick === prev.tick + 1 ? prev : null;
    f.cur = view;
    f.at = now;

    const seen = foodSeen.current;
    if (!sameRound) seen.clear();
    const present = new Set<number>();
    for (let i = 0; i < view.food.length; i += 2) {
      const key = view.food[i + 1] * view.w + view.food[i];
      present.add(key);
      if (!seen.has(key)) seen.set(key, now + (sameRound ? 0 : (i / 2) * 45));
    }
    for (const key of seen.keys()) if (!present.has(key)) seen.delete(key);

    if (sameRound && prev) {
      for (const sn of view.snakes) {
        const old = prev.snakes.find((o) => o.id === sn.id);
        if (!old) continue;
        if (sn.alive && old.alive && sn.len > old.len && sn.body.length >= 2) {
          pops.current.push({ x: sn.body[0], y: sn.body[1], text: `+${sn.len - old.len}`, color: colors[sn.id] ?? "#fff", at: now });
        }
        if (sn.id === me && old.alive && !sn.alive && window.matchMedia("(pointer: coarse)").matches) {
          navigator.vibrate?.(90);
        }
      }
    }
  }, [view, colors, me]);

  // Match the backing store to the element's size (crisp at any devicePixelRatio).
  useEffect(() => {
    const holder = holderRef.current;
    const canvas = canvasRef.current;
    if (!holder || !canvas) return;
    const fit = () => {
      const r = holder.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      const W = Math.round(r.width * dpr);
      const H = Math.round(r.height * dpr);
      const cur = surface.current;
      if (cur && cur.w === w && cur.h === h && cur.W === W && cur.H === H && cur.dpr === dpr) return;
      canvas.width = W;
      canvas.height = H;
      const cell = W / w;
      surface.current = {
        w,
        h,
        W,
        H,
        dpr,
        cell,
        cssCell: r.width / w,
        board: renderBoard(w, h, W, H),
        glow: renderGlow(cell * 1.15, FOOD_GLOW),
        gold: renderGlow(cell * 2, GOLD_GLOW),
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
  }, [w, h]);

  const paint = useEffectEvent((now: number) => {
    const canvas = canvasRef.current;
    const s = surface.current;
    if (!canvas || !s) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    const cur = frames.current.cur;
    // After the match the board stops changing: draw it a final time, then let the loop idle.
    if (cur?.phase === "final" && now - frames.current.at > 2000) {
      const key = `${s.W}x${s.H}|${cur.round}|${cur.tick}|${reduced}`;
      if (stillKey.current === key) return;
      stillKey.current = key;
    } else {
      stillKey.current = "";
    }
    const list = pops.current;
    if (list.length && now - list[0].at > POP_MS) pops.current = list.filter((p) => now - p.at < POP_MS);
    drawScene(g, {
      frames: frames.current,
      surface: s,
      pops: pops.current,
      foodSeen: foodSeen.current,
      intent,
      me,
      colors,
      byId,
      now,
      serverNow: serverNow(),
      reduced,
    });
  });

  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => {
      paint(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Swipe anywhere on the board (touch or mouse drag); tap beside your head to turn that way.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!steerable || (e.pointerType === "mouse" && e.button !== 0)) return;
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, last: null, touch: e.pointerType !== "mouse" };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already-released pointers can't be captured; swiping still works.
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const gs = gesture.current;
    if (!gs || gs.id !== e.pointerId) return;
    const dx = e.clientX - gs.x;
    const dy = e.clientY - gs.y;
    const threshold = Math.max(14, (surface.current?.cssCell ?? 10) * 1.1);
    if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return;
    const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    if (dir !== gs.last) onSteer(dir);
    gesture.current = { ...gs, x: e.clientX, y: e.clientY, moved: true, last: dir };
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const gs = gesture.current;
    gesture.current = null;
    if (!gs || gs.id !== e.pointerId || gs.moved || !gs.touch || !steerable) return;
    const s = surface.current;
    const mine = frames.current.cur?.snakes.find((x) => x.id === me);
    const holder = holderRef.current;
    if (!s || !mine?.alive || mine.body.length < 2 || !holder) return;
    const r = holder.getBoundingClientRect();
    const hx = r.left + (mine.body[0] + 0.5) * s.cssCell;
    const hy = r.top + (mine.body[1] + 0.5) * s.cssCell;
    const horizontal = mine.dir === "left" || mine.dir === "right";
    onSteer(horizontal ? (e.clientY < hy ? "up" : "down") : e.clientX < hx ? "left" : "right");
  };

  return (
    <div
      ref={holderRef}
      className="relative mx-auto w-full rounded-xl ring-2 transition-[box-shadow] duration-300 select-none"
      style={{
        aspectRatio: `${w} / ${h}`,
        maxWidth: `calc(62vh * ${w} / ${h})`,
        touchAction: steerable ? "none" : "auto",
        ["--tw-ring-color" as string]: ringColor,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        gesture.current = null;
      }}
    >
      <canvas ref={canvasRef} role="img" aria-label={label} className="absolute inset-0 h-full w-full rounded-xl" />
      {children}
    </div>
  );
}
