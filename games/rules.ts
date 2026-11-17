// Full rules per game, loaded one game at a time when someone opens "How to play".

import type { GameRules } from "./rules-types";

type Loader = () => Promise<{ rules: GameRules }>;

export const RULES: Record<string, Loader> = {
  sketch: () => import("./sketch/rules"),
  trivia: () => import("./trivia/rules"),
  letters: () => import("./letters/rules"),
  snakes: () => import("./snakes/rules"),
  turf: () => import("./turf/rules"),
  reflex: () => import("./reflex/rules"),
  impostor: () => import("./impostor/rules"),
  fib: () => import("./fib/rules"),
  mindmeld: () => import("./mindmeld/rules"),
  dial: () => import("./dial/rules"),
  dots: () => import("./dots/rules"),
  fourrow: () => import("./fourrow/rules"),
  tictactoe: () => import("./tictactoe/rules"),
  garble: () => import("./garble/rules"),
  liars: () => import("./liars/rules"),
  market: () => import("./market/rules"),
  barrage: () => import("./barrage/rules"),
  blitz: () => import("./blitz/rules"),
  sumo: () => import("./sumo/rules"),
  warlords: () => import("./warlords/rules"),
  incognito: () => import("./incognito/rules"),
  minerush: () => import("./minerush/rules"),
  auction: () => import("./auction/rules"),
  potato: () => import("./potato/rules"),
  putt: () => import("./putt/rules"),
  pixels: () => import("./pixels/rules"),
  doublecross: () => import("./doublecross/rules"),
  outbreak: () => import("./outbreak/rules"),
  lava: () => import("./lava/rules"),
  snowball: () => import("./snowball/rules"),
  defuse: () => import("./defuse/howto"),
  poll: () => import("./poll/rules"),
  emojicharades: () => import("./emojicharades/rules"),
  mashup: () => import("./mashup/rules"),
};

export type { GameRules };
