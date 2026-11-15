"use client";

// Presentational pieces for Fib Finder. Pure UI: everything arrives via props.

import { Fragment, type CSSProperties, type ReactNode } from "react";
import { PlayerChip, Scoreboard, useTicker } from "@/components/game-ui";
import type { Player } from "@/shared/types";
import type { Awards, FibView, RevealOption, RoundSummary } from "./server";
import { POINTS, formatPoints, splitPrompt } from "./shared";

// Small, game-scoped keyframes (hoisted and de-duplicated by React). Big motion is off
// for prefers-reduced-motion; animate-pop / animate-rise are handled by globals.css.
const CSS = `
@keyframes fib-shake { 0%,100% { transform: none } 20% { transform: translateX(-6px) } 40% { transform: translateX(5px) } 60% { transform: translateX(-3px) } 80% { transform: translateX(2px) } }
@keyframes fib-shake-b { 0%,100% { transform: none } 20% { transform: translateX(-6px) } 40% { transform: translateX(5px) } 60% { transform: translateX(-3px) } 80% { transform: translateX(2px) } }
.fib-shake-0 { animation: fib-shake .32s ease both }
.fib-shake-1 { animation: fib-shake-b .32s ease both }
@keyframes fib-dot { 0%, 80%, 100% { opacity: .25; transform: none } 40% { opacity: 1; transform: translateY(-2px) } }
.fib-dot { animation: fib-dot 1.1s ease-in-out infinite both }
.fib-dot:nth-child(2) { animation-delay: .15s }
.fib-dot:nth-child(3) { animation-delay: .3s }
@keyframes fib-blink { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }
.fib-blank { animation: fib-blink 1.6s ease-in-out infinite }
@keyframes fib-flip { from { transform: perspective(500px) rotateX(80deg); opacity: 0 } to { transform: none; opacity: 1 } }
.fib-flip { animation: fib-flip .5s cubic-bezier(.2,1.25,.4,1) both }
@keyframes fib-stamp { 0% { transform: scale(2.2) rotate(-14deg); opacity: 0 } 60% { transform: scale(.92) rotate(-8deg); opacity: 1 } 100% { transform: scale(1) rotate(-8deg); opacity: 1 } }
.fib-stamp { animation: fib-stamp .45s cubic-bezier(.2,1.3,.4,1) both }
@keyframes fib-strike { from { background-size: 0% 3px } to { background-size: 100% 3px } }
.fib-strike { background-image: linear-gradient(currentColor, currentColor); background-repeat: no-repeat; background-position: 0 55%; background-size: 100% 3px; animation: fib-strike .35s ease-out .6s both }
@keyframes fib-burst { 0% { transform: translate(-50%,-50%) scale(.3); opacity: 0 } 20% { opacity: 1 } 100% { transform: translate(calc(var(--dx) - 50%), calc(var(--dy) - 50%)) scale(1.1); opacity: 0 } }
.fib-burst { animation: fib-burst 1.2s cubic-bezier(.15,.8,.3,1) both }
@keyframes fib-ring { 0% { box-shadow: 0 0 0 0 var(--fib-ring) } 70% { box-shadow: 0 0 0 8px transparent } 100% { box-shadow: 0 0 0 0 transparent } }
.fib-pulse { animation: fib-ring 1.6s ease-out infinite }
@media (prefers-reduced-motion: reduce) {
  .fib-shake-0, .fib-shake-1, .fib-dot, .fib-blank, .fib-flip, .fib-stamp, .fib-strike, .fib-pulse { animation: none !important }
  .fib-burst { display: none }
}
`;

export function FibStyles() {
  return (
    <style href="ruckus-fib-ui" precedence="default">
      {CSS}
    </style>
  );
}

export type ById = Record<string, Player>;
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

/** "Asha", "Asha & Bo", "Asha, Bo & Chen" with coloured names. */
export function WhoList({ ids, byId, me, possessive }: { ids: string[]; byId: ById; me: string; possessive?: boolean }) {
  return (
    <>
      {ids.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && (i === ids.length - 1 ? " & " : ", ")}
          {possessive && id === me && ids.length === 1 ? (
            <span className="whitespace-nowrap" style={{ color: byId[id]?.color }}>
              your
            </span>
          ) : (
            <Who player={byId[id]} you={id === me} />
          )}
        </Fragment>
      ))}
      {possessive && !(ids.length === 1 && ids[0] === me) && "’s"}
    </>
  );
}

