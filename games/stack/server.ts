import type { GameDef } from "../../shared/game";

// Placeholder: Tower Stack is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const stack: GameDef<State, unknown> = {
  id: "stack",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Tower Stack is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default stack;
