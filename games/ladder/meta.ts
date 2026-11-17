import type { GameMeta } from "../catalog";

// Catalog entry for Word Ladder (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "ladder",
  "name": "Word Ladder",
  "tagline": "Change one letter at a time. Reach the word.",
  "category": "brain",
  "minPlayers": 1,
  "maxPlayers": 12,
  "minutes": 5,
  "emoji": "🪜",
  "accent": "#c084fc",
  "how": [
    "Turn the start word into the goal word, one letter at a time.",
    "Every step must be a real word. Use as few steps as you can.",
    "Fewest steps over all the ladders wins. Play solo or race friends on the same ladders."
  ],
  "original": true,
  "isNew": true
};
