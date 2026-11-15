"use client";

// Lazy loaders for the dev simulator (/dev/<game>). Each game loads on demand,
// so a half-finished game never breaks the others.
import type { ComponentType } from "react";
import type { GameDef } from "../shared/game";
import type { GameClientProps } from "../shared/client-game";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loaded = [{ default: GameDef }, { default: ComponentType<GameClientProps<any, any>> }];

export const SIM_LOADERS: Record<string, () => Promise<Loaded>> = {
  sketch: () => Promise.all([import("./sketch/server"), import("./sketch/client")]),
  trivia: () => Promise.all([import("./trivia/server"), import("./trivia/client")]),
  letters: () => Promise.all([import("./letters/server"), import("./letters/client")]),
  snakes: () => Promise.all([import("./snakes/server"), import("./snakes/client")]),
  turf: () => Promise.all([import("./turf/server"), import("./turf/client")]),
  reflex: () => Promise.all([import("./reflex/server"), import("./reflex/client")]),
  impostor: () => Promise.all([import("./impostor/server"), import("./impostor/client")]),
  fib: () => Promise.all([import("./fib/server"), import("./fib/client")]),
  mindmeld: () => Promise.all([import("./mindmeld/server"), import("./mindmeld/client")]),
  dial: () => Promise.all([import("./dial/server"), import("./dial/client")]),
  dots: () => Promise.all([import("./dots/server"), import("./dots/client")]),
  fourrow: () => Promise.all([import("./fourrow/server"), import("./fourrow/client")]),
  tictactoe: () => Promise.all([import("./tictactoe/server"), import("./tictactoe/client")]),
};
