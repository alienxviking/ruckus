import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "board",
      label: "Board size",
      options: [
        { value: "small", label: "Small" },
        { value: "normal", label: "Normal" },
        { value: "large", label: "Large" },
      ],
      default: "normal",
      hint: "Normal grows with the player count.",
    },
    {
      kind: "choice",
      key: "turnSec",
      label: "Turn timer",
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
