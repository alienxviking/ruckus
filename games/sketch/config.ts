import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "laps",
      label: "Turns each",
      options: [
        { value: "auto", label: "Auto" },
        { value: 1, label: "1" },
        { value: 2, label: "2" },
        { value: 3, label: "3" },
      ],
      default: "auto",
      hint: "Auto: twice each with 3 or fewer players, once each with more.",
    },
    {
      kind: "choice",
      key: "drawSec",
      label: "Drawing time",
      options: [
        { value: 60, label: "60s" },
        { value: 80, label: "80s" },
        { value: 120, label: "120s" },
      ],
      default: 80,
    },
    {
      kind: "words",
      key: "words",
      label: "Words to draw",
      min: 5,
      maxLen: 24,
      hint: "One per line. Leave empty to use ours.",
      placeholder: "birthday cake\nhaunted house\ngrandma's cat",
    },
  ],
};
