import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "laps",
      label: "Hot seats",
      options: [
        { value: "auto", label: "Auto" },
        { value: 1, label: "Once each" },
        { value: 2, label: "Twice each" },
        { value: 3, label: "3 times each" },
      ],
      default: "auto",
      hint: "Auto: 3 times each with 3 players, twice with 4–6, once with 7+.",
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
      hint: "Pick / talk-it-out time: 20s/20s, 30s/40s or 45s/60s. Everyone tapping Next moves on early.",
    },
  ],
};
