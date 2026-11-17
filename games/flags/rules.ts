import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Two teams, two bases. Sneak into enemy ground and grab their flag.",
  flow: ["Two teams, two bases. Sneak into enemy ground and grab their flag.", "Get tagged on their side and you're sent home. Tag raiders on your side.", "Carry the flag home to score. First to 3 captures wins."],
  controls: {},
  scoring: ["Carry the flag home to score. First to 3 captures wins."],
};
