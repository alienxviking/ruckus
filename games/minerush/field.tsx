"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SCAN_RADIUS } from "./shared";
import { BOOM, HIDDEN, ITEM_OF, MINE, type MineStore } from "./store";
import { ITEMS } from "./shared";

export type Mode = "dig" | "flag";

const NUM_COLORS = ["", "#60a5fa", "#4ade80", "#f87171", "#c084fc", "#fb923c", "#2dd4bf", "#f472b6", "#e5e7eb"];
const MAX_CS = 46;
/** On small screens the board starts zoomed in to roughly this cell size. */
const COMFY_CS = 30;
const LONG_PRESS_MS = 360;
const MOVE_SLOP = 10;

export const FIELD_CSS = `
.mr-vp { overflow: auto; overscroll-behavior: contain; touch-action: pan-x pan-y; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; scrollbar-width: thin; scrollbar-color: #4a4380 transparent; border-radius: .9rem; }
.mr-vp:focus-visible { outline: 2px solid var(--color-brand-2); outline-offset: 2px; }
.mr-board { position: relative; margin: 0 auto; }
.mr-grid { display: grid; }
.mr-c { position: relative; display: grid; place-items: center; margin: var(--m); border-radius: var(--r); font-weight: 800; font-size: calc(var(--cs) * .6); line-height: 1; font-variant-numeric: tabular-nums; }
.mr-c > span { pointer-events: none; }
.mr-h { background: linear-gradient(150deg, #4a4282, #332c60); box-shadow: inset 0 max(1px, calc(var(--cs) * .07)) 0 rgb(255 255 255 / .13), inset 0 calc(var(--cs) * -.08) 0 rgb(0 0 0 / .28); transition: transform .08s ease, filter .12s ease; }
.mr-live .mr-h { cursor: pointer; }
@media (hover: hover) { .mr-live .mr-h:hover { filter: brightness(1.28); } }
.mr-live .mr-h:active { transform: scale(.88); filter: brightness(.8); }
.mr-p { background: #201b3b; box-shadow: inset 0 0 0 max(1px, calc(var(--cs) * .06)) var(--mc); transform: scale(.9); }
.mr-p::after { content: ""; width: 34%; height: 34%; border-radius: 50%; background: var(--mc); animation: mr-pulse .45s ease-in-out infinite alternate; }
@keyframes mr-pulse { from { transform: scale(.55); opacity: .5; } to { transform: scale(1); opacity: 1; } }
.mr-o { background: color-mix(in oklab, var(--oc, #3a3366) var(--tint, 20%), #15122a); }
.mr-o.mr-own { --tint: 30%; }
.mr-x { background: radial-gradient(circle at 50% 45%, #ff8a8a, #c81e1e 62%, #7f1010); box-shadow: 0 0 calc(var(--cs) * .4) #ef444488; z-index: 1; }
.mr-m { background: #3a1f33; }
.mr-mine { font-size: calc(var(--cs) * .6); opacity: .85; }
.mr-flag { font-size: calc(var(--cs) * .62); animation: mr-flag .28s cubic-bezier(.2,1.6,.4,1) both; transform-origin: 30% 90%; }
@keyframes mr-flag { from { transform: scale(.2) rotate(-30deg); opacity: 0; } }
.mr-mark { position: absolute; right: -6%; bottom: -8%; font-size: calc(var(--cs) * .42); font-style: normal; font-weight: 900; line-height: 1; filter: drop-shadow(0 1px 1px #000); }
.mr-item { position: absolute; top: 4%; right: 4%; font-size: calc(var(--cs) * .36); line-height: 1; }
.mr-item-0 { position: static; font-size: calc(var(--cs) * .56); }
.mr-cap { position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(150deg, #4a4282, #332c60); animation: mr-cap .34s cubic-bezier(.3,.7,.4,1) both; }
@keyframes mr-cap { 0% { transform: none; opacity: 1; filter: brightness(1.6); } 100% { transform: scale(.2) rotate(18deg); opacity: 0; filter: brightness(2); } }
.mr-c.mr-cur { outline: 2px solid #fde047; outline-offset: -1px; z-index: 2; }
.mr-fx { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.mr-pop { position: absolute; transform: translate(var(--tx, -50%), -50%); font-weight: 900; font-size: max(12px, calc(var(--cs) * .55)); white-space: nowrap; text-shadow: 0 2px 0 #0008, 0 0 8px #000a; animation: mr-rise 1s cubic-bezier(.2,.8,.3,1) both; z-index: 3; }
.mr-pop-big { font-size: max(16px, calc(var(--cs) * .8)); }
@keyframes mr-rise { 0% { opacity: 0; transform: translate(var(--tx, -50%), -20%) scale(.5); } 14% { opacity: 1; transform: translate(var(--tx, -50%), -70%) scale(1.15); } 70% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--tx, -50%), -190%) scale(1); } }
.mr-ring { position: absolute; width: calc(var(--cs) * 4); height: calc(var(--cs) * 4); transform: translate(-50%, -50%) scale(.1); border-radius: 50%; border: max(2px, calc(var(--cs) * .12)) solid var(--fc); animation: mr-ring .7s cubic-bezier(.1,.7,.3,1) forwards; }
@keyframes mr-ring { to { transform: translate(-50%, -50%) scale(1); opacity: 0; } }
.mr-blast { position: absolute; transform: translate(-50%, -50%); font-size: calc(var(--cs) * 1.6); animation: mr-blast .7s ease-out forwards; }
@keyframes mr-blast { 0% { transform: translate(-50%, -50%) scale(.3); opacity: 1; } 40% { transform: translate(-50%, -50%) scale(1.25); opacity: 1; } 100% { transform: translate(-50%, -60%) scale(1.5); opacity: 0; } }
.mr-scan { position: absolute; border: max(2px, calc(var(--cs) * .1)) dashed var(--fc); border-radius: calc(var(--cs) * .3); background: color-mix(in oklab, var(--fc) 14%, transparent); animation: mr-scan 1.3s ease-out forwards; }
@keyframes mr-scan { 0% { opacity: 0; transform: scale(.4); } 18% { opacity: 1; transform: scale(1.04); } 30% { transform: none; } 75% { opacity: 1; } 100% { opacity: 0; } }
.mr-shake-a { animation: mr-shake-a .5s cubic-bezier(.36,.07,.19,.97); }
.mr-shake-b { animation: mr-shake-b .5s cubic-bezier(.36,.07,.19,.97); }
@keyframes mr-shake-a { 10%, 90% { transform: translateX(-2px); } 20%, 80% { transform: translateX(4px); } 30%, 50%, 70% { transform: translateX(-7px) rotate(-.4deg); } 40%, 60% { transform: translateX(7px) rotate(.4deg); } }
@keyframes mr-shake-b { 10%, 90% { transform: translateX(-2px); } 20%, 80% { transform: translateX(4px); } 30%, 50%, 70% { transform: translateX(-7px) rotate(-.4deg); } 40%, 60% { transform: translateX(7px) rotate(.4deg); } }
@media (prefers-reduced-motion: reduce) {
  .mr-shake-a, .mr-shake-b, .mr-p::after, .mr-flag { animation: none; }
  .mr-cap { animation-duration: .01s; animation-delay: 0s !important; }
  .mr-pop { animation-duration: 1.2s; }
}
`;

