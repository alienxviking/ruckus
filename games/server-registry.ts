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
import garble from "./garble/server";
import liars from "./liars/server";
import market from "./market/server";
import barrage from "./barrage/server";
import blitz from "./blitz/server";
import sumo from "./sumo/server";
import warlords from "./warlords/server";
import incognito from "./incognito/server";
import minerush from "./minerush/server";
import auction from "./auction/server";
import potato from "./potato/server";
import putt from "./putt/server";
import pixels from "./pixels/server";
import doublecross from "./doublecross/server";
import outbreak from "./outbreak/server";
import lava from "./lava/server";
import snowball from "./snowball/server";
import defuse from "./defuse/server";
import poll from "./poll/server";
import emojicharades from "./emojicharades/server";
import mashup from "./mashup/server";
import smuggle from "./smuggle/server";
import hotseat from "./hotseat/server";
import truths from "./truths/server";
import tug from "./tug/server";
import flags from "./flags/server";
import puck from "./puck/server";
import salvo from "./salvo/server";
import seeds from "./seeds/server";
import flip from "./flip/server";
import ladder from "./ladder/server";
import stack from "./stack/server";
import pairs from "./pairs/server";

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
  garble,
  liars,
  market,
  barrage,
  blitz,
  sumo,
  warlords,
  incognito,
  minerush,
  auction,
  potato,
  putt,
  pixels,
  doublecross,
  outbreak,
  lava,
  snowball,
  defuse,
  poll,
  emojicharades,
  mashup,
  smuggle,
  hotseat,
  truths,
  tug,
  flags,
  puck,
  salvo,
  seeds,
  flip,
  ladder,
  stack,
  pairs,
};
