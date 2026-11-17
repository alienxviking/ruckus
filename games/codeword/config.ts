import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "words",
      label: "Words",
      options: [
        { value: 1, label: "1" },
        { value: 3, label: "3" },
        { value: 5, label: "5" },
      ],
      default: 3,
      hint: "Everyone cracks the same secret words.",
    },
    {
      kind: "choice",
      key: "hard",
      label: "Hard mode",
      options: [
        { value: "off", label: "Off" },
        { value: "on", label: "On" },
      ],
      default: "off",
      hint: "Every hint you've been shown must be used in later guesses.",
    },
  ],
  bots: true,
};
