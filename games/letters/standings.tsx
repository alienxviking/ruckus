"use client";

// Between-round results and the final standings screen.

import { useState } from "react";
import { PlayerChip } from "@/components/game-ui";
import type { Player } from "@/shared/types";
import type { Cell, LettersView, RoundSummary } from "./shared";
import { Board } from "./board";
import { playerOf } from "./ui";

const MEDALS = ["🥇", "🥈", "🥉"];

/** Players by total score, with shared ranks for ties (1, 1, 3). */
function ranked(order: string[], scores: number[]) {
  const rows = order.map((id, k) => ({ id, k, total: scores[k] ?? 0 }));
  rows.sort((a, b) => b.total - a.total || a.k - b.k);
  return rows.map((r) => ({ ...r, rank: 1 + rows.filter((o) => o.total > r.total).length }));
}

function tally(round: RoundSummary | null | undefined, k: number): string {
  if (!round) return "";
  const n = (s: Cell["status"]) => round.cells.reduce((sum, row) => sum + (row[k]?.status === s ? 1 : 0), 0);
  const parts = [
    [n("unique"), "unique"],
    [n("shared"), "shared"],
    [n("vetoed"), "vetoed"],
  ] as const;
  const text = parts.filter(([c]) => c > 0).map(([c, label]) => `${c} ${label}`);
  return text.length ? text.join(" · ") : "No points this round";
}

export function RoundResults({
  view,
  byId,
  accent,
}: {
  view: LettersView;
  byId: Record<string, Player>;
  accent: string;
}) {
  const rows = ranked(view.order, view.scores);
  const gains = view.recap?.points ?? [];
  const bestGain = Math.max(0, ...gains);
  const hotStreak = gains.filter((g) => g === bestGain).length === 1 ? gains.indexOf(bestGain) : -1;
  return (
    <ol className="card flex flex-col gap-1 p-2 @sm:p-3" aria-label="Standings after this round">
      {rows.map((r, i) => {
        const p = playerOf(byId, r.id);
        const gained = gains[r.k] ?? 0;
        const lead = r.rank === 1 && r.total > 0;
        return (
          <li
            key={r.id}
            className={`animate-rise flex items-center gap-2 rounded-xl px-2 py-2 ${r.k === view.you ? "bg-panel-2/80" : ""}`}
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <span className="w-5 shrink-0 text-right font-mono text-sm text-muted tabular-nums">{r.rank}</span>
            <div className="min-w-0 flex-1">
              <PlayerChip player={p} dim={!p.connected}>
                {lead && (
                  <span role="img" aria-label="leader">
                    👑
                  </span>
                )}
              </PlayerChip>
              <p className="mt-1 truncate pl-1 text-xs text-muted">{tally(view.recap, r.k)}</p>
            </div>
            <span
              className="animate-pop font-display text-xl font-extrabold whitespace-nowrap tabular-nums"
              style={{ color: gained ? accent : "var(--color-muted)", animationDelay: `${250 + i * 90}ms` }}
            >
              {r.k === hotStreak && (
                <span role="img" aria-label="best round" className="mr-1 text-base">
                  🔥
                </span>
              )}
              +{gained}
            </span>
            <span className="w-12 shrink-0 text-right font-mono text-lg font-bold tabular-nums">
              {r.total}
              <span className="sr-only"> points in total</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function FinalStandings({
  view,
  byId,
  accent,
}: {
  view: LettersView;
  byId: Record<string, Player>;
  accent: string;
}) {
  const history = view.history ?? [];
  const awards = view.awards ?? [];
  const rows = ranked(view.order, view.scores);
  const [tab, setTab] = useState(0);
  const shown = history[Math.min(tab, history.length - 1)];

  return (
    <div className="flex flex-col gap-3">
      {view.endedEarly && (
        <p className="card px-4 py-2.5 text-center text-sm text-muted">
          Ended after round {history.length}: not enough players stayed online.
        </p>
      )}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <caption className="px-3 pt-3 pb-1 text-left font-display text-lg font-bold">Final standings</caption>
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="w-10 py-1.5 pl-3 text-left font-semibold">
                #
              </th>
              <th scope="col" className="py-1.5 text-left font-semibold">
                Player
              </th>
              {history.map((h) => (
                <th key={h.round} scope="col" className="w-9 py-1.5 text-center font-display font-bold">
                  <span className="sr-only">Round {h.round}, letter </span>
                  {h.letter}
                </th>
              ))}
              <th scope="col" className="w-14 py-1.5 pr-3 text-right font-semibold">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const p = playerOf(byId, r.id);
              const top = r.rank === 1 && r.total > 0;
              return (
                <tr
                  key={r.id}
                  className="animate-rise border-t border-line/70"
                  style={{
                    animationDelay: `${i * 70}ms`,
                    background: top ? `linear-gradient(90deg, ${accent}26, transparent 85%)` : undefined,
                  }}
                >
                  <td className="py-2 pl-3 text-base">
                    {r.total > 0 && r.rank <= 3 ? (
                      <span role="img" aria-label={`Rank ${r.rank}`}>
                        {MEDALS[r.rank - 1]}
                      </span>
                    ) : (
                      <span className="pl-1 font-mono text-sm text-muted">{r.rank}</span>
                    )}
                  </td>
                  <td className="max-w-0 py-2 pr-2">
                    <PlayerChip player={p} size="sm" dim={!p.connected} />
                  </td>
                  {history.map((h) => (
                    <td key={h.round} className="py-2 text-center font-mono text-muted tabular-nums">
                      {h.points[r.k] ?? 0}
                    </td>
                  ))}
                  <td className="py-2 pr-3 text-right font-mono text-base font-bold tabular-nums">{r.total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {awards.length > 0 && (
        <ul className="grid gap-2 @lg:grid-cols-2" aria-label="Awards">
          {awards.map((a, i) => (
            <li
              key={a.title}
              className="card animate-pop flex items-center gap-3 p-3"
              style={{ animationDelay: `${300 + i * 120}ms` }}
            >
              <span aria-hidden className="text-2xl">
                {a.icon}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold">{a.title}</p>
                <p className="text-xs text-muted">
                  {a.players.map((k, j) => {
                    const p = playerOf(byId, view.order[k]);
                    return (
                      <span key={k}>
                        {j > 0 && " & "}
                        <span className="font-semibold" style={{ color: p.color }}>
                          {p.avatar} {p.name}
                        </span>
                      </span>
                    );
                  })}{" "}
                  · {a.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {shown && (
        <section aria-label="Every answer" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <h3 className="font-display text-base font-bold">Every answer</h3>
            <div role="group" aria-label="Choose a round" className={`flex gap-1.5 ${history.length < 2 ? "hidden" : ""}`}>
              {history.map((h, i) => (
                <button
                  key={h.round}
                  type="button"
                  aria-pressed={h === shown}
                  onClick={() => setTab(i)}
                  className={`btn h-10 min-w-10 px-3 py-1 text-sm ${h === shown ? "text-ink" : "text-muted"}`}
                  style={h === shown ? { background: accent, borderColor: accent } : undefined}
                >
                  <span className="sr-only">Round {h.round}, letter </span>
                  {h.letter}
                </button>
              ))}
            </div>
          </div>
          <Board
            categories={shown.categories}
            rows={shown.cells}
            order={view.order}
            you={view.you}
            byId={byId}
            letter={shown.letter}
            accent={accent}
          />
        </section>
      )}
    </div>
  );
}
