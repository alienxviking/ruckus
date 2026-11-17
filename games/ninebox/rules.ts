import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Fill the empty cells with numbers.",
  flow: ["Fill the empty cells with numbers.", "Every row, column and box must contain each number exactly once.", "Solve it fastest with the fewest mistakes. Solo, or race friends on the same puzzle."],
  controls: {},
  scoring: ["Solve it fastest with the fewest mistakes. Solo, or race friends on the same puzzle."],
};
