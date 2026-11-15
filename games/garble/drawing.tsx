"use client";

// Drawing helpers for Garble: a read-only renderer with an optional "pen
// replay", a client-side cache of drawings already received, and the Sketch
// Storm stroke store with Garble's (much smaller) ink limit.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { StrokeStore, type LiveStroke } from "../sketch/canvas";
import { BG, H, W } from "../sketch/shared";
import type { DrawStroke } from "./server";
import { INK_POINTS, MAX_STROKES } from "./shared";

// ---------- rendering ----------
// Same geometry as Sketch Storm (quadratic curves through segment midpoints),
// so a drawing looks the same in the reveal as it did on the artist's canvas.

/** Draw the first `upto` points of a stroke. */
function strokePath(g: CanvasRenderingContext2D, s: DrawStroke, upto: number) {
  const p = s.pts;
  const n = Math.min(p.length >> 1, upto);
  if (n <= 0) return;
  g.strokeStyle = s.color;
  g.fillStyle = s.color;
  g.lineWidth = s.size;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.arc(p[0], p[1], s.size / 2, 0, Math.PI * 2);
  g.fill();
  if (n < 2) return;
  g.beginPath();
  g.moveTo(p[0], p[1]);
  g.lineTo((p[0] + p[2]) / 2, (p[1] + p[3]) / 2);
  for (let j = 1; j <= n - 2; j++) {
    g.quadraticCurveTo(p[2 * j], p[2 * j + 1], (p[2 * j] + p[2 * j + 2]) / 2, (p[2 * j + 1] + p[2 * j + 3]) / 2);
  }
  g.lineTo(p[2 * n - 2], p[2 * n - 1]);
  g.stroke();
}

/**
 * A finished drawing. With `replay` the strokes are re-drawn in order, like
 * watching the pen (skipped with prefers-reduced-motion). Pass a stable
 * `strokes` array: a new array restarts the replay.
 */
export function Drawing({
  strokes,
  label,
  replay = false,
  className = "",
}: {
  strokes: DrawStroke[] | null | undefined;
  label: string;
  replay?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const list = strokes ?? [];
    const total = list.reduce((n, s) => n + (s.pts.length >> 1), 0);
    const still = !replay || total === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dur = still ? 0 : Math.min(2600, 800 + total * 0.6);
    let shown = still ? total : 0;
    let raf = 0;
    let t0 = -1;
    const paint = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round((c.clientWidth || W) * dpr));
      const h = Math.max(1, Math.round((w * H) / W));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = BG;
      g.fillRect(0, 0, w, h);
      g.setTransform(w / W, 0, 0, w / W, 0, 0);
      let left = shown;
      for (const s of list) {
        if (left <= 0) break;
        strokePath(g, s, left);
        left -= s.pts.length >> 1;
      }
    };
    const frame = (now: number) => {
      if (t0 < 0) t0 = now;
      const f = Math.min(1, (now - t0) / dur);
      shown = Math.ceil(total * (1 - (1 - f) * (1 - f)));
      paint();
      raf = f < 1 ? requestAnimationFrame(frame) : 0;
    };
    paint();
    if (dur) raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(paint);
    ro.observe(c);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [strokes, replay]);
  return <canvas ref={ref} role="img" aria-label={label} className={`block aspect-[4/3] w-full bg-white ${className}`} />;
}

// ---------- drawings already received ----------

/**
 * Drawings this client has seen, keyed "book:page". Views only carry the page
 * on stage, so earlier pages of a book come from here (or from a book request).
 */
export class DrawingCache {
  private map = new Map<string, DrawStroke[]>();
  private subs = new Set<() => void>();
  private version = 0;

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  getVersion = () => this.version;

  get(key: string): DrawStroke[] | undefined {
    return this.map.get(key);
  }

  put(key: string, strokes: DrawStroke[]) {
    if (this.map.has(key) || !Array.isArray(strokes)) return;
    this.map.set(key, strokes);
    this.version += 1;
    for (const fn of this.subs) fn();
  }
}

/** A cached drawing (stable reference once it arrives). */
export function useCached(cache: DrawingCache, key: string | null): DrawStroke[] | undefined {
  return useSyncExternalStore(
    cache.subscribe,
    () => (key ? cache.get(key) : undefined),
    () => undefined,
  );
}

/** Re-render whenever the cache gains a drawing. */
export function useCacheVersion(cache: DrawingCache): number {
  return useSyncExternalStore(cache.subscribe, cache.getVersion, () => 0);
}

// ---------- the artist's canvas store ----------

/**
 * Sketch Storm's stroke store with Garble's ink limit. The server ignores
 * points beyond INK_POINTS, and so does this store, so what the artist sees is
 * exactly what gets revealed. A stroke started with no ink left stays empty
 * (the server records it empty too) so undo pops the same stroke on both sides.
 */
export class InkStore extends StrokeStore {
  private inkSubs = new Set<() => void>();
  private lastLevel = -1;

  constructor() {
    super();
    // Enter "turn 0" as its owner, so a later sync from the server (after a
    // refresh) merges with anything drawn meanwhile instead of wiping it.
    this.handle({ k: "sync", t: 0, rev: 0, strokes: [] });
    this.setOwner(0);
  }

  /** Ink used, 0-100 (100 also when the stroke limit is reached). */
  level = () => (this.list.length >= MAX_STROKES ? 100 : Math.min(100, Math.floor((this.points * 100) / INK_POINTS)));

  /** Like subscribe, but also fires as the ink level changes mid-stroke. */
  watch = (fn: () => void) => {
    const off = this.subscribe(fn);
    this.inkSubs.add(fn);
    return () => {
      off();
      this.inkSubs.delete(fn);
    };
  };

  override begin(id: string, color: string, size: number, x: number, y: number): LiveStroke {
    const dry = this.points >= INK_POINTS;
    const s = super.begin(id, color, size, x, y);
    if (dry) {
      s.pts.length = 0;
      this.points -= 1;
    }
    return s;
  }

  override add(s: LiveStroke, x: number, y: number) {
    if (this.points >= INK_POINTS) return;
    super.add(s, x, y);
    const level = this.level();
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      for (const fn of this.inkSubs) fn();
    }
  }
}
