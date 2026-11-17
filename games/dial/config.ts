import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "laps",
      label: "Clues each",
      options: [
        { value: "auto", label: "Auto" },
        { value: 1, label: "1" },
        { value: 2, label: "2" },
        { value: 3, label: "3" },
      ],
      default: "auto",
      hint: "Auto: two each with 2-3 players, one each with 4+.",
    },
    {
      kind: "choice",
      key: "guess",
      label: "Guessing time",
      options: [
        { value: 25, label: "25s" },
        { value: 40, label: "40s" },
        { value: 60, label: "60s" },
      ],
      default: 40,
    },
  ],
};
