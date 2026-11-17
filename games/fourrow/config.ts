import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "wins",
      label: "Match length",
      options: [
        { value: 1, label: "Best of 1" },
        { value: 2, label: "Best of 3" },
        { value: 3, label: "Best of 5" },
      ],
      default: 2,
      hint: "Game wins needed to take the match.",
    },
    {
      kind: "choice",
      key: "turn",
      label: "Move timer",
      options: [
        { value: 15, label: "15s" },
        { value: 30, label: "30s" },
        { value: 60, label: "60s" },
      ],
      default: 30,
    },
  ],
  bots: true,
};
