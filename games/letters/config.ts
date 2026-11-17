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
    },
    {
      kind: "choice",
      key: "answerSec",
      label: "Writing time",
      options: [
        { value: 60, label: "60s" },
        { value: 90, label: "90s" },
        { value: 120, label: "120s" },
      ],
      default: 90,
    },
  ],
};
