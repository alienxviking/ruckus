import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Sixteen words hide four groups of four that share something.",
  flow: ["Sixteen words hide four groups of four that share something.", "Pick four you think belong together and submit. Four wrong guesses and you're out.", "Find all four groups with the fewest mistakes. Solo, or race friends."],
  controls: {},
  scoring: ["Find all four groups with the fewest mistakes. Solo, or race friends."],
};
