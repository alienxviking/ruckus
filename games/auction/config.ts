import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "crates",
      label: "Crates",
      options: [
        { value: 6, label: "6" },
        { value: 8, label: "8" },
        { value: 10, label: "10" },
      ],
      default: 8,
      hint: "How many lots go under the hammer.",
    },
  ],
  bots: true,
};
