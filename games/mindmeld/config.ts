import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "rounds",
      label: "Rounds to meld",
      options: [
        { value: 5, label: "5" },
        { value: 8, label: "8" },
        { value: 12, label: "12" },
      ],
      default: 8,
    },
    {
      kind: "choice",
      key: "time",
      label: "Round timer",
      options: [
        { value: 30, label: "30s" },
        { value: 60, label: "60s" },
        { value: 90, label: "90s" },
      ],
      default: 60,
      hint: "The first round gets two thirds of this.",
    },
  ],
};
