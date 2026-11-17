import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Place a disc so it traps a line of your rival's discs between two of yours.",
  flow: ["Place a disc so it traps a line of your rival's discs between two of yours.", "Every trapped disc flips to your colour.", "Most discs when the board fills wins."],
  controls: {},
  scoring: ["Most discs when the board fills wins."],
};
