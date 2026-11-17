import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "goals",
      label: "Goals to win",
      options: [
        { value: 5, label: "First to 5" },
        { value: 7, label: "First to 7" },
        { value: 10, label: "First to 10" },
      ],
      default: 7,
      hint: "The first side to score this many wins.",
    },
    {
      kind: "choice",
      key: "speed",
      label: "Puck speed",
      options: [
        { value: "normal", label: "Fast" },
        { value: "turbo", label: "Turbo" },
      ],
      default: "normal",
      hint: "Turbo: a faster puck that barely slows down.",
    },
  ],
  bots: true,
};
