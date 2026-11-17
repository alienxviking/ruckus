import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "rounds",
      label: "Polls",
      options: [
        { value: 5, label: "5" },
        { value: 8, label: "8" },
        { value: 12, label: "12" },
      ],
      default: 8,
    },
    {
      kind: "choice",
      key: "pace",
      label: "Timers",
      options: [
        { value: "quick", label: "Quick" },
        { value: "normal", label: "Normal" },
        { value: "relaxed", label: "Relaxed" },
      ],
      default: "normal",
      hint: "Vote / predict time: 10s/15s, 15s/20s or 25s/30s.",
    },
  ],
  bots: true,
};
