"use client";

// Presentational pieces for Trivia Rush (no game logic here).

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { Player } from "@/shared/types";
import { CATEGORY_EMOJI, LETTERS, fmt, type Category, type Difficulty } from "./shared";
import { Avatar } from "@/components/Avatar";

/** Answer colours. Always paired with a letter so colour is never the only cue. */
export const ANSWER_COLORS = ["#f43f5e", "#3b82f6", "#f59e0b", "#10b981"] as const;

export const MEDALS = ["🥇", "🥈", "🥉"] as const;

export const cssVars = (vars: Record<string, string>) => vars as CSSProperties;

export function seconds(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? "–" : `${(ms / 1000).toFixed(1)}s`;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Someone who is no longer in the room still needs a face. */
export function personOf(byId: Record<string, Player>, id: string): Player {
  return byId[id] ?? { id, name: "Player", color: "#94a3b8", avatar: "❔", connected: false };
}

/** One set of curves for the whole game: a calm ease-out for movement, a springy one for pops. */
export const EASE_OUT = "cubic-bezier(.2,.8,.2,1)";
export const EASE_SPRING = "cubic-bezier(.2,1.4,.4,1)";

/** False when the viewer asked for reduced motion (checked at animation time, never during render). */
export function motionOK(): boolean {
  return typeof window !== "undefined" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const CSS = `
@keyframes trv-enter {
  from { opacity: 0; transform: translateY(14px) scale(.985); }
  to { opacity: 1; transform: none; }
}
@keyframes trv-tile-in {
  from { opacity: 0; transform: translateY(14px) scale(.9); }
  to { opacity: 1; transform: none; }
}
@keyframes trv-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes trv-swap {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
@keyframes trv-pop {
  from { opacity: 0; transform: scale(.5); }
  to { opacity: 1; transform: none; }
}
@keyframes trv-lock {
  0% { transform: scale(1); }
  30% { transform: scale(.93); }
  65% { transform: scale(1.035); }
  100% { transform: scale(1); }
}
@keyframes trv-ring {
  from { opacity: .9; transform: scale(1); }
  to { opacity: 0; transform: scale(1.12, 1.28); }
}
@keyframes trv-correct {
  0% { transform: scale(1); }
  35% { transform: scale(1.07); }
  65% { transform: scale(.99); }
  100% { transform: scale(1.03); }
}
@keyframes trv-halo {
  0% { opacity: 0; }
  25% { opacity: 1; }
  50% { opacity: .45; }
  75% { opacity: 1; }
  100% { opacity: .75; }
}
@keyframes trv-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-5px); }
  40%, 80% { transform: translateX(5px); }
}
@keyframes trv-float {
  0% { opacity: 0; transform: translate(-50%, 8px) scale(.7); }
  18% { opacity: 1; transform: translate(-50%, -10px) scale(1.15); }
  70% { opacity: 1; transform: translate(-50%, -34px) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -50px) scale(.95); }
}
@keyframes trv-count {
  0% { transform: scale(1.6); opacity: 0; }
  40% { opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes trv-pulse { 50% { opacity: .45; } }
@keyframes trv-spark {
  0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(.3); }
}
@keyframes trv-bar { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.trv-enter { animation: trv-enter .4s ${EASE_OUT} both; }
.trv-tile-in { animation: trv-tile-in .45s ${EASE_SPRING} both; animation-delay: calc(80ms + var(--i, 0) * 60ms); }
.trv-fade { animation: trv-fade .3s ease both; }
.trv-swap { animation: trv-swap .28s ${EASE_OUT} both; }
.trv-rise { animation: trv-swap .4s ${EASE_OUT} both; animation-delay: var(--d, 0ms); }
.trv-pop { animation: trv-pop .3s ${EASE_SPRING} both; animation-delay: var(--d, 0ms); }
.trv-lock { animation: trv-lock .42s ${EASE_SPRING} both; }
.trv-ring { animation: trv-ring .6s ${EASE_OUT} both; }
.trv-correct { animation: trv-correct .6s ${EASE_SPRING} both; }
.trv-halo { opacity: .75; animation: trv-halo 1.6s ease-in-out .1s both; }
.trv-shake { animation: trv-shake .42s ease .05s both; }
.trv-float { animation: trv-float 1.8s ${EASE_OUT} .25s both; }
.trv-count { animation: trv-count .45s ${EASE_SPRING} both; }
.trv-pulse { animation: trv-pulse .9s ease-in-out infinite; }
.trv-spark { animation: trv-spark .85s ease-out .15s both; }
.trv-bar { transform-origin: bottom; animation: trv-bar .6s ${EASE_OUT} both; }
@media (prefers-reduced-motion: reduce) {
  .trv-float, .trv-spark, .trv-ring { display: none; }
  .trv-enter, .trv-tile-in, .trv-fade, .trv-swap, .trv-rise, .trv-pop, .trv-lock, .trv-correct,
  .trv-halo, .trv-shake, .trv-count, .trv-pulse, .trv-bar { animation: none; }
}
`;

/** Keyframes for this game, hoisted and de-duplicated by React. */
export function TriviaStyles() {
  return (
    <style href="trivia-rush-styles" precedence="medium">
      {CSS}
    </style>
  );
}

export function CategoryChip({ cat, accent }: { cat: Category; accent: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold"
      style={{ borderColor: accent + "66", background: accent + "1a", color: accent }}
    >
      <span aria-hidden>{CATEGORY_EMOJI[cat]}</span>
      {cat}
    </span>
  );
}

const DIFF_DOTS: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };

export function DiffPill({ diff }: { diff: Difficulty }) {
  const n = DIFF_DOTS[diff];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-panel-2 px-2 py-1 text-[11px] font-semibold text-muted capitalize">
      <span aria-hidden className="flex gap-0.5">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`size-1.5 rounded-full ${i <= n ? "bg-text" : "bg-line"}`} />
        ))}
      </span>
      {diff}
    </span>
  );
}

