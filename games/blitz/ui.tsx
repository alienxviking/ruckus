"use client";

// Presentational building blocks for Blitz (no game logic here).

import { useEffect, useEffectEvent, type CSSProperties, type ReactNode } from "react";
import type { Player } from "@/shared/types";
import type { Expr } from "./shared";

export const GREEN = "#4ade80";
export const ROSE = "#fb7185";
export const GOLD = "#facc15";
export const MEDALS = ["🥇", "🥈", "🥉"] as const;
export const EASE_OUT = "cubic-bezier(.2,.8,.2,1)";
export const EASE_SPRING = "cubic-bezier(.2,1.4,.4,1)";

export const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

const CSS = `
.blz-root { -webkit-tap-highlight-color: transparent; }
.blz-fit { font-size: var(--fs); }
@keyframes blz-in { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes blz-tile { from { opacity: 0; transform: translateY(10px) scale(.88); } to { opacity: 1; transform: none; } }
@keyframes blz-pop { 0% { opacity: 0; transform: scale(.4); } 70% { opacity: 1; transform: scale(1.12); } 100% { transform: scale(1); } }
@keyframes blz-card { 0% { opacity: 0; transform: scale(.7) rotate(-4deg); } 60% { opacity: 1; transform: scale(1.04) rotate(1deg); } 100% { transform: none; } }
@keyframes blz-wiggle { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-12deg) scale(1.08); } 75% { transform: rotate(10deg) scale(1.08); } }
@keyframes blz-slide { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: none; } }
@keyframes blz-float { 0% { opacity: 0; transform: translateY(6px) scale(.7); } 20% { opacity: 1; transform: translateY(-6px) scale(1.15); } 75% { opacity: 1; transform: translateY(-18px); } 100% { opacity: 0; transform: translateY(-26px); } }
@keyframes blz-shake { 0%, 100% { transform: none; } 20%, 60% { transform: translateX(-6px); } 40%, 80% { transform: translateX(6px); } }
@keyframes blz-lock { 0% { transform: scale(1); } 35% { transform: scale(.92); } 70% { transform: scale(1.04); } 100% { transform: scale(1); } }
@keyframes blz-ring { from { opacity: .8; transform: scale(.9); } to { opacity: 0; transform: scale(1.5); } }
@keyframes blz-pulse { 50% { opacity: .5; } }
@keyframes blz-glow { 0%, 100% { box-shadow: 0 0 0 2px var(--c), 0 0 14px var(--c); } 50% { box-shadow: 0 0 0 3px var(--c), 0 0 26px var(--c); } }
@keyframes blz-count { 0% { transform: scale(1.7); opacity: 0; } 40% { opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
@keyframes blz-bar { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes blz-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@keyframes blz-spark { 0% { opacity: 1; transform: translate(-50%, -50%) scale(1); } 100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(.3); } }
@keyframes blz-squish { 0% { transform: scale(.9); } 100% { transform: scale(1); } }
.blz-in { animation: blz-in .35s ${EASE_OUT} both; }
.blz-tile { animation: blz-tile .38s ${EASE_SPRING} both; animation-delay: calc(var(--i, 0) * 18ms); }
.blz-pop { animation: blz-pop .45s ${EASE_SPRING} both; animation-delay: var(--d, 0ms); }
.blz-card { animation: blz-card .5s ${EASE_SPRING} both; }
.blz-wiggle { animation: blz-wiggle .7s ease-in-out .35s both; }
.blz-slide { animation: blz-slide .4s ${EASE_OUT} both; animation-delay: var(--d, 0ms); }
.blz-float { animation: blz-float 1.6s ${EASE_OUT} .15s both; }
.blz-shake { animation: blz-shake .4s ease both; }
.blz-lock { animation: blz-lock .35s ${EASE_SPRING} both; }
.blz-ring { animation: blz-ring .5s ${EASE_OUT} both; }
.blz-pulse { animation: blz-pulse 1s ease-in-out infinite; }
.blz-glow { animation: blz-glow 1.1s ease-in-out infinite; }
.blz-count { animation: blz-count .45s ${EASE_SPRING} both; }
.blz-bar { transform-origin: left; animation: blz-bar .5s ${EASE_OUT} both; animation-delay: var(--d, 0ms); }
.blz-drain { transform-origin: left; animation: blz-drain linear both; }
.blz-spark { animation: blz-spark .7s ease-out both; }
.blz-squish { animation: blz-squish .14s ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .blz-float, .blz-ring, .blz-spark { display: none; }
  .blz-in, .blz-tile, .blz-pop, .blz-card, .blz-wiggle, .blz-slide, .blz-shake, .blz-lock,
  .blz-pulse, .blz-glow, .blz-count, .blz-bar, .blz-squish { animation: none; }
}
`;

