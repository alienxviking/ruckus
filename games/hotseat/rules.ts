import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "question", anim: "float", text: "One player secretly answers a personal question" },
    { icon: "users", anim: "tap", text: "Everyone else predicts their answer" },
    { icon: "check", anim: "pulse", text: "Right guesses score, and so does the hot seat" },
  ],
  win: "Most points after everyone's turn",
  goal: "Score the most points by predicting what your friends really pick, and by being easy to read.",
  flow: [
    "Play on a voice or video call. Each round one player sits in the hot seat; everyone takes a turn (with Auto: 3 times each with 3 players, twice with 4–6, once with 7+; the host can choose).",
    "A personal question appears: would you rather, this or that, or pick one of four. The hot seat secretly picks their honest answer.",
    "At the same time everyone else predicts what the hot seat will pick. You have 30 seconds and can change your mind (the host can pick Quick 20s or Relaxed 45s).",
    "Drumroll, then the reveal shows the hot seat's pick and who predicted what.",
    "Talk it out! The hot seat explains themselves. The round moves on when everyone taps Ready, when the hot seat taps Done talking, or after 40 seconds (20s Quick, 60s Relaxed).",
  ],
  controls: {
    desktop: ["Press 1–4 or A–D to pick, or click an answer."],
    touch: ["Tap an answer to pick or predict."],
  },
  scoring: [
    "Predict the hot seat's pick: +100.",
    "Be the only one who got it right (with 3 or more predictors): +50 more.",
    "The hot seat scores 100 × the share of predictors who read them right (2 of 4 right = +50).",
    "If the hot seat never picks, nobody scores that round. Highest total wins; ties share the win.",
    "Questions don't repeat between games in the same room until the deck runs out.",
  ],
  tips: ["Answer honestly in the hot seat: you score when your friends know you.", "Ask the hot seat why before moving on. That's the best part."],
};
