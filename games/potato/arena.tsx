"use client";

// The ring of seats, the potato (held, flying, exploding) and heckle floaters.
// Geometry is measured with a ResizeObserver; seats sit on a squircle around
// the arena (an ellipse-ish ring that's taller on phones), rotated so YOUR seat
// is always at the bottom, nearest your thumb.

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { Player } from "@/shared/types";
import type { Boom, Flight, PotatoView } from "./server";
import { FLIGHT_MS, HEAT_FULL_MS } from "./shared";
import { Avatar } from "@/components/Avatar";

// ---------- small hooks ----------

function subscribeReducedMotion(cb: () => void) {
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Server time, refreshed every `ms` (kept in state so rendering stays pure). */
function useServerClock(serverNow: () => number, ms: number) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(id);
  }, [serverNow, ms]);
  return now;
}

/** 0..1, purely from time since the round went live. Says nothing about the fuse. */
function useHeat(liveAt: number | null, serverNow: () => number) {
  const now = useServerClock(serverNow, 1000);
  if (liveAt === null) return 0;
  return Math.min(1, Math.max(0, (now - liveAt) / HEAT_FULL_MS));
}

/** The arena's warm glow. Its own component so only it re-renders as the heat rises. */
function HeatGlow({ liveAt, serverNow }: { liveAt: number | null; serverNow: () => number }) {
  const heat = useHeat(liveAt, serverNow);
  return (
    <div
      aria-hidden
      className="pot-glow pointer-events-none absolute inset-0"
      style={{
        opacity: heat * 0.9,
        background: "radial-gradient(ellipse at 50% 50%, rgba(249,115,22,.22), rgba(239,68,68,.08) 45%, transparent 70%)",
      }}
    />
  );
}

// ---------- geometry ----------

export interface Pt {
  x: number;
  y: number;
}

export interface Layout {
  w: number;
  h: number;
  narrow: boolean;
  seatW: number;
  seatH: number;
  potato: number;
  /** Ring slots, slot 0 at the bottom, then clockwise. */
  slots: Pt[];
  /** Width available to the centre card. */
  cardW: number;
}

export function ringLayout(w: number, h: number, n: number): Layout {
  const narrow = w < 500;
  const many = n >= 9;
  const seatW = narrow ? (many ? 54 : 64) : many ? 68 : 80;
  const seatH = seatW + (narrow ? 16 : 18);
  const a = Math.max(8, w / 2 - seatW / 2 - 2);
  const b = Math.max(8, h / 2 - seatH / 2 - 2);
  // Squircle exponent: 2 is an ellipse; a bit higher uses the corners.
  const e = 2 / 2.7;
  const N = 256;
  const pts: Pt[] = [];
  const cum = [0];
  for (let k = 0; k <= N; k++) {
    const th = Math.PI / 2 + (2 * Math.PI * k) / N;
    const c = Math.cos(th);
    const s = Math.sin(th);
    pts.push({ x: w / 2 + a * Math.sign(c) * Math.abs(c) ** e, y: h / 2 + b * Math.sign(s) * Math.abs(s) ** e });
    if (k) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
  }
  const total = cum[N];
  const slots: Pt[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / n;
    while (k < N - 1 && cum[k + 1] < target) k++;
    const seg = cum[k + 1] - cum[k] || 1;
    const f = (target - cum[k]) / seg;
    slots.push({ x: pts[k].x + (pts[k + 1].x - pts[k].x) * f, y: pts[k].y + (pts[k + 1].y - pts[k].y) * f });
  }
  const cardW = narrow ? Math.min(340, w - 12) : Math.min(380, w - 2 * seatW - 24);
  return { w, h, narrow, seatW, seatH, potato: narrow ? 42 : 52, slots, cardW };
}

/** Size of a seat's avatar circle. */
const avatarSize = (L: Layout) => Math.round(L.seatW * 0.62);

