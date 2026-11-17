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
      key: "playSec",
      label: "Round length",
      options: [
        { value: 45, label: "45s" },
        { value: 75, label: "75s" },
        { value: 120, label: "120s" },
      ],
      default: 75,
      hint: "Survive this long to score as a human.",
    },
  ],
  bots: true,
};
