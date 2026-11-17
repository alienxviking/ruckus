import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "wins",
      label: "Rounds to win",
      options: [
        { value: 2, label: "2" },
        { value: 3, label: "3" },
        { value: 5, label: "5" },
      ],
      default: 3,
      hint: "First to this many round wins takes the match.",
    },
    {
      kind: "choice",
      key: "crumble",
      label: "Edges crumble after",
      options: [
        { value: 15_000, label: "15s" },
        { value: 25_000, label: "25s" },
        { value: 40_000, label: "40s" },
      ],
      default: 25_000,
    },
  ],
  bots: true,
};
