import type { GameMeta } from "../catalog";

// Catalog entry for Seeds (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "seeds",
  "name": "Seeds",
  "tagline": "Sow, capture, outsmart. An ancient classic.",
  "category": "board",
  "minPlayers": 2,
  "maxPlayers": 2,
  "minutes": 6,
  "emoji": "🌱",
  "accent": "#84cc16",
  "how": [
    "Pick up all the seeds in one of your pits and sow them one by one around the board.",
    "Land in your store for another turn; land in an empty pit to capture.",
    "Most seeds when a side runs out wins."
  ],
  "original": true,
  "isNew": true
};
