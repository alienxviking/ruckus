import type { GameDef } from "../../shared/game";

// Placeholder: Salvo is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const salvo: GameDef<State, unknown> = {
  id: "salvo",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Salvo is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default salvo;
