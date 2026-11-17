import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Place your ships on a hidden grid.",
  flow: ["Place your ships on a hidden grid.", "Each turn fire a salvo of three shots at your rival's waters.", "Sink their whole fleet first to win."],
  controls: {},
  scoring: ["Sink their whole fleet first to win."],
};
