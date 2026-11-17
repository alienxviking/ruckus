import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "wins",
      label: "Round wins needed",
      options: [
        { value: 1, label: "1" },
        { value: 2, label: "2" },
        { value: 3, label: "3" },
      ],
      default: 2,
      hint: "The match lasts up to twice this plus one rounds.",
    },
    {
      kind: "choice",
      key: "roundSec",
      label: "Round length",
      options: [
        { value: 60, label: "60s" },
        { value: 90, label: "90s" },
        { value: 120, label: "120s" },
      ],
      default: 90,
    },
  ],
  bots: true,
};
