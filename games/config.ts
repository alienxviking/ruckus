// Per-game host settings and bot support (see shared/settings.ts). Small, so it is loaded eagerly
// by both the server (validation) and the lobby (controls).
import type { GameConfig } from "../shared/settings";
import { config as sketch } from "./sketch/config";
import { config as trivia } from "./trivia/config";
import { config as letters } from "./letters/config";
import { config as snakes } from "./snakes/config";
import { config as turf } from "./turf/config";
import { config as reflex } from "./reflex/config";
import { config as impostor } from "./impostor/config";
import { config as fib } from "./fib/config";
import { config as mindmeld } from "./mindmeld/config";
import { config as dial } from "./dial/config";
import { config as dots } from "./dots/config";
import { config as fourrow } from "./fourrow/config";
import { config as tictactoe } from "./tictactoe/config";
import { config as garble } from "./garble/config";
import { config as liars } from "./liars/config";
import { config as market } from "./market/config";
import { config as barrage } from "./barrage/config";
import { config as blitz } from "./blitz/config";
import { config as sumo } from "./sumo/config";
import { config as warlords } from "./warlords/config";
import { config as incognito } from "./incognito/config";
import { config as minerush } from "./minerush/config";
import { config as auction } from "./auction/config";
import { config as potato } from "./potato/config";
import { config as putt } from "./putt/config";
import { config as pixels } from "./pixels/config";
import { config as doublecross } from "./doublecross/config";
import { config as outbreak } from "./outbreak/config";
import { config as lava } from "./lava/config";
import { config as snowball } from "./snowball/config";
import { config as defuse } from "./defuse/config";
import { config as poll } from "./poll/config";
import { config as emojicharades } from "./emojicharades/config";
import { config as mashup } from "./mashup/config";

export const GAME_CONFIG: Record<string, GameConfig> = {
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
};
