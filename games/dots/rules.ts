import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "pencil", anim: "tap", text: "Draw one line between two dots" },
    { icon: "box", anim: "bounce", text: "Close a box to claim it" },
    { icon: "repeat", anim: "spin", text: "Claim one and you go again" },
  ],
  win: "Most boxes when the grid fills",
  goal: "Claim the most boxes by drawing the last side around them.",
  flow: [
    "The board is a grid of dots: 5x5 boxes for 2 players, 5x6 for 3, and 6x6 for 4 (the host can pick a smaller or larger board). A random player goes first.",
    "On your turn, draw one line between two dots that sit next to each other. You have 30 seconds (the host can change this).",
    "If your line closes the fourth side of a box (or two boxes), they become yours and you move again.",
    "If your line doesn't close a box, the turn passes to the next player.",
    "The game ends when every box has been claimed.",
  ],
  controls: {
    desktop: [
      "Click the gap between two dots to draw a line.",
      "Or use the arrow keys to move between open lines, Home/End to jump, and Enter or Space to draw.",
    ],
    touch: ["Tap the gap between two dots to draw a line."],
  },
  scoring: [
    "Each box you close is worth 1 point.",
    "Most boxes when the grid is full wins. Tied players share the win.",
    "If your time runs out, a line is drawn for you. Miss 2 moves in a row and your moves auto-play after 5 seconds until you tap I'm back.",
    "If a player disconnects, their moves are auto-played after 5 seconds.",
  ],
  tips: [
    "Avoid drawing the third side of a box: it lets the next player close it and move again.",
    "Late in the game, boxes link into long chains. Try to force your opponent to open the first chain so you can take it.",
  ],
};
