import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "size",
      label: "Board",
      options: [
        { value: 8, label: "8×8 classic" },
        { value: 6, label: "6×6 quick" },
      ],
      default: 8,
      hint: "6×6 games take about half as long.",
    },
    {
      kind: "choice",
      key: "hints",
      label: "Move hints",
      options: [
        { value: "on", label: "Show" },
        { value: "off", label: "Hide" },
      ],
      default: "on",
      hint: "Dots on every square where you can play.",
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
    },
  ],
  bots: true,
};
