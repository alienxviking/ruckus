import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Score the most points over 8 polls by guessing how the room really voted.",
  flow: [
    "Each round shows a silly question with up to 4 answers. You have 15 seconds to vote in secret.",
    "Next you get 20 seconds to predict how many players picked each answer. Spread exactly as many votes as there were voters, then lock it in.",
    "The reveal shows the real results and everyone's points. Tap Ready to move on, or wait for the timer.",
    "One of rounds 3 to 5 is Read the room: one spotlight player is picked, and everyone else guesses what they voted. The spotlight player guesses how many people will get it right.",
    "Round 6 or 7 is Majority rules: only players who voted for the most popular answer score, and their points are doubled.",
  ],
  controls: {
    desktop: [
      "Press 1–4 or A–D to pick an answer, or click it.",
      "Click + and − on each answer to place your prediction, then click Lock it in.",
    ],
    touch: [
      "Tap an answer to vote.",
      "Tap or hold + and − on each answer to place your prediction, then tap Lock it in.",
    ],
  },
  scoring: [
    "A prediction starts at 100 points and loses 15 for every voter you put on the wrong answer (never below 0).",
    "Lone wolf: be the only one to pick your answer, with 4 or more voters, for +50.",
    "Read the room: guess the spotlight player's vote for 100 points. The spotlight player gets 100, minus 30 for each person they're off by.",
    "After 8 rounds the highest total wins. Tied players share the win.",
  ],
  tips: [
    "Vote honestly, but think about what everyone else will pick when you predict. Your own vote counts in the totals too.",
    "In Majority rules, vote for what you think most people will pick, not what you actually like.",
  ],
};
