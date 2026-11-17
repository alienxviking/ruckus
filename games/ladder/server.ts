import type { GameDef } from "../../shared/game";

// Placeholder: Word Ladder is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const ladder: GameDef<State, unknown> = {
  id: "ladder",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Word Ladder is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default ladder;
