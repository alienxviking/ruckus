import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "rounds",
      label: "Rounds",
      options: [
        { value: 3, label: "3" },
        { value: 5, label: "5" },
        { value: 7, label: "7" },
      ],
      default: 3,
    },
    {
      kind: "choice",
      key: "clueSec",
      label: "Clue timer",
      options: [
        { value: 15, label: "15s" },
        { value: 25, label: "25s" },
        { value: 40, label: "40s" },
      ],
      default: 25,
    },
    {
      kind: "words",
      key: "words",
      label: "Your word pairs",
      min: 3,
      maxLen: 40,
      hint: "One pair per line: the group's word / the odd one's word. Pick two related things. Leave empty to use ours.",
      placeholder: "coffee / tea\nbeach / desert\nguitar / violin",
    },
  ],
};
