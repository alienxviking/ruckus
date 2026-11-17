import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Work together so that everyone types the exact same word in the same round, within 8 rounds.",
  flow: [
    "Round 1: everyone secretly types any word they like. You have 40 seconds.",
    "All the words are revealed at once, with matching words grouped together.",
    "Every round after that, you have 60 seconds to type the one word you think best links the words from the last round.",
    "Rounds reveal early once everyone has locked in. A word used in any earlier round can't be used again.",
    "Keep going until all the words match (a Mind Meld) or 8 rounds are used up.",
  ],
  controls: {
    desktop: [
      "Start typing a word and press Enter (or click Lock in) to lock it in.",
      "Click Change to edit your locked word before the reveal.",
    ],
    touch: [
      "Type a word and tap Lock in.",
      "Tap Change to edit your locked word before the reveal.",
    ],
  },
  scoring: [
    "There are no points: you all win together if every word in a round matches, or all lose if 8 rounds pass without a match.",
    "Capitals, accents, spaces, hyphens, a leading 'the/a/an' and simple plurals are ignored, so 'Ice-cream' matches 'ice creams'.",
    "Anyone who leaves the box empty (while still connected) stops that round from matching.",
    "Fewer rounds earn a better rating: 1 round is Impossible?!, 2 Telepathic, 3-4 Great minds, 5-6 Getting there, 7-8 Phew!",
  ],
  tips: [
    "Think about the most obvious link, not the cleverest one: you want to land where everyone else will.",
    "When two words are left, aim for the word that sits right between them.",
    "Words are limited to 24 characters, letters only (spaces, hyphens and apostrophes are fine).",
  ],
};
