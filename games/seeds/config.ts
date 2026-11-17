import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "seeds",
      label: "Seeds per pit",
      options: [
        { value: 3, label: "3 (quick)" },
        { value: 4, label: "4" },
        { value: 5, label: "5" },
        { value: 6, label: "6 (long)" },
      ],
      default: 4,
      hint: "How many seeds each pit starts with.",
    },
    {
      kind: "choice",
      key: "wins",
      label: "Match length",
      options: [
        { value: 1, label: "Single game" },
        { value: 2, label: "Best of 3" },
      ],
      default: 1,
      hint: "Game wins needed to take the match.",
    },
    {
      kind: "choice",
      key: "turn",
      label: "Move timer",
      options: [
        { value: 15, label: "15s" },
        { value: 30, label: "30s" },
        { value: 45, label: "45s" },
      ],
      default: 30,
    },
  ],
  bots: true,
};
