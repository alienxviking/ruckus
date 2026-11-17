import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "A block slides back and forth. Tap to drop it on the tower.",
  flow: ["A block slides back and forth. Tap to drop it on the tower.", "Whatever hangs over the edge is sliced off, so the tower narrows.", "Tallest tower wins. Play solo or stack side by side with friends."],
  controls: {},
  scoring: ["Tallest tower wins. Play solo or stack side by side with friends."],
};