/** Small round avatar with the player's colour ring. */
export function Face({ player, size = "sm" }: { player: Player; size?: "sm" | "md" }) {
  return (
    <span
      title={player.name}
      className={`grid shrink-0 place-items-center rounded-full ${size === "sm" ? "size-6 text-[13px]" : "size-8 text-base"} ${
        player.connected ? "" : "opacity-50"
      }`}
      style={{ background: player.color + "33", boxShadow: `inset 0 0 0 1.5px ${player.color}` }}
    >
      <span aria-hidden><Avatar id={player.avatar} /></span>
    </span>
  );
}

const SPARKS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2 + 0.3;
  return { dx: `${Math.round(Math.cos(a) * 54)}px`, dy: `${Math.round(Math.sin(a) * 40)}px` };
});

export type AnswerLook = "open" | "plain" | "locked" | "faded" | "correct" | "wrong";

const GREEN = "#4ade80";
const ROSE = "#fb7185";

/** Per-look movement. Only transform/opacity animate; the springy ones play once when the look changes. */
const MOTION: Record<AnswerLook, string> = {
  open: "cursor-pointer hover:-translate-y-0.5 hover:brightness-125 active:translate-y-0 active:scale-[0.98]",
  plain: "",
  locked: "trv-lock",
  faded: "opacity-40",
  correct: "trv-correct",
  wrong: "scale-[0.97]",
};

/**
 * One of the four answer tiles. Sizes follow the width of the answers grid (a
 * named `answers` container), so long words fit on phones and in side-by-side layouts.
 *
 * The fill lives on two stacked layers (soft and strong) that cross-fade, so
 * locking in, fading out and the reveal glide instead of snapping between gradients.
 */
