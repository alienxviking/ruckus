// The Ruckus avatar set: 16 sticker-style characters on a 64×64 grid.
// One source of truth as SVG markup, used by <Avatar> (inline SVG) and by canvas games
// (as images, see avatarImage).

import { isAvatarId, type AvatarId } from "@/shared/types";

const INK = "#1d1a2b";

/** An eye with a catch-light. */
const eye = (x: number, y: number, r = 3.3) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/><circle cx="${x + r * 0.38}" cy="${y - r * 0.38}" r="${r * 0.4}" fill="#fff"/>`;
const eyes = (x1: number, x2: number, y: number, r?: number) => eye(x1, y, r) + eye(x2, y, r);
const cheeks = (x1: number, x2: number, y: number, c = "#ff6f91") =>
  `<ellipse cx="${x1}" cy="${y}" rx="3.8" ry="2.3" fill="${c}" opacity=".5"/><ellipse cx="${x2}" cy="${y}" rx="3.8" ry="2.3" fill="${c}" opacity=".5"/>`;
const smile = (d: string, w = 2.4) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
/** Soft sheen on the top-left of a round head. */
const sheen = (cx: number, cy: number, rx = 7, ry = 3.5) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" opacity=".28" transform="rotate(-28 ${cx} ${cy})"/>`;

export const AVATAR_LABEL: Record<AvatarId, string> = {
  fox: "Fox",
  frog: "Frog",
  cat: "Cat",
  bear: "Bear",
  panda: "Panda",
  bunny: "Bunny",
  owl: "Owl",
  penguin: "Penguin",
  robot: "Robot",
  alien: "Alien",
  ghost: "Ghost",
  octo: "Octopus",
  dino: "Dino",
  slime: "Slime",
  tiger: "Tiger",
  shroom: "Mushroom",
};

