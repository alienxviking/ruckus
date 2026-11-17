import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "seconds",
      label: "Match length",
      options: [
        { value: 45, label: "45s" },
        { value: 60, label: "60s" },
        { value: 90, label: "90s" },
      ],
      default: 60,
    },
    {
      kind: "choice",
      key: "map",
      label: "Map size",
      options: [
        { value: "small", label: "Small" },
        { value: "normal", label: "Normal" },
        { value: "large", label: "Large" },
      ],
      default: "normal",
      hint: "Normal grows with the player count.",
    },
  ],
  bots: true,
};
