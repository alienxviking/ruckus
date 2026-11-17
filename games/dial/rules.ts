import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Score the most points by landing your needle close to hidden targets, and by giving clues that lead everyone to yours.",
  flow: [
    "Players take turns as the clue-giver. With 4 or more players everyone gives one clue; with 2 or 3, everyone gives two.",
    "The clue-giver sees a scale between two opposites (like Cold and Hot) and a secret target spot on it. They have 60 seconds to type a clue that belongs at that spot, or the turn is skipped.",
    "Everyone else has 40 seconds to drag their needle to where they think the clue sits, then lock it in. You can see the other needles move live.",
    "The round ends early once every guesser has locked in. The target is revealed for 7 seconds, then the next clue-giver goes.",
    "After every clue-giver has had their turn, the game ends.",
  ],
  controls: {
    desktop: [
      "Drag the needle, or use the arrow keys (hold Shift to move 5 at a time). Page Up/Down move 10, Home and End jump to the ends.",
      "Press Enter or click Lock in to lock your guess.",
      "Clue-giver: type your clue (up to 40 characters, not just a number) and send it. You can swap the scale for a new one once per turn.",
    ],
    touch: [
      "Drag the needle with your finger, then tap Lock in.",
      "Clue-giver: type your clue and send it. Tap Swap spectrum once if you don't like the scale.",
    ],
  },
  scoring: [
    "Guessers score by distance from the target on the 0-100 dial: within 3 scores 4, within 8 scores 3, within 14 scores 2, within 20 scores 1.",
    "The clue-giver scores the average of what the guessers scored that round (rounded). A guesser who never touches or locks the needle scores 0.",
    "Most points at the end wins. Tied players share the win.",
    "With exactly 2 players you play as a team: 4 clues for up to 16 points, and you both win with 8 or more.",
  ],
  tips: [
    "Clue-givers: pick something everyone in the room knows, and think about how extreme it is, not just which side it's on.",
    "Locking in without moving the needle locks it at the middle (50).",
  ],
};