const ART: Record<AvatarId, string> = {
  fox:
    `<path d="M9 30 L13 5 L30 19Z" fill="#ff8a3d"/><path d="M55 30 L51 5 L34 19Z" fill="#ff8a3d"/>` +
    `<path d="M14 22 L15.5 11 L23 18Z" fill="${INK}" opacity=".75"/><path d="M50 22 L48.5 11 L41 18Z" fill="${INK}" opacity=".75"/>` +
    `<ellipse cx="32" cy="36" rx="24" ry="20" fill="#ff8a3d"/>` +
    `<path d="M10 38 Q32 29 54 38 Q48 57 32 58 Q16 57 10 38Z" fill="#fff4ea"/>` +
    sheen(20, 24) +
    eyes(23, 41, 35) +
    `<ellipse cx="32" cy="44.5" rx="3.4" ry="2.5" fill="${INK}"/>` +
    smile("M28 49 Q32 52 36 49"),
  frog:
    `<circle cx="19" cy="19" r="10" fill="#5bd46a"/><circle cx="45" cy="19" r="10" fill="#5bd46a"/>` +
    `<ellipse cx="32" cy="39" rx="27" ry="19" fill="#5bd46a"/>` +
    `<ellipse cx="32" cy="51" rx="15" ry="5.5" fill="#9cf0a6" opacity=".7"/>` +
    `<circle cx="19" cy="19" r="6.5" fill="#fff"/><circle cx="45" cy="19" r="6.5" fill="#fff"/>` +
    eyes(20, 44, 20, 3.4) +
    sheen(14, 30, 5, 2.5) +
    cheeks(13, 51, 41) +
    smile("M19 41 Q32 51 45 41", 2.6),
  cat:
    `<path d="M8 32 L12 6 L30 20Z" fill="#b9a7ff"/><path d="M56 32 L52 6 L34 20Z" fill="#b9a7ff"/>` +
    `<path d="M13.5 23 L15 12 L23 19Z" fill="#ff9cc2"/><path d="M50.5 23 L49 12 L41 19Z" fill="#ff9cc2"/>` +
    `<ellipse cx="32" cy="37" rx="24" ry="21" fill="#b9a7ff"/>` +
    sheen(20, 24) +
    eyes(23, 41, 35) +
    cheeks(15, 49, 43) +
    `<path d="M29.5 41.5 L34.5 41.5 L32 44.5Z" fill="#ff6f9c" stroke="#ff6f9c" stroke-linejoin="round"/>` +
    smile("M27 47 Q29.5 49.5 32 46.5 Q34.5 49.5 37 47", 2.2) +
    `<path d="M5 40 L16 42 M6 47 L16 45.5 M59 40 L48 42 M58 47 L48 45.5" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" opacity=".45"/>`,
  bear:
    `<circle cx="13" cy="15" r="9" fill="#c4875a"/><circle cx="51" cy="15" r="9" fill="#c4875a"/>` +
    `<circle cx="13" cy="15" r="4.5" fill="#8c5634"/><circle cx="51" cy="15" r="4.5" fill="#8c5634"/>` +
    `<circle cx="32" cy="36" r="24" fill="#c4875a"/>` +
    `<ellipse cx="32" cy="45" rx="12" ry="9" fill="#f2d4b4"/>` +
    sheen(20, 22) +
    eyes(22, 42, 32) +
    `<ellipse cx="32" cy="41" rx="4.5" ry="3.2" fill="${INK}"/>` +
    smile("M28.5 47 Q32 50.5 35.5 47"),
  panda:
    `<circle cx="13" cy="14" r="9" fill="${INK}"/><circle cx="51" cy="14" r="9" fill="${INK}"/>` +
    `<circle cx="32" cy="36" r="24" fill="#f7f6fc"/>` +
    `<ellipse cx="22" cy="35" rx="6.5" ry="8.5" fill="${INK}" transform="rotate(28 22 35)"/>` +
    `<ellipse cx="42" cy="35" rx="6.5" ry="8.5" fill="${INK}" transform="rotate(-28 42 35)"/>` +
    `<circle cx="23" cy="33.5" r="2.6" fill="#fff"/><circle cx="41" cy="33.5" r="2.6" fill="#fff"/>` +
    cheeks(13, 51, 45) +
    `<ellipse cx="32" cy="43" rx="3.8" ry="2.7" fill="${INK}"/>` +
    smile("M28.5 48 Q32 51 35.5 48"),
  bunny:
    `<ellipse cx="22" cy="16" rx="6.5" ry="14.5" fill="#fff0f6" transform="rotate(-10 22 16)"/>` +
    `<ellipse cx="42" cy="16" rx="6.5" ry="14.5" fill="#fff0f6" transform="rotate(10 42 16)"/>` +
    `<ellipse cx="22" cy="17" rx="3.2" ry="10" fill="#ff9cc2" transform="rotate(-10 22 17)"/>` +
    `<ellipse cx="42" cy="17" rx="3.2" ry="10" fill="#ff9cc2" transform="rotate(10 42 17)"/>` +
    `<circle cx="32" cy="41" r="21" fill="#fff0f6"/>` +
    eyes(24.5, 39.5, 39) +
    cheeks(17, 47, 46) +
    `<ellipse cx="32" cy="45" rx="2.8" ry="2" fill="#ff6f9c"/>` +
    smile("M28.5 49 Q30.5 51 32 48.5 Q33.5 51 35.5 49", 2.2) +
    `<rect x="30" y="50.2" width="4" height="3.6" rx="1" fill="#fff" stroke="${INK}" stroke-width="1.2"/>`,
  owl:
    `<path d="M10 30 L7 7 L22 17 Q32 13 42 17 L57 7 L54 30 Q57 57 32 59 Q7 57 10 30Z" fill="#7c6bd6"/>` +
    `<ellipse cx="32" cy="47" rx="14" ry="10" fill="#c9bff7"/>` +
    `<path d="M25 46 q2.5 2.5 5 0 M34 46 q2.5 2.5 5 0 M29.5 51 q2.5 2.5 5 0" fill="none" stroke="#7c6bd6" stroke-width="1.6" stroke-linecap="round"/>` +
    `<circle cx="22" cy="31" r="9.5" fill="#fff"/><circle cx="42" cy="31" r="9.5" fill="#fff"/>` +
    eyes(22, 42, 31, 5) +
    `<path d="M28.5 38 L35.5 38 L32 44Z" fill="#ffb020" stroke="#ffb020" stroke-linejoin="round" stroke-width="1.5"/>`,
  penguin:
    `<circle cx="32" cy="34" r="25" fill="#2d3a66"/>` +
    `<path d="M32 21 Q41 12 49 21 Q57 34 49 48 Q41 57 32 57 Q23 57 15 48 Q7 34 15 21 Q23 12 32 21Z" fill="#fff"/>` +
    sheen(18, 16, 6, 3) +
    eyes(24, 40, 33) +
    cheeks(17, 47, 41) +
    `<ellipse cx="32" cy="41" rx="5" ry="3.2" fill="#ffb020"/>`,
  robot:
    `<path d="M32 15 V6" stroke="#6e8399" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="6" r="4" fill="#ff5d73"/>` +
    `<rect x="3" y="29" width="7" height="15" rx="2.5" fill="#6e8399"/><rect x="54" y="29" width="7" height="15" rx="2.5" fill="#6e8399"/>` +
    `<rect x="9" y="14" width="46" height="42" rx="13" fill="#a7bbd0"/>` +
    `<rect x="15" y="22" width="34" height="25" rx="8" fill="${INK}"/>` +
    `<rect x="20.5" y="28.5" width="8" height="9" rx="3.5" fill="#5ef0ff"/><rect x="35.5" y="28.5" width="8" height="9" rx="3.5" fill="#5ef0ff"/>` +
    `<path d="M26 41.5 Q32 44.5 38 41.5" fill="none" stroke="#5ef0ff" stroke-width="2.2" stroke-linecap="round"/>` +
    `<circle cx="15" cy="51.5" r="1.6" fill="#6e8399"/><circle cx="49" cy="51.5" r="1.6" fill="#6e8399"/>` +
    sheen(17, 18, 5, 2.2),
  alien:
    `<path d="M23 15 L16 5 M41 15 L48 5" stroke="#8fd44c" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="16" cy="5" r="3.8" fill="#c6f432"/><circle cx="48" cy="5" r="3.8" fill="#c6f432"/>` +
    `<path d="M32 11 C53 11 59 26 57 37 C55 51 43 59 32 59 C21 59 9 51 7 37 C5 26 11 11 32 11Z" fill="#9be15d"/>` +
    sheen(18, 20) +
    `<ellipse cx="21.5" cy="35" rx="7.5" ry="10" fill="${INK}" transform="rotate(-32 21.5 35)"/>` +
    `<ellipse cx="42.5" cy="35" rx="7.5" ry="10" fill="${INK}" transform="rotate(32 42.5 35)"/>` +
    `<circle cx="24" cy="31" r="2.4" fill="#fff"/><circle cx="45" cy="31" r="2.4" fill="#fff"/>` +
    smile("M29 50 Q32 52 35 50", 2.2),
  ghost:
    `<path d="M9 33 Q9 7 32 7 Q55 7 55 33 L55 55 Q51 50 47 55 Q43 60 39 55 Q35.5 50 32 55 Q28.5 60 25 55 Q21 50 17 55 Q13 60 9 55Z" fill="#eef0ff"/>` +
    sheen(19, 17) +
    `<ellipse cx="24" cy="30" rx="3.8" ry="5" fill="${INK}"/><ellipse cx="40" cy="30" rx="3.8" ry="5" fill="${INK}"/>` +
    `<circle cx="25.3" cy="28" r="1.5" fill="#fff"/><circle cx="41.3" cy="28" r="1.5" fill="#fff"/>` +
    cheeks(17, 47, 38) +
    `<ellipse cx="32" cy="41" rx="3.2" ry="4" fill="${INK}"/>`,
  octo:
    `<ellipse cx="14" cy="51" rx="5.5" ry="8" fill="#ff6b8b" transform="rotate(20 14 51)"/>` +
    `<ellipse cx="26" cy="54" rx="5.5" ry="8" fill="#ff6b8b"/><ellipse cx="38" cy="54" rx="5.5" ry="8" fill="#ff6b8b"/>` +
    `<ellipse cx="50" cy="51" rx="5.5" ry="8" fill="#ff6b8b" transform="rotate(-20 50 51)"/>` +
    `<ellipse cx="32" cy="30" rx="25" ry="23" fill="#ff6b8b"/>` +
    `<circle cx="23" cy="14" r="2.6" fill="#e0476b"/><circle cx="40" cy="11" r="2" fill="#e0476b"/><circle cx="47" cy="19" r="1.8" fill="#e0476b"/>` +
    sheen(16, 22, 5, 2.5) +
    eyes(23, 41, 32) +
    cheeks(15, 49, 39) +
    smile("M27 41 Q32 46 37 41"),
  dino:
    `<path d="M19 15 L23 3 L28 13Z M29.5 11 L34 1 L38.5 11Z M40 13 L45 4 L47 16Z" fill="#ffb020" stroke="#ffb020" stroke-linejoin="round" stroke-width="1.5"/>` +
    `<ellipse cx="32" cy="36" rx="25" ry="22" fill="#46c99a"/>` +
    `<ellipse cx="32" cy="47" rx="15" ry="9" fill="#b8f0d6"/>` +
    sheen(18, 23) +
    eyes(22, 42, 32) +
    `<circle cx="28" cy="44" r="1.4" fill="${INK}"/><circle cx="36" cy="44" r="1.4" fill="${INK}"/>` +
    smile("M24 50 Q32 55 40 50") +
    `<path d="M27.5 51.6 L29 54 L30.5 52.4 M33.5 52.4 L35 54 L36.5 51.6" fill="#fff" stroke="#fff" stroke-width="1" stroke-linejoin="round"/>`,
  slime:
    `<path d="M32 7 Q39 7 42 15 Q57 21 57 40 Q57 58 32 58 Q7 58 7 40 Q7 21 22 15 Q25 7 32 7Z" fill="#4fb5ff"/>` +
    `<path d="M12 46 Q12 56 32 56 Q52 56 52 46 Q46 52 32 52 Q18 52 12 46Z" fill="#2f8fe0" opacity=".55"/>` +
    `<ellipse cx="19" cy="26" rx="4" ry="6.5" fill="#fff" opacity=".55" transform="rotate(20 19 26)"/>` +
    `<circle cx="25" cy="15" r="1.8" fill="#fff" opacity=".6"/>` +
    eyes(24, 40, 37, 3.6) +
    cheeks(16, 48, 44) +
    `<path d="M28 44 Q32 50 36 44Z" fill="${INK}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>`,
  tiger:
    `<circle cx="13" cy="15" r="8.5" fill="#ffa53a"/><circle cx="51" cy="15" r="8.5" fill="#ffa53a"/>` +
    `<circle cx="13" cy="15" r="4" fill="#3a2418"/><circle cx="51" cy="15" r="4" fill="#3a2418"/>` +
    `<circle cx="32" cy="36" r="24" fill="#ffa53a"/>` +
    `<path d="M26 14 L28 21 M32 12.5 V20.5 M38 14 L36 21 M8.5 32 L17 34 M8.5 39 L17 38.5 M55.5 32 L47 34 M55.5 39 L47 38.5" stroke="#3a2418" stroke-width="2.8" stroke-linecap="round"/>` +
    `<ellipse cx="32" cy="46" rx="11.5" ry="8" fill="#fff1dc"/>` +
    sheen(20, 24, 5, 2.5) +
    eyes(23, 41, 33) +
    `<path d="M29 41 L35 41 L32 44.5Z" fill="#ff6f9c" stroke="#ff6f9c" stroke-linejoin="round" stroke-width="1.5"/>` +
    smile("M28 47.5 Q30 50 32 47 Q34 50 36 47.5", 2.2),
  shroom:
    `<rect x="17" y="30" width="30" height="29" rx="11" fill="#fbe8d3"/>` +
    `<path d="M3 35 Q3 5 32 5 Q61 5 61 35 Q61 39 56 39 L8 39 Q3 39 3 35Z" fill="#ff5a5f"/>` +
    `<circle cx="17" cy="21" r="4.5" fill="#fff"/><circle cx="33" cy="13" r="4" fill="#fff"/><circle cx="47" cy="25" r="5" fill="#fff"/><circle cx="29" cy="29" r="2.6" fill="#fff"/>` +
    sheen(13, 15, 5, 2.4) +
    eyes(26, 38, 47, 2.9) +
    cheeks(21, 43, 52) +
    smile("M29.5 52 Q32 54.5 34.5 52", 2.1),
};

