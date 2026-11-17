import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "puzzles",
      label: "Puzzles",
      options: [
        { value: 3, label: "3" },
        { value: 5, label: "5" },
        { value: 8, label: "8" },
      ],
      default: 5,
      hint: "Everyone plays the same ladders.",
    },
    {
      kind: "choice",
      key: "level",
      label: "Difficulty",
      options: [
        { value: "easy", label: "Easy" },
        { value: "normal", label: "Normal" },
        { value: "hard", label: "Hard" },
      ],
      default: "normal",
      hint: "Harder ladders are longer and use more 5-letter words.",
    },
  ],
  bots: true,
};
