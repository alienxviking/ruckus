import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Score the most points by guessing other players' emoji clues quickly and giving clues people can crack.",
  flow: [
    "Everyone takes one turn as the clue-giver. On your turn you get 15 seconds to pick one of 3 secret phrases, each from a different category (like Movie plot, Food & drink or Place). If you don't pick, you get the first one.",
    "You then have 70 seconds to describe the phrase using only emoji, up to 12 at a time. No letters or numbers allowed. You can change your clue as often as you like.",
    "Everyone else sees the category and the clue as it changes, and types guesses. Wrong guesses show up in the feed for all to see.",
    "If your guess is nearly right, you get a private \"close\" hint. Small typos are forgiven.",
    "As time runs out, a few letters of the phrase are revealed as hints. The turn ends when time is up or everyone has guessed it.",
  ],
  controls: {
    desktop: [
      "Clue-giver: click emoji on the emoji keyboard, or type in its search box and press Enter to add the top match. Backspace removes the last emoji.",
      "Guessers: just start typing anywhere and press Enter to send a guess.",
    ],
    touch: [
      "Clue-giver: tap emoji on the emoji keyboard, or search for one by name.",
      "Guessers: tap the guess box, type and send.",
    ],
  },
  scoring: [
    "A correct guess scores 100 points, plus up to 300 more the faster you are.",
    "The first correct guesser gets +50 extra, the second +25.",
    "The clue-giver earns 50 points for every player who guesses it, plus a 50 bonus if more than one guesses and everyone gets it.",
    "After everyone's turn, the highest score wins. Tied players share the win.",
  ],
  tips: [
    "Clue-givers: break the phrase into parts and show one idea at a time, then rearrange as people get close.",
    "Guessers: read the wrong guesses in the feed. They tell you what the answer isn't.",
  ],
};
