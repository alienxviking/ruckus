"use client";

// Small building blocks shared by game clients so every game feels like one app.

import { useEffect, useState, type ReactNode } from "react";
import type { Player } from "@/shared/types";
import { RollingNumber } from "./RollingNumber";
import { Avatar } from "@/components/Avatar";

export function PlayerChip({
  player,
  size = "md",
  dim,
  children,
}: {
  player: Player | undefined;
  size?: "sm" | "md";
  dim?: boolean;
  children?: ReactNode;
}) {
  if (!player) return null;
  const sm = size === "sm";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border font-semibold ${
        sm ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm"
      } ${dim ? "opacity-50" : ""}`}
      style={{
        borderColor: player.color + "55",
        background: `linear-gradient(180deg, ${player.color}24, ${player.color}10)`,
      }}
    >
      <span aria-hidden><Avatar id={player.avatar} /></span>
      <span style={{ color: player.color }} className="max-w-[9rem] truncate">
        {player.name}
      </span>
      {children}
    </span>
  );
}

/** Re-renders every `ms` so countdowns stay live. */
export function useTicker(ms = 200) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Seconds left until `endsAt` (server time), never negative. */
export function useSecondsLeft(endsAt: number | null | undefined, serverNow: () => number) {
  useTicker(200);
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((endsAt - serverNow()) / 1000));
}

/** A shrinking bar for a phase timer. */
export function TimerBar({
  endsAt,
  total,
  serverNow,
  color = "var(--color-brand)",
}: {
  endsAt: number | null | undefined;
  total: number;
  serverNow: () => number;
  color?: string;
}) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-panel-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
      role="progressbar"
      aria-label="Time left"
    >
      {endsAt && total > 0 ? (
        // Re-keyed per deadline: one compositor animation per phase, no per-tick renders.
        <TimerFill key={endsAt} endsAt={endsAt} total={total} serverNow={serverNow} color={color} />
      ) : null}
    </div>
  );
}

function TimerFill({ endsAt, total, serverNow, color }: { endsAt: number; total: number; serverNow: () => number; color: string }) {
  // Measured once when this deadline appears; the browser animates the rest.
  const [start] = useState(() => {
    const left = Math.max(0, endsAt - serverNow());
    return { left, from: Math.min(1, left / total) };
  });
  return (
    <div
      className={`h-full w-full origin-left rounded-full ${start.left > 0 ? "timer-fill" : ""}`}
      style={
        {
          background: `linear-gradient(90deg, color-mix(in oklab, ${color} 55%, transparent), ${color})`,
          transform: `scaleX(${start.left > 0 ? start.from : 0})`,
          animationDuration: `${start.left}ms`,
          "--from": start.from,
        } as React.CSSProperties
      }
    />
  );
}

/** Ranked score list. */
export function Scoreboard({
  scores,
  byId,
  order,
  highlight,
  title = "Scores",
}: {
  scores: Record<string, number>;
  byId: Record<string, Player>;
  /** Player ids to include; defaults to keys of `scores`. */
  order?: string[];
  highlight?: string;
  title?: string;
}) {
  const ids = (order ?? Object.keys(scores)).slice().sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  return (
    <div className="card p-3">
      <div className="label mb-2">{title}</div>
      <ol className="space-y-1.5">
        {ids.map((id) => {
          const p = byId[id];
          if (!p) return null;
          // Ties share a rank (1, 1, 3…).
          const rank = 1 + ids.filter((o) => (scores[o] ?? 0) > (scores[id] ?? 0)).length;
          return (
            <li
              key={id}
              className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 ${
                id === highlight ? "bg-panel-2 shadow-[inset_2px_0_0_var(--color-brand-2)]" : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-extrabold tabular-nums ${
                    rank === 1 ? "bg-sun text-ink" : "bg-panel-2 text-muted"
                  }`}
                >
                  {rank}
                </span>
                <PlayerChip player={p} size="sm" dim={!p.connected} />
              </span>
              <RollingNumber value={scores[id] ?? 0} className="font-mono font-bold tabular-nums" />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Big status line at the top of a game. */
export function StatusBanner({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <div
      className="card lit-edge animate-rise px-4 py-3 text-center font-display text-lg font-bold tracking-tight sm:text-xl"
      style={
        accent
          ? ({
              "--accent": accent,
              borderColor: accent + "55",
              background: `linear-gradient(180deg, ${accent}12, transparent 70%), var(--color-panel)`,
            } as React.CSSProperties)
          : undefined
      }
    >
      {children}
    </div>
  );
}

/** Centered "waiting" / "you're spectating" note. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-center text-sm text-muted">{children}</p>;
}
