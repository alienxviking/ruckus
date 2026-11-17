import type { GameMeta } from "../catalog";

// Catalog entry for Word Smuggler (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "smuggle",
  "name": "Word Smuggler",
  "tagline": "Talk your team to the word. Don't say the banned ones.",
  "category": "party",
  "minPlayers": 4,
  "maxPlayers": 12,
  "minutes": 10,
  "emoji": "🗣️",
  "accent": "#f59e0b",
  "how": [
    "Teams take turns: one player describes a secret word out loud while their team shouts guesses.",
    "Five banned words are off limits. The other team sees them and can buzz you.",
    "Most words smuggled after the last round wins."
  ],
  "original": true,
  "isNew": true,
  "teams": true,
  "call": true
};
