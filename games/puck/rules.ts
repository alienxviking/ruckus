import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Slide your paddle to smack the puck into the other goal.",
  flow: ["Slide your paddle to smack the puck into the other goal.", "Play 1v1, or 2v2 with a teammate on each side.", "First to 7 goals wins."],
  controls: {},
  scoring: ["First to 7 goals wins."],
};
