import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "users", anim: "float", text: "Two players share one board" },
    { icon: "tap", anim: "tap", text: "Take turns dropping a disc" },
    { icon: "link", anim: "pulse", text: "Line up four in a row" },
  ],
  win: "Win the most games in the match",
  goal: "Win the match by being first to line up four of your discs in a row.",
  flow: [
    "Two players share a board 7 columns wide and 6 rows tall. A random player starts the first game.",
    "Take turns dropping one disc into a column. It falls to the lowest empty space.",
    "Line up four of your discs across, up and down, or diagonally to win the game. If the board fills with no line, the game is a draw.",
    "After a short pause the next game starts on a clear board, and the other player goes first.",
    "Anyone beyond the first two players watches.",
  ],
  controls: {
    desktop: [
      "Click a column to drop a disc there, or press 1-7 for that column.",
      "Or use the left and right arrow keys (Home/End for the edges) and press Enter or Space to drop.",
    ],
    touch: ["Tap a column to drop a disc there."],
  },
  scoring: [
    "Each game you win is worth 1. First to 2 game wins takes the match (the host can make it best of 1 or best of 5). Draws count for nobody.",
    "The match stops after 5 games (3 or 7 for the shorter or longer match): whoever has more wins takes it, and an equal score is a shared win.",
    "You have 30 seconds per move (the host can change this), or a disc drops into a random column for you. If you disconnect, it drops after 5 seconds.",
    "A player who stays disconnected for a full minute forfeits the match.",
  ],
  tips: [
    "Block right away when your opponent has three in a row with an open end.",
    "Aim to make two threats at once: your opponent can only block one.",
    "Discs in the middle column take part in the most possible lines.",
  ],
};
