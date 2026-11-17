import type { GameDef } from "../../shared/game";

// Placeholder: Seeds is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const seeds: GameDef<State, unknown> = {
  id: "seeds",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Seeds is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default seeds;
