"use client";

// Canvas renderer for Turf War. Pure presentation: the server owns every rule.
// Territory lives on an offscreen layer that is rebuilt once per update; heads,
// power-ups, the paint "roller", capture flashes and score pops are animated on
// top every frame, interpolating between the last two server ticks.

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

// ---------- animation bookkeeping ----------

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

interface Anim {
  seq: number;
  w: number;
  h: number;
  tiles: string;
  prevTiles: string;
  arrived: number;
  /** Per painter: [from, ...tiles entered] for the latest tick. */
  paths: Pt[][];
  pos: Pt[];
  /** Tiles painted by a head this tick: drawn by the roller, not the layer. */
  fresh: { ti: number; who: number; k: number; len: number; dir: number }[];
  freshSet: Set<number>;
  trails: number[][];
  flashes: { ti: number; t0: number }[];
  pops: Pop[];
  powerBorn: Map<string, number>;
  layerDirty: boolean;
  paletteKey: string;
}

const FLASH_MS = 520;
const POP_MS = 1_150;

function newAnim(): Anim {
  return {
    seq: -1,
    w: 0,
    h: 0,
    tiles: "",
    prevTiles: "",
    arrived: 0,
    paths: [],
    pos: [],
    fresh: [],
    freshSet: new Set(),
    trails: [],
    flashes: [],
    pops: [],
    powerBorn: new Map(),
    layerDirty: true,
    paletteKey: "",
  };
}

function dirBetween(a: Pt, b: Pt): number {
  if (b.x > a.x) return 1;
  if (b.x < a.x) return 3;
  return b.y > a.y ? 2 : 0;
}

/** Reconstruct the tiles a head crossed since the last update (null = jumped / didn't move). */
function pathFor(prev: Pt, p: Painter): Pt[] | null {
  const d = Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
  if (d === 1) return [prev, { x: p.x, y: p.y }];
  if (d === 2) {
    // Two steps (dash): the last one went in the current direction.
    const mid = { x: p.x - DX[p.dir], y: p.y - DY[p.dir] };
    if (Math.abs(mid.x - prev.x) + Math.abs(mid.y - prev.y) === 1) return [prev, mid, { x: p.x, y: p.y }];
  }
  return null;
}

const powerKey = (p: { x: number; y: number; kind: string }) => `${p.x},${p.y},${p.kind}`;

function ingest(a: Anim, view: TurfView, painters: Painter[], now: number) {
  const first = a.seq < 0 || a.w !== view.w || a.h !== view.h || a.pos.length !== painters.length;
  // Several updates folded into one render (busy or backgrounded tab): just resync, no flashes.
  const skipped = !first && view.seq - a.seq > 2;
  const prevTiles = first ? view.tiles : a.tiles;
  const w = view.w;
  a.prevTiles = prevTiles;
  a.tiles = view.tiles;
  a.seq = view.seq;
  a.w = view.w;
  a.h = view.h;
  a.arrived = now;
  a.fresh = [];
  a.freshSet = new Set();
  const touched = new Set<number>();

  painters.forEach((p, i) => {
    const path = first ? null : pathFor(a.pos[i], p);
    a.paths[i] = path ?? [{ x: p.x, y: p.y }];
    let trail = first ? [] : (a.trails[i] ?? []);
    const mine = 48 + i;
    if (path) {
      for (let k = 1; k < path.length; k++) {
        const ti = path[k].y * w + path[k].x;
        touched.add(ti);
        const was = prevTiles.charCodeAt(ti);
        const cur = view.tiles.charCodeAt(ti);
        if (cur === mine && was !== mine) {
          a.fresh.push({ ti, who: i, k, len: path.length - 1, dir: dirBetween(path[k - 1], path[k]) });
          a.freshSet.add(ti);
          trail.push(ti);
        } else if (cur === mine) {
          trail = []; // back on their own turf: loop closed
        }
      }
    }
    // The server's open-loop length is the truth.
    if (p.out === 0) trail = [];
    else if (trail.length > p.out) trail = trail.slice(trail.length - p.out);
    a.trails[i] = trail;
  });
  a.trails.length = painters.length;
  a.paths.length = painters.length;
  a.pos = painters.map((p) => ({ x: p.x, y: p.y }));

  // Anything that changed hands without a head walking over it was a fill or a bomb.
  if (!first && !skipped && prevTiles.length === view.tiles.length) {
    for (let i = 0; i < view.tiles.length; i++) {
      if (prevTiles.charCodeAt(i) !== view.tiles.charCodeAt(i) && !touched.has(i)) a.flashes.push({ ti: i, t0: now });
    }
  }

  const live = new Set(view.powers.map(powerKey));
  for (const k of [...a.powerBorn.keys()]) if (!live.has(k)) a.powerBorn.delete(k);
  for (const pw of view.powers) if (!a.powerBorn.has(powerKey(pw))) a.powerBorn.set(powerKey(pw), first ? now - 1_000 : now);
  a.layerDirty = true;
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
  painters: Painter[];
  palettes: Palette[];
  avatars: string[];
  away: boolean[];
  me: number;
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
    for (let x = (y % 2); x < w; x += 2) g.fillRect(xs[x], ys[y], xs[x + 1] - xs[x], ys[y + 1] - ys[y]);
  }
}

