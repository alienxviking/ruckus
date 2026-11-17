import type { GameDef } from "../../shared/game";

// Placeholder: Truth Bombs is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const truths: GameDef<State, unknown> = {
  id: "truths",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Truth Bombs is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default truths;
