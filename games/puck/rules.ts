import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "move", anim: "slide", text: "Move your paddle in your own half" },
    { icon: "goal", anim: "bounce", text: "Smash the puck into their goal" },
    { icon: "shield", anim: "pulse", text: "Guard your own goal from shots" },
  ],
  win: "First side to 7 goals",
  goal: "Knock the puck into the other side's goal. The first side to 7 goals wins (the host can pick 5, 7 or 10).",
  flow: [
    "Players split into two sides: 1v1 with two players, 2v1 with three (the solo player gets a bigger paddle), 2v2 with four.",
    "Your own goal is always at the bottom of your screen. You can only move your paddle in your own half.",
    "On a side with two players, one plays forward (front lane) and one plays goalie (back lane). The lanes overlap a little in the middle of the half.",
    "Each faceoff the puck sits still on one side for a short countdown (3 seconds at the start, about 1 second later), then it's live.",
    "After a goal there's a 2-second celebration, then the side that conceded gets the puck for the next faceoff.",
  ],
  controls: {
    desktop: ["Move the mouse over the table: your paddle follows it. Move fast through the puck to hit it hard."],
    touch: ["Press and drag anywhere on the table: your paddle rides just above your fingertip so you can see it."],
  },
  scoring: [
    "A goal counts when the whole puck crosses the goal line between the posts. The player who touched it last on the scoring side gets the goal; if the defending side touched it last, it's an own goal.",
    "First side to 7 goals wins (5, 7 or 10, set by the host). Everyone on the winning side wins.",
    "The 7-second rule: if the puck stays in one half for 7 seconds, it's handed to the other side for a faceoff. A ring counts down the last few seconds.",
    "Puck speed (host setting): Fast tops out at 1,700 units a second and slowly drifts to a stop; Turbo tops out at 2,300 and barely slows down.",
    "If everyone on one side leaves for 12 seconds, the other side wins.",
  ],
  tips: [
    "Hit through the puck, not at it: your paddle's speed goes into the shot.",
    "Bank shots off the side walls are hard to read. Aim for the edges of the goal mouth.",
    "When you're under attack, sit just in front of your goal instead of chasing.",
  ],
};
