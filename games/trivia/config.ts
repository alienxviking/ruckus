import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "questions",
      label: "Questions",
      options: [
        { value: 5, label: "5" },
        { value: 10, label: "10" },
        { value: 15, label: "15" },
      ],
      default: 10,
    },
    {
      kind: "choice",
      key: "seconds",
      label: "Time per question",
      options: [
        { value: 10, label: "10s" },
        { value: 15, label: "15s" },
        { value: 20, label: "20s" },
      ],
      default: 15,
    },
  ],
  bots: true,
};
