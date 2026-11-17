import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "rounds",
      label: "Facts",
      options: [
        { value: 4, label: "4" },
        { value: 6, label: "6" },
        { value: 8, label: "8" },
        { value: 10, label: "10" },
      ],
      default: 6,
    },
    {
      kind: "choice",
      key: "write",
      label: "Writing time",
      options: [
        { value: 30, label: "30s" },
        { value: 50, label: "50s" },
        { value: 80, label: "80s" },
      ],
      default: 50,
    },
  ],
};
