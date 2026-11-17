"use client";

import type { ReactNode } from "react";
import type { Player } from "@/shared/types";
import { PlayerChip, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { MashupView } from "./server";
import { PART_ICON } from "./shared";

// Game-local styles and animations, prefixed so they can't clash.
export const CSS = `
.mm-hatch {
  background: repeating-linear-gradient(135deg, rgb(148 163 184 / .16) 0 6px, transparent 6px 12px), rgb(255 255 255 / .35);
  border-bottom: 2px dashed var(--mm-accent);
}
.mm-in-0 { animation: mm-in-0 .7s cubic-bezier(.2,1.25,.4,1) both; }
.mm-in-1 { animation: mm-in-1 .55s cubic-bezier(.2,1.4,.4,1) .15s both; }
.mm-in-2 { animation: mm-in-2 .7s cubic-bezier(.2,1.25,.4,1) .3s both; }
@keyframes mm-in-0 { from { opacity: 0; transform: translateY(-70%) rotate(-6deg); } }
@keyframes mm-in-1 { from { opacity: 0; transform: scale(.6); } }
@keyframes mm-in-2 { from { opacity: 0; transform: translateY(70%) rotate(5deg); } }
.mm-wobble { animation: mm-wobble 2.6s ease-in-out 1.1s infinite; transform-origin: 50% 100%; }
@keyframes mm-wobble { 0%, 100% { transform: rotate(0deg); } 25% { transform: rotate(-1.6deg); } 75% { transform: rotate(1.6deg); } }
.mm-rise { animation: mm-rise .45s cubic-bezier(.2,.8,.2,1) both; }
@keyframes mm-rise { from { opacity: 0; transform: translateY(14px) scale(.97); } }
.mm-name { display: inline-block; animation: mm-name .5s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes mm-name { from { opacity: 0; transform: translateY(.5em) scale(.8) rotate(-3deg); } }
.mm-stamp { animation: mm-stamp .45s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes mm-stamp { from { opacity: 0; transform: rotate(-18deg) scale(1.8); } }
.mm-urgent { animation: mm-urgent .9s ease-in-out infinite; }
@keyframes mm-urgent { 50% { opacity: .5; } }
.mm-dot { display: inline-block; animation: mm-dot 1.2s ease-in-out infinite; }
@keyframes mm-dot { 0%, 70%, 100% { opacity: .25; } 35% { opacity: 1; } }
.mm-crown { display: inline-block; animation: mm-crown 1.4s ease-in-out infinite; }
@keyframes mm-crown { 50% { transform: translateY(-4px) rotate(6deg); } }
.mm-lab { display: inline-block; animation: mm-lab 1.8s ease-in-out infinite; }
@keyframes mm-lab { 50% { transform: rotate(-12deg) scale(1.08); } }
@media (prefers-reduced-motion: reduce) {
  .mm-in-0, .mm-in-1, .mm-in-2, .mm-rise, .mm-name, .mm-stamp { animation: mm-fade .3s ease both; }
  .mm-wobble, .mm-urgent, .mm-dot, .mm-crown, .mm-lab { animation: none; }
  @keyframes mm-fade { from { opacity: 0; } }
}
`;

/** A stand-in for someone who left the room entirely. */
export function who(byId: Record<string, Player>, id: string | null | undefined): Player {
  return (id && byId[id]) || { id: id ?? "?", name: "Someone", color: "#a39dc8", avatar: "🙂", connected: false };
}

export function Dots() {
  return (
    <span aria-hidden>
      <span className="mm-dot">.</span>
      <span className="mm-dot" style={{ animationDelay: ".15s" }}>
        .
      </span>
      <span className="mm-dot" style={{ animationDelay: ".3s" }}>
        .
      </span>
    </span>
  );
}

const STEPS = [
  { icon: PART_ICON[0], name: "Head" },
  { icon: PART_ICON[1], name: "Body" },
  { icon: PART_ICON[2], name: "Legs" },
  { icon: "🏷️", name: "Name" },
  { icon: "🎭", name: "Reveal" },
  { icon: "⭐", name: "Vote" },
];

function stepIndex(v: MashupView): number {
  switch (v.phase) {
    case "draw":
      return v.stage;
    case "name":
      return 3;
    case "reveal":
      return 4;
    case "vote":
      return 5;
    default:
      return 6;
  }
}

/** Round x/y · 👹 → 👕 → 🦵 → 🏷️ → 🎭 → ⭐ with the current step lit up. */
export function StageTrack({ view, accent }: { view: MashupView; accent: string }) {
  const step = stepIndex(view);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
      <span className="label">
        Round {view.round + 1}/{view.rounds}
      </span>
      <ol className="flex items-center" aria-label={`Step ${Math.min(step + 1, STEPS.length)} of ${STEPS.length}`}>
        {STEPS.map((s, i) => {
          const past = i < step;
          const now = i === step;
          return (
            <li key={s.name} className="flex items-center" aria-current={now ? "step" : undefined}>
              {i > 0 && (
                <span
                  aria-hidden
                  className="h-0.5 w-2 rounded-full @sm:w-4"
                  style={{ background: past || now ? accent : "var(--color-line)", transition: "background-color .4s" }}
                />
              )}
              <span
                className={`relative grid place-items-center rounded-full border text-sm leading-none transition-all duration-300 ${
                  now ? "size-9 text-base" : "size-7"
                } ${past || now ? "" : "opacity-45 grayscale"}`}
                style={{
                  borderColor: now ? accent : past ? `${accent}88` : "var(--color-line)",
                  background: now ? `${accent}2a` : "var(--color-panel)",
                  boxShadow: now ? `0 0 0 3px ${accent}22, 0 0 18px ${accent}44` : undefined,
                }}
              >
                <span aria-hidden>{s.icon}</span>
                <span className="sr-only">
                  {s.name}
                  {past ? " (done)" : now ? " (now)" : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Timer bar plus seconds left; turns red near the end. */
export function PhaseClock({ endsAt, total, serverNow, accent }: { endsAt: number; total: number; serverNow: () => number; accent: string }) {
  const secs = useSecondsLeft(endsAt, serverNow);
  const urgent = secs <= 10 && total > 12_000;
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <TimerBar endsAt={endsAt} total={total} serverNow={serverNow} color={urgent ? "#f87171" : accent} />
      </div>
      <span
        className={`w-10 shrink-0 text-right font-mono text-sm font-bold tabular-nums ${urgent ? "mm-urgent text-red-300" : "text-muted"}`}
        aria-label={`${secs} seconds left`}
      >
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
      </span>
    </div>
  );
}

/** Who's done this step. */
export function Tracker({ players, done, accent, label }: { players: Player[]; done: string[]; accent: string; label: string }) {
  const doneSet = new Set(done);
  return (
    <section aria-label={label} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="label">{label}</h3>
        <span className="text-xs text-muted tabular-nums">
          {players.filter((p) => doneSet.has(p.id)).length}/{players.length}
        </span>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {players.map((p) => {
          const ok = doneSet.has(p.id);
          return (
            <li key={p.id} className={`max-w-full min-w-0 transition-opacity ${ok ? "" : "opacity-75"}`}>
              <PlayerChip player={p} size="sm" dim={!p.connected}>
                {ok ? (
                  <span className="animate-pop font-black" style={{ color: accent }}>
                    ✓<span className="sr-only"> done</span>
                  </span>
                ) : p.connected ? (
                  <span className="text-muted">
                    <Dots />
                    <span className="sr-only"> still working</span>
                  </span>
                ) : (
                  <span className="text-xs text-muted">offline</span>
                )}
              </PlayerChip>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "👹 Asha · 👕 Bo · 🦵 Chen": who drew which part. */
export function Credits({ creators, byId, size = "sm" }: { creators: string[]; byId: Record<string, Player>; size?: "sm" | "md" }) {
  return (
    <ul className="flex flex-wrap justify-center gap-1" aria-label="Drawn by">
      {creators.map((id, k) => (
        <li key={k} className="flex min-w-0 items-center gap-0.5">
          <span aria-hidden className={size === "sm" ? "text-xs" : "text-sm"}>
            {PART_ICON[k]}
          </span>
          <span className="sr-only">{["Head", "Body", "Legs"][k]} by</span>
          <PlayerChip player={who(byId, id)} size="sm" />
        </li>
      ))}
    </ul>
  );
}

export function Card({ children, className = "", accent }: { children: ReactNode; className?: string; accent?: string }) {
  return (
    <div className={`card ${className}`} style={accent ? { borderColor: `${accent}55` } : undefined}>
      {children}
    </div>
  );
}
