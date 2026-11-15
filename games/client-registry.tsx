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

export const GAME_CLIENTS: Record<string, AnyGameClient> = {
  sketch: dynamic(() => import("./sketch/client"), { ssr: false, loading: Loading }),
  trivia: dynamic(() => import("./trivia/client"), { ssr: false, loading: Loading }),
  letters: dynamic(() => import("./letters/client"), { ssr: false, loading: Loading }),
  snakes: dynamic(() => import("./snakes/client"), { ssr: false, loading: Loading }),
  turf: dynamic(() => import("./turf/client"), { ssr: false, loading: Loading }),
  reflex: dynamic(() => import("./reflex/client"), { ssr: false, loading: Loading }),
  impostor: dynamic(() => import("./impostor/client"), { ssr: false, loading: Loading }),
  fib: dynamic(() => import("./fib/client"), { ssr: false, loading: Loading }),
  mindmeld: dynamic(() => import("./mindmeld/client"), { ssr: false, loading: Loading }),
  dial: dynamic(() => import("./dial/client"), { ssr: false, loading: Loading }),
  dots: dynamic(() => import("./dots/client"), { ssr: false, loading: Loading }),
  fourrow: dynamic(() => import("./fourrow/client"), { ssr: false, loading: Loading }),
  tictactoe: dynamic(() => import("./tictactoe/client"), { ssr: false, loading: Loading }),
  garble: dynamic(() => import("./garble/client"), { ssr: false, loading: Loading }),
  liars: dynamic(() => import("./liars/client"), { ssr: false, loading: Loading }),
  market: dynamic(() => import("./market/client"), { ssr: false, loading: Loading }),
  barrage: dynamic(() => import("./barrage/client"), { ssr: false, loading: Loading }),
  blitz: dynamic(() => import("./blitz/client"), { ssr: false, loading: Loading }),
  sumo: dynamic(() => import("./sumo/client"), { ssr: false, loading: Loading }),
  warlords: dynamic(() => import("./warlords/client"), { ssr: false, loading: Loading }),
};
