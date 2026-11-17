import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Guess any five-letter word. Each tile turns green, yellow or grey to show how close you are.",
  flow: ["Guess any five-letter word. Each tile turns green, yellow or grey to show how close you are.", "Green: right letter, right spot. Yellow: in the word, wrong spot.", "Crack it in as few guesses as you can. Solo, or race friends on the same word."],
  controls: {},
  scoring: ["Crack it in as few guesses as you can. Solo, or race friends on the same word."],
};
