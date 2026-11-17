import type { GameDef } from "../../shared/game";

// Placeholder: Code Word is being built. Ends straight away so nothing gets stuck.
interface State {
  endsAt: number;
}

export const codeword: GameDef<State, unknown> = {
  id: "codeword",
  setup: (ctx) => ({ endsAt: ctx.now() + 1500 }),
  action: () => false,
  tick(s, ctx) {
    if (ctx.now() >= s.endsAt) ctx.end({ winners: [], headline: "Code Word is coming soon" });
  },
  view: () => ({ soon: true }),
};

export default codeword;
