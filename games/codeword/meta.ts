import type { GameMeta } from "../catalog";

// Catalog entry for Code Word (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "codeword",
  "name": "Code Word",
  "tagline": "Crack the secret five-letter word in six tries.",
  "category": "brain",
  "minPlayers": 1,
  "maxPlayers": 12,
  "minutes": 5,
  "emoji": "🔐",
  "accent": "#4ade80",
  "how": [
    "Guess a real five-letter word. Each tile flips to show how close you are.",
    "Lime: right letter, right spot. Cyan: in the word, wrong spot. Dark: not in it.",
    "Crack it in fewer guesses for more points. Solo, or race friends on the same words."
  ],
  "original": true,
  "isNew": true
};
