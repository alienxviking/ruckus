"use client";

// Presentational pieces for Odd One Out. Pure UI: everything arrives via props.

import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PlayerChip } from "@/components/game-ui";
import type { Player } from "@/shared/types";
import type { ClueEntry, ImpostorAction, ImpostorView, RoundSummary } from "./server";
import { LAPS, POINTS } from "./shared";
import { Avatar } from "@/components/Avatar";

// Game-scoped keyframes (hoisted and de-duplicated by React). One easing family for the
// whole game: entrances use cubic-bezier(.2,.8,.2,1), playful pops the overshooting
// cubic-bezier(.2,1.4,.4,1). Only transform and opacity animate.
// Reduced motion: shakes, wobbles and pulses stop; staged entrances (the reveal) keep
// their timing but become short opacity fades, so nothing is ever left hidden.
const CSS = `
@keyframes oo-shake { 0%,100% { transform: none } 20% { transform: translateX(-6px) } 40% { transform: translateX(5px) } 60% { transform: translateX(-3px) } 80% { transform: translateX(2px) } }
@keyframes oo-shake-b { 0%,100% { transform: none } 20% { transform: translateX(-6px) } 40% { transform: translateX(5px) } 60% { transform: translateX(-3px) } 80% { transform: translateX(2px) } }
.oo-shake-0 { animation: oo-shake .32s ease both }
.oo-shake-1 { animation: oo-shake-b .32s ease both }
@keyframes oo-dot { 0%, 80%, 100% { opacity: .25; transform: none } 40% { opacity: 1; transform: translateY(-2px) } }
.oo-dot { animation: oo-dot 1.1s ease-in-out infinite both }
.oo-dot:nth-child(2) { animation-delay: .15s }
.oo-dot:nth-child(3) { animation-delay: .3s }
@keyframes oo-ring { 0% { box-shadow: 0 0 0 0 var(--oo-ring) } 70% { box-shadow: 0 0 0 7px transparent } 100% { box-shadow: 0 0 0 0 transparent } }
.oo-pulse { animation: oo-ring 1.5s ease-out infinite }
@keyframes oo-enter { from { transform: translateY(10px); opacity: 0 } to { transform: none; opacity: 1 } }
.oo-enter { animation: oo-enter .32s cubic-bezier(.2,.8,.2,1) both }
@keyframes oo-rise { from { transform: translateY(8px); opacity: 0 } to { transform: none; opacity: 1 } }
.oo-rise { animation: oo-rise .34s cubic-bezier(.2,.8,.2,1) both }
@keyframes oo-pop { from { transform: scale(.6); opacity: 0 } to { transform: none; opacity: 1 } }
.oo-pop { animation: oo-pop .42s cubic-bezier(.2,1.4,.4,1) both }
@keyframes oo-flip { from { transform: perspective(500px) rotateX(88deg); opacity: 0 } 55% { opacity: 1 } to { transform: none; opacity: 1 } }
.oo-flip { animation: oo-flip .6s cubic-bezier(.2,1.25,.4,1) both }
@keyframes oo-grow { from { transform: scaleX(0) } to { transform: none } }
.oo-grow { transform-origin: left center; animation: oo-grow .7s cubic-bezier(.2,.8,.2,1) both }
@keyframes oo-wobble { from { transform: rotate(-4deg) scale(.97) } to { transform: rotate(4deg) scale(1.04) } }
@keyframes oo-vanish { to { opacity: 0; visibility: hidden } }
@keyframes oo-none { }
.oo-mystery { animation: oo-wobble .42s ease-in-out infinite alternate, oo-vanish .18s ease-in forwards }
@keyframes oo-stamp { 0% { transform: scale(2.2); opacity: 0 } 60% { transform: scale(.92); opacity: 1 } 100% { transform: none; opacity: 1 } }
.oo-stamp { animation: oo-stamp .45s cubic-bezier(.2,.8,.2,1) both }
@keyframes oo-bump { 0%, 100% { transform: none } 40% { transform: scale(1.4) } }
.oo-bump { display: inline-block; animation: oo-bump .5s cubic-bezier(.2,1.4,.4,1) }
@keyframes oo-burst { 0% { transform: translate(-50%,-50%) scale(.3); opacity: 0 } 20% { opacity: 1 } 100% { transform: translate(calc(var(--dx) - 50%), calc(var(--dy) - 50%)) scale(1.1); opacity: 0 } }
.oo-burst { animation: oo-burst 1.2s cubic-bezier(.15,.8,.3,1) both }
@keyframes oo-fade { from { opacity: 0 } to { opacity: 1 } }
.oo-fade { animation: oo-fade .3s ease both }
@media (prefers-reduced-motion: reduce) {
  .oo-shake-0, .oo-shake-1, .oo-dot, .oo-pulse, .oo-bump { animation: none !important }
  .oo-enter, .oo-rise, .oo-pop, .oo-flip, .oo-grow, .oo-stamp {
    animation-name: oo-fade !important; animation-duration: .2s !important; animation-timing-function: ease !important;
  }
  .oo-mystery { animation-name: oo-none, oo-vanish !important }
  .oo-burst { display: none }
}
`;

