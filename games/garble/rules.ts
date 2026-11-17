import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Collect the most emoji reactions from the other players on the pages you write and draw.",
  flow: [
    "Everyone starts their own book by writing a short prompt (40 seconds; the host can make all timers quicker or more relaxed). Stuck? Tap Inspire me for a random one.",
    "The books pass along. If you get words, draw them (70 seconds). If you get a drawing, describe it in words (35 seconds).",
    "You only ever see the page right before yours, so the message drifts further from the original with every pass.",
    "This repeats once per player, up to 8 pages per book (the host can lower the cap). A step ends early once everyone taps Done.",
    "Then every book is revealed page by page for the whole group. React to the pages you love.",
    "After the last book, the player with the most reactions wins.",
  ],
  controls: {
    desktop: [
      "Writing: type your text (80 characters max) and press Enter or click Done. Click Edit to change it before time runs out.",
      "Drawing: draw on the white page with the mouse. Z (or Ctrl+Z) undoes, E toggles the eraser, B goes back to the brush.",
      "Drawing: keys 1–9, 0, - and = pick colors, and [ and ] change the brush size.",
      "Reveal: press 1–4 to react with 😂 🔥 😮 ❤️. If it's your book, press → or N to skip to the next page.",
    ],
    touch: [
      "Writing: type your text and tap Done. Tap Edit to change it before time runs out.",
      "Drawing: draw with your finger. Use the toolbar for colors, brush size, eraser, undo and clear.",
      "Reveal: tap 😂 🔥 😮 ❤️ to react. If it's your book, tap Next to skip ahead.",
    ],
  },
  scoring: [
    "Each reaction you get on one of your pages is worth 1 point.",
    "Every player can give each page up to 4 reactions, one of each emoji. You can't react to your own pages.",
    "The player with the most reactions wins. Equal totals share the win.",
    "Fun badges go to whoever got the most of each emoji.",
  ],
  tips: [
    "When describing, write what you actually see, not what you think the artist meant. The weirder it gets, the funnier the reveal.",
    "Each drawing has limited ink, so go for big, simple shapes over fine detail.",
    "Keep prompts drawable: the next player has only about a minute to sketch them.",
  ],
};
