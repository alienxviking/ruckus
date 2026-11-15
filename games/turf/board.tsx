"use client";

// Canvas renderer for Turf War. Pure presentation: the server owns every rule.
//
// The server moves painters one tile per tick (~8/s). The renderer keeps a short buffer
// of server frames and plays them back on its own clock, a little behind the newest
// one, so heads glide tile to tile at display refresh rate and the paint "rolls out"
// under them. Settled territory lives on an offscreen layer rebuilt only when playback
// reaches the next frame; heads, power-ups, rollers, fill flashes and score pops are
// drawn on top every frame.

import { useEffect, useRef, type ReactNode } from "react";
import type { PainterTuple, TurfEvent, TurfView } from "./server";
import { DX, DY, POWER_INFO, POWER_KINDS, TICK_MS, type PowerKind } from "./shared";

export interface Painter {
  id: string;
  x: number;
  y: number;
  dir: number;
  /** Tiles owned. */
  n: number;
  /** Open-loop length (tiles painted since leaving their turf). */
  out: number;
  dash: number;
  frozen: number;
}

export function parsePainters(list: PainterTuple[]): Painter[] {
  return list.map(([id, x, y, dir, n, out, dash, frozen]) => ({ id, x, y, dir, n, out, dash, frozen }));
}

// ---------- colours & textures (shared with the standings) ----------

type RGB = [number, number, number];
const INK: RGB = [14, 12, 29];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0x94a3b8;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function mix(a: RGB, b: RGB, t: number): string {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface Palette {
  base: string;
  fill: string;
  edge: string;
  trail: string;
}

function palette(hex: string): Palette {
  const c = hexToRgb(hex);
  // Settled turf is a shade deeper (plus texture); open loops glow in the pure colour.
  return { base: hex, fill: mix(c, INK, 0.3), edge: mix(c, BLACK, 0.55), trail: mix(c, WHITE, 0.06) };
}

/**
 * Every painter's turf also gets a texture (by painter index), so territory
 * never relies on colour alone. `textureCss` draws the same thing for legends.
 */
const TEXTURE_INK = "rgba(0, 0, 0, 0.2)";

function drawTexture(g: CanvasRenderingContext2D, kind: number, s: number) {
  g.strokeStyle = TEXTURE_INK;
  g.fillStyle = TEXTURE_INK;
  g.lineWidth = Math.max(1, s / 6);
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  switch (kind % 8) {
    case 1: // diagonal /
      for (const o of [-s, 0, s]) line(o, s, o + s, 0);
      break;
    case 2: // dots
      g.beginPath();
      g.arc(s / 2, s / 2, s / 6, 0, Math.PI * 2);
      g.fill();
      break;
    case 3: // horizontal
      line(0, s / 2, s, s / 2);
      break;
    case 4: // vertical
      line(s / 2, 0, s / 2, s);
      break;
    case 5: // diagonal \
      for (const o of [-s, 0, s]) line(o, 0, o + s, s);
      break;
    case 6: // cross-hatch
      for (const o of [-s, 0, s]) {
        line(o, s, o + s, 0);
        line(o, 0, o + s, s);
      }
      break;
    case 7: // checks
      g.fillRect(0, 0, s / 2, s / 2);
      g.fillRect(s / 2, s / 2, s / 2, s / 2);
      break;
    default: // 0: plain
  }
}

export function textureCss(kind: number, color: string): string {
  const ink = "rgba(0,0,0,.28)";
  const k = kind % 8;
  const layers: Record<number, string> = {
    1: `repeating-linear-gradient(-45deg, ${ink} 0 1.5px, transparent 1.5px 5px)`,
    2: `radial-gradient(${ink} 1.2px, transparent 1.6px) 0 0 / 5px 5px`,
    3: `repeating-linear-gradient(0deg, ${ink} 0 1.5px, transparent 1.5px 5px)`,
    4: `repeating-linear-gradient(90deg, ${ink} 0 1.5px, transparent 1.5px 5px)`,
    5: `repeating-linear-gradient(45deg, ${ink} 0 1.5px, transparent 1.5px 5px)`,
    6: `repeating-linear-gradient(45deg, ${ink} 0 1.2px, transparent 1.2px 5px), repeating-linear-gradient(-45deg, ${ink} 0 1.2px, transparent 1.2px 5px)`,
    7: `conic-gradient(${ink} 25%, transparent 0 50%, ${ink} 0 75%, transparent 0) 0 0 / 6px 6px`,
  };
  return layers[k] ? `${layers[k]}, ${color}` : color;
}

// ---------- playback clock ----------

interface Snap {
  tick: number;
  view: TurfView;
  painters: Painter[];
}

/** Ticks behind the newest frame, just as one lands. */
const LAG_TARGET = 1.3;
const MAX_GAP = 4;

/**
 * Server frames on a timeline measured in ticks; `t` is the (fractional) tick on screen.
 * It advances at the measured tick rate, scaled once per arrival so the distance to the
 * newest frame settles near LAG_TARGET: smooth constant speed, no stalls, little lag.
 */
class Playback {
  snaps: Snap[] = [];
  t = 0;
  rate = 1;
  period = TICK_MS;
  arrived = 0;
  at = -1;

  /** True when the timeline restarted (first frame, new game, a jump). */
  push(view: TurfView, now: number): boolean {
    const last = this.snaps[this.snaps.length - 1];
    const snap = { tick: view.tick, view, painters: parsePainters(view.players) };
    if (
      !last ||
      view.tick < last.tick ||
      view.tick - last.tick > MAX_GAP ||
      view.w !== last.view.w ||
      view.h !== last.view.h ||
      view.players.length !== last.view.players.length ||
      view.seq < last.view.seq
    ) {
      this.reset(snap, now);
      return true;
    }
    if (view.tick === last.tick) {
      this.snaps[this.snaps.length - 1] = snap; // same moment, new facts (aim, someone left, the end)
      return false;
    }
    const gap = view.tick - last.tick;
    const per = (now - this.arrived) / gap;
    if (this.arrived > 0 && per > TICK_MS * 0.5 && per < TICK_MS * 2) this.period += (per - this.period) * 0.08;
    this.arrived = now;
    this.snaps.push(snap);
    let lag = view.tick - this.t;
    if (lag > MAX_GAP) {
      this.t = view.tick - LAG_TARGET;
      lag = LAG_TARGET;
    }
    this.rate = Math.min(1.8, Math.max(0.6, 1 + 0.35 * (lag - LAG_TARGET)));
    if (this.snaps.length > 8) this.snaps.shift();
    return false;
  }

  reset(snap: Snap, now: number) {
    this.snaps.length = 0;
    this.snaps.push(snap);
    this.t = snap.tick;
    this.rate = 1;
    this.arrived = now;
  }

  snapToEnd() {
    const last = this.snaps[this.snaps.length - 1];
    if (last) this.reset(last, 0);
  }

  advance(now: number) {
    const dt = this.at < 0 ? 0 : Math.min(100, Math.max(0, now - this.at));
    this.at = now;
    const last = this.snaps[this.snaps.length - 1];
    if (!last) return;
    const lag = last.tick - this.t;
    if (lag <= 0) {
      this.t = last.tick;
    } else {
      let step = (dt / this.period) * this.rate;
      if (lag < 0.15) step *= Math.max(0.25, lag / 0.15);
      this.t = Math.min(last.tick, this.t + step);
    }
    while (this.snaps.length > 1 && this.snaps[1].tick <= this.t) this.snaps.shift();
  }
}

// ---------- scene ----------

interface Pt {
  x: number;
  y: number;
}

interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  big: boolean;
  t0: number;
}