export function GameStyles() {
  return (
    <style href="ruckus-impostor-ui" precedence="default">
      {CSS}
    </style>
  );
}

type ById = Record<string, Player>;
type CssVars = CSSProperties & Record<`--${string}`, string>;

export const nameOf = (byId: ById, id: string | null | undefined) => (id && byId[id]?.name) || "Someone";

/** CSS time for an animation delay (negative = already partway through). */
const ms = (n: number) => `${Math.round(n)}ms`;

export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** True once server time reaches `at` (always true for null). Re-renders exactly when it flips. */
export function usePast(at: number | null, serverNow: () => number): boolean {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (at === null) return;
    const wait = at - serverNow();
    if (wait <= 0) return;
    const id = setTimeout(bump, wait + 20);
    return () => clearTimeout(id);
  }, [at, serverNow]);
  return at === null || serverNow() >= at;
}

/**
 * Smoothly slide children marked with data-flip="<id>" to their new spot when they
 * reorder (FLIP). Uses layout offsets, which ignore running transforms, so a re-render
 * mid-slide never starts a bogus second slide.
 */
function useFlip(ref: { current: HTMLElement | null }) {
  const prev = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, { x: number; y: number }>();
    root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const id = el.dataset.flip ?? "";
      const pos = { x: el.offsetLeft, y: el.offsetTop };
      next.set(id, pos);
      const was = prev.current.get(id);
      if (!was || still || typeof el.animate !== "function") return;
      const dx = was.x - pos.x;
      const dy = was.y - pos.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: 450,
        easing: "cubic-bezier(.2,.8,.2,1)",
      });
    });
    prev.current = next;
  });
}

/** Avatar + name in the player's colour, for use inside sentences. */
export function Who({ player, you }: { player: Player | undefined; you?: boolean }) {
  if (!player) return <>Someone</>;
  return (
    <span className="whitespace-nowrap" style={{ color: player.color }}>
      <span aria-hidden><Avatar id={player.avatar} /> </span>
      {you ? "You" : player.name}
    </span>
  );
}

/** A PlayerChip that shrinks (name ellipsis) instead of overflowing a narrow cell. */
function FitChip(props: Parameters<typeof PlayerChip>[0]) {
  return (
    <span className="flex max-w-full min-w-0 [&>span]:max-w-full">
      <PlayerChip {...props} />
    </span>
  );
}

export function Dots() {
  return (
    <span aria-hidden className="inline-flex items-center gap-0.5">
      <span className="oo-dot size-1 rounded-full bg-current" />
      <span className="oo-dot size-1 rounded-full bg-current" />
      <span className="oo-dot size-1 rounded-full bg-current" />
    </span>
  );
}

export function BigChip({
  player,
  delay = 0,
  anim = "animate-pop",
}: {
  player: Player | undefined;
  delay?: number;
  /** Entrance animation class. */
  anim?: string;
}) {
  if (!player) return null;
  return (
    <span
      className={`${anim} inline-flex max-w-full items-center gap-2 rounded-full border-2 px-4 py-1.5 font-display text-2xl font-extrabold`}
      style={{
        animationDelay: ms(delay),
        borderColor: player.color,
        background: player.color + "22",
        color: player.color,
        boxShadow: `0 0 28px ${player.color}55`,
      }}
    >
      <span aria-hidden className="text-3xl leading-none">
        <Avatar id={player.avatar} />
      </span>
      <span className="truncate">{player.name}</span>
    </span>
  );
}

export function RoundPips({ round, total, accent }: { round: number; total: number; accent: string }) {
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs font-semibold text-muted">
      <span>
        Round {round}/{total}
      </span>
      <span className="flex gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className="h-1.5 w-4 rounded-full transition-colors duration-500"
            style={{ background: i < round ? accent : "var(--color-line)" }}
          />
        ))}
      </span>
    </span>
  );
}

// ---------- your word ----------

