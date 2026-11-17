"use client";

// Presentational pieces for Fib Finder. Pure UI: everything arrives via props.

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PlayerChip, useTicker } from "@/components/game-ui";
import type { Player } from "@/shared/types";
import type { Awards, FibView, RevealOption, RoundSummary } from "./server";
import { POINTS, formatPoints, splitPrompt } from "./shared";
import { Avatar } from "@/components/Avatar";

// Small, game-scoped keyframes (hoisted and de-duplicated by React). Motion follows the
// app-wide conventions: entrances use cubic-bezier(.2,.8,.2,1) on transform + opacity,
// playful pops use the pop curve cubic-bezier(.2,1.4,.4,1). With prefers-reduced-motion
// every big motion is off (entrances become a short fade) and nothing is left hidden.
const CSS = `
@keyframes fib-in { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
.fib-in { animation: fib-in .32s cubic-bezier(.2,.8,.2,1) backwards }
@keyframes fib-fade { from { opacity: 0 } to { opacity: 1 } }
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
@keyframes fib-flip { from { transform: perspective(700px) rotateX(70deg) translateY(8px); opacity: 0 } to { transform: none; opacity: 1 } }
.fib-flip { animation: fib-flip .36s cubic-bezier(.2,.8,.2,1) backwards }
@keyframes fib-stamp { 0% { transform: scale(2.4) rotate(-16deg); opacity: 0 } 55% { transform: scale(.9) rotate(-7deg); opacity: 1 } 100% { transform: scale(1) rotate(-8deg); opacity: 1 } }
.fib-stamp { animation: fib-stamp .42s cubic-bezier(.2,1.4,.4,1) both }
@keyframes fib-strike { from { background-size: 0% 3px } to { background-size: 100% 3px } }
.fib-strike { background-image: linear-gradient(currentColor, currentColor); background-repeat: no-repeat; background-position: 0 55%; background-size: 100% 3px; animation: fib-strike .32s cubic-bezier(.2,.8,.2,1) .08s both }
@keyframes fib-burst { 0% { transform: translate(-50%,-50%) scale(.3); opacity: 0 } 20% { opacity: 1 } 100% { transform: translate(calc(var(--dx) - 50%), calc(var(--dy) - 50%)) scale(1.1); opacity: 0 } }
.fib-burst { animation: fib-burst 1.2s cubic-bezier(.15,.8,.3,1) both }
@keyframes fib-ring { 0% { box-shadow: 0 0 0 0 var(--fib-ring) } 70% { box-shadow: 0 0 0 8px transparent } 100% { box-shadow: 0 0 0 0 transparent } }
.fib-pulse { animation: fib-ring 1.6s ease-out infinite }
@keyframes fib-glow { from { box-shadow: 0 0 0 0 var(--fib-glow); opacity: 1 } to { box-shadow: 0 0 0 18px transparent; opacity: 0 } }
.fib-glow { animation: fib-glow .9s cubic-bezier(.2,.8,.2,1) .12s both }
@keyframes fib-lock { 0%, 100% { transform: none } 40% { transform: scale(1.03) } }
.fib-lock { animation: fib-lock .32s cubic-bezier(.2,1.4,.4,1) }
@keyframes fib-drum { 0%, 100% { transform: none; opacity: .45 } 50% { transform: translateY(-4px) scale(1.08); opacity: 1 } }
.fib-drum > span { display: inline-block; animation: fib-drum .54s ease-in-out infinite }
.fib-drum > span:nth-child(2) { animation-delay: .12s }
.fib-drum > span:nth-child(3) { animation-delay: .24s }
@media (prefers-reduced-motion: reduce) {
  .fib-in, .fib-flip { animation: fib-fade .15s ease backwards !important }
  .fib-shake-0, .fib-shake-1, .fib-dot, .fib-blank, .fib-stamp, .fib-strike, .fib-pulse, .fib-lock, .fib-drum > span { animation: none !important }
  .fib-burst, .fib-glow { display: none }
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
      <span aria-hidden><Avatar id={player.avatar} /> </span>
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
      fib: { color: "var(--color-brand)", background: "color-mix(in srgb, var(--color-brand) 12%, transparent)", borderColor: "var(--color-brand)" },
      truth: { color: accent, background: accent + "2e", borderColor: accent, boxShadow: `0 0 22px ${accent}55` },
    };
    blank = (
      <span
        key={fillKey}
        className={`mx-0.5 inline rounded-md border-b-[3px] px-1.5 font-extrabold transition-[color,background-color,border-color,box-shadow] duration-300 [overflow-wrap:anywhere] [box-decoration-break:clone] ${
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

/** What a revealed option says about who fell for it / who found it, and who scored. */
function stepLines(o: RevealOption, byId: ById, me: string, accent: string): { line: ReactNode; points: ReactNode } {
  if (o.kind === "truth") {
    if (!o.pickers.length) return { line: <>Nobody found the truth! 😱</>, points: null };
    return {
      line: (
        <>
          <WhoList ids={o.pickers} byId={byId} me={me} /> found the truth!
        </>
      ),
      points: (
        <span className="font-mono font-bold" style={{ color: accent }}>
          +{POINTS.truth}
          {o.pickers.length > 1 ? " each" : ""}
        </span>
      ),
    };
  }
  if (o.kind === "house") {
    return {
      line: (
        <>
          <WhoList ids={o.pickers} byId={byId} me={me} /> fell for a house fib!
        </>
      ),
      points: <span className="text-muted">Nobody scores for that one.</span>,
    };
  }
  const each = o.pickers.length * POINTS.fooled;
  return {
    line: (
      <>
        <WhoList ids={o.pickers} byId={byId} me={me} /> fell for <WhoList ids={o.authors} byId={byId} me={me} possessive /> fib!
      </>
    ),
    points: (
      <span className="flex flex-wrap items-center justify-center gap-1.5">
        {o.authors.map((a) => (
          <PlayerChip key={a} player={byId[a]} size="sm">
            <span className="font-mono font-bold text-green-300">+{formatPoints(each)}</span>
          </PlayerChip>
        ))}
      </span>
    ),
  };
}

/**
 * One option under the spotlight. The beats come from the server clock (so a reconnect
 * mid-step lands on the right beat): first the option and who picked it, then the stamp
 * (`stamped`), then whose fib it was and the points (`told`).
 */
function StepCard({
  s,
  index,
  byId,
  me,
  accent,
  stamped,
  told,
}: {
  s: RoundSummary;
  index: number;
  byId: ById;
  me: string;
  accent: string;
  stamped: boolean;
  told: boolean;
}) {
  const o = s.options[index];
  const truth = o.kind === "truth";
  const { line, points } = stepLines(o, byId, me, accent);
  const wonPoints = truth ? o.pickers.includes(me) : o.kind === "lie" && o.authors.includes(me);
  const judged: CSSProperties = truth
    ? { borderColor: accent, background: `radial-gradient(120% 120% at 50% 0%, ${accent}33, transparent 70%), var(--color-panel-2)` }
    : o.kind === "house"
      ? { borderColor: "var(--color-muted)", background: "var(--color-panel-2)" }
      : { borderColor: "color-mix(in srgb, var(--color-brand) 70%, transparent)", background: "radial-gradient(120% 120% at 50% 0%, color-mix(in srgb, var(--color-brand) 16%, transparent), transparent 70%), var(--color-panel-2)" };
  const ask: ReactNode = truth ? (
    <span className="inline-flex items-center gap-1.5">
      Who spotted it <Dots />
    </span>
  ) : (
    <>
      <WhoList ids={o.pickers} byId={byId} me={me} /> picked this…
    </>
  );
  return (
    <div
      className="fib-flip relative flex min-h-[11.5rem] min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border-2 px-3 py-4 text-center transition-[border-color] duration-300"
      style={stamped ? judged : { borderColor: "var(--color-line)", background: "var(--color-panel-2)" }}
    >
      {truth && <span aria-hidden className="fib-glow pointer-events-none absolute inset-0 rounded-2xl" style={{ "--fib-glow": accent + "aa" } as CssVars} />}
      <div className={`flex min-w-0 flex-col items-center gap-2 ${stamped && o.kind === "lie" ? "fib-shake-0" : ""}`}>
        <div className="flex h-8 items-center">
          {stamped ? (
            <KindTag kind={o.kind} accent={accent} />
          ) : (
            <span className="fib-blank rounded-full border border-line px-2.5 py-0.5 text-xs font-bold tracking-widest text-muted uppercase">
              Truth or fib?
            </span>
          )}
        </div>
        <p
          className={`font-display text-3xl leading-tight font-extrabold transition-colors duration-300 [overflow-wrap:anywhere] @md:text-4xl ${
            stamped && !truth ? "text-text/80" : ""
          }`}
          style={{ color: truth ? accent : undefined }}
        >
          “{o.text}”
        </p>
      </div>
      <div key={told ? "told" : "ask"} className="fib-in flex min-h-[3.5rem] flex-col items-center gap-1.5">
        <p className={`text-sm font-semibold @md:text-base ${told ? "" : "text-muted"}`}>{told ? line : ask}</p>
        {told && points && (
          <div className="animate-pop text-sm" style={{ animationDelay: "140ms" }}>
            {points}
          </div>
        )}
      </div>
      {told && wonPoints && <Burst />}
    </div>
  );
}

/** The beat before the truth: the real answer is about to drop. */
function Drumroll({ accent }: { accent: string }) {
  return (
    <div
      className="fib-in flex min-h-[11.5rem] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-3 py-4 text-center"
      style={{ borderColor: accent + "88", background: `radial-gradient(120% 120% at 50% 0%, ${accent}1a, transparent 70%), var(--color-panel-2)` }}
    >
      <span className="label" style={{ color: accent }}>
        <span aria-hidden>🥁 </span>Drumroll
      </span>
      <p aria-hidden className="fib-drum inline-flex gap-2 font-display text-4xl font-black" style={{ color: accent }}>
        <span>?</span>
        <span>?</span>
        <span>?</span>
      </p>
      <p className="text-sm font-semibold text-muted">The real answer is…</p>
    </div>
  );
}

/** One pip per reveal step: fibs in red, the truth in the accent colour. */
function StepPips({ s, step, done, accent }: { s: RoundSummary; step: number; done: boolean; accent: string }) {
  const truthNow = s.options[s.steps[step]]?.kind === "truth";
  const fibs = s.steps.length - 1;
  return (
    <div className="flex items-center justify-center gap-2.5 text-xs text-muted tabular-nums">
      <span aria-hidden className="flex items-center gap-2">
        {s.steps.map((optionIndex, i) => {
          const isTruth = s.options[optionIndex]?.kind === "truth";
          const lit = done || i <= step;
          const current = !done && i === step;
          return (
            <span
              key={i}
              className={`h-1.5 w-3 rounded-full transition-[transform,background-color] duration-300 ${current ? "scale-x-[1.6]" : ""}`}
              style={{ background: lit ? (isTruth ? accent : "var(--color-brand)") : "var(--color-line)" }}
            />
          );
        })}
      </span>
      <span>{truthNow || done ? "The truth" : `Fib ${step + 1} of ${fibs}`}</span>
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
        // Before its stamp lands the spotlighted row stays neutral, so the list can't spoil it.
        borderColor: current ? (!revealed ? "var(--color-muted)" : o.kind === "truth" ? accent : "color-mix(in srgb, var(--color-brand) 70%, transparent)") : undefined,
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
                <span aria-hidden className="inline-flex gap-1">{o.pickers.map((p) => <Avatar key={p} id={byId[p]?.avatar ?? "?"} />)}</span>
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

/** Beats inside one reveal step, as fractions of the step (the server sets the step length). */
const STAMP_AT = 0.3;
const TELL_AT = 0.48;
/** The truth's step opens with a drumroll; the answer drops at this point. */
const TRUTH_AT = 0.3;
const TRUTH_TELL_AT = 0.52;

/**
 * Where the walk-through is, from the server clock: the current step, how far into it
 * we are (`beat`, 0..1), and whether it's over (the hold before the next round).
 */
export function useRevealClock(revealAt: number, stepMs: number, steps: number, serverNow: () => number) {
  useTicker(100);
  if (!revealAt || stepMs <= 0 || steps <= 0) return { step: Math.max(0, steps - 1), beat: 1, done: true };
  const elapsed = serverNow() - revealAt;
  const done = elapsed >= steps * stepMs;
  const step = Math.max(0, Math.min(steps - 1, Math.floor(elapsed / stepMs)));
  const beat = done ? 1 : Math.max(0, Math.min(1, (elapsed - step * stepMs) / stepMs));
  return { step, beat, done };
}

export function RevealStage({
  s,
  step,
  beat,
  done,
  byId,
  me,
  accent,
}: {
  s: RoundSummary;
  step: number;
  beat: number;
  done: boolean;
  byId: ById;
  me: string;
  accent: string;
}) {
  const current = s.steps[step] ?? s.steps[s.steps.length - 1];
  const cur = s.options[current];
  const truthNow = cur?.kind === "truth";
  const drumroll = truthNow && !done && beat < TRUTH_AT;
  const stamped = done || beat >= (truthNow ? TRUTH_AT : STAMP_AT);
  const told = done || beat >= (truthNow ? TRUTH_TELL_AT : TELL_AT);
  const truthShown = truthNow && stamped;
  const isRevealed = (i: number) => {
    if (done) return true;
    const at = s.steps.indexOf(i);
    if (at >= 0 && at < step) return true;
    if (i === current) return stamped;
    return truthShown && at < 0; // fibs nobody picked are exposed along with the truth
  };
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
          fill={truthNow ? (drumroll ? null : s.answer) : cur?.text}
          fillStyle={truthNow ? "truth" : stamped ? "fib" : "pick"}
          fillKey={truthNow ? "truth" : current}
          compact
        />
        <section aria-label="Reveal" aria-live="polite" className="flex flex-col gap-2">
          {drumroll ? (
            <Drumroll key="drumroll" accent={accent} />
          ) : (
            cur && <StepCard key={current} s={s} index={current} byId={byId} me={me} accent={accent} stamped={stamped} told={told} />
          )}
          <StepPips s={s} step={step} done={done} accent={accent} />
        </section>
        {done && (
          <section aria-label="Round points" className="card fib-in relative flex flex-col items-center gap-2 p-3">
            <h3 className="label">Round {s.round} points</h3>
            {scorers.length ? (
              <div className="flex flex-wrap justify-center gap-1.5">
                {scorers.map(([id, p], i) => (
                  <span key={id} className="animate-pop" style={{ animationDelay: `${120 + i * 70}ms` }}>
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
              revealed={isRevealed(i)}
              current={!done && !drumroll && i === current}
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

const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A number that counts up (or down) to its new value instead of jumping. */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const live = useRef(value);
  useEffect(() => {
    const from = live.current;
    if (from === value) return;
    const ms = prefersReducedMotion() ? 0 : 700;
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const k = ms ? Math.min(1, (now - start) / ms) : 1;
      const v = Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3)));
      live.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{formatPoints(shown)}</>;
}

/**
 * Animate children marked with data-flip="<id>" from their old spot to the new one
 * whenever `order` changes (FLIP; transform only). Positions are kept relative to the
 * container, so the whole list moving down the page doesn't count as a reorder.
 */
function useFlip(order: string) {
  const box = useRef<HTMLDivElement>(null);
  const spots = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const base = el.getBoundingClientRect();
    const reduce = prefersReducedMotion();
    const next = new Map<string, { x: number; y: number }>();
    el.querySelectorAll<HTMLElement>("[data-flip]").forEach((item) => {
      const id = item.dataset.flip ?? "";
      const r = item.getBoundingClientRect();
      const spot = { x: r.left - base.left, y: r.top - base.top };
      next.set(id, spot);
      const before = spots.current.get(id);
      if (!before || reduce || typeof item.animate !== "function") return;
      const dx = before.x - spot.x;
      const dy = before.y - spot.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      item.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: 460,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
    });
    spots.current = next;
  }, [order]);
  return box;
}

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
  const box = useFlip(ids.join(","));
  return (
    <div ref={box} className="flex flex-wrap items-center gap-1.5" aria-label="Scores">
      <span className="label mr-1">Scores</span>
      {ids.map((id) => {
        const p = byId[id];
        if (!p) return null;
        const gain = gains?.[id] ?? 0;
        return (
          <span key={id} data-flip={id} className={id === me ? "rounded-full ring-1 ring-text/30" : ""}>
            <PlayerChip player={p} size="sm" dim={!p.connected}>
              <span className="font-mono font-bold text-text tabular-nums">
                <CountUp value={scores[id] ?? 0} />
              </span>
              {gain > 0 && <span className="animate-pop font-mono text-[10px] font-bold text-green-300">+{formatPoints(gain)}</span>}
              {id === me && <span className="sr-only">(you)</span>}
            </PlayerChip>
          </span>
        );
      })}
    </div>
  );
}

// ---------- final ----------

/** 1-based rank with ties sharing a place (two players on 900 are both 1st). */
export function rankOf(scores: Record<string, number>, id: string): number {
  const mine = scores[id] ?? 0;
  return 1 + Object.values(scores).filter((v) => v > mine).length;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Per player over the whole game: players fooled by their fibs, truths found. */
function gameStats(history: RoundSummary[]) {
  const fooled: Record<string, number> = {};
  const found: Record<string, number> = {};
  for (const h of history) {
    for (const o of h.options) {
      if (o.kind === "lie") for (const a of o.authors) fooled[a] = (fooled[a] ?? 0) + o.pickers.length;
      if (o.kind === "truth") for (const p of o.pickers) found[p] = (found[p] ?? 0) + 1;
    }
  }
  return { fooled, found };
}

const MEDALS = ["🥇", "🥈", "🥉"];

function Standings({ view, byId, me, accent }: { view: FibView; byId: ById; me: string; accent: string }) {
  const ids = Object.keys(view.scores).sort((a, b) => (view.scores[b] ?? 0) - (view.scores[a] ?? 0));
  const { fooled, found } = gameStats(view.history);
  const rounds = view.history.length;
  return (
    <section aria-label="Final standings" className="card p-3">
      <h3 className="label mb-2">Final standings</h3>
      <ol className="flex flex-col gap-1.5">
        {ids.map((id, i) => {
          const p = byId[id];
          if (!p) return null;
          const rank = rankOf(view.scores, id);
          const top = rank === 1 && (view.scores[id] ?? 0) > 0;
          return (
            <li
              key={id}
              className="fib-in flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-2"
              style={{
                animationDelay: `${i * 60}ms`,
                background: top ? accent + "1a" : id === me ? "var(--color-panel-2)" : undefined,
                boxShadow: id === me ? "inset 0 0 0 1px color-mix(in oklab, var(--color-text) 25%, transparent)" : undefined,
              }}
            >
              <span className="w-7 shrink-0 text-center">
                {rank <= 3 && (view.scores[id] ?? 0) > 0 ? (
                  <span aria-hidden className="text-xl leading-none">
                    {MEDALS[rank - 1]}
                  </span>
                ) : (
                  <span aria-hidden className="font-mono text-sm text-muted tabular-nums">
                    {rank}
                  </span>
                )}
                <span className="sr-only">{ordinal(rank)} place</span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <FitChip player={p} size="sm" dim={!p.connected} />
                <span className="pl-1 text-[11px] text-muted">
                  🔍 {found[id] ?? 0}/{rounds} truths · 🤥 fooled {fooled[id] ?? 0}
                  {id === me && <span className="sr-only"> (you)</span>}
                </span>
              </span>
              <span className="shrink-0 font-mono text-lg font-bold tabular-nums" style={top ? { color: accent } : undefined}>
                {formatPoints(view.scores[id] ?? 0)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

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
      <div className="flex flex-col gap-3">
        <Standings view={view} byId={byId} me={me} accent={accent} />
        {awards && (
          <section aria-label="Awards" className="card fib-in p-3" style={{ animationDelay: "160ms" }}>
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
                delay={320}
              />
              <AwardRow
                icon="🔍"
                title="Truth detector"
                award={awards.detector}
                detail={`Found ${awards.detector.count} of ${view.history.length} truths`}
                empty="Nobody found a single truth!"
                byId={byId}
                accent={accent}
                delay={460}
              />
            </ul>
          </section>
        )}
        {view.endedEarly && <p className="px-1 text-xs text-muted">The game ended early: too few players stayed connected.</p>}
      </div>
      <section aria-label="Every fact" className="card fib-in p-3" style={{ animationDelay: "220ms" }}>
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
