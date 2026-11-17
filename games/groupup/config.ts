import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "puzzles",
      label: "Puzzles",
      options: [
        { value: 1, label: "1" },
        { value: 2, label: "2" },
        { value: 3, label: "3" },
      ],
      default: 1,
      hint: "Everyone gets the same puzzles.",
    },
    {
      kind: "choice",
      key: "mistakes",
      label: "Mistakes allowed",
      options: [
        { value: 3, label: "3" },
        { value: 4, label: "4" },
        { value: 5, label: "5" },
      ],
      default: 4,
      hint: "Per puzzle. Run out and the rest of that puzzle is revealed.",
    },
  ],
};
