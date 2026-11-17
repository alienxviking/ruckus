import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "pages",
      label: "Pages per book",
      options: [
        { value: 4, label: "Up to 4" },
        { value: 6, label: "Up to 6" },
        { value: 8, label: "Up to 8" },
      ],
      default: 8,
      hint: "One page per player, capped here.",
    },
    {
      kind: "choice",
      key: "pace",
      label: "Timers",
      options: [
        { value: "quick", label: "Quick" },
        { value: "normal", label: "Normal" },
        { value: "relaxed", label: "Relaxed" },
      ],
      default: "normal",
      hint: "Normal: 40s to write, 70s to draw, 35s to describe.",
    },
  ],
};
