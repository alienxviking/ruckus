import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "rounds",
      label: "Rounds",
      options: [
        { value: 1, label: "1" },
        { value: 3, label: "3" },
        { value: 5, label: "5" },
      ],
      default: 3,
    },
    {
      kind: "choice",
      key: "roundMs",
      label: "Trading time",
      options: [
        { value: 60_000, label: "60s" },
        { value: 90_000, label: "90s" },
        { value: 120_000, label: "120s" },
      ],
      default: 90_000,
      hint: "Street cards flip at the same points of the round.",
    },
  ],
  bots: true,
};
