import type { GameDef } from "../../shared/game";

// Placeholder: Word Smuggler is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const smuggle: GameDef<State, unknown> = {
  id: "smuggle",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Word Smuggler is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default smuggle;
