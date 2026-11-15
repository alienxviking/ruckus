"use client";

// Small shared pieces for the Market Maker client: styles, people, numbers.

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { Player } from "@/shared/types";
import { HOUSE, signed } from "./shared";

export const BID = "#4ade80";
export const ASK = "#fb7185";
export const GAIN = "#4ade80";
export const LOSS = "#fb7185";
export const EASE = "cubic-bezier(.2,.8,.2,1)";

export const HOUSE_PLAYER: Player = { id: "house", name: "House", color: "#94a3b8", avatar: "🏦", connected: true };

/** Look up the trader in a slot (-1 = the House). */
export type WhoFn = (slot: number) => Player;

export function makeWho(ids: string[], byId: Record<string, Player>): WhoFn {
  return (slot) => {
    if (slot === HOUSE) return HOUSE_PLAYER;
    const id = ids[slot];
    return byId[id] ?? { id: id ?? `slot${slot}`, name: `Trader ${slot + 1}`, color: "#94a3b8", avatar: "🙂", connected: false };
  };
}

export function motionOK(): boolean {
  return typeof window !== "undefined" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Keeps a ref pointing at the latest value (for event handlers subscribed once). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

export const pnlColor = (n: number) => (n > 0 ? GAIN : n < 0 ? LOSS : "var(--color-muted)");

/** "long 4" / "short 2" / "flat". */
export function posWord(pos: number): string {
  if (pos > 0) return `long ${pos}`;
  if (pos < 0) return `short ${-pos}`;
  return "flat";
}

export function Name({ p, you }: { p: Player; you?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      <span aria-hidden>{p.avatar}</span>
      <span className="truncate font-semibold" style={{ color: p.color }}>
        {you ? "You" : p.name}
      </span>
    </span>
  );
}

export function Panel({
  title,
  aside,
  children,
  className = "",
  style,
  label,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  return (
    <section className={`card min-w-0 p-3 ${className}`} style={style} aria-label={label}>
      {(title || aside) && (
        <div className="mb-2 flex min-h-5 items-center justify-between gap-2">
          {title && <h3 className="label">{title}</h3>}
          {aside && <div className="min-w-0 text-right text-xs text-muted">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A number that counts up to `value` (from `from`) once it mounts or changes. */
export function CountUp({
  value,
  from = 0,
  delay = 0,
  duration = 900,
  sign = true,
  className,
  style,
}: {
  value: number;
  from?: number;
  delay?: number;
  duration?: number;
  sign?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = (n: number) => (sign ? signed(Math.round(n)) : String(Math.round(n)));
  useLayoutEffect(() => {
    const node = ref.current?.firstChild;
    const show = (n: number) => {
      const t = sign ? signed(Math.round(n)) : String(Math.round(n));
      if (node && node.nodeValue !== t) node.nodeValue = t;
    };
    if (!node || node.nodeType !== Node.TEXT_NODE || from === value || !motionOK()) return;
    show(from);
    const start = performance.now() + delay;
    let raf = requestAnimationFrame(function step(now: number) {
      const k = Math.min(1, Math.max(0, (now - start) / duration));
      show(from + (value - from) * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(raf);
      show(value);
    };
  }, [value, from, delay, duration, sign]);
  return (
    <span ref={ref} className={className} style={style}>
      {fmt(value)}
    </span>
  );
}

/** Game-local styles. Keyframes are prefixed mk- so they can't clash with other games. */
export const CSS = `
.mk-card { perspective: 700px; }
.mk-card-inner { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; transition: transform .75s cubic-bezier(.3,1.25,.45,1); }
.mk-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: 10px; }
.mk-back { transform: rotateY(180deg); }
.mk-deal { animation: mk-deal .5s cubic-bezier(.2,1.2,.4,1) both; }
@keyframes mk-deal { from { opacity: 0; transform: translateY(-18px) rotate(-8deg) scale(.9); } }
.mk-reveal { animation: mk-reveal .55s cubic-bezier(.2,1.1,.4,1) both; }
@keyframes mk-reveal { from { opacity: 0; transform: rotateY(90deg) scale(.9); } }
.mk-next { animation: mk-next 1.4s ease-in-out infinite; }
@keyframes mk-next { 0%, 100% { box-shadow: 0 0 0 2px var(--mk-accent), 0 0 0 0 transparent; } 50% { box-shadow: 0 0 0 2px var(--mk-accent), 0 0 18px 2px var(--mk-accent); } }
.mk-in { animation: mk-in .35s ${EASE} both; }
@keyframes mk-in { from { opacity: 0; transform: translateY(6px); } }
.mk-flash { animation: mk-flash 1.1s ease-out both; }
@keyframes mk-flash { from { background-color: var(--mk-flash, rgb(255 255 255 / .22)); } }
.mk-pop { animation: mk-pop .45s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes mk-pop { from { opacity: 0; transform: scale(1.6); } }
.mk-grow { transform-origin: left; animation-name: mk-grow; animation-timing-function: linear; animation-fill-mode: forwards; }
@keyframes mk-grow { from { transform: scaleX(var(--from, 0)); } to { transform: scaleX(1); } }
.mk-bell { display: inline-block; animation: mk-bell .9s ease-in-out 2; transform-origin: 50% 0; }
@keyframes mk-bell { 0%, 100% { transform: rotate(0); } 20% { transform: rotate(18deg); } 40% { transform: rotate(-14deg); } 60% { transform: rotate(9deg); } 80% { transform: rotate(-5deg); } }
.mk-pulse { animation: mk-pulse 1.6s ease-in-out infinite; }
@keyframes mk-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.mk-crown { display: inline-block; animation: mk-crown .6s cubic-bezier(.2,1.5,.4,1) .3s both; }
@keyframes mk-crown { from { opacity: 0; transform: translateY(8px) rotate(-25deg) scale(.4); } }
.mk-floor { display: grid; gap: .75rem; grid-template-columns: minmax(0, 1fr); }
.mk-col { display: contents; }
@container (min-width: 42rem) {
  .mk-floor { grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr); align-items: start; }
  .mk-col { display: flex; flex-direction: column; gap: .75rem; min-width: 0; }
}
.mk-num::-webkit-outer-spin-button, .mk-num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.mk-num { -moz-appearance: textfield; appearance: textfield; }
@media (prefers-reduced-motion: reduce) {
  .mk-card-inner { transition: none; }
  .mk-next, .mk-pulse, .mk-bell { animation: none; }
  .mk-deal, .mk-reveal, .mk-pop, .mk-crown, .mk-in { animation: mk-fade .2s ease both; }
  @keyframes mk-fade { from { opacity: 0; } }
}
`;
