import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "laps",
      label: "Turns each",
      options: [
        { value: 0, label: "Auto" },
        { value: 1, label: "1" },
        { value: 2, label: "2" },
        { value: 3, label: "3" },
      ],
      default: 0,
      hint: "Auto: 2 each with up to 4 players, otherwise 1.",
    },
    {
      kind: "choice",
      key: "clue",
      label: "Clue time",
      options: [
        { value: 45, label: "45s" },
        { value: 70, label: "70s" },
        { value: 90, label: "90s" },
      ],
      default: 70,
    },
    {
      kind: "words",
      key: "words",
      label: "Your own phrases",
      min: 5,
      maxLen: 40,
      hint: "One per line: movies, sayings, inside jokes. Letters only. Leave empty to use ours.",
      placeholder: "jurassic park\nmonday morning\nthe office party",
    },
  ],
};
