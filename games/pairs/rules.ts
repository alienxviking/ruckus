import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Flip two cards a turn. Find a matching pair and you keep it.",
  flow: ["Flip two cards a turn. Find a matching pair and you keep it.", "Solo: clear the board in as few flips as you can.", "With friends: take turns, and a match earns another go. Most pairs wins."],
  controls: {},
  scoring: ["With friends: take turns, and a match earns another go. Most pairs wins."],
};
