"use client";

import { CATALOG, CATALOG_BY_ID } from "@/games/catalog";
import type { ClientMsg, RoomView } from "@/shared/types";
import { GameBadge } from "../GameBadge";
import { GameBrowser } from "../GameBrowser";
import { Magnetic } from "../Magnetic";

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
        className="card lit-edge animate-rise relative grid gap-5 overflow-hidden p-5 transition-[border-color] duration-300 sm:grid-cols-[1fr_auto] sm:p-6"
        style={
          {
            "--accent": game.accent,
            borderColor: game.accent + "55",
            background: `radial-gradient(80% 120% at 0% 0%, ${game.accent}1c, transparent 60%), var(--color-panel)`,
          } as React.CSSProperties
        }
      >
        {/* Re-keyed per game so the details animate in when the host switches games. */}
        <div key={game.id} className="animate-rise">
          <div className="flex items-center gap-4">
            <GameBadge id={game.id} accent={game.accent} size="xl" className="animate-pop" sheen />
            <div className="min-w-0">
              <div className="label">{isHost ? "You picked" : `${host?.name ?? "The host"} picked`}</div>
              <h1 className="mt-1 font-hero text-2xl leading-tight font-extrabold tracking-[-0.03em] sm:text-3xl">
                {game.name}
              </h1>
            </div>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-text/85">
            {game.how.map((line, i) => (
              <li key={i} className="animate-rise flex gap-3" style={{ animationDelay: `${120 + i * 70}ms` }}>
                <span className="pt-px font-mono text-xs font-medium" style={{ color: game.accent }}>
                  0{i + 1}
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col justify-end gap-2 sm:w-52">
          {isHost ? (
            <>
              <Magnetic>
                <button
                  className="btn btn-primary w-full py-3 text-lg"
                  disabled={tooFew}
                  onClick={() => send({ t: "start" })}
                >
                  Start game
                </button>
              </Magnetic>
              <p className="text-center font-mono text-[11px] text-muted">
                {tooFew
                  ? `Needs ${game.minPlayers}+ players: invite friends!`
                  : tooMany
                    ? `First ${game.maxPlayers} play, the rest watch`
                    : `${online} ready · ${game.minPlayers}–${game.maxPlayers} players`}
              </p>
            </>
          ) : (
            <p className="rounded-lg border border-line bg-ink/60 px-4 py-3 text-center text-sm text-muted">
              Waiting for {host?.name ?? "the host"} to start…
            </p>
          )}
        </div>
      </div>

      {online < 2 && (
        <p className="card animate-rise flex items-center gap-3 px-4 py-3 text-sm text-muted">
          <span aria-hidden className="relative flex size-2 shrink-0">
            <span className="absolute inset-0 rounded-full bg-brand-2 motion-safe:animate-ping" />
            <span className="relative size-2 rounded-full bg-brand-2" />
          </span>
          <span>
          It&apos;s just you so far. Hit <b className="text-text">Invite</b> at the top to copy the room link and send
          it to friends.
          </span>
        </p>
      )}

      <div>
        <h2 className="label mb-3">{isHost ? "Pick a game" : "Games"}</h2>
        <GameBrowser
          selectedId={game.id}
          disabled={!isHost}
          playerCount={online}
          columns="sm:grid-cols-2 xl:grid-cols-3"
          onSelect={(g) => isHost && send({ t: "pick", gameId: g.id })}
        />
      </div>
    </div>
  );
}
