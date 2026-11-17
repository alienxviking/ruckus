import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "rounds",
      label: "Rounds",
      options: [
        { value: 2, label: "2" },
        { value: 3, label: "3" },
        { value: 5, label: "5" },
      ],
      default: 3,
      hint: "The park changes every round.",
    },
    {
      kind: "choice",
      key: "time",
      label: "Round time",
      options: [
        { value: 60_000, label: "60s" },
        { value: 100_000, label: "100s" },
        { value: 150_000, label: "150s" },
      ],
      default: 100_000,
      hint: "When time runs out, whoever lit the most landmarks scores.",
    },
  ],
  bots: true,
};
