import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "target",
      label: "Rounds to win",
      options: [
        { value: 1, label: "1" },
        { value: 3, label: "3" },
        { value: 5, label: "5" },
      ],
      default: 3,
      hint: "First to this many round wins takes the match.",
    },
  ],
  bots: true,
};
