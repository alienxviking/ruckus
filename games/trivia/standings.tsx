"use client";

// Side panels: who has locked in, the between-question leaderboard and the intro line-up.

import { useLayoutEffect, useRef } from "react";
import { PlayerChip } from "@/components/game-ui";
import type { Player } from "@/shared/types";
import type { PlayerLine } from "./server";
import { fmt } from "./shared";
import { CountUp, EASE_OUT, Face, RankDelta, SectionTitle, cssVars, motionOK, ordinal, personOf } from "./ui";

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
    <div className="card trv-fade p-3">
      <SectionTitle aside={`${inCount}/${lines.length}`}>Locked in</SectionTitle>
      <ul className="flex flex-wrap gap-1.5 @2xl:flex-col">
        {lines.map((l) => {
          const p = personOf(byId, l.id);
          const state = l.answered ? "locked in" : p.connected ? "thinking" : "away";
          return (
            // Re-keyed on lock-in so the chip pops when that player answers.
            <li key={`${l.id}-${l.answered}`} className={`min-w-0 ${l.answered ? "trv-pop" : ""}`}>
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

const MAX_ROWS = 6;
/** Reveal choreography: answers pop first, then the board re-sorts and the scores tick up. */
const MOVE_DELAY = 380;
const MOVE_MS = 700;

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
  const listRef = useRef<HTMLOListElement>(null);
  const now = byRank(lines);
  const before = byRank(lines, "prevRank").map((l) => l.id);
  // Compact: top 5, plus the viewer pinned last if they are further down.
  let shown = now;
  let pinned = false;
  if (now.length > MAX_ROWS) {
    const myIndex = now.findIndex((l) => l.id === me);
    pinned = myIndex >= MAX_ROWS - 1;
    shown = pinned ? [...now.slice(0, MAX_ROWS - 1), now[myIndex]] : now.slice(0, MAX_ROWS);
  }
  const topSlots = pinned ? shown.length - 1 : shown.length;
  /** Which row slot a player sat in before this question (-1: they come up from below the cut). */
  const slotBefore = (id: string) => {
    const old = before.indexOf(id);
    if (old !== -1 && old < topSlots) return old;
    return id === me && old !== -1 ? shown.length - 1 : -1;
  };

  // FLIP: rows render in their new order; measure where each one is now and where
  // its old slot is, start it there with a transform and let it glide home.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !motionOK()) return;
    const rows = Array.from(list.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
    if (!rows.length || typeof rows[0].animate !== "function") return;
    const tops = rows.map((r) => r.offsetTop);
    const below = tops[tops.length - 1] + rows[rows.length - 1].offsetHeight + 6;
    const anims: Animation[] = [];
    rows.forEach((row, i) => {
      const from = Number(row.dataset.from);
      if (!Number.isInteger(from) || from === i) return;
      const enter = from < 0 || from >= rows.length;
      const dy = (enter ? below : tops[from]) - tops[i];
      if (!dy && !enter) return;
      anims.push(
        row.animate(
          [
            { transform: `translateY(${dy}px)`, opacity: enter ? 0 : 1 },
            { transform: "translateY(0)", opacity: 1 },
          ],
          // Climbers travel slightly ahead of fallers so the overtakes read clearly.
          { duration: MOVE_MS, delay: MOVE_DELAY + (dy < 0 ? 0 : 60), easing: EASE_OUT, fill: "backwards" },
        ),
      );
    });
    return () => anims.forEach((a) => a.cancel());
  }, [qNum]);

  return (
    <div className="@container/board card trv-fade p-3">
      <SectionTitle aside={`after Q${qNum}`}>Standings</SectionTitle>
      <ol key={qNum} ref={listRef} className="relative flex flex-col gap-1.5 overflow-hidden">
        {shown.map((l, i) => {
          const p = personOf(byId, l.id);
          const gain = l.outcome?.points ?? 0;
          const climbed = slotBefore(l.id) > i;
          return (
            <li
              key={l.id}
              data-from={slotBefore(l.id)}
              className={`flex h-11 items-center gap-1.5 rounded-xl px-1.5 ${climbed ? "relative z-[1]" : ""} ${
                l.id === me ? "bg-white/[0.07] ring-1 ring-white/10" : ""
              }`}
            >
              <span className="w-5 shrink-0 text-right font-mono text-xs text-muted">{l.rank}</span>
              <RankDelta delta={l.prevRank - l.rank} show={showDelta} delay={MOVE_DELAY + MOVE_MS - 150} />
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
                  <div
                    className="trv-pop flex gap-2 text-[11px] leading-tight font-bold @sm/board:shrink-0 @sm/board:text-xs"
                    style={cssVars({ "--d": "200ms" })}
                  >
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
              <CountUp
                value={l.score}
                from={l.score - gain}
                delay={MOVE_DELAY}
                duration={MOVE_MS}
                className="w-14 shrink-0 text-right font-mono text-sm font-bold tabular-nums"
              />
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
        <CountUp
          value={line.score}
          from={line.score - gain}
          delay={MOVE_DELAY}
          duration={MOVE_MS}
          className="font-display text-3xl font-black tabular-nums"
          style={{ color: accent }}
        />
        {gain > 0 && (
          <span className="trv-pop font-mono text-sm font-bold text-green-300" style={cssVars({ "--d": "200ms" })}>
            +{fmt(gain)}
          </span>
        )}
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
          <li key={l.id} className="trv-pop" style={cssVars({ "--d": `${120 + i * 50}ms` })}>
            <PlayerChip player={personOf(byId, l.id)} size="sm" dim={!personOf(byId, l.id).connected} />
          </li>
        ))}
      </ul>
    </div>
  );
}