interface BoardProps {
  store: MineStore;
  /** Bumps whenever the store changes (forces a re-render). */
  version: number;
  /** Colour per player index. */
  colors: string[];
  names: string[];
  mode: Mode;
  /** The viewer may dig right now (a player, during play). Stun/freeze are checked at click time. */
  live: boolean;
  over: boolean;
  myColor: string;
  onDig: (cell: number) => void;
  onFlag: (cell: number) => void;
  /** Covers the board (countdown, stunned, frozen). */
  overlay?: ReactNode;
  /** Left side of the toolbar under the board. */
  tools?: ReactNode;
  /** Right side of the toolbar. */
  stats?: ReactNode;
}

interface Gesture {
  id: number;
  x: number;
  y: number;
  cell: number;
  timer: number;
  done: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function clearGesture(ref: { current: Gesture | null }) {
  const g = ref.current;
  if (g) window.clearTimeout(g.timer);
  ref.current = null;
}

export function Board(props: BoardProps) {
  const { store, colors, names, mode, live, over, myColor, onDig, onFlag, overlay, tools, stats } = props;
  const { w, h } = store;
  const wrapRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ bw: number; vh: number } | null>(null);
  const [userZ, setUserZ] = useState<number | null>(null);
  const [cur, setCur] = useState(() => Math.floor(h / 2) * w + Math.floor(w / 2));
  const [kbd, setKbd] = useState(false);
  const gesture = useRef<Gesture | null>(null);

