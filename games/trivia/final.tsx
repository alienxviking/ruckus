"use client";

// Final screen: podium (top 3), everyone's stats, and a recap of every answer.

import type { Player } from "@/shared/types";
import type { PlayerLine, TriviaView } from "./server";
import { CATEGORY_EMOJI, fmt } from "./shared";
import { byRank } from "./standings";
import { CountUp, MEDALS, cssVars, ordinal, personOf, seconds } from "./ui";

const PODIUM_HEIGHT = ["h-28 @lg:h-32", "h-20 @lg:h-24", "h-14 @lg:h-16"];

function Podium({ top, byId }: { top: PlayerLine[]; byId: Record<string, Player> }) {
  // Classic layout: 2nd, 1st, 3rd.
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  return (
    <div className="flex items-end justify-center gap-2 px-1 pt-2 @lg:gap-4" role="list" aria-label="Podium">
      {order.map((l) => {
        const p = personOf(byId, l.id);
        const place = Math.min(3, l.rank);
        return (
          <div
            key={l.id}
            role="listitem"
            className="trv-rise flex w-[31%] max-w-[10rem] min-w-0 flex-col items-center gap-1"
            style={cssVars({ "--d": `${(3 - place) * 180 + 100}ms` })}
          >
            <span className="text-3xl @lg:text-4xl" aria-hidden>
              {p.avatar}
            </span>
            <span className="max-w-full truncate text-sm font-bold" style={{ color: p.color }}>
              {p.name}
            </span>
            <CountUp
              value={l.score}
              from={0}
              delay={(3 - place) * 180 + 150}
              duration={900}
              className="font-mono text-sm font-bold tabular-nums"
            />
            <div
              className={`trv-bar flex w-full ${PODIUM_HEIGHT[place - 1]} items-start justify-center rounded-t-xl pt-2`}
              style={{
                background: `linear-gradient(180deg, ${p.color}59, ${p.color}14)`,
                borderTop: `3px solid ${p.color}`,
                animationDelay: `${(3 - place) * 180}ms`,
              }}
            >
              <span className="text-2xl @lg:text-3xl" aria-label={`${ordinal(l.rank)} place`}>
                {MEDALS[place - 1]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SoloCard({ line, asked, accent, title }: { line: PlayerLine; asked: number; accent: string; title: string }) {
  const stats = [
    { label: "Correct", value: `${line.correct}/${asked}` },
    { label: "Best streak", value: line.bestStreak ? `🔥 ${line.bestStreak}` : "–" },
    { label: "Fastest", value: seconds(line.fastestMs) },
  ];
  return (
    <div
      className="card animate-rise flex flex-col items-center gap-3 p-5 text-center"
      style={{ borderColor: accent + "66", background: `radial-gradient(120% 90% at 50% 0%, ${accent}1f, transparent 60%), var(--color-panel)` }}
    >
      <span className="label">{title}</span>
      <CountUp
        value={line.score}
        from={0}
        delay={200}
        duration={1100}
        className="font-display text-5xl font-black tabular-nums"
        style={{ color: accent }}
      />
      <span className="-mt-2 text-sm text-muted">points</span>
      <div className="grid w-full max-w-sm grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-panel-2 px-2 py-2">
            <div className="font-mono text-lg font-bold">{s.value}</div>
            <div className="text-[11px] text-muted">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FinalScreen({
  view,
  me,
  byId,
  accent,
}: {
  view: TriviaView;
  me: string;
  byId: Record<string, Player>;
  accent: string;
}) {
  const ranked = byRank(view.players);
  const solo = view.players.length === 1;
  const anyPoints = ranked.some((l) => l.score > 0);
  const mine = view.players.find((l) => l.id === me);
  const recap = view.recap ?? [];

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-center font-display text-2xl font-black">
        <span aria-hidden>🏁</span> Final standings
      </h2>

      {solo ? (
        <SoloCard
          line={ranked[0]}
          asked={view.asked}
          accent={accent}
          title={mine ? "Your run" : `${personOf(byId, ranked[0].id).name}'s run`}
        />
      ) : anyPoints ? (
        <Podium top={ranked.slice(0, 3)} byId={byId} />
      ) : (
        <p className="card p-4 text-center text-muted">No points this time. The questions won! 🧠</p>
      )}

      {!solo && (
        <div className="card p-1.5">
          <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-1.5 text-[11px] text-muted" aria-hidden>
            <span>✓ correct · ⚡ fastest right answer · 🔥 best streak</span>
            <span>points</span>
          </div>
          <ol className="divide-y divide-line/70" aria-label="All players">
            {ranked.map((l, i) => {
              const p = personOf(byId, l.id);
              const isMe = l.id === me;
              return (
                <li
                  key={l.id}
                  className={`trv-rise flex items-center gap-2.5 rounded-xl px-2 py-2 ${isMe ? "bg-white/[0.06]" : ""}`}
                  style={cssVars({ "--d": `${250 + Math.min(i, 8) * 40}ms` })}
                >
                  <span className="w-7 shrink-0 text-center font-mono text-sm font-bold text-muted">
                    {anyPoints && l.rank <= 3 ? (
                      <span className="text-xl" aria-label={`${ordinal(l.rank)} place`}>
                        {MEDALS[l.rank - 1]}
                      </span>
                    ) : (
                      l.rank
                    )}
                  </span>
                  <span className="text-xl" aria-hidden>
                    {p.avatar}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold" style={{ color: p.color }}>
                      {p.name}
                      {isMe && <span className="font-normal text-muted"> (you)</span>}
                    </div>
                    <div className="flex flex-wrap gap-x-3 text-xs text-muted tabular-nums">
                      <span className="whitespace-nowrap" title="Correct answers">
                        <span aria-hidden>✓ </span>
                        {l.correct}/{view.asked}
                        <span className="sr-only"> correct,</span>
                      </span>
                      <span className="whitespace-nowrap" title="Fastest correct answer">
                        <span aria-hidden>⚡ </span>
                        <span className="sr-only">fastest correct answer </span>
                        {seconds(l.fastestMs)}
                      </span>
                      {l.bestStreak >= 2 && (
                        <span className="whitespace-nowrap" title="Best streak">
                          <span aria-hidden>🔥 </span>
                          <span className="sr-only">, best streak </span>
                          {l.bestStreak}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-lg font-bold tabular-nums">{fmt(l.score)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {recap.length > 0 && (
        <details className="card group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-[1.1rem] px-4 py-2.5 font-semibold [&::-webkit-details-marker]:hidden">
            <span>
              <span aria-hidden>📋</span> Answers recap
            </span>
            <span className="flex items-center gap-2 text-xs font-normal text-muted">
              {mine && `you got ${mine.correct}/${view.asked}`}
              <span aria-hidden className="transition-transform group-open:rotate-180">
                ▾
              </span>
            </span>
          </summary>
          <ol className="flex flex-col gap-2 px-3 pb-3">
            {recap.map((r, i) => {
              const got = r.correct.includes(me);
              return (
                <li key={i} className="rounded-xl bg-panel-2 p-2.5 text-sm">
                  <div className="flex gap-2">
                    <span className="w-5 shrink-0 text-right font-mono text-xs leading-5 text-muted">{i + 1}</span>
                    <span className="min-w-0">
                      <span aria-hidden>{CATEGORY_EMOJI[r.cat]} </span>
                      {r.text}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pl-7">
                    <span className="font-semibold text-green-300">✓ {r.answer}</span>
                    <span className="text-xs text-muted">
                      {r.correct.length}/{view.players.length} got it
                      {mine && (got ? " · you ✓" : " · you ✗")}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </div>
  );
}
