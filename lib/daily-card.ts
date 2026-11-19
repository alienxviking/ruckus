// The daily challenge result as a picture: 1080×1920, an Instagram/WhatsApp story.
// The streak is the hero; the three scores sit in one calm panel. Instagram draws its own
// UI over the top ~250px and bottom ~250px, so everything that matters stays between them.
import { CATALOG_BY_ID } from "@/games/catalog";
import { currentStreak, dailyGames, dailyNumber, dailyResultText, type DailyData } from "./daily";

export const CARD_W = 1080;
export const CARD_H = 1920;


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
  g.fillRect(0, 0, CARD_W, CARD_H);
}

/** Text with letter spacing (canvas `letterSpacing` where supported). */
function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  const ctx = g as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in ctx) {
    ctx.letterSpacing = `${spacing}px`;
    g.fillText(text, x, y);
    ctx.letterSpacing = "0px";
  } else g.fillText(text, x, y);
}

/**
 * A flame drawn in layers (deep red edge, orange body, yellow heart, white-hot core) with
 * side licks, so it reads as fire rather than an emoji. `x`,`base` = bottom centre.
 */
function drawFlame(g: CanvasRenderingContext2D, x: number, base: number, size: number, hot: boolean) {
  const tongue = (cx: number, by: number, w: number, h: number, lean: number) => {
    g.beginPath();
    g.moveTo(cx, by);
    g.bezierCurveTo(cx - w * 0.62, by - h * 0.02, cx - w * 0.6, by - h * 0.32, cx - w * 0.34, by - h * 0.52);
    g.bezierCurveTo(cx - w * 0.12, by - h * 0.7, cx + lean * w * 0.2, by - h * 0.78, cx + lean * w * 0.45, by - h);
    g.bezierCurveTo(cx + w * 0.22, by - h * 0.74, cx + w * 0.62, by - h * 0.56, cx + w * 0.52, by - h * 0.3);
    g.bezierCurveTo(cx + w * 0.62, by - h * 0.08, cx + w * 0.3, by, cx, by);
    g.closePath();
  };
  const fill = (top: number, bottom: number, stops: [number, string][]) => {
    const grad = g.createLinearGradient(0, top, 0, bottom);
    for (const [o, col] of stops) grad.addColorStop(o, col);
    g.fillStyle = grad;
    g.fill();
  };
  const h = size;
  const w = size * 0.72;
  const palette = hot
    ? { edge: "#ff2d1a", body: "#ff7a1a", heart: "#ffc93c", core: "#fff6d8" }
    : { edge: "#7bd12a", body: "#c6f432", heart: "#ecff9a", core: "#fbffe8" };
  g.save();
  g.shadowColor = hot ? "rgba(255,90,20,0.85)" : "rgba(198,244,50,0.7)";
  g.shadowBlur = 70;
  // Side licks behind the main flame.
  tongue(x - w * 0.36, base - h * 0.02, w * 0.5, h * 0.6, -0.9);
  fill(base - h * 0.6, base, [[0, "rgba(0,0,0,0)"], [0.25, palette.edge], [1, palette.body]]);
  tongue(x + w * 0.38, base - h * 0.02, w * 0.46, h * 0.52, 0.8);
  fill(base - h * 0.52, base, [[0, "rgba(0,0,0,0)"], [0.25, palette.edge], [1, palette.body]]);
  // Main body.
  tongue(x, base, w, h, 0.35);
  fill(base - h, base, [[0, "rgba(0,0,0,0)"], [0.12, palette.edge], [0.5, palette.body], [1, palette.heart]]);
  g.shadowBlur = 30;
  // Heart and core.
  tongue(x + w * 0.02, base - h * 0.03, w * 0.6, h * 0.66, 0.25);
  fill(base - h * 0.66, base, [[0, "rgba(0,0,0,0)"], [0.2, palette.body], [0.65, palette.heart], [1, palette.core]]);
  tongue(x + w * 0.03, base - h * 0.06, w * 0.3, h * 0.36, 0.1);
  fill(base - h * 0.42, base, [[0, "rgba(255,255,255,0)"], [0.35, palette.core], [1, "#ffffff"]]);
  // Embers drifting up.
  g.shadowBlur = 18;
  for (const [ex, ey, r, a] of [
    [-0.62, 0.88, 7, 0.9],
    [0.66, 0.8, 5, 0.8],
    [-0.3, 1.08, 4, 0.7],
    [0.4, 1.02, 6, 0.75],
    [0.9, 0.55, 4, 0.6],
    [-0.88, 0.6, 5, 0.65],
  ] as const) {
    g.fillStyle = hot ? `rgba(255,${170 + Math.round(r * 8)},60,${a})` : `rgba(220,255,120,${a})`;
    g.beginPath();
    g.arc(x + ex * w, base - ey * h, r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Draws the card; `fonts` are the page's font stacks (Rux and the logo come from /brand). */
export async function renderDailyCard(day: string, data: DailyData, fonts: { hero: string; marker: string; sans: string }): Promise<Blob | null> {
  // Make sure every face is loaded before drawing (canvas silently falls back otherwise).
  await Promise.all(
    [`800 92px ${fonts.hero}`, `400 54px ${fonts.marker}`, `700 44px ${fonts.sans}`, `600 36px ${fonts.sans}`].map((f) =>
      document.fonts?.load(f).catch(() => null),
    ),
  );
  await document.fonts?.ready;
  const [logo, rux] = await Promise.all([loadImage("/brand/logo.png"), loadImage("/brand/rux-wink.png")]);
  const W = CARD_W;
  const H = CARD_H;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return null;

  const today = data.days[day] ?? {};
  const games = dailyGames(day);
  const done = games.filter((id) => today[id] && !today[id].pending).length;
  const streak = Math.max(1, currentStreak(data, day));
  const best = Math.max(data.streak.best, streak);
  const hot = streak >= 2;

  // Wall: near-black with a warm fire glow behind the streak and two quiet brand glows.
  g.fillStyle = "#05060a";
  g.fillRect(0, 0, W, H);
  glow(g, 160, 1500, 700, "rgba(79,123,255,0.16)");
  glow(g, 980, 1300, 600, "rgba(255,79,163,0.14)");
  glow(g, W / 2, 720, 560, hot ? "rgba(255,120,40,0.42)" : "rgba(198,244,50,0.22)");
  glow(g, W / 2, 660, 260, hot ? "rgba(255,200,60,0.30)" : "rgba(198,244,50,0.18)");

  g.textAlign = "center";

  // Header: the Ruckus logo exactly as on the site (Rux + wordmark), centred.
  if (logo) {
    const lh = 118;
    const lw = (logo.naturalWidth / logo.naturalHeight) * lh;
    g.drawImage(logo, W / 2 - lw / 2, 240, lw, lh);
  } else {
    g.fillStyle = "#ffffff";
    g.font = `800 92px ${fonts.hero}`;
    g.fillText("ruckus", W / 2, 330);
  }
  const date = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  g.fillStyle = "#c6f432";
  g.font = `800 38px ${fonts.hero}`;
  spaced(g, `DAILY #${dailyNumber(day)}  ·  ${date.toUpperCase()}`, W / 2, 405, 5);

  // The flex: a big flame, a huge number, "DAY STREAK".
  drawFlame(g, W / 2, 690, 250, hot);
  g.fillStyle = "#ffffff";
  g.font = `800 ${streak >= 100 ? 260 : 340}px ${fonts.hero}`;
  g.shadowColor = hot ? "rgba(255,120,40,0.7)" : "rgba(198,244,50,0.5)";
  g.shadowBlur = 60;
  g.fillText(String(streak), W / 2, 960);
  g.shadowBlur = 0;
  g.fillStyle = hot ? "#ffb020" : "#c6f432";
  g.font = `800 64px ${fonts.hero}`;
  spaced(g, "DAY STREAK", W / 2, 1050, 12);
  g.fillStyle = "#edf0f7";
  g.font = `400 54px ${fonts.marker}`;
  g.fillText(
    streak >= best && streak >= 3 ? "personal best! 🏆" : streak === 1 ? "streak shuru, ab rukna mat" : `best: ${best} days`,
    W / 2,
    1128,
  );

  // Rux, cheering beside the number.
  if (rux) {
    g.save();
    g.translate(870, 850);
    g.rotate(0.16);
    g.drawImage(rux, -115, -125, 230, 250);
    g.restore();
  }

  // Scores: one panel, three rows, game name + score only.
  const px = 110;
  const pw = W - px * 2;
  const top = 1190;
  const row = 108;
  g.fillStyle = "rgba(255,255,255,0.05)";
  g.strokeStyle = "rgba(255,255,255,0.12)";
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(px, top, pw, row * games.length + 30, 36);
  g.fill();
  g.stroke();
  games.forEach((id, i) => {
    const meta = CATALOG_BY_ID[id];
    const e = today[id];
    const accent = meta?.accent ?? "#c6f432";
    const y = top + 15 + i * row + row / 2;
    if (i > 0) {
      g.fillStyle = "rgba(255,255,255,0.08)";
      g.fillRect(px + 40, y - row / 2, pw - 80, 2);
    }
    g.fillStyle = accent;
    g.beginPath();
    g.arc(px + 62, y, 14, 0, Math.PI * 2);
    g.fill();
    g.textAlign = "left";
    g.fillStyle = "#edf0f7";
    g.font = `700 44px ${fonts.sans}`;
    g.fillText(meta?.name ?? id, px + 100, y + 15, 480);
    g.textAlign = "right";
    const result = !e ? "–" : e.pending ? "…" : dailyResultText(id, e.score, e.headline);
    g.fillStyle = e && !e.pending ? accent : "#8a91a7";
    g.font = `800 58px ${fonts.hero}`;
    g.fillText(result, px + pw - 50, y + 20, 300);
  });
  g.textAlign = "center";

  // The dare + where to play.
  g.fillStyle = "#c6f432";
  g.font = `400 66px ${fonts.marker}`;
  g.fillText(done === games.length ? "beat me if you can 👀" : `${done}/${games.length} done, come play`, W / 2, 1650);
  g.fillStyle = "#edf0f7";
  g.font = `700 38px ${fonts.sans}`;
  g.fillText(`${window.location.host}/daily`, W / 2, 1712);

  return new Promise((res) => c.toBlob(res, "image/png"));
}
