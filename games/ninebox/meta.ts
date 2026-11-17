import type { GameMeta } from "../catalog";

// Catalog entry for Nine Box (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "ninebox",
  "name": "Nine Box",
  "tagline": "Fill the grid so every row, column and box has each number once.",
  "category": "brain",
  "minPlayers": 1,
  "maxPlayers": 12,
  "minutes": 8,
  "emoji": "🔢",
  "accent": "#38bdf8",
  "how": [
    "Fill the empty cells with numbers.",
    "Every row, column and box must contain each number exactly once.",
    "Solve it fastest with the fewest mistakes. Solo, or race friends on the same puzzle."
  ],
  "original": true,
  "isNew": true
};
