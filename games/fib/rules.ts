import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "question", anim: "float", text: "Fill the blank in a strange fact" },
    { icon: "pencil", anim: "wiggle", text: "Write a fake answer to fool friends" },
    { icon: "search", anim: "tap", text: "Pick the real one from the fakes" },
  ],
  win: "Most points after the last fact",
  goal: "Score the most points over 6 rounds (the host can change this) by finding the real answers and fooling your friends with your fake ones.",
  flow: [
    "Each round shows a strange-but-true fact with one word or phrase blanked out.",
    "You have 50 seconds (the host can change this) to fill the blank with a fib: a fake answer that sounds believable. The round moves on early once everyone has written one.",
    "Everyone's fibs are mixed in with the real answer (plus a few extra fakes from the game if there are fewer than 4 choices). You have 30 seconds to pick the one you think is true.",
    "The answers people picked are revealed one by one, ending with the truth, along with who wrote each fib.",
    "After the last fact, the highest score wins.",
  ],
  controls: {
    desktop: [
      "Type your fib (up to 40 characters) and press Enter. Click your fib card to edit it until time runs out.",
      "Click the answer you think is true, or press 1-9 to pick the matching one.",
    ],
    touch: [
      "Type your fib and send it. Tap your fib card to edit it until time runs out.",
      "Tap the answer you think is true.",
    ],
  },
  scoring: [
    "Picking the real answer scores +500.",
    "You score +250 for every other player who picks your fib. If two players write the same fib, both get the points.",
    "Picking a fib or a game-made fake scores nothing. You can't pick your own fib, and your pick is final.",
    "Most points after the last round wins. Tied players share the win.",
  ],
  tips: [
    "If your fib is the real answer or one letter off it, the game will ask you to write a different one, so a lucky guess still can't score.",
    "Match the tone of the fact: if it sounds weird, the truth probably is too.",
    "All answers are shown in the same Title Case, so spelling style won't give the truth away.",
  ],
};
