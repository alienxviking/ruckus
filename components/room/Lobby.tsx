"use client";

import { CATALOG, CATALOG_BY_ID } from "@/games/catalog";
import type { ClientMsg, RoomView } from "@/shared/types";
import { GameCard } from "../GameCard";

export function Lobby({
  room,
  isHost,
  send,
}: {
  room: RoomView;
  isHost: boolean;
  send: (m: ClientMsg) => void;
}) {
  const game = CATALOG_BY_ID[room.gameId] ?? CATALOG[0];
  const online = room.players.filter((p) => p.connected).length;
  const host = room.players.find((p) => p.id === room.hostId);
  const tooFew = online < game.minPlayers;
  const tooMany = online > game.maxPlayers;

  return (
    <div className="flex flex-col gap-4">
      <div
        className="card animate-rise grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:p-6"
        style={{ borderColor: game.accent + "66", background: `linear-gradient(135deg, ${game.accent}14, transparent 60%), var(--color-panel)` }}
      >
        <div>
          <div className="label">{isHost ? "You picked" : `${host?.name ?? "The host"} picked`}</div>
          <h1 className="mt-1 flex items-center gap-3 font-display text-3xl font-extrabold sm:text-4xl">
            <span aria-hidden>{game.emoji}</span> {game.name}
          </h1>
          <ul className="mt-3 space-y-1.5 text-sm text-text/85">
            {game.how.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-bold" style={{ color: game.accent }}>
                  {i + 1}.
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col justify-end gap-2 sm:w-52">
          {isHost ? (
            <>
              <button
                className="btn btn-primary py-3 text-lg"
                disabled={tooFew}
                onClick={() => send({ t: "start" })}
              >
                Start game
              </button>
              <p className="text-center text-xs text-muted">
                {tooFew
                  ? `Needs ${game.minPlayers}+ players: invite friends!`
                  : tooMany
                    ? `First ${game.maxPlayers} play, the rest watch`
                    : `${online} ready · ${game.minPlayers}–${game.maxPlayers} players`}
              </p>
            </>
          ) : (
            <p className="rounded-xl bg-panel-2 px-4 py-3 text-center text-sm text-muted">
              Waiting for {host?.name ?? "the host"} to start…
            </p>
          )}
        </div>
      </div>

      {online < 2 && (
        <p className="card px-4 py-3 text-sm text-muted">
          👋 It&apos;s just you so far. Hit <b className="text-text">Invite</b> at the top to copy the room link and send
          it to friends.
        </p>
      )}

      <div>
        <h2 className="label mb-2">{isHost ? "Pick a game" : "Games"}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CATALOG.map((g) => (
            <GameCard
              key={g.id}
              game={g}
              selected={g.id === game.id}
              disabled={!isHost}
              onSelect={() => isHost && send({ t: "pick", gameId: g.id })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
