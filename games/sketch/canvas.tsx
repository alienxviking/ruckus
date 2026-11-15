"use client";

// The drawing surface for Sketch Storm.
//
// Strokes arrive as transient events, not in the view, so every client keeps
// its own copy of the canvas in a StrokeStore. Stroke events carry the turn
// (t), the canvas revision (rev, bumped by undo/clear/new turn) and the stroke
// index (i), which lets a client notice when it missed something and ask the
// server for a full copy ({type:"sync"}, at most once a second).

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { SketchAction, SketchView } from "./server";
import {
  BG,
  H,
  MAX_BATCH,
  MAX_POINTS,
  PALETTE,
  SIZES,
  SIZE_NAMES,
  W,
  type SketchEvent,
  type WireStroke,
} from "./shared";

/** Smallest move worth recording, squared, in logical px. */
const MIN_STEP2 = 4;
/** How often the artist's points are sent. */
const FLUSH_MS = 40;
/** Client-side spacing between sync requests (the server allows one per second). */
const SYNC_RETRY_MS = 1_100;
const COLOR_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];
/** Palette colours light enough to need a dark tick / no outline on the dark toolbar. */
const LIGHT = new Set(["#ffd60a", "#ffcba4", "#4cc9f0", BG]);
const DOT_PX = [4, 8, 14, 22];
const SIZE_LIST: readonly number[] = SIZES;

export interface LiveStroke extends Required<WireStroke> {
  /** Drawing progress: -1 nothing yet, 0 the start dot, j >= 1 the path up to midpoint(P[j-1], P[j]). */
  drawn: number;
  /** Final half-segment drawn (only once the stroke has ended). */
  tail: boolean;
}

type StrokeEv = Extract<SketchEvent, { k: "stroke" }>;
type UndoEv = Extract<SketchEvent, { k: "undo" }>;
type ClearEv = Extract<SketchEvent, { k: "clear" }>;
type SyncEv = Extract<SketchEvent, { k: "sync" }>;

