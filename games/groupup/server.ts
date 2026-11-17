import type { GameDef } from "../../shared/game";

// Placeholder: Group Up is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const groupup: GameDef<State, unknown> = {
  id: "groupup",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Group Up is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default groupup;
