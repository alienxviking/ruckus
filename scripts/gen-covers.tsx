// Draws every game's cover sticker into public/covers/<id>.svg (run: npm run covers).
// Each cover is the game's colour with its glyph stamped big in the background and a few of
// the avatars acting it out, each with a die-cut sticker edge. Static files: the home page
// loads them lazily as images, so they cost nothing until they scroll into view.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CATALOG } from "../games/catalog";
import { GameGlyph } from "../components/game-icons";
import { avatarMarkup } from "../lib/avatar-art";

type Layout = "solo" | "duel" | "trio" | "crowd" | "team";

/** Who's on each cover and how they're arranged. */
const SCENES: Record<string, { cast: string[]; layout: Layout }> = {
  sketch: { cast: ["cat+beanie", "owl"], layout: "duel" },
  trivia: { cast: ["owl+grad", "fox", "robot", "bunny", "panda"], layout: "crowd" },
  letters: { cast: ["frog", "bear+cap", "octo"], layout: "trio" },
  snakes: { cast: ["slime", "dino"], layout: "duel" },
  turf: { cast: ["penguin", "tiger"], layout: "duel" },
  reflex: { cast: ["tiger+tophat", "alien"], layout: "duel" },
  impostor: { cast: ["bunny", "bunny", "alien+shades", "bunny", "bunny"], layout: "crowd" },
  fib: { cast: ["fox+shades", "owl", "frog"], layout: "trio" },
  mindmeld: { cast: ["octo+headphones", "alien+headphones"], layout: "duel" },
  dial: { cast: ["panda", "robot", "bunny"], layout: "trio" },
  dots: { cast: ["owl", "penguin"], layout: "duel" },
  fourrow: { cast: ["bear", "fox"], layout: "duel" },
  tictactoe: { cast: ["frog", "cat"], layout: "duel" },
  garble: { cast: ["octo", "ghost", "dino+party"], layout: "trio" },
  liars: { cast: ["dino+tophat", "fox+eyepatch"], layout: "duel" },
  market: { cast: ["robot+tophat", "fox+monocle"], layout: "duel" },
  barrage: { cast: ["tiger+viking", "bear+cap"], layout: "duel" },
  blitz: { cast: ["alien+headphones"], layout: "solo" },
  sumo: { cast: ["bear", "panda"], layout: "duel" },
  warlords: { cast: ["dino+crown", "tiger+viking"], layout: "duel" },
  incognito: { cast: ["robot", "robot", "fox+shades", "robot", "robot"], layout: "crowd" },
  minerush: { cast: ["bear+beanie"], layout: "solo" },
  auction: { cast: ["owl+monocle", "fox+tophat", "cat"], layout: "trio" },
  potato: { cast: ["frog", "bunny+party", "penguin"], layout: "trio" },
  putt: { cast: ["penguin+cap"], layout: "solo" },
  pixels: { cast: ["fox", "owl", "octo", "slime"], layout: "team" },
  doublecross: { cast: ["fox+shades", "cat+shades"], layout: "duel" },
  outbreak: { cast: ["ghost", "slime", "bunny", "bear", "dino"], layout: "crowd" },
  lava: { cast: ["frog", "fox", "penguin"], layout: "trio" },
  snowball: { cast: ["penguin+beanie", "bear+beanie"], layout: "duel" },
  defuse: { cast: ["robot+headphones", "owl+grad"], layout: "duel" },
  poll: { cast: ["bunny", "cat", "frog", "owl", "panda"], layout: "crowd" },
  emojicharades: { cast: ["octo+party", "fox", "alien"], layout: "trio" },
  mashup: { cast: ["ghost", "dino", "slime"], layout: "trio" },
  smuggle: { cast: ["fox", "bear", "cat", "owl"], layout: "team" },
  hotseat: { cast: ["panda+shades"], layout: "solo" },
  truths: { cast: ["owl", "frog+halo", "fox+horns"], layout: "trio" },
  tug: { cast: ["tiger", "bear", "frog", "bunny"], layout: "team" },
  flags: { cast: ["dino", "fox", "penguin", "octo"], layout: "team" },
  puck: { cast: ["alien", "robot"], layout: "duel" },
  salvo: { cast: ["penguin+eyepatch", "octo+tophat"], layout: "duel" },
  seeds: { cast: ["shroom", "bunny+flower"], layout: "duel" },
  flip: { cast: ["panda", "penguin"], layout: "duel" },
  ladder: { cast: ["owl+grad"], layout: "solo" },
  stack: { cast: ["robot+cap"], layout: "solo" },
  pairs: { cast: ["cat", "bunny"], layout: "duel" },
};

const W = 320;
const H = 200;
const INK = "#14101f";
const PAPER = "#fff8e7";

interface Spot {
  x: number;
  y: number;
  /** Size in px. */
  s: number;
  rot: number;
  flip?: boolean;
  ring?: string;
}

