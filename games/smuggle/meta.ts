import type { GameMeta } from "../catalog";

// Catalog entry for Word Smuggler (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "smuggle",
  "name": "Word Smuggler",
  "tagline": "Talk your team to the word. Don't say the banned ones.",
  "category": "party",
  "minPlayers": 4,
  "maxPlayers": 12,
  "minutes": 12,
  "emoji": "🗣️",
  "accent": "#f59e0b",
  "how": [
    "Two teams take turns: one player describes a secret word out loud while their teammates shout guesses.",
    "Five banned words are off limits. The other team sees them and buzzes if one slips out.",
    "Got it +1, buzzed −1. Most points after everyone has described wins."
  ],
  "original": true,
  "isNew": true,
  "teams": true,
  "call": true
};
