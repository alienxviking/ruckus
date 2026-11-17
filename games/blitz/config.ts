import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "rounds",
      label: "Microgames",
      options: [
        { value: 6, label: "6" },
        { value: 12, label: "12" },
        { value: 18, label: "18" },
      ],
      default: 12,
      hint: "They get harder and faster as the match goes on.",
    },
    {
      kind: "choice",
      key: "mix",
      label: "Mix",
      options: [
        { value: "all", label: "Everything" },
        { value: "brainy", label: "Brainy" },
        { value: "reflex", label: "Reflexes" },
        { value: "chaos", label: "Chaos" },
      ],
      default: "all",
      hint: "Brainy: words, maths and memory. Reflexes: fast eyes and fingers. Chaos: everything, harder, with more twists.",
    },
    {
      kind: "choice",
      key: "finale",
      label: "Finale",
      options: [
        { value: "double", label: "Last 3 ×2" },
        { value: "boss", label: "Boss round ×3" },
        { value: "none", label: "None" },
      ],
      default: "double",
      hint: "Boss round: the last microgame is the hardest and worth triple.",
    },
    {
      kind: "choice",
      key: "pace",
      label: "Pace",
      options: [
        { value: "normal", label: "Normal" },
        { value: "relaxed", label: "Relaxed" },
      ],
      default: "normal",
      hint: "Relaxed gives 50% longer to answer.",
    },
  ],
  bots: true,
};
