import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "tries",
      label: "Towers each",
      options: [
        { value: 1, label: "1" },
        { value: 2, label: "2" },
        { value: 3, label: "3" },
      ],
      default: 2,
      hint: "Your best tower counts.",
    },
    {
      kind: "choice",
      key: "speed",
      label: "Speed",
      options: [
        { value: "chill", label: "Chill" },
        { value: "normal", label: "Normal" },
        { value: "fast", label: "Fast" },
      ],
      default: "normal",
      hint: "Blocks always speed up as the tower grows.",
    },
  ],
  bots: true,
};
