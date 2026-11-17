import type { GameDef } from "../../shared/game";

// Placeholder: Nine Box is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const ninebox: GameDef<State, unknown> = {
  id: "ninebox",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Nine Box is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default ninebox;
