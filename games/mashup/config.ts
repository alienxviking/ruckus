import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "rounds",
      label: "Rounds",
      options: [
        { value: 1, label: "1" },
        { value: 2, label: "2" },
        { value: 3, label: "3" },
      ],
      default: 2,
    },
    {
      kind: "choice",
      key: "draw",
      label: "Drawing time",
      options: [
        { value: 45, label: "45s" },
        { value: 60, label: "60s" },
        { value: 90, label: "90s" },
      ],
      default: 60,
      hint: "Per body part.",
    },
  ],
};
