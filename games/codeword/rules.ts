import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Crack each secret five-letter word in as few guesses as you can. Most points over all the words wins.",
  flow: [
    "Everyone gets the same secret words: 3 by default (the host can pick 1, 3 or 5).",
    "After a 3-second countdown, type any real five-letter word and press Enter. You get 6 guesses per word.",
    "Each tile flips: lime means right letter in the right spot, cyan means the letter is in the word but somewhere else, dark means it isn't in the word (or not that many times).",
    "Crack it (or use up your guesses) and the next word starts after a 4-second look at your result. Each word has a 4-minute backstop clock.",
    "Racing friends? Their boards show only their colours, never their letters. The game ends when everyone has finished every word.",
    "Hard mode (host setting, off by default): every hint you've been shown must be used: lime letters stay put, cyan letters must be in your next guesses.",
  ],
  controls: {
    desktop: ["Type letters, Backspace to delete, Enter to guess."],
    touch: ["Tap the on-screen keyboard; ⌫ deletes, ENTER guesses. Keys colour in with what you've learned."],
  },
  scoring: [
    "Cracked in 1 guess: 600 points, 2: 500, 3: 400, 4: 300, 5: 200, 6: 100.",
    "Speed bonus: up to 50 more, shrinking to 0 over the first 2 minutes of each word.",
    "Not cracked (or given up): 0, and you're shown the answer.",
    "Most points over all the words wins.",
  ],
  tips: [
    "Start with a word full of common letters, like ones with A, E, R, S, T.",
    "A letter can show twice: if a letter turns dark the second time, the word has only one of it.",
  ],
};
