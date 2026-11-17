"use client";

// Canvas renderer and touch input for Snake Brawl.
//
// The server moves every snake one cell per tick (~9/s). Drawing those frames as they
// land would make snakes hop, so the renderer keeps a short buffer of server frames and
// plays them back a little behind the newest one, timed by the server's own step stamps
// (playback.ts): every snake glides cell to cell at display refresh rate, and how far behind
// adapts to the connection's measured jitter, so bunched or late deliveries never make snakes
// surge, stall or jump. React only re-renders when a frame arrives; everything here runs in
// one requestAnimationFrame loop.
//
// Your own snake is the exception: it's drawn by the predictor (predict.ts) on its own clock,
// a network trip ahead, so a turn shows up at the very next cell boundary and the eyes and a
// turn hint react on the frame you press. Eating and crashing are shown as your snake does
// them on your screen, not when the delayed playback gets there.

import { useEffect, useEffectEvent, useRef, type PointerEvent, type ReactNode } from "react";
import type { Player } from "@/shared/types";
import type { SnakeDelta, SnakeView } from "./server";
import { applyDelta } from "./delta";
import { DELTA, GHOST_MS, GOLDEN_VALUE, ROUND_MS, type Dir } from "./shared";
import { LUNGE, emptyShape, type Shape, type SnakePredictor } from "./predict";
import { SnakePlayback as Playback, type SnakeSnap as Snap } from "./playback";
import { debugFrame } from "./netsmooth";
import { drawAvatar } from "@/lib/avatar-art";
import { feedback, sfx } from "@/lib/feedback";

const TAU = Math.PI * 2;
const POP_MS = 850;
const RING_MS = 420;
const FOOD = "#fff3dc";
const FOOD_GLOW = "255, 205, 150";
const GOLD = "#ffd34d";
const GOLD_GLOW = "255, 196, 40";
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const SANS = "ui-sans-serif, system-ui, sans-serif";
const SPAWN_MS = 520;
/** A pellet your snake just ate stays hidden this long while the delayed board catches up. */
const EATEN_MS = 1_500;

// ---------- playback clock ----------

// ---------- surfaces & small helpers ----------

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
  /** Red edge vignette for your own crash (tiny; scaled up when drawn). */
  hurt: HTMLCanvasElement;
  youFont: string;
  emojiFont: string;
  crownFont: string;
  popFont: string;
  popBigFont: string;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

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

function renderHurt() {
  const c = makeCanvas(96, 72);
  const g = c.getContext("2d");
  if (!g) return c;
  const v = g.createRadialGradient(48, 36, 16, 48, 36, 62);
  v.addColorStop(0, "rgba(255, 60, 90, 0)");
  v.addColorStop(1, "rgba(255, 60, 90, 0.5)");
  g.fillStyle = v;
  g.fillRect(0, 0, 96, 72);
  return c;
}

const shadeCache = new Map<string, string>();
/** The colour mixed toward black (f = 0..1), as rgb(). Cached: called only when frames change. */
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

const dirOf = (dx: number, dy: number): Dir =>
  Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "down" : "up";

/** Head position and heading of the last traced snake (cell units). Scratch values: no allocation per frame. */
let HX = 0;
let HY = 0;
let HDX = 1;
let HDY = 0;

/**
 * Trace a snake as one polyline. `body` is flat [x, y, ...] (head first). The head is pulled
 * back `r` cells along the body (it's still travelling into its newest cell), or pushed
 * `lunge` cells forward when it is crashing; the tail is stretched `e` cells back along the
 * cells it is leaving (`ext`, flat, nearest first).
 */
function traceSnake(
  g: CanvasRenderingContext2D,
  body: number[],
  cell: number,
  r: number,
  lungeDir: Dir | null,
  lunge: number,
  ext: number[] | null,
  extFrom: number,
  extCount: number,
  e: number,
) {
  const n = body.length >> 1;
  let start: number;
  if (lungeDir) {
    const [dx, dy] = DELTA[lungeDir];
    HX = body[0] + dx * lunge;
    HY = body[1] + dy * lunge;
    HDX = dx;
    HDY = dy;
    start = 0;
  } else {
    let k = Math.floor(r);
    let f = r - k;
    if (k >= n - 1) {
      k = Math.max(0, n - 2);
      f = n > 1 ? 1 : 0;
    }
    const x0 = body[2 * k];
    const y0 = body[2 * k + 1];
    const x1 = n > 1 ? body[2 * k + 2] : x0;
    const y1 = n > 1 ? body[2 * k + 3] : y0;
    HX = x0 + (x1 - x0) * f;
    HY = y0 + (y1 - y0) * f;
    if (x0 !== x1 || y0 !== y1) {
      HDX = x0 - x1;
      HDY = y0 - y1;
    }
    start = k + 1;
  }
  g.beginPath();
  g.moveTo((HX + 0.5) * cell, (HY + 0.5) * cell);
  for (let j = start; j < n; j++) g.lineTo((body[2 * j] + 0.5) * cell, (body[2 * j + 1] + 0.5) * cell);
  if (ext && e > 0 && extCount > 0) {
    let px = body[2 * n - 2];
    let py = body[2 * n - 1];
    const whole = Math.min(extCount, Math.floor(e));
    for (let j = 0; j < whole; j++) {
      px = ext[2 * (extFrom + j)];
      py = ext[2 * (extFrom + j) + 1];
      g.lineTo((px + 0.5) * cell, (py + 0.5) * cell);
    }
    const f = e - whole;
    if (f > 0 && whole < extCount) {
      const qx = ext[2 * (extFrom + whole)];
      const qy = ext[2 * (extFrom + whole) + 1];
      g.lineTo((px + (qx - px) * f + 0.5) * cell, (py + (qy - py) * f + 0.5) * cell);
    }
  }
}

