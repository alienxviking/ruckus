"use client";

import type { ReactNode } from "react";
import type { Player } from "@/shared/types";

/** Look up the player in a seat (with a stand-in for someone who left the room). */
export type Who = (seat: number) => Player;

export const DRAGON = "#ff6b3d";

// Game-local animations, prefixed so they can't clash with other games.
const CSS = `
.wl-in { animation: wl-in .35s cubic-bezier(.2,.8,.2,1) both; }
@keyframes wl-in { from { opacity: 0; transform: translateY(6px) scale(.985); } }
.wl-bar { transform-origin: left center; animation: wl-march .6s cubic-bezier(.2,.8,.2,1) both; }
@keyframes wl-march { from { transform: scaleX(0); } }
.wl-dragon { animation: wl-dragon .55s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes wl-dragon { from { opacity: 0; transform: scale(2.4) rotate(-14deg); } }
.wl-line { transform-origin: top; animation: wl-line .35s ease-out both; }
@keyframes wl-line { from { opacity: 0; transform: scaleY(0); } }
.wl-shake { animation: wl-shake .6s cubic-bezier(.36,.07,.19,.97) both; }
@keyframes wl-shake {
  0%, 100% { transform: none; }
  10% { transform: translate(-7px, 2px) rotate(-.6deg); }
  25% { transform: translate(7px, -2px) rotate(.6deg); }
  40% { transform: translate(-5px, 1px); }
  55% { transform: translate(5px, -1px); }
  70% { transform: translate(-3px, 0); }
  85% { transform: translate(2px, 0); }
}
.wl-crown { display: inline-block; animation: wl-crown .55s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes wl-crown { from { opacity: 0; transform: translateY(8px) rotate(-25deg) scale(.3); } }
.wl-float { animation: wl-float 1.3s ease-out both; }
@keyframes wl-float {
  0% { opacity: 0; transform: translateY(8px) scale(.7); }
  18% { opacity: 1; transform: translateY(0) scale(1.15); }
  70% { opacity: 1; transform: translateY(-9px) scale(1); }
  100% { opacity: 0; transform: translateY(-18px) scale(.9); }
}
.wl-pop { animation: wl-pop .45s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes wl-pop { from { opacity: 0; transform: scale(.4); } }
.wl-fadein { animation: wl-fadein .3s ease both; }
@keyframes wl-fadein { from { opacity: 0; } }
.wl-dim { animation: wl-dim .35s ease both; }
@keyframes wl-dim { from { opacity: 1; } to { opacity: .42; } }
.wl-glow { animation: wl-glow 1.4s ease-in-out infinite; }
@keyframes wl-glow { 0%, 100% { box-shadow: 0 0 0 1px var(--wl-c), 0 0 10px -2px var(--wl-c); } 50% { box-shadow: 0 0 0 1px var(--wl-c), 0 0 22px 2px var(--wl-c); } }
.wl-march { display: inline-block; animation: wl-step .5s ease-in-out infinite alternate; }
@keyframes wl-step { from { transform: translateY(0) rotate(-6deg); } to { transform: translateY(-3px) rotate(6deg); } }
.wl-num { -moz-appearance: textfield; appearance: textfield; }
.wl-num::-webkit-inner-spin-button, .wl-num::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.wl-range { -webkit-appearance: none; appearance: none; background: transparent; height: 2.5rem; width: 100%; cursor: pointer; touch-action: pan-y; }
.wl-range:disabled { cursor: default; }
.wl-range::-webkit-slider-runnable-track { height: .5rem; border-radius: 999px; background: linear-gradient(to right, var(--wl-c) var(--wl-p), var(--color-panel-2) var(--wl-p)); }
.wl-range::-moz-range-track { height: .5rem; border-radius: 999px; background: linear-gradient(to right, var(--wl-c) var(--wl-p), var(--color-panel-2) var(--wl-p)); }
.wl-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 1.35rem; height: 1.35rem; margin-top: -.43rem; border-radius: 999px; background: var(--color-text); border: 3px solid var(--wl-c); box-shadow: 0 2px 6px rgb(0 0 0 / .4); }
.wl-range::-moz-range-thumb { width: 1.05rem; height: 1.05rem; border-radius: 999px; background: var(--color-text); border: 3px solid var(--wl-c); }
.wl-range:disabled::-webkit-slider-thumb { opacity: 0; }
.wl-range:disabled::-moz-range-thumb { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .wl-shake, .wl-float, .wl-glow, .wl-march { animation: none; }
  .wl-glow { box-shadow: 0 0 0 1px var(--wl-c); }
  .wl-in, .wl-bar, .wl-dragon, .wl-crown, .wl-pop, .wl-line { animation: wl-fadein .2s ease both; }
}
`;

export function WlStyles() {
  return (
    <style href="ruckus-warlords" precedence="default">
      {CSS}
    </style>
  );
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** Avatar + coloured name, inline. */
export function Name({ p, you }: { p: Player; you?: boolean }) {
  return (
    <>
      <span aria-hidden>{p.avatar} </span>
      <span style={{ color: p.color }}>{you ? "You" : p.name}</span>
    </>
  );
}

/** Gold points pill. */
export function Pts({ v, accent, className = "" }: { v: number; accent: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 font-display font-extrabold tabular-nums ${className}`}
      style={{ background: `${accent}26`, color: accent }}
    >
      {v}
    </span>
  );
}

export function Card({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <section className={`card p-3 ${className}`} aria-label={label}>
      {children}
    </section>
  );
}

/** Medal for a 0-based rank (ties share). */
export const medal = (rank: number) => ["🥇", "🥈", "🥉"][rank] ?? `${rank + 1}`;

/** Competition ranks for scores in the given order (1,1,3...). */
export function ranks(scores: number[], order: number[]): Map<number, number> {
  const out = new Map<number, number>();
  order.forEach((seat, i) => {
    const prev = order[i - 1];
    out.set(seat, i > 0 && scores[prev] === scores[seat] ? out.get(prev)! : i);
  });
  return out;
}
