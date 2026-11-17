import type { GameMeta } from "../catalog";

// Catalog entry for Tug of War (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "tug",
  "name": "Tug of War",
  "tagline": "Two teams. One rope. Mash, type, solve: PULL!",
  "category": "arena",
  "minPlayers": 2,
  "maxPlayers": 12,
  "minutes": 4,
  "emoji": "🪢",
  "accent": "#f97316",
  "how": [
    "Red vs Blue. Each round is a quick challenge: mash, type, sums, colours or rhythm.",
    "Every right answer drags the flag your way. Last 8 seconds pull 1.6×.",
    "Drag it over your line (or lead at the buzzer) to win the round. Best of five."
  ],
  "original": true,
  "isNew": true,
  "teams": true
};
