"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Player } from "@/shared/types";
import type { Choice, RoundRec } from "./shared";

/** Look up the player in a seat (with a stand-in for someone who left the room). */
export type Who = (seat: number) => Player;

export const SPLIT = "#4ade80";
export const STEAL = "#fb7185";
export const GOLD = "#fbbf24";
export const BUST = "#fb923c";

export const CHOICE_META: Record<Choice, { emoji: string; label: string; color: string; hint: string }> = {
  split: { emoji: "🤝", label: "Split", color: SPLIT, hint: "share the pot" },
  steal: { emoji: "🗡️", label: "Steal", color: STEAL, hint: "take it all" },
};

// Game-local animations, prefixed so they can't clash with other games.
// Everything animates transform/opacity only.
const CSS = `
.dc-in { animation: dc-in .35s cubic-bezier(.2,.8,.2,1) both; }
@keyframes dc-in { from { opacity: 0; transform: translateY(6px) scale(.985); } }
.dc-card { perspective: 900px; }
.dc-inner { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; }
.dc-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: inherit; overflow: hidden; }
.dc-front { transform: rotateY(180deg); }
.dc-flipped { transform: rotateY(180deg); animation: dc-flip .8s cubic-bezier(.3,1.3,.5,1) both; animation-delay: var(--d, 0ms); }
@keyframes dc-flip {
  0% { transform: rotateY(0) scale(1); }
  45% { transform: rotateY(100deg) scale(1.14); }
  100% { transform: rotateY(180deg) scale(1); }
}
.dc-wobble { animation: dc-wobble .42s ease-in-out infinite alternate; animation-delay: var(--d, 0ms); }
@keyframes dc-wobble { from { transform: rotate(-2.5deg) translateY(0); } to { transform: rotate(2.5deg) translateY(-4px); } }
.dc-back {
  background:
    radial-gradient(circle at 50% 50%, rgb(255 255 255 / .16) 0 22%, transparent 23%),
    repeating-linear-gradient(45deg, rgb(255 255 255 / .07) 0 6px, transparent 6px 12px),
    linear-gradient(160deg, var(--dc-a), #6d2639);
}
.dc-stamp { animation: dc-stamp .5s cubic-bezier(.2,1.6,.4,1) both; animation-delay: var(--d, 0ms); }
@keyframes dc-stamp { from { opacity: 0; transform: scale(2.8) rotate(-18deg); } to { opacity: 1; transform: scale(1) rotate(-7deg); } }
.dc-thud { animation: dc-thud .55s cubic-bezier(.36,.07,.19,.97) both; animation-delay: var(--d, 0ms); }
@keyframes dc-thud {
  0%, 100% { transform: none; }
  15% { transform: translate(-6px, 2px) rotate(-1.2deg); }
  30% { transform: translate(6px, -2px) rotate(1.2deg); }
  45% { transform: translate(-4px, 1px); }
  60% { transform: translate(4px, -1px); }
  75% { transform: translate(-2px, 0); }
}
.dc-float { animation: dc-float .6s cubic-bezier(.2,1.5,.4,1) both; animation-delay: var(--d, 0ms); }
@keyframes dc-float { from { opacity: 0; transform: translateY(10px) scale(.5); } }
.dc-pop { animation: dc-pop .45s cubic-bezier(.2,1.5,.4,1) both; animation-delay: var(--d, 0ms); }
@keyframes dc-pop { from { opacity: 0; transform: scale(.4); } }
.dc-fade { animation: dc-fade .3s ease both; animation-delay: var(--d, 0ms); }
@keyframes dc-fade { from { opacity: 0; } }
.dc-boom { animation: dc-boom 1s ease-out both; animation-delay: var(--d, 0ms); }
@keyframes dc-boom { 0% { opacity: 0; transform: scale(.3); } 25% { opacity: 1; transform: scale(1.5); } 100% { opacity: 0; transform: scale(2.4); } }
.dc-glow { animation: dc-glow 1.3s ease-in-out infinite; }
@keyframes dc-glow {
  0%, 100% { box-shadow: 0 0 0 1px var(--dc-c), 0 0 12px -2px var(--dc-c); }
  50% { box-shadow: 0 0 0 2px var(--dc-c), 0 0 28px 2px var(--dc-c); }
}
.dc-pending { animation: dc-pending 1s ease-in-out infinite; }
@keyframes dc-pending { 0%, 100% { opacity: .5; } 50% { opacity: .8; } }
.dc-drum { display: inline-block; animation: dc-drum .22s ease-in-out infinite alternate; }
@keyframes dc-drum { from { transform: translateY(0) rotate(-10deg); } to { transform: translateY(-3px) rotate(10deg); } }
.dc-spot { animation: dc-spot 1s ease-in-out infinite alternate; }
@keyframes dc-spot { from { opacity: .35; } to { opacity: .9; } }
.dc-dot { display: inline-block; animation: dc-dot 1.2s ease-in-out infinite; }
@keyframes dc-dot { 0%, 70%, 100% { opacity: .25; transform: none; } 35% { opacity: 1; transform: translateY(-2px); } }
.dc-hide { animation: dc-hide .01s linear both; animation-delay: var(--d, 0ms); }
@keyframes dc-hide { to { visibility: hidden; } }
.dc-scroll { scrollbar-width: thin; scrollbar-color: var(--color-line) transparent; overscroll-behavior: contain; }
@media (prefers-reduced-motion: reduce) {
  .dc-wobble, .dc-thud, .dc-glow, .dc-pending, .dc-drum, .dc-boom, .dc-spot, .dc-dot { animation: none; }
  .dc-glow { box-shadow: 0 0 0 2px var(--dc-c); }
  .dc-flipped { animation: none; transform: none; }
  .dc-flipped > .dc-back { animation: dc-hide .01s linear both; animation-delay: var(--d, 0ms); }
  .dc-flipped > .dc-front { transform: none; animation: dc-fade .25s ease both; animation-delay: var(--d, 0ms); }
  .dc-in, .dc-stamp, .dc-float, .dc-pop { animation: dc-fade .2s ease both; animation-delay: var(--d, 0ms); }
}
`;

