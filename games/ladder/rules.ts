import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Turn the start word into the goal word, one letter at a time.",
  flow: ["Turn the start word into the goal word, one letter at a time.", "Every step must be a real word.", "Fewest steps and fastest finish score most. Play solo or race friends."],
  controls: {},
  scoring: ["Fewest steps and fastest finish score most. Play solo or race friends."],
};