/** Inner SVG markup (64×64 grid) for an avatar id. */
export function avatarMarkup(id: AvatarId): string {
  return ART[id];
}

// ----- canvas games: avatars as images -----

const images = new Map<AvatarId, HTMLImageElement>();

function load(id: AvatarId): HTMLImageElement {
  let img = images.get(id);
  if (!img) {
    img = new Image();
    // Rasterised at 128 px so scaled draws stay crisp on retina canvases.
    img.src =
      "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">${ART[id]}</svg>`);
    images.set(id, img);
  }
  return img;
}

/** The avatar as a ready-to-draw image, or null while it loads (or for a non-avatar like a fallback emoji). */
export function avatarImage(id: string | undefined): HTMLImageElement | null {
  if (typeof window === "undefined" || !isAvatarId(id)) return null;
  const img = load(id);
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/**
 * Draws an avatar centred on (x, y), `size` px across (default: matches the current font size,
 * like the emoji it replaces). Not an avatar id (a fallback emoji like "🙂")? Draws the text.
 */
export function drawAvatar(g: CanvasRenderingContext2D, id: string | undefined, x: number, y: number, size?: number) {
  const img = avatarImage(id);
  if (img) {
    size ??= (parseFloat(g.font) || 16) * 1.05;
    g.drawImage(img, x - size / 2, y - size / 2, size, size);
    return;
  }
  if (id && !isAvatarId(id)) {
    const align = g.textAlign;
    const base = g.textBaseline;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(id, x, y);
    g.textAlign = align;
    g.textBaseline = base;
  }
}

/** Starts loading every avatar image (canvas games call this on mount). */
export function preloadAvatars() {
  if (typeof window === "undefined") return;
  for (const id of Object.keys(ART) as AvatarId[]) load(id);
}

// Start fetching the art as soon as a game that draws avatars loads.
preloadAvatars();