export function DcStyles() {
  return (
    <style href="ruckus-doublecross" precedence="default">
      {CSS}
    </style>
  );
}

/** CSS custom properties without fighting the CSSProperties type. */
export const vars = (v: Record<string, string | number>) => v as CSSProperties;

/** Avatar + coloured name, inline. */
export function Name({ p, you }: { p: Player; you?: boolean }) {
  return (
    <>
      <span aria-hidden>{p.avatar} </span>
      <span style={{ color: p.color }}>{you ? "You" : p.name}</span>
    </>
  );
}

/** True once server time reaches `at` (null = never). Re-arms when `at` changes. */
export function useReached(at: number | null, serverNow: () => number): boolean {
  const [reached, setReached] = useState<number | null>(null);
  useEffect(() => {
    if (at === null) return;
    const id = window.setTimeout(() => setReached(at), Math.max(0, at - serverNow()));
    return () => window.clearTimeout(id);
  }, [at, serverNow]);
  return at !== null && reached === at;
}

/** One seat's choice in a past round, or null when they sat it out. */
export function choiceIn(rec: RoundRec, seat: number): { c: Choice; auto: boolean } | null {
  for (const t of rec.tables) {
    const i = t.seats.indexOf(seat);
    if (i >= 0) return { c: t.c[i], auto: t.auto[i] };
  }
  return null;
}

/** A row of 🤝/🗡️ chips, one per round (future rounds as faint dots). The heist slot is gold. */
export function RepRow({
  history,
  seat,
  rounds,
  size = "md",
  freshRound,
}: {
  history: RoundRec[];
  seat: number;
  rounds: number;
  size?: "sm" | "md";
  /** Pops the chip for this round in (it was just revealed). */
  freshRound?: number;
}) {
  const box = size === "sm" ? "size-5 text-[11px]" : "size-6 text-[13px]";
  const label = history
    .map((r) => {
      const ch = choiceIn(r, seat);
      return `round ${r.round}: ${ch ? (ch.auto ? "split (timed out)" : ch.c) : "sat out"}`;
    })
    .join(", ");
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={label ? `Record: ${label}` : "No record yet"}>
      {Array.from({ length: rounds }, (_, i) => {
        const rec = history.find((r) => r.round === i + 1);
        const heist = i === rounds - 1;
        const ch = rec ? choiceIn(rec, seat) : null;
        if (!rec) {
          return (
            <span
              key={i}
              aria-hidden
              className={`${box} grid shrink-0 place-items-center rounded-full border border-dashed`}
              style={{ borderColor: heist ? `${GOLD}66` : "var(--color-line)" }}
            >
              {heist && <span className="text-[9px] opacity-60">💰</span>}
            </span>
          );
        }
        if (!ch) {
          return (
            <span key={i} aria-hidden className={`${box} grid shrink-0 place-items-center rounded-full bg-panel-2 text-[10px] text-muted`}>
              –
            </span>
          );
        }
        const m = CHOICE_META[ch.c];
        return (
          <span
            key={i}
            aria-hidden
            title={`Round ${i + 1}: ${ch.auto ? "timed out (split)" : m.label}`}
            className={`${box} relative grid shrink-0 place-items-center rounded-full leading-none ${freshRound === i + 1 ? "dc-pop" : ""}`}
            style={{
              background: `${m.color}26`,
              boxShadow: `inset 0 0 0 1.5px ${heist ? GOLD : m.color}${ch.auto ? "55" : "aa"}`,
              opacity: ch.auto ? 0.6 : 1,
              ...(freshRound === i + 1 ? vars({ "--d": "150ms" }) : {}),
            }}
          >
            {m.emoji}
          </span>
        );
      })}
    </span>
  );
}

/** "split 3 of 4" style trust summary. */
export function trustLine(history: RoundRec[], seat: number): string {
  let splits = 0;
  let played = 0;
  for (const r of history) {
    const ch = choiceIn(r, seat);
    if (!ch) continue;
    played += 1;
    if (ch.c === "split") splits += 1;
  }
  if (!played) return "no record yet";
  if (splits === played) return played === 1 ? "split once" : `split all ${played}`;
  if (splits === 0) return played === 1 ? "stole once" : `stole all ${played}`;
  return `split ${splits} of ${played}`;
}

export function Coin({ v, className = "" }: { v: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-display font-extrabold tabular-nums ${className}`}
      style={{ background: `${GOLD}24`, color: GOLD, boxShadow: `inset 0 0 0 1px ${GOLD}55` }}
    >
      <span aria-hidden>💰</span>
      {v}
    </span>
  );
}

export function Card({ children, className = "", label, style }: { children: ReactNode; className?: string; label?: string; style?: CSSProperties }) {
  return (
    <section className={`card p-3 ${className}`} aria-label={label} style={style}>
      {children}
    </section>
  );
}

/** Animated "..." for someone who is still deciding. */
export function Dots() {
  return (
    <span aria-hidden>
      <span className="dc-dot">.</span>
      <span className="dc-dot" style={{ animationDelay: ".15s" }}>
        .
      </span>
      <span className="dc-dot" style={{ animationDelay: ".3s" }}>
        .
      </span>
    </span>
  );
}

export const medal = (rank: number) => ["🥇", "🥈", "🥉"][rank] ?? `${rank + 1}`;
