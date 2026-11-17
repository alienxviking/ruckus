import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Score the most points by answering 10 trivia questions correctly and quickly.",
  flow: [
    "After a 3-second countdown, everyone sees the same question with four answers.",
    "You have 15 seconds to lock in one answer. The question closes early once everyone has answered.",
    "The right answer and everyone's points are shown for 5 seconds.",
    "There are 10 questions, each from a different category. They start easy and get harder toward the end.",
    "After the last question you see the final standings and a recap of every answer.",
  ],
  controls: {
    desktop: ["Click an answer, or press 1-4 or A-D."],
    touch: ["Tap an answer."],
  },
  scoring: [
    "A right answer scores 500 points plus up to 500 more for speed: answer instantly for about 1,000, at the last second for about 500.",
    "Answer streaks add a bonus: +100 for 2 right in a row, +200 for 3, and +300 for 4 or more.",
    "A wrong answer or no answer scores 0 and resets your streak. There is no penalty beyond that.",
    "Highest total after 10 questions wins. Tied players share the win.",
  ],
  tips: [
    "You can't change your answer once you pick, so read all four choices first.",
    "Keeping a streak alive is worth up to 300 extra points per question, so accuracy beats wild speed.",
  ],
};