/** How one painter gets from the frame on screen to the next. */
interface Move {
  /** [from, ...tiles entered]; a single point = standing still (or a jump we don't animate). */
  path: Pt[];
  /** Ticks the move takes (dashing covers two tiles a tick). */
  ticks: number;
  /** Heading shown while moving. */
  dir: number;
}

interface Fresh {
  ti: number;
  who: number;
  /** Step index along the painter's path (1-based) and the path length. */
  k: number;
  len: number;
  dir: number;
  trail: boolean;
}

interface Scene {
  pb: Playback;
  /** Frame whose territory is on the layer. */
  shown: Snap | null;
  pairA: Snap | null;
  pairB: Snap | null;
  moves: Move[];
  fresh: Fresh[];
  /** Draw order: others first, the viewer last. */
  order: number[];
  trails: number[][];
  flashes: { ti: number; t0: number }[];
  pops: Pop[];
  /** Server events waiting for playback to reach their tick. */
  pending: { e: TurfEvent; tick: number }[];
  powerBorn: Map<string, number>;
  layerDirty: boolean;
  paletteKey: string;
  startAt: number;
  overAt: number;
  idleKey: string;
}

function newScene(): Scene {
  return {
    pb: new Playback(),
    shown: null,
    pairA: null,
    pairB: null,
    moves: [],
    fresh: [],
    order: [],
    trails: [],
    flashes: [],
    pops: [],
    pending: [],
    powerBorn: new Map(),
    layerDirty: true,
    paletteKey: "",
    startAt: -1e9,
    overAt: -1e9,
    idleKey: "",
  };
}

const FLASH_MS = 520;
const POP_MS = 1_150;
const SWEEP_MS = 1_300;
/** How long the winners' crowns bob after the final whistle (then the map goes still). */
const FINALE_MS = 4_000;

function dirBetween(a: Pt, b: Pt): number {
  if (b.x > a.x) return 1;
  if (b.x < a.x) return 3;
  return b.y > a.y ? 2 : 0;
}

/** Reconstruct the tiles a head crossed between two frames (null = can't tell; don't animate). */
function pathFor(prev: Pt, p: Painter): Pt[] | null {
  const d = Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
  if (d === 0) return [{ x: p.x, y: p.y }];
  if (d === 1) return [{ x: prev.x, y: prev.y }, { x: p.x, y: p.y }];
  if (d === 2) {
    // Two steps (dash, or a skipped frame): the last one went in the current direction.
    const mid = { x: p.x - DX[p.dir], y: p.y - DY[p.dir] };
    if (Math.abs(mid.x - prev.x) + Math.abs(mid.y - prev.y) === 1) return [{ x: prev.x, y: prev.y }, mid, { x: p.x, y: p.y }];
  }
  return null;
}

