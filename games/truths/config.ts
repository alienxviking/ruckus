import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "write",
      label: "Writing time",
      options: [
        { value: 180, label: "3 min" },
        { value: 300, label: "5 min" },
        { value: 480, label: "8 min" },
      ],
      default: 300,
      hint: "Moves on early once everyone has locked in.",
    },
    {
      kind: "choice",
      key: "talk",
      label: "Grilling time",
      options: [
        { value: 60, label: "60s" },
        { value: 90, label: "90s" },
        { value: 150, label: "2½ min" },
      ],
      default: 90,
      hint: "Per player: reading, questions and voting. The reader can reveal early once everyone has voted.",
    },
  ],
};
