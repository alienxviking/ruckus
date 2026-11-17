import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "caps",
      label: "Captures to win",
      options: [
        { value: 2, label: "2" },
        { value: 3, label: "3" },
        { value: 5, label: "5" },
      ],
      default: 3,
      hint: "First team to bring this many flags home wins.",
    },
    {
      kind: "choice",
      key: "minutes",
      label: "Time limit",
      options: [
        { value: 3, label: "3 min" },
        { value: 5, label: "5 min" },
        { value: 8, label: "8 min" },
      ],
      default: 5,
      hint: "Clock runs only during play. Leader wins at the buzzer; a tie goes to overtime.",
    },
  ],
  bots: true,
};
