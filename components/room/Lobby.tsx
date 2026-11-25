"use client";

import { CATALOG, CATALOG_BY_ID } from "@/games/catalog";
import type { ClientMsg, Player, RoomView } from "@/shared/types";
import { GAME_CONFIG } from "@/games/config";
import { GameSettings } from "./GameSettings";
import { RecapCard } from "./Recap";
import { GameBadge } from "../GameBadge";
import { GameBrowser } from "../GameBrowser";
import { CoverArt } from "../CoverArt";
import { Rux } from "../Rux";
import { HowToPlay } from "./HowToPlay";
import { FirstTimeTips, markRoomTipsSeen } from "./FirstTimeTips";
import { InviteCard } from "./InviteCard";
import { Dices } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function Lobby({
  room,
  isHost,
  send,
  words,
  myName,
}: {
  room: RoomView;
  myName?: string;
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

  // "Surprise me": a random game that fits everyone here (bots count where they can play),
  // skipping the one picked and the last few played.
  const [rolling, setRolling] = useState(false);
  const surprise = () => {
    if (rolling) return;
    const bots = room.players.filter((p) => p.connected && p.bot).length;
    const recent = new Set([game.id, ...room.history.slice(-5).map((h) => h.gameId)]);
    const fits = CATALOG.filter((g) => {
      const n = humans + (GAME_CONFIG[g.id]?.bots ? bots : 0);
      return n >= g.minPlayers && n <= g.maxPlayers;
    });
    const fresh = fits.filter((g) => !recent.has(g.id));
    const pool = fresh.length ? fresh : fits.filter((g) => g.id !== game.id);
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setRolling(true);
    window.setTimeout(() => {
      send({ t: "pick", gameId: pick.id });
      setRolling(false);
    }, 420);
  };
  const surpriseButton = (className = "") => (
    <button type="button" className={`btn px-3 py-1.5 text-sm ${className}`} onClick={surprise} disabled={rolling}>
      <Dices aria-hidden className={`size-4 ${rolling ? "motion-safe:animate-spin" : ""}`} strokeWidth={2} />
      Surprise me
    </button>
  );
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

  // Back in the lobby after a game: they've got the hang of it.
  const played = room.history.length > 0;
  useEffect(() => {
    if (played) markRoomTipsSeen();
  }, [played]);

  return (
    <div className="flex flex-col gap-4">
      <FirstTimeTips isHost={isHost} />
      <div
        ref={heroRef}
        className="stk animate-rise relative grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:p-6"
        style={
          {
            "--accent": game.accent,
            background: `radial-gradient(90% 120% at 0% 0%, ${game.accent}26, transparent 60%), var(--color-panel)`,
            boxShadow: `6px 7px 0 color-mix(in oklab, ${game.accent} 55%, #000)`,
          } as React.CSSProperties
        }
      >
        {/* Re-keyed per game so the details animate in when the host switches games. */}
        <div key={game.id} className="animate-rise">
          <div className="flex items-center gap-4">
            <span className="slap w-32 shrink-0 sm:w-44" style={{ "--tilt": "-4deg" } as React.CSSProperties}>
              <CoverArt game={game} className="rounded-xl border-[3px] border-paper shadow-[4px_5px_0_rgb(0_0_0/0.55)]" />
            </span>
            <div className="min-w-0">
              <div className="marker text-xl leading-none" style={{ color: game.accent }}>
                {isHost ? "you picked" : `${host?.name ?? "the host"} picked`}
              </div>
              <h1 className="mt-1 font-hero text-3xl leading-[0.95] font-extrabold tracking-[-0.03em] sm:text-4xl">
                {game.name}
              </h1>
              <p className="mt-1 text-sm text-muted">{game.tagline}</p>
            </div>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-text/85">
            {game.how.map((line, i) => (
              <li key={i} className="animate-rise flex gap-3" style={{ animationDelay: `${120 + i * 70}ms` }}>
                <span
                  className="grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-ink"
                  style={{ background: game.accent }}
                >
                  {i + 1}
                </span>
                {line}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <HowToPlay gameId={game.id} />
            {isHost && surpriseButton()}
          </div>
        </div>
        <div className="flex flex-col justify-end gap-2 sm:w-52">
          {isHost ? (
            <>
              <button className="stk-btn w-full py-3.5 text-xl" disabled={tooFew} onClick={() => send({ t: "start" })}>
                Start game
              </button>
              <p className="mt-1 text-center text-xs font-semibold text-muted">
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
              <div className="flex items-end gap-2">
                <span className="bob w-14 shrink-0" style={{ "--tilt": "-6deg" } as React.CSSProperties}>
                  <Rux mood="sleepy" className="w-full" />
                </span>
                <p className="marker mb-3 rounded-2xl border-2 border-ink bg-paper px-3 py-1.5 text-lg leading-tight text-ink shadow-[3px_4px_0_#000]">
                  {host?.name ?? "host"} ka wait karo… start dabayega abhi
                </p>
              </div>
              {room.autoNext && (
                <p className="text-center text-xs font-bold text-brand-2">Quick play is on: games roll on by themselves</p>
              )}
            </>
          )}
        </div>
      </div>

      {humans < 3 && <InviteCard code={room.code} gameId={game.id} name={myName} humans={humans} isHost={isHost} botsPlay={botsPlay} />}

      <GameSettings room={room} isHost={isHost} send={send} words={words} />
      <RecapCard room={room} />

      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="label">{isHost ? "Pick a game" : "Games"}</h2>
          {isHost && (
            <span className="flex items-center gap-2 text-xs text-muted">
              <span className="hidden sm:inline">Can&apos;t decide?</span>
              {surpriseButton()}
            </span>
          )}
        </div>
        <GameBrowser
          selectedId={game.id}
          disabled={!isHost}
          playerCount={online}
          columns="grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
          compact
          onSelect={(g) => isHost && send({ t: "pick", gameId: g.id })}
        />
      </div>

      {isHost && (
        <div
          aria-hidden={!showPill}
          inert={!showPill}
          className={`fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-[calc(1rem+env(safe-area-inset-left))] right-28 z-30 transition-[translate,opacity] duration-300 ease-[var(--ease-out-expo)] sm:right-auto sm:left-1/2 sm:w-[min(26rem,calc(100%-2rem))] sm:-translate-x-1/2 lg:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] ${
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
