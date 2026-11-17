"use client";

import { CATALOG, CATALOG_BY_ID } from "@/games/catalog";
import type { ClientMsg, Player, RoomView } from "@/shared/types";
import { GAME_CONFIG } from "@/games/config";
import { GameSettings } from "./GameSettings";
import { RecapCard } from "./Recap";
import { GameBadge } from "../GameBadge";
import { GameBrowser } from "../GameBrowser";
import { Magnetic } from "../Magnetic";
import { HowToPlay } from "./HowToPlay";
import { useEffect, useRef, useState } from "react";

export function Lobby({
  room,
  isHost,
  send,
  words,
}: {
  room: RoomView;
  isHost: boolean;
  send: (m: ClientMsg) => void;
  words: { gameId: string; words: Record<string, string[]> } | null;
  byId?: Record<string, Player>;
}) {
  const game = CATALOG_BY_ID[room.gameId] ?? CATALOG[0];
  // Practice bots only count for games they can play.
  const botsPlay = !!GAME_CONFIG[game.id]?.bots;
  const online = room.players.filter((p) => p.connected && (!p.bot || botsPlay)).length;
  const humans = room.players.filter((p) => p.connected && !p.bot).length;
  const host = room.players.find((p) => p.id === room.hostId);
  const tooFew = online < game.minPlayers;
  const tooMany = online > game.maxPlayers;

  // When the big Start button scrolls out of view (the host is browsing games further
  // down), a floating pill offers Start right where they are.
  const heroRef = useRef<HTMLDivElement>(null);
  const [heroHidden, setHeroHidden] = useState(false);
  useEffect(() => {
    const el = heroRef.current;
    if (!el || !isHost) return;
    const io = new IntersectionObserver(([e]) => setHeroHidden(!e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [isHost]);
  const showPill = isHost && heroHidden;

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={heroRef}
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
          <HowToPlay gameId={game.id} className="mt-4" />
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
                  ? botsPlay
                    ? `Needs ${game.minPlayers}+ players: invite friends or add a bot`
                    : `Needs ${game.minPlayers}+ players: invite friends!`
                  : tooMany
                    ? `First ${game.maxPlayers} play, the rest watch`
                    : `${online} ready · ${game.minPlayers}–${game.maxPlayers} players`}
              </p>
              <QuickPlaySwitch on={room.autoNext} onChange={(on) => send({ t: "auto", on })} />
            </>
          ) : (
            <>
              <p className="rounded-lg border border-line bg-ink/60 px-4 py-3 text-center text-sm text-muted">
                Waiting for {host?.name ?? "the host"} to start…
              </p>
              {room.autoNext && (
                <p className="text-center font-mono text-[11px] text-brand-2">Quick play is on: games roll on by themselves</p>
              )}
            </>
          )}
        </div>
      </div>

      <GameSettings room={room} isHost={isHost} send={send} words={words} />
      <RecapCard room={room} />

      {humans < 2 && (
        <p className="card animate-rise flex items-center gap-3 px-4 py-3 text-sm text-muted">
          <span aria-hidden className="relative flex size-2 shrink-0">
            <span className="absolute inset-0 rounded-full bg-brand-2 motion-safe:animate-ping" />
            <span className="relative size-2 rounded-full bg-brand-2" />
          </span>
          <span>
          It&apos;s just you so far. Hit <b className="text-text">Invite</b> at the top to copy the room link and send
          it to friends{isHost ? <>, or add a <b className="text-text">practice bot</b> in the players panel</> : null}.
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

      {isHost && (
        <div
          aria-hidden={!showPill}
          inert={!showPill}
          className={`fixed bottom-4 left-4 right-28 z-30 transition-[translate,opacity] duration-300 ease-[var(--ease-out-expo)] sm:right-auto sm:left-1/2 sm:w-[min(26rem,calc(100%-2rem))] sm:-translate-x-1/2 lg:bottom-6 ${
            showPill ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
          }`}
        >
          <div
            className="lit-edge flex items-center gap-3 rounded-full border bg-panel/95 backdrop-blur-md py-1.5 pr-1.5 pl-2 shadow-lg shadow-black/50"
            style={{ borderColor: game.accent + "66", "--accent": game.accent } as React.CSSProperties}
          >
            <GameBadge key={game.id} id={game.id} accent={game.accent} size="sm" className="animate-pop shrink-0" />
            <div key={`n-${game.id}`} className="animate-rise min-w-0 flex-1 leading-tight">
              <div className="truncate font-display text-sm font-bold">{game.name}</div>
              <div className="truncate font-mono text-[10px] text-muted">
                {tooFew ? `Needs ${game.minPlayers}+ players` : `${online} ready`}
              </div>
            </div>
            <button
              className="btn btn-primary shrink-0 rounded-full px-4 py-2"
              disabled={tooFew}
              onClick={() => send({ t: "start" })}
            >
              Start
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Host's toggle for quick play: after each result the next fitting game starts by itself. */
export function QuickPlaySwitch({ on, onChange, compact }: { on: boolean; onChange: (on: boolean) => void; compact?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`flex w-full items-center justify-between gap-3 rounded-lg border text-left transition-colors duration-200 ${
        on ? "border-brand-2/50 bg-brand-2/10" : "border-line bg-ink/40 hover:border-text/25"
      } ${compact ? "px-2.5 py-1.5" : "mt-1 px-3 py-2"}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">Quick play</span>
        {!compact && <span className="block font-mono text-[10px] text-muted">Next game starts by itself</span>}
      </span>
      <span
        aria-hidden
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${on ? "bg-brand-2" : "bg-panel-2 ring-1 ring-line"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-4 rounded-full shadow transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.5,1)] ${
            on ? "translate-x-4 bg-ink" : "bg-text/80"
          }`}
        />
      </span>
    </button>
  );
}
