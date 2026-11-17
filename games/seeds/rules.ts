import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Pick up all the seeds in one of your pits and sow them one by one around the board.",
  flow: ["Pick up all the seeds in one of your pits and sow them one by one around the board.", "Land in your store for another turn; land in an empty pit to capture.", "Most seeds when a side runs out wins."],
  controls: {},
  scoring: ["Most seeds when a side runs out wins."],
};
