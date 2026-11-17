import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "clock",
      label: "Bomb timer",
      options: [
        { value: 120, label: "2:00" },
        { value: 180, label: "3:00" },
        { value: 240, label: "4:00" },
        { value: 300, label: "5:00" },
      ],
      default: 180,
      hint: "Time on each bomb's clock.",
    },
  ],
};
