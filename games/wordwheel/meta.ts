import type { GameMeta } from "../catalog";

// Catalog entry for Word Wheel (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "wordwheel",
  "name": "Word Wheel",
  "tagline": "Seven letters. One must be in every word. Go!",
  "category": "brain",
  "minPlayers": 1,
  "maxPlayers": 12,
  "minutes": 4,
  "emoji": "🎡",
  "accent": "#f59e0b",
  "how": [
    "Make words of 4+ letters from the wheel. The centre letter must be in every word; letters can repeat.",
    "Longer words score more. A word using all seven letters gets a big bonus.",
    "Most points when the clock runs out wins. Solo, or race friends on the same wheel."
  ],
  "original": true,
  "isNew": true
};
