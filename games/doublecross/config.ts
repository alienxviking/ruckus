import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "rounds",
      label: "Rounds",
      options: [
        { value: 4, label: "4" },
        { value: 6, label: "6" },
        { value: 8, label: "8" },
      ],
      default: 6,
      hint: "The last round is always the Heist.",
    },
    {
      kind: "choice",
      key: "talk",
      label: "Talk time",
      options: [
        { value: 20, label: "20s" },
        { value: 40, label: "40s" },
        { value: 60, label: "60s" },
      ],
      default: 40,
      hint: "The Heist gets three quarters of this.",
    },
  ],
  bots: true,
};