/** Where a seat holds the potato: just clear of its seat box, on the side facing the middle. */
function holdPoint(L: Layout, p: Pt): Pt {
  const dx = L.w / 2 - p.x;
  const dy = L.h / 2 - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const edge = Math.min(Math.abs(ux) > 1e-6 ? L.seatW / 2 / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-6 ? L.seatH / 2 / Math.abs(uy) : Infinity);
  const off = Math.min(d * 0.75, edge + L.potato * 0.5 + 6);
  return { x: p.x + ux * off, y: p.y + uy * off };
}

/** The throw's arc: a quadratic curve bowed upwards (or sideways for vertical throws). */
function arc(a: Pt, b: Pt): (t: number) => Pt {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  let px = -dy / d;
  let py = dx / d;
  if (py > 0 || (Math.abs(py) < 0.25 && px < 0)) {
    px = -px;
    py = -py;
  }
  const lift = Math.min(160, 30 + d * 0.35);
  const c = { x: mx + px * lift, y: my + py * lift - d * 0.08 };
  return (t) => {
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  };
}

// ---------- CSS ----------

export const CSS = `
.pot-wob { animation: pot-wob var(--wd, 1s) ease-in-out infinite; transform-origin: 50% 70%; }
@keyframes pot-wob { 0%, 100% { transform: rotate(calc(var(--wa, 4deg) * -1)); } 50% { transform: rotate(var(--wa, 4deg)); } }
.pot-spark { position: absolute; width: 4px; height: 4px; margin: -2px 0 0 -2px; border-radius: 9999px; background: #fef08a;
  box-shadow: 0 0 6px 2px #fb923c; animation: pot-spark var(--sd, .7s) linear infinite; animation-delay: var(--sdl, 0s); }
@keyframes pot-spark { 0% { transform: translate(0, 0) scale(1); opacity: 1; } 100% { transform: translate(var(--sx), var(--sy)) scale(.2); opacity: 0; } }
.pot-flicker { animation: pot-flicker .16s steps(2) infinite; }
@keyframes pot-flicker { 50% { opacity: .6; transform: scale(.75); } }
.pot-pulse { animation: pot-pulse .9s ease-in-out infinite; }
@keyframes pot-pulse { 0%, 100% { box-shadow: 0 0 0 2px var(--c), 0 0 0 0 var(--c); } 50% { box-shadow: 0 0 0 3px var(--c), 0 0 18px 5px var(--c); } }
.pot-boom { animation: pot-boom .6s cubic-bezier(.2,1.6,.4,1) both; }
.pot-blast { animation: pot-blast 1s cubic-bezier(.2,.9,.3,1) both; }
@keyframes pot-blast { 0% { transform: scale(.2) rotate(-20deg); opacity: 0; } 14% { transform: scale(1.5) rotate(6deg); opacity: 1; }
  26% { transform: scale(1); opacity: 1; } 55% { transform: scale(1); opacity: 1; } 100% { transform: scale(.6); opacity: 0; } }
.pot-late { animation-delay: .75s; }
@keyframes pot-boom { 0% { transform: scale(.2) rotate(-20deg); opacity: 0; } 55% { transform: scale(1.4) rotate(6deg); opacity: 1; } 100% { transform: scale(1); } }
.pot-ring { animation: pot-ring .7s ease-out both; }
@keyframes pot-ring { from { transform: scale(.2); opacity: .95; } to { transform: scale(4.5); opacity: 0; } }
.pot-debris { animation: pot-debris 1s cubic-bezier(.15,.7,.3,1) both; }
@keyframes pot-debris { from { transform: translate(0, 0) rotate(0); opacity: 1; } to { transform: translate(var(--dx), var(--dy)) rotate(var(--dr)); opacity: 0; } }
.pot-float { animation: pot-float 1.7s ease-out both; }
@keyframes pot-float { 0% { transform: translate(-50%, 0) scale(.4); opacity: 0; } 15% { transform: translate(-50%, -12px) scale(1.2); opacity: 1; }
  100% { transform: translate(calc(-50% + var(--fx)), -96px) scale(1); opacity: 0; } }
.pot-in { animation: pot-in .28s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes pot-in { from { transform: scale(.6); opacity: 0; } }
.pot-drop { animation: pot-drop .45s cubic-bezier(.3,1.6,.5,1) both; }
@keyframes pot-drop { from { transform: translateY(-40px) scale(.5); opacity: 0; } }
.pot-nope { animation: pot-nope .36s ease both; }
@keyframes pot-nope { 20% { transform: translateX(-9px); } 40% { transform: translateX(8px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(3px); } }
.pot-bar { transform-origin: left; animation: pot-bar linear both; }
@keyframes pot-bar { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.pot-flash { animation: pot-flash .7s ease-out both; }
@keyframes pot-flash { from { opacity: .6; } to { opacity: 0; } }
.pot-bob { animation: pot-bob .8s ease-in-out infinite; }
@keyframes pot-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
.pot-heart { display: inline-block; animation: pot-heart .9s ease both; }
@keyframes pot-heart { 0% { transform: scale(1); } 30% { transform: scale(1.9); } 100% { transform: scale(1); } }
.pot-glow { transition: opacity 1s ease; }
.pot-seat { transition: opacity .2s ease, transform .15s cubic-bezier(.2,.8,.2,1); }
.pot-seat:not(:disabled):hover { transform: scale(1.07); }
.pot-seat:not(:disabled):active { transform: scale(.94); }
.pot-key { display: none; }
@media (hover: hover) and (pointer: fine) { .pot-key { display: grid; } }
@media (prefers-reduced-motion: reduce) {
  .pot-wob, .pot-spark, .pot-flicker, .pot-bob { animation: none; }
  .pot-pulse { animation: none; box-shadow: 0 0 0 3px var(--c); }
  .pot-boom, .pot-blast, .pot-ring, .pot-debris, .pot-float, .pot-in, .pot-drop, .pot-nope, .pot-heart, .pot-flash { animation-duration: .01s; }
  .pot-late { animation-delay: 0s; }
  .pot-seat, .pot-seat:not(:disabled):hover { transition: none; transform: none; }
}
`;

