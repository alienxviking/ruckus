import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "turns",
      label: "Turns",
      options: [
        { value: 10, label: "10" },
        { value: 15, label: "15" },
        { value: 20, label: "20" },
      ],
      default: 15,
      hint: "After the last turn, the most armour wins.",
    },
    {
      kind: "choice",
      key: "aimSec",
      label: "Aim timer",
      options: [
        { value: 10, label: "10s" },
        { value: 15, label: "15s" },
        { value: 25, label: "25s" },
      ],
      default: 15,
      hint: "Turn 1 gets 5 seconds more.",
    },
  ],
  bots: true,
};