/** A PlayerChip that shrinks (name ellipsis) instead of overflowing a narrow cell. */
export function FitChip(props: Parameters<typeof PlayerChip>[0]) {
  return (
    <span className="flex max-w-full min-w-0 [&>span]:max-w-full">
      <PlayerChip {...props} />
    </span>
  );
}

export function Dots() {
  return (
    <span aria-hidden className="inline-flex items-center gap-0.5">
      <span className="fib-dot size-1 rounded-full bg-current" />
      <span className="fib-dot size-1 rounded-full bg-current" />
      <span className="fib-dot size-1 rounded-full bg-current" />
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
            className="h-1.5 w-3 rounded-full transition-colors @sm:w-4"
            style={{ background: i < round ? accent : "var(--color-line)" }}
          />
        ))}
      </span>
    </span>
  );
}

// ---------- the fact ----------

export type FillStyle = "preview" | "pick" | "fib" | "truth";

/** The fact with its blank highlighted. `fill` drops text into the blank (a draft, a pick, a fib or the truth). */
export function FactCard({
  prompt,
  round,
  accent,
  fill,
  fillStyle = "preview",
  fillKey,
  compact,
}: {
  prompt: string;
  round?: number;
  accent: string;
  fill?: string | null;
  fillStyle?: FillStyle;
  /** Changing this replays the fill animation. */
  fillKey?: string | number;
  compact?: boolean;
}) {
  const [before, after] = splitPrompt(prompt);
  const text = fill?.trim();
  let blank: ReactNode;
  if (!text) {
    blank = (
      <>
        <span
          aria-hidden
          className="fib-blank mx-0.5 inline-block min-w-[4.5ch] rounded-md border-b-[3px] px-2 text-center leading-tight"
          style={{ borderColor: accent, background: accent + "1c", color: accent }}
        >
          ?
        </span>
        <span className="sr-only">blank</span>
      </>
    );
  } else {
    const look: Record<FillStyle, CSSProperties> = {
      preview: { color: "var(--color-text)", background: "var(--color-panel-2)", borderColor: "var(--color-line)" },
      pick: { color: "var(--color-text)", background: accent + "1c", borderColor: accent + "99" },
      fib: { color: "var(--color-brand)", background: "rgb(255 93 115 / 0.12)", borderColor: "var(--color-brand)" },
      truth: { color: accent, background: accent + "2e", borderColor: accent, boxShadow: `0 0 22px ${accent}55` },
    };
    blank = (
      <span
        key={fillKey}
        className={`mx-0.5 inline rounded-md border-b-[3px] px-1.5 font-extrabold [overflow-wrap:anywhere] [box-decoration-break:clone] ${
          fillStyle === "preview" ? "italic" : "animate-pop"
        }`}
        style={look[fillStyle]}
      >
        <span className={fillStyle === "fib" ? "fib-strike" : undefined}>{text}</span>
      </span>
    );
  }
  return (
    <section
      aria-label="The fact"
      className={`card relative overflow-hidden ${compact ? "px-4 py-3" : "px-4 py-4 @md:px-5"}`}
      style={{
        borderColor: accent + "66",
        background: `radial-gradient(120% 140% at 0% 0%, ${accent}26, transparent 60%), var(--color-panel)`,
      }}
    >
      <p className="label mb-1 flex items-center justify-between gap-2" style={{ color: accent }}>
        <span>
          <span aria-hidden>🧐 </span>Strange but true
        </span>
        {round !== undefined && <span className="text-muted">Fact {round}</span>}
      </p>
      <p
        className={`font-display leading-snug font-bold text-balance [overflow-wrap:anywhere] ${
          compact ? "text-lg @md:text-xl" : "text-xl @md:text-2xl"
        }`}
      >
        {before}
        {blank}
        {after}
      </p>
    </section>
  );
}

// ---------- who's done ----------