/** Keyframes for this game, hoisted and de-duplicated by React. */
export function BlitzStyles() {
  return (
    <style href="blitz-styles" precedence="medium">
      {CSS}
    </style>
  );
}

/** Someone who is no longer in the room still needs a face. */
export function personOf(byId: Record<string, Player>, id: string): Player {
  return byId[id] ?? { id, name: "Player", color: "#94a3b8", avatar: "❔", connected: false };
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Small round avatar with the player's colour ring. */
export function Face({ player, size = "sm", title = true }: { player: Player; size?: "xs" | "sm" | "md"; title?: boolean }) {
  const cls = size === "xs" ? "size-5 text-[11px]" : size === "sm" ? "size-6 text-[13px]" : "size-8 text-base";
  return (
    <span
      title={title ? player.name : undefined}
      className={`grid shrink-0 place-items-center rounded-full ${cls} ${player.connected ? "" : "opacity-50"}`}
      style={{ background: player.color + "33", boxShadow: `inset 0 0 0 1.5px ${player.color}` }}
    >
      <span aria-hidden>{player.avatar}</span>
    </span>
  );
}

/** A row of overlapping faces (who picked this). */
export function Faces({ people, max = 5 }: { people: Player[]; max?: number }) {
  if (!people.length) return null;
  const shown = people.slice(0, max);
  return (
    <span className="flex items-center -space-x-1.5" aria-label={people.map((p) => p.name).join(", ")}>
      {shown.map((p) => (
        <Face key={p.id} player={p} size="xs" />
      ))}
      {people.length > max && <span className="pl-2.5 text-[11px] font-bold text-muted">+{people.length - max}</span>}
    </span>
  );
}

/** An arrow drawn as SVG (emoji arrows render inconsistently). dir: 0 up, 1 right, 2 down, 3 left. */
export function ArrowIcon({
  dir,
  color = "currentColor",
  className = "size-6",
  stroke = 3.2,
}: {
  dir: number;
  color?: string;
  className?: string;
  stroke?: number;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden style={{ transform: `rotate(${dir * 90}deg)` }}>
      <path
        d="M12 20V5M5.5 11.5 12 5l6.5 6.5"
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Renders a "Bigger" expression: a stacked fraction, a power, or text. */
export function ExprView({ e }: { e: Expr }) {
  if (e.k === "frac") {
    return (
      <span className="inline-flex flex-col items-center leading-none tabular-nums" aria-label={`${e.n} over ${e.d}`}>
        <span aria-hidden>{e.n}</span>
        <span aria-hidden className="my-[0.08em] h-[0.09em] w-[1.5em] rounded-full bg-current" />
        <span aria-hidden>{e.d}</span>
      </span>
    );
  }
  if (e.k === "pow") {
    return (
      <span className="tabular-nums" aria-label={`${e.b} to the power ${e.e}`}>
        <span aria-hidden>{e.b}</span>
        <sup aria-hidden className="relative -top-[0.35em] align-baseline text-[0.55em]">
          {e.e}
        </sup>
      </span>
    );
  }
  return <span className="tabular-nums whitespace-nowrap">{e.s}</span>;
}

/** Inputs typed into the room chat (or any field) are never game keys. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/** When several copies of the game share a page (the dev simulator), the one touched last owns the keyboard. */
export const keyboard = { owner: null as string | null };

/**
 * Global key handler while `enabled`. Return true from `onKey` to claim the key
 * (preventDefault). Ignores typing, modifiers, and other copies of the game.
 */
export function useKeys(enabled: boolean, me: string, onKey: (e: KeyboardEvent) => boolean) {
  const handle = useEffectEvent(onKey);
  useEffect(() => {
    if (!enabled) return;
    const listener = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return;
      if (keyboard.owner !== null && keyboard.owner !== me) return;
      if (handle(e)) e.preventDefault();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [enabled, me]);
}

/** Digit keys 1-9 -> 0-8, anything else -> -1. */
export function digitOf(e: KeyboardEvent): number {
  if (e.repeat || e.key.length !== 1) return -1;
  const d = "123456789".indexOf(e.key);
  return d;
}

const ARROW_KEYS: Record<string, number> = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };
export function arrowOf(e: KeyboardEvent): number {
  if (e.repeat) return -1;
  return ARROW_KEYS[e.key] ?? -1;
}

export type Look = "open" | "plain" | "locked" | "faded" | "correct" | "wrong" | "dim";

/** Visual state of an answer button. */
export function lookOf(
  i: number,
  phase: "play" | "result",
  myPick: number | null,
  canAnswer: boolean,
  answer: number | null,
): Look {
  if (phase === "result") {
    if (i === answer) return "correct";
    return i === myPick ? "wrong" : "dim";
  }
  if (myPick !== null) return i === myPick ? "locked" : "faded";
  return canAnswer ? "open" : "plain";
}

const LOOK_CLASS: Record<Look, string> = {
  open: "cursor-pointer hover:-translate-y-0.5 hover:brightness-125 active:translate-y-0 active:scale-[0.97]",
  plain: "",
  locked: "blz-lock",
  faded: "opacity-40",
  correct: "blz-pop",
  wrong: "blz-shake",
  dim: "opacity-45",
};

/**
 * A big answer button with a number key hint. Colour is never the only cue:
 * correct/wrong also get a ✓/✗ mark and the locked one says "you".
 */
export function ChoiceButton({
  index,
  look,
  color,
  onPick,
  hint,
  pickers,
  children,
  label,
  className = "",
}: {
  index: number;
  look: Look;
  color: string;
  onPick: (i: number) => void;
  hint?: string;
  pickers?: Player[];
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const live = look === "open";
  const border = look === "correct" ? GREEN : look === "wrong" ? ROSE : look === "locked" ? color : "var(--color-line)";
  const bg =
    look === "correct"
      ? GREEN + "26"
      : look === "wrong"
        ? ROSE + "22"
        : look === "locked"
          ? color + "2b"
          : "var(--color-panel-2)";
  return (
    <button
      type="button"
      data-choice={index}
      disabled={!live}
      aria-label={label}
      aria-keyshortcuts={live && hint ? hint : undefined}
      onClick={() => onPick(index)}
      className={`relative flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 px-3 py-2 font-display font-extrabold transition-[transform,filter,opacity] duration-150 disabled:cursor-default ${LOOK_CLASS[look]} ${className}`}
      style={{ borderColor: border, background: bg }}
    >
      {hint && (
        <span
          aria-hidden
          className="absolute top-1.5 left-2 grid size-5 place-items-center rounded-md bg-ink/60 font-mono text-[11px] font-bold text-muted"
        >
          {hint}
        </span>
      )}
      {children}
      {look === "correct" && (
        <span aria-hidden className="absolute top-1 right-2 text-sm font-black" style={{ color: GREEN }}>
          ✓
        </span>
      )}
      {look === "wrong" && (
        <span aria-hidden className="absolute top-1 right-2 text-sm font-black" style={{ color: ROSE }}>
          ✗
        </span>
      )}
      {look === "locked" && (
        <span aria-hidden className="absolute top-1 right-2 text-[10px] font-bold tracking-wide uppercase" style={{ color }}>
          you
        </span>
      )}
      {pickers && pickers.length > 0 && (
        <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2">
          <Faces people={pickers} max={4} />
        </span>
      )}
    </button>
  );
}

const SPARKS = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2;
  return { dx: `${Math.round(Math.cos(a) * 70)}px`, dy: `${Math.round(Math.sin(a) * 52)}px` };
});

/** A burst of little sparks around a point (celebrations). */
export function Sparks({ color }: { color: string }) {
  return (
    <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2">
      {SPARKS.map((s, i) => (
        <span
          key={i}
          className="blz-spark absolute size-2 rounded-full"
          style={{
            ...cssVars({ "--dx": s.dx, "--dy": s.dy }),
            background: i % 2 ? color : GOLD,
            animationDelay: `${(i % 3) * 40}ms`,
          }}
        />
      ))}
    </span>
  );
}