const vars = (v: Record<string, string | number>) => v as CSSProperties;

// ---------- seats ----------

export interface SeatInfo {
  id: string;
  player: Player;
  lives: number;
  out: boolean;
}

function Hearts({ lives, max, size }: { lives: number; max: number; size: number }) {
  return (
    <span className="flex items-center justify-center gap-px leading-none" style={{ fontSize: size }} aria-hidden>
      {Array.from({ length: max }, (_, i) =>
        i < lives ? (
          <span key={i}>❤️</span>
        ) : (
          <span key={`x${i}-${lives}`} className="pot-heart opacity-70">
            💔
          </span>
        ),
      )}
    </span>
  );
}

function Seat({
  seat,
  pt,
  L,
  maxLives,
  isMe,
  holding,
  targetable,
  blocked,
  keyHint,
  dim,
  hit,
  crowned,
  accent,
  onThrow,
}: {
  seat: SeatInfo;
  pt: Pt;
  L: Layout;
  maxLives: number;
  isMe: boolean;
  holding: boolean;
  targetable: boolean;
  blocked: boolean;
  keyHint: string | null;
  dim: boolean;
  hit: number | null;
  crowned: boolean;
  accent: string;
  onThrow: (id: string) => void;
}) {
  const p = seat.player;
  const away = !p.connected;
  const av = avatarSize(L);
  const lifeWord = seat.lives === 1 ? "life" : "lives";
  const label = targetable
    ? `Throw to ${p.name}, ${seat.lives} ${lifeWord}${away ? ", offline" : ""}`
    : `${p.name}${isMe ? " (you)" : ""}: ${seat.out ? "out" : `${seat.lives} ${lifeWord}`}${holding ? ", has the potato" : ""}${
        blocked ? ", threw it to you (no throwbacks)" : ""
      }${away ? ", offline" : ""}`;
  return (
    <button
      type="button"
      disabled={!targetable}
      onClick={() => onThrow(seat.id)}
      aria-label={label}
      aria-keyshortcuts={targetable && keyHint ? keyHint : undefined}
      className={`pot-seat absolute flex flex-col items-center justify-start gap-0.5 rounded-2xl pt-1 outline-none focus-visible:ring-2 focus-visible:ring-text/80 ${
        targetable ? "cursor-pointer" : "cursor-default"
      }`}
      style={{
        left: pt.x - L.seatW / 2,
        top: pt.y - L.seatH / 2,
        width: L.seatW,
        height: L.seatH,
        opacity: dim ? 0.3 : seat.out ? 0.55 : away ? 0.6 : 1,
        zIndex: targetable ? 15 : 10,
      }}
    >
      <span
        key={hit ?? "calm"}
        className={`relative grid shrink-0 place-items-center rounded-full ${targetable ? "pot-pulse" : ""} ${hit ? "pot-nope" : ""}`}
        style={{
          ...vars({ "--c": accent }),
          width: av,
          height: av,
          fontSize: Math.round(av * 0.56),
          background: seat.out ? "var(--color-panel-2)" : `${p.color}26`,
          border: `2px solid ${seat.out ? "var(--color-line)" : holding ? "#fb923c" : p.color}`,
          boxShadow: holding ? "0 0 0 3px #fb923c55, 0 0 22px 2px #fb923c88" : undefined,
          filter: seat.out ? "grayscale(1)" : undefined,
        }}
      >
        <span aria-hidden className="leading-none">
          <Avatar id={seat.out ? "👻" : p.avatar} />
        </span>
        {isMe && !crowned && (
          <span
            aria-hidden
            className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-px text-[9px] font-black tracking-wide text-ink"
            style={{ background: p.color }}
          >
            YOU
          </span>
        )}
        {crowned && (
          <span aria-hidden className="pot-drop absolute -top-5 left-1/2 -ml-[0.5em] text-lg leading-none">
            👑
          </span>
        )}
        {blocked && (
          <span
            aria-hidden
            title="No throwbacks"
            className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full border border-line bg-ink text-[11px] leading-none"
          >
            🚫
          </span>
        )}
        {away && !seat.out && (
          <span aria-hidden className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border border-line bg-ink text-[10px] leading-none">
            📡
          </span>
        )}
        {targetable && keyHint && (
          <span
            aria-hidden
            className="pot-key absolute -top-1 -left-1 size-5 place-items-center rounded-md border border-line bg-ink font-mono text-[10px] font-bold text-text"
          >
            {keyHint}
          </span>
        )}
      </span>
      <span
        className={`max-w-full truncate px-0.5 leading-tight font-bold ${L.narrow ? "text-[11px]" : "text-xs"}`}
        style={{ color: seat.out ? "var(--color-muted)" : p.color }}
      >
        {p.name}
      </span>
      {seat.out ? (
        <span className="text-[9px] leading-none font-black tracking-widest text-muted">OUT</span>
      ) : (
        <Hearts lives={seat.lives} max={maxLives} size={L.narrow ? 9 : 11} />
      )}
    </button>
  );
}

