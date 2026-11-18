import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "snowflake", anim: "slide", text: "Run around throwing snowballs at rivals" },
    { icon: "shield", anim: "float", text: "Hide behind snow walls and trees" },
    { icon: "heart", anim: "pulse", text: "Lose all your hearts and you're out" },
  ],
  win: "Last standing wins; first to 3 rounds",
  goal: "Be the first to win 3 rounds (the host can change this) by being the last player left standing in the snowball fight.",
  flow: [
    "Everyone spawns around the edge of a snowy field. After a 3-second countdown, the fight is on.",
    "You hold up to 3 snowballs and get a new one every 0.8 seconds. Walk over a ❄ pile to scoop up 5 at once (the pile grows back after 8 seconds).",
    "Hide behind snow walls: each one shrinks as it gets hit and crumbles after 6 hits. Trees block snowballs completely. Long throws arc up and over walls.",
    "Grab power-ups for 3 special throws: ☃️ Big ball does 2 damage with a wide splash, ❄️ Triple shot throws three balls in a fan.",
    "After 60 seconds a blizzard hits and any single hit knocks you out. A round still going at 100 seconds ends in a draw.",
    "Red vs Blue (host setting): players are split into two random teams that start on opposite sides. Teammates' snowballs fly straight through you, so there's no friendly fire. Coats and name tags show each kid's team colour.",
  ],
  controls: {
    desktop: [
      "Walk with WASD.",
      "Aim with the mouse and click to throw (Space works too). Aim farther away for a longer throw.",
    ],
    touch: [
      "Left thumb: walk.",
      "Right thumb: drag to aim (farther means a longer throw) and let go to throw, or just tap to throw at the nearest player.",
    ],
  },
  scoring: [
    "You have 3 hearts (the host can pick 1 or 5 instead). Each hit costs 1 (a Big ball costs 2). Lose them all and you're out for the round.",
    "The last player standing wins the round. A draw gives nobody the round.",
    "Red vs Blue: the round goes to the last team with anyone standing, and every member of that team banks the round win. The first team to the target takes the match, and everyone on it wins (if no team gets there in time, the team with more round wins takes it; level is a draw).",
    "First to 3 round wins takes the game (or 2 or 5, if the host changes it). If nobody gets there in 7 rounds (5 when playing to 2, 11 when playing to 5), the most round wins takes it (ties share the win).",
  ],
  tips: [
    "Don't empty your hand: with no snowballs left you're a sitting duck while you wait for a reload.",
    "Lob over a wall at someone hiding behind it instead of chipping away at the wall.",
    "Once the blizzard starts, one hit is all it takes. Play it safe or strike first.",
  ],
};
