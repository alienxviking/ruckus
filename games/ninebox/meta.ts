import type { GameMeta } from "../catalog";

// Catalog entry for Nine Box (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "ninebox",
  "name": "Nine Box",
  "tagline": "Every row, column and box: each number once. Pure logic, no guessing.",
  "category": "brain",
  "minPlayers": 1,
  "maxPlayers": 12,
  "minutes": 10,
  "emoji": "🔢",
  "accent": "#38bdf8",
  "how": [
    "Fill the grid so every row, column and box holds each number exactly once.",
    "Tap a cell, then a number. Wrong numbers count as mistakes; use notes to keep track.",
    "Solve it fast with few mistakes. Play solo, or race friends on the same grid."
  ],
  "original": true,
  "isNew": true
};
