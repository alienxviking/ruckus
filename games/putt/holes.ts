// The handcrafted holes. Course layouts are public (every screen draws them), so this ships to
// browsers alongside shared.ts; the server only ever sends a hole's id.
//
// World is 1000 × 600. Angles are degrees clockwise from +x: 0 = right, 90 = down, 270 = up.

import type { Hole } from "./shared";

/** Rectangle with its corners cut at 45° (c units). */
const oct = (x0: number, y0: number, x1: number, y1: number, c: number) => [
  x0 + c, y0, x1 - c, y0, x1, y0 + c, x1, y1 - c, x1 - c, y1, x0 + c, y1, x0, y1 - c, x0, y0 + c,
];

/** Regular polygon approximating a circle. */
const ring = (cx: number, cy: number, r: number, n: number, rot = 0) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    out.push(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r));
  }
  return out;
};

/** Open arc polyline around (cx, cy) from a0 to a1 degrees. */
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n: number) => {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r));
  }
  return out;
};

export const HOLES: Hole[] = [
  {
    id: "opener",
    name: "Opening Drive",
    par: 2,
    tier: 1,
    tip: "Thread the bumpers. The cup sits in a bowl that pulls slow balls in.",
    tee: [170, 300, 0],
    cup: [835, 300],
    green: [oct(60, 170, 940, 430, 55)],
    bumpers: [
      [440, 232, 20],
      [440, 368, 20],
      [640, 300, 22],
    ],
    sand: [[735, 400, 40]],
    hills: [[835, 300, 80, -170]],
  },
  {
    id: "lagoon",
    name: "Dogleg Lagoon",
    par: 3,
    tier: 1,
    tip: "Round the corner without feeding the pond.",
    tee: [150, 460, 0],
    cup: [800, 150],
    green: [[60, 380, 600, 380, 600, 60, 880, 60, 940, 120, 940, 480, 880, 540, 60, 540]],
    bumpers: [
      [883, 483, 18],
      [330, 380, 14],
    ],
    water: [[775, 405, 58]],
    sand: [[680, 115, 38]],
  },
  {
    id: "windmill",
    name: "The Old Windmill",
    par: 3,
    tier: 2,
    tip: "Time it through the sails. Get it wrong and you get swatted.",
    tee: [150, 300, 0],
    cup: [860, 300],
    green: [oct(60, 150, 940, 450, 45)],
    walls: [
      [500, 150, 500, 172],
      [500, 450, 500, 428],
    ],
    bumpers: [
      [300, 215, 18],
      [300, 385, 18],
    ],
    sand: [
      [755, 200, 32],
      [755, 400, 32],
    ],
    mills: [[500, 300, 105, 1.25, 4, 20]],
  },
  {
    id: "portals",
    name: "Portal Hop",
    par: 3,
    tier: 2,
    tip: "The only way across is a portal, and your speed comes out the other side. Overshoot and it's wet.",
    tee: [150, 300, 0],
    cup: [742, 300],
    green: [oct(60, 90, 400, 510, 45), oct(600, 90, 940, 510, 45)],
    walls: [[702, 248, 702, 352]],
    portals: [
      [340, 170, 660, 430],
      [340, 430, 660, 170],
    ],
    bumpers: [[250, 300, 18]],
    sand: [
      [860, 160, 34],
      [800, 205, 26],
      [800, 395, 26],
    ],
    water: [
      [870, 300, 40],
      [860, 445, 34],
    ],
  },
  {
    id: "pinball",
    name: "Pinball Wizard",
    par: 3,
    tier: 2,
    tip: "Bumpers kick back hard. Side lanes have boost pads.",
    tee: [500, 485, 270],
    cup: [500, 112],
    green: [oct(120, 50, 880, 560, 100)],
    bumpers: [
      [500, 290, 28],
      [412, 210, 22],
      [588, 210, 22],
      [300, 345, 20],
      [700, 345, 20],
      [262, 168, 18],
      [738, 168, 18],
      [500, 172, 13],
    ],
    walls: [
      [430, 50, 430, 92],
      [570, 50, 570, 92],
    ],
    boosts: [
      [180, 400, 270],
      [820, 400, 270],
    ],
  },
  {
    id: "switchback",
    name: "Sandy Switchback",
    par: 4,
    tier: 3,
    tip: "Down, up and down again, or gamble on the portal shortcut.",
    tee: [195, 140, 90],
    cup: [805, 465],
    green: [oct(60, 60, 940, 540, 45)],
    walls: [
      [330, 60, 330, 385],
      [670, 540, 670, 215],
    ],
    bumpers: [
      [330, 395, 15],
      [670, 205, 15],
    ],
    sand: [
      [120, 470, 70],
      [500, 120, 52],
      [885, 125, 60],
    ],
    water: [[500, 330, 44]],
    portals: [[195, 345, 505, 222]],
  },
  {
    id: "volcano",
    name: "The Volcano",
    par: 3,
    tier: 2,
    tip: "The cup sits in a crater on a mound, and the crater opens away from you.",
    tee: [330, 300, 0],
    cup: [500, 300],
    green: [ring(500, 300, 258, 18)],
    walls: [arc(500, 300, 44, 45, 315, 9)],
    hills: [[500, 300, 140, 420]],
    bumpers: [
      [366, 166, 18],
      [634, 166, 18],
      [366, 434, 18],
      [634, 434, 18],
    ],
    sand: [[715, 300, 30]],
  },
  {
    id: "loop",
    name: "Boost Loop",
    par: 3,
    tier: 3,
    tip: "Take the narrow bridge, or ride the boost pads all the way round.",
    tee: [180, 465, 0],
    cup: [820, 465],
    green: [oct(60, 60, 940, 540, 60)],
    walls: [
      [300, 270, 700, 270],
      [300, 330, 700, 330],
      [500, 540, 500, 390],
    ],
    water: [
      [300, 210, 400, 60],
      [300, 330, 400, 60],
    ],
    boosts: [
      [180, 215, 270],
      [500, 135, 0],
      [820, 215, 90],
    ],
  },
  {
    id: "island",
    name: "Island Green",
    par: 3,
    tier: 3,
    tip: "One causeway to the island. The boost pad is optional bravery.",
    tee: [160, 300, 0],
    cup: [778, 238],
    green: [oct(60, 70, 940, 530, 50)],
    water: [[520, 70, 420, 460]],
    dry: [
      [770, 300, 108],
      [515, 273, 200, 54],
    ],
    walls: [arc(770, 300, 104, -62, 62, 6)],
    boosts: [[590, 300, 0]],
    bumpers: [
      [370, 175, 20],
      [370, 425, 20],
    ],
  },
  {
    id: "twinmills",
    name: "Twin Mills",
    par: 4,
    tier: 3,
    tip: "Out past one windmill, round the bend, back past the other.",
    tee: [160, 180, 0],
    cup: [160, 420],
    green: [oct(60, 60, 940, 540, 55)],
    walls: [[60, 300, 715, 300]],
    bumpers: [[722, 300, 15]],
    mills: [
      [440, 180, 96, 1.3, 4, 0],
      [440, 420, 96, -1.3, 4, 45],
    ],
    sand: [[260, 470, 40]],
  },
];

export const HOLE_BY_ID: Record<string, Hole> = Object.fromEntries(HOLES.map((h) => [h.id, h]));

/** Ids of every layout, for validation. */
export const HOLE_IDS: readonly string[] = HOLES.map((h) => h.id);
