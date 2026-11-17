import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "rounds",
      label: "Microgames",
      options: [
        { value: 6, label: "6" },
        { value: 12, label: "12" },
        { value: 18, label: "18" },
      ],
      default: 12,
      hint: "The last 3 always count double.",
    },
    {
      kind: "choice",
      key: "pace",
      label: "Pace",
      options: [
        { value: "normal", label: "Normal" },
        { value: "relaxed", label: "Relaxed" },
      ],
      default: "normal",
      hint: "Relaxed gives 50% longer to answer.",
    },
  ],
  bots: true,
};
