import type { GameResult, Player } from "./types";

/**
 * Everything a game's server logic can do besides mutating its own state.
 * The room owns timing, connections and broadcasting; games stay pure-ish.
 */
export interface GameCtx {
  /** Server time in ms. Use this (not Date.now) so tests can fake time. */
  now(): number;
  /** Snapshot of the players taking part, in join order. */
  players: Player[];
  /** Look up any player in the room (participant or not). */
  player(id: string): Player | undefined;
  /**
   * Send a transient event to clients without re-sending full state.
   * Use for high-frequency things like drawing strokes or sound cues.
   */
  emit(event: unknown, opts?: { to?: string; except?: string }): void;
  /** Mark the game as finished. Safe to call more than once (later calls are ignored). */
  end(result: GameResult): void;
  random(): number;
}

/**
 * A game's server half. State is a plain object the game mutates in place.
 * The room calls `view` for each connection after every change, so secrets
 * (hidden words, other players' hands) must be stripped there.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface GameDef<S = any, A = any> {
  id: string;
  /** Build the initial state. `ctx.players` are the participants. */
  setup(ctx: GameCtx): S;
  /**
   * Handle an action from a participant. Validate everything: clients lie.
   * Return `false` to skip re-broadcasting state (e.g. when you only emitted an event).
   */
  action(state: S, playerId: string, action: A, ctx: GameCtx): boolean | void;
  /**
   * Optional: handle an action from a spectator (in the room but not playing).
   * Only for read-only requests such as "send me the drawing so far"; it must
   * never change the game. Return value works like action().
   */
  spectatorAction?(state: S, viewerId: string, action: unknown, ctx: GameCtx): boolean | void;
  /** Called every `tickMs`. Return true when state changed and should be broadcast. */
  tick?(state: S, ctx: GameCtx): boolean | void;
  /** Tick interval in ms. Defaults to 250 when `tick` is defined. */
  tickMs?: number;
  /** Per-player view of the state. `viewerId` may be a spectator. */
  view(state: S, viewerId: string, ctx: GameCtx): unknown;
  /** A participant disconnected (they may come back). */
  playerLeft?(state: S, playerId: string, ctx: GameCtx): void;
  /** A participant reconnected. */
  playerReturned?(state: S, playerId: string, ctx: GameCtx): void;
}

export function shuffle<T>(arr: T[], random: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick<T>(arr: readonly T[], random: () => number = Math.random): T {
  return arr[Math.floor(random() * arr.length)];
}

/** Ids of the top scorers (ties included). Empty when everyone has 0. */
export function topScorers(scores: Record<string, number>): string[] {
  const best = Math.max(0, ...Object.values(scores));
  if (best <= 0) return [];
  return Object.keys(scores).filter((id) => scores[id] === best);
}
