import type { GameMeta } from "../catalog";

// Catalog entry for Code Word (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "codeword",
  "name": "Code Word",
  "tagline": "Crack the secret five-letter word in six tries.",
  "category": "brain",
  "minPlayers": 1,
  "maxPlayers": 12,
  "minutes": 4,
  "emoji": "🔐",
  "accent": "#4ade80",
  "how": [
    "Guess any five-letter word. Each tile turns green, yellow or grey to show how close you are.",
    "Green: right letter, right spot. Yellow: in the word, wrong spot.",
    "Crack it in as few guesses as you can. Solo, or race friends on the same word."
  ],
  "original": true,
  "isNew": true
};
