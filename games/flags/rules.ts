import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Steal the other team's flag and carry it back to your own base. First team to 3 captures wins (the host can pick 2, 3 or 5).",
  flow: [
    "Players are split into Red and Blue. Each team owns one half of the field, with its flag in a base at the far end.",
    "After a 3-second countdown, run into enemy ground and touch their flag to grab it, then run it back into your own base circle to score.",
    "On enemy ground you're fair game: if a defender touches you there, you're tagged, sent back to your base after a short wait, and drop any flag you carry.",
    "On your own ground you're the hunter: touch raiders to tag them. Touch your own dropped flag to send it home (it also goes home by itself after 9 seconds).",
    "After every capture everyone lines up again for a quick restart. A ⚡ Turbo appears near the middle now and then.",
  ],
  controls: {
    desktop: ["WASD or the arrow keys to run.", "Or click and drag anywhere on the field: the drag works like a joystick."],
    touch: ["Put your thumb anywhere on the field and drag: a joystick appears under it. Let go to stop."],
  },
  scoring: [
    "Each flag carried into your base circle is 1 capture. First team to 3 wins (host: 2, 3 or 5).",
    "There's a time limit (5 minutes of play; host: 3, 5 or 8). The clock stops during celebrations and line-ups. When it runs out the team ahead wins; a tie goes to 2 minutes of overtime where the next capture wins, else it's a draw.",
    "You can't stand in your own base circle (no camping on the flag), unless you're bringing a flag home.",
    "Tagged players are back in 2.6 seconds, or 1.4 seconds when their team is behind. Flag carriers run a bit slower; ⚡ Turbo makes you 45% faster for 4 seconds.",
    "Personal score on the results: 3 per capture, 1 per tag and 1 per flag you return. Everyone on the winning team wins. If a whole team leaves for 12 seconds, the other team wins.",
  ],
  tips: [
    "Raid together: while one teammate draws the defenders, another slips round the side to the flag.",
    "Always leave someone home. A raider who grabs your flag still has to cross your whole half.",
    "The middle line is the border: hover there and dart in when a defender looks away.",
  ],
};
