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
  garble: () => Promise.all([import("./garble/server"), import("./garble/client")]),
  liars: () => Promise.all([import("./liars/server"), import("./liars/client")]),
  market: () => Promise.all([import("./market/server"), import("./market/client")]),
  barrage: () => Promise.all([import("./barrage/server"), import("./barrage/client")]),
  blitz: () => Promise.all([import("./blitz/server"), import("./blitz/client")]),
  sumo: () => Promise.all([import("./sumo/server"), import("./sumo/client")]),
  warlords: () => Promise.all([import("./warlords/server"), import("./warlords/client")]),
  incognito: () => Promise.all([import("./incognito/server"), import("./incognito/client")]),
  minerush: () => Promise.all([import("./minerush/server"), import("./minerush/client")]),
  auction: () => Promise.all([import("./auction/server"), import("./auction/client")]),
  potato: () => Promise.all([import("./potato/server"), import("./potato/client")]),
  putt: () => Promise.all([import("./putt/server"), import("./putt/client")]),
  pixels: () => Promise.all([import("./pixels/server"), import("./pixels/client")]),
  doublecross: () => Promise.all([import("./doublecross/server"), import("./doublecross/client")]),
  outbreak: () => Promise.all([import("./outbreak/server"), import("./outbreak/client")]),
  lava: () => Promise.all([import("./lava/server"), import("./lava/client")]),
  snowball: () => Promise.all([import("./snowball/server"), import("./snowball/client")]),
  defuse: () => Promise.all([import("./defuse/server"), import("./defuse/client")]),
  poll: () => Promise.all([import("./poll/server"), import("./poll/client")]),
  emojicharades: () => Promise.all([import("./emojicharades/server"), import("./emojicharades/client")]),
  mashup: () => Promise.all([import("./mashup/server"), import("./mashup/client")]),
  smuggle: () => Promise.all([import("./smuggle/server"), import("./smuggle/client")]),
  hotseat: () => Promise.all([import("./hotseat/server"), import("./hotseat/client")]),
  truths: () => Promise.all([import("./truths/server"), import("./truths/client")]),
  tug: () => Promise.all([import("./tug/server"), import("./tug/client")]),
  flags: () => Promise.all([import("./flags/server"), import("./flags/client")]),
  puck: () => Promise.all([import("./puck/server"), import("./puck/client")]),
  salvo: () => Promise.all([import("./salvo/server"), import("./salvo/client")]),
  seeds: () => Promise.all([import("./seeds/server"), import("./seeds/client")]),
  flip: () => Promise.all([import("./flip/server"), import("./flip/client")]),
  ladder: () => Promise.all([import("./ladder/server"), import("./ladder/client")]),
  stack: () => Promise.all([import("./stack/server"), import("./stack/client")]),
  pairs: () => Promise.all([import("./pairs/server"), import("./pairs/client")]),
  codeword: () => Promise.all([import("./codeword/server"), import("./codeword/client")]),
  wordwheel: () => Promise.all([import("./wordwheel/server"), import("./wordwheel/client")]),
  ninebox: () => Promise.all([import("./ninebox/server"), import("./ninebox/client")]),
  groupup: () => Promise.all([import("./groupup/server"), import("./groupup/client")]),
};
