import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Climb from the start word to the goal word in as few steps as you can, scoring the most points over all the ladders.",
  flow: [
    "Everyone gets the same ladders: 5 by default (the host can pick 3, 5 or 8, and Easy, Normal or Hard).",
    "After a 3-second countdown, change one letter of your word per step. Every step must be a real English word, and you can't reuse a word on the same ladder.",
    "Each ladder has a par (the fewest steps possible) and a clock: 30 seconds plus 15 seconds per par step (a par-4 ladder gets 90 seconds).",
    "Reach the goal word to solve it. Your result and a best ladder show for 3 seconds, then the next ladder starts.",
    "Everyone plays at their own pace. The game ends when everyone has finished every ladder.",
  ],
  controls: {
    desktop: [
      "Click a letter tile (or press 1–5, or use ←/→) to pick which letter to change, then type the new letter.",
      "Backspace steps back one word.",
    ],
    touch: ["Tap the letter tile to change, then tap the new letter on the keyboard."],
  },
  scoring: [
    "Solving a ladder: 100 points, plus up to 50 for speed (the more time left, the more you get).",
    "Each step over par costs 20 points. Each hint costs 30 points. A solved ladder is always worth at least 10.",
    "A hint plays the next step of a best ladder for you.",
    "Running out of time or giving up scores 0 for that ladder.",
    "Most points in total wins. Tied players share the win.",
  ],
  tips: [
    "Green letters already match the goal: change the others first.",
    "Watch the steps-to-goal counter: if it goes up, step back and try another letter.",
  ],
};