export function isTypingTarget(t: EventTarget | null) {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

// ---------- rendering ----------
// Strokes are smoothed with quadratic curves through segment midpoints. The
// same geometry is drawn incrementally while points stream in and in one go
// on a full repaint, so live and repainted drawings look identical.

function pen(g: CanvasRenderingContext2D, s: { color: string; size: number }) {
  g.strokeStyle = s.color;
  g.fillStyle = s.color;
  g.lineWidth = s.size;
  g.lineCap = "round";
  g.lineJoin = "round";
}

/** Draw the part of `s` that isn't on the canvas yet. */
function drawNew(g: CanvasRenderingContext2D, s: LiveStroke) {
  const p = s.pts;
  const n = p.length >> 1;
  if (!n) return;
  pen(g, s);
  if (s.drawn < 0) {
    g.beginPath();
    g.arc(p[0], p[1], s.size / 2, 0, Math.PI * 2);
    g.fill();
    s.drawn = 0;
  }
  if (n >= 2 && s.drawn <= n - 2) {
    let j = s.drawn;
    g.beginPath();
    if (j === 0) {
      g.moveTo(p[0], p[1]);
      g.lineTo((p[0] + p[2]) / 2, (p[1] + p[3]) / 2);
      j = 1;
    } else {
      g.moveTo((p[2 * j - 2] + p[2 * j]) / 2, (p[2 * j - 1] + p[2 * j + 1]) / 2);
    }
    for (; j <= n - 2; j++) {
      g.quadraticCurveTo(p[2 * j], p[2 * j + 1], (p[2 * j] + p[2 * j + 2]) / 2, (p[2 * j + 1] + p[2 * j + 3]) / 2);
    }
    g.stroke();
    s.drawn = j;
  }
  if (s.end && !s.tail && n >= 2 && s.drawn === n - 1) {
    const j = n - 1;
    g.beginPath();
    g.moveTo((p[2 * j - 2] + p[2 * j]) / 2, (p[2 * j - 1] + p[2 * j + 1]) / 2);
    g.lineTo(p[2 * j], p[2 * j + 1]);
    g.stroke();
    s.tail = true;
  }
}

/** Draw a whole stroke without touching its progress (thumbnails). */
function drawWhole(g: CanvasRenderingContext2D, s: WireStroke) {
  const p = s.pts;
  const n = p.length >> 1;
  if (!n) return;
  pen(g, s);
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

// ---------- the client's copy of the canvas ----------

export class StrokeStore {
  /** The game these strokes belong to; a new game wipes everything. */
  game = -1;
  turn = -1;
  /** Canvas revision we're in step with (-1 = not known yet this turn). */
  rev = -1;
  list: LiveStroke[] = [];
  points = 0;
  /** We may be missing strokes: ask the server for a full copy. */
  needSync = false;
  /** Turn in which this client is the artist (its undo/clear apply locally first). */
  private ownerTurn = -1;
  /** Local undo/clear not yet echoed back by the server. */
  private pending = 0;
  /** Ids of strokes this client drew this turn. */
  private mine = new Set<string>();
  private active: LiveStroke | null = null;
  private archive = new Map<number, LiveStroke[]>();
  private full = true;
  private dirty = new Set<LiveStroke>();
  private subs = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  private changed() {
    for (const fn of this.subs) fn();
  }

  /** Strokes of a turn this client saw (null if it didn't). */
  strokesFor(turn: number): LiveStroke[] | null {
    return turn === this.turn ? this.list : (this.archive.get(turn) ?? null);
  }

  setOwner(turn: number) {
    this.ownerTurn = turn;
  }

  private get owner() {
    return this.ownerTurn >= 0 && this.ownerTurn === this.turn;
  }

  /** Move to turn t (a fresh canvas). False when t is older than ours. */
  private enter(t: unknown): boolean {
    if (typeof t !== "number" || !Number.isInteger(t) || t < this.turn) return false;
    if (t > this.turn) {
      if (this.turn >= 0) this.archive.set(this.turn, this.list);
      this.turn = t;
      this.rev = -1;
      this.list = [];
      this.points = 0;
      this.needSync = false;
      this.pending = 0;
      this.mine = new Set();
      this.active = null;
      this.full = true;
      this.dirty.clear();
    }
    return true;
  }

  /** Compare with the counters in the latest view and flag a sync if we're behind. */
  check(game: number, turn: number, rev: number, count: number) {
    if (game !== this.game) {
      // "Play again" keeps this component mounted but starts counting turns from 0.
      this.game = game;
      this.turn = -1;
      this.list = [];
      this.archive.clear();
    }
    const before = this.turn;
    const wanted = this.needSync;
    if (!this.enter(turn)) return;
    if (this.rev < 0) this.rev = rev;
    const behind = rev > this.rev || (rev === this.rev && count > this.list.length && !(this.owner && this.pending > 0));
    if (behind) this.needSync = true;
    if (before !== this.turn || wanted !== this.needSync) this.changed();
  }

  handle(raw: unknown) {
    if (!raw || typeof raw !== "object") return;
    const e = raw as SketchEvent;
    if (e.k === "stroke") this.onStroke(e);
    else if (e.k === "undo") this.onUndo(e);
    else if (e.k === "clear") this.onClear(e);
    else if (e.k === "sync") this.onSync(e);
  }

  private find(id: string) {
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].id === id) return i;
    return -1;
  }

  private onStroke(e: StrokeEv) {
    if (typeof e.id !== "string" || !Array.isArray(e.pts) || !this.enter(e.t)) return;
    if (this.rev < 0) this.rev = e.rev;
    else if (e.rev < this.rev) return; // stale
    else if (e.rev > this.rev) {
      this.needSync = true; // we missed an undo or clear
      this.rev = e.rev;
    }
    let s: LiveStroke | undefined = this.list[e.i];
    if (!s || s.id !== e.id) {
      const at = this.find(e.id);
      s = at >= 0 ? this.list[at] : undefined;
      if (s || e.i !== this.list.length) this.needSync = true;
      if (!s) {
        s = { id: e.id, color: e.color, size: e.size, pts: [], end: false, drawn: -1, tail: false };
        this.list.push(s);
      }
    }
    if (!s.end) {
      for (const v of e.pts) s.pts.push(v);
      this.points += e.pts.length >> 1;
      if (e.end) s.end = true;
      this.dirty.add(s);
    }
    this.changed();
  }

  private onUndo(e: UndoEv) {
    if (typeof e.id !== "string" || !this.enter(e.t)) return;
    if (this.rev >= 0 && e.rev <= this.rev) return;
    if (this.rev >= 0 && e.rev !== this.rev + 1) this.needSync = true;
    this.rev = e.rev;
    if (this.owner && this.pending > 0) this.pending -= 1;
    const at = this.find(e.id);
    if (at >= 0) {
      const [gone] = this.list.splice(at, 1);
      this.points -= gone.pts.length >> 1;
      if (gone === this.active) this.active = null;
      this.full = true;
    }
    this.changed();
  }

  private onClear(e: ClearEv) {
    if (!this.enter(e.t)) return;
    if (this.rev >= 0 && e.rev <= this.rev) return;
    this.rev = e.rev;
    if (this.owner) {
      // Already cleared locally; anything drawn since is newer than the clear.
      if (this.pending > 0) this.pending -= 1;
    } else {
      this.list = [];
      this.points = 0;
      this.needSync = false;
      this.full = true;
      this.dirty.clear();
    }
    this.changed();
  }

  private onSync(e: SyncEv) {
    if (!Array.isArray(e.strokes) || !this.enter(e.t)) return;
    const fresh: LiveStroke[] = [];
    for (const w of e.strokes) {
      if (!w || typeof w.id !== "string" || !Array.isArray(w.pts)) continue;
      fresh.push({ id: w.id, color: w.color, size: w.size, pts: w.pts.slice(), end: !!w.end, drawn: -1, tail: false });
    }
    if (this.owner) {
      // The server can't have everything we drew yet: keep our newer copies.
      for (const s of this.list) {
        const at = fresh.findIndex((f) => f.id === s.id);
        if (at >= 0) {
          if (s.pts.length >= fresh[at].pts.length) fresh[at] = s;
        } else if (this.mine.has(s.id)) {
          fresh.push(s);
        }
      }
    }
    this.list = fresh;
    this.points = fresh.reduce((sum, s) => sum + (s.pts.length >> 1), 0);
    this.rev = e.rev;
    this.needSync = false;
    this.full = true;
    this.dirty.clear();
    this.changed();
  }

  // ----- the artist's own strokes (drawn locally first) -----

  begin(id: string, color: string, size: number, x: number, y: number): LiveStroke {
    const s: LiveStroke = { id, color, size, pts: [x, y], end: false, drawn: -1, tail: false };
    this.list.push(s);
    this.mine.add(id);
    this.points += 1;
    this.active = s;
    this.dirty.add(s);
    this.changed();
    return s;
  }

  add(s: LiveStroke, x: number, y: number) {
    s.pts.push(x, y);
    this.points += 1;
    this.dirty.add(s);
  }

  finish(s: LiveStroke) {
    s.end = true;
    if (this.active === s) this.active = null;
    this.dirty.add(s);
    this.changed();
  }

  undoLocal(): boolean {
    const s = this.list.pop();
    if (!s) return false;
    this.points -= s.pts.length >> 1;
    this.pending += 1;
    this.full = true;
    this.changed();
    return true;
  }

  clearLocal(): boolean {
    if (!this.list.length) return false;
    this.list = [];
    this.points = 0;
    this.pending += 1;
    this.full = true;
    this.dirty.clear();
    this.changed();
    return true;
  }

  // ----- painting -----

  repaint() {
    this.full = true;
  }

  paint(g: CanvasRenderingContext2D, scale: number) {
    if (this.full) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = BG;
      g.fillRect(0, 0, g.canvas.width, g.canvas.height);
      g.setTransform(scale, 0, 0, scale, 0, 0);
      for (const s of this.list) {
        s.drawn = -1;
        s.tail = false;
        drawNew(g, s);
      }
      this.full = false;
      this.dirty.clear();
      return;
    }
    if (!this.dirty.size) return;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    for (const s of this.dirty) drawNew(g, s);
    this.dirty.clear();
  }
}

