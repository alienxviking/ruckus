import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Score the most points by guessing other players' drawings fast and drawing so others can guess yours.",
  flow: [
    "Players take turns as the artist in a random order. With 3 or fewer players, everyone draws twice (the host can change how many turns each player gets).",
    "The artist picks one of three secret words (easy, medium or hard, or from the host's own list if they typed one) within 12 seconds, or the first word is picked for them.",
    "The artist has 80 seconds (the host can change this) to draw the word while everyone else types guesses.",
    "Halfway through and again at the three-quarter mark, a letter of the word is revealed as a hint.",
    "The turn ends when time runs out or everyone has guessed. The word is shown for 5 seconds, then the next artist starts.",
  ],
  controls: {
    desktop: [
      "Choosing: click a word or press 1, 2 or 3.",
      "Drawing: draw with the mouse. Number keys 1-9, 0, - and = pick colours, [ and ] change brush size, E toggles the eraser, B goes back to the brush, Z undoes.",
      "Clear wipes the whole canvas: click it twice to confirm.",
      "Guessing: just start typing and press Enter to send.",
    ],
    touch: [
      "Drawing: draw with your finger or a pen. Tap the colour, brush size, eraser and undo buttons below the canvas.",
      "Tap Clear twice to wipe the canvas.",
      "Guessing: type in the box and tap Send.",
    ],
  },
  scoring: [
    "A correct guess scores 100 points plus up to 300 more the faster you are.",
    "The first correct guesser gets a 50-point bonus and the second gets 25.",
    "The artist earns 60 points for every player who guesses their word.",
    "Most points after everyone has drawn wins. Tied players share the win.",
  ],
  tips: [
    "Capitals, accents, spaces and punctuation don't matter in guesses.",
    "If your guess is only one letter off, you get a private 'close!' message, so try a small spelling fix.",
    "As the artist, draw the main shape first: early guesses are worth far more to everyone.",
  ],
};
