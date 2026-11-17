"use client";

// The drawing surface for Monster Mashup: Sketch Storm's canvas and toolbar
// (games/sketch/canvas.tsx, reused read-only for its StrokeStore) reshaped to
// a 3:2 monster part, with an ink cap and a slower autosave. Nobody watches you
// draw, so points are sent in small batches a few times a second.

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { StrokeStore, isTypingTarget, type LiveStroke } from "../sketch/canvas";
import { BG, MAX_BATCH, PALETTE, SIZES, SIZE_NAMES } from "../sketch/shared";
import type { MashupAction } from "./server";
import { H, INK_POINTS, MAX_STROKES, W } from "./shared";

/** Smallest move worth recording, squared, in logical px. */
const MIN_STEP2 = 4;
/** How often the artist's points are autosaved to the server. */
const FLUSH_MS = 200;
const COLOR_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];
const LIGHT = new Set(["#ffd60a", "#ffcba4", "#4cc9f0", BG]);
const DOT_PX = [4, 8, 14, 22];
const SIZE_LIST: readonly number[] = SIZES;

type DrawAction = Extract<MashupAction, { type: "stroke" | "undo" | "clear" }>;

/**
 * Sketch Storm's stroke store with an ink limit. The server ignores points
 * beyond INK_POINTS, and so does this store, so what the artist sees is
 * exactly what gets revealed.
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

  /** Ink used, 0-100. */
  level = () => (this.list.length >= MAX_STROKES ? 100 : Math.min(100, Math.floor((this.points * 100) / INK_POINTS)));

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

interface Live {
  pointerId: number;
  stroke: LiveStroke;
  pending: number[];
  x: number;
  y: number;
  timer: number;
}

function toLogical(r: DOMRect, cx: number, cy: number): [number, number] {
  const x = Math.round(((cx - r.left) / (r.width || 1)) * W);
  const y = Math.round(((cy - r.top) / (r.height || 1)) * H);
  return [Math.min(W, Math.max(0, x)), Math.min(H, Math.max(0, y))];
}

