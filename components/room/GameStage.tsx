"use client";

import { CATALOG_BY_ID } from "@/games/catalog";
import { GAME_CLIENTS } from "@/games/client-registry";
import type { Player, RoomView } from "@/shared/types";
import type { useRoom } from "@/lib/useRoom";
import { Trophy } from "lucide-react";
import { PlayerChip } from "../game-ui";
import { GameBadge } from "../GameBadge";
import { Magnetic } from "../Magnetic";
import { Confetti } from "../Confetti";
import { Component, useMemo, type ReactNode } from "react";

export function GameStage({
  room,
  view,
  me,
  isHost,
  byId,
  r,
  headerExtra,
}: {
  room: RoomView;
  view: unknown;
  me: string;
  isHost: boolean;
  byId: Record<string, Player>;
  r: ReturnType<typeof useRoom>;
  /** Extra controls on the right of the game header (the phone chat toggle). */
  headerExtra?: ReactNode;
}) {
  const meta = CATALOG_BY_ID[room.gameId];
  const GameClient = GAME_CLIENTS[room.gameId];
  // Stable across chat lines and pings, so the (memoised) game client only re-renders when
  // its own inputs change.
  const players = useMemo(() => room.participants.map((id) => byId[id]).filter(Boolean), [room.participants, byId]);
  const isPlayer = room.participants.includes(me);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex min-w-0 items-center gap-2.5 font-display text-xl font-bold tracking-tight">
          {meta && <GameBadge id={meta.id} accent={meta.accent} size="sm" sheen />}
          <span className="truncate">{meta?.name}</span>
          {!isPlayer && (
            <span className="label rounded-sm border border-line px-1.5 py-0.5 text-[10px]">watching</span>
          )}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          {isHost && !room.result && (
            <button
              className="btn px-3 py-1.5 text-sm"
              onClick={() => confirm("End this game for everyone?") && r.send({ t: "lobby" })}
            >
              End game
            </button>
          )}
          {headerExtra}
        </div>
      </div>

      {room.result && <ResultBanner room={room} byId={byId} me={me} isHost={isHost} r={r} accent={meta?.accent} />}

      <div className="min-h-[60vh]">
        {GameClient ? (
          <GameErrorBoundary key={room.gameSeq}>
            <GameClient
              view={view}
              me={me}
              players={players}
              byId={byId}
              isPlayer={isPlayer}
              isHost={isHost}
              act={r.act}
              serverNow={r.serverNow}
              rtt={r.ping.get}
              onEvent={r.onEvent}
              accent={meta?.accent ?? "#c6f432"}
            />
          </GameErrorBoundary>
        ) : (
          <p className="text-muted">Unknown game.</p>
        )}
      </div>
    </div>
  );
}

function ResultBanner({
  room,
  byId,
  me,
  isHost,
  r,
  accent,
}: {
  room: RoomView;
  byId: Record<string, Player>;
  me: string;
  isHost: boolean;
  r: ReturnType<typeof useRoom>;
  accent?: string;
}) {
  const result = room.result!;
  const a = accent ?? "#c6f432";
  const iWon = result.winners.includes(me);
  return (
    <div
      role="status"
      className="card result-banner relative flex flex-col items-center gap-4 p-4 text-center sm:flex-row sm:justify-between sm:p-5 sm:text-left"
      style={{
        borderColor: a + "aa",
        background: `radial-gradient(90% 140% at 0% 0%, ${a}2a, transparent 60%), var(--color-panel)`,
        boxShadow: `0 0 0 1px ${a}33, 0 20px 50px -24px ${a}`,
      }}
    >
      <span aria-hidden className="banner-sweep" />
      {result.winners.length > 0 && <Confetti pieces={iWon ? 40 : 22} />}
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
        <span
          aria-hidden
          className="game-badge animate-trophy size-14 rounded-xl"
          style={{ "--accent": "var(--color-brand-2)" } as React.CSSProperties}
          data-sheen="true"
        >
          <Trophy className="glyph" strokeWidth={1.75} />
        </span>
        <div>
          <div className={`label mb-1 ${iWon ? "text-brand-2" : ""}`}>{iWon ? "You won!" : "Game over"}</div>
          <div className="font-display text-xl font-bold tracking-tight sm:text-2xl">{result.headline}</div>
          {result.winners.length > 0 && (
            <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
              {result.winners.map((id) => (
                <PlayerChip key={id} player={byId[id]} size="sm" />
              ))}
            </div>
          )}
        </div>
      </div>
      {isHost ? (
        <div className="flex gap-2">
          <Magnetic>
            <button className="btn btn-primary" onClick={() => r.send({ t: "start" })}>
              Play again
            </button>
          </Magnetic>
          <button className="btn" onClick={() => r.send({ t: "lobby" })}>
            Pick another
          </button>
        </div>
      ) : (
        <span className="font-mono text-xs text-muted">Waiting for the host…</span>
      )}
    </div>
  );
}

class GameErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="card p-6 text-center">
          <p className="font-semibold">This game hit a snag on your screen.</p>
          <button className="btn mt-3" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
