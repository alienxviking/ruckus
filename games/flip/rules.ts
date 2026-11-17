import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Have more discs of your colour on the board than your rival when the game ends.",
  flow: [
    "Two players share an 8×8 board (the host can pick a quick 6×6). It starts with four discs in the centre, two each. A random player moves first.",
    "On your turn place one disc on an empty square so that it traps one or more straight lines (across, up and down, or diagonal) of your rival's discs between the new disc and another of yours.",
    "Every trapped disc flips over to your colour. A square that traps nothing isn't a legal move.",
    "If you have no legal move you pass automatically and your rival plays again. When neither player can move, or the board is full, the game ends.",
    "In a best-of-3 match the next game starts on a fresh board and the other player goes first. Anyone beyond the first two players watches.",
  ],
  controls: {
    desktop: [
      "Click a square to place your disc. Hover a legal square to preview how many discs it would flip.",
      "Or Tab to a square and press Enter or Space.",
    ],
    touch: ["Tap a square to place your disc. Glowing dots mark every legal move (the host can hide them)."],
  },
  scoring: [
    "The game ends when neither player can move. Whoever has more discs wins; equal counts are a draw.",
    "By default it's a single game. The host can make it best of 3 (first to 2 game wins; draws count for nobody, and after 5 games the player with more wins takes it).",
    "You have 30 seconds per move, or a random legal move is played for you. If you disconnect, it's played after 5 seconds.",
    "A player who stays disconnected for a full minute forfeits.",
  ],
  tips: [
    "Corners can never be flipped: grab them when you can.",
    "Avoid the squares diagonally next to an empty corner; they hand your rival that corner.",
    "Flipping fewer discs early often keeps your rival short of moves later.",
  ],
};
