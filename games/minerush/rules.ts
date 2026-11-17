import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Score the most points by digging up safe cells and treasure on one shared minefield, without blowing yourself up.",
  flow: [
    "Everyone shares the same field: 24×16 cells for up to 3 players, 30×20 for 4 or more (the host can pick a smaller or bigger field, and fewer or more mines). A patch in the middle starts already open.",
    "You get 3 seconds to study the opening, then the digging starts for everyone at once.",
    "Open hidden cells. A number tells you how many mines touch that cell, so use it to work out where the mines are.",
    "Whoever opens a cell first gets it. Hidden under some safe cells are 💎 gems, 🔍 scans and ❄️ freezes (no freezes when you play alone).",
    "The game ends when every safe cell is open or after 3 minutes (the host can change this), whichever comes first.",
  ],
  controls: {
    desktop: [
      "Click a hidden cell to dig it. Right-click (or Ctrl+click) to place or remove a flag.",
      "Click a number whose mines you've all flagged to open every other cell around it.",
      "Switch the Dig / Flag buttons to swap what a normal click does.",
      "Keyboard: arrow keys move the cursor, Space or Enter digs, F flags, + and − zoom.",
    ],
    touch: [
      "Tap a hidden cell to dig it. Long-press to place or remove a flag.",
      "Tap a number whose mines you've all flagged to open every other cell around it.",
      "Switch the Dig / Flag buttons to swap what a tap and a long-press do.",
      "Pinch to zoom and drag to look around the field.",
    ],
  },
  scoring: [
    "+1 for every safe cell you open, including the ones that cascade open around an empty cell. 💎 Gem: +15.",
    "Hit a mine: −10 and you're stunned for 4 seconds. A ❄️ freezes everyone else for 2 seconds. A 🔍 secretly flags every mine within 2 cells of it, just for you.",
    "Your flags are private. At the end, each flag on a mine is +2 and each flag on a safe cell is −2. You can't place more flags than there are mines.",
    "Highest score wins and ties share the win. If nobody finishes above zero, nobody wins.",
  ],
  tips: [
    "Big empty areas cascade open for lots of points in one click, so race to the edges of fresh openings.",
    "A mine costs you 10 points plus 4 seconds of digging, so when you're unsure, flag it and move on.",
    "Flag mines next to numbers, then click the number to clear the rest around it in one go.",
  ],
};
