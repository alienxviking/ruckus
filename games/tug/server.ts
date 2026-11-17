import type { GameDef } from "../../shared/game";

// Placeholder: Tug of War is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const tug: GameDef<State, unknown> = {
  id: "tug",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Tug of War is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default tug;
