"use client";

// Small building blocks shared by game clients so every game feels like one app.

import { useEffect, useState, type ReactNode } from "react";
import type { Player } from "@/shared/types";

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
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${
        sm ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm"
      } ${dim ? "opacity-50" : ""}`}
      style={{ borderColor: player.color + "66", background: player.color + "1f" }}
    >
      <span aria-hidden>{player.avatar}</span>
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
    <div className="h-2 w-full overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-label="Time left">
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
          background: color,
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
        {ids.map((id, i) => {
          const p = byId[id];
          if (!p) return null;
          return (
            <li
              key={id}
              className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${
                id === highlight ? "bg-panel-2" : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 text-right text-xs text-muted tabular-nums">{i + 1}</span>
                <PlayerChip player={p} size="sm" dim={!p.connected} />
              </span>
              <span className="font-mono font-bold tabular-nums">{(scores[id] ?? 0).toLocaleString()}</span>
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
      className="card animate-rise px-4 py-3 text-center font-display text-lg font-bold sm:text-xl"
      style={accent ? { borderColor: accent + "66" } : undefined}
    >
      {children}
    </div>
  );
}

/** Centered "waiting" / "you're spectating" note. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-center text-sm text-muted">{children}</p>;
}
