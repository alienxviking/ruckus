import type { GameDef } from "../../shared/game";

// STUB: replace with the real game.
const game: GameDef<{ stub: true }> = {
  id: "fib",
  setup: () => ({ stub: true }),
  action: () => false,
  view: (s) => s,
};

export default game;