const powerKey = (p: { x: number; y: number; kind: string }) => `${p.x},${p.y},${p.kind}`;

function popFor(e: TurfEvent, palettes: Palette[], t0: number): Pop | null {
  const color = palettes[e.by]?.trail ?? "#fff";
  if (e.type === "capture" && Number.isFinite(e.n) && e.n > 0) {
    return { x: e.x + 0.5, y: e.y + 0.5, text: `+${e.n}!`, color, big: e.n >= 30, t0 };
  }
  if (e.type === "power" && (POWER_KINDS as readonly string[]).includes(e.kind)) {
    const text = e.kind === "bomb" ? `💣 +${e.n}` : e.kind === "dash" ? "⚡ DASH" : "🧊 FREEZE";
    return { x: e.x + 0.5, y: e.y + 0.5, text, color, big: e.kind === "freeze", t0 };
  }
  return null;
}

/** Playback reached a new frame: update open-loop trails, flash fills, refresh the territory layer. */
function applyFrame(sc: Scene, snap: Snap, d: Data, now: number) {
  const prev = sc.shown;
  sc.shown = snap;
  sc.layerDirty = true;
  const { view, painters } = snap;
  if (!prev || prev.view.w !== view.w || prev.view.players.length !== view.players.length) {
    sc.trails = painters.map(() => []);
    sc.flashes.length = 0;
    sc.powerBorn.clear();
    for (const pw of view.powers) sc.powerBorn.set(powerKey(pw), now - 1_000);
    return;
  }
  const w = view.w;
  const prevTiles = prev.view.tiles;
  const tiles = view.tiles;
  const touched = new Set<number>();
  let jumped = false;
  painters.forEach((p, i) => {
    const path = pathFor(prev.painters[i], p);
    let trail = sc.trails[i] ?? [];
    const mine = 48 + i;
    if (!path) jumped = true;
    else {
      for (let k = 1; k < path.length; k++) {
        const ti = path[k].y * w + path[k].x;
        touched.add(ti);
        if (tiles.charCodeAt(ti) !== mine) continue;
        if (prevTiles.charCodeAt(ti) !== mine) trail.push(ti);
        else trail = []; // back on their own turf: loop closed
      }
    }
    // The server's open-loop length is the truth.
    if (p.out === 0) trail = [];
    else if (trail.length > p.out) trail = trail.slice(trail.length - p.out);
    sc.trails[i] = trail;
  });

  // Anything that changed hands without a head walking over it was a fill or a bomb.
  if (!jumped && prevTiles.length === tiles.length) {
    for (let i = 0; i < tiles.length; i++) {
      if (prevTiles.charCodeAt(i) !== tiles.charCodeAt(i) && !touched.has(i)) sc.flashes.push({ ti: i, t0: now });
    }
  }

  const live = new Set(view.powers.map(powerKey));
  for (const k of [...sc.powerBorn.keys()]) if (!live.has(k)) sc.powerBorn.delete(k);
  for (const pw of view.powers) if (!sc.powerBorn.has(powerKey(pw))) sc.powerBorn.set(powerKey(pw), now);

  // Pops for captures and power-ups caused by the steps now on screen.
  if (sc.pending.length) {
    const keep: Scene["pending"] = [];
    for (const it of sc.pending) {
      if (it.tick > snap.tick) keep.push(it);
      else {
        const pop = popFor(it.e, d.palettes, now);
        if (pop) sc.pops.push(pop);
      }
    }
    sc.pending = keep;
  }
}

/** Paths, rollers and draw order for the step between the frame on screen and the next. */
function buildPairs(sc: Scene, a: Snap, b: Snap | null, d: Data) {
  sc.pairA = a;
  sc.pairB = b;
  sc.fresh = [];
  const gap = b ? b.tick - a.tick : 0;
  const w = a.view.w;
  sc.moves = a.painters.map((pa, i) => {
    const pb = b?.painters[i];
    const still: Move = { path: [{ x: pa.x, y: pa.y }], ticks: 1, dir: pb?.dir ?? pa.dir };
    if (!b || !pb || gap <= 0) return still;
    const path = pathFor(pa, pb);
    if (!path || path.length < 2) return still;
    const steps = path.length - 1;
    // Two tiles in one tick is a dash; across a longer gap, spread the steps out (idle ticks first).
    const ticks = gap === 1 ? 1 : Math.max(1, Math.min(gap, steps));
    const mine = 48 + i;
    for (let k = 1; k < path.length; k++) {
      const ti = path[k].y * w + path[k].x;
      if (b.view.tiles.charCodeAt(ti) === mine && a.view.tiles.charCodeAt(ti) !== mine) {
        sc.fresh.push({ ti, who: i, k, len: steps, dir: dirBetween(path[k - 1], path[k]), trail: pb.out > 0 });
      }
    }
    return { path, ticks, dir: pb.dir };
  });
  const order = a.painters.map((_, i) => i).filter((i) => i !== d.me);
  if (d.me >= 0 && d.me < a.painters.length) order.push(d.me);
  sc.order = order;
}