/** Where the cast stands for each layout (top-left corner, size, tilt). */
function spots(layout: Layout, n: number): Spot[] {
  switch (layout) {
    case "solo":
      return [{ x: 150, y: 26, s: 160, rot: 6 }];
    case "duel":
      return [
        { x: 14, y: 50, s: 132, rot: -9 },
        { x: 174, y: 50, s: 132, rot: 9, flip: true },
      ];
    case "trio":
      return [
        { x: 8, y: 78, s: 104, rot: -10 },
        { x: 106, y: 52, s: 118, rot: 3 },
        { x: 214, y: 80, s: 102, rot: 11 },
      ];
    case "team":
      return [
        { x: 0, y: 92, s: 92, rot: -8, ring: "#ff4fa3" },
        { x: 64, y: 62, s: 92, rot: 4, ring: "#ff4fa3" },
        { x: 164, y: 62, s: 92, rot: -4, flip: true, ring: "#4f7bff" },
        { x: 228, y: 92, s: 92, rot: 8, flip: true, ring: "#4f7bff" },
      ];
    case "crowd":
      return Array.from({ length: n }, (_, i) => ({
        x: 4 + i * (W - 84) / Math.max(1, n - 1),
        y: i % 2 ? 104 : 86,
        s: 80,
        rot: (i % 2 ? 7 : -6) + (i - n / 2),
      }));
  }
}

/** Where the big background glyph goes (behind the cast). */
function glyphSpot(layout: Layout): { x: number; y: number; s: number; rot: number } {
  switch (layout) {
    case "solo":
      return { x: 6, y: 18, s: 150, rot: -14 };
    case "duel":
      return { x: 112, y: 4, s: 96, rot: 12 };
    case "trio":
      return { x: 196, y: -8, s: 108, rot: 14 };
    case "team":
      return { x: 116, y: 8, s: 88, rot: -10 };
    case "crowd":
      return { x: 180, y: -10, s: 120, rot: 12 };
  }
}

function glyphSvg(id: string, x: number, y: number, s: number, rot: number): string {
  const raw = renderToStaticMarkup(<GameGlyph id={id} />);
  // Re-size the lucide icon and colour it ink; keep its inner shapes.
  const inner = raw.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  return (
    `<g transform="translate(${x} ${y}) rotate(${rot} ${s / 2} ${s / 2})" opacity=".2">` +
    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg></g>`
  );
}

function avatarSvg(id: string, p: Spot): string {
  const k = p.s / 64;
  const flip = p.flip ? ` translate(64 0) scale(-1 1)` : "";
  const ring = p.ring
    ? `<circle cx="32" cy="34" r="30" fill="${p.ring}" stroke="${INK}" stroke-width="2.5"/>`
    : "";
  return (
    `<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.rot} ${p.s / 2} ${p.s / 2}) scale(${k.toFixed(3)})">` +
    `<g filter="url(#stk)">${ring}<g transform="${flip}">${avatarMarkup(id)}</g></g></g>`
  );
}

function cover(id: string, accent: string): string {
  const scene = SCENES[id] ?? { cast: ["fox", "frog"], layout: "duel" as Layout };
  const g = glyphSpot(scene.layout);
  const cast = spots(scene.layout, scene.cast.length)
    .map((p, i) => (scene.cast[i] ? avatarSvg(scene.cast[i], p) : ""))
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<defs>` +
    // Die-cut sticker edge (off-white, grown from the shape) plus a flat drop shadow.
    `<filter id="stk" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feMorphology in="SourceAlpha" operator="dilate" radius="2.6" result="grow"/>` +
    `<feFlood flood-color="${PAPER}"/><feComposite in2="grow" operator="in" result="edge"/>` +
    `<feOffset in="grow" dx="2.5" dy="3" result="sh"/><feFlood flood-color="#000" flood-opacity=".35"/><feComposite in2="sh" operator="in" result="shadow"/>` +
    `<feMerge><feMergeNode in="shadow"/><feMergeNode in="edge"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<pattern id="dots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="${INK}" opacity=".16"/></pattern>` +
    `<radialGradient id="shine" cx="25%" cy="10%" r="90%"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `</defs>` +
    `<rect width="${W}" height="${H}" fill="${accent}"/>` +
    `<rect width="${W}" height="${H}" fill="url(#shine)"/>` +
    `<path d="M${W * 0.55} 0 L${W} 0 L${W} ${H * 0.75} Z" fill="url(#dots)"/>` +
    glyphSvg(id, g.x, g.y, g.s, g.rot) +
    cast +
    `</svg>`
  );
}

const out = join(process.cwd(), "public", "covers");
mkdirSync(out, { recursive: true });
let bytes = 0;
for (const g of CATALOG) {
  const svg = cover(g.id, g.accent);
  bytes += svg.length;
  writeFileSync(join(out, `${g.id}.svg`), svg);
  if (!SCENES[g.id]) console.warn(`no scene for ${g.id}: used the default`);
}
console.log(`✓ ${CATALOG.length} covers, ${(bytes / 1024).toFixed(0)} KB total (${(bytes / 1024 / CATALOG.length).toFixed(1)} KB each)`);
