import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Be the first player to win 3 rounds (the host can change this) by getting three of your marks in a row.",
  flow: [
    "One player is X and the other is O. A coin flip decides who goes first.",
    "Take turns placing your mark in any empty square of the 3×3 board.",
    "The round ends when someone gets three in a row (across, down or diagonal) or the board fills up.",
    "After a short pause a fresh board appears, and the other player starts this time.",
    "Keep playing rounds until someone reaches that many wins.",
  ],
  controls: {
    desktop: [
      "Click an empty square to place your mark.",
      "Or press keys 1–9: the squares are numbered left to right, top to bottom.",
    ],
    touch: ["Tap an empty square to place your mark."],
  },
  scoring: [
    "Three in a row wins the round and earns you 1 point.",
    "A full board with no line is a draw: nobody scores.",
    "The first player to reach the target number of round wins takes the match.",
    "If a player disconnects for 20 seconds, the player who stayed wins.",
  ],
  tips: [
    "If you start, the center or a corner gives you the most ways to make a line.",
    "Before every move, check whether your opponent is one square away from three in a row, and block it.",
    "Try to set up two threats at once. Your opponent can only block one.",
  ],
};