// ---------- drawing ----------

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutBack = (t: number) => {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

interface Size {
  cssW: number;
  cssH: number;
  dpr: number;
}

interface Data {
  view: TurfView;
  palettes: Palette[];
  avatars: string[];
  away: boolean[];
  me: number;
  winners: string[] | null;
  pending: { dir: number; at: number } | null;
  serverNow: () => number;
  reduced: boolean;
}

function gridEdges(n: number, px: number) {
  return Array.from({ length: n + 1 }, (_, i) => Math.round((i * px) / n));
}

function buildBase(base: HTMLCanvasElement, w: number, h: number, devW: number, devH: number) {
  base.width = devW;
  base.height = devH;
  const g = base.getContext("2d");
  if (!g) return;
  const xs = gridEdges(w, devW);
  const ys = gridEdges(h, devH);
  g.fillStyle = "#14112b";
  g.fillRect(0, 0, devW, devH);
  g.fillStyle = "#18153a";
  for (let y = 0; y < h; y++) {
    for (let x = y % 2; x < w; x += 2) g.fillRect(xs[x], ys[y], xs[x + 1] - xs[x], ys[y + 1] - ys[y]);
  }
}

/** Settled territory of the frame on screen, plus brighter open-loop trails and darker borders. */
function buildLayer(layer: HTMLCanvasElement, sc: Scene, snap: Snap, d: Data, devW: number, devH: number, textures: (CanvasPattern | null)[]) {
  if (layer.width !== devW || layer.height !== devH) {
    layer.width = devW;
    layer.height = devH;
  }
  const g = layer.getContext("2d");
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, devW, devH);
  const { w, h, tiles } = snap.view;
  if (tiles.length !== w * h) return;
  const xs = gridEdges(w, devW);
  const ys = gridEdges(h, devH);
  const n = d.palettes.length;
  const fills = Array.from({ length: n }, () => new Path2D());
  const edges = Array.from({ length: n }, () => new Path2D());
  const e = Math.max(1, Math.round((devW / w) * 0.13));
  const owner = (i: number) => tiles.charCodeAt(i) - 48; // "." -> -2

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = owner(i);
      if (o < 0 || o >= n) continue;
      const x0 = xs[x];
      const y0 = ys[y];
      const tw = xs[x + 1] - x0;
      const th = ys[y + 1] - y0;
      fills[o].rect(x0, y0, tw, th);
      if (x === 0 || owner(i - 1) !== o) edges[o].rect(x0, y0, e, th);
      if (x === w - 1 || owner(i + 1) !== o) edges[o].rect(x0 + tw - e, y0, e, th);
      if (y === 0 || owner(i - w) !== o) edges[o].rect(x0, y0, tw, e);
      if (y === h - 1 || owner(i + w) !== o) edges[o].rect(x0, y0 + th - e, tw, e);
    }
  }
  for (let o = 0; o < n; o++) {
    g.fillStyle = d.palettes[o].fill;
    g.fill(fills[o]);
    const tex = textures[o];
    if (tex) {
      g.fillStyle = tex;
      g.fill(fills[o]);
    }
  }
  // Open loops glow brighter than settled turf.
  for (let o = 0; o < n; o++) {
    const trail = sc.trails[o];
    if (!trail?.length) continue;
    const path = new Path2D();
    for (const ti of trail) {
      if (owner(ti) !== o) continue;
      const x = ti % w;
      const y = (ti - x) / w;
      path.rect(xs[x], ys[y], xs[x + 1] - xs[x], ys[y + 1] - ys[y]);
    }
    g.fillStyle = d.palettes[o].trail;
    g.fill(path);
  }
  for (let o = 0; o < n; o++) {
    g.fillStyle = d.palettes[o].edge;
    g.fill(edges[o]);
  }
}

function makeTextures(g: CanvasRenderingContext2D, n: number, dpr: number): (CanvasPattern | null)[] {
  const s = Math.max(4, Math.round(6 * dpr));
  return Array.from({ length: n }, (_, i) => {
    if (i % 8 === 0) return null;
    const c = document.createElement("canvas");
    c.width = s;
    c.height = s;
    const cg = c.getContext("2d");
    if (!cg) return null;
    drawTexture(cg, i, s);
    return g.createPattern(c, "repeat");
  });
}

function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Head position along a move at progress u (0..1). Scratch outputs: no allocation per frame. */
let PX = 0;
let PY = 0;
let PDIR = 0;
function headAt(m: Move, u: number) {
  const path = m.path;
  if (path.length < 2) {
    PX = path[0].x;
    PY = path[0].y;
    PDIR = m.dir;
    return;
  }
  const segs = path.length - 1;
  const f = u * segs;
  const k = Math.min(segs - 1, Math.floor(f));
  const v = f - k;
  PX = path[k].x + (path[k + 1].x - path[k].x) * v;
  PY = path[k].y + (path[k + 1].y - path[k].y) * v;
  PDIR = u >= 1 ? m.dir : dirBetween(path[k], path[k + 1]);
}

