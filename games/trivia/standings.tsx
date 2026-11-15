"use client";

// Side panels: who has locked in, the between-question leaderboard and the intro line-up.

import { PlayerChip } from "@/components/game-ui";
import type { Player } from "@/shared/types";
import type { PlayerLine } from "./server";
import { fmt } from "./shared";
import { Face, RankDelta, SectionTitle, cssVars, ordinal, personOf } from "./ui";

/** Players sorted by rank, ties kept in seat order. */
export function byRank(lines: PlayerLine[], key: "rank" | "prevRank" = "rank"): PlayerLine[] {
  const seat = new Map(lines.map((l, i) => [l.id, i]));
  return lines.slice().sort((a, b) => a[key] - b[key] || seat.get(a.id)! - seat.get(b.id)!);
}

export function LockedIn({
  lines,
  byId,
  me,
}: {
  lines: PlayerLine[];
  byId: Record<string, Player>;
  me: string;
}) {
  const inCount = lines.filter((l) => l.answered).length;
  const mine = lines.find((l) => l.id === me);
  return (
    <div className="card p-3">
      <SectionTitle aside={`${inCount}/${lines.length}`}>Locked in</SectionTitle>
      <ul className="flex flex-wrap gap-1.5 @2xl:flex-col">
        {lines.map((l) => {
          const p = personOf(byId, l.id);
          const state = l.answered ? "locked in" : p.connected ? "thinking" : "away";
          return (
            <li key={`${l.id}-${l.answered}`} className={`min-w-0 ${l.answered ? "animate-pop" : ""}`}>
              <span className="flex min-w-0 [&>span]:max-w-full">
                <PlayerChip player={p} size="sm" dim={!l.answered}>
                  <span className="sr-only">{state}</span>
                  <span aria-hidden className={l.answered ? "" : "text-muted"}>
                    {l.answered ? "🔒" : p.connected ? "…" : "💤"}
                  </span>
                </PlayerChip>
              </span>
            </li>
          );
        })}
      </ul>
      {mine && lines.length > 1 && (
        <p className="mt-2.5 border-t border-line pt-2 text-xs text-muted">
          You: <span className="font-mono font-bold text-text">{fmt(mine.score)}</span> pts · {ordinal(mine.rank)}
          {mine.streak >= 2 && <span className="text-orange-300"> · 🔥 {mine.streak} streak</span>}
        </p>
      )}
    </div>
  );
}

const ROW = 50; // row height (44px) + gap (6px), for the slide animation
const MAX_ROWS = 6;

export function Leaderboard({
  lines,
  byId,
  me,
  qNum,
  showDelta,
}: {
  lines: PlayerLine[];
  byId: Record<string, Player>;
  me: string;
  qNum: number;
  showDelta: boolean;
}) {
  const now = byRank(lines);
  const before = byRank(lines, "prevRank").map((l) => l.id);
  // Compact: top 5, plus the viewer if they are further down.
  let shown = now;
  if (now.length > MAX_ROWS) {
    const myIndex = now.findIndex((l) => l.id === me);
    shown = myIndex >= MAX_ROWS - 1 ? [...now.slice(0, MAX_ROWS - 1), now[myIndex]] : now.slice(0, MAX_ROWS);
  }
  return (
    <div className="@container/board card p-3">
      <SectionTitle aside={`after Q${qNum}`}>Standings</SectionTitle>
      <ol key={qNum} className="flex flex-col gap-1.5 overflow-hidden">
        {shown.map((l) => {
          const p = personOf(byId, l.id);
          const index = now.indexOf(l);
          const from = Math.max(-MAX_ROWS, Math.min(MAX_ROWS, before.indexOf(l.id) - index));
          const gain = l.outcome?.points ?? 0;
          return (
            <li
              key={l.id}
              className={`trv-slide flex h-11 items-center gap-1.5 rounded-xl px-1.5 ${l.id === me ? "bg-white/[0.07] ring-1 ring-white/10" : ""}`}
              style={cssVars({ "--trv-from": `${from * ROW}px` })}
            >
              <span className="w-5 shrink-0 text-right font-mono text-xs text-muted">{l.rank}</span>
              <RankDelta delta={l.prevRank - l.rank} show={showDelta} />
              <Face player={p} />
              {/* Narrow boards put this round's gain under the name; wide ones keep it on one line. */}
              <div className="min-w-0 flex-1 @sm/board:flex @sm/board:items-center @sm/board:gap-2">
                <div
                  className="truncate text-sm leading-tight font-semibold @sm/board:min-w-0 @sm/board:flex-1"
                  style={{ color: p.color }}
                >
                  {p.name}
                  {l.id === me && <span className="font-normal text-muted"> (you)</span>}
                </div>
                {(gain > 0 || l.streak >= 2) && (
                  <div className="flex gap-2 text-[11px] leading-tight font-bold @sm/board:shrink-0 @sm/board:text-xs">
                    {gain > 0 && <span className="font-mono text-green-300">+{fmt(gain)}</span>}
                    {l.streak >= 2 && (
                      <span className="text-orange-300" title={`${l.streak} correct in a row`}>
                        <span aria-hidden>🔥</span>
                        {l.streak}
                        <span className="sr-only"> in a row</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-sm font-bold tabular-nums">{fmt(l.score)}</span>
            </li>
          );
        })}
      </ol>
      {shown.length < now.length && (
        <p className="mt-1.5 text-center text-xs text-muted">+{now.length - shown.length} more</p>
      )}
    </div>
  );
}

/** Solo games have nobody to rank against, so show the running score instead. */
export function SoloStats({
  line,
  asked,
  revealing,
  accent,
}: {
  line: PlayerLine;
  asked: number;
  revealing: boolean;
  accent: string;
}) {
  const gain = revealing ? (line.outcome?.points ?? 0) : 0;
  return (
    <div className="card p-3">
      <SectionTitle aside={`${line.correct}/${asked} correct`}>Your score</SectionTitle>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl font-black tabular-nums" style={{ color: accent }}>
          {fmt(line.score)}
        </span>
        {gain > 0 && <span className="animate-pop font-mono text-sm font-bold text-green-300">+{fmt(gain)}</span>}
      </div>
      <p className="mt-1 text-xs text-muted">
        {line.streak >= 2 ? `🔥 ${line.streak} in a row` : "Answer streaks earn bonus points"}
      </p>
    </div>
  );
}

export function Lineup({ lines, byId }: { lines: PlayerLine[]; byId: Record<string, Player> }) {
  return (
    <div className="card p-3">
      <SectionTitle aside={lines.length === 1 ? "solo run" : `${lines.length} players`}>In this game</SectionTitle>
      <ul className="flex flex-wrap gap-1.5">
        {lines.map((l, i) => (
          <li key={l.id} className="animate-pop" style={{ animationDelay: `${i * 60}ms` }}>
            <PlayerChip player={personOf(byId, l.id)} size="sm" dim={!personOf(byId, l.id).connected} />
          </li>
        ))}
      </ul>
    </div>
  );
}
