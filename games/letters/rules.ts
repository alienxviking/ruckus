import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "type", anim: "tap", text: "Get a letter and six categories" },
    { icon: "pencil", anim: "wiggle", text: "Write an answer for each one" },
    { icon: "star", anim: "pulse", text: "Answers nobody else gave score double" },
  ],
  win: "Most points after the last round",
  goal: "Score the most points over 3 rounds (the host can change this) by writing answers that start with the round's letter, ideally ones nobody else thought of.",
  flow: [
    "Each round shows one letter and six categories, like an animal or a city.",
    "You have 90 seconds (the host can change this) to write one answer per category that starts with that letter. Tap Done when finished (tap again to keep editing). The round moves on early once everyone is done.",
    "Then everyone's answers are shown. You have 60 seconds to veto any answer that doesn't fit its category. Tap Looks good when you're happy.",
    "Points for the round are shown for 6 seconds, then the next round starts with a new letter and new categories.",
    "After the last round the highest total wins.",
  ],
  controls: {
    desktop: [
      "Type in each box. Press Enter to jump to the next box.",
      "Click 👎 on someone else's answer to veto it. Click again to take the veto back.",
    ],
    touch: [
      "Tap each box and type. Tap Done when you're finished.",
      "Tap 👎 on someone else's answer to veto it. Tap again to take it back.",
    ],
  },
  scoring: [
    "A valid answer nobody else gave scores 10 points. An answer someone else also gave scores 5.",
    "Blank answers, answers that don't start with the letter, and answers shorter than 2 letters score 0.",
    "An answer is knocked out once vetoes reach half of the other players (rounded up, at least 1).",
    "Highest total after the last round wins. Tied players share the win.",
  ],
  tips: [
    "A leading 'The', 'A' or 'An' is ignored, so 'The Beatles' counts for B.",
    "Capitals, accents, spaces, punctuation and a simple plural don't make an answer different: 'Cats' and 'cat' count as the same.",
    "Go for unusual answers: a unique answer is worth double a shared one.",
  ],
};