function drawChevron(g: CanvasRenderingContext2D, cx: number, cy: number, dir: number, r: number, fill: string, stroke: string) {
  const ux = DX[dir];
  const uy = DY[dir];
  const tip = r * 1.62;
  const back = r * 1.08;
  const half = r * 0.46;
  g.beginPath();
  g.moveTo(cx + ux * tip, cy + uy * tip);
  g.lineTo(cx + ux * back - uy * half, cy + uy * back + ux * half);
  g.lineTo(cx + ux * back + uy * half, cy + uy * back - ux * half);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = Math.max(1, r * 0.12);
  g.strokeStyle = stroke;
  g.stroke();
}

function drawFrame(
  cv: HTMLCanvasElement,
  size: Size,
  sc: Scene,
  d: Data,
  base: HTMLCanvasElement,
  layer: HTMLCanvasElement,
  textures: { key: string; list: (CanvasPattern | null)[] },
  now: number,
) {
  const g = cv.getContext("2d");
  const pb = sc.pb;
  const a = pb.snaps[0];
  if (!g || !size.cssW || !a) return;
  const b = pb.snaps.length > 1 ? pb.snaps[1] : null;
  if (a !== sc.shown) applyFrame(sc, a, d, now);
  if (a !== sc.pairA || b !== sc.pairB) buildPairs(sc, a, b, d);
  const view = a.view;
  const latest = pb.snaps[pb.snaps.length - 1].view;
  const painters = (b ?? a).painters;
  const { palettes, reduced } = d;
  const devW = cv.width;
  const devH = cv.height;
  const ts = size.cssW / view.w;
  const sNow = d.serverNow();

  if (base.width !== devW || base.height !== devH || base.dataset.key !== `${view.w}x${view.h}`) {
    buildBase(base, view.w, view.h, devW, devH);
    base.dataset.key = `${view.w}x${view.h}`;
  }
  const texKey = `${palettes.length}@${size.dpr}`;
  const lg = layer.getContext("2d");
  if (textures.key !== texKey && lg) {
    textures.list = makeTextures(lg, palettes.length, size.dpr);
    textures.key = texKey;
    sc.layerDirty = true;
  }
  if (sc.layerDirty || layer.width !== devW || layer.height !== devH) {
    buildLayer(layer, sc, a, d, devW, devH, textures.list);
    sc.layerDirty = false;
  }

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, devW, devH);
  g.drawImage(base, 0, 0);
  // The map fades up as the game opens.
  const intro = reduced ? 1 : clamp01((now - sc.startAt) / 450);
  if (intro < 1) g.globalAlpha = intro;
  g.drawImage(layer, 0, 0);
  g.globalAlpha = 1;
  g.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);

  const w = view.w;
  // Where each painter is along its step: moves finish at the next frame's tick.
  const tEnd = b ? b.tick : a.tick;

  // Fills & bomb splashes flash white, then settle.
  if (sc.flashes.length) {
    if (now - sc.flashes[0].t0 >= FLASH_MS) sc.flashes = sc.flashes.filter((f) => now - f.t0 < FLASH_MS);
    for (const f of sc.flashes) {
      const k = 1 - (now - f.t0) / FLASH_MS;
      g.globalAlpha = 0.6 * k * k;
      g.fillStyle = "#ffffff";
      const x = f.ti % w;
      g.fillRect(x * ts, ((f.ti - x) / w) * ts, ts + 0.5, ts + 0.5);
    }
    g.globalAlpha = 1;
  }

  // Paint rolls out from under each head as it crosses a fresh tile.
  for (const f of sc.fresh) {
    const m = sc.moves[f.who];
    const pal = palettes[f.who];
    if (!m || !pal) continue;
    const u = clamp01((pb.t - (tEnd - m.ticks)) / m.ticks);
    const prog = clamp01(u * f.len - (f.k - 1));
    if (prog <= 0) continue;
    const x = f.ti % w;
    const y = (f.ti - x) / w;
    let rx = x * ts;
    let ry = y * ts;
    let rw = ts;
    let rh = ts;
    if (f.dir === 1) rw = ts * prog;
    else if (f.dir === 3) {
      rw = ts * prog;
      rx += ts - rw;
    } else if (f.dir === 2) rh = ts * prog;
    else {
      rh = ts * prog;
      ry += ts - rh;
    }
    g.fillStyle = f.trail ? pal.trail : pal.fill;
    g.fillRect(rx, ry, rw + 0.5, rh + 0.5);
  }

  // Power-ups.
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const pw of view.powers) {
    const info = POWER_INFO[pw.kind as PowerKind];
    if (!info) continue;
    const born = sc.powerBorn.get(powerKey(pw)) ?? now;
    const grow = reduced ? 1 : easeOutBack(clamp01((now - born) / 380));
    const bob = reduced ? 0 : Math.sin(now / 260 + pw.x * 1.7) * ts * 0.09;
    const cx = (pw.x + 0.5) * ts;
    const cy = (pw.y + 0.5) * ts + bob;
    const r = Math.min(18, Math.max(8.5, ts * 0.74)) * grow;
    if (r <= 0.5) continue;
    g.globalAlpha = reduced ? 0.24 : 0.2 + 0.08 * Math.sin(now / 200);
    g.fillStyle = info.color;
    g.beginPath();
    g.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    roundRectPath(g, cx - r, cy - r, r * 2, r * 2, r * 0.45);
    g.fillStyle = info.tile;
    g.fill();
    g.lineWidth = Math.max(1.5, r * 0.16);
    g.strokeStyle = info.color;
    g.stroke();
    g.font = `${Math.round(r * 1.25)}px ${EMOJI_FONT}`;
    g.fillStyle = "#fff";
    g.fillText(info.icon, cx, cy + r * 0.08);
  }

  // Painters: others first, the viewer on top.
  const r = Math.min(22, Math.max(9, ts * 0.82));
  const over = latest.phase === "over";
  const youTag = latest.phase === "countdown" || (latest.phase === "play" && sNow < latest.endsAt - 58_000);
  const headFont = `${Math.round(r * 1.18)}px ${EMOJI_FONT}`;
  const badgeFont = `${Math.round(Math.max(10, r * 0.85))}px ${EMOJI_FONT}`;
  const pop = reduced ? 1 : Math.max(0.2, easeOutBack(clamp01((now - sc.startAt) / 500)));
  for (const i of sc.order) {
    const p = painters[i];
    const pal = palettes[i];
    const m = sc.moves[i];
    if (!p || !pal || !m) continue;
    headAt(m, clamp01((pb.t - (tEnd - m.ticks)) / m.ticks));
    const cx = (PX + 0.5) * ts;
    const cy = (PY + 0.5) * ts;
    const dir = PDIR;
    const away = d.away[i];
    const frozen = sNow < p.frozen && latest.phase === "play";
    const dashing = sNow < p.dash && latest.phase === "play";
    const isMe = i === d.me;
    const champ = over && !!d.winners?.includes(p.id);
    const finale = champ && !reduced && now - sc.overAt < FINALE_MS;
    const rr = r * (pop < 1 ? pop : 1);
    g.save();
    if (away) g.globalAlpha = 0.45;

    if (dashing) {
      g.strokeStyle = "rgba(250, 204, 21, 0.75)";
      g.lineCap = "round";
      g.lineWidth = Math.max(1.5, rr * 0.18);
      const bx = -DX[dir];
      const by = -DY[dir];
      for (let s = -1; s <= 1; s++) {
        const off = s * 0.55;
        const ox = cx + by * off * rr + bx * rr * 1.1;
        const oy = cy + bx * off * rr + by * rr * 1.1;
        const len = rr * (s === 0 ? 1.6 : 1.1) * (reduced ? 1 : 0.85 + 0.15 * Math.sin(now / 60 + off * 5));
        g.beginPath();
        g.moveTo(ox, oy);
        g.lineTo(ox + bx * len, oy + by * len);
        g.stroke();
      }
    }

    if (!over) drawChevron(g, cx, cy, dir, rr, isMe ? "#ffffff" : pal.base, pal.edge);

    // Soft shadow, body, outline.
    g.fillStyle = "rgba(0, 0, 0, 0.35)";
    g.beginPath();
    g.arc(cx, cy + rr * 0.2, rr * 1.02, 0, Math.PI * 2);
    g.fill();
    if (finale) {
      g.shadowColor = pal.base;
      g.shadowBlur = 14 + 6 * Math.sin(now / 220);
    }
    g.beginPath();
    g.arc(cx, cy, rr, 0, Math.PI * 2);
    g.fillStyle = away ? "#64748b" : pal.base;
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = Math.max(1.5, rr * 0.15);
    g.strokeStyle = pal.edge;
    g.stroke();
    if (isMe) {
      const pulse = reduced || over ? 0 : (Math.sin(now / 180) + 1) * 0.9;
      g.beginPath();
      g.arc(cx, cy, rr + 2.5 + pulse, 0, Math.PI * 2);
      g.lineWidth = 2;
      g.strokeStyle = "rgba(255, 255, 255, 0.92)";
      g.stroke();
    }
    g.font = headFont;
    g.fillStyle = "#fff";
    g.fillText(d.avatars[i] ?? "🖌️", cx, cy + rr * 0.07);

    if (frozen) {
      g.beginPath();
      g.arc(cx, cy, rr * 1.08, 0, Math.PI * 2);
      g.fillStyle = "rgba(186, 230, 253, 0.5)";
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = "#e0f2fe";
      g.stroke();
      // Remaining freeze as a shrinking arc.
      const left = clamp01((p.frozen - sNow) / 1_500);
      g.beginPath();
      g.arc(cx, cy, rr + 4, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
      g.lineWidth = 2.5;
      g.strokeStyle = "#7dd3fc";
      g.stroke();
    }
    const badge = away ? "💤" : frozen ? "🧊" : dashing ? "⚡" : "";
    if (badge) {
      g.font = badgeFont;
      g.fillText(badge, cx + rr * 0.85, cy - rr * 0.85);
    }
    if (champ) {
      const lift = finale ? Math.abs(Math.sin(now / 260)) * 3 : 0;
      g.font = badgeFont;
      g.fillText("👑", cx, cy - rr - 6 - lift);
    }
    g.restore();

    // The viewer's own head: "YOU" tag at the start, and instant feedback for a queued turn.
    if (isMe && youTag) {
      const bounce = reduced ? 0 : Math.abs(Math.sin(now / 220)) * 3;
      const ty = cy - rr - 12 - bounce;
      g.font = `800 ${Math.round(Math.max(10, Math.min(13, r * 0.8)))}px system-ui, sans-serif`;
      g.textBaseline = "bottom";
      g.lineWidth = 3;
      g.strokeStyle = "rgba(14, 12, 29, 0.9)";
      g.strokeText("YOU", cx, ty);
      g.fillStyle = "#fff";
      g.fillText("YOU", cx, ty);
      g.beginPath();
      g.moveTo(cx - 4, ty + 2);
      g.lineTo(cx + 4, ty + 2);
      g.lineTo(cx, ty + 7);
      g.closePath();
      g.fill();
      g.textBaseline = "middle";
    }
    if (isMe && d.pending && d.pending.dir !== dir && now - d.pending.at < 450 && latest.phase === "play") {
      g.save();
      g.globalAlpha = 0.55;
      drawChevron(g, cx, cy, d.pending.dir, rr, "#ffffff", pal.edge);
      g.restore();
    }
  }

  // Score pops.
  if (sc.pops.length) {
    if (now - sc.pops[0].t0 >= POP_MS) sc.pops = sc.pops.filter((p) => now - p.t0 < POP_MS);
    g.lineJoin = "round";
    for (const p of sc.pops) {
      const k = (now - p.t0) / POP_MS;
      const scale = reduced ? 1 : k < 0.14 ? 0.55 + (k / 0.14) * 0.6 : k < 0.24 ? 1.15 - ((k - 0.14) / 0.1) * 0.15 : 1;
      const rise = reduced ? 0 : (1 - Math.pow(1 - k, 2)) * Math.max(16, ts * 1.7);
      const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const fs = Math.min(34, Math.max(14, ts * 1.15)) * (p.big ? 1.4 : 1) * scale;
      const x = Math.min(size.cssW - fs, Math.max(fs, p.x * ts));
      const y = Math.min(size.cssH - 4, Math.max(fs + 4, p.y * ts - rise));
      g.globalAlpha = alpha;
      g.font = `900 ${Math.round(fs)}px system-ui, sans-serif`;
      g.lineWidth = Math.max(3, fs * 0.22);
      g.strokeStyle = "rgba(14, 12, 29, 0.92)";
      g.strokeText(p.text, x, y);
      g.fillStyle = p.color;
      g.fillText(p.text, x, y);
    }
    g.globalAlpha = 1;
  }

  // Frost around the edges while the viewer is frozen.
  const mine = d.me >= 0 ? painters[d.me] : undefined;
  if (mine && latest.phase === "play" && sNow < mine.frozen) {
    const cw = size.cssW;
    const ch = size.cssH;
    const grad = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
    grad.addColorStop(0, "rgba(186, 230, 253, 0)");
    grad.addColorStop(1, "rgba(186, 230, 253, 0.45)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size.cssW, size.cssH);
  }

  // Final whistle: one bright sweep across the finished map.
  const sweep = (now - sc.overAt) / SWEEP_MS;
  if (!reduced && sweep >= 0 && sweep < 1) {
    const cw = size.cssW;
    const ch = size.cssH;
    const x = -cw * 0.4 + sweep * cw * 1.8;
    const grad = g.createLinearGradient(x - cw * 0.25, 0, x + cw * 0.25, ch * 0.4);
    grad.addColorStop(0, "rgba(255, 255, 255, 0)");
    grad.addColorStop(0.5, "rgba(255, 255, 255, 0.22)");
    grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, cw, ch);
  }
}

