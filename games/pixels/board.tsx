"use client";

// The shared pixel board: an optimistic paint store plus a canvas renderer.
//
// CanvasStore keeps the board as the server last told us (`base`, at revision `rev`)
// and overlays this player's own pixels that are still in flight (`pending`). Taps and
// drags go into a queue that drains at the same pace the server allows (a small burst,
// then one pixel per ~190ms), so every pixel shows the instant it is placed and the
// server never has to refuse a well-behaved client. Placed pixels are batched into one
// message at most every 100ms. Pixels from everyone (our own included) come back as
// "px" events: those confirm our pending pixels and flash everyone else's in the
// painter's colour. Views and events race through React differently, so the revision
// decides which board is newer, and a gap in revisions asks the server for a resync.

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent as RKeyboardEvent,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from "react";
import type { PixelsView } from "./server";
import { BLANK, CLIENT_BURST, CLIENT_PACE_MS, COLORS, EMBLEM, MAX_BATCH, bestMatch, type PixelsEvent } from "./shared";
import { drawAvatar } from "@/lib/avatar-art";

const SEND_GAP_MS = 100;
const QUEUE_MAX = 64;
/** An unconfirmed pixel this old is dropped (its message must have been lost). */
const PENDING_TTL_MS = 4_000;
const SYNC_RETRY_MS = 1_100;
const FLASH_MS = 900;
const PRESENCE_MS = 1_700;
const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 5];
const MAX_ZOOM = 5;

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const RGB = COLORS.map((c) => hexToRgb(c.hex));

interface Flash {
  cell: number;
  who: number;
  t0: number;
}

export class CanvasStore {
  w = 0;
  h = 0;
  round = -1;
  base = new Uint8Array(0);
  rev = -1;
  /** Highest revision any event mentioned (to notice pixels we never got). */
  seen = -1;
  pending = new Map<number, { c: number; n: number; t: number }>();
  queue: { cell: number; c: number }[] = [];
  tokens = CLIENT_BURST;
  tokAt = 0;
  outbox: number[] = [];
  lastSend = -Infinity;
  flushTimer = 0;
  pumpTimer = 0;
  flashes: Flash[] = [];
  /** Each painter's latest pixel, for the little avatar that follows them. */
  presence = new Map<number, { cell: number; t: number }>();
  you = -1;
  canPaint = false;
  needSync = false;
  askedAt = -Infinity;
  /** Display colours changed since the canvas image was rebuilt. */
  dirty = true;
  private sender: (px: number[]) => void = () => {};
  private subs = new Set<() => void>();

  setSender(fn: (px: number[]) => void) {
    this.sender = fn;
  }