/** Trace your predicted snake (see predict.ts) the same way, setting HX/HY/HDX/HDY. */
function traceShape(g: CanvasRenderingContext2D, sh: Shape, cell: number) {
  const pts = sh.pts;
  HX = sh.hx;
  HY = sh.hy;
  HDX = sh.dx;
  HDY = sh.dy;
  let from = 2;
  if (sh.lunge) {
    const [dx, dy] = DELTA[sh.lunge];
    HX += dx * sh.lungeAmt;
    HY += dy * sh.lungeAmt;
    HDX = dx;
    HDY = dy;
    from = 0;
  }
  g.beginPath();
  g.moveTo((HX + 0.5) * cell, (HY + 0.5) * cell);
  for (let i = from; i + 1 < pts.length; i += 2) g.lineTo((pts[i] + 0.5) * cell, (pts[i + 1] + 0.5) * cell);
}

function strokeBody(g: CanvasRenderingContext2D, cell: number, color: string, dark: string) {
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

function drawEye(g: CanvasRenderingContext2D, ex: number, ey: number, dx: number, dy: number, cell: number, dead: boolean) {
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
    return;
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

function drawHead(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: Dir,
  cell: number,
  color: string,
  dark: string,
  dead: boolean,
  scale = 1,
) {
  const cx = (x + 0.5) * cell;
  const cy = (y + 0.5) * cell;
  const c = cell * scale;
  g.beginPath();
  g.arc(cx, cy, c * 0.52, 0, TAU);
  g.fillStyle = dark;
  g.fill();
  g.beginPath();
  g.arc(cx, cy, c * 0.41, 0, TAU);
  g.fillStyle = color;
  g.fill();
  const [dx, dy] = DELTA[dir];
  const px = -dy;
  const py = dx;
  drawEye(g, cx + (dx * 0.14 - px * 0.22) * c, cy + (dy * 0.14 - py * 0.22) * c, dx, dy, c, dead);
  drawEye(g, cx + (dx * 0.14 + px * 0.22) * c, cy + (dy * 0.14 + py * 0.22) * c, dx, dy, c, dead);
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
  g.font = s.youFont;
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

/** Your queued turn, shown the moment you press it: an arrow in the cell where the turn happens. */
function drawTurnHint(g: CanvasRenderingContext2D, x: number, y: number, dir: Dir, cell: number, alpha: number) {
  const [dx, dy] = DELTA[dir];
  const px = -dy;
  const py = dx;
  const cx = (x + 0.5 + dx * 0.55) * cell;
  const cy = (y + 0.5 + dy * 0.55) * cell;
  g.globalAlpha = alpha;
  g.strokeStyle = "#ffffff";
  g.lineWidth = Math.max(1.5, cell * 0.14);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(cx - dx * cell * 0.16 + px * cell * 0.26, cy - dy * cell * 0.16 + py * cell * 0.26);
  g.lineTo(cx + dx * cell * 0.16, cy + dy * cell * 0.16);
  g.lineTo(cx - dx * cell * 0.16 - px * cell * 0.26, cy - dy * cell * 0.16 - py * cell * 0.26);
  g.stroke();
  g.globalAlpha = 1;
}

// ---------- scene state ----------

/** A live snake as it is drawn between the frame on screen (a) and the next one (b). */
interface Pair {
  id: string;
  color: string;
  dark: string;
  isMe: boolean;
  /** Polyline to draw. */
  body: number[];
  /** Cells the head is pulled back along `body` at the start of the step (0 = static). */
  retract: number;
  /** Crash direction when the snake dies on this step. */
  lunge: Dir | null;
  /** Cells the tail is leaving, from the earlier frame's body. */
  ext: number[] | null;
  extFrom: number;
  extCount: number;
  dir: Dir;
}

interface Ghost {
  body: number[];
  dir: Dir;
  /** Crashed into something (the head stays pushed into it), rather than leaving the game. */
  crashed: boolean;
  color: string;
  dark: string;
  at: number;
}

interface Fx {
  kind: "pop" | "ring";
  x: number;
  y: number;
  text: string;
  color: string;
  big: boolean;
  at: number;
}

interface Scene {
  pb: Playback;
  /** Frame whose events (eats, deaths, new pellets) were last applied. */
  shown: SnakeView | null;
  pairsA: SnakeView | null;
  pairsB: SnakeView | null;
  pairs: Pair[];
  ghosts: Map<string, Ghost>;
  fx: Fx[];
  foodSeen: Map<number, number>;
  goldenAt: number;
  myDeathAt: number;
  roundAt: number;
  /** Your head on screen (cells), for tap-to-turn. */
  myX: number;
  myY: number;
  myAlive: boolean;
  /** Heading of every live snake in the newest frame: eyes look where a snake is about to go. */
  aheadOf: SnakeView | null;
  ahead: Map<string, Dir>;
  /** Last drawn state once the match is over, to skip identical redraws. */
  stillKey: string;
  /** Your predicted snake this frame. */
  mine: Shape;
  /** Drawn from the predictor this frame (so the playback copy is skipped). */
  minePredicted: boolean;
  /** Round in which your crash was already shown (as soon as the server reported it). */
  myCrashRound: number;
  /** Last step whose cell your head has reached on screen (for eating). */
  eatStep: number;
  eatRound: number;
  /** Pellets your snake ate on screen: cell -> hide until (performance.now()). */
  eaten: Map<number, number>;
}

function newScene(): Scene {
  return {
    pb: new Playback(),
    shown: null,
    pairsA: null,
    pairsB: null,
    pairs: [],
    ghosts: new Map(),
    fx: [],
    foodSeen: new Map(),
    goldenAt: -1e9,
    myDeathAt: -1e9,
    roundAt: -1e9,
    myX: 0,
    myY: 0,
    myAlive: false,
    aheadOf: null,
    ahead: new Map(),
    stillKey: "",
    mine: emptyShape(),
    minePredicted: false,
    myCrashRound: -1,
    eatStep: -1,
    eatRound: -1,
    eaten: new Map(),
  };
}

/** The latest props, as the render loop sees them (one mutable object: no allocation per frame). */
interface Props {
  me: string;
  colors: Record<string, string>;
  byId: Record<string, Player>;
  pred: SnakePredictor;
  reduced: boolean;
  serverNow: number;
}

const colorOf = (p: Props, id: string) => p.colors[id] ?? "#94a3b8";

/** Apply what happened between the frame that was on screen and the one now on screen. */
function applyFrame(sc: Scene, view: SnakeView, p: Props, now: number) {
  const prev = sc.shown;
  sc.shown = view;
  const seen = sc.foodSeen;
  if (!prev || prev.round !== view.round) {
    // A fresh board: pellets pop in one after another.
    seen.clear();
    sc.ghosts.clear();
    sc.fx.length = 0;
    sc.goldenAt = view.golden ? now : -1e9;
    for (let i = 0; i < view.food.length; i += 2) {
      seen.set(view.food[i + 1] * view.w + view.food[i], now + (i / 2) * (p.reduced ? 0 : 45));
    }
    return;
  }
  const present = new Set<number>();
  for (let i = 0; i < view.food.length; i += 2) {
    const key = view.food[i + 1] * view.w + view.food[i];
    present.add(key);
    if (!seen.has(key)) seen.set(key, now);
  }
  for (const key of seen.keys()) if (!present.has(key)) seen.delete(key);
  if (view.golden && (!prev.golden || prev.golden[0] !== view.golden[0] || prev.golden[1] !== view.golden[1])) {
    sc.goldenAt = now;
  }

  for (const sn of view.snakes) {
    const old = prev.snakes.find((o) => o.id === sn.id);
    if (!old || !old.alive) continue;
    const color = colorOf(p, sn.id);
    if (!sn.alive) {
      if (sn.id === p.me && sc.myCrashRound === view.round) continue; // already shown
      crashFx(sc, sn, old.body, view, p, color, now);
    } else if (sn.id === p.me) {
      continue; // your bites pop as your (predicted) head reaches them
    } else if (sn.len > old.len && sn.body.length >= 2) {
      const n = sn.len - old.len;
      const big = n >= 3;
      sc.fx.push({ kind: "ring", x: sn.body[0], y: sn.body[1], text: "", color: big ? GOLD : color, big, at: now });
      sc.fx.push({ kind: "pop", x: sn.body[0], y: sn.body[1], text: `+${n}`, color: big ? GOLD : color, big, at: now });
    }
  }
}

/** A snake crashed (or left): its ghost flashes where it died; your own crash shakes the screen. */
function crashFx(sc: Scene, sn: SnakeView["snakes"][number], oldBody: number[], view: SnakeView, p: Props, color: string, now: number) {
  const body = sn.body.length >= 4 ? sn.body : oldBody;
  const crashed = !view.feed.some((f) => f.id === sn.id && f.cause === "left");
  if (body.length >= 4) sc.ghosts.set(sn.id, { body, dir: sn.dir, crashed, color, dark: shade(color, 0.55), at: now });
  if (sn.id === p.me) {
    sc.myDeathAt = now;
    sc.myCrashRound = view.round;
    feedback("out");
  } else if (crashed) {
    sfx("out");
  }
}

/** Work out how every live snake moves from frame a to frame b. Runs only when either changes. */
function buildPairs(sc: Scene, a: Snap, b: Snap | null, p: Props) {
  sc.pairsA = a.view;
  sc.pairsB = b?.view ?? null;
  const out: Pair[] = [];
  const gap = b ? b.tick - a.tick : 0;
  for (const sa of a.view.snakes) {
    if (!sa.alive || sa.body.length < 4) continue;
    const color = colorOf(p, sa.id);
    const pair: Pair = {
      id: sa.id,
      color,
      dark: shade(color, 0.55),
      isMe: sa.id === p.me,
      body: sa.body,
      retract: 0,
      lunge: null,
      ext: null,
      extFrom: 0,
      extCount: 0,
      dir: sa.dir,
    };
    const sb = b?.view.snakes.find((o) => o.id === sa.id);
    if (sb && gap > 0) {
      if (!sb.alive) {
        // Crashed on this step: the head pushes into whatever it hit, then the ghost takes over.
        pair.lunge = sb.dir;
        pair.dir = sb.dir;
      } else if (
        sb.body.length >= 2 * (gap + 2) &&
        sb.body[2 * gap] === sa.body[0] &&
        sb.body[2 * gap + 1] === sa.body[1]
      ) {
        // The newest frame's body already holds the path the head takes to get there.
        const na = sa.body.length >> 1;
        const nb = sb.body.length >> 1;
        const leaving = Math.max(0, Math.min(gap, na - 1, gap - (nb - na)));
        pair.body = sb.body;
        pair.retract = gap;
        pair.ext = sa.body;
        pair.extFrom = na - leaving;
        pair.extCount = leaving;
        pair.dir = sb.dir;
      } else {
        pair.body = sb.body; // can't tell how it got there: snap
        pair.dir = sb.dir;
      }
    }
    out.push(pair);
  }
  // Yours on top.
  out.sort((x, y) => Number(x.isMe) - Number(y.isMe));
  sc.pairs = out;
}

function drawScene(g: CanvasRenderingContext2D, sc: Scene, s: Surface, p: Props, now: number) {
  const pb = sc.pb;
  const a = pb.snaps[0];
  if (!a) return;
  const b = pb.snaps.length > 1 ? pb.snaps[1] : null;
  const k = b ? clamp01((pb.t - a.tick) / (b.tick - a.tick)) : 0;
  if (a.view !== sc.shown) applyFrame(sc, a.view, p, now);
  if (a.view !== sc.pairsA || (b?.view ?? null) !== sc.pairsB) buildPairs(sc, a, b, p);
  const view = a.view;
  const latest = pb.snaps[pb.snaps.length - 1].view;
  if (latest !== sc.aheadOf) {
    sc.aheadOf = latest;
    sc.ahead.clear();
    for (const sn of latest.snakes) if (sn.alive) sc.ahead.set(sn.id, sn.dir);
  }
  const { cell, dpr } = s;
  const reduced = p.reduced;

  // Your snake, from the predictor: where it is on your clock, and the pellets it reaches.
  const pred = p.pred;
  const tau = pred.advance(now, p.serverNow);
  sc.minePredicted = pred.shapeSmooth(tau, sc.mine);
  debugFrame("snakes", { t: now, x: sc.mine.hx, y: sc.mine.hy, on: sc.minePredicted ? 1 : 0, pb: pb.t, tau });
  if (sc.eaten.size) for (const [c, until] of sc.eaten) if (until <= now) sc.eaten.delete(c);
  if (sc.minePredicted) {
    const reached = Math.floor(sc.mine.lunge ? pred.deathAt - 1 : tau);
    if (sc.eatRound !== latest.round || reached < sc.eatStep || reached - sc.eatStep > 4) {
      sc.eatRound = latest.round;
      sc.eatStep = reached;
    }
    for (let t = sc.eatStep + 1; t <= reached; t++) {
      const c = pred.headAt(t);
      if (c < 0 || sc.eaten.has(c)) continue;
      const x = c % view.w;
      const y = (c - x) / view.w;
      const gold = isAt(view.golden, x, y) || isAt(latest.golden, x, y);
      if (!gold && !hasFood(view, x, y) && !hasFood(latest, x, y)) continue;
      sc.eaten.set(c, now + EATEN_MS);
      const color = gold ? GOLD : colorOf(p, p.me);
      const n = gold ? GOLDEN_VALUE : 1;
      sc.fx.push({ kind: "ring", x, y, text: "", color, big: gold, at: now });
      sc.fx.push({ kind: "pop", x, y, text: `+${n}`, color, big: gold, at: now });
      if (gold) feedback("score");
      else sfx("pop");
    }
    sc.eatStep = Math.max(sc.eatStep, reached);
  }

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, s.W, s.H);

  const hurtAge = now - sc.myDeathAt;
  if (!reduced && hurtAge >= 0 && hurtAge < 420) {
    const amp = cell * 0.3 * (1 - hurtAge / 420);
    g.translate(Math.sin(now * 0.09) * amp, Math.cos(now * 0.113) * amp);
  }
  g.drawImage(s.board, 0, 0);

  // Food: soft glow, pop in when spawned, gentle breathing.
  const glowR = cell * 1.15;
  g.fillStyle = FOOD;
  for (let i = 0; i < view.food.length; i += 2) {
    const x = view.food[i];
    const y = view.food[i + 1];
    if (sc.eaten.has(y * view.w + x)) continue;
    const born = sc.foodSeen.get(y * view.w + x) ?? 0;
    const t = reduced ? 1 : clamp01((now - born) / 260);
    if (t <= 0) continue;
    const kk = t < 1 ? easeOutBack(t) : 1;
    const cx = (x + 0.5) * cell;
    const cy = (y + 0.5) * cell;
    const breathe = reduced ? 1 : 1 + 0.09 * Math.sin(now / 330 + x * 1.7 + y * 2.3);
    g.globalAlpha = Math.min(1, t * 1.4);
    g.drawImage(s.glow, cx - glowR * kk, cy - glowR * kk, glowR * 2 * kk, glowR * 2 * kk);
    g.beginPath();
    g.arc(cx, cy, cell * 0.2 * kk * breathe, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;

  // Golden pellet: spinning star with a pulsing halo.
  if (view.golden && !sc.eaten.has(view.golden[1] * view.w + view.golden[0])) {
    const [x, y] = view.golden;
    const cx = (x + 0.5) * cell;
    const cy = (y + 0.5) * cell;
    const grow = reduced ? 1 : easeOutBack(clamp01((now - sc.goldenAt) / 420));
    const pulse = reduced ? 1 : 1 + 0.18 * Math.sin(now / 180);
    const r = cell * 2 * pulse * grow;
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
    star(g, cx, cy, cell * 0.56 * grow, cell * 0.25 * grow, reduced ? 0 : now / 700);
    g.fillStyle = GOLD;
    g.fill();
    g.strokeStyle = "#fff7cc";
    g.lineWidth = Math.max(1, cell * 0.07);
    g.stroke();
  }

  // Ghosts of the freshly crashed: white flash, flicker out, burst at the head.
  for (const [id, gh] of sc.ghosts) {
    const age = now - gh.at;
    if (age > GHOST_MS) {
      sc.ghosts.delete(id);
      continue;
    }
    const t = age / GHOST_MS;
    const flicker = reduced ? 1 : 0.7 + 0.3 * Math.cos(age / 35);
    g.globalAlpha = (1 - t) * flicker;
    const flash = age < 150 ? "#ffffff" : gh.color;
    traceSnake(g, gh.body, cell, 0, gh.crashed ? gh.dir : null, LUNGE, null, 0, 0, 0);
    strokeBody(g, cell, flash, gh.dark);
    const gx = HX;
    const gy = HY;
    drawHead(g, gx, gy, gh.dir, cell, flash, gh.dark, true);
    const burst = clamp01(age / 650);
    const hx = (gx + 0.5) * cell;
    const hy = (gy + 0.5) * cell;
    g.globalAlpha = 1 - burst;
    g.strokeStyle = gh.color;
    g.lineWidth = Math.max(1, cell * 0.2 * (1 - burst));
    g.beginPath();
    g.arc(hx, hy, cell * (0.6 + 2.6 * easeOut(burst)), 0, TAU);
    g.stroke();
    if (!reduced) {
      g.fillStyle = gh.color;
      const spin = gh.at % 7;
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * TAU + spin;
        const d = cell * (0.5 + 3 * easeOut(burst) * (0.7 + (i % 3) * 0.15));
        const sz = cell * 0.24 * (1 - burst);
        g.fillRect(hx + Math.cos(ang) * d - sz / 2, hy + Math.sin(ang) * d - sz / 2, sz, sz);
      }
    }
  }
  g.globalAlpha = 1;

  // Live snakes, gliding between frames.
  // Crown the round winner during the break, and the match champions (maybe by forfeit) at the end.
  const crowned = (id: string) =>
    latest.phase === "final" ? !!latest.champions?.includes(id) : latest.phase === "roundOver" && latest.lastRoundWinner === id;
  const spawn = reduced ? 1 : clamp01((now - sc.roundAt) / SPAWN_MS);
  const headScale = spawn < 1 ? Math.max(0.2, easeOutBack(spawn)) : 1;
  sc.myAlive = false;
  const live: LiveStyle = { spawn, headScale, phase: latest.phase, w: view.w, reduced, now };
  for (const pr of sc.pairs) {
    if (pr.isMe && sc.minePredicted) continue;
    const back = pr.retract * (1 - k);
    const lunge = pr.lunge ? Math.min(k, LUNGE) : 0;
    traceSnake(g, pr.body, cell, back, pr.lunge, lunge, pr.ext, pr.extFrom, pr.extCount, pr.extCount * (1 - k));
    // Eyes look where the snake is about to go (the newest frame is a moment ahead of the glide).
    const eyes = pr.lunge ?? sc.ahead.get(pr.id) ?? dirOf(HDX, HDY);
    paintLive(g, s, sc, live, pr.color, pr.dark, pr.isMe, crowned(pr.id), eyes, pr.dir, !pr.lunge);
  }
  if (sc.minePredicted) {
    // Yours, on top: on your own clock, eyes on the turn you just pressed.
    const sh = sc.mine;
    const color = colorOf(p, p.me);
    traceShape(g, sh, cell);
    const travel = dirOf(HDX, HDY);
    paintLive(g, s, sc, live, color, shade(color, 0.55), true, crowned(p.me), sh.eyes, travel, !sh.lunge);
    if (sh.hint) drawTurnHint(g, sh.hintX, sh.hintY, sh.hint, cell, 0.85);
  }

  // Who's who: arrows and labels before the round starts (and the YOU tag a moment after).
  const playAge = latest.phase === "play" ? p.serverNow - (latest.endsAt - (latest.roundMs || ROUND_MS)) : Infinity;
  if (latest.phase === "countdown" || playAge < 1600) {
    const fade = latest.phase === "countdown" ? spawn : clamp01(1 - playAge / 1600);
    const bob = reduced ? 0 : Math.sin(now / 210) * cell * 0.14;
    for (const sn of latest.snakes) {
      if (!sn.alive || sn.body.length < 2) continue;
      const color = colorOf(p, sn.id);
      const isMe = sn.id === p.me;
      const hx = isMe && sc.myAlive ? sc.myX : sn.body[0];
      const hy = isMe && sc.myAlive ? sc.myY : sn.body[1];
      const place = placeFor(hx, hy, sn.dir, view.w);
      if (latest.phase === "countdown") {
        const heading = isMe && sc.minePredicted ? sc.mine.eyes : sn.dir;
        g.globalAlpha = 1;
        drawChevron(g, hx, hy, heading, cell, color, (reduced ? 0.9 : 0.6 + 0.35 * Math.sin(now / 160)) * spawn);
      }
      if (isMe) {
        drawYouTag(g, hx, hy, place, s, bob, fade);
      } else if (latest.phase === "countdown") {
        g.globalAlpha = spawn;
        g.font = s.emojiFont;
        g.textAlign = "center";
        g.textBaseline = "middle";
        const [vx, vy] = PLACE[place];
        drawAvatar(g, p.byId[sn.id]?.avatar ?? "🐍", (hx + 0.5 + vx * 1.3) * cell, (hy + 0.5 + vy * 1.2) * cell);
        g.globalAlpha = 1;
      }
    }
  }

  // Bites: a ring where a pellet was eaten and a floating +N.
  if (sc.fx.length) {
    if (now - sc.fx[0].at > POP_MS) sc.fx = sc.fx.filter((f) => now - f.at < POP_MS);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    for (const f of sc.fx) {
      const cx = (f.x + 0.5) * cell;
      const cy = (f.y + 0.5) * cell;
      if (f.kind === "ring") {
        const t = (now - f.at) / RING_MS;
        if (t >= 1 || reduced) continue;
        g.globalAlpha = 1 - t;
        g.strokeStyle = f.color;
        g.lineWidth = Math.max(1, cell * (f.big ? 0.22 : 0.14) * (1 - t));
        g.beginPath();
        g.arc(cx, cy, cell * (0.4 + (f.big ? 2.2 : 1.2) * easeOut(t)), 0, TAU);
        g.stroke();
        continue;
      }
      const t = clamp01((now - f.at) / POP_MS);
      const font = f.big ? s.popBigFont : s.popFont;
      const size = (f.big ? 1.35 : 1) * Math.max(11 * dpr, cell * 0.95);
      const scale = reduced ? 1 : t < 0.18 ? 0.6 + (t / 0.18) * 0.55 : t < 0.3 ? 1.15 - ((t - 0.18) / 0.12) * 0.15 : 1;
      const y = Math.max(size * 0.7, cy - cell * (0.7 + (reduced ? 0.6 : 1.5 * easeOut(t))));
      g.font = font;
      g.globalAlpha = 1 - t * t;
      g.save();
      g.translate(cx, y);
      if (scale !== 1) g.scale(scale, scale);
      g.strokeStyle = "rgba(14, 12, 29, 0.85)";
      g.lineWidth = Math.max(2, size * 0.22);
      g.strokeText(f.text, 0, 0);
      g.fillStyle = f.color;
      g.fillText(f.text, 0, 0);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  // Red flash at the edges when you crash.
  if (hurtAge >= 0 && hurtAge < 650) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = (1 - hurtAge / 650) * (reduced ? 0.6 : 1);
    g.drawImage(s.hurt, 0, 0, s.W, s.H);
    g.globalAlpha = 1;
  }
}

interface LiveStyle {
  spawn: number;
  headScale: number;
  phase: SnakeView["phase"];
  w: number;
  reduced: boolean;
  now: number;
}

/** Stroke the snake just traced (body, head, your ring, a champion's glow and crown). */
function paintLive(
  g: CanvasRenderingContext2D,
  s: Surface,
  sc: Scene,
  st: LiveStyle,
  color: string,
  dark: string,
  isMe: boolean,
  champ: boolean,
  eyes: Dir,
  dir: Dir,
  alive: boolean,
) {
  const { cell } = s;
  if (st.spawn < 1) g.globalAlpha = st.spawn;
  if (champ) {
    g.save();
    g.shadowColor = color;
    g.shadowBlur = cell * (1.2 + (st.reduced ? 0 : 0.5 * Math.sin(st.now / 200)));
    strokeBody(g, cell, color, dark);
    g.restore();
  } else {
    strokeBody(g, cell, color, dark);
  }
  const hx = HX;
  const hy = HY;
  drawHead(g, hx, hy, eyes, cell, color, dark, false, st.headScale);
  g.globalAlpha = 1;
  if (isMe) {
    sc.myX = hx;
    sc.myY = hy;
    sc.myAlive = alive;
    if (st.phase !== "countdown") {
      g.globalAlpha = 0.9;
      g.strokeStyle = "#ffffff";
      g.lineWidth = Math.max(1, cell * 0.09);
      g.beginPath();
      g.arc((hx + 0.5) * cell, (hy + 0.5) * cell, cell * 0.68, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
    }
  }
  if (champ) {
    g.font = s.crownFont;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const lift = 1.2 + (st.reduced ? 0 : Math.sin(st.now / 240) * 0.12);
    const [vx, vy] = PLACE[placeFor(hx, hy, dir, st.w)];
    g.fillText("👑", (hx + 0.5 + vx * lift) * cell, (hy + 0.5 + vy * lift) * cell);
  }
}

const isAt = (cell: [number, number] | null, x: number, y: number) => !!cell && cell[0] === x && cell[1] === y;
function hasFood(v: SnakeView, x: number, y: number) {
  for (let i = 0; i + 1 < v.food.length; i += 2) if (v.food[i] === x && v.food[i + 1] === y) return true;
  return false;
}

/** True while something on the board is still animating (so the final screen can go idle). */
function busy(sc: Scene, now: number) {
  return sc.fx.length > 0 || sc.ghosts.size > 0 || now - sc.myDeathAt < 700 || sc.pb.snaps.length > 1;
}

export function Arena({
  view,
  steps,
  deltas,
  me,
  colors,
  byId,
  pred,
  serverNow,
  reduced,
  steerable,
  onSteer,
  label,
  ringColor,
  children,
}: {
  view: SnakeView;
  /** Every step since the last full view, ending with `view` (several can land in one render). */
  steps?: SnakeView[];
  /** The step deltas heard lately: they fill in steps a full view skipped over. */
  deltas?: SnakeDelta[];
  me: string;
  colors: Record<string, string>;
  byId: Record<string, Player>;
  /** Your snake's prediction (fed every frame here; turns go in through the client). */
  pred: SnakePredictor;
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
  const scene = useRef<Scene>(newScene());
  const live = useRef<Props>({ me, colors, byId, pred, reduced, serverNow: 0 });
  const surface = useRef<Surface | null>(null);
  const gesture = useRef<{ id: number; x: number; y: number; moved: boolean; last: Dir | null; touch: boolean } | null>(null);
  const { w, h } = view;

  // Feed each new server frame into the playback buffer and your snake's predictor.
  const onFrame = useEffectEvent((v: SnakeView, all: SnakeView[] | undefined, heard: SnakeDelta[] | undefined) => {
    const sc = scene.current;
    const perf = performance.now();
    pred.attachClock(sc.pb.clock);
    const before = sc.pb.snaps[sc.pb.snaps.length - 1]?.view;
    // Play every step, not just the newest: a bunched delivery is still several steps of motion.
    const list = all && all.length && all[all.length - 1] === v ? all : [v];
    for (const step of list) {
      const last = sc.pb.snaps[sc.pb.snaps.length - 1];
      if (step !== v && last && step.round === last.view.round && step.tick <= last.tick) continue;
      // A full view that skipped steps (it came in the same bunch as their deltas): play those too.
      if (last && heard && step.round === last.view.round && step.phase === "play" && last.view.phase === "play") {
        let cur = last.view;
        for (const d of heard) {
          if (d.r !== cur.round || d.n <= cur.tick || d.n >= step.tick) continue;
          const next = applyDelta(cur, d, me);
          if (!next) break;
          sc.pb.push(next, perf);
          cur = next;
        }
      }
      if (sc.pb.push(step, perf)) {
        const roundChanged = !sc.shown || sc.shown.round !== step.round;
        sc.shown = roundChanged ? null : sc.shown;
        if (roundChanged) sc.roundAt = step.phase === "countdown" ? perf : -1e9;
      }
    }
    pred.ingest(v, me, serverNow(), perf);
    // Your crash shows the moment the server reports it: your snake runs ahead of the playback.
    const was = before?.round === v.round ? before.snakes.find((x) => x.id === me) : undefined;
    const now = v.snakes.find((x) => x.id === me);
    if (was?.alive && now && !now.alive && sc.myCrashRound !== v.round) {
      const p = live.current;
      p.me = me;
      p.colors = colors;
      crashFx(sc, now, was.body, v, p, colors[me] ?? "#94a3b8", perf);
    }
  });
  useEffect(() => onFrame(view, steps, deltas), [view, steps, deltas]);

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
      const popSize = Math.round(Math.max(11 * dpr, cell * 0.95));
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
        hurt: renderHurt(),
        youFont: `800 ${Math.round(Math.max(10 * dpr, cell * 0.78))}px ${SANS}`,
        emojiFont: `${Math.round(Math.max(12 * dpr, cell * 1.05))}px ${EMOJI_FONT}`,
        crownFont: `${Math.round(Math.max(12 * dpr, cell * 1.1))}px ${EMOJI_FONT}`,
        popFont: `800 ${popSize}px ${SANS}`,
        popBigFont: `900 ${Math.round(popSize * 1.35)}px ${SANS}`,
      };
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
  }, [w, h]);

  const paint = useEffectEvent((now: number) => {
    const canvas = canvasRef.current;
    const s = surface.current;
    const sc = scene.current;
    if (!canvas || !s) return;
    sc.pb.advance(now);
    const latest = sc.pb.snaps[sc.pb.snaps.length - 1]?.view;
    if (!latest) return;
    // After the match the board stops changing: draw it once more, then let the loop idle.
    if (latest.phase === "final" && !busy(sc, now)) {
      const key = `${s.W}x${s.H}|${latest.tick}|${reduced}|${sc.shown === latest}`;
      if (sc.stillKey === key) return;
      sc.stillKey = key;
    } else {
      sc.stillKey = "";
    }
    const g = canvas.getContext("2d");
    if (!g) return;
    const p = live.current;
    p.me = me;
    p.colors = colors;
    p.byId = byId;
    p.pred = pred;
    p.reduced = reduced;
    p.serverNow = serverNow();
    drawScene(g, sc, s, p, now);
  });

  // One animation loop; it stops while the tab is hidden and resumes on the newest frame.
  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      paint(t);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      scene.current.pb.at = -1;
      raf = requestAnimationFrame(loop);
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        scene.current.pb.snapToEnd();
        start();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
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
    // A short flick is enough on phones; a cell or so on big boards.
    const threshold = Math.min(28, Math.max(12, (surface.current?.cssCell ?? 10) * 1.1));
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
    const sc = scene.current;
    const latest = sc.pb.snaps[sc.pb.snaps.length - 1]?.view;
    const mine = latest?.snakes.find((x) => x.id === me);
    const holder = holderRef.current;
    if (!s || !mine?.alive || !sc.myAlive || !holder) return;
    // Measured from the head as it is drawn right now, which is what the player is looking at.
    const r = holder.getBoundingClientRect();
    const hx = r.left + (sc.myX + 0.5) * s.cssCell;
    const hy = r.top + (sc.myY + 0.5) * s.cssCell;
    const heading = pred.upcoming();
    const horizontal = heading === "left" || heading === "right";
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
