"use client";

// Small shared pieces for the auction client: styles, people, numbers, hooks.

import { useEffect, useLayoutEffect, useReducer, useRef, type CSSProperties, type ReactNode } from "react";
import type { Player } from "@/shared/types";
import { kindOf } from "./shared";

export const GOLD = "#fbbf24";
export const CURSE = "#c084fc";
export const JUNK = "#94a3b8";
export const GAIN = "#4ade80";
export const LOSS = "#fb7185";
export const EASE = "cubic-bezier(.2,.8,.2,1)";

export const kindColor = (v: number) => {
  const k = kindOf(v);
  return k === "treasure" ? GOLD : k === "cursed" ? CURSE : JUNK;
};
export const pnlColor = (n: number) => (n > 0 ? GAIN : n < 0 ? LOSS : "var(--color-muted)");

export type Who = (slot: number) => Player;

export function makeWho(ids: string[], byId: Record<string, Player>): Who {
  return (slot) => {
    const id = ids[slot];
    return byId[id] ?? { id: id ?? `slot${slot}`, name: `Bidder ${slot + 1}`, color: "#a39dc8", avatar: "🙂", connected: false };
  };
}

/** Keeps a ref pointing at the latest value (for listeners subscribed once). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** True once server time passes `at`; re-renders exactly then (no polling). */
export function usePassed(at: number, serverNow: () => number): boolean {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const passed = serverNow() >= at;
  useEffect(() => {
    if (passed) return;
    const id = setTimeout(force, Math.max(0, at - serverNow()) + 15);
    return () => clearTimeout(id);
  }, [at, passed, serverNow]);
  return passed;
}

export function Name({ p, you, className = "" }: { p: Player; you?: boolean; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-baseline gap-1 ${className}`}>
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

// Game-local animations, prefixed so they can't clash. Transform/opacity only.
export const CSS = `
.au-shake { animation: au-shake .5s cubic-bezier(.36,.07,.19,.97) both; transform-origin: 50% 92%; }
@keyframes au-shake {
  15% { transform: rotate(-5deg) translateY(-5px); }
  30% { transform: rotate(4deg) translateY(-2px); }
  45% { transform: rotate(-3deg); }
  60% { transform: rotate(2deg); }
  75% { transform: rotate(-1deg); }
}
.au-tremble { animation: au-tremble .16s linear infinite; transform-origin: 50% 92%; }
@keyframes au-tremble { 0%,100% { transform: none; } 25% { transform: translateX(-1.5px) rotate(-.8deg); } 75% { transform: translateX(1.5px) rotate(.8deg); } }
.au-lid { transform-box: view-box; transform-origin: 100px 55px; transition: transform .6s cubic-bezier(.3,.7,.4,1) .25s, opacity .35s ease .5s; }
.au-lid.au-open { transform: translate(-22px, -42px) rotate(-24deg); opacity: 0; }
.au-rise { animation: au-rise .8s cubic-bezier(.2,1.4,.4,1) .5s both; }
@keyframes au-rise { from { transform: translateY(50px) scale(.3); opacity: 0; } }
.au-stamp { animation: au-stamp .4s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes au-stamp { from { transform: rotate(-14deg) scale(2.6); opacity: 0; } to { transform: rotate(-14deg) scale(1); opacity: 1; } }
.au-spark { position: absolute; left: 50%; top: 42%; animation: au-spark 1.1s cubic-bezier(.1,.7,.3,1) .55s both; }
@keyframes au-spark {
  from { transform: translate(-50%,-50%) rotate(var(--r)) translateY(0) scale(.3); opacity: 1; }
  70% { opacity: 1; }
  to { transform: translate(-50%,-50%) rotate(var(--r)) translateY(var(--d)) scale(1); opacity: 0; }
}
.au-smoke { position: absolute; left: 50%; top: 40%; border-radius: 999px; filter: blur(7px); animation: au-smoke 2.4s ease-out both; }
@keyframes au-smoke {
  from { transform: translate(-50%,0) scale(.3); opacity: .9; }
  to { transform: translate(calc(-50% + var(--dx)), -110px) scale(1.8); opacity: 0; }
}
.au-rays { animation: au-spin 9s linear infinite; }
@keyframes au-spin { to { transform: rotate(360deg); } }
.au-glow { animation: au-glow 1.6s ease-in-out infinite; }
@keyframes au-glow { 0%,100% { opacity: .45; } 50% { opacity: 1; } }
.au-pop { animation: au-pop .35s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes au-pop { from { transform: scale(1.7); opacity: 0; } }
.au-seg { transform-origin: left center; animation-name: au-fill; animation-timing-function: linear; animation-fill-mode: both; }
@keyframes au-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.au-float { animation: au-float .9s ease-out both; }
@keyframes au-float { from { transform: translate(-50%, 0) scale(.9); opacity: 1; } to { transform: translate(-50%, -46px) scale(1.15); opacity: 0; } }
.au-pulse { animation: au-pulse 1s ease-in-out infinite; }
@keyframes au-pulse { 0%,100% { opacity: .5; } 50% { opacity: 1; } }
.au-in { animation: au-in .35s cubic-bezier(.2,.8,.2,1) both; }
@keyframes au-in { from { opacity: 0; transform: translateY(8px) scale(.98); } }
.au-slide { animation: au-slide .55s cubic-bezier(.2,1.2,.4,1) both; }
@keyframes au-slide { from { opacity: 0; transform: translateX(70px) rotate(10deg); } }
.au-flash { animation: au-flash .9s ease-out both; }
@keyframes au-flash { from { box-shadow: 0 0 0 2px var(--au-c), 0 0 22px var(--au-c); } to { box-shadow: 0 0 0 0 transparent; } }
.au-gavel { display: inline-block; animation: au-gavel .5s cubic-bezier(.5,0,.6,1.6) both; transform-origin: 80% 80%; }
@keyframes au-gavel { 0% { transform: rotate(-60deg); opacity: 0; } 60% { transform: rotate(14deg); opacity: 1; } 100% { transform: none; } }
.au-flip { animation: au-flip .7s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes au-flip { from { transform: rotateY(90deg) scale(.6); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .au-shake, .au-tremble, .au-rise, .au-stamp, .au-rays, .au-glow, .au-pop, .au-float, .au-pulse, .au-in, .au-slide, .au-flash, .au-gavel, .au-flip { animation: none !important; }
  .au-lid { transition: none; }
  .au-spark, .au-smoke { display: none; }
}
`;

export function AuStyles() {
  return (
    <style href="ruckus-auction" precedence="default">
      {CSS}
    </style>
  );
}
