import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "board",
      label: "Board size",
      options: [
        { value: "small", label: "16 cards" },
        { value: "normal", label: "24 cards" },
        { value: "large", label: "36 cards" },
      ],
      default: "normal",
    },
    {
      kind: "choice",
      key: "turnSec",
      label: "Turn timer",
      options: [
        { value: 10, label: "10s" },
        { value: 15, label: "15s" },
        { value: 25, label: "25s" },
      ],
      default: 15,
      hint: "Multiplayer only. Solo plays against the clock.",
    },
  ],
  bots: true,
};
