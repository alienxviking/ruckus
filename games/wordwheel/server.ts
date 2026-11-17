import type { GameDef } from "../../shared/game";

// Placeholder: Word Wheel is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const wordwheel: GameDef<State, unknown> = {
  id: "wordwheel",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Word Wheel is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default wordwheel;
