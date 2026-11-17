import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "minutes",
      label: "Length",
      options: [
        { value: 2, label: "2 min" },
        { value: 3, label: "3 min" },
        { value: 5, label: "5 min" },
      ],
      default: 3,
      hint: "Ends sooner if the whole field is cleared.",
    },
    {
      kind: "choice",
      key: "board",
      label: "Field size",
      options: [
        { value: "small", label: "Small" },
        { value: "normal", label: "Normal" },
        { value: "large", label: "Large" },
      ],
      default: "normal",
      hint: "Normal grows with the player count.",
    },
    {
      kind: "choice",
      key: "mines",
      label: "Mines",
      options: [
        { value: "few", label: "Few" },
        { value: "normal", label: "Normal" },
        { value: "lots", label: "Lots" },
      ],
      default: "normal",
    },
  ],
  bots: true,
};
