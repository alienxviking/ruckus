import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Score the most points by spotting the player with the different word, or by blending in when that player is you.",
  flow: [
    "Everyone gets the same secret word, except one player, the odd one out, who gets a related word. Nobody is told which word they have, so even the odd one doesn't know. The host can also type in their own word pairs.",
    "Players take turns giving a one-word clue about their word, in a random order. Everyone goes twice. You have 25 seconds per clue (the host can change this), or your turn is passed.",
    "Then everyone has 45 seconds to vote for the player whose clues seem off. You can change your vote, and voting closes 2 seconds after everyone has voted.",
    "If the odd one out gets the most votes, they have 25 seconds to guess everyone else's word.",
    "Both words and all the votes are revealed. The game lasts 3 rounds by default (the host can pick more), with new words each time.",
  ],
  controls: {
    desktop: [
      "On your turn, type a one-word clue and press Enter.",
      "Click a player to vote for them, or press 1-9 to vote for the matching card.",
    ],
    touch: [
      "On your turn, type a one-word clue and tap Send.",
      "Tap a player to vote for them. Tap your word card to hide or show your word.",
    ],
  },
  scoring: [
    "The odd one out escapes and scores +3 if the vote is a tie, nobody votes, or someone else gets the most votes.",
    "If caught, the odd one out scores +2 by guessing the other word (plurals and one small typo are forgiven).",
    "If the odd one out is caught and guesses wrong, everyone else scores +1, plus +1 more if they voted for the odd one.",
    "Most points after the last round wins. Tied players share the win.",
  ],
  tips: [
    "Clues must be one word, up to 20 characters. You can't use your own word (or a word containing it) or repeat a clue already given this round.",
    "Be vague enough not to hand the word to the odd one out, but clear enough to prove you're not them.",
    "If the other clues don't quite fit your word, you might be the odd one: copy their style and get ready to guess.",
  ],
};