export function AnswerButton({
  index,
  text,
  look,
  mine,
  pickers,
  points,
  accent,
  onPick,
}: {
  index: number;
  text: string;
  look: AnswerLook;
  /** The viewer picked this one (reveal). */
  mine: boolean;
  pickers: Player[];
  /** Points the viewer gained on this answer (reveal, own correct pick). */
  points: number;
  accent: string;
  onPick: (i: number) => void;
}) {
  const color = ANSWER_COLORS[index];
  const letter = LETTERS[index];
  const revealing = look === "correct" || look === "wrong";
  const dim = look === "wrong";
  const strong = look === "locked" || look === "correct";
  const names = pickers.map((p) => p.name).join(", ");
  const label = revealing
    ? `${letter}: ${text}${look === "correct" ? " (correct answer)" : ""}${mine ? " (your pick)" : ""}${
        pickers.length ? `, picked by ${names}` : ", nobody picked this"
      }`
    : `Answer ${letter}: ${text}${look === "locked" ? " (locked in)" : ""}`;

  const style: CSSProperties = {
    borderColor: strong ? color : color + (dim ? (mine ? "66" : "26") : "66"),
    background: `${color}0a`,
    boxShadow: look === "locked" ? `0 0 0 3px ${color}55, 0 8px 24px -10px ${color}` : undefined,
  };

  const badge =
    look === "locked"
      ? { icon: "🔒", cls: "bg-panel-2 text-[11px]" }
      : look === "correct"
        ? { icon: "✓", cls: "bg-green-400 text-ink" }
        : look === "wrong" && mine
          ? { icon: "✗", cls: "bg-rose-500 text-ink" }
          : null;

  return (
    <button
      type="button"
      aria-label={label}
      disabled={look !== "open"}
      onClick={() => onPick(index)}
      className={`relative isolate flex min-h-[4.75rem] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 px-2.5 pt-5 pb-2.5 text-center outline-none transition-[opacity,translate,scale,border-color,filter] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-[opacity,border-color] focus-visible:ring-4 focus-visible:ring-white/70 @lg/answers:min-h-[5.25rem] @lg/answers:items-stretch @lg/answers:py-2 @lg/answers:pr-9 @lg/answers:pl-3.5 @lg/answers:text-left ${
        dim && mine ? "trv-shake" : MOTION[look]
      }`}
      style={style}
    >
      {/* Fill layers (behind the content, inside the tile's own stacking context): soft (open / faded) and
          strong (locked / correct); a wrong tile keeps only the base tint. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-[14px] transition-opacity duration-300"
        style={{ background: `linear-gradient(160deg, ${color}29, ${color}0f)`, opacity: strong || revealing ? 0 : 1 }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-[14px] transition-opacity duration-300"
        style={{ background: `linear-gradient(160deg, ${color}4d, ${color}26)`, opacity: strong ? 1 : 0 }}
      />
      {look === "locked" && (
        <span
          aria-hidden
          className="trv-ring pointer-events-none absolute -inset-[2px] rounded-2xl border-2"
          style={{ borderColor: color }}
        />
      )}
      {look === "correct" && (
        <span
          aria-hidden
          className="trv-halo pointer-events-none absolute -inset-[2px] rounded-2xl"
          style={{ boxShadow: `0 0 0 3px ${GREEN}, 0 0 30px 2px ${GREEN}88` }}
        />
      )}

      <span className="flex w-full items-center justify-center gap-3 @lg/answers:justify-start">
        {/* Narrow tiles: the letter is a tab on the corner so words get the full width
            (the tile's top padding keeps the first line clear of the corner badges). */}
        <span
          aria-hidden
          className={`absolute -top-2 left-2 z-[1] grid size-6 shrink-0 place-items-center rounded-full font-display text-sm font-black text-ink shadow-md ring-2 ring-ink transition-opacity duration-300 @lg/answers:static @lg/answers:size-9 @lg/answers:rounded-lg @lg/answers:text-lg @lg/answers:shadow-none @lg/answers:ring-0 ${
            dim ? "opacity-40" : ""
          }`}
          style={{ background: color }}
        >
          {letter}
        </span>
        <span
          className={`min-w-0 text-[0.95rem] leading-tight font-semibold [overflow-wrap:break-word] hyphens-auto transition-colors duration-300 @lg/answers:flex-1 @lg/answers:text-lg ${
            dim ? "text-text/45" : ""
          }`}
        >
          {text}
        </span>
      </span>
      {revealing && pickers.length > 0 && (
        <span
          aria-hidden
          className="flex flex-wrap items-center justify-center gap-1 @lg/answers:justify-start @lg/answers:pl-12"
        >
          {pickers.slice(0, 6).map((p, j) => (
            <span key={p.id} className="trv-pop" style={cssVars({ "--d": `${180 + j * 45}ms` })}>
              <Face player={p} />
            </span>
          ))}
          {pickers.length > 6 && (
            <span className="trv-pop text-xs font-bold text-muted" style={cssVars({ "--d": "450ms" })}>
              +{pickers.length - 6}
            </span>
          )}
        </span>
      )}
      {badge && (
        <span
          aria-hidden
          className={`trv-pop absolute -top-2 right-2 z-[1] grid size-6 place-items-center rounded-full text-sm font-black shadow-md ring-2 ring-ink ${badge.cls}`}
        >
          {badge.icon}
        </span>
      )}
      {revealing && mine && (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-2.5 z-[2] flex justify-center">
          <span
            className="trv-pop rounded-full px-2 text-[10px] leading-4 font-black tracking-wider text-ink uppercase shadow-md ring-2 ring-ink"
            style={{ background: look === "correct" ? GREEN : ROSE, ...cssVars({ "--d": "120ms" }) }}
          >
            Your pick
          </span>
        </span>
      )}
      {look === "correct" && mine && points > 0 && (
        <>
          {SPARKS.map((sp, i) => (
            <span
              key={i}
              aria-hidden
              className="trv-spark pointer-events-none absolute top-1/2 left-1/2 text-sm"
              style={{ color: i % 2 ? accent : GREEN, ...cssVars({ "--dx": sp.dx, "--dy": sp.dy }) }}
            >
              ✦
            </span>
          ))}
          <span
            aria-hidden
            className="trv-float pointer-events-none absolute top-0 left-1/2 z-10 rounded-full px-3 py-0.5 font-display text-xl font-black whitespace-nowrap shadow-lg shadow-black/40"
            style={{ background: accent, color: "#1d1604" }}
          >
            +{fmt(points)}
          </span>
        </>
      )}
    </button>
  );
}