export function PartCanvas({
  store,
  canDraw,
  act,
  label,
  top,
  overlay,
  frameColor,
}: {
  store: InkStore;
  canDraw: boolean;
  act: (a: DrawAction) => void;
  label: string;
  /** Rendered directly above the canvas, inside the same frame (the guide strip). */
  top?: ReactNode;
  overlay?: ReactNode;
  frameColor: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const gfx = useRef<{ g: CanvasRenderingContext2D; scale: number } | null>(null);
  const live = useRef<Live | null>(null);
  const ids = useRef({ base: "", seq: 0 });
  const [color, setColor] = useState<string>(PALETTE[0].hex);
  const [size, setSize] = useState<number>(SIZES[1]);
  const [eraser, setEraser] = useState(false);
  const [count, setCount] = useState(() => store.list.length);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    let raf = 0;
    const paint = () => {
      const cur = gfx.current;
      if (cur) store.paint(cur.g, cur.scale);
    };
    const resize = () => {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round((canvas.clientWidth || W) * dpr));
      const h = Math.max(1, Math.round((w * H) / W));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gfx.current = { g, scale: w / W };
      store.repaint();
      paint();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const off = store.subscribe(() => {
      setCount(store.list.length);
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          paint();
        });
      }
    });
    let mq: MediaQueryList | null = null;
    const onDpr = () => {
      resize();
      watchDpr();
    };
    const watchDpr = () => {
      mq?.removeEventListener("change", onDpr);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener("change", onDpr);
    };
    watchDpr();
    return () => {
      ro.disconnect();
      off();
      if (raf) cancelAnimationFrame(raf);
      mq?.removeEventListener("change", onDpr);
      gfx.current = null;
    };
  }, [store]);

  // The stage can end mid-stroke: drop the stroke quietly.
  useEffect(() => {
    if (!canDraw) return;
    return () => {
      const l = live.current;
      if (!l) return;
      live.current = null;
      window.clearInterval(l.timer);
      store.finish(l.stroke);
    };
  }, [canDraw, store]);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 2500);
    return () => window.clearTimeout(t);
  }, [armed]);

  const paintNow = () => {
    const cur = gfx.current;
    if (cur) store.paint(cur.g, cur.scale);
  };

  const send = (l: Live, end: boolean) => {
    const { id, color: c, size: z } = l.stroke;
    while (l.pending.length > MAX_BATCH) act({ type: "stroke", id, color: c, size: z, pts: l.pending.splice(0, MAX_BATCH) });
    if (!l.pending.length && !end) return;
    const pts = l.pending.splice(0);
    act(end ? { type: "stroke", id, color: c, size: z, pts, end: true } : { type: "stroke", id, color: c, size: z, pts });
  };

  const nextId = () => {
    const gen = ids.current;
    if (!gen.base) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      gen.base = buf[0].toString(36).slice(0, 6);
    }
    gen.seq += 1;
    return gen.base + gen.seq.toString(36);
  };

  const endStroke = (pointerId?: number) => {
    const l = live.current;
    if (!l || (pointerId !== undefined && pointerId !== l.pointerId)) return;
    live.current = null;
    window.clearInterval(l.timer);
    store.finish(l.stroke);
    send(l, true);
    paintNow();
  };

  const moveCursor = (e: ReactPointerEvent<HTMLCanvasElement>, r: DOMRect) => {
    const el = cursorRef.current;
    if (!el) return;
    if (!canDraw || e.pointerType === "touch") {
      el.style.opacity = "0";
      return;
    }
    const d = Math.max(6, (size * r.width) / W);
    el.style.width = `${d}px`;
    el.style.height = `${d}px`;
    el.style.transform = `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`;
    el.style.borderColor = eraser ? "#64748b" : color;
    el.style.opacity = "1";
  };

  const hideCursor = () => {
    if (cursorRef.current) cursorRef.current.style.opacity = "0";
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || live.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    const canvas = e.currentTarget;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone; draw anyway.
    }
    const [x, y] = toLogical(canvas.getBoundingClientRect(), e.clientX, e.clientY);
    const stroke = store.begin(nextId(), eraser ? BG : color, size, x, y);
    const l: Live = { pointerId: e.pointerId, stroke, pending: [x, y], x, y, timer: 0 };
    l.timer = window.setInterval(() => send(l, false), FLUSH_MS);
    live.current = l;
    paintNow();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    moveCursor(e, r);
    const l = live.current;
    if (!l || e.pointerId !== l.pointerId) return;
    const native = e.nativeEvent;
    const coalesced = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    let moved = false;
    for (const p of coalesced.length ? coalesced : [native]) {
      const [x, y] = toLogical(r, p.clientX, p.clientY);
      const dx = x - l.x;
      const dy = y - l.y;
      if (dx * dx + dy * dy < MIN_STEP2) continue;
      if (store.points >= INK_POINTS) break;
      store.add(l.stroke, x, y);
      l.pending.push(x, y);
      l.x = x;
      l.y = y;
      moved = true;
    }
    if (moved) paintNow();
  };

  const undo = () => {
    if (!canDraw) return;
    endStroke();
    if (store.undoLocal()) {
      act({ type: "undo" });
      paintNow();
    }
  };

  const clear = () => {
    if (!canDraw) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    endStroke();
    if (store.clearLocal()) {
      act({ type: "clear" });
      paintNow();
    }
  };

  const pickColor = (hex: string) => {
    setColor(hex);
    setEraser(false);
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (isTypingTarget(e.target) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    if (k === "e") setEraser((v) => !v);
    else if (k === "b") setEraser(false);
    else if (k === "[") setSize((s) => SIZE_LIST[Math.max(0, SIZE_LIST.indexOf(s) - 1)]);
    else if (k === "]") setSize((s) => SIZE_LIST[Math.min(SIZE_LIST.length - 1, SIZE_LIST.indexOf(s) + 1)]);
    else {
      const i = COLOR_KEYS.indexOf(e.key);
      if (i >= 0) pickColor(PALETTE[i].hex);
    }
  });

  useEffect(() => {
    if (!canDraw) return;
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canDraw]);

  return (
    // Small enough that the tool bar stays on screen under the room and game headers (the guide
    // strip above body and legs adds 10%), but never tiny.
    <div className="mx-auto flex w-full flex-col gap-2" style={{ maxWidth: "max(20rem, min(52vh * 3 / 2, (100svh - 490px) * 1.35))" }}>
      <div
        className="overflow-hidden rounded-xl bg-white shadow-lg shadow-black/40 ring-2"
        style={{ "--tw-ring-color": `${frameColor}88` } as React.CSSProperties}
      >
        {top}
        <div className="relative w-full">
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            role="img"
            aria-label={label}
            className={`block aspect-[3/2] w-full bg-white select-none ${
              canDraw ? "cursor-crosshair touch-none [-webkit-touch-callout:none]" : ""
            }`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endStroke(e.pointerId)}
            onPointerCancel={(e) => endStroke(e.pointerId)}
            onLostPointerCapture={(e) => endStroke(e.pointerId)}
            onPointerLeave={hideCursor}
            onContextMenu={canDraw ? (e) => e.preventDefault() : undefined}
          />
          <div
            ref={cursorRef}
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 rounded-full border-2 opacity-0 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
          />
          {overlay}
        </div>
      </div>
      {canDraw && (
        <Toolbar
          color={color}
          size={size}
          eraser={eraser}
          canUndo={count > 0}
          armed={armed}
          onColor={pickColor}
          onSize={setSize}
          onEraser={() => setEraser((v) => !v)}
          onUndo={undo}
          onClear={clear}
        />
      )}
    </div>
  );
}

