"use client";

import type { ReactNode } from "react";
import type { Player } from "@/shared/types";
import { PlayerChip, TimerBar, useSecondsLeft } from "@/components/game-ui";
import { STEP_ICON, stepKind } from "./shared";

// Game-local styles and animations, prefixed so they can't clash.
export const CSS = `
.gb-paper {
  background-color: #fffaf0;
  color: #2a2238;
  background-image: repeating-linear-gradient(to bottom, transparent 0 29px, rgb(110 90 160 / .13) 29px 30px);
  box-shadow: 0 12px 30px -14px rgb(0 0 0 / .7), inset 0 0 0 1px rgb(255 255 255 / .6);
}
.gb-sheet { box-shadow: 0 12px 30px -14px rgb(0 0 0 / .7); }
.gb-flip { transform-origin: left center; animation: gb-flip .6s cubic-bezier(.2,.8,.2,1) both; }
@keyframes gb-flip { from { opacity: 0; transform: perspective(1400px) rotateY(-42deg) translateX(28px) scale(.96); } }
.gb-slide { animation: gb-slide .45s cubic-bezier(.2,.8,.2,1) both; }
@keyframes gb-slide { from { opacity: 0; transform: translateY(14px) scale(.98); } }
.gb-word { display: inline-block; animation: gb-word .42s cubic-bezier(.2,1.3,.4,1) both; }
@keyframes gb-word { from { opacity: 0; transform: translateY(.45em) scale(.85); } }
.gb-float { position: absolute; bottom: 0; animation: gb-float 2.4s cubic-bezier(.2,.7,.3,1) forwards; }
@keyframes gb-float {
  0% { opacity: 0; transform: translate(-50%, 0) scale(.4); }
  12% { opacity: 1; transform: translate(-50%, -30px) scale(1.25); }
  75% { opacity: 1; }
  100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), var(--rise, -240px)) scale(1); }
}
.gb-bump { animation: gb-bump .4s cubic-bezier(.2,1.6,.4,1); }
@keyframes gb-bump { 40% { transform: scale(1.3); } }
.gb-urgent { animation: gb-urgent .9s ease-in-out infinite; }
@keyframes gb-urgent { 50% { opacity: .5; } }
.gb-book { display: inline-block; animation: gb-book .6s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes gb-book { from { opacity: 0; transform: rotate(-14deg) scale(.4); } }
.gb-stamp { animation: gb-stamp .45s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes gb-stamp { from { opacity: 0; transform: rotate(-18deg) scale(1.8); } }
.gb-dot { display: inline-block; animation: gb-dot 1.2s ease-in-out infinite; }
@keyframes gb-dot { 0%, 70%, 100% { opacity: .25; } 35% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .gb-flip, .gb-slide, .gb-word, .gb-book, .gb-stamp { animation: gb-fade .25s ease both; }
  .gb-float { animation: gb-fadeout 2s ease forwards; transform: translate(-50%, -90px); }
  .gb-bump, .gb-urgent, .gb-dot { animation: none; }
  @keyframes gb-fade { from { opacity: 0; } }
  @keyframes gb-fadeout { 0% { opacity: 0; } 15% { opacity: 1; } 75% { opacity: 1; } 100% { opacity: 0; } }
}
`;

/** A stand-in for someone who left the room entirely. */
export function who(byId: Record<string, Player>, id: string): Player {
  return byId[id] ?? { id, name: "Someone", color: "#a39dc8", avatar: "🙂", connected: false };
}

export function isTypingTarget(t: EventTarget | null) {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

export function Dots() {
  return (
    <span aria-hidden>
      <span className="gb-dot">.</span>
      <span className="gb-dot" style={{ animationDelay: ".15s" }}>
        .
      </span>
      <span className="gb-dot" style={{ animationDelay: ".3s" }}>
        .
      </span>
    </span>
  );
}

/** ✍️ → 🎨 → 💬 … with the current step lit up. */
export function StepTrack({ steps, step, accent }: { steps: number; step: number; accent: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <ol className="flex items-center" aria-label={`Step ${Math.min(step + 1, steps)} of ${steps}`}>
        {Array.from({ length: steps }, (_, i) => {
          const kind = stepKind(i);
          const past = i < step;
          const now = i === step;
          return (
            <li key={i} className="flex items-center" aria-current={now ? "step" : undefined}>
              {i > 0 && (
                <span
                  aria-hidden
                  className="h-0.5 w-2.5 rounded-full @sm:w-5"
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
                <span aria-hidden>{STEP_ICON[kind]}</span>
                {past && (
                  <span
                    aria-hidden
                    className="absolute -right-1 -bottom-1 grid size-3.5 place-items-center rounded-full text-[9px] font-black text-ink"
                    style={{ background: accent }}
                  >
                    ✓
                  </span>
                )}
                <span className="sr-only">
                  {kind === "write" ? "Write" : kind === "draw" ? "Draw" : "Describe"}
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
export function PhaseClock({
  endsAt,
  total,
  serverNow,
  accent,
  label,
}: {
  endsAt: number;
  total: number;
  serverNow: () => number;
  accent: string;
  label?: ReactNode;
}) {
  const secs = useSecondsLeft(endsAt, serverNow);
  const urgent = secs <= 10 && total > 12_000;
  return (
    <div className="flex items-center gap-2">
      {label && <span className="shrink-0 text-xs font-semibold text-muted">{label}</span>}
      <div className="min-w-0 flex-1">
        <TimerBar endsAt={endsAt} total={total} serverNow={serverNow} color={urgent ? "#f87171" : accent} />
      </div>
      <span
        className={`w-10 shrink-0 text-right font-mono text-sm font-bold tabular-nums ${urgent ? "gb-urgent text-red-300" : "text-muted"}`}
        aria-label={`${secs} seconds left`}
      >
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
      </span>
    </div>
  );
}

/** Who's done this step. */
export function Tracker({
  players,
  done,
  accent,
  label,
}: {
  players: Player[];
  done: string[];
  accent: string;
  label: string;
}) {
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
                  <span className="text-[10px] text-muted">offline</span>
                )}
              </PlayerChip>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Text that lands word by word (screen readers get it in one piece). */
export function LandingText({ text, className = "" }: { text: string; className?: string }) {
  const words = text.split(" ");
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((w, i) => (
          <span key={i}>
            <span className="gb-word" style={{ animationDelay: `${120 + i * 70}ms` }}>
              {w}
            </span>
            {i < words.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
    </span>
  );
}
