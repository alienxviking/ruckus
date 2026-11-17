import type { GameDef } from "../../shared/game";

// Placeholder: Flag Raid is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const flags: GameDef<State, unknown> = {
  id: "flags",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Flag Raid is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default flags;