  subscribe(fn: () => void) {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  private changed() {
    this.dirty = true;
    for (const fn of this.subs) fn();
  }

  private load(board: string, rev: number) {
    const n = board.length;
    if (this.base.length !== n) this.base = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.base[i] = board.charCodeAt(i) - 48;
    this.rev = rev;
    this.needSync = this.seen > rev;
  }

  /** A view arrived (it may be older than events we've already applied). */
  adopt(v: PixelsView) {
    this.you = v.you;
    if (v.round !== this.round || v.w !== this.w || v.h !== this.h) {
      this.round = v.round;
      this.w = v.w;
      this.h = v.h;
      this.load(v.board, v.rev);
      this.pending.clear();
      this.queue = [];
      this.outbox = [];
      this.flashes = [];
      this.presence.clear();
    } else if (v.rev >= this.rev && v.board.length === v.w * v.h) {
      this.load(v.board, v.rev);
    }
    this.canPaint = v.phase === "paint" && v.you >= 0;
    if (!this.canPaint) {
      this.queue = [];
      this.outbox = [];
      this.pending.clear();
    }
    if (v.phase !== "paint") {
      // The show is over: a clean board for the reveal.
      this.flashes = [];
      this.presence.clear();
    }
    this.changed();
  }

  handle(raw: unknown) {
    if (!raw || typeof raw !== "object") return;
    const e = raw as PixelsEvent;
    const now = performance.now();
    if (e.k === "px" && Array.isArray(e.d) && typeof e.r === "number") {
      this.seen = Math.max(this.seen, e.r);
      if (this.round < 0) {
        this.needSync = true;
        return;
      }
      const n = Math.floor(e.d.length / 3);
      const first = e.r - n + 1;
      if (first > this.rev + 1) this.needSync = true;
      const size = this.w * this.h;
      for (let i = 0; i < n; i++) {
        const who = e.d[i * 3];
        const cell = e.d[i * 3 + 1];
        const c = e.d[i * 3 + 2];
        if (!(cell >= 0 && cell < size && c >= 0 && c < COLORS.length)) continue;
        if (who === this.you) this.settle(cell);
        else {
          this.flashes.push({ cell, who, t0: now });
          this.presence.set(who, { cell, t: now });
        }
        if (first + i > this.rev) this.base[cell] = c;
      }
      this.rev = Math.max(this.rev, e.r);
      this.changed();
    } else if (e.k === "no" && Array.isArray(e.c)) {
      for (const cell of e.c) this.settle(cell);
      this.changed();
    } else if (e.k === "board" && typeof e.b === "string" && typeof e.r === "number") {
      if (e.r >= this.rev && e.b.length === this.w * this.h) {
        this.load(e.b, e.r);
        this.changed();
      }
    }
  }

  /** One of our in-flight pixels was answered (accepted or refused). */
  private settle(cell: number) {
    const p = this.pending.get(cell);
    if (!p) return;
    p.n -= 1;
    if (p.n <= 0) this.pending.delete(cell);
  }

  markDirty() {
    this.dirty = true;
  }

  /** True (once) when the display changed since the last call. */
  takeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  /** Forget flashes older than `ms`; returns the live ones. */
  liveFlashes(now: number, ms: number): Flash[] {
    if (this.flashes.length && now - this.flashes[0].t0 >= ms) this.flashes = this.flashes.filter((f) => now - f.t0 < ms);
    return this.flashes;
  }

  colorAt(cell: number): number {
    const p = this.pending.get(cell);
    return p ? p.c : this.base[cell];
  }

  /** What this player sees right now (base + own pending pixels). */
  display(): Uint8Array {
    const out = this.base.slice();
    for (const [cell, p] of this.pending) out[cell] = p.c;
    return out;
  }

  match(art: number[]) {
    return bestMatch(this.display(), this.w, this.h, art);
  }

  enqueue(cell: number, c: number) {
    if (!this.canPaint || cell < 0 || cell >= this.w * this.h) return;
    const last = this.queue[this.queue.length - 1];
    if (last && last.cell === cell && last.c === c) return;
    if (!this.queue.length && this.colorAt(cell) === c) return;
    if (this.queue.length >= QUEUE_MAX) return;
    this.queue.push({ cell, c });
    this.pump();
  }

  /** Place queued pixels as fast as the paint budget allows. */
  pump() {
    const now = performance.now();
    this.tokens = Math.min(CLIENT_BURST, this.tokens + Math.max(0, now - this.tokAt) / CLIENT_PACE_MS);
    this.tokAt = now;
    let placed = false;
    while (this.queue.length && this.tokens >= 1 && this.canPaint) {
      const it = this.queue.shift()!;
      if (this.colorAt(it.cell) === it.c) continue;
      this.tokens -= 1;
      const p = this.pending.get(it.cell);
      this.pending.set(it.cell, { c: it.c, n: (p?.n ?? 0) + 1, t: now });
      this.flashes.push({ cell: it.cell, who: this.you, t0: now });
      this.outbox.push(it.cell, it.c);
      placed = true;
    }
    window.clearTimeout(this.pumpTimer);
    this.pumpTimer = 0;
    if (this.queue.length) {
      this.pumpTimer = window.setTimeout(() => this.pump(), Math.max(8, (1 - this.tokens) * CLIENT_PACE_MS + 2));
    }
    if (placed) {
      this.scheduleFlush(now);
      this.changed();
    } else if (!this.queue.length) {
      for (const fn of this.subs) fn();
    }
  }

  private scheduleFlush(now: number) {
    if (now - this.lastSend >= SEND_GAP_MS) this.flush();
    else if (!this.flushTimer) {
      this.flushTimer = window.setTimeout(() => {
        this.flushTimer = 0;
        this.flush();
      }, SEND_GAP_MS - (now - this.lastSend));
    }
  }

  private flush() {
    if (!this.outbox.length) return;
    const now = performance.now();
    const px = this.outbox.splice(0, MAX_BATCH * 2);
    this.lastSend = now;
    this.sender(px);
    if (this.outbox.length) this.scheduleFlush(now);
  }

  /** Drop pixels whose answer never came. */
  expire(now: number) {
    let any = false;
    for (const [cell, p] of this.pending) {
      if (now - p.t > PENDING_TTL_MS) {
        this.pending.delete(cell);
        any = true;
      }
    }
    if (any) this.changed();
  }

  /** True when a resync should be requested now. */
  wantsSync(now: number): boolean {
    if (!this.needSync || now - this.askedAt < SYNC_RETRY_MS) return false;
    this.askedAt = now;
    return true;
  }

  dispose() {
    window.clearTimeout(this.pumpTimer);
    window.clearTimeout(this.flushTimer);
    this.subs.clear();
  }
}

/** Cells on the straight line from a to b, excluding a (Bresenham). */
function lineCells(a: number, b: number, w: number): number[] {
  let x0 = a % w;
  let y0 = Math.floor(a / w);
  const x1 = b % w;
  const y1 = Math.floor(b / w);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out: number[] = [];
  for (let guard = 0; guard < 400 && !(x0 === x1 && y0 === y1); guard++) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
    out.push(y0 * w + x0);
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Surface {
  W: number;
  H: number;
  dpr: number;
  small: HTMLCanvasElement;
  img: ImageData | null;
}

interface Gesture {
  pointers: Map<number, { x: number; y: number }>;
  mode: "none" | "paint" | "pan" | "pinch";
  last: number;
  x0: number;
  y0: number;
  panX: number;
  panY: number;
  zoom: number;
  dist: number;
}

export interface BoardProps {
  store: CanvasStore;
  w: number;
  h: number;
  /** Zoom and pan are for painting; other phases show the whole board. */
  zoomable: boolean;
  canPaint: boolean;
  color: number;
  /** Painter colour and avatar per player index. */
  colors: string[];
  avatars: string[];
  you: number;
  /** The viewer's live best spot (dashed box). */
  mineBox: { x: number; y: number } | null;
  toolbar?: ReactNode;
  /** Laid over the board; board-percentage coordinates only hold in unzoomed phases. */
  overlay?: ReactNode;
  label: string;
}

export function Board({ store, w, h, zoomable, canPaint, color, colors, avatars, you, mineBox, toolbar, overlay, label }: BoardProps) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surface = useRef<Surface | null>(null);
  const zoomRef = useRef(1);
  const pan = useRef({ x: 0, y: 0 });
  const hover = useRef(-1);
  const cursor = useRef(-1);
  const keyboard = useRef(false);
  const kick = useRef<() => void>(() => {});
  const gesture = useRef<Gesture>({ pointers: new Map(), mode: "none", last: -1, x0: 0, y0: 0, panX: 0, panY: 0, zoom: 1, dist: 1 });
  const [zoom, setZoomUi] = useState(1);
  const [panMode, setPanMode] = useState(false);
  const shownZoom = zoomable ? zoom : 1;

  // ---------- drawing ----------

  const draw = useEffectEvent((now: number): boolean => {
    const canvas = canvasRef.current;
    const s = surface.current;
    if (!canvas || !s || store.w === 0) return false;
    const g = canvas.getContext("2d");
    if (!g) return false;
    const { W, H, dpr } = s;
    const bw = store.w;
    const bh = store.h;

    // Board pixels live on a 1px-per-cell image, scaled up without smoothing.
    const dirty = store.takeDirty();
    if (dirty || !s.img || s.img.width !== bw || s.img.height !== bh) {
      if (s.small.width !== bw || s.small.height !== bh) {
        s.small.width = bw;
        s.small.height = bh;
      }
      const sg = s.small.getContext("2d");
      if (sg) {
        if (!s.img || s.img.width !== bw || s.img.height !== bh) s.img = sg.createImageData(bw, bh);
        const d = s.img.data;
        const shown = store.display();
        for (let i = 0; i < shown.length; i++) {
          const rgb = RGB[shown[i]] ?? RGB[0];
          d[i * 4] = rgb[0];
          d[i * 4 + 1] = rgb[1];
          d[i * 4 + 2] = rgb[2];
          d[i * 4 + 3] = 255;
        }
        sg.putImageData(s.img, 0, 0);
      }
    }

    const z = zoomable ? zoomRef.current : 1;
    const vw = bw / z;
    const vh = bh / z;
    const px = clamp(pan.current.x, 0, bw - vw);
    const py = clamp(pan.current.y, 0, bh - vh);
    const cs = W / vw;
    const csy = H / vh;
    const X = (cx: number) => (cx - px) * cs;
    const Y = (cy: number) => (cy - py) * csy;
    const cellX = (cell: number) => X(cell % bw);
    const cellY = (cell: number) => Y(Math.floor(cell / bw));

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = BLANK;
    g.fillRect(0, 0, W, H);
    g.drawImage(s.small, X(0), Y(0), bw * cs, bh * csy);

    // Grid: faint lines per pixel, firmer every 5 (emblem-sized blocks are easy to count).
    if (cs / dpr >= 5) {
      const fine = Math.min(0.12, (cs / dpr - 5) * 0.015 + 0.05);
      g.lineWidth = 1;
      for (const [step, alpha] of [
        [1, fine],
        [5, fine + 0.1],
      ] as const) {
        g.strokeStyle = `rgba(38, 34, 63, ${alpha})`;
        g.beginPath();
        for (let i = Math.ceil(px / step) * step; i <= px + vw; i += step) {
          const x = Math.round(X(i)) + 0.5;
          g.moveTo(x, 0);
          g.lineTo(x, H);
        }
        for (let j = Math.ceil(py / step) * step; j <= py + vh; j += step) {
          const y = Math.round(Y(j)) + 0.5;
          g.moveTo(0, y);
          g.lineTo(W, y);
        }
        g.stroke();
      }
    }

    // Queued pixels (dragged faster than the paint budget): small colour dots.
    for (const q of store.queue) {
      const x = cellX(q.cell);
      const y = cellY(q.cell);
      const inset = cs * 0.3;
      g.fillStyle = COLORS[q.c].hex;
      g.globalAlpha = 0.75;
      g.fillRect(x + inset, y + inset, cs - inset * 2, csy - inset * 2);
      g.globalAlpha = 1;
      g.strokeStyle = "rgba(38, 34, 63, 0.45)";
      g.lineWidth = Math.max(1, dpr * 0.75);
      g.strokeRect(x + inset, y + inset, cs - inset * 2, csy - inset * 2);
    }

    // The viewer's live best copy.
    if (mineBox && you >= 0) {
      g.save();
      g.setLineDash([4 * dpr, 3 * dpr]);
      g.lineWidth = 2 * dpr;
      g.strokeStyle = "rgba(14, 12, 29, 0.7)";
      g.strokeRect(X(mineBox.x) - dpr, Y(mineBox.y) - dpr, EMBLEM * cs + 2 * dpr, EMBLEM * csy + 2 * dpr);
      g.strokeStyle = colors[you] ?? "#fff";
      g.lineDashOffset = 3.5 * dpr;
      g.strokeRect(X(mineBox.x) - dpr, Y(mineBox.y) - dpr, EMBLEM * cs + 2 * dpr, EMBLEM * csy + 2 * dpr);
      g.restore();
    }

    // Fresh pixels flash an outline in their painter's colour.
    const flashes = store.liveFlashes(now, FLASH_MS);
    for (const f of flashes) {
      const age = (now - f.t0) / FLASH_MS;
      const a = 1 - age;
      const grow = Math.min(cs, 24 * dpr) * 0.35 * (1 - (1 - age) * (1 - age));
      const lw = Math.max(1.5 * dpr, Math.min(cs * 0.16, 3.5 * dpr));
      // Drawn just outside the cell so the fresh pixel itself stays visible.
      const out = grow + lw / 2;
      const x = cellX(f.cell) - out;
      const y = cellY(f.cell) - out;
      g.globalAlpha = a * 0.35;
      g.strokeStyle = "#0e0c1d";
      g.lineWidth = lw + 1.5 * dpr;
      g.strokeRect(x, y, cs + out * 2, csy + out * 2);
      g.globalAlpha = a;
      g.strokeStyle = colors[f.who] ?? "#ffffff";
      g.lineWidth = lw;
      g.strokeRect(x, y, cs + out * 2, csy + out * 2);
    }
    g.globalAlpha = 1;

    // Who is painting where: a little avatar bubble trails each other painter.
    let live = flashes.length > 0 || store.queue.length > 0;
    const r = clamp(cs * 0.55, 8 * dpr, 13 * dpr);
    for (const [who, p] of store.presence) {
      const age = now - p.t;
      if (age > PRESENCE_MS || who === you) continue;
      live = true;
      const a = age > PRESENCE_MS - 400 ? (PRESENCE_MS - age) / 400 : 1;
      const cx = clamp(cellX(p.cell) + cs + r * 0.45, r + dpr, W - r - dpr);
      const cy = clamp(cellY(p.cell) - r * 0.45, r + dpr, H - r - dpr);
      g.globalAlpha = a;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fillStyle = colors[who] ?? "#fff";
      g.fill();
      g.lineWidth = 1.5 * dpr;
      g.strokeStyle = "#0e0c1d";
      g.stroke();
      g.font = `${Math.round(r * 1.15)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      drawAvatar(g, avatars[who] ?? "🙂", cx, cy);
    }
    g.globalAlpha = 1;

    // Mouse hover preview and the keyboard cursor.
    const target = keyboard.current ? cursor.current : hover.current;
    if (canPaint && target >= 0 && target < bw * bh) {
      const x = cellX(target);
      const y = cellY(target);
      g.fillStyle = COLORS[color].hex;
      g.globalAlpha = 0.65;
      g.fillRect(x, y, cs, csy);
      g.globalAlpha = 1;
      g.lineWidth = Math.max(1.5 * dpr, cs * 0.08);
      g.strokeStyle = "#0e0c1d";
      g.strokeRect(x, y, cs, csy);
      g.strokeStyle = "#ffffff";
      g.lineWidth = dpr;
      g.strokeRect(x - dpr, y - dpr, cs + 2 * dpr, csy + 2 * dpr);
    }
    return live;
  });

  // Render loop: runs only while something is animating; everything else kicks it.
  useEffect(() => {
    let raf = 0;
    const frame = (t: number) => {
      raf = 0;
      if (draw(t)) raf = requestAnimationFrame(frame);
    };
    const go = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    kick.current = go;
    const off = store.subscribe(go);
    go();
    return () => {
      off();
      cancelAnimationFrame(raf);
      kick.current = () => {};
    };
  }, [store]);

  useEffect(() => {
    kick.current();
  }, [w, h, zoomable, canPaint, color, colors, avatars, you, mineBox, shownZoom]);

  // Crisp backing store at any devicePixelRatio.
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
      if (cur && cur.W === W && cur.H === H) return;
      canvas.width = W;
      canvas.height = H;
      surface.current = { W, H, dpr, small: cur?.small ?? document.createElement("canvas"), img: cur?.img ?? null };
      store.markDirty();
      kick.current();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(holder);
    return () => ro.disconnect();
  }, [store]);

  // Unanswered pixels expire.
  useEffect(() => {
    const id = window.setInterval(() => store.expire(performance.now()), 1_000);
    return () => window.clearInterval(id);
  }, [store]);

  // ---------- zoom & pan ----------

  const setZoom = (nz: number, ax = 0.5, ay = 0.5) => {
    const z0 = zoomRef.current;
    const z = clamp(nz, 1, MAX_ZOOM);
    // Keep the board point under (ax, ay) (fractions of the view) fixed.
    const bx = pan.current.x + ax * (store.w / z0);
    const by = pan.current.y + ay * (store.h / z0);
    pan.current = {
      x: clamp(bx - ax * (store.w / z), 0, store.w - store.w / z),
      y: clamp(by - ay * (store.h / z), 0, store.h - store.h / z),
    };
    zoomRef.current = z;
    setZoomUi(z);
    if (z <= 1) setPanMode(false);
    kick.current();
  };
  const zoomIn = () => setZoom(ZOOM_STEPS.find((z) => z > zoomRef.current + 0.01) ?? MAX_ZOOM);
  const zoomOut = () => setZoom([...ZOOM_STEPS].reverse().find((z) => z < zoomRef.current - 0.01) ?? 1);

  // Wheel: pans when zoomed, ctrl/pinch-wheel zooms at the pointer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !zoomable) return;
    const onWheel = (e: WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      if (e.ctrlKey) {
        e.preventDefault();
        const z0 = zoomRef.current;
        const z = clamp(z0 * Math.exp(-e.deltaY * 0.01), 1, MAX_ZOOM);
        const ax = (e.clientX - r.left) / r.width;
        const ay = (e.clientY - r.top) / r.height;
        const bx = pan.current.x + ax * (store.w / z0);
        const by = pan.current.y + ay * (store.h / z0);
        pan.current = {
          x: clamp(bx - ax * (store.w / z), 0, store.w - store.w / z),
          y: clamp(by - ay * (store.h / z), 0, store.h - store.h / z),
        };
        zoomRef.current = z;
        setZoomUi(z);
        kick.current();
        return;
      }
      if (zoomRef.current <= 1) return;
      e.preventDefault();
      const z = zoomRef.current;
      pan.current = {
        x: clamp(pan.current.x + (e.deltaX / r.width) * (store.w / z), 0, store.w - store.w / z),
        y: clamp(pan.current.y + (e.deltaY / r.height) * (store.h / z), 0, store.h - store.h / z),
      };
      kick.current();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [store, zoomable]);

  // ---------- pointer input ----------

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, rw: r.width, rh: r.height };
  };
  const cellAt = (e: { clientX: number; clientY: number }) => {
    const { x, y, rw, rh } = local(e);
    const z = zoomable ? zoomRef.current : 1;
    const vw = store.w / z;
    const vh = store.h / z;
    const px = clamp(pan.current.x, 0, store.w - vw);
    const py = clamp(pan.current.y, 0, store.h - vh);
    const cx = Math.floor(px + (x / rw) * vw);
    const cy = Math.floor(py + (y / rh) * vh);
    return cx < 0 || cy < 0 || cx >= store.w || cy >= store.h ? -1 : cy * store.w + cx;
  };

  const startPinch = () => {
    const g = gesture.current;
    const [a, b] = [...g.pointers.values()];
    g.mode = "pinch";
    g.dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    g.zoom = zoomRef.current;
    g.x0 = (a.x + b.x) / 2;
    g.y0 = (a.y + b.y) / 2;
    g.panX = pan.current.x;
    g.panY = pan.current.y;
  };

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    keyboard.current = false;
    const p = local(e);
    g.pointers.set(e.pointerId, { x: p.x, y: p.y });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (g.pointers.size >= 2) {
      if (zoomable) startPinch();
      else g.mode = "none";
      return;
    }
    const wantsPan = zoomable && zoomRef.current > 1 && (panMode || e.button === 1 || e.button === 2 || !canPaint);
    if (wantsPan) {
      e.preventDefault();
      g.mode = "pan";
      g.x0 = p.x;
      g.y0 = p.y;
      g.panX = pan.current.x;
      g.panY = pan.current.y;
      return;
    }
    if (!canPaint || e.button !== 0) return;
    e.preventDefault();
    const cell = cellAt(e);
    g.mode = "paint";
    g.last = cell;
    if (cell >= 0) store.enqueue(cell, color);
  };

  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    const p = local(e);
    if (g.pointers.has(e.pointerId)) g.pointers.set(e.pointerId, { x: p.x, y: p.y });
    if (g.mode === "pinch" && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()];
      const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      const z = clamp(g.zoom * (d / g.dist), 1, MAX_ZOOM);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const bx = g.panX + (g.x0 / p.rw) * (store.w / g.zoom);
      const by = g.panY + (g.y0 / p.rh) * (store.h / g.zoom);
      pan.current = {
        x: clamp(bx - (mx / p.rw) * (store.w / z), 0, store.w - store.w / z),
        y: clamp(by - (my / p.rh) * (store.h / z), 0, store.h - store.h / z),
      };
      zoomRef.current = z;
      setZoomUi(z);
      kick.current();
      return;
    }
    if (g.mode === "pan") {
      const z = zoomRef.current;
      pan.current = {
        x: clamp(g.panX - ((p.x - g.x0) / p.rw) * (store.w / z), 0, store.w - store.w / z),
        y: clamp(g.panY - ((p.y - g.y0) / p.rh) * (store.h / z), 0, store.h - store.h / z),
      };
      kick.current();
      return;
    }
    const cell = cellAt(e);
    if (g.mode === "paint") {
      if (cell >= 0 && cell !== g.last) {
        const path = g.last >= 0 ? lineCells(g.last, cell, store.w) : [cell];
        for (const c of path) store.enqueue(c, color);
        g.last = cell;
      }
      return;
    }
    if (e.pointerType !== "touch" && cell !== hover.current) {
      hover.current = cell;
      kick.current();
    }
  };

  const endPointer = (e: RPointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size === 0) g.mode = "none";
    else if (g.mode === "pinch") g.mode = "none";
  };

  const onPointerLeave = () => {
    if (hover.current !== -1) {
      hover.current = -1;
      kick.current();
    }
  };

  // ---------- keyboard ----------

  const onKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const bw = store.w;
    const bh = store.h;
    if (!bw) return;
    const step = e.shiftKey ? 5 : 1;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (move[e.key]) {
      e.preventDefault();
      keyboard.current = true;
      const c = cursor.current >= 0 ? cursor.current : Math.floor(bh / 2) * bw + Math.floor(bw / 2);
      const x = clamp((c % bw) + move[e.key][0], 0, bw - 1);
      const y = clamp(Math.floor(c / bw) + move[e.key][1], 0, bh - 1);
      cursor.current = y * bw + x;
      // Keep the cursor in view when zoomed.
      const z = zoomable ? zoomRef.current : 1;
      const vw = bw / z;
      const vh = bh / z;
      const p = pan.current;
      pan.current = {
        x: clamp(x < p.x ? x : x >= p.x + vw ? x - vw + 1 : p.x, 0, bw - vw),
        y: clamp(y < p.y ? y : y >= p.y + vh ? y - vh + 1 : p.y, 0, bh - vh),
      };
      kick.current();
    } else if ((e.key === " " || e.key === "Enter") && canPaint) {
      e.preventDefault();
      keyboard.current = true;
      if (cursor.current < 0) cursor.current = Math.floor(bh / 2) * bw + Math.floor(bw / 2);
      store.enqueue(cursor.current, color);
      kick.current();
    } else if ((e.key === "+" || e.key === "=") && zoomable) {
      e.preventDefault();
      zoomIn();
    } else if (e.key === "-" && zoomable) {
      e.preventDefault();
      zoomOut();
    }
  };

  const zoomed = shownZoom > 1;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-10 items-center gap-2">
        <div className="min-w-0 flex-1">{toolbar}</div>
        {zoomable && (
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Zoom">
            {zoomed && (
              <button
                type="button"
                className={`btn size-10 p-0 text-lg ${panMode ? "border-text/60 bg-text/15" : ""}`}
                aria-pressed={panMode}
                aria-label="Move tool: drag to move the view"
                title="Drag to move the view (or use two fingers / right-drag)"
                onClick={() => setPanMode((m) => !m)}
              >
                ✋
              </button>
            )}
            <button type="button" className="btn size-10 p-0 text-xl" aria-label="Zoom out" disabled={!zoomed} onClick={zoomOut}>
              −
            </button>
            <span className="w-9 text-center font-mono text-xs text-muted tabular-nums" aria-live="polite">
              {Math.round(shownZoom * 10) / 10}×
            </span>
            <button type="button" className="btn size-10 p-0 text-xl" aria-label="Zoom in" disabled={shownZoom >= MAX_ZOOM} onClick={zoomIn}>
              +
            </button>
          </div>
        )}
      </div>
      <div
        className="relative mx-auto w-full overflow-hidden rounded-xl border-2 border-line bg-[#f6f3ea] shadow-[0_10px_40px_-18px_rgba(0,0,0,.8)] outline-none focus-visible:border-brand-2"
        style={{ maxWidth: `calc(62vh * ${w} / ${h})` }}
        tabIndex={0}
        role="application"
        aria-roledescription="pixel canvas"
        aria-label={label}
        onKeyDown={onKeyDown}
        onBlur={() => {
          keyboard.current = false;
          kick.current();
        }}
      >
        <div ref={holderRef} className="relative w-full" style={{ aspectRatio: `${w} / ${h}` }}>
          <canvas
            ref={canvasRef}
            className={`absolute inset-0 block size-full ${canPaint ? (panMode && zoomed ? "cursor-grab" : "cursor-crosshair") : zoomed ? "cursor-grab" : ""}`}
            style={{ touchAction: canPaint || zoomed ? "none" : "pan-y", imageRendering: "pixelated" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onPointerLeave={onPointerLeave}
            onContextMenu={(e) => e.preventDefault()}
          />
          {overlay && <div className="pointer-events-none absolute inset-0">{overlay}</div>}
        </div>
      </div>
    </div>
  );
}
