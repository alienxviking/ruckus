import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "wins",
      label: "Match length",
      options: [
        { value: 2, label: "Best of 3" },
        { value: 3, label: "Best of 5" },
        { value: 4, label: "Best of 7" },
      ],
      default: 3,
      hint: "Round wins a team needs to take the match.",
    },
    {
      kind: "choice",
      key: "mix",
      label: "Challenges",
      options: [
        { value: "all", label: "Everything" },
        { value: "mash", label: "Mash only" },
        { value: "brainy", label: "Brainy (type, sums, ink)" },
      ],
      default: "all",
      hint: "Which challenges the rounds rotate through.",
    },
  ],
  bots: true,
};
