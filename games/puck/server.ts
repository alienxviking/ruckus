import type { GameDef } from "../../shared/game";

// Placeholder: Puck is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const puck: GameDef<State, unknown> = {
  id: "puck",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Puck is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default puck;