// ---------- component ----------

export interface TurfBoardProps {
  view: TurfView;
  colors: string[];
  avatars: string[];
  away: boolean[];
  /** Viewer's painter index, -1 when watching. */
  me: number;
  /** Swipe handler; null disables swiping. */
  steer: ((dir: number) => void) | null;
  pending: { dir: number; at: number } | null;
  serverNow: () => number;
  onEvent: (fn: (e: unknown) => void) => () => void;
  label: string;
  children?: ReactNode;
}

export function TurfBoard(props: TurfBoardProps) {
  const { view, colors, avatars, away, me, steer, pending, serverNow, onEvent, label, children } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef<Size>({ cssW: 0, cssH: 0, dpr: 1 });
  const sceneRef = useRef<Scene>(newScene());
  const dataRef = useRef<Data | null>(null);
  const swipeRef = useRef<{ id: number; x: number; y: number; last: number } | null>(null);
  const reducedRef = useRef(false);

  // Keep the renderer's copy of the props current.
  useEffect(() => {
    const sc = sceneRef.current;
    const key = colors.join();
    dataRef.current = {
      view,
      palettes: colors.map(palette),
      avatars,
      away,
      me,
      winners: view.winners,
      pending,
      serverNow,
      reduced: reducedRef.current,
    };
    if (key !== sc.paletteKey) {
      sc.paletteKey = key;
      sc.layerDirty = true;
    }
  });

  // Feed each new server frame into the playback buffer.
  useEffect(() => {
    const sc = sceneRef.current;
    const now = performance.now();
    const before = sc.pb.snaps[sc.pb.snaps.length - 1]?.view;
    if (sc.pb.push(view, now)) {
      sc.shown = null;
      sc.pending.length = 0;
      sc.pops.length = 0;
      if (!before || before.phase === "over" || view.seq < before.seq) sc.startAt = view.phase === "countdown" ? now : -1e9;
    }
    if (view.phase === "over" && before?.phase !== "over") sc.overAt = before ? now : -1e9;
  }, [view]);

  // Score pops from transient server events, held until playback reaches the step that caused them.
  useEffect(
    () =>
      onEvent((raw) => {
        const e = raw as TurfEvent | null;
        const d = dataRef.current;
        if (!e || typeof e !== "object" || !d) return;
        const sc = sceneRef.current;
        const shownTick = sc.shown?.tick ?? -1;
        if (Number.isInteger(e.tick) && e.tick > shownTick && sc.pending.length < 64) {
          sc.pending.push({ e, tick: e.tick });
          return;
        }
        const pop = popFor(e, d.palettes, performance.now());
        if (pop) sc.pops.push(pop);
      }),
    [onEvent],
  );

  // Backing store follows the CSS size (DPR-aware).
  useEffect(() => {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    if (!wrap || !cv) return;
    const fit = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const devW = Math.max(1, Math.round(rect.width * dpr));
      const devH = Math.max(1, Math.round(rect.height * dpr));
      sizeRef.current = { cssW: rect.width, cssH: rect.height, dpr };
      if (cv.width !== devW || cv.height !== devH) {
        cv.width = devW;
        cv.height = devH;
        sceneRef.current.layerDirty = true;
        sceneRef.current.idleKey = "";
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  // Reduced motion preference.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reducedRef.current = mq.matches;
      if (dataRef.current) dataRef.current.reduced = mq.matches;
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Render loop: one requestAnimationFrame chain, paused while the tab is hidden.
  useEffect(() => {
    const base = document.createElement("canvas");
    const layer = document.createElement("canvas");
    const textures = { key: "", list: [] as (CanvasPattern | null)[] };
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const cv = canvasRef.current;
      const d = dataRef.current;
      const sc = sceneRef.current;
      if (!cv || !d) return;
      sc.pb.advance(now);
      const latest = sc.pb.snaps[sc.pb.snaps.length - 1];
      if (!latest) return;
      // After the final whistle the picture stops changing once effects fade: skip the work.
      const settled =
        latest.view.phase === "over" &&
        sc.pb.snaps.length === 1 &&
        sc.shown === latest &&
        !sc.pops.length &&
        !sc.flashes.length &&
        (d.reduced || now - sc.overAt > FINALE_MS);
      const key = `${latest.view.seq}|${cv.width}x${cv.height}|${sc.paletteKey}|${d.me}`;
      if (settled && key === sc.idleKey && !sc.layerDirty) return;
      try {
        drawFrame(cv, sizeRef.current, sc, d, base, layer, textures, now);
        sc.idleKey = settled ? key : "";
      } catch (err) {
        // Never let a drawing glitch take the page down; try again next frame.
        console.warn("turf: draw failed", err);
      }
    };
    const start = () => {
      cancelAnimationFrame(raf);
      sceneRef.current.pb.at = -1;
      raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else {
        sceneRef.current.pb.snapToEnd();
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

  const ratio = view.w / view.h;
  return (
    <div
      ref={wrapRef}
      className="relative mx-auto w-full overflow-hidden rounded-xl border border-line bg-ink shadow-lg shadow-black/30"
      style={{ aspectRatio: `${view.w} / ${view.h}`, maxWidth: `calc(64vh * ${ratio.toFixed(4)})` }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="absolute inset-0 block size-full select-none"
        style={{ touchAction: steer ? "none" : "auto" }}
        onPointerDown={(e) => {
          if (!steer || (e.pointerType === "mouse" && e.button !== 0)) return;
          swipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, last: -1 };
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Synthetic pointers can't be captured; swiping still works.
          }
        }}
        onPointerMove={(e) => {
          const s = swipeRef.current;
          if (!steer || !s || s.id !== e.pointerId) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
          const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
          // One long drag can chain turns; a wobble in the same direction doesn't resend.
          if (dir !== s.last) steer(dir);
          swipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, last: dir };
        }}
        onPointerUp={() => {
          swipeRef.current = null;
        }}
        onPointerCancel={() => {
          swipeRef.current = null;
        }}
      />
      {children}
    </div>
  );
}
