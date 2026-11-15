import type { Player } from "./types";

/** Props every game's client component receives from the room. */
export interface GameClientProps<V = unknown, A = unknown> {
  /** This viewer's projection of the game state (from GameDef.view). Null until the first state arrives. */
  view: V | null;
  /** The viewer's player id. */
  me: string;
  /** Participants in this game, in turn/join order. */
  players: Player[];
  /** Every player in the room (participants and spectators), by id. */
  byId: Record<string, Player>;
  /** True when the viewer is playing (false = spectating). */
  isPlayer: boolean;
  isHost: boolean;
  /** Send an action to the server game logic. */
  act: (action: A) => void;
  /** Current server time in ms (corrected for clock skew). Use for countdowns. */
  serverNow: () => number;
  /** Subscribe to transient events sent via ctx.emit. Returns an unsubscribe fn. */
  onEvent: (fn: (event: unknown) => void) => () => void;
  /** Game accent colour from the catalog. */
  accent: string;
}
