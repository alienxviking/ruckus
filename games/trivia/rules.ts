import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Score the most points by answering trivia questions correctly and quickly.",
  flow: [
    "After a 3-second countdown, everyone sees the same question with four answers.",
    "You have 15 seconds to lock in one answer (the host can change this). The question closes early once everyone has answered.",
    "The right answer and everyone's points are shown for 5 seconds.",
    "There are 10 questions by default (the host can pick 5 or 15), each from a different category where possible. They start easy and get harder toward the end.",
    "After the last question you see the final standings and a recap of every answer.",
    "Red vs Blue (host setting): players are split into two random teams. Everyone still answers for themselves, and the strip at the top shows both team totals live.",
  ],
  controls: {
    desktop: ["Click an answer, or press 1-4 or A-D."],
    touch: ["Tap an answer."],
  },
  scoring: [
    "A right answer scores 500 points plus up to 500 more for speed: answer instantly for about 1,000, at the last second for about 500.",
    "Answer streaks add a bonus: +100 for 2 right in a row, +200 for 3, and +300 for 4 or more.",
    "A wrong answer or no answer scores 0 and resets your streak. There is no penalty beyond that.",
    "Highest total after the last question wins. Tied players share the win.",
    "Red vs Blue: a team's score is its members' points added up. If one team has an extra player, the smaller team's total is scaled up to match (2 vs 3: the pair's total counts x1.5), so team size never decides it. Every member of the higher-scoring team wins.",
  ],
  tips: [
    "You can't change your answer once you pick, so read all four choices first.",
    "Keeping a streak alive is worth up to 300 extra points per question, so accuracy beats wild speed.",
  ],
};
