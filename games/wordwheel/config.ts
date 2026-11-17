import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "time",
      label: "Clock",
      options: [
        { value: 120, label: "2 min" },
        { value: 180, label: "3 min" },
        { value: 300, label: "5 min" },
      ],
      default: 180,
      hint: "Time for each wheel.",
    },
    {
      kind: "choice",
      key: "rounds",
      label: "Wheels",
      options: [
        { value: 1, label: "1" },
        { value: 2, label: "2" },
        { value: 3, label: "3" },
      ],
      default: 1,
      hint: "Everyone plays the same wheels; points add up.",
    },
  ],
  bots: true,
};
