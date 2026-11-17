import type { GameMeta } from "../catalog";

// Catalog entry for Flip (listed in games/catalog.ts).
export const meta: GameMeta = {
  "id": "flip",
  "name": "Flip",
  "tagline": "Outflank to flip. Own the board.",
  "category": "board",
  "minPlayers": 2,
  "maxPlayers": 2,
  "minutes": 6,
  "emoji": "⚫",
  "accent": "#a3e635",
  "how": [
    "Place a disc so it traps a line of your rival's discs against one of yours.",
    "Every trapped disc flips to your colour.",
    "No move? You pass. Most discs when nobody can move wins."
  ],
  "original": true,
  "isNew": true
};
