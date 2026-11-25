// A finished room game as a picture: 1080×1920, an Instagram/WhatsApp story. The winner is the
// hero; the scoreboard sits in one calm panel. Like the daily card, everything that matters stays
// clear of the top/bottom ~250px where Instagram draws its own UI.
import { CATALOG_BY_ID } from "@/games/catalog";

const W = 1080;
const H = 1920;

export interface CardPlayer {
  id: string;
  name: string;
  color: string;
  score?: number;
  won: boolean;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, col);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
}

function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  const ctx = g as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in ctx) {
    ctx.letterSpacing = `${spacing}px`;
    g.fillText(text, x, y);
    ctx.letterSpacing = "0px";
  } else g.fillText(text, x, y);
}

/** The biggest font size (down to `min`) at which `text` fits in `max` px. */
function fit(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, start: number, min: number, max: number): number {
  let px = start;
  for (; px > min; px -= 6) {
    g.font = font(px);
    if (g.measureText(text).width <= max) break;
  }
  g.font = font(px);
  return px;
}

/** "#rrggbb" + alpha → rgba(). Player colours are hex. */
function alpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(198,244,50,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export async function renderResultCard(
  opts: { gameId: string; players: CardPlayer[]; me: string; allWon: boolean },
  fonts: { hero: string; marker: string; sans: string },
): Promise<Blob | null> {
  await Promise.all(
    [`800 92px ${fonts.hero}`, `400 54px ${fonts.marker}`, `700 44px ${fonts.sans}`].map((f) => document.fonts?.load(f).catch(() => null)),
  );
  await document.fonts?.ready;
  const [logo, rux] = await Promise.all([loadImage("/brand/logo.png"), loadImage("/brand/rux-wink.png")]);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return null;

  const meta = CATALOG_BY_ID[opts.gameId];
  const accent = meta?.accent ?? "#c6f432";
  const winners = opts.players.filter((p) => p.won);
  const iWon = winners.some((p) => p.id === opts.me);

  // Wall: near-black, a glow in the game's colour behind the winner, two quiet brand glows.
  g.fillStyle = "#05060a";
  g.fillRect(0, 0, W, H);
  glow(g, 160, 1560, 700, "rgba(79,123,255,0.14)");
  glow(g, 980, 1380, 600, "rgba(255,79,163,0.12)");
  glow(g, W / 2, 700, 600, alpha(accent, 0.34));
  glow(g, W / 2, 640, 260, "rgba(255,200,60,0.22)");
  g.textAlign = "center";

  // Header: the Ruckus logo, then the game in its own colour.
  if (logo) {
    const lh = 118;
    const lw = (logo.naturalWidth / logo.naturalHeight) * lh;
    g.drawImage(logo, W / 2 - lw / 2, 240, lw, lh);
  }
  g.fillStyle = accent;
  g.font = `800 40px ${fonts.hero}`;
  spaced(g, (meta?.name ?? "Ruckus").toUpperCase(), W / 2, 410, 6);

  // The moment: a trophy, the winner's name huge, a line underneath.
  g.font = `180px ${fonts.sans}`;
  g.fillText(opts.allWon ? "🤝" : winners.length ? "🏆" : "🤝", W / 2, 640);
  const hero =
    opts.allWon ? "TEAM WIN" : winners.length === 0 ? "IT'S A TIE" : winners.length === 1 ? winners[0].name : winners.map((p) => p.name).join(" & ");
  g.fillStyle = "#ffffff";
  g.shadowColor = alpha(accent, 0.6);
  g.shadowBlur = 50;
  fit(g, hero, (px) => `800 ${px}px ${fonts.hero}`, 190, 80, W - 160);
  g.fillText(hero, W / 2, 840);
  g.shadowBlur = 0;
  g.fillStyle = "#ffb020";
  g.font = `800 60px ${fonts.hero}`;
  spaced(g, opts.allWon ? "WE BEAT IT" : winners.length === 0 ? "NOBODY BLINKED" : winners.length === 1 ? "WINS!" : "WIN!", W / 2, 930, 10);
  g.fillStyle = "#edf0f7";
  g.font = `400 54px ${fonts.marker}`;
  g.fillText(iWon ? "ekdum legend 😎" : winners.length ? "GG, agli baar pakka 🤞" : "kya takkar thi! 🔥", W / 2, 1010);

  // Rux, winking beside the trophy.
  if (rux) {
    g.save();
    g.translate(860, 560);
    g.rotate(0.16);
    g.drawImage(rux, -100, -110, 200, 218);
    g.restore();
  }

  // Scoreboard: up to six rows, you highlighted.
  const rows = opts.players.slice(0, 6);
  const hasScores = rows.some((p) => typeof p.score === "number");
  const px = 110;
  const pw = W - px * 2;
  const top = 1080;
  const row = 84;
  g.fillStyle = "rgba(255,255,255,0.05)";
  g.strokeStyle = "rgba(255,255,255,0.12)";
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(px, top, pw, row * rows.length + 30, 36);
  g.fill();
  g.stroke();
  rows.forEach((p, i) => {
    const y = top + 15 + i * row + row / 2;
    if (p.id === opts.me) {
      g.fillStyle = alpha(accent, 0.14);
      g.beginPath();
      g.roundRect(px + 14, y - row / 2 + 6, pw - 28, row - 12, 22);
      g.fill();
    }
    // Place, then a disc in the player's colour with their initial.
    g.textAlign = "left";
    g.fillStyle = p.won ? "#ffd23f" : "#8a91a7";
    g.font = `800 40px ${fonts.hero}`;
    g.fillText(p.won ? "👑" : `${i + 1}`, px + 40, y + 14);
    g.fillStyle = p.color;
    g.beginPath();
    g.arc(px + 140, y, 26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#05060a";
    g.textAlign = "center";
    g.font = `800 30px ${fonts.hero}`;
    g.fillText((p.name.trim()[0] ?? "?").toUpperCase(), px + 140, y + 11);
    g.textAlign = "left";
    g.fillStyle = p.id === opts.me ? "#ffffff" : "#edf0f7";
    g.font = `700 42px ${fonts.sans}`;
    g.fillText(p.id === opts.me ? `${p.name} (me)` : p.name, px + 190, y + 15, hasScores ? 470 : 620);
    if (hasScores) {
      g.textAlign = "right";
      g.fillStyle = p.won ? accent : "#c9cfdd";
      g.font = `800 48px ${fonts.hero}`;
      g.fillText((p.score ?? 0).toLocaleString("en-US"), px + pw - 44, y + 17, 220);
    }
  });
  g.textAlign = "center";

  // The dare + where to play it.
  // Right under the scoreboard (so a 2-player card has no hole), never into Instagram's bottom UI.
  const dare = Math.min(top + row * rows.length + 30 + 170, 1650);
  g.fillStyle = "#c6f432";
  g.font = `400 66px ${fonts.marker}`;
  g.fillText("beat us if you can 👀", W / 2, dare);
  g.fillStyle = "#edf0f7";
  g.font = `700 38px ${fonts.sans}`;
  g.fillText(`${window.location.host}/games/${opts.gameId}`, W / 2, dare + 62);

  return new Promise((res) => c.toBlob(res, "image/png"));
}