  // ----- size: fit the width and ~60% of the screen height, then zoom -----
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // The observer fires once right away, so there's no separate first measure.
    const measure = () => setBox({ bw: el.clientWidth, vh: window.innerHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const maxH = box ? Math.max(220, box.vh * (box.bw < 520 ? 0.56 : 0.62)) : 400;
  const fit = box ? Math.max(4, Math.min(box.bw / w, maxH / h)) : 0;
  const maxZ = fit ? Math.max(1, MAX_CS / fit) : 1;
  const autoZ = fit && fit < 20 ? COMFY_CS / fit : 1;
  const z = clamp(userZ ?? autoZ, 1, maxZ);
  const cs = Math.max(6, Math.floor(fit * z));
  const zoomed = cs * w > (box?.bw ?? 0) + 1 || cs * h > maxH + 1;

  // Keep a point of the board under the same spot of the screen while zooming.
  const anchor = useRef<{ bx: number; by: number; px: number; py: number } | null>(null);
  const shownCs = useRef(0);
  const zRef = useRef(z);
  useEffect(() => {
    zRef.current = z;
  });
  useLayoutEffect(() => {
    const vp = vpRef.current;
    if (!vp || !box) return;
    const a = anchor.current;
    if (a) {
      vp.scrollLeft = a.bx * cs - a.px;
      vp.scrollTop = a.by * cs - a.py;
      anchor.current = null;
    } else if (shownCs.current === 0) {
      // First layout: centre on the main opening, where everyone starts.
      const hx = (store.home % w) + 0.5;
      const hy = Math.floor(store.home / w) + 0.5;
      vp.scrollLeft = hx * cs - vp.clientWidth / 2;
      vp.scrollTop = hy * cs - vp.clientHeight / 2;
    }
    shownCs.current = cs;
  }, [cs, box, w, h, store]);

  const zoomTo = (next: number, px?: number, py?: number) => {
    const vp = vpRef.current;
    if (!vp || !fit) return;
    const target = clamp(next, 1, maxZ);
    const ax = px ?? vp.clientWidth / 2;
    const ay = py ?? vp.clientHeight / 2;
    const curCs = shownCs.current || cs;
    anchor.current = { bx: (vp.scrollLeft + ax) / curCs, by: (vp.scrollTop + ay) / curCs, px: ax, py: ay };
    setUserZ(target);
  };
  const zoomToRef = useRef(zoomTo);
  useEffect(() => {
    zoomToRef.current = zoomTo;
  });

  // Pinch (two fingers) and ctrl/trackpad-pinch wheel zoom.
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    let pinch: { d0: number; z0: number } | null = null;
    let raf = 0;
    let want: { z: number; x: number; y: number } | null = null;
    const flush = () => {
      raf = 0;
      if (want) zoomToRef.current(want.z, want.x, want.y);
      want = null;
    };
    const schedule = (zz: number, x: number, y: number) => {
      want = { z: zz, x, y };
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList) => {
      const r = vp.getBoundingClientRect();
      return { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top };
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pinch = { d0: Math.max(10, dist(e.touches)), z0: zRef.current };
        clearGesture(gesture);
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const m = mid(e.touches);
      schedule((pinch.z0 * dist(e.touches)) / pinch.d0, m.x, m.y);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      schedule((want?.z ?? zRef.current) * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    vp.addEventListener("touchstart", onStart, { passive: false });
    vp.addEventListener("touchmove", onMove, { passive: false });
    vp.addEventListener("touchend", onEnd);
    vp.addEventListener("touchcancel", onEnd);
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vp.removeEventListener("touchstart", onStart);
      vp.removeEventListener("touchmove", onMove);
      vp.removeEventListener("touchend", onEnd);
      vp.removeEventListener("touchcancel", onEnd);
      vp.removeEventListener("wheel", onWheel);
    };
  }, []);

  // ----- input: tap / click digs (or flags in flag mode), long-press / right-click flags -----
  useEffect(() => () => clearGesture(gesture), []);
  const cancelGesture = () => clearGesture(gesture);

  const primary = mode === "dig" ? onDig : onFlag;
  const secondary = mode === "dig" ? onFlag : onDig;

  const cellAt = (t: EventTarget | null) => {
    const el = (t as HTMLElement | null)?.closest?.("[data-i]") as HTMLElement | null;
    return el ? Number(el.dataset.i) : -1;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (kbd) setKbd(false);
    if (!live) return;
    const cell = cellAt(e.target);
    if (cell < 0) return;
    if (e.pointerType === "mouse") {
      // Ctrl+click is a right-click on macOS.
      if (e.button === 0 && !e.ctrlKey) primary(cell);
      else if (e.button === 2 || (e.button === 0 && e.ctrlKey)) onFlag(cell);
      else if (e.button === 1) {
        e.preventDefault();
        onDig(cell);
      }
      return;
    }
    cancelGesture();
    if (!e.isPrimary) return;
    const g: Gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, cell, timer: 0, done: false };
    g.timer = window.setTimeout(() => {
      g.done = true;
      navigator.vibrate?.(14);
      secondary(cell);
    }, LONG_PRESS_MS);
    gesture.current = g;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g && g.id === e.pointerId && Math.hypot(e.clientX - g.x, e.clientY - g.y) > MOVE_SLOP) cancelGesture();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    window.clearTimeout(g.timer);
    gesture.current = null;
    if (!g.done) primary(g.cell);
  };

  // ----- keyboard: arrows move a cursor, Space/Enter digs, F flags -----
  const describe = (i: number) => {
    const x = i % w;
    const y = (i - x) / w;
    const code = store.cells[i];
    let what: string;
    if (code === HIDDEN) what = store.flags[i] ? "flagged" : "hidden";
    else if (code === BOOM) what = "exploded mine";
    else if (code === MINE) what = "mine";
    else what = code === 0 ? "empty" : `${code}`;
    const o = store.own[i];
    const by = o >= 0 && code !== HIDDEN ? `, opened by ${names[o] ?? "someone"}` : "";
    const it = ITEM_OF[store.item[i]];
    return `Row ${y + 1}, column ${x + 1}: ${what}${by}${it ? `, ${ITEMS[it].label}` : ""}`;
  };

  const scrollToCell = (i: number) => {
    const vp = vpRef.current;
    if (!vp) return;
    const x = (i % w) * cs;
    const y = Math.floor(i / w) * cs;
    if (x < vp.scrollLeft) vp.scrollLeft = x - cs;
    else if (x + cs > vp.scrollLeft + vp.clientWidth) vp.scrollLeft = x + 2 * cs - vp.clientWidth;
    if (y < vp.scrollTop) vp.scrollTop = y - cs;
    else if (y + cs > vp.scrollTop + vp.clientHeight) vp.scrollTop = y + 2 * cs - vp.clientHeight;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const x = cur % w;
    const y = (cur - x) / w;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const mv = moves[e.key];
    if (mv) {
      e.preventDefault();
      const nx = clamp(x + mv[0], 0, w - 1);
      const ny = clamp(y + mv[1], 0, h - 1);
      const next = ny * w + nx;
      setCur(next);
      setKbd(true);
      scrollToCell(next);
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      setKbd(true);
      if (live) onDig(cur);
    } else if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      setKbd(true);
      if (live) onFlag(cur);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomTo(z * 1.35);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomTo(z / 1.35);
    }
  };

  const shake = store.shake;
  const boardStyle = {
    width: w * cs,
    height: h * cs,
    "--cs": `${cs}px`,
    "--m": cs >= 16 ? "1px" : "0.5px",
    "--r": `${Math.max(2, Math.round(cs * 0.2))}px`,
    "--mc": myColor,
  } as CSSProperties;

  return (
    <div className="flex flex-col gap-2">
      <div ref={wrapRef} className="relative w-full">
        <div
          ref={vpRef}
          className={`mr-vp bg-[#100d22] ${live ? "mr-live" : ""}`}
          style={{ maxHeight: maxH, visibility: box ? "visible" : "hidden" }}
          tabIndex={0}
          role="application"
          aria-roledescription="minefield"
          aria-label={`Minefield, ${w} by ${h}. Arrow keys move, Space digs, F flags, plus and minus zoom.`}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className={`mr-board ${shake ? (shake % 2 ? "mr-shake-a" : "mr-shake-b") : ""}`}
            style={boardStyle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={cancelGesture}
            data-board
          >
            <Grid store={store} version={props.version} colors={colors} cs={cs} cursor={kbd ? cur : -1} over={over} />
          </div>
        </div>
        {overlay}
      </div>
      <span className="sr-only" aria-live="polite">
        {kbd ? describe(cur) : ""}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {tools}
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <button
            type="button"
            className="btn size-10 p-0 text-lg"
            aria-label="Zoom out"
            disabled={z <= 1.001}
            onClick={() => zoomTo(z / 1.4)}
          >
            −
          </button>
          <button
            type="button"
            className="btn size-10 p-0 text-lg"
            aria-label="Zoom in"
            disabled={z >= maxZ - 0.001}
            onClick={() => zoomTo(z * 1.4)}
          >
            +
          </button>
          {zoomed && (
            <button type="button" className="btn h-10 px-3 text-xs" onClick={() => zoomTo(1)}>
              Fit
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted sm:text-sm">{stats}</div>
      </div>
    </div>
  );
}

// ---------- the grid (memoised: clock ticks and overlays don't touch the 600 cells) ----------

const Grid = memo(function Grid({
  store,
  colors,
  cs,
  cursor,
  over,
}: {
  store: MineStore;
  /** Only here so a store change re-renders the grid. */
  version: number;
  colors: string[];
  cs: number;
  cursor: number;
  over: boolean;
}) {
  const { w, h } = store;
  const cells: ReactNode[] = [];
  for (let i = 0; i < w * h; i++) {
    const o = store.own[i];
    cells.push(
      <Cell
        key={i}
        i={i}
        code={store.cells[i]}
        color={o >= 0 ? (colors[o] ?? "") : ""}
        mine={o >= 0 && o === store.me}
        flag={store.flags[i] === 1}
        pending={store.pending.has(i)}
        item={store.item[i]}
        anim={store.anim[i]}
        delay={store.delay[i]}
        cursor={cursor === i}
        over={over}
      />,
    );
  }
  return (
    <>
      <div className="mr-grid" style={{ gridTemplateColumns: `repeat(${w}, ${cs}px)`, gridAutoRows: `${cs}px` }}>
        {cells}
      </div>
      <Effects store={store} colors={colors} cs={cs} />
    </>
  );
});

// ---------- one cell ----------

const Cell = memo(function Cell({
  i,
  code,
  color,
  mine,
  flag,
  pending,
  item,
  anim,
  delay,
  cursor,
  over,
}: {
  i: number;
  code: number;
  color: string;
  mine: boolean;
  flag: boolean;
  pending: boolean;
  item: number;
  anim: number;
  delay: number;
  cursor: boolean;
  over: boolean;
}) {
  let cls = "mr-c";
  let body: ReactNode = null;
  let style: CSSProperties | undefined;
  if (code === HIDDEN) {
    cls += pending ? " mr-h mr-p" : " mr-h";
    if (flag)
      body = (
        <span className="mr-flag relative">
          🚩
          {over && <i className="mr-mark text-red-400">✗</i>}
        </span>
      );
  } else if (code === MINE) {
    cls += " mr-m";
    body = flag ? (
      <span className="relative">
        🚩<i className="mr-mark text-green-400">✓</i>
      </span>
    ) : (
      <span className="mr-mine">💣</span>
    );
  } else if (code === BOOM) {
    cls += " mr-x";
    body = <span className="mr-mine">💣</span>;
  } else {
    cls += mine ? " mr-o mr-own" : " mr-o";
    if (color) style = { "--oc": color } as CSSProperties;
    const kind = ITEM_OF[item];
    body = (
      <>
        {code > 0 && <span style={{ color: NUM_COLORS[code] }}>{code}</span>}
        {kind && <span className={code > 0 ? "mr-item" : "mr-item mr-item-0"}>{ITEMS[kind].emoji}</span>}
      </>
    );
  }
  if (cursor) cls += " mr-cur";
  return (
    <div data-i={i} className={cls} style={style}>
      {body}
      {anim > 0 && code !== HIDDEN && <span key={anim} className="mr-cap" style={{ animationDelay: `${delay}ms` }} />}
    </div>
  );
});

// ---------- popups and effects ----------

function Effects({ store, colors, cs }: { store: MineStore; colors: string[]; cs: number }) {
  const { w, h } = store;
  const pos = (cell: number) => {
    const x = cell % w;
    return { x, y: (cell - x) / w };
  };
  return (
    <div className="mr-fx" aria-hidden>
      {store.fx.map((f) => {
        const { x, y } = pos(f.cell);
        const c = { left: (x + 0.5) * cs, top: (y + 0.5) * cs };
        if (f.kind === "boom")
          return (
            <span key={f.id}>
              <span className="mr-ring" style={{ ...c, "--fc": "#fca5a5" } as CSSProperties} />
              <span className="mr-blast" style={c}>
                💥
              </span>
            </span>
          );
        if (f.kind === "scan") {
          const x0 = Math.max(0, x - SCAN_RADIUS);
          const y0 = Math.max(0, y - SCAN_RADIUS);
          const x1 = Math.min(w - 1, x + SCAN_RADIUS);
          const y1 = Math.min(h - 1, y + SCAN_RADIUS);
          return (
            <span
              key={f.id}
              className="mr-scan"
              style={
                {
                  left: x0 * cs,
                  top: y0 * cs,
                  width: (x1 - x0 + 1) * cs,
                  height: (y1 - y0 + 1) * cs,
                  "--fc": colors[f.p] ?? "#fff",
                } as CSSProperties
              }
            />
          );
        }
        return (
          <span key={f.id} className="mr-ring" style={{ ...c, "--fc": f.kind === "freeze" ? "#7dd3fc" : "#67e8f9" } as CSSProperties} />
        );
      })}
      {store.popups.map((p) => {
        const { x, y } = pos(p.cell);
        return (
          <span
            key={p.id}
            className={`mr-pop ${p.big ? "mr-pop-big" : ""}`}
            style={
              {
                left: (x + 0.5) * cs,
                // Keep popups inside the board: near an edge they lean inwards, on the top rows they start lower.
                top: (y < 2 ? y + 1.6 : y) * cs,
                "--tx": x <= 1 ? "-12%" : x >= w - 2 ? "-88%" : "-50%",
                color: p.bad ? "#fca5a5" : (colors[p.p] ?? "#fff"),
              } as CSSProperties
            }
          >
            {p.text}
          </span>
        );
      })}
    </div>
  );
}