/** Keep `store` in step with the server: events in, gap checks, rate-limited sync requests. */
export function useStrokeSync(
  store: StrokeStore,
  view: SketchView | null,
  canAsk: boolean,
  act: (a: SketchAction) => void,
  onEvent: (fn: (e: unknown) => void) => () => void,
) {
  const game = view ? view.game : -1;
  const turn = view ? view.turn : -1;
  const rev = view ? view.strokesRev : 0;
  const count = view ? view.strokeCount : 0;
  const owner = !!view && view.role === "artist" && view.phase === "draw";
  const live = !!view && view.phase !== "final";
  const askedAt = useRef(-Infinity);

  useEffect(() => onEvent((e) => store.handle(e)), [store, onEvent]);

  useEffect(() => {
    store.setOwner(owner ? turn : -1);
  }, [store, owner, turn]);

  useEffect(() => {
    if (turn >= 0) store.check(game, turn, rev, count);
  }, [store, game, turn, rev, count]);

  useEffect(() => {
    // Spectators can't send actions, so they live with what they've seen.
    if (!canAsk || !live) return;
    const ask = () => {
      if (!store.needSync) return;
      const now = performance.now();
      if (now - askedAt.current < SYNC_RETRY_MS) return;
      askedAt.current = now;
      act({ type: "sync" });
    };
    ask();
    const timer = window.setInterval(ask, 400);
    const off = store.subscribe(ask);
    return () => {
      window.clearInterval(timer);
      off();
    };
  }, [store, canAsk, live, act]);
}