/**
 * A number that counts from `from` to `value` (ease-out) after `delay` ms.
 * It edits its own text node from an effect, so the per-frame updates never
 * re-render React; with reduced motion it shows the final value straight away.
 */
export function CountUp({
  value,
  from,
  delay = 0,
  duration = 700,
  className,
  style,
}: {
  value: number;
  from: number;
  delay?: number;
  duration?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE || from === value || !motionOK()) return;
    const show = (n: number) => {
      const t = fmt(n);
      if (node.nodeValue !== t) node.nodeValue = t;
    };
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
  }, [value, from, delay, duration]);
  return (
    <span ref={ref} className={className} style={style}>
      {fmt(value)}
    </span>
  );
}

export function RankDelta({ delta, show, delay = 0 }: { delta: number; show: boolean; delay?: number }) {
  if (!show || delta === 0) {
    return (
      <span className="w-7 shrink-0 text-center text-xs text-muted" aria-hidden>
        ·
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={`trv-pop w-7 shrink-0 text-center font-mono text-[11px] font-bold ${up ? "text-green-300" : "text-rose-300"}`}
      style={cssVars({ "--d": `${delay}ms` })}
    >
      <span aria-hidden>
        {up ? "▲" : "▼"}
        {Math.abs(delta)}
      </span>
      <span className="sr-only">{up ? `up ${delta}` : `down ${-delta}`}</span>
    </span>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="label">{children}</span>
      {aside && <span className="text-xs text-muted">{aside}</span>}
    </div>
  );
}
