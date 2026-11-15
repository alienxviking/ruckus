"use client";

// Client components for each game, keyed by catalog id. Each game is its own
// lazily loaded chunk: the room only downloads the game being played, and a
// broken game cannot take down the rest of the site.
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { GameClientProps } from "@/shared/client-game";

function Loading() {
  return (
    <div className="grid min-h-[40vh] place-items-center text-sm text-muted" role="status">
      <span className="flex items-center gap-2">
        <span aria-hidden className="size-5 rounded-full border-2 border-line border-t-brand motion-safe:animate-[spin_0.8s_linear_infinite]" />
        Loading game…
      </span>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGameClient = ComponentType<GameClientProps<any, any>>;

/** Loaders for each game's client chunk (also used to preload it before the game starts). */
const LOADERS: Record<string, () => Promise<{ default: AnyGameClient }>> = {
  sketch: () => import("./sketch/client"),
  trivia: () => import("./trivia/client"),
  letters: () => import("./letters/client"),
  snakes: () => import("./snakes/client"),
  turf: () => import("./turf/client"),
  reflex: () => import("./reflex/client"),
  impostor: () => import("./impostor/client"),
  fib: () => import("./fib/client"),
  mindmeld: () => import("./mindmeld/client"),
  dial: () => import("./dial/client"),
  dots: () => import("./dots/client"),
  fourrow: () => import("./fourrow/client"),
  tictactoe: () => import("./tictactoe/client"),
  garble: () => import("./garble/client"),
  liars: () => import("./liars/client"),
  market: () => import("./market/client"),
  barrage: () => import("./barrage/client"),
  blitz: () => import("./blitz/client"),
  sumo: () => import("./sumo/client"),
  warlords: () => import("./warlords/client"),
  incognito: () => import("./incognito/client"),
  minerush: () => import("./minerush/client"),
  auction: () => import("./auction/client"),
  potato: () => import("./potato/client"),
  putt: () => import("./putt/client"),
  pixels: () => import("./pixels/client"),
  doublecross: () => import("./doublecross/client"),
};

export const GAME_CLIENTS: Record<string, AnyGameClient> = Object.fromEntries(
  Object.entries(LOADERS).map(([id, load]) => [id, dynamic(load, { ssr: false, loading: Loading })]),
);

const preloaded = new Set<string>();
/** Start downloading a game's code early (e.g. as soon as the host picks it). */
export function preloadGame(id: string) {
  const load = LOADERS[id];
  if (!load || preloaded.has(id)) return;
  preloaded.add(id);
  load().catch(() => preloaded.delete(id));
}
