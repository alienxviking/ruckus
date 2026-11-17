import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "size",
      label: "Grid",
      options: [
        { value: 9, label: "9×9 classic" },
        { value: 6, label: "6×6 quick" },
      ],
      default: 9,
      hint: "6×6 uses numbers 1–6 and 2×3 boxes: great on phones.",
    },
    {
      kind: "choice",
      key: "level",
      label: "Difficulty",
      options: [
        { value: "easy", label: "Easy" },
        { value: "medium", label: "Medium" },
        { value: "hard", label: "Hard" },
      ],
      default: "medium",
      hint: "Fewer clues and trickier logic as it gets harder.",
    },
    {
      kind: "choice",
      key: "mistakes",
      label: "Mistake limit",
      options: [
        { value: 3, label: "3" },
        { value: 5, label: "5" },
        { value: 0, label: "Off" },
      ],
      default: 3,
      hint: "Hit the limit and your grid is done. Mistakes always cost points.",
    },
  ],
  bots: true,
};
