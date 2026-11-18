import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "type", anim: "tap", text: "Change one letter at a time" },
    { icon: "check", anim: "pulse", text: "Every step must be a real word" },
    { icon: "goal", anim: "bounce", text: "Reach the goal word in fewest steps" },
  ],
  win: "Fewest steps over all ladders",
  goal: "Climb from each start word to its goal word in as few steps as you can. Fewest steps over all the ladders wins.",
  flow: [
    "Everyone gets the same ladders: 5 by default (the host can pick 3, 5 or 8, and Easy, Normal or Hard).",
    "After a 3-second countdown, change one letter of your word per step. Every step must be a real English word, and you can't reuse a word on the same ladder.",
    "You see the shortest possible route for each ladder and how far away you are. There's no step limit, just a generous clock (1 minute plus 20 seconds per step of the shortest route).",
    "Reach the goal word to solve it. Your result and a shortest ladder show for 3 seconds, then the next ladder starts.",
    "Everyone plays at their own pace. The game ends when everyone has finished every ladder.",
  ],
  controls: {
    desktop: [
      "Click a letter tile (or press 1–5, or use ←/→) to pick which letter to change, then type the new letter.",
      "Backspace steps back one word (stepping back doesn't cost a step).",
    ],
    touch: ["Tap the letter tile to change, then tap the new letter on the keyboard."],
  },
  scoring: [
    "Each ladder counts the steps you climbed to solve it. Fewest steps over all the ladders wins.",
    "A hint plays the next step of a shortest ladder for you and adds 1 extra step.",
    "Giving up, or running out of time, counts as the shortest route plus 5 steps.",
    "If two players tie on steps, the faster one wins.",
  ],
  tips: [
    "Green letters already match the goal: change the others first.",
    "Watch the steps-away counter: if it goes up, step back and try another letter.",
  ],
};
