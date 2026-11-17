import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Each round one player takes the hot seat and secretly answers a fun question.",
  flow: ["Each round one player takes the hot seat and secretly answers a fun question.", "Everyone else guesses what they picked, then talk it out on the call.", "Score for every right guess. The hot seat scores when friends read them right."],
  controls: {},
  scoring: ["Score for every right guess. The hot seat scores when friends read them right."],
};
