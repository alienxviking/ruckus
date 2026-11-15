"use client";

// Client components for each game, keyed by catalog id.
import type { ComponentType } from "react";
import type { GameClientProps } from "@/shared/client-game";
import sketch from "./sketch/client";
import trivia from "./trivia/client";
import letters from "./letters/client";
import snakes from "./snakes/client";
import turf from "./turf/client";
import reflex from "./reflex/client";
import impostor from "./impostor/client";
import fib from "./fib/client";
import mindmeld from "./mindmeld/client";
import dial from "./dial/client";
import dots from "./dots/client";
import fourrow from "./fourrow/client";
import tictactoe from "./tictactoe/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GAME_CLIENTS: Record<string, ComponentType<GameClientProps<any, any>>> = {
  sketch,
  trivia,
  letters,
  snakes,
  turf,
  reflex,
  impostor,
  fib,
  mindmeld,
  dial,
  dots,
  fourrow,
  tictactoe,
};
