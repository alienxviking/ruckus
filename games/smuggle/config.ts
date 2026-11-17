import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "time",
      label: "Turn length",
      options: [
        { value: 45, label: "45s" },
        { value: 60, label: "60s" },
        { value: 90, label: "90s" },
      ],
      default: 60,
      hint: "How long each describer gets.",
    },
    {
      kind: "choice",
      key: "turns",
      label: "Turns",
      options: [
        { value: 1, label: "Everyone once" },
        { value: 2, label: "Everyone twice" },
      ],
      default: 1,
      hint: "Each team always gets at least 3 turns.",
    },
    {
      kind: "words",
      key: "words",
      label: "Your own words",
      min: 10,
      max: 200,
      maxLen: 24,
      hint: "10 or more replaces the built-in cards. Custom words have no banned list: buzz if the describer says the word itself.",
      placeholder: "Grandma's lasagna, Our road trip, The office printer…",
    },
  ],
};
