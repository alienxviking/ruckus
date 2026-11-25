"use client";

import { Component, memo, useEffect, useRef, type ReactNode } from "react";
import { Pause } from "lucide-react";
import { CATALOG_BY_ID } from "@/games/catalog";
import { SIM_LOADERS } from "@/games/sim-registry";
import type { GameDef } from "@/shared/game";
import type { AnyClient } from "@/components/dev/sim-engine";
import { ME, type LocalEngine, type LocalSnapshot } from "@/lib/local-engine";
import { loadIdentity } from "@/lib/identity";
import { PLAYER_COLORS, type Player } from "@/shared/types";
import { GameBadge } from "../GameBadge";
import { HowToPlay } from "../room/HowToPlay";

export interface LoadedGame {
  def: GameDef;
  Client: AnyClient;
}

const cache = new Map<string, Promise<LoadedGame>>();

/** A game's server and client halves (one download each, shared by every local game). */
export function loadLocalGame(id: string): Promise<LoadedGame> {
  let p = cache.get(id);
  if (!p) {
    const load = SIM_LOADERS[id];
    p = load
      ? // memo: re-renders of the page around the game don't re-render the game itself.
        load().then(([s, c]) => ({ def: s.default, Client: memo(c.default) as AnyClient }))
      : Promise.reject(new Error(`No game ${id}`));
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

/** You, as saved in this browser (or a friendly default before you've picked a name). */
export function localMe(): Pick<Player, "name" | "color" | "avatar"> {
  const id = loadIdentity();
  return id ? { name: id.name, color: id.color, avatar: id.avatar } : { name: "Player", color: PLAYER_COLORS[5], avatar: "fox" };
}

const noRtt = () => 0;

/**
 * A local game on screen: header with How to play (which pauses the game while open,
 * unless `pausable` is false), the game's own client with the same props the room passes,
 * and a frozen overlay while paused.
 */
export function LocalStage({
  gameId,
  engine,
  Client,
  snap,
  pausable = true,
  label,
  actions,
  banner,
}: {
  gameId: string;
  engine: LocalEngine;
  Client: AnyClient;
  snap: LocalSnapshot;
  pausable?: boolean;
  /** Small tag next to the title ("vs 3 bots", "Daily"). */
  label?: string;
  /** Buttons on the right of the header. */
  actions?: ReactNode;
  /** Result banner, shown above the game. */
  banner?: ReactNode;
}) {
  const meta = CATALOG_BY_ID[gameId];
  const live = !snap.result && !snap.error;
  const holding = useRef(false);
  const onRules = (open: boolean) => {
    if (!pausable) return;
    // Already paused (the Pause button): closing the rules shouldn't un-pause.
    if (open && live && !snap.paused) {
      holding.current = true;
      engine.setPaused(true);
    } else if (!open && holding.current) {
      holding.current = false;
      engine.setPaused(false);
    }
  };
  // Leaving the tab (or locking the phone) pauses, so the bots don't win while you're away.
  const autoPause = pausable && live;
  useEffect(() => {
    if (!autoPause) return;
    const onHide = () => {
      if (document.hidden) engine.setPaused(true);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [autoPause, engine]);

  const note = !live
    ? undefined
    : pausable
      ? "The game is paused while you read."
      : "The clock keeps running in the daily challenge.";

  return (
    <div data-stage={live ? "" : undefined} data-paused={snap.paused ? "" : undefined} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="flex min-w-0 items-center gap-2.5 font-display text-xl font-bold tracking-tight">
          {meta && <GameBadge id={meta.id} accent={meta.accent} size="sm" sheen />}
          <span className="truncate">{meta?.name}</span>
          {label && (
            <span className="hidden shrink-0 rounded-full border border-line px-2 py-0.5 text-xs font-semibold text-muted min-[420px]:inline">
              {label}
            </span>
          )}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          <HowToPlay gameId={gameId} compact onOpenChange={onRules} note={note} />
          {pausable && live && !snap.paused && (
            <button className="btn min-h-10 px-3 py-1.5 text-sm" onClick={() => engine.setPaused(true)} aria-label="Pause the game" title="Pause">
              <Pause aria-hidden className="size-4" strokeWidth={2.4} />
              <span className="hidden sm:inline">Pause</span>
            </button>
          )}
          {actions}
        </div>
      </div>

      {banner}

      <div className="relative min-h-[60vh]">
        {snap.paused && (
          <div
            role="status"
            className="pause-live absolute inset-0 z-20 grid place-items-center rounded-xl bg-ink/75 backdrop-blur-md"
          >
            <div className="card lit-edge animate-pop flex flex-col items-center gap-3 px-6 py-5 text-center">
              <span className="grid size-11 place-items-center rounded-full border border-line bg-ink text-brand-2">
                <Pause aria-hidden className="size-5" strokeWidth={2} />
              </span>
              <div className="font-display text-lg font-bold">Paused</div>
              <p className="max-w-56 text-sm text-muted">The clock is frozen. Take your time: the bots will wait.</p>
              <button className="btn btn-primary px-4 py-1.5 text-sm" onClick={() => engine.setPaused(false)}>
                Resume
              </button>
            </div>
          </div>
        )}
        {snap.error ? (
          <div className="card p-6 text-center">
            <p className="font-semibold">{snap.error}</p>
            <p className="mt-1 text-sm text-muted">Try another game.</p>
          </div>
        ) : (
          <GameErrorBoundary key={engine.id}>
            <Client
              view={snap.view}
              me={ME}
              players={engine.players}
              byId={engine.byId}
              isPlayer
              isHost
              act={engine.act}
              serverNow={engine.now}
              rtt={noRtt}
              onEvent={engine.onEvent}
              accent={meta?.accent ?? "#c6f432"}
            />
          </GameErrorBoundary>
        )}
      </div>
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
