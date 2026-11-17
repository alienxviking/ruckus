import type { GameMeta } from "../catalog";

// Catalog entry for Group Up (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "groupup",
  "name": "Group Up",
  "tagline": "Sixteen words. Four secret groups. Don't fall for the decoys.",
  "category": "brain",
  "minPlayers": 1,
  "maxPlayers": 12,
  "minutes": 5,
  "emoji": "🧩",
  "accent": "#e879f9",
  "how": [
    "Sixteen words hide four groups of four that share something.",
    "Pick four you think belong together and submit. Four wrong guesses and the puzzle's over.",
    "Find every group with the fewest mistakes. Solo, or race friends on the same words."
  ],
  "original": true,
  "isNew": true
};
