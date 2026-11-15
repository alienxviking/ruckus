import type { GameDef } from "../../shared/game";

// Placeholder while the game is being built.
const game: GameDef<{ startedAt: number }, unknown> = {
  id: "market",
  setup: (ctx) => ({ startedAt: ctx.now() }),
  action: () => false,
  view: () => ({ stub: true }),
};

export default game;
