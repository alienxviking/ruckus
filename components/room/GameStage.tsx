"use client";

import { CATALOG_BY_ID } from "@/games/catalog";
import { GAME_CLIENTS } from "@/games/client-registry";
import type { Player, RoomView } from "@/shared/types";
import type { useRoom } from "@/lib/useRoom";
import { PlayerChip } from "../game-ui";
import { Confetti } from "../Confetti";
import { Component, type ReactNode } from "react";

export function GameStage({
  room,
  view,
  me,
  isHost,
  byId,
  r,
}: {
  room: RoomView;
  view: unknown;
  me: string;
  isHost: boolean;
  byId: Record<string, Player>;
  r: ReturnType<typeof useRoom>;
}) {
  const meta = CATALOG_BY_ID[room.gameId];
  const GameClient = GAME_CLIENTS[room.gameId];
  const players = room.participants.map((id) => byId[id]).filter(Boolean);
  const isPlayer = room.participants.includes(me);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 font-display text-xl font-bold">
          <span aria-hidden>{meta?.emoji}</span> {meta?.name}
          {!isPlayer && <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs font-medium text-muted">watching</span>}
        </h1>
        {isHost && !room.result && (
          <button
            className="btn px-3 py-1.5 text-sm"
            onClick={() => confirm("End this game for everyone?") && r.send({ t: "lobby" })}
          >
            End game
          </button>
        )}
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
              accent={meta?.accent ?? "#ff5d73"}
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
  const iWon = result.winners.includes(me);
  return (
    <div
      role="status"
      className="card animate-pop relative flex flex-col items-center gap-3 p-4 text-center sm:flex-row sm:justify-between sm:text-left"
      style={{ borderColor: accent, background: `linear-gradient(135deg, ${accent}22, transparent 70%), var(--color-panel)` }}
    >
      {result.winners.length > 0 && <Confetti pieces={iWon ? 40 : 22} />}
      <div>
        {iWon && <div className="label mb-1 text-brand-2">You won! 🎉</div>}
        <div className="font-display text-xl font-extrabold">
          <span aria-hidden className="animate-trophy mr-1">
            🏆
          </span>{" "}
          {result.headline}
        </div>
        {result.winners.length > 0 && (
          <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
            {result.winners.map((id) => (
              <PlayerChip key={id} player={byId[id]} size="sm" />
            ))}
          </div>
        )}
      </div>
      {isHost ? (
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={() => r.send({ t: "start" })}>
            Play again
          </button>
          <button className="btn" onClick={() => r.send({ t: "lobby" })}>
            Pick another
          </button>
        </div>
      ) : (
        <span className="text-sm text-muted">Waiting for the host…</span>
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
