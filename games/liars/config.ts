import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "dice",
      label: "Starting dice",
      options: [
        { value: "auto", label: "Auto" },
        { value: 3, label: "3" },
        { value: 5, label: "5" },
        { value: 6, label: "6" },
      ],
      default: "auto",
      hint: "Auto: 5 each up to 4 players, 4 for 5–6, 3 for 7–8.",
    },
    {
      kind: "choice",
      key: "turnMs",
      label: "Turn timer",
      options: [
        { value: 15_000, label: "15s" },
        { value: 30_000, label: "30s" },
        { value: 60_000, label: "60s" },
      ],
      default: 30_000,
    },
  ],
  bots: true,
};