// ---------- the canvas element ----------

interface Live {
  pointerId: number;
  stroke: LiveStroke;
  /** Points not sent yet (flat x,y). */
  pending: number[];
  x: number;
  y: number;
  timer: number;
}

export function SketchCanvas({
  store,
  canDraw,
  act,
  label,
  overlay,
}: {
  store: StrokeStore;
  canDraw: boolean;
  act: (a: SketchAction) => void;
  label: string;
  overlay?: ReactNode;
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
  const [full, setFull] = useState(false);
  const [armed, setArmed] = useState(false);

  // Size the backing store to the element (devicePixelRatio aware) and repaint on changes.
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
      setFull(store.points >= MAX_POINTS);
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          paint();
        });
      }
    });
    // Moving the window to a screen with another pixel ratio doesn't resize the element.
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

  // The turn can end mid-stroke: drop the stroke quietly (the server would refuse it now).
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

  // "Clear" needs a second tap within a couple of seconds.
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
    if (store.points >= MAX_POINTS) {
      setFull(true);
      return;
    }
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
      if (store.points >= MAX_POINTS) {
        setFull(true);
        break;
      }
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
    <div className="mx-auto flex w-full flex-col gap-2" style={{ maxWidth: "calc(60vh * 4 / 3)" }}>
      <div className="@container relative w-full">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          role="img"
          aria-label={label}
          className={`block aspect-[4/3] w-full rounded-xl bg-white shadow-lg shadow-black/40 ring-1 ring-white/10 select-none ${
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
      {canDraw && (
        <Toolbar
          color={color}
          size={size}
          eraser={eraser}
          canUndo={count > 0}
          armed={armed}
          full={full}
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

function toLogical(r: DOMRect, cx: number, cy: number): [number, number] {
  const x = Math.round(((cx - r.left) / (r.width || 1)) * W);
  const y = Math.round(((cy - r.top) / (r.height || 1)) * H);
  return [Math.min(W, Math.max(0, x)), Math.min(H, Math.max(0, y))];
}

function Toolbar({
  color,
  size,
  eraser,
  canUndo,
  armed,
  full,
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
  full: boolean;
  onColor: (hex: string) => void;
  onSize: (s: number) => void;
  onEraser: () => void;
  onUndo: () => void;
  onClear: () => void;
}) {
  const ink = eraser ? BG : color;
  const tool = "btn h-10 min-w-10 px-0 @md:px-3";
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
                    // Dark inks would vanish on the dark button: outline them.
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
          <span className="sr-only @md:not-sr-only">Eraser</span>
        </button>
        <div className="ml-auto flex gap-1">
          <button type="button" title="Undo (Z)" onClick={onUndo} disabled={!canUndo} className={tool}>
            <span aria-hidden className="text-lg leading-none">↶</span>
            <span className="sr-only @md:not-sr-only">Undo</span>
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
            <span aria-hidden className="hidden @md:inline">
              {armed ? "Sure?" : "Clear"}
            </span>
          </button>
        </div>
      </div>
      <p role="status" className="min-h-0 text-center text-xs empty:hidden">
        {armed ? <span className="text-red-200">Tap clear again to wipe the canvas.</span> : null}
        {full && !armed ? <span className="text-amber-300">The canvas is full. Undo or clear to keep drawing.</span> : null}
      </p>
    </div>
  );
}

/** A finished drawing, for the gallery. */
export function Thumb({ store, turn, label }: { store: StrokeStore; turn: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round((c.clientWidth || 240) * dpr));
      const h = Math.round((w * H) / W);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = BG;
      g.fillRect(0, 0, w, h);
      const strokes = store.strokesFor(turn);
      if (!strokes || !strokes.length) {
        g.fillStyle = "#94a3b8";
        g.font = `600 ${Math.round(w / 14)}px system-ui, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(strokes ? "blank canvas" : "not seen here", w / 2, h / 2);
        return;
      }
      g.setTransform(w / W, 0, 0, w / W, 0, 0);
      for (const s of strokes) drawWhole(g, s);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [store, turn]);
  return <canvas ref={ref} role="img" aria-label={label} className="block aspect-[4/3] w-full rounded-lg bg-white" />;
}
