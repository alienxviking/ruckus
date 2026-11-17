import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Find as many words as you can on the wheel before the clock runs out. Most points wins.",
  flow: [
    "Everyone gets the same wheel: six letters on the ring and one in the centre.",
    "After a 3-second countdown, make words of 4 or more letters. Every word must use the centre letter; letters can be used more than once.",
    "Words must be real, reasonably common English words (no names, no slang spellings). Every wheel has 20 to 60 of them, including at least one that uses all seven letters.",
    "The clock is 3 minutes per wheel (the host can pick 2, 3 or 5) and there is 1 wheel by default (the host can pick 1, 2 or 3). Press \"I'm done\" to stop early; a wheel ends early when everyone is done.",
    "When a wheel ends you see the words you missed, then the next wheel starts after 10 seconds.",
    "Racing friends? The board shows their word counts and points, never their words.",
  ],
  controls: {
    desktop: ["Type letters, Backspace to delete, Enter to play the word, Space to shuffle the ring."],
    touch: ["Tap letters on the wheel, then ENTER. ⌫ deletes, ↻ shuffles the ring."],
  },
  scoring: [
    "A 4-letter word scores 1 point.",
    "Longer words score 1 point per letter (a 6-letter word scores 6).",
    "A word that uses all seven letters scores its length plus a 7-point bonus.",
    "Points add up over all the wheels. Most points wins.",
  ],
  tips: [
    "Hunt for the all-seven word early: it's worth at least 14 points.",
    "Try endings like -ING, -ED and -ER on words you've already found.",
    "Stuck? Shuffle the ring to see the letters fresh.",
  ],
};