export function WordCard({
  word,
  round,
  hidden,
  onToggle,
  accent,
  compact,
  hint,
}: {
  word: string;
  round: number;
  hidden: boolean;
  onToggle: () => void;
  accent: string;
  compact?: boolean;
  hint?: ReactNode;
}) {
  const toggleText = hidden ? "👁️ Tap to show" : "🙈 Tap to hide";
  const shown = hidden ? (
    <span className="select-none tracking-[0.25em] text-muted">
      <span aria-hidden>••••••</span>
      <span className="sr-only">hidden</span>
    </span>
  ) : (
    word
  );
  const style: CSSProperties = {
    borderColor: accent + "88",
    background: `radial-gradient(130% 160% at 0% 0%, ${accent}30, transparent 62%), var(--color-panel)`,
  };
  // Re-keyed on a new round or a hide/show tap, so the word pops in each time.
  const wordKey = `${round}-${hidden ? "h" : "s"}`;

  if (compact) {
    return (
      <button type="button" onClick={onToggle} aria-pressed={hidden} className="card w-full px-4 py-2 text-left" style={style}>
        <span className="flex items-center justify-between gap-2">
          <span className="label" style={{ color: accent }}>
            Your word
          </span>
          <span className="rounded-full bg-ink/60 px-2 py-0.5 text-xs text-muted">{toggleText}</span>
        </span>
        <span key={wordKey} className="oo-pop block font-display text-2xl font-extrabold capitalize [overflow-wrap:anywhere]">
          {shown}
        </span>
      </button>
    );
  }

  return (
    <button type="button" onClick={onToggle} aria-pressed={hidden} className="card group w-full p-4 text-left" style={style}>
      <span className="flex items-center justify-between gap-2">
        <span className="label" style={{ color: accent }}>
          Your word
        </span>
        <span className="rounded-full bg-ink/60 px-2 py-0.5 text-xs text-muted transition-colors group-hover:text-text">
          {toggleText}
        </span>
      </span>
      <span
        key={wordKey}
        className="oo-pop mt-1 block font-display text-4xl font-extrabold capitalize tracking-tight [overflow-wrap:anywhere] @md:text-5xl"
      >
        {shown}
      </span>
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </button>
  );
}

// ---------- clue board ----------

function ClueCell({
  entry,
  fresh,
  active,
  mine,
  accent,
  mark,
}: {
  entry: ClueEntry | undefined;
  /** Arrived while the board was on screen: pop it in. */
  fresh: boolean;
  active: boolean;
  mine: boolean;
  accent: string;
  /** Outline the odd one's clues at the reveal: colour + animation delay. */
  mark?: { color: string; delay: number };
}) {
  const base = "relative flex min-h-9 items-center rounded-lg px-2 py-1";
  const outline = mark && (
    <span
      aria-hidden
      className="oo-fade pointer-events-none absolute inset-0 rounded-lg border-2"
      style={{ borderColor: mark.color, background: mark.color + "1a", animationDelay: ms(mark.delay) }}
    />
  );
  if (entry?.status === "clue") {
    return (
      <div className={`${base} bg-panel-2`}>
        {outline}
        <span className={`${fresh ? "oo-pop" : ""} relative font-semibold [overflow-wrap:anywhere]`}>{entry.text}</span>
      </div>
    );
  }
  if (entry) {
    return (
      <div className={`${base} bg-panel-2/40 text-xs text-muted italic`}>
        {outline}
        <span className={fresh ? "oo-fade" : ""}>{entry.status === "away" ? "away" : "passed"}</span>
      </div>
    );
  }
  if (active) {
    return (
      <div
        className={`${base} oo-pulse gap-1.5 border text-xs font-semibold`}
        style={{ borderColor: accent, color: accent, background: accent + "14", "--oo-ring": accent + "66" } as CssVars}
      >
        <Dots /> {mine ? "you" : "thinking"}
      </div>
    );
  }
  return <div className={`${base} border border-dashed border-line/70`} />;
}

