import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "holes",
      label: "Holes",
      options: [
        { value: 3, label: "3" },
        { value: 6, label: "6" },
        { value: 9, label: "9" },
      ],
      default: 6,
    },
    {
      kind: "choice",
      key: "aim",
      label: "Aim timer",
      options: [
        { value: 8, label: "8s" },
        { value: 12, label: "12s" },
        { value: 20, label: "20s" },
      ],
      default: 12,
      hint: "The first shot on each hole gets 3 seconds extra.",
    },
  ],
  bots: true,
};