function Toolbar({
  color,
  size,
  eraser,
  canUndo,
  armed,
  onColor,
  onSize,
  onEraser,
  onUndo,
  onClear,
}: {
  color: string;
  size: number;
  eraser: boolean;
  canUndo: boolean;
  armed: boolean;
  onColor: (hex: string) => void;
  onSize: (s: number) => void;
  onEraser: () => void;
  onUndo: () => void;
  onClear: () => void;
}) {
  const ink = eraser ? BG : color;
  const tool = "btn h-10 min-w-10 px-0 @lg:px-3";
  return (
    <div className="@container card flex flex-col gap-2 p-2" role="toolbar" aria-label="Drawing tools">
      <div className="grid grid-cols-6 gap-1.5 @xl:grid-cols-12" role="radiogroup" aria-label="Colour">
        {PALETTE.map((p, i) => {
          const on = !eraser && color === p.hex;
          return (
            <button
              key={p.hex}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={p.name}
              title={`${p.name} (${COLOR_KEYS[i]})`}
              onClick={() => onColor(p.hex)}
              className={`grid h-10 place-items-center rounded-lg border-2 transition-transform duration-100 active:scale-95 ${
                on ? "z-10 scale-110 border-white" : "border-black/20 hover:scale-105"
              }`}
              style={{ background: p.hex }}
            >
              {on && (
                <span aria-hidden className="text-base font-black" style={{ color: LIGHT.has(p.hex) ? "#1c1c1e" : "#fff" }}>
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <div className="flex gap-1" role="radiogroup" aria-label="Brush size">
          {SIZES.map((s, i) => {
            const on = size === s;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={`${SIZE_NAMES[i]} brush`}
                title={`${SIZE_NAMES[i]} brush ([ and ])`}
                onClick={() => onSize(s)}
                className={`grid size-10 place-items-center rounded-lg border-2 bg-panel-2 transition-colors ${
                  on ? "border-text" : "border-line hover:border-muted"
                }`}
              >
                <span
                  className="rounded-full"
                  style={{
                    width: DOT_PX[i],
                    height: DOT_PX[i],
                    background: ink,
                    boxShadow: LIGHT.has(ink) ? undefined : "0 0 0 1.5px rgb(255 255 255 / 0.7)",
                  }}
                />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-pressed={eraser}
          title="Eraser (E)"
          onClick={onEraser}
          className={`${tool} ${eraser ? "border-text bg-text/15" : ""}`}
        >
          <span aria-hidden>🧽</span>
          <span className="sr-only @lg:not-sr-only">Eraser</span>
        </button>
        <div className="ml-auto flex gap-1">
          <button type="button" title="Undo (Z)" onClick={onUndo} disabled={!canUndo} className={tool}>
            <span aria-hidden className="text-lg leading-none">
              ↶
            </span>
            <span className="sr-only @lg:not-sr-only">Undo</span>
          </button>
          <button
            type="button"
            title="Clear the canvas"
            aria-label={armed ? "Tap again to clear the canvas" : "Clear canvas"}
            onClick={onClear}
            disabled={!canUndo}
            className={`${tool} ${armed ? "border-red-400 bg-red-500/20 text-red-200" : ""}`}
          >
            <span aria-hidden>{armed ? "⚠️" : "🗑️"}</span>
            <span aria-hidden className="hidden @lg:inline">
              {armed ? "Sure?" : "Clear"}
            </span>
          </button>
        </div>
      </div>
      <p role="status" className="min-h-0 text-center text-xs empty:hidden">
        {armed ? <span className="text-red-200">Tap clear again to wipe your part.</span> : null}
      </p>
    </div>
  );
}
