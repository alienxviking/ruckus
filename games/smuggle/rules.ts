import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Teams take turns: one player describes a secret word out loud while their team shouts guesses.",
  flow: ["Teams take turns: one player describes a secret word out loud while their team shouts guesses.", "Five banned words are off limits. The other team sees them and can buzz you.", "Most words smuggled after the last round wins."],
  controls: {},
  scoring: ["Most words smuggled after the last round wins."],
};
