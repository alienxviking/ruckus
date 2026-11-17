import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Make words of 4+ letters from the seven on the wheel. The centre letter must be in every word.",
  flow: ["Make words of 4+ letters from the seven on the wheel. The centre letter must be in every word.", "Longer words score more. Use all seven letters for a big bonus.", "Most points when the clock runs out wins."],
  controls: {},
  scoring: ["Most points when the clock runs out wins."],
};
