import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "grid", anim: "float", text: "Everyone solves the same number grid" },
    { icon: "hash", anim: "tap", text: "Each number once per row, column, box" },
    { icon: "ban", anim: "pulse", text: "Wrong numbers count as mistakes" },
  ],
  win: "Solve fastest with fewest mistakes",
  goal: "Fill every empty cell so each row, column and box holds each number exactly once: solve it fastest with the fewest mistakes.",
  flow: [
    "Everyone gets the same grid. It has exactly one solution and can always be solved by logic, no guessing needed.",
    "The host picks the grid (9×9 with 3×3 boxes and numbers 1–9, or a quick 6×6 with 2×3 boxes and numbers 1–6) and the difficulty (Easy, Medium or Hard: fewer clues and trickier logic).",
    "After a 3-second countdown, tap a cell and pick a number. A wrong number is refused, flashes red and counts as a mistake.",
    "Mistake limit: 3 by default (the host can pick 5 or Off). Hit it and your grid is finished.",
    "The game ends when everyone has solved, run out of mistakes or given up. Time limit: 20 / 30 / 45 minutes for a 9×9 (Easy / Medium / Hard), 8 / 10 / 15 for a 6×6.",
  ],
  controls: {
    desktop: [
      "Click a cell or move with the arrow keys; type a number to place it.",
      "Shift+number, or N to switch Notes on, writes pencil marks. Backspace erases a cell's notes; U or Ctrl+Z undoes a note change.",
    ],
    touch: ["Tap a cell, then a number on the pad. Tap Notes to pencil in candidates instead."],
  },
  scoring: [
    "Solving scores 600, plus up to 400 for speed (full marks at half the expected time: 4 / 6 / 9 minutes for a 9×9, 1 / 1.5 / 2.5 for a 6×6).",
    "Each mistake costs 50 points; a solved grid never scores below 350.",
    "An unsolved grid scores up to 300 for the share of empty cells you filled. Highest score wins.",
  ],
  tips: [
    "Look for a row, column or box that's missing just one or two numbers.",
    "Selecting a number highlights everywhere it already sits: find where it still fits.",
    "Notes clean themselves up as numbers land in the same row, column or box.",
  ],
};
