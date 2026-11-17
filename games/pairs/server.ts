import type { GameDef } from "../../shared/game";

// Placeholder: Memory Pairs is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const pairs: GameDef<State, unknown> = {
  id: "pairs",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Memory Pairs is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default pairs;