// ---------- the potato ----------

const SPARKS = Array.from({ length: 14 }, (_, i) => {
  const ang = -Math.PI / 2 + (i % 7) * 0.5 - 1.4 + (i > 6 ? 0.25 : 0);
  const r = 14 + ((i * 7) % 5) * 4;
  return { sx: Math.cos(ang) * r, sy: Math.sin(ang) * r - 4, sd: 0.45 + ((i * 3) % 5) * 0.08, sdl: -((i * 0.13) % 0.7) };
});

function PotatoSprite({
  at,
  size,
  liveAt,
  flight,
  popKey,
  serverNow,
  reduced,
}: {
  at: Pt;
  size: number;
  /** Round start while live (sparks grow from here), null otherwise. */
  liveAt: number | null;
  flight: { key: string; from: Pt; to: Pt; at: number } | null;
  popKey: string;
  serverNow: () => number;
  reduced: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const heat = useHeat(liveAt, serverNow);
  const level = Math.round(heat * 5);
  const sparks = 2 + level * 2;
  const startOf = useEffectEvent(() => flight?.at ?? 0);
  const fkey = flight?.key ?? null;
  const [fx, fy, tx, ty] = flight ? [flight.from.x, flight.from.y, flight.to.x, flight.to.y] : [0, 0, 0, 0];

  useEffect(() => {
    const el = ref.current;
    if (!fkey || !el || reduced || typeof el.animate !== "function") return;
    const elapsed = serverNow() - startOf();
    if (elapsed >= FLIGHT_MS) return;
    const path = arc({ x: fx, y: fy }, { x: tx, y: ty });
    const frames: Keyframe[] = [];
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const q = path(t);
      const s = 1 + 0.4 * Math.sin(Math.PI * t);
      frames.push({ transform: `translate(${q.x - size / 2}px, ${q.y - size / 2}px) rotate(${t * 600}deg) scale(${s})` });
    }
    const anim = el.animate(frames, { duration: FLIGHT_MS, easing: "linear" });
    anim.currentTime = Math.max(0, elapsed);
    // In the air it flies over everything, including the centre card.
    el.style.zIndex = "35";
    const land = () => {
      el.style.zIndex = "";
    };
    anim.onfinish = land;
    return () => {
      anim.cancel();
      land();
    };
  }, [fkey, fx, fy, tx, ty, size, reduced, serverNow]);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 z-20"
      style={{ width: size, height: size, transform: `translate(${at.x - size / 2}px, ${at.y - size / 2}px)` }}
    >
      <div key={popKey} className="pot-drop size-full">
        <div
          className="pot-wob relative size-full"
          style={{
            ...vars({ "--wd": `${(1.1 - heat * 0.75).toFixed(2)}s`, "--wa": `${(3 + heat * 9).toFixed(1)}deg` }),
            filter: `drop-shadow(0 0 ${(3 + heat * 12).toFixed(1)}px rgba(251,146,60,${(0.45 + heat * 0.5).toFixed(2)}))`,
          }}
        >
          <span className="absolute inset-0 grid place-items-center leading-none" style={{ fontSize: size * 0.86 }}>
            🥔
          </span>
          {/* The fuse: a little curl with a fizzing tip. */}
          <svg viewBox="0 0 20 20" className="absolute overflow-visible" style={{ width: size * 0.42, height: size * 0.42, left: size * 0.5, top: -size * 0.16 }}>
            <path d="M2 18 C 4 10, 12 14, 13 4" stroke="#d6d3d1" strokeWidth={2.4} strokeLinecap="round" fill="none" />
          </svg>
          <span className="absolute" style={{ left: size * 0.5 + size * 0.27, top: -size * 0.16 + size * 0.08 }}>
            <span
              className="pot-flicker absolute block rounded-full"
              style={{
                width: 9 + heat * 6,
                height: 9 + heat * 6,
                marginLeft: -(9 + heat * 6) / 2,
                marginTop: -(9 + heat * 6) / 2,
                background: "radial-gradient(circle, #fff 0 25%, #fde047 40%, #f97316 70%, transparent 72%)",
              }}
            />
            {SPARKS.slice(0, sparks).map((s, i) => (
              <span
                key={i}
                className="pot-spark"
                style={vars({ "--sx": `${s.sx}px`, "--sy": `${s.sy}px`, "--sd": `${s.sd}s`, "--sdl": `${s.sdl}s` })}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------- boom ----------

const DEBRIS = ["🔥", "💨", "✨", "🔥", "💥", "✨", "💨", "🔥", "✨", "💨"];

function BoomFx({ at, big }: { at: Pt; big: boolean }) {
  const r = big ? 1.25 : 1;
  return (
    <div aria-hidden className="pointer-events-none absolute z-40" style={{ left: at.x, top: at.y }}>
      <span
        className="pot-ring absolute rounded-full border-4"
        style={{ width: 60 * r, height: 60 * r, left: -30 * r, top: -30 * r, borderColor: "#fb923c" }}
      />
      <span
        className="pot-ring absolute rounded-full"
        style={{ width: 50 * r, height: 50 * r, left: -25 * r, top: -25 * r, background: "#fde04766", animationDelay: ".06s" }}
      />
      {DEBRIS.map((d, i) => {
        const ang = (i / DEBRIS.length) * Math.PI * 2 + 0.3;
        const dist = (70 + (i % 3) * 26) * r;
        return (
          <span
            key={i}
            className="pot-debris absolute text-xl leading-none"
            style={{
              left: -10,
              top: -10,
              ...vars({ "--dx": `${Math.cos(ang) * dist}px`, "--dy": `${Math.sin(ang) * dist}px`, "--dr": `${(i % 2 ? 1 : -1) * 200}deg` }),
            }}
          >
            {d}
          </span>
        );
      })}
      <span className="pot-blast absolute grid place-items-center leading-none" style={{ fontSize: 76 * r, width: 100 * r, height: 100 * r, left: -50 * r, top: -50 * r }}>
        💥
      </span>
    </div>
  );
}

// ---------- heckles ----------

export interface Floater {
  id: number;
  from: string;
  e: string;
  /** Spectators float from a random spot along the bottom edge (0..1). */
  rx: number;
  fx: number;
}

// ---------- the arena ----------

export function Arena({
  view,
  seats,
  me,
  maxLives,
  potatoAt,
  flight,
  targets,
  keyHints,
  focus,
  accent,
  serverNow,
  floaters,
  byId,
  onThrow,
  center,
}: {
  view: PotatoView;
  seats: SeatInfo[];
  me: string;
  maxLives: number;
  /** Who has (or is about to catch) the potato; null hides it. */
  potatoAt: string | null;
  flight: Flight | null;
  /** Seats you can throw to right now. */
  targets: Set<string>;
  keyHints: Record<string, string>;
  /** Your puzzle is up: the ring fades back. */
  focus: boolean;
  accent: string;
  serverNow: () => number;
  floaters: Floater[];
  byId: Record<string, Player>;
  onThrow: (id: string) => void;
  center: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const reduced = useReducedMotion();
  const liveAt = view.phase === "live" ? view.liveAt : null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize((s) => (s && Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Your seat at the bottom; everyone else clockwise in join order.
  const myIdx = Math.max(0, seats.findIndex((x) => x.id === me));
  const n = seats.length;
  const L = useMemo(() => (size ? ringLayout(size.w, size.h, n) : null), [size, n]);
  const pos = useMemo(() => {
    const m = new Map<string, Pt>();
    if (!L) return m;
    seats.forEach((x, i) => m.set(x.id, L.slots[(i - myIdx + n) % n]));
    return m;
  }, [L, seats, myIdx, n]);

  // A boom shakes the whole arena.
  const boom: Boom | null = view.phase === "boom" ? view.boom : null;
  const boomAt = boom?.at ?? null;
  useEffect(() => {
    const el = ref.current;
    if (boomAt === null || !el || reduced || typeof el.animate !== "function") return;
    const anim = el.animate(
      [
        { transform: "translate(0,0)" },
        { transform: "translate(-9px,5px) rotate(-.6deg)" },
        { transform: "translate(8px,-6px) rotate(.5deg)" },
        { transform: "translate(-6px,-3px)" },
        { transform: "translate(5px,4px)" },
        { transform: "translate(-2px,1px)" },
        { transform: "translate(0,0)" },
      ],
      { duration: 520, easing: "ease-out" },
    );
    return () => anim.cancel();
  }, [boomAt, reduced]);

  let boomPt: Pt | null = null;
  if (L && boom) {
    const v = pos.get(boom.victim);
    if (boom.midair && boom.from && boom.to && pos.get(boom.from) && pos.get(boom.to)) {
      boomPt = arc(holdPoint(L, pos.get(boom.from)!), holdPoint(L, pos.get(boom.to)!))(boom.frac);
    } else if (v) boomPt = holdPoint(L, v);
  }

  const holderPt = L && potatoAt && pos.get(potatoAt) ? holdPoint(L, pos.get(potatoAt)!) : null;
  let flightAnim: { key: string; from: Pt; to: Pt; at: number } | null = null;
  if (L && flight && pos.get(flight.from) && pos.get(flight.to)) {
    flightAnim = {
      key: `${view.round}:${flight.pass}`,
      from: holdPoint(L, pos.get(flight.from)!),
      to: holdPoint(L, pos.get(flight.to)!),
      at: flight.at,
    };
  }

  const hitId = boom?.victim ?? null;
  const iWasHit = !!boom && boom.victim === me;

  return (
    <div
      ref={ref}
      className="relative w-full overflow-hidden rounded-[1.6rem] border border-line aspect-[0.84] @lg:aspect-[1.42]"
      style={{
        maxHeight: "64vh",
        minHeight: 300,
        background:
          "radial-gradient(ellipse at 50% 55%, color-mix(in oklab, var(--color-panel-2) 85%, #f97316 15%) 0%, var(--color-panel) 62%, var(--color-ink) 100%)",
      }}
    >
      {/* A felt-like inner ring for the circle of players. */}
      <div aria-hidden className="pointer-events-none absolute inset-[9%] rounded-[45%] border-2 border-dashed border-white/[0.06]" />
      {/* Heat glow: grows with time in the round, never with the fuse. */}
      <HeatGlow liveAt={liveAt} serverNow={serverNow} />

      {L && (
        <>
          {seats.map((s) => {
            const pt = pos.get(s.id)!;
            return (
              <Seat
                key={s.id}
                seat={s}
                pt={pt}
                L={L}
                maxLives={maxLives}
                isMe={s.id === me}
                holding={view.phase !== "boom" && potatoAt === s.id && !flight}
                targetable={targets.has(s.id)}
                blocked={targets.size > 0 && s.id === view.lastFrom && !targets.has(s.id)}
                keyHint={keyHints[s.id] ?? null}
                dim={focus}
                hit={hitId === s.id ? boomAt : null}
                crowned={view.phase === "over" && view.winner === s.id}
                accent={accent}
                onThrow={onThrow}
              />
            );
          })}

          {holderPt && (view.phase === "live" || view.phase === "ready") && (
            <PotatoSprite
              at={holderPt}
              size={L.potato}
              liveAt={liveAt}
              flight={flightAnim}
              popKey={`r${view.round}`}
              serverNow={serverNow}
              reduced={reduced}
            />
          )}

          {boom && boomPt && <BoomFx key={boom.at} at={boomPt} big={boom.out} />}

          {floaters.map((f) => {
            const seatPt = pos.get(f.from);
            const x = seatPt ? seatPt.x : 24 + f.rx * (L.w - 48);
            const y = seatPt ? seatPt.y - L.seatH / 2 : L.h - 18;
            const who = byId[f.from];
            return (
              <span
                key={f.id}
                aria-hidden
                className="pot-float pointer-events-none absolute z-40 flex items-center gap-0.5 leading-none"
                style={{ left: x, top: y, ...vars({ "--fx": `${f.fx}px` }) }}
              >
                <span className="text-3xl">{f.e}</span>
                {who && !seatPt && <span className="text-sm opacity-80"><Avatar id={who.avatar} /></span>}
              </span>
            );
          })}

          <div
            className="pointer-events-none absolute z-30 flex justify-center"
            style={{ left: L.w / 2, top: L.h * (L.narrow ? 0.46 : 0.48), width: L.cardW, transform: "translate(-50%, -50%)" }}
          >
            {center}
          </div>
        </>
      )}

      {iWasHit && (
        <div key={boomAt ?? 0} aria-hidden className="pot-flash pointer-events-none absolute inset-0 z-40" style={{ background: "#ef4444" }} />
      )}
    </div>
  );
}
