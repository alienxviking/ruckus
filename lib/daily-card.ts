// The daily challenge result as a picture: 1080×1920, an Instagram/WhatsApp story.
// The streak is the hero; the three scores sit in one calm panel. Instagram draws its own
// UI over the top ~250px and bottom ~250px, so everything that matters stays between them.
import { CATALOG_BY_ID } from "@/games/catalog";
import { currentStreak, dailyGames, dailyNumber, dailyResultText, type DailyData } from "./daily";

export const CARD_W = 1080;
export const CARD_H = 1920;

const EMOJI = `"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;

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

/** Draws the card. `ruxSvg` is Rux's SVG markup (taken from the page), `fonts` the page's font stacks. */
export async function renderDailyCard(
  day: string,
  data: DailyData,
  ruxSvg: string,
  fonts: { hero: string; marker: string; sans: string },
): Promise<Blob | null> {
  await document.fonts?.ready;
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

  // Header.
  g.fillStyle = "#c6f432";
  g.font = `800 44px ${fonts.hero}`;
  spaced(g, `RUCKUS DAILY #${dailyNumber(day)}`, W / 2, 330, 6);
  g.fillStyle = "#8a91a7";
  g.font = `600 34px ${fonts.sans}`;
  const date = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", timeZone: "UTC" });
  g.fillText(date, W / 2, 385);

  // The flex: a big flame, a huge number, "DAY STREAK".
  g.font = `220px ${EMOJI}`;
  g.fillText("🔥", W / 2, 660);
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
  const rux = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(ruxSvg));
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
  g.fillStyle = "#8a91a7";
  g.font = `600 36px ${fonts.sans}`;
  g.fillText(`${window.location.host}/daily`, W / 2, 1712);

  return new Promise((res) => c.toBlob(res, "image/png"));
}
