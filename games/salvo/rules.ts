import type { GameRules } from "../rules-types";

export const rules: GameRules = {
  quick: [
    { icon: "ship", anim: "slide", text: "Hide your fleet on a secret grid" },
    { icon: "crosshair", anim: "tap", text: "Take turns firing three shots" },
    { icon: "target", anim: "pulse", text: "Hit all of a ship to sink it" },
  ],
  win: "Sink their whole fleet first",
  goal: "Sink every ship in your rival's hidden fleet before they sink yours.",
  flow: [
    "Two players each get a 10×10 sea (the host can pick 8×8) and the same fleet: Dreadnought (5), Cruiser (4), Corvette (3), Submarine (3) and Skiff (2). The 8×8 sea drops the Dreadnought.",
    "Place your fleet in 75 seconds: drag ships onto your grid, tap one to turn it, or hit Random. Ships may touch but not overlap. When time runs out the ships you haven't placed are placed at random.",
    "A random player fires first. On your turn pick 3 cells in your rival's waters and fire the salvo.",
    "Every shot is revealed as a hit or a miss, and a ship is announced as sunk (and shown) once all its cells are hit. Your own sea shows where their shells landed.",
    "Turns alternate until one fleet is gone. Anyone beyond the first two players watches; nobody sees an unsunk ship until the end.",
  ],
  controls: {
    desktop: [
      "Placing: drag a ship from the dock to your grid, click a placed ship (or press R) to turn it, or click a dock ship and then a cell.",
      "Firing: click up to 3 cells to aim (click again to take one back), then press Fire (or Enter).",
    ],
    touch: [
      "Placing: drag a ship onto your grid and tap it to turn it, or tap a ship in the dock and then a cell.",
      "Firing: tap cells to aim, then tap Fire. Use the tabs to look at your own fleet.",
    ],
  },
  scoring: [
    "Each salvo is 3 shots. The host can switch to classic rules: one shot per ship you still have afloat, so your salvo shrinks as you lose ships.",
    "You have 30 seconds to aim (the host can pick 20 or 45). When time runs out the cells you aimed at fire, plus random ones to fill the salvo. If you disconnect, that happens after 5 seconds.",
    "The first player to sink the whole enemy fleet wins. The result lists ships sunk per player.",
    "A player who stays disconnected for a full minute forfeits.",
  ],
  tips: [
    "Spread your hunting shots out in a checkerboard: every ship is at least 2 cells long.",
    "After a hit, work along the line: the cells next to it are the most likely.",
    "Ships along the edges are harder to find but easier to trace once hit.",
  ],
};
