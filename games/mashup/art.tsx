"use client";

// Read-only rendering for Monster Mashup: finished parts, assembled monsters,
// the guide strip, and a client-side cache of monsters already received.

import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from "react";
import { BG } from "../sketch/shared";
import type { DrawStroke, MashupAction, MashupEvent } from "./server";
import { GUIDE, H, PART_ICON, PART_LABEL, W } from "./shared";

// Same geometry as Sketch Storm (quadratic curves through segment midpoints),
// so a part looks the same in the reveal as it did on the artist's canvas.
export function strokePath(g: CanvasRenderingContext2D, s: DrawStroke) {
  const p = s.pts;
  const n = p.length >> 1;
  if (!n) return;
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

/** Paint the placeholder or the strokes of one part (in logical units). */
function paintPart(g: CanvasRenderingContext2D, strokes: DrawStroke[] | null | undefined, blank: boolean, part: number) {
  if (blank) {
    g.strokeStyle = "#cbd5e1";
    g.lineWidth = 4;
    g.setLineDash([14, 12]);
    g.strokeRect(24, 24, W - 48, H - 48);
    g.setLineDash([]);
    g.fillStyle = "#94a3b8";
    g.font = "600 34px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(`🫥 no ${PART_LABEL[part].toLowerCase()} drawn`, W / 2, H / 2);
    return;
  }
  if (!strokes) {
    g.fillStyle = "#cbd5e1";
    g.font = "600 40px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(`${PART_ICON[part]} …`, W / 2, H / 2);
    return;
  }
  for (const s of strokes) strokePath(g, s);
}

/** A white canvas W wide and `lh` tall (logical), sized to its element and DPR aware. */
function StrokeCanvas({
  strokes,
  blank,
  part,
  lh,
  label,
  className = "",
  style,
}: {
  strokes: DrawStroke[] | null | undefined;
  blank: boolean;
  part: number;
  lh: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const paint = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round((c.clientWidth || W) * dpr));
      const h = Math.max(1, Math.round((w * lh) / W));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = BG;
      g.fillRect(0, 0, w, h);
      g.setTransform(w / W, 0, 0, w / W, 0, 0);
      paintPart(g, strokes, blank, part);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(c);
    return () => ro.disconnect();
  }, [strokes, blank, part, lh]);
  return (
    <canvas
      ref={ref}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={`block w-full bg-white ${className}`}
      style={{ aspectRatio: `${W} / ${lh}`, ...style }}
    />
  );
}

/** One finished part. `strokes` undefined = still loading. */
export function PartArt({
  strokes,
  blank,
  part,
  label,
  className = "",
}: {
  strokes: DrawStroke[] | undefined;
  blank: boolean;
  part: number;
  label?: string;
  className?: string;
}) {
  return <StrokeCanvas strokes={strokes} blank={blank} part={part} lh={H} label={label} className={className} />;
}

/**
 * A whole monster: head, body and legs stacked edge to edge.
 * With `assemble`, the parts slide together (head from above, legs from below).
 */
export function MonsterArt({
  parts,
  blank,
  label,
  assemble = false,
  className = "",
}: {
  parts: DrawStroke[][] | undefined;
  blank: boolean[];
  label: string;
  assemble?: boolean;
  className?: string;
}) {
  return (
    <figure
      role="img"
      aria-label={label}
      className={`relative flex flex-col overflow-hidden rounded-xl bg-white shadow-lg shadow-black/40 ring-1 ring-white/10 ${className}`}
    >
      {[0, 1, 2].map((k) => (
        <PartArt
          key={k}
          part={k}
          strokes={parts?.[k]}
          blank={!!blank[k]}
          className={assemble ? `mm-in-${k}` : ""}
        />
      ))}
    </figure>
  );
}

/** The bottom strip of the part above yours: the only bit of it you get to see. */
export function GuideStrip({ strokes, blank }: { strokes: DrawStroke[] | null; blank: boolean }) {
  return (
    <div className="relative">
      <StrokeCanvas strokes={strokes ?? []} blank={false} part={0} lh={GUIDE} />
      {/* Faded and hatched so it reads as "not yours, just a guide". */}
      <div aria-hidden className="mm-hatch pointer-events-none absolute inset-0" />
      {blank && (
        <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold text-slate-500">
          The part above was left blank: start fresh!
        </span>
      )}
    </div>
  );
}

// ---------- monsters already received ----------

export const mkey = (r: number, m: number) => `${r}:${m}`;

/** Finished monsters this client has seen, keyed "round:monster". */
export class MonsterCache {
  private map = new Map<string, DrawStroke[][]>();
  private subs = new Set<() => void>();
  private version = 0;

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  getVersion = () => this.version;

  get(key: string): DrawStroke[][] | undefined {
    return this.map.get(key);
  }

  has(key: string) {
    return this.map.has(key);
  }

  /** Take in a "monsters" event. */
  handle(raw: unknown) {
    if (!raw || typeof raw !== "object") return;
    const e = raw as MashupEvent;
    if (e.k !== "monsters" || typeof e.r !== "number" || !Array.isArray(e.list)) return;
    let added = false;
    for (const it of e.list) {
      if (!it || typeof it.m !== "number" || !Array.isArray(it.parts)) continue;
      const key = mkey(e.r, it.m);
      if (this.map.has(key)) continue;
      this.map.set(key, it.parts.map((p) => (Array.isArray(p) ? p : [])));
      added = true;
    }
    if (added) {
      this.version += 1;
      for (const fn of this.subs) fn();
    }
  }
}

/** A cached monster (stable reference once it arrives). */
export function useMonster(cache: MonsterCache, r: number, m: number): DrawStroke[][] | undefined {
  return useSyncExternalStore(
    cache.subscribe,
    () => cache.get(mkey(r, m)),
    () => undefined,
  );
}

/** Ask the server for any of these monsters we don't have yet (retrying gently). */
export function useFetchMonsters(cache: MonsterCache, r: number, list: number[], act: (a: MashupAction) => void, delay = 500) {
  const key = r >= 0 ? list.join(",") : "";
  useEffect(() => {
    if (!key) return;
    const ms = key.split(",").map(Number);
    const ask = () => {
      const missing = ms.filter((m) => !cache.has(mkey(r, m)));
      if (missing.length) act({ type: "monsters", r, list: missing.slice(0, 24) });
    };
    // Pushed monsters usually arrive on their own: only ask if they don't.
    const first = window.setTimeout(ask, delay);
    const timer = window.setInterval(ask, 1_600);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [cache, r, key, act, delay]);
}
