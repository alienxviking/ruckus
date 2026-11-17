import type { GameMeta } from "../catalog";

// Catalog entry for Tug of War (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "tug",
  "name": "Tug of War",
  "tagline": "Two teams. One rope. Pull!",
  "category": "arena",
  "minPlayers": 2,
  "maxPlayers": 12,
  "minutes": 4,
  "emoji": "🪢",
  "accent": "#f97316",
  "how": [
    "Split into two teams. Each round is a quick challenge: mash, type, or solve.",
    "Every correct answer pulls the rope your way.",
    "Drag the flag over your line to win the round. Best of five."
  ],
  "original": true,
  "isNew": true,
  "teams": true
};