export function Tracker({
  players,
  done,
  label,
  me,
  accent,
}: {
  players: Player[];
  done: string[];
  label: string;
  me: string;
  accent: string;
}) {
  const doneSet = new Set(done);
  return (
    <section aria-label={label} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="label">{label}</h3>
        <span className="text-xs text-muted tabular-nums" aria-live="polite">
          {done.length}/{players.length}
        </span>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {players.map((p) => {
          const ok = doneSet.has(p.id);
          return (
            <li
              key={p.id}
              className={`flex max-w-full min-w-0 items-center gap-1 rounded-full transition-opacity ${ok ? "" : "opacity-70"}`}
            >
              <PlayerChip player={p} size="sm" dim={!p.connected}>
                {ok ? (
                  <span className="animate-pop font-bold" style={{ color: accent }}>
                    ✓<span className="sr-only"> done</span>
                  </span>
                ) : p.connected ? (
                  <span className="text-muted">
                    <Dots />
                    <span className="sr-only"> still deciding</span>
                  </span>
                ) : (
                  <span className="text-[10px] text-muted">away</span>
                )}
                {p.id === me && <span className="sr-only">(you)</span>}
              </PlayerChip>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- reveal ----------

function Burst({ delay = 0 }: { delay?: number }) {
  const bits = ["🎉", "✨", "⭐", "🎊", "✨", "🎉", "⭐", "✨", "🎊", "✨"];
  return (
    <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2">
      {bits.map((b, i) => {
        const a = (i / bits.length) * Math.PI * 2;
        const style: CssVars = {
          "--dx": `${Math.round(Math.cos(a) * 110)}px`,
          "--dy": `${Math.round(Math.sin(a) * 56)}px`,
          animationDelay: `${delay + (i % 3) * 60}ms`,
        };
        return (
          <span key={i} className="fib-burst absolute text-lg" style={style}>
            {b}
          </span>
        );
      })}
    </span>
  );
}

function KindTag({ kind, accent }: { kind: RevealOption["kind"]; accent: string }) {
  if (kind === "truth") {
    return (
      <span
        className="fib-stamp inline-block rounded-md border-2 px-2 py-0.5 font-display text-sm font-black tracking-widest uppercase"
        style={{ color: accent, borderColor: accent, background: accent + "1c" }}
      >
        The truth
      </span>
    );
  }
  if (kind === "house") {
    return (
      <span className="fib-stamp inline-block rounded-md border-2 border-line bg-panel-2 px-2 py-0.5 font-display text-sm font-black tracking-widest text-muted uppercase">
        🏠 House fib
      </span>
    );
  }
  return (
    <span className="fib-stamp inline-block rounded-md border-2 border-brand bg-brand/10 px-2 py-0.5 font-display text-sm font-black tracking-widest text-brand uppercase">
      Fib!
    </span>
  );
}

function StepCard({ s, index, byId, me, accent }: { s: RoundSummary; index: number; byId: ById; me: string; accent: string }) {
  const o = s.options[index];
  const fooledMe = o.pickers.includes(me);
  let line: ReactNode;
  let points: ReactNode = null;
  if (o.kind === "truth") {
    if (!o.pickers.length) line = <>Nobody found the truth! 😱</>;
    else {
      line = (
        <>
          <WhoList ids={o.pickers} byId={byId} me={me} /> found the truth!
        </>
      );
      points = (
        <span className="font-mono font-bold" style={{ color: accent }}>
          +{POINTS.truth} {o.pickers.length > 1 ? "each" : ""}
        </span>
      );
    }
  } else if (o.kind === "house") {
    line = (
      <>
        <WhoList ids={o.pickers} byId={byId} me={me} /> fell for a house fib!
      </>
    );
    points = <span className="text-muted">Nobody scores for that one.</span>;
  } else {
    line = (
      <>
        <WhoList ids={o.pickers} byId={byId} me={me} /> fell for <WhoList ids={o.authors} byId={byId} me={me} possessive /> fib!
      </>
    );
    const each = o.pickers.length * POINTS.fooled;
    points = (
      <span className="flex flex-wrap items-center justify-center gap-1.5">
        {o.authors.map((a) => (
          <PlayerChip key={a} player={byId[a]} size="sm">
            <span className="font-mono font-bold text-green-300">+{formatPoints(each)}</span>
          </PlayerChip>
        ))}
      </span>
    );
  }
  const truth = o.kind === "truth";
  const wonPoints = truth ? fooledMe : o.kind === "lie" && o.authors.includes(me);
  return (
    <div
      key={index}
      className="fib-flip relative flex min-w-0 flex-col items-center gap-2 rounded-2xl border-2 px-3 py-4 text-center"
      style={
        truth
          ? { borderColor: accent, background: `radial-gradient(120% 120% at 50% 0%, ${accent}33, transparent 70%), var(--color-panel-2)` }
          : o.kind === "house"
            ? { borderColor: "var(--color-line)", background: "var(--color-panel-2)" }
            : { borderColor: "rgb(255 93 115 / 0.6)", background: "radial-gradient(120% 120% at 50% 0%, rgb(255 93 115 / 0.16), transparent 70%), var(--color-panel-2)" }
      }
    >
      <KindTag kind={o.kind} accent={accent} />
      <p
        className="font-display text-3xl leading-tight font-extrabold [overflow-wrap:anywhere] @md:text-4xl"
        style={{ color: truth ? accent : undefined }}
      >
        “{o.text}”
      </p>
      <p className="animate-rise text-sm font-semibold @md:text-base" style={{ animationDelay: "350ms" }}>
        {line}
      </p>
      {points && (
        <div className="animate-pop text-sm" style={{ animationDelay: "650ms" }}>
          {points}
        </div>
      )}
      {wonPoints && <Burst delay={500} />}
    </div>
  );
}

function OptionRow({
  o,
  revealed,
  current,
  byId,
  me,
  accent,
}: {
  o: RevealOption;
  revealed: boolean;
  current: boolean;
  byId: ById;
  me: string;
  accent: string;
}) {
  const truth = revealed && o.kind === "truth";
  const tag = !revealed ? null : o.kind === "truth" ? "truth" : o.kind === "house" ? "house fib" : "fib";
  return (
    <li
      className={`flex min-w-0 flex-col gap-1 rounded-xl border px-2.5 py-2 transition-[border-color,background-color] duration-300 ${
        current ? "" : "border-transparent"
      }`}
      style={{
        background: truth ? accent + "1f" : "var(--color-panel-2)",
        borderColor: current ? (o.kind === "truth" ? accent : "rgb(255 93 115 / 0.7)") : undefined,
      }}
    >
      <span className="flex items-center justify-between gap-2">
        <span
          className={`min-w-0 font-semibold [overflow-wrap:anywhere] ${revealed && o.kind !== "truth" ? "text-muted line-through decoration-2" : ""}`}
          style={truth ? { color: accent } : undefined}
        >
          {o.text}
        </span>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${
            revealed ? "animate-pop" : "text-muted"
          }`}
          style={
            truth
              ? { color: "#06281c", background: accent }
              : revealed
                ? { color: o.kind === "house" ? "var(--color-muted)" : "var(--color-brand)", background: "var(--color-ink)" }
                : undefined
          }
        >
          {tag ?? "?"}
        </span>
      </span>
      {revealed && (o.authors.length > 0 || o.pickers.length > 0) && (
        <span className="animate-rise flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {o.authors.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              by
              {o.authors.map((a) => (
                <FitChip key={a} player={byId[a]} size="sm" />
              ))}
            </span>
          )}
          <span>
            {o.pickers.length ? (
              <>
                {o.kind === "truth" ? "found by " : "fooled "}
                <span aria-hidden>{o.pickers.map((p) => byId[p]?.avatar ?? "?").join(" ")}</span>
                <span className="sr-only">{o.pickers.map((p) => (p === me ? "you" : nameOf(byId, p))).join(", ")}</span>
              </>
            ) : o.kind === "truth" ? (
              "found by nobody"
            ) : (
              "fooled nobody"
            )}
          </span>
        </span>
      )}
    </li>
  );
}

/** Where the walk-through is: the current step, and whether it's over (the hold before the next round). */
export function useRevealClock(revealAt: number, stepMs: number, steps: number, serverNow: () => number) {
  useTicker(100);
  const elapsed = serverNow() - revealAt;
  if (!revealAt || stepMs <= 0 || steps <= 0) return { step: Math.max(0, steps - 1), done: true };
  return {
    step: Math.max(0, Math.min(steps - 1, Math.floor(elapsed / stepMs))),
    done: elapsed >= steps * stepMs,
  };
}

export function RevealStage({
  s,
  step,
  done,
  byId,
  me,
  accent,
}: {
  s: RoundSummary;
  step: number;
  done: boolean;
  byId: ById;
  me: string;
  accent: string;
}) {
  const current = s.steps[step] ?? s.steps[s.steps.length - 1];
  const cur = s.options[current];
  const truthShown = cur?.kind === "truth";
  const shown = new Set(s.steps.slice(0, step + 1));
  const myPoints = s.points[me] ?? 0;
  const scorers = Object.entries(s.points)
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1]);
  const fibCount = s.options.filter((o) => o.kind !== "truth").length;

  return (
    <div className="grid gap-3 @2xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] @2xl:items-start">
      <div className="flex min-w-0 flex-col gap-3">
        <FactCard
          prompt={s.prompt}
          round={s.round}
          accent={accent}
          fill={truthShown ? s.answer : cur?.text}
          fillStyle={truthShown ? "truth" : "fib"}
          fillKey={current}
          compact
        />
        <section aria-label="Reveal" aria-live="polite" className="flex flex-col gap-2">
          {cur && <StepCard key={current} s={s} index={current} byId={byId} me={me} accent={accent} />}
          <p className="text-center text-xs text-muted tabular-nums">
            {truthShown ? "The truth" : `Fib ${step + 1} of ${s.steps.length - 1}`}
          </p>
        </section>
        {done && (
          <section aria-label="Round points" className="card animate-rise relative flex flex-col items-center gap-2 p-3">
            <h3 className="label">Round {s.round} points</h3>
            {scorers.length ? (
              <div className="flex flex-wrap justify-center gap-1.5">
                {scorers.map(([id, p], i) => (
                  <span key={id} className="animate-pop" style={{ animationDelay: `${i * 70}ms` }}>
                    <PlayerChip player={byId[id]} size="sm">
                      <span className="font-mono font-bold text-green-300">+{formatPoints(p)}</span>
                      {id === me && <span className="sr-only">(you)</span>}
                    </PlayerChip>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">Nobody scored this round.</p>
            )}
            {myPoints > 0 && <Burst />}
          </section>
        )}
      </div>
      <section aria-label="All answers" className="card min-w-0 p-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="label">All answers</h3>
          <span className="text-xs text-muted">
            1 truth · {fibCount} fib{fibCount === 1 ? "" : "s"}
          </span>
        </div>
        <ul className="flex flex-col gap-1.5">
          {s.options.map((o, i) => (
            <OptionRow
              key={i}
              o={o}
              revealed={shown.has(i) || (truthShown && !s.steps.includes(i))}
              current={i === current}
              byId={byId}
              me={me}
              accent={accent}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------- scores ----------

export function ScoreStrip({
  scores,
  byId,
  me,
  gains,
}: {
  scores: Record<string, number>;
  byId: ById;
  me: string;
  /** Points just won, shown as a bump next to the total. */
  gains?: Record<string, number> | null;
}) {
  const ids = Object.keys(scores).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Scores">
      <span className="label mr-1">Scores</span>
      {ids.map((id) => {
        const p = byId[id];
        if (!p) return null;
        const gain = gains?.[id] ?? 0;
        return (
          <span key={id} className={id === me ? "rounded-full ring-1 ring-text/30" : ""}>
            <PlayerChip player={p} size="sm" dim={!p.connected}>
              <span className="font-mono font-bold text-text tabular-nums">{formatPoints(scores[id] ?? 0)}</span>
              {gain > 0 && <span className="animate-pop font-mono text-[10px] font-bold text-green-300">+{formatPoints(gain)}</span>}
            </PlayerChip>
          </span>
        );
      })}
    </div>
  );
}

// ---------- final ----------

function AwardRow({
  icon,
  title,
  award,
  detail,
  empty,
  byId,
  accent,
  delay,
}: {
  icon: string;
  title: string;
  award: Awards["liar"];
  detail: string;
  empty: string;
  byId: ById;
  accent: string;
  delay: number;
}) {
  return (
    <li
      className="animate-pop flex items-center gap-3 rounded-xl px-3 py-2.5"
      style={{ animationDelay: `${delay}ms`, background: award.ids.length ? accent + "18" : "var(--color-panel-2)" }}
    >
      <span aria-hidden className="text-3xl leading-none">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="label" style={{ color: award.ids.length ? accent : undefined }}>
          {title}
        </span>
        {award.ids.length ? (
          <>
            <span className="flex flex-wrap gap-1">
              {award.ids.map((id) => (
                <FitChip key={id} player={byId[id]} size="sm" />
              ))}
            </span>
            <span className="text-xs text-muted">{detail}</span>
          </>
        ) : (
          <span className="text-sm text-muted">{empty}</span>
        )}
      </span>
    </li>
  );
}

/** The most convincing fib of a round, if anyone fell for one. */
function bestFib(h: RoundSummary): RevealOption | null {
  let best: RevealOption | null = null;
  for (const o of h.options) if (o.kind === "lie" && o.pickers.length && (!best || o.pickers.length > best.pickers.length)) best = o;
  return best;
}

export function FinalScreen({ view, byId, me, accent }: { view: FibView; byId: ById; me: string; accent: string }) {
  const awards = view.awards;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return (
    <div className="grid gap-3 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @2xl:items-start">
      <div className="animate-rise flex flex-col gap-3">
        <Scoreboard scores={view.scores} byId={byId} order={Object.keys(view.scores)} highlight={me} title="Final standings" />
        {awards && (
          <section aria-label="Awards" className="card p-3">
            <h3 className="label mb-2">Awards</h3>
            <ul className="flex flex-col gap-2">
              <AwardRow
                icon="🤥"
                title="Best liar"
                award={awards.liar}
                detail={`Fooled ${plural(awards.liar.count, "player")} in total`}
                empty="Nobody fooled anybody. Suspiciously honest bunch."
                byId={byId}
                accent={accent}
                delay={150}
              />
              <AwardRow
                icon="🔍"
                title="Truth detector"
                award={awards.detector}
                detail={`Found ${awards.detector.count} of ${view.history.length} truths`}
                empty="Nobody found a single truth!"
                byId={byId}
                accent={accent}
                delay={300}
              />
            </ul>
          </section>
        )}
        {view.endedEarly && <p className="px-1 text-xs text-muted">The game ended early: too few players stayed connected.</p>}
      </div>
      <section aria-label="Every fact" className="card animate-rise p-3" style={{ animationDelay: "120ms" }}>
        <h3 className="label mb-2">Every fact</h3>
        {view.history.length === 0 && <p className="text-sm text-muted">No rounds were finished.</p>}
        <ol className="flex flex-col gap-1.5">
          {view.history.map((h) => {
            const [before, after] = splitPrompt(h.prompt);
            const fib = bestFib(h);
            return (
              <li key={h.round} className="flex flex-col gap-1 rounded-xl bg-panel-2/60 px-2.5 py-2 text-sm">
                <span className="[overflow-wrap:anywhere]">
                  <span className="mr-1.5 font-mono text-xs text-muted">{h.round}</span>
                  {before}
                  <b style={{ color: accent }}>{h.answer}</b>
                  {after}
                </span>
                {fib && (
                  <span className="pl-4 text-xs text-muted [overflow-wrap:anywhere]">
                    Best fib: “{fib.text}” by{" "}
                    {fib.authors.map((a, i) => (
                      <Fragment key={a}>
                        {i > 0 && " & "}
                        <Who player={byId[a]} you={a === me} />
                      </Fragment>
                    ))}{" "}
                    fooled {fib.pickers.length}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-muted">
          Scoring: find the truth +{POINTS.truth} · every player fooled by your fib +{POINTS.fooled}
        </p>
      </section>
    </div>
  );
}
