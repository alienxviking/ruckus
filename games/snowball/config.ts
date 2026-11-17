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
      key: "hearts",
      label: "Hearts",
      options: [
        { value: 1, label: "1" },
        { value: 3, label: "3" },
        { value: 5, label: "5" },
      ],
      default: 3,
      hint: "Hits each player can take in a round.",
    },
  ],
  bots: true,
};