function buildLayer(layer: HTMLCanvasElement, a: Anim, d: Data, devW: number, devH: number, textures: (CanvasPattern | null)[]) {
  if (layer.width !== devW || layer.height !== devH) {
    layer.width = devW;
    layer.height = devH;
  }
  const g = layer.getContext("2d");
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, devW, devH);
  const { w, h, tiles } = d.view;
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
      const fresh = a.freshSet.has(i);
      const shown = fresh ? a.prevTiles.charCodeAt(i) - 48 : owner(i);
      const x0 = xs[x];
      const y0 = ys[y];
      const tw = xs[x + 1] - x0;
      const th = ys[y + 1] - y0;
      if (shown >= 0 && shown < n) fills[shown].rect(x0, y0, tw, th);
      if (fresh) continue;
      const o = owner(i);
      if (o < 0 || o >= n) continue;
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
    const trail = a.trails[o];
    if (!trail?.length) continue;
    const path = new Path2D();
    for (const ti of trail) {
      if (owner(ti) !== o || a.freshSet.has(ti)) continue;
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

function headPos(a: Anim, i: number, t: number): Pt {
  const path = a.paths[i];
  if (!path || path.length < 2) return path?.[0] ?? a.pos[i] ?? { x: 0, y: 0 };
  const segs = path.length - 1;
  const f = t * segs;
  const k = Math.min(segs - 1, Math.floor(f));
  const u = f - k;
  return { x: path[k].x + (path[k + 1].x - path[k].x) * u, y: path[k].y + (path[k + 1].y - path[k].y) * u };
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
  a: Anim,
  d: Data,
  base: HTMLCanvasElement,
  layer: HTMLCanvasElement,
  textures: { key: string; list: (CanvasPattern | null)[] },
  now: number,
) {
  const g = cv.getContext("2d");
  if (!g || !size.cssW) return;
  const { view, painters, palettes } = d;
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
    a.layerDirty = true;
  }
  if (a.layerDirty || layer.width !== devW || layer.height !== devH) {
    buildLayer(layer, a, d, devW, devH, textures.list);
    a.layerDirty = false;
  }

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, devW, devH);
  g.drawImage(base, 0, 0);
  g.drawImage(layer, 0, 0);
  g.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);

  const t = clamp01((now - a.arrived) / TICK_MS);
  const w = view.w;

  // Fills & bomb splashes flash white, then settle.
  if (a.flashes.length) {
    a.flashes = a.flashes.filter((f) => now - f.t0 < FLASH_MS);
    for (const f of a.flashes) {
      const k = 1 - (now - f.t0) / FLASH_MS;
      g.fillStyle = `rgba(255, 255, 255, ${0.6 * k * k})`;
      const x = f.ti % w;
      g.fillRect(x * ts, ((f.ti - x) / w) * ts, ts + 0.5, ts + 0.5);
    }
  }

  // Paint rolls out from under each head as it crosses a fresh tile.
  for (const f of a.fresh) {
    const p = painters[f.who];
    const pal = palettes[f.who];
    if (!p || !pal) continue;
    const prog = clamp01(t * f.len - (f.k - 1));
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
    g.fillStyle = p.out > 0 ? pal.trail : pal.fill;
    g.fillRect(rx, ry, rw + 0.5, rh + 0.5);
  }

  // Power-ups.
  for (const pw of view.powers) {
    const info = POWER_INFO[pw.kind as PowerKind];
    if (!info) continue;
    const born = a.powerBorn.get(powerKey(pw)) ?? now;
    const grow = d.reduced ? 1 : easeOutBack(clamp01((now - born) / 380));
    const bob = d.reduced ? 0 : Math.sin(now / 260 + pw.x * 1.7) * ts * 0.09;
    const cx = (pw.x + 0.5) * ts;
    const cy = (pw.y + 0.5) * ts + bob;
    const r = Math.min(18, Math.max(8.5, ts * 0.74)) * grow;
    if (r <= 0.5) continue;
    g.fillStyle = rgba(info.color, 0.2 + 0.08 * Math.sin(now / 200));
    g.beginPath();
    g.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
    g.fill();
    roundRectPath(g, cx - r, cy - r, r * 2, r * 2, r * 0.45);
    g.fillStyle = info.tile;
    g.fill();
    g.lineWidth = Math.max(1.5, r * 0.16);
    g.strokeStyle = info.color;
    g.stroke();
    g.font = `${Math.round(r * 1.25)}px ${EMOJI_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    g.fillText(info.icon, cx, cy + r * 0.08);
  }

  // Painters: others first, the viewer on top.
  const order = painters.map((_, i) => i).filter((i) => i !== d.me);
  if (d.me >= 0 && d.me < painters.length) order.push(d.me);
  const r = Math.min(22, Math.max(9, ts * 0.82));
  const intro = view.phase === "countdown" || (view.phase === "play" && sNow < view.endsAt - 58_000);
  for (const i of order) {
    const p = painters[i];
    const pal = palettes[i];
    if (!p || !pal) continue;
    const pos = headPos(a, i, t);
    const cx = (pos.x + 0.5) * ts;
    const cy = (pos.y + 0.5) * ts;
    const away = d.away[i];
    const frozen = sNow < p.frozen && view.phase === "play";
    const dashing = sNow < p.dash && view.phase === "play";
    const isMe = i === d.me;
    g.save();
    if (away) g.globalAlpha = 0.45;

    if (dashing) {
      g.strokeStyle = rgba("#facc15", 0.75);
      g.lineCap = "round";
      g.lineWidth = Math.max(1.5, r * 0.18);
      const bx = -DX[p.dir];
      const by = -DY[p.dir];
      for (const off of [-0.55, 0, 0.55]) {
        const ox = cx + by * off * r + bx * r * 1.1;
        const oy = cy + bx * off * r + by * r * 1.1;
        const len = r * (off === 0 ? 1.6 : 1.1) * (d.reduced ? 1 : 0.85 + 0.15 * Math.sin(now / 60 + off * 5));
        g.beginPath();
        g.moveTo(ox, oy);
        g.lineTo(ox + bx * len, oy + by * len);
        g.stroke();
      }
    }

    if (view.phase !== "over") drawChevron(g, cx, cy, p.dir, r, isMe ? "#ffffff" : pal.base, pal.edge);

    // Soft shadow, body, outline.
    g.fillStyle = "rgba(0, 0, 0, 0.35)";
    g.beginPath();
    g.arc(cx, cy + r * 0.2, r * 1.02, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = away ? "#64748b" : pal.base;
    g.fill();
    g.lineWidth = Math.max(1.5, r * 0.15);
    g.strokeStyle = pal.edge;
    g.stroke();
    if (isMe) {
      const pulse = d.reduced || view.phase === "over" ? 0 : (Math.sin(now / 180) + 1) * 0.9;
      g.beginPath();
      g.arc(cx, cy, r + 2.5 + pulse, 0, Math.PI * 2);
      g.lineWidth = 2;
      g.strokeStyle = "rgba(255, 255, 255, 0.92)";
      g.stroke();
    }
    g.font = `${Math.round(r * 1.18)}px ${EMOJI_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    g.fillText(d.avatars[i] ?? "🖌️", cx, cy + r * 0.07);

    if (frozen) {
      g.beginPath();
      g.arc(cx, cy, r * 1.08, 0, Math.PI * 2);
      g.fillStyle = "rgba(186, 230, 253, 0.5)";
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = "#e0f2fe";
      g.stroke();
      // Remaining freeze as a shrinking arc.
      const left = clamp01((p.frozen - sNow) / 1_500);
      g.beginPath();
      g.arc(cx, cy, r + 4, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
      g.lineWidth = 2.5;
      g.strokeStyle = "#7dd3fc";
      g.stroke();
    }
    const badge = away ? "💤" : frozen ? "🧊" : dashing ? "⚡" : "";
    if (badge) {
      g.font = `${Math.round(Math.max(10, r * 0.85))}px ${EMOJI_FONT}`;
      g.fillText(badge, cx + r * 0.85, cy - r * 0.85);
    }
    g.restore();

    // The viewer's own head: "YOU" tag at the start, and instant feedback for a queued turn.
    if (isMe && intro) {
      const bounce = d.reduced ? 0 : Math.abs(Math.sin(now / 220)) * 3;
      const ty = cy - r - 12 - bounce;
      g.font = `800 ${Math.round(Math.max(10, Math.min(13, r * 0.8)))}px system-ui, sans-serif`;
      g.textAlign = "center";
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
    }
    if (isMe && d.pending && d.pending.dir !== p.dir && now - d.pending.at < 450 && view.phase === "play") {
      g.save();
      g.globalAlpha = 0.55;
      drawChevron(g, cx, cy, d.pending.dir, r, "#ffffff", pal.edge);
      g.restore();
    }
  }

  // Score pops.
  if (a.pops.length) {
    a.pops = a.pops.filter((p) => now - p.t0 < POP_MS);
    for (const p of a.pops) {
      const k = (now - p.t0) / POP_MS;
      const scale = d.reduced ? 1 : k < 0.14 ? 0.55 + (k / 0.14) * 0.6 : k < 0.24 ? 1.15 - ((k - 0.14) / 0.1) * 0.15 : 1;
      const rise = d.reduced ? 0 : (1 - Math.pow(1 - k, 2)) * Math.max(16, ts * 1.7);
      const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const fs = Math.min(34, Math.max(14, ts * 1.15)) * (p.big ? 1.4 : 1) * scale;
      const x = Math.min(size.cssW - fs, Math.max(fs, p.x * ts));
      const y = Math.min(size.cssH - 4, Math.max(fs + 4, p.y * ts - rise));
      g.save();
      g.globalAlpha = alpha;
      g.font = `900 ${Math.round(fs)}px system-ui, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineJoin = "round";
      g.lineWidth = Math.max(3, fs * 0.22);
      g.strokeStyle = "rgba(14, 12, 29, 0.92)";
      g.strokeText(p.text, x, y);
      g.fillStyle = p.color;
      g.fillText(p.text, x, y);
      g.restore();
    }
  }

  // Frost around the edges while the viewer is frozen.
  const mine = d.me >= 0 ? painters[d.me] : undefined;
  if (mine && view.phase === "play" && sNow < mine.frozen) {
    const cw = size.cssW;
    const ch = size.cssH;
    const grad = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
    grad.addColorStop(0, "rgba(186, 230, 253, 0)");
    grad.addColorStop(1, "rgba(186, 230, 253, 0.45)");
    g.fillStyle = grad;
    g.fillRect(0, 0, cw, ch);
  }
}

// ---------- component ----------

export interface TurfBoardProps {
  view: TurfView;
  painters: Painter[];
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
  const { view, painters, colors, avatars, away, me, steer, pending, serverNow, onEvent, label, children } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef<Size>({ cssW: 0, cssH: 0, dpr: 1 });
  const animRef = useRef<Anim>(newAnim());
  const dataRef = useRef<Data | null>(null);
  const swipeRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const reducedRef = useRef(false);

  // Keep the renderer's copy of the props current and fold in each new server update.
  useEffect(() => {
    const a = animRef.current;
    const key = colors.join();
    const palettes = colors.map(palette);
    dataRef.current = { view, painters, palettes, avatars, away, me, pending, serverNow, reduced: reducedRef.current };
    if (key !== a.paletteKey) {
      a.paletteKey = key;
      a.layerDirty = true;
    }
    if (view.seq !== a.seq || view.tiles !== a.tiles) ingest(a, view, painters, performance.now());
  });

  // Score pops from transient server events.
  useEffect(
    () =>
      onEvent((raw) => {
        const e = raw as TurfEvent | null;
        const d = dataRef.current;
        if (!e || typeof e !== "object" || !d) return;
        const color = d.palettes[e.by]?.trail ?? "#fff";
        const t0 = performance.now();
        if (e.type === "capture" && Number.isFinite(e.n) && e.n > 0) {
          animRef.current.pops.push({ x: e.x + 0.5, y: e.y + 0.5, text: `+${e.n}!`, color, big: e.n >= 30, t0 });
        } else if (e.type === "power" && (POWER_KINDS as readonly string[]).includes(e.kind)) {
          const text = e.kind === "bomb" ? `💣 +${e.n}` : e.kind === "dash" ? "⚡ DASH" : "🧊 FREEZE";
          animRef.current.pops.push({ x: e.x + 0.5, y: e.y + 0.5, text, color, big: e.kind === "freeze", t0 });
        }
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
        animRef.current.layerDirty = true;
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

  // Render loop.
  useEffect(() => {
    const base = document.createElement("canvas");
    const layer = document.createElement("canvas");
    const textures = { key: "", list: [] as (CanvasPattern | null)[] };
    let raf = 0;
    let idleKey = "";
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const cv = canvasRef.current;
      const d = dataRef.current;
      if (!cv || !d) return;
      // After the final whistle the picture stops changing once pops and flashes fade: skip the work.
      const a = animRef.current;
      const key = `${a.seq}|${cv.width}x${cv.height}|${a.paletteKey}|${d.me}`;
      const settled = d.view.phase === "over" && !a.pops.length && !a.flashes.length && now - a.arrived > 2 * TICK_MS;
      if (settled && key === idleKey && !a.layerDirty) return;
      try {
        drawFrame(cv, sizeRef.current, a, d, base, layer, textures, now);
        idleKey = settled ? key : "";
      } catch (err) {
        // Never let a drawing glitch take the page down; try again next frame.
        console.warn("turf: draw failed", err);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
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
          if (!steer) return;
          swipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const s = swipeRef.current;
          if (!steer || !s || s.id !== e.pointerId) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
          steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
          // Keep tracking from here so one long drag can chain turns.
          swipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
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