export function ClueBoard({
  view,
  byId,
  me,
  accent,
  odd,
}: {
  view: ImpostorView;
  byId: ById;
  me: string;
  accent: string;
  /** At the reveal: the odd one, and when (animation delay, ms) to unmask them on the board. */
  odd?: { id: string; delay: number };
}) {
  // Clues already given when the board appeared show up still; only new ones pop.
  const [seen] = useState(view.clues.length);
  const n = Math.max(1, view.order.length);
  const active = view.phase === "clues" ? view.turn : -1;
  const lap = Math.min(LAPS - 1, Math.floor(view.turn / n));
  const given = view.clues.filter((c) => c.status === "clue").length;
  return (
    <section aria-label="Clues" className="card min-w-0 p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="label">Clues</h3>
        <span key={view.phase === "clues" ? lap : "done"} className="oo-fade text-xs text-muted">
          {view.phase === "clues" ? `Lap ${lap + 1} of ${LAPS}` : `${given} given`}
        </span>
      </div>
      <table className="w-full table-fixed border-separate border-spacing-y-1 text-sm">
        <thead>
          <tr className="text-left text-[11px] tracking-wider text-muted uppercase">
            <th scope="col" className="w-[42%] font-semibold">
              <span className="sr-only">Player</span>
            </th>
            {Array.from({ length: LAPS }, (_, l) => (
              <th key={l} scope="col" className="px-2 font-semibold">
                Lap {l + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.order.map((id, i) => {
            const p = byId[id];
            const isOdd = odd?.id === id;
            const mark = isOdd ? { color: p?.color ?? accent, delay: odd.delay } : undefined;
            return (
              <tr key={id}>
                <th scope="row" className="pr-1.5 text-left font-normal">
                  <span className="flex min-w-0 flex-wrap items-center gap-1">
                    <FitChip player={p} size="sm" dim={p ? !p.connected : false} />
                    {id === me && <span className="text-[10px] text-muted">you</span>}
                    {isOdd && (
                      <span
                        className="oo-pop text-[10px] font-bold whitespace-nowrap uppercase"
                        style={{ color: mark?.color, animationDelay: ms(odd.delay) }}
                      >
                        odd one
                      </span>
                    )}
                  </span>
                </th>
                {Array.from({ length: LAPS }, (_, l) => {
                  const slot = l * view.order.length + i;
                  return (
                    <td key={l} className="pl-1">
                      <ClueCell
                        entry={view.clues[slot]}
                        fresh={slot >= seen}
                        active={slot === active}
                        mine={id === me}
                        accent={accent}
                        mark={mark}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ---------- voting ----------

export function VoteGrid({
  view,
  me,
  byId,
  isPlayer,
  act,
  accent,
}: {
  view: ImpostorView;
  me: string;
  byId: ById;
  isPlayer: boolean;
  act: (a: ImpostorAction) => void;
  accent: string;
}) {
  const canVote = isPlayer && view.phase === "vote";
  const candidates = view.order.filter((id) => id !== me);
  const shortcutIds = canVote ? JSON.stringify(candidates.slice(0, 9)) : "";

  // Number keys 1-9 vote for the matching card (ignored while typing, e.g. in chat).
  useEffect(() => {
    if (!shortcutIds) return;
    const ids = JSON.parse(shortcutIds) as string[];
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      if (!/^[1-9]$/.test(e.key)) return;
      const target = ids[Number(e.key) - 1];
      if (target) act({ type: "vote", target });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutIds, act]);

  const voted = new Set(view.voted);
  const total = view.order.length;
  return (
    <section aria-label="Vote" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="label">Whose clues don&apos;t fit?</h3>
        <span className="text-xs text-muted tabular-nums" aria-live="polite">
          {view.voted.length}/{total} voted
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-panel-2" aria-hidden>
        <div
          className="h-full origin-left rounded-full transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)]"
          style={{ background: accent, transform: `scaleX(${total ? view.voted.length / total : 0})` }}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-4">
        {view.order.map((id, i) => {
          const p = byId[id];
          if (!p) return null;
          const self = id === me;
          const mine = view.myVote === id;
          const key = candidates.indexOf(id) + 1;
          const clues = view.clues.filter((c) => c.by === id);
          return (
            <button
              key={id}
              type="button"
              disabled={!canVote || self}
              aria-pressed={canVote && !self ? mine : undefined}
              onClick={() => act({ type: "vote", target: id })}
              className={`card oo-rise relative flex min-h-[5.5rem] min-w-0 flex-col items-start gap-1.5 p-2.5 text-left transition-[transform,border-color,background-color,box-shadow] duration-200 enabled:hover:-translate-y-0.5 enabled:active:scale-[0.98] disabled:cursor-default ${
                self ? "border-dashed opacity-75" : ""
              }`}
              style={{
                animationDelay: ms(Math.min(i, 11) * 35),
                ...(mine ? { borderColor: accent, background: accent + "26", boxShadow: `0 0 0 2px ${accent}` } : {}),
              }}
            >
              <span className="flex w-full min-w-0 items-center justify-between gap-1">
                <span className="flex min-w-0">
                  {!self && <span className="sr-only">Vote for </span>}
                  <FitChip player={p} size="sm" dim={!p.connected} />
                </span>
                {voted.has(id) && (
                  <span className="oo-pop shrink-0 rounded-full bg-green-400/15 px-1.5 py-0.5 text-[10px] font-bold text-green-300">
                    ✓<span className="sr-only @sm:not-sr-only"> voted</span>
                  </span>
                )}
              </span>
              {canVote && !self && key > 0 && key <= 9 && (
                <kbd
                  className="absolute right-2 bottom-1.5 hidden rounded border border-line px-1 font-mono text-[10px] text-muted pointer-fine:inline"
                  title={`Press ${key} to vote`}
                >
                  {key}
                </kbd>
              )}
              <span className="flex max-w-full flex-wrap gap-1">
                {clues.length === 0 && <span className="text-xs text-muted italic">no clues</span>}
                {clues.map((c, i) => (
                  <span
                    key={i}
                    className={`max-w-full rounded-md px-1.5 py-0.5 text-xs [overflow-wrap:anywhere] ${
                      c.text ? "bg-ink/70 font-semibold" : "text-muted italic"
                    }`}
                  >
                    {c.text ?? (c.status === "away" ? "away" : "passed")}
                  </span>
                ))}
              </span>
              {self && <span className="mt-auto text-[10px] font-semibold tracking-wider text-muted uppercase">That&apos;s you</span>}
              {mine && (
                <span className="oo-pop mt-auto text-[10px] font-bold tracking-wider uppercase" style={{ color: accent }}>
                  ★ Your vote
                </span>
              )}
            </button>
          );
        })}
      </div>
      {canVote && (
        <p className="px-1 text-xs text-muted">
          Tap who you think had a different word. You can switch until the vote closes.
        </p>
      )}
    </section>
  );
}

// ---------- reveal ----------

/**
 * When each beat of the reveal lands, in ms from the start of the reveal phase:
 * the votes tally up, then "the odd one was…" with a drumroll, the unmasking, both words,
 * the verdict and the points. It ends ~5s in, leaving time to read before REVEAL_MS.
 * If the odd one was already unmasked (caught, then the last guess) there's no drumroll:
 * the votes are a quick recap and the suspense is the guess.
 */
export interface RevealPlan {
  known: boolean;
  votesAt: number;
  voteStep: number;
  /** "The odd one was…" (and the mystery chip, when not known). */
  askAt: number;
  chipAt: number;
  majorAt: number;
  oddAt: number;
  outcomeAt: number;
  stampAt: number;
  pointsAt: number;
}

export function revealPlan(s: RoundSummary): RevealPlan {
  const known = s.outcome === "caught" || s.outcome === "guessed";
  const rows = new Set(s.votes.map((v) => v.target)).size;
  const votesAt = 150;
  const voteStep = rows ? Math.min(known ? 110 : 170, Math.round((known ? 600 : 1000) / rows)) : 0;
  const tallied = votesAt + Math.max(1, rows) * voteStep + (known ? 250 : 650);
  const askAt = tallied;
  const chipAt = known ? askAt : askAt + 1100;
  const majorAt = chipAt + 500;
  const oddAt = majorAt + 300;
  const outcomeAt = oddAt + 550;
  return { known, votesAt, voteStep, askAt, chipAt, majorAt, oddAt, outcomeAt, stampAt: outcomeAt + 250, pointsAt: outcomeAt + 650 };
}

interface Outcome {
  icon: string;
  text: ReactNode;
  stamp: { label: string; color: string } | null;
}

function outcomeLine(s: RoundSummary, byId: ById, me: string): Outcome {
  const you = s.oddId === me;
  const odd = <Who player={byId[s.oddId]} you={you} />;
  const verb = (forYou: string, forThem: string) => (you ? forYou : forThem);
  switch (s.outcome) {
    case "escaped":
      if (s.caughtId) {
        return {
          icon: "🙈",
          stamp: { label: "Wrong person!", color: "var(--color-brand-2)" },
          text: (
            <>
              <Who player={byId[s.caughtId]} you={s.caughtId === me} /> {s.caughtId === me ? "were" : "was"} innocent, so{" "}
              {odd} {verb("escape", "escapes")}: +{POINTS.escape}
            </>
          ),
        };
      }
      return {
        icon: "🕵️",
        stamp: { label: s.votes.length ? "Tied vote!" : "No votes!", color: "var(--color-brand-2)" },
        text: (
          <>
            {odd} {verb("slip", "slips")} away: +{POINTS.escape}
          </>
        ),
      };
    case "guessed":
      return {
        icon: "🎯",
        stamp: { label: "Nailed it!", color: "#4ade80" },
        text: (
          <>
            Caught, but {odd} guessed “{s.guess}”: +{POINTS.guess}
          </>
        ),
      };
    case "caught":
      return {
        icon: "🎉",
        stamp: { label: s.guess ? "Wrong guess!" : "Busted!", color: "var(--color-brand)" },
        text: (
          <>
            {s.guess ? (
              <>
                {odd} guessed “{s.guess}”.
              </>
            ) : (
              <>No guess from {odd}.</>
            )}{" "}
            Everyone else +{POINTS.catch}, sharp eyes +{POINTS.sharpEye} more
          </>
        ),
      };
    default:
      return { icon: "⏸️", stamp: null, text: <>This round was left unfinished.</> };
  }
}

/** Long words step down a size so they never break mid-word in a half-width tile. */
function tileTextSize(word: string) {
  if (word.length <= 7) return "text-2xl";
  if (word.length <= 9) return "text-xl @sm:text-2xl";
  return "text-lg @sm:text-xl @3xl:text-2xl";
}

/** The majority word sits in a neutral tile; the odd word glows in the odd one's colour. */
function WordTile({ label, word, color, delay }: { label: ReactNode; word: string; color?: string; delay: number }) {
  return (
    <div
      className={`oo-flip min-w-0 rounded-xl border px-2 py-2.5 text-center ${color ? "border-2" : "border-line bg-panel-2"}`}
      style={{
        animationDelay: ms(delay),
        ...(color ? { borderColor: color, background: color + "1f", boxShadow: `0 0 22px ${color}40` } : {}),
      }}
    >
      <div className="label truncate">{label}</div>
      <div
        className={`mt-0.5 font-display leading-tight font-extrabold capitalize [overflow-wrap:anywhere] ${tileTextSize(word)}`}
        style={color ? { color } : undefined}
      >
        {word}
      </div>
    </div>
  );
}

function VoteTally({
  s,
  byId,
  accent,
  start,
  step,
  unmaskAt,
}: {
  s: RoundSummary;
  byId: ById;
  accent: string;
  start: number;
  step: number;
  /** When the odd one is unmasked: only then does their bar light up. */
  unmaskAt: number;
}) {
  if (!s.votes.length) {
    return (
      <p className="oo-rise label text-center" style={{ animationDelay: ms(start) }}>
        Round {s.round} · no votes were cast
      </p>
    );
  }
  const byTarget = new Map<string, string[]>();
  for (const v of s.votes) byTarget.set(v.target, [...(byTarget.get(v.target) ?? []), v.voter]);
  // Most votes first (ties keep turn order: sorting the odd one first would give it away).
  const rows = [...byTarget.entries()].sort((a, b) => b[1].length - a[1].length);
  const max = Math.max(1, ...rows.map(([, voters]) => voters.length));
  return (
    <div className="flex flex-col gap-1.5">
      <p className="oo-rise label text-center" style={{ animationDelay: ms(start - 120) }}>
        Round {s.round} · the votes
      </p>
      <ul className="flex flex-col gap-1.5" aria-label="Votes">
        {rows.map(([target, voters], i) => {
          const odd = target === s.oddId;
          const at = start + i * step;
          return (
            <li key={target} className="oo-rise flex items-center gap-2" style={{ animationDelay: ms(at) }}>
              <span className="w-[38%] min-w-0 shrink-0">
                <FitChip player={byId[target]} size="sm" />
              </span>
              <span className="relative h-6 min-w-0 flex-1 overflow-hidden rounded-full bg-panel-2">
                <span
                  className="oo-grow absolute inset-y-0 left-0 overflow-hidden rounded-full bg-line"
                  style={{ width: `${(voters.length / max) * 100}%`, animationDelay: ms(at + 80) }}
                >
                  {odd && (
                    <span className="oo-fade absolute inset-0" style={{ background: accent, animationDelay: ms(unmaskAt) }} />
                  )}
                </span>
                <span className="relative flex h-full items-center gap-0.5 overflow-hidden px-1.5 text-sm" aria-hidden>
                  {voters.map((v, j) => (
                    <span key={v} title={byId[v]?.name} className="oo-pop" style={{ animationDelay: ms(at + 160 + Math.min(j, 8) * 45) }}>
                      <Avatar id={byId[v]?.avatar ?? "?"} />
                    </span>
                  ))}
                </span>
              </span>
              <span className="w-4 shrink-0 text-right font-mono text-sm font-bold tabular-nums">{voters.length}</span>
              <span className="sr-only">
                {voters.length === 1 ? "vote" : "votes"} from {voters.map((v) => nameOf(byId, v)).join(", ")}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Burst({ delay }: { delay: number }) {
  const bits = ["🎉", "✨", "⭐", "🎊", "✨", "🎉", "⭐", "✨", "🎊", "✨"];
  return (
    <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2">
      {bits.map((b, i) => {
        const a = (i / bits.length) * Math.PI * 2;
        const style: CssVars = {
          "--dx": `${Math.round(Math.cos(a) * 90)}px`,
          "--dy": `${Math.round(Math.sin(a) * 46)}px`,
          animationDelay: ms(delay + (i % 3) * 60),
        };
        return (
          <span key={i} className="oo-burst absolute text-lg" style={style}>
            {b}
          </span>
        );
      })}
    </span>
  );
}

function RoundPoints({ s, byId, me, delay }: { s: RoundSummary; byId: ById; me: string; delay: number }) {
  const scorers = Object.entries(s.points)
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!scorers.length) return null;
  return (
    <div className="relative flex flex-wrap justify-center gap-1.5">
      {scorers.map(([id, p], i) => (
        <span key={id} className="oo-pop" style={{ animationDelay: ms(delay + Math.min(i, 11) * 70) }}>
          <PlayerChip player={byId[id]} size="sm">
            <span className="font-mono font-bold text-green-300">+{p}</span>
            {id === me && <span className="sr-only">(you)</span>}
          </PlayerChip>
        </span>
      ))}
      {(s.points[me] ?? 0) > 0 && delay > -1200 && <Burst delay={delay + 120} />}
    </div>
  );
}

export function RevealCard({
  s,
  plan,
  t0,
  byId,
  me,
  accent,
}: {
  s: RoundSummary;
  plan: RevealPlan;
  /** Reveal start relative to when this card mounted (ms, <= 0): beats already past play instantly. */
  t0: number;
  byId: ById;
  me: string;
  accent: string;
}) {
  const odd = byId[s.oddId];
  const oddColor = odd?.color ?? accent;
  const outcome = outcomeLine(s, byId, me);
  const at = (beat: number) => t0 + beat;
  const drumroll = !plan.known && at(plan.chipAt) > 0;
  return (
    <section
      aria-label={`Round ${s.round} reveal`}
      className="card relative flex min-w-0 flex-col gap-3 overflow-hidden p-4"
      style={{
        borderColor: accent,
        background: `radial-gradient(120% 90% at 50% 0%, ${accent}33, transparent 65%), var(--color-panel)`,
      }}
    >
      <VoteTally
        s={s}
        byId={byId}
        accent={accent}
        start={at(plan.votesAt)}
        step={plan.voteStep}
        unmaskAt={at(plan.chipAt)}
      />
      <div className="flex flex-col items-center gap-1.5 text-center">
        <p className="oo-rise label" style={{ animationDelay: ms(at(plan.askAt)) }}>
          {plan.known ? "Caught red-handed" : "The odd one was…"}
        </p>
        <div className="grid max-w-full place-items-center">
          {drumroll && (
            <span aria-hidden className="oo-pop col-start-1 row-start-1" style={{ animationDelay: ms(at(plan.askAt)) }}>
              <span
                className="oo-mystery inline-flex items-center gap-2 rounded-full border-2 border-dashed border-line bg-panel-2 px-4 py-1.5 font-display text-2xl font-extrabold text-muted"
                style={{ animationDelay: `0ms, ${ms(at(plan.chipAt - 160))}` }}
              >
                <span className="text-3xl leading-none">❓</span>? ? ?
              </span>
            </span>
          )}
          <span className="col-start-1 row-start-1 flex max-w-full">
            <BigChip player={odd} anim="oo-pop" delay={at(plan.chipAt)} />
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <WordTile label="Everyone else" word={s.majorityWord} delay={at(plan.majorAt)} />
        <WordTile
          label={<>{s.oddId === me ? "You" : (odd?.name ?? "Odd one")} had</>}
          word={s.oddWord}
          color={oddColor}
          delay={at(plan.oddAt)}
        />
      </div>
      <div
        className="oo-rise flex flex-col items-center gap-1.5 rounded-xl bg-ink/50 px-3 py-2.5 text-center"
        style={{ animationDelay: ms(at(plan.outcomeAt)) }}
      >
        {outcome.stamp && (
          <span
            className="oo-stamp -rotate-3 rounded-md border-2 px-2 py-0.5 font-display text-sm font-extrabold tracking-wider uppercase"
            style={{ color: outcome.stamp.color, borderColor: outcome.stamp.color, animationDelay: ms(at(plan.stampAt)) }}
          >
            {outcome.stamp.label}
          </span>
        )}
        <p className="text-sm font-semibold">
          <span aria-hidden>{outcome.icon} </span>
          {outcome.text}
        </p>
      </div>
      <RoundPoints s={s} byId={byId} me={me} delay={at(plan.pointsAt)} />
    </section>
  );
}

// ---------- scores ----------

export function ScoreStrip({
  view,
  byId,
  me,
  serverNow,
  gains,
  gainsAt,
}: {
  view: ImpostorView;
  byId: ById;
  me: string;
  serverNow: () => number;
  /** During a reveal: this round's points, held back until `gainsAt` (server time). */
  gains: Record<string, number> | null;
  gainsAt: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const landed = usePast(gains ? gainsAt : null, serverNow);
  const held = gains && !landed ? gains : null;
  const score = (id: string) => (view.scores[id] ?? 0) - (held?.[id] ?? 0);
  const ids = Object.keys(view.scores).sort((a, b) => score(b) - score(a));
  useFlip(ref);
  return (
    <div ref={ref} className="flex flex-wrap items-center gap-1.5" aria-label="Scores">
      <span className="label mr-1">Scores</span>
      {ids.map((id) => {
        const p = byId[id];
        if (!p) return null;
        const bumped = !!gains && landed && (gains[id] ?? 0) > 0;
        return (
          <span key={id} data-flip={id} className={id === me ? "rounded-full ring-1 ring-text/30" : ""}>
            <PlayerChip player={p} size="sm" dim={!p.connected}>
              <span
                key={score(id)}
                className={`font-mono font-bold tabular-nums ${bumped ? "oo-bump text-green-300" : "text-text"} transition-colors duration-700`}
              >
                {score(id)}
              </span>
            </PlayerChip>
          </span>
        );
      })}
    </div>
  );
}

const OUTCOME_SHORT: Record<RoundSummary["outcome"], string> = {
  escaped: "🕵️ got away",
  guessed: "🎯 caught, guessed it",
  caught: "🎉 caught",
  abandoned: "⏸️ unfinished",
};

const MEDALS = ["🥇", "🥈", "🥉"];

interface Award {
  icon: string;
  title: string;
  ids: string[];
  detail: string;
}

/** Fun superlatives from the rounds that were played. */
function awardsFor(history: RoundSummary[]): Award[] {
  const disguise: Record<string, number> = {};
  const eye: Record<string, number> = {};
  for (const h of history) {
    if (h.outcome === "abandoned") continue;
    const p = h.points[h.oddId] ?? 0;
    if (p > 0) disguise[h.oddId] = (disguise[h.oddId] ?? 0) + p;
    for (const v of h.votes) if (v.target === h.oddId) eye[v.voter] = (eye[v.voter] ?? 0) + 1;
  }
  const best = (m: Record<string, number>) => {
    const top = Math.max(0, ...Object.values(m));
    return { top, ids: top > 0 ? Object.keys(m).filter((id) => m[id] === top) : [] };
  };
  const out: Award[] = [];
  const d = best(disguise);
  if (d.ids.length && d.ids.length <= 3) {
    out.push({ icon: "🕵️", title: "Best disguise", ids: d.ids, detail: `+${d.top} as the odd one` });
  }
  const e = best(eye);
  if (e.ids.length && e.ids.length <= 3) {
    out.push({ icon: "🔍", title: "Sharpest eye", ids: e.ids, detail: `spotted the odd one ${e.top}×` });
  }
  return out;
}

export function FinalScreen({ view, byId, me, accent }: { view: ImpostorView; byId: ById; me: string; accent: string }) {
  const ids = Object.keys(view.scores).sort((a, b) => (view.scores[b] ?? 0) - (view.scores[a] ?? 0));
  // Competition ranking: ties share a place (1, 2, 2, 4).
  const rank = (i: number) => ids.findIndex((id) => view.scores[id] === view.scores[ids[i]]);
  const awards = awardsFor(view.history);
  const rows = ids.length;
  return (
    <div className="grid gap-3 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @2xl:items-start">
      <div className="flex flex-col gap-3">
        <section aria-label="Final standings" className="card p-3">
          <h3 className="label mb-2">Final standings</h3>
          <ol className="flex flex-col gap-1.5">
            {ids.map((id, i) => {
              const p = byId[id];
              if (!p) return null;
              const r = rank(i);
              const top = r === 0 && (view.scores[id] ?? 0) > 0;
              return (
                <li
                  key={id}
                  className={`oo-rise flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${id === me ? "ring-1 ring-text/25" : ""}`}
                  style={{
                    animationDelay: ms(120 + (rows - 1 - i) * 70),
                    background: top ? accent + "1f" : id === me ? "var(--color-panel-2)" : undefined,
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-6 shrink-0 text-center text-lg leading-none tabular-nums" aria-label={`Place ${r + 1}`}>
                      {(view.scores[id] ?? 0) > 0 && r < 3 ? MEDALS[r] : <span className="text-xs text-muted">{r + 1}</span>}
                    </span>
                    <FitChip player={p} size="sm" dim={!p.connected} />
                    {id === me && <span className="shrink-0 text-[10px] text-muted">you</span>}
                  </span>
                  <span className={`font-mono font-bold tabular-nums ${top ? "text-lg" : ""}`}>{view.scores[id] ?? 0}</span>
                </li>
              );
            })}
          </ol>
          {view.endedEarly && (
            <p className="mt-2 px-1 text-xs text-muted">The game ended early: too few players stayed connected.</p>
          )}
        </section>
        {awards.length > 0 && (
          <div className="grid gap-2 @sm:grid-cols-2">
            {awards.map((a, i) => (
              <div key={a.title} className="card oo-pop flex min-w-0 flex-col gap-1 p-3" style={{ animationDelay: ms(120 + rows * 70 + i * 120) }}>
                <span className="label">
                  <span aria-hidden>{a.icon} </span>
                  {a.title}
                </span>
                <span className="flex flex-wrap gap-1">
                  {a.ids.map((id) => (
                    <FitChip key={id} player={byId[id]} size="sm" />
                  ))}
                </span>
                <span className="text-xs text-muted">{a.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <section aria-label="Rounds" className="card oo-rise p-3" style={{ animationDelay: "160ms" }}>
        <h3 className="label mb-2">Every round</h3>
        <ol className="flex flex-col gap-1.5">
          {view.history.map((h, i) => (
            <li
              key={h.round}
              className="oo-rise flex flex-col gap-1 rounded-xl bg-panel-2/60 px-2.5 py-2 text-sm"
              style={{ animationDelay: ms(260 + i * 90) }}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-xs text-muted">R{h.round}</span>
                  <FitChip player={byId[h.oddId]} size="sm" />
                </span>
                <span className="shrink-0 text-xs text-muted">{OUTCOME_SHORT[h.outcome]}</span>
              </span>
              <span className="min-w-0 pl-7 [overflow-wrap:anywhere]">
                <b className="capitalize">{h.majorityWord}</b> <span className="text-muted">vs</span>{" "}
                <b className="capitalize" style={{ color: accent }}>
                  {h.oddWord}
                </b>
                {h.outcome !== "abandoned" && h.guess && <span className="text-xs text-muted"> · guessed “{h.guess}”</span>}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted">
          Scoring: odd one escapes +{POINTS.escape} · caught but guesses the word +{POINTS.guess} · otherwise everyone else +
          {POINTS.catch}, and +{POINTS.sharpEye} more for voting right.
        </p>
      </section>
    </div>
  );
}
