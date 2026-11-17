import type { GameDef } from "../../shared/game";

// Placeholder: Hot Seat is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const hotseat: GameDef<State, unknown> = {
  id: "hotseat",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Hot Seat is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default hotseat;
