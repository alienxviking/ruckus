import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "rounds",
      label: "Rounds",
      options: [
        { value: 3, label: "3" },
        { value: 5, label: "5" },
        { value: 7, label: "7" },
      ],
      default: 5,
    },
    {
      kind: "choice",
      key: "planSec",
      label: "Planning time",
      options: [
        { value: 25, label: "25s" },
        { value: 40, label: "40s" },
        { value: 60, label: "60s" },
      ],
      default: 40,
      hint: "Round 1 gets 10 seconds extra.",
    },
  ],
  bots: true,
};
