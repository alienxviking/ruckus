// Server-side game logic, keyed by catalog id.
import type { GameDef } from "../shared/game";
import sketch from "./sketch/server";
import trivia from "./trivia/server";
import letters from "./letters/server";
import snakes from "./snakes/server";
import turf from "./turf/server";
import reflex from "./reflex/server";
import impostor from "./impostor/server";
import fib from "./fib/server";
import mindmeld from "./mindmeld/server";
import dial from "./dial/server";
import dots from "./dots/server";
import fourrow from "./fourrow/server";
import tictactoe from "./tictactoe/server";

export const GAME_DEFS: Record<string, GameDef> = {
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
