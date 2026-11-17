import type { GameDef } from "../../shared/game";

// Placeholder: Flip is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const flip: GameDef<State, unknown> = {
  id: "flip",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Flip is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default flip;
