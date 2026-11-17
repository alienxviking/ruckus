import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Score the most by spotting your friends' lies and fooling them with yours.",
  flow: [
    "Play on a voice or video call. Everyone secretly writes three short statements about themselves (up to 100 characters each): two true, one lie, and marks which one is the lie. Tap an idea chip if you're stuck.",
    "You have 5 minutes to write (the host can pick 3 or 8). It moves on as soon as everyone has locked in; a finished but unlocked draft still counts when time runs out.",
    "Players then present one at a time, in a random order. Their three statements appear for everyone, shuffled. They read them out loud and defend them while the others ask questions.",
    "Everyone else taps the statement they think is the lie, and can change their vote. There are 90 seconds per player (the host can pick 60s or 2½ min); the reader can reveal early once everyone has voted.",
    "The bomb goes off: the lie is revealed with everyone's votes. Tell the stories behind the truths, then tap Ready (the reader's Done moves everyone on).",
  ],
  controls: {
    desktop: ["Type your statements, click Mark as the lie, then Lock in. Enter jumps to the next line.", "Click a statement to vote it the lie."],
    touch: ["Type your statements, tap Mark as the lie, then Lock in.", "Tap a statement to vote it the lie."],
  },
  scoring: [
    "Spot the lie: +100.",
    "Your lie fools a friend (they voted for one of your truths): +50 each.",
    "No vote, no points. Highest total wins; ties share the win.",
  ],
  tips: ["The best lies are boring; the best truths sound made up.", "Ask follow-up questions: details give liars away."],
};
