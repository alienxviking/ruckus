import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "lives",
      label: "Lives",
      options: [
        { value: 0, label: "Auto" },
        { value: 1, label: "1" },
        { value: 2, label: "2" },
        { value: 3, label: "3" },
      ],
      default: 0,
      hint: "Auto: 2 each, or 1 with 9+ players.",
    },
    {
      kind: "choice",
      key: "fuse",
      label: "Fuse",
      options: [
        { value: "short", label: "Short" },
        { value: "normal", label: "Normal" },
        { value: "long", label: "Long" },
      ],
      default: "normal",
      hint: "Short 8–18s, normal 12–30s, long 20–45s.",
    },
  ],
  bots: true,
};
