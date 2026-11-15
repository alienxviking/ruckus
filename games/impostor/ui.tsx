"use client";

// Presentational pieces for Odd One Out. Pure UI: everything arrives via props.

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { PlayerChip, Scoreboard } from "@/components/game-ui";
import type { Player } from "@/shared/types";
import type { ClueEntry, ImpostorAction, ImpostorView, RoundSummary } from "./server";
import { LAPS, POINTS } from "./shared";

// Small, game-scoped keyframes (hoisted and de-duplicated by React). Big motion is off
// for prefers-reduced-motion; animate-pop / animate-rise are handled by globals.css.
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
@keyframes oo-flip { from { transform: perspective(400px) rotateX(85deg); opacity: 0 } to { transform: none; opacity: 1 } }
.oo-flip { animation: oo-flip .55s cubic-bezier(.2,1.25,.4,1) both }
@keyframes oo-grow { from { width: 0 } }
.oo-grow { animation: oo-grow .8s cubic-bezier(.2,.9,.3,1) both }
@keyframes oo-burst { 0% { transform: translate(-50%,-50%) scale(.3); opacity: 0 } 20% { opacity: 1 } 100% { transform: translate(calc(var(--dx) - 50%), calc(var(--dy) - 50%)) scale(1.1); opacity: 0 } }
.oo-burst { animation: oo-burst 1.2s cubic-bezier(.15,.8,.3,1) both }
@media (prefers-reduced-motion: reduce) {
  .oo-shake-0, .oo-shake-1, .oo-dot, .oo-pulse, .oo-flip, .oo-grow { animation: none !important }
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

export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Avatar + name in the player's colour, for use inside sentences. */
export function Who({ player, you }: { player: Player | undefined; you?: boolean }) {
  if (!player) return <>Someone</>;
  return (
    <span className="whitespace-nowrap" style={{ color: player.color }}>
      <span aria-hidden>{player.avatar} </span>
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

export function BigChip({ player, delay = 0 }: { player: Player | undefined; delay?: number }) {
  if (!player) return null;
  return (
    <span
      className="animate-pop inline-flex max-w-full items-center gap-2 rounded-full border-2 px-4 py-1.5 font-display text-2xl font-extrabold"
      style={{
        animationDelay: `${delay}ms`,
        borderColor: player.color,
        background: player.color + "22",
        color: player.color,
        boxShadow: `0 0 28px ${player.color}55`,
      }}
    >
      <span aria-hidden className="text-3xl leading-none">
        {player.avatar}
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
            className="h-1.5 w-4 rounded-full transition-colors"
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

  if (compact) {
    return (
      <button type="button" onClick={onToggle} className="card w-full px-4 py-2 text-left" style={style}>
        <span className="flex items-center justify-between gap-2">
          <span className="label" style={{ color: accent }}>
            Your word
          </span>
          <span className="rounded-full bg-ink/60 px-2 py-0.5 text-xs text-muted">{toggleText}</span>
        </span>
        <span
          key={round}
          className="animate-pop block font-display text-2xl font-extrabold capitalize [overflow-wrap:anywhere]"
        >
          {shown}
        </span>
      </button>
    );
  }

  return (
    <button type="button" onClick={onToggle} className="card group w-full p-4 text-left" style={style}>
      <span className="flex items-center justify-between gap-2">
        <span className="label" style={{ color: accent }}>
          Your word
        </span>
        <span className="rounded-full bg-ink/60 px-2 py-0.5 text-xs text-muted transition-colors group-hover:text-text">
          {toggleText}
        </span>
      </span>
      <span
        key={round}
        className="animate-pop mt-1 block font-display text-4xl font-extrabold capitalize tracking-tight [overflow-wrap:anywhere] @md:text-5xl"
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
  active,
  mine,
  accent,
}: {
  entry: ClueEntry | undefined;
  active: boolean;
  mine: boolean;
  accent: string;
}) {
  const base = "flex min-h-9 items-center rounded-lg px-2 py-1";
  if (entry?.status === "clue") {
    return (
      <div className={`${base} bg-panel-2`}>
        <span className="animate-pop font-semibold [overflow-wrap:anywhere]">{entry.text}</span>
      </div>
    );
  }
  if (entry) {
    return <div className={`${base} bg-panel-2/40 text-xs text-muted italic`}>{entry.status === "away" ? "away" : "passed"}</div>;
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
  oddId,
}: {
  view: ImpostorView;
  byId: ById;
  me: string;
  accent: string;
  /** Known once the round is revealed. */
  oddId?: string | null;
}) {
  const n = Math.max(1, view.order.length);
  const active = view.phase === "clues" ? view.turn : -1;
  const lap = Math.min(LAPS - 1, Math.floor(view.turn / n));
  const given = view.clues.filter((c) => c.status === "clue").length;
  return (
    <section aria-label="Clues" className="card min-w-0 p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="label">Clues</h3>
        <span className="text-xs text-muted">
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
            const isOdd = oddId === id;
            return (
              <tr key={id}>
                <th scope="row" className="pr-1.5 text-left font-normal">
                  <span className="flex min-w-0 flex-wrap items-center gap-1">
                    <FitChip player={p} size="sm" dim={p ? !p.connected : false} />
                    {id === me && <span className="text-[10px] text-muted">you</span>}
                    {isOdd && (
                      <span className="animate-pop text-[10px] font-bold uppercase" style={{ color: accent }}>
                        odd one
                      </span>
                    )}
                  </span>
                </th>
                {Array.from({ length: LAPS }, (_, l) => {
                  const slot = l * view.order.length + i;
                  return (
                    <td key={l} className="pl-1">
                      <ClueCell entry={view.clues[slot]} active={slot === active} mine={id === me} accent={accent} />
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
  return (
    <section aria-label="Vote" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="label">Whose clues don&apos;t fit?</h3>
        <span className="text-xs text-muted tabular-nums" aria-live="polite">
          {view.voted.length}/{view.order.length} voted
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-4">
        {view.order.map((id) => {
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
              className={`card relative flex min-h-[5.5rem] min-w-0 flex-col items-start gap-1.5 p-2.5 text-left transition-[transform,border-color,background-color,box-shadow] duration-150 enabled:hover:-translate-y-0.5 enabled:active:scale-[0.98] disabled:cursor-default ${
                self ? "border-dashed opacity-75" : ""
              }`}
              style={mine ? { borderColor: accent, background: accent + "26", boxShadow: `0 0 0 2px ${accent}` } : undefined}
            >
              <span className="flex w-full min-w-0 items-center justify-between gap-1">
                <span className="flex min-w-0">
                  {!self && <span className="sr-only">Vote for </span>}
                  <FitChip player={p} size="sm" dim={!p.connected} />
                </span>
                {voted.has(id) && (
                  <span className="animate-pop shrink-0 rounded-full bg-green-400/15 px-1.5 py-0.5 text-[10px] font-bold text-green-300">
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
                <span className="animate-pop mt-auto text-[10px] font-bold tracking-wider uppercase" style={{ color: accent }}>
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

function outcomeLine(s: RoundSummary, byId: ById, me: string): { icon: string; text: ReactNode } {
  const you = s.oddId === me;
  const odd = <Who player={byId[s.oddId]} you={you} />;
  const verb = (forYou: string, forThem: string) => (you ? forYou : forThem);
  switch (s.outcome) {
    case "escaped":
      if (s.caughtId) {
        return {
          icon: "🙈",
          text: (
            <>
              Wrong person! <Who player={byId[s.caughtId]} you={s.caughtId === me} /> {s.caughtId === me ? "were" : "was"}{" "}
              innocent, so {odd} {verb("escape", "escapes")}: +{POINTS.escape}
            </>
          ),
        };
      }
      return {
        icon: "🕵️",
        text: (
          <>
            {s.votes.length ? "Tied vote!" : "Nobody voted!"} {odd} {verb("slip", "slips")} away: +{POINTS.escape}
          </>
        ),
      };
    case "guessed":
      return {
        icon: "🎯",
        text: (
          <>
            Caught, but {odd} guessed “{s.guess}”: +{POINTS.guess}
          </>
        ),
      };
    case "caught":
      return {
        icon: "🎉",
        text: (
          <>
            {s.guess ? (
              <>
                {odd} guessed “{s.guess}”. Nope!
              </>
            ) : (
              <>No guess from {odd}.</>
            )}{" "}
            Everyone else +{POINTS.catch}, sharp eyes +{POINTS.sharpEye} more
          </>
        ),
      };
    default:
      return { icon: "⏸️", text: <>This round was left unfinished.</> };
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
        animationDelay: `${delay}ms`,
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

function VoteTally({ s, byId, accent }: { s: RoundSummary; byId: ById; accent: string }) {
  if (!s.votes.length) return <p className="text-center text-xs text-muted">No votes were cast.</p>;
  const byTarget = new Map<string, string[]>();
  for (const v of s.votes) byTarget.set(v.target, [...(byTarget.get(v.target) ?? []), v.voter]);
  // Most votes first; on equal counts the odd one leads, so the answer is easy to spot.
  const rows = [...byTarget.entries()].sort(
    (a, b) => b[1].length - a[1].length || Number(b[0] === s.oddId) - Number(a[0] === s.oddId),
  );
  const max = Math.max(1, ...rows.map(([, voters]) => voters.length));
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Votes">
      {rows.map(([target, voters], i) => {
        const odd = target === s.oddId;
        return (
          <li key={target} className="animate-rise flex items-center gap-2" style={{ animationDelay: `${1500 + i * 90}ms` }}>
            <span className="w-[38%] min-w-0 shrink-0">
              <FitChip player={byId[target]} size="sm" />
            </span>
            <span className="relative h-6 min-w-0 flex-1 overflow-hidden rounded-full bg-panel-2">
              <span
                className="oo-grow absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${(voters.length / max) * 100}%`,
                  background: odd ? accent : "var(--color-line)",
                  animationDelay: `${1600 + i * 90}ms`,
                }}
              />
              <span className="relative flex h-full items-center gap-0.5 overflow-hidden px-1.5 text-sm" aria-hidden>
                {voters.map((v) => (
                  <span key={v} title={byId[v]?.name}>
                    {byId[v]?.avatar ?? "?"}
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
  );
}

function Burst() {
  const bits = ["🎉", "✨", "⭐", "🎊", "✨", "🎉", "⭐", "✨", "🎊", "✨"];
  return (
    <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2">
      {bits.map((b, i) => {
        const a = (i / bits.length) * Math.PI * 2;
        const style: CssVars = {
          "--dx": `${Math.round(Math.cos(a) * 90)}px`,
          "--dy": `${Math.round(Math.sin(a) * 46)}px`,
          animationDelay: `${1900 + (i % 3) * 60}ms`,
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

function RoundPoints({ s, byId, me }: { s: RoundSummary; byId: ById; me: string }) {
  const scorers = Object.entries(s.points)
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!scorers.length) return null;
  return (
    <div className="relative flex flex-wrap justify-center gap-1.5">
      {scorers.map(([id, p], i) => (
        <span key={id} className="animate-pop" style={{ animationDelay: `${1800 + i * 70}ms` }}>
          <PlayerChip player={byId[id]} size="sm">
            <span className="font-mono font-bold text-green-300">+{p}</span>
            {id === me && <span className="sr-only">(you)</span>}
          </PlayerChip>
        </span>
      ))}
      {(s.points[me] ?? 0) > 0 && <Burst />}
    </div>
  );
}

export function RevealCard({ s, byId, me, accent }: { s: RoundSummary; byId: ById; me: string; accent: string }) {
  const odd = byId[s.oddId];
  const oddColor = odd?.color ?? accent;
  const outcome = outcomeLine(s, byId, me);
  return (
    <section
      aria-label={`Round ${s.round} reveal`}
      className="card relative flex min-w-0 flex-col gap-3 overflow-hidden p-4"
      style={{
        borderColor: accent,
        background: `radial-gradient(120% 90% at 50% 0%, ${accent}33, transparent 65%), var(--color-panel)`,
      }}
    >
      <div className="flex flex-col items-center gap-1.5 text-center">
        <p className="animate-rise label">Round {s.round} · the odd one was…</p>
        <BigChip player={odd} delay={350} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <WordTile label="Everyone else" word={s.majorityWord} delay={800} />
        <WordTile
          label={
            <>
              {s.oddId === me ? "You" : (odd?.name ?? "Odd one")} had
            </>
          }
          word={s.oddWord}
          color={oddColor}
          delay={1000}
        />
      </div>
      <p
        className="animate-rise rounded-xl bg-ink/50 px-3 py-2 text-center text-sm font-semibold"
        style={{ animationDelay: "1300ms" }}
      >
        <span aria-hidden>{outcome.icon} </span>
        {outcome.text}
      </p>
      <VoteTally s={s} byId={byId} accent={accent} />
      <RoundPoints s={s} byId={byId} me={me} />
    </section>
  );
}

// ---------- scores ----------

export function ScoreStrip({ view, byId, me }: { view: ImpostorView; byId: ById; me: string }) {
  const ids = Object.keys(view.scores).sort((a, b) => (view.scores[b] ?? 0) - (view.scores[a] ?? 0));
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Scores">
      <span className="label mr-1">Scores</span>
      {ids.map((id) => {
        const p = byId[id];
        if (!p) return null;
        return (
          <span key={id} className={id === me ? "rounded-full ring-1 ring-text/30" : ""}>
            <PlayerChip player={p} size="sm" dim={!p.connected}>
              <span className="font-mono font-bold text-text tabular-nums">{view.scores[id] ?? 0}</span>
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

export function FinalScreen({ view, byId, me, accent }: { view: ImpostorView; byId: ById; me: string; accent: string }) {
  return (
    <div className="grid gap-3 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @2xl:items-start">
      <div className="animate-rise flex flex-col gap-2">
        <Scoreboard scores={view.scores} byId={byId} order={Object.keys(view.scores)} highlight={me} title="Final standings" />
        {view.endedEarly && (
          <p className="px-1 text-xs text-muted">The game ended early: too few players stayed connected.</p>
        )}
      </div>
      <section aria-label="Rounds" className="card animate-rise p-3" style={{ animationDelay: "120ms" }}>
        <h3 className="label mb-2">Every round</h3>
        <ol className="flex flex-col gap-1.5">
          {view.history.map((h) => (
            <li key={h.round} className="flex flex-col gap-1 rounded-xl bg-panel-2/60 px-2.5 py-2 text-sm">
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
