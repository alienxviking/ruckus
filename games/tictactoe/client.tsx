"use client";

import type { GameClientProps } from "@/shared/client-game";
import { PlayerChip, StatusBanner } from "@/components/game-ui";
import type { TttAction, TttView } from "./server";

const SYMBOL = ["✕", "◯"];

export default function TicTacToe({ view, byId, act }: GameClientProps<TttView, TttAction>) {
  if (!view) return null;
  const [px, po] = [byId[view.seats[0]], byId[view.seats[1]]];
  const myTurn = view.you !== null && view.turn === view.you && !view.roundEnd && view.winner === null;
  const turnPlayer = byId[view.seats[view.turn]];

  let status: React.ReactNode;
  if (view.winner !== null) {
    status = <>{byId[view.seats[view.winner]]?.name} wins the match! 🏆</>;
  } else if (view.roundEnd) {
    status =
      view.roundEnd.winner === null ? (
        "Draw! Next round…"
      ) : (
        <>{byId[view.seats[view.roundEnd.winner]]?.name} takes round {view.round}</>
      );
  } else if (myTurn) {
    status = <>Your move ({SYMBOL[view.you!]})</>;
  } else {
    status = <>{turnPlayer?.name ?? "…"} is thinking…</>;
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <StatusBanner>{status}</StatusBanner>

      <div className="flex items-center justify-between gap-2">
        {[px, po].map((p, i) => (
          <div key={i} className={`flex items-center gap-2 ${i === 1 ? "flex-row-reverse" : ""}`}>
            <PlayerChip player={p}>
              <span className="font-bold opacity-80">{SYMBOL[i]}</span>
            </PlayerChip>
            <span className="font-mono text-2xl font-bold tabular-nums">{view.score[i]}</span>
          </div>
        ))}
      </div>
      <p className="-mt-2 text-center text-xs text-muted">
        Round {view.round} · first to {view.target}
        {view.you === null && " · you're watching"}
      </p>

      <div className="grid aspect-square grid-cols-3 gap-2">
        {view.board.map((cell, i) => {
          const inLine = view.roundEnd?.line?.includes(i);
          const owner = cell === null ? null : byId[view.seats[cell]];
          return (
            <button
              key={i}
              aria-label={`Cell ${i + 1}${cell !== null ? `, ${SYMBOL[cell]}` : ""}`}
              disabled={!myTurn || cell !== null}
              onClick={() => act({ type: "place", cell: i })}
              className={`card flex items-center justify-center text-6xl font-black transition-colors sm:text-7xl ${
                myTurn && cell === null ? "cursor-pointer hover:bg-panel-2" : ""
              } ${inLine ? "ring-4" : ""}`}
              style={{
                color: owner?.color,
                ...(inLine ? { ["--tw-ring-color" as string]: owner?.color } : {}),
              }}
            >
              {cell !== null && <span className="animate-pop">{SYMBOL[cell]}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
