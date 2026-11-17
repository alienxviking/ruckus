import type { GameMeta } from "../catalog";

// Catalog entry for Group Up (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "groupup",
  "name": "Group Up",
  "tagline": "Sixteen words. Four secret groups. Find them.",
  "category": "brain",
  "minPlayers": 1,
  "maxPlayers": 12,
  "minutes": 5,
  "emoji": "🧩",
  "accent": "#e879f9",
  "how": [
    "Sixteen words hide four groups of four that share something.",
    "Pick four you think belong together and submit. Four wrong guesses and you're out.",
    "Find all four groups with the fewest mistakes. Solo, or race friends."
  ],
  "original": true,
  "isNew": true
};
