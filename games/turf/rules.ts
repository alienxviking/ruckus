import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  goal: "Own the most tiles on the map when the clock runs out (60 seconds; the host can change this).",
  flow: [
    "Everyone starts on a small 3x3 patch of their own colour. During the 3-second countdown you can already pick a direction.",
    "Once play starts you keep moving on your own. Every tile you step on turns your colour, even if a rival owned it.",
    "Head out from your turf and come back to it: every tile you have closed off from the map edge becomes yours, including rivals' paint.",
    "Power-ups appear on the map every 5-7 seconds (up to 3 at a time). Drive over one to use it.",
    "When time is up the map is frozen and tiles are counted. The host can also pick a smaller or larger map.",
    "Red vs Blue (host setting): players are split into two random teams. Teammates paint in their team colour and share one turf, so you can close a loop on a teammate's paint and never paint over it.",
  ],
  controls: {
    desktop: [
      "Arrow keys or WASD to steer. You can turn straight back the way you came.",
      "You can also click and drag on the map in the direction you want to go.",
      "Turns queue up, so you can press the next one early.",
    ],
    touch: [
      "Swipe on the map in the direction you want to go.",
      "Or use the on-screen arrow pad.",
    ],
  },
  scoring: [
    "Your score is the number of tiles you own at the end. Most tiles wins; tied players share the win.",
    "In Red vs Blue the team that owns more of the map wins, and every member of that team shares the win. Freeze only stops the other team.",
    "⚡ Dash: you move twice as fast for 3 seconds.",
    "💣 Paint bomb: paints every tile within 2 steps of you, and can close off an area for you.",
    "🧊 Freeze: every other player stops moving for 1.5 seconds.",
    "Nobody gets knocked out: painters pass through each other, and walls just stop you until you turn.",
  ],
  tips: [
    "Big loops win big: walling off a chunk of map grabs everything inside it at once.",
    "Loop around rivals' turf to steal it, but be quick, since they can paint it back.",
    "Don't drive into a wall and sit there: you stop moving until you turn.",
  ],
};
