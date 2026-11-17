import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "wins",
      label: "Match length",
      options: [
        { value: 2, label: "First to 2" },
        { value: 3, label: "First to 3" },
        { value: 5, label: "First to 5" },
      ],
      default: 3,
      hint: "Round wins needed to be champion.",
    },
  ],
  bots: true,
};
