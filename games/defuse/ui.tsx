"use client";

import { useTicker } from "@/components/game-ui";
import type { Player } from "@/shared/types";
import { GLYPHS, SWATCH } from "./shared";

export const CSS = `
.df-shake { animation: df-shake .45s cubic-bezier(.36,.07,.19,.97) both; }
@keyframes df-shake { 10%,90% { transform: translateX(-2px); } 20%,80% { transform: translateX(4px); } 30%,50%,70% { transform: translateX(-7px) rotate(-.6deg); } 40%,60% { transform: translateX(7px) rotate(.6deg); } }
.df-flash { animation: df-flash .6s ease-out both; }
@keyframes df-flash { from { opacity: .75; } to { opacity: 0; } }
.df-blink { animation: df-blink 1s steps(2, jump-none) infinite; }
@keyframes df-blink { 50% { opacity: .25; } }
.df-blink-fast { animation: df-blink .4s steps(2, jump-none) infinite; }
.df-glow { animation: df-glow 1.6s ease-in-out infinite; }
@keyframes df-glow { 0%,100% { filter: drop-shadow(0 0 2px var(--df-g)); } 50% { filter: drop-shadow(0 0 9px var(--df-g)); } }
.df-pop { animation: df-pop .4s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes df-pop { from { transform: scale(.3); opacity: 0; } }
.df-in { animation: df-in .45s cubic-bezier(.2,.8,.2,1) both; }
@keyframes df-in { from { opacity: 0; transform: translateY(8px) scale(.98); } }
.df-paper-in { animation: df-paper-in .5s cubic-bezier(.2,.9,.3,1.2) both; }
@keyframes df-paper-in { from { opacity: 0; transform: translateY(14px) rotate(-2.5deg); } }
.df-boom { animation: df-boom 1.1s cubic-bezier(.1,.8,.3,1) both; }
@keyframes df-boom { 0% { opacity: 0; transform: scale(.2); } 12% { opacity: 1; transform: scale(1.15); } 100% { opacity: 1; transform: scale(1); } }
.df-blast { animation: df-blast 1.2s ease-out both; }
@keyframes df-blast { 0% { opacity: 1; transform: scale(.2); } 100% { opacity: 0; transform: scale(2.6); } }
.df-smoke { animation: df-smoke 2.4s ease-out both; }
@keyframes df-smoke { from { opacity: .9; transform: translateY(0) scale(.6); } to { opacity: 0; transform: translateY(-60px) scale(1.6); } }
.df-cut-l { transition: transform .35s cubic-bezier(.2,1.4,.4,1); }
.df-ready { animation: df-ready 1.4s ease-in-out infinite; }
@keyframes df-ready { 0%,100% { box-shadow: 0 0 0 0 rgb(239 68 68 / .55); } 50% { box-shadow: 0 0 0 7px rgb(239 68 68 / 0); } }
@media (prefers-reduced-motion: reduce) {
  .df-shake, .df-boom, .df-blast, .df-smoke, .df-paper-in, .df-in, .df-pop, .df-ready { animation: df-fade .2s ease both; }
  .df-glow { animation: none; }
  @keyframes df-fade { from { opacity: 0; } }
}
`;

export function Styles() {
  return (
    <style href="ruckus-defuse" precedence="default">
      {CSS}
    </style>
  );
}

export function Glyph({ g, className = "size-6", stroke = 1.9 }: { g: number; className?: string; stroke?: number }) {
  const glyph = GLYPHS[g];
  if (!glyph) return null;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d={glyph.d} />
    </svg>
  );
}

export function Swatch({ c, className = "size-3" }: { c: string; className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-full border border-black/30 align-[-0.1em] ${className}`} style={{ background: SWATCH[c] ?? c }} />;
}

/** "Red", "Blue"… */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function fmtClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The bomb's countdown as a seven-segment-ish LCD. Re-renders itself only. */
export function Clock({
  live,
  explodeAt,
  rate,
  left,
  serverNow,
  size = "md",
}: {
  live: boolean;
  explodeAt: number;
  rate: number;
  left: number;
  serverNow: () => number;
  size?: "sm" | "md";
}) {
  useTicker(live ? 200 : 60_000);
  const ms = live ? Math.max(0, (explodeAt - serverNow()) * rate) : left;
  const low = live && ms < 30_000;
  return (
    <span
      role="timer"
      aria-label={`Bomb clock ${fmtClock(ms)}`}
      className={`inline-flex items-center rounded-md border border-black/60 bg-[#120708] font-mono font-bold tracking-wider tabular-nums shadow-[inset_0_2px_6px_rgb(0_0_0/.8)] ${
        size === "sm" ? "px-1.5 py-0.5 text-base" : "px-2.5 py-1 text-2xl sm:text-3xl"
      }`}
      style={{ color: "#ff3b3b", textShadow: "0 0 8px rgb(255 40 40 / .75)" }}
    >
      <span className={low ? "df-blink-fast" : undefined}>{fmtClock(ms)}</span>
      {rate > 1 && live && <span className="ml-1.5 text-[0.55em] text-amber-300">×{rate}</span>}
    </span>
  );
}

export function StrikeLeds({ strikes, max = 3 }: { strikes: number; max?: number }) {
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`${strikes} of ${max} strikes`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`grid size-5 place-items-center rounded-full border text-[10px] font-black ${i < strikes ? "df-pop border-red-300 bg-red-500 text-white shadow-[0_0_10px_#ef4444]" : "border-white/15 bg-black/40 text-white/20"}`}
        >
          ✕
        </span>
      ))}
    </span>
  );
}

export function Name({ p }: { p: Player | undefined }) {
  if (!p) return <>Someone</>;
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden>{p.avatar} </span>
      <span style={{ color: p.color }}>{p.name}</span>
    </span>
  );
}
