// The daily challenge result as a picture (1080×1350, made for stories and chats).
import { CATALOG_BY_ID } from "@/games/catalog";
import { currentStreak, dailyGames, dailyNumber, dailyResultText, type DailyData } from "./daily";

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

/** Draws the card. `ruxSvg` is Rux's SVG markup (taken from the page), `fonts` the page's font stacks. */
export async function renderDailyCard(
  day: string,
  data: DailyData,
  ruxSvg: string,
  fonts: { hero: string; marker: string; sans: string },
): Promise<Blob | null> {
  await document.fonts?.ready;
  const W = 1080;
  const H = 1350;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return null;

  // Wall + colour blobs.
  g.fillStyle = "#05060a";
  g.fillRect(0, 0, W, H);
  for (const [x, y, r, col] of [
    [120, 80, 520, "rgba(198,244,50,0.22)"],
    [1000, 300, 480, "rgba(255,79,163,0.22)"],
    [300, 1250, 560, "rgba(79,123,255,0.22)"],
  ] as const) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, col);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }

  // Header.
  g.fillStyle = "#c6f432";
  g.font = `400 46px ${fonts.marker}`;
  g.fillText("ruckus daily", 80, 130);
  g.fillStyle = "#edf0f7";
  g.font = `800 120px ${fonts.hero}`;
  g.fillText(`#${dailyNumber(day)}`, 74, 250);
  g.fillStyle = "#8a91a7";
  g.font = `600 36px ${fonts.sans}`;
  g.fillText(day, 80, 305);

  // Rux, top right.
  const rux = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(ruxSvg));
  if (rux) {
    g.save();
    g.translate(870, 190);
    g.rotate(0.12);
    g.drawImage(rux, -150, -160, 300, 320);
    g.restore();
  }

  // The three games.
  const today = data.days[day] ?? {};
  let y = 390;
  dailyGames(day).forEach((id, i) => {
    const meta = CATALOG_BY_ID[id];
    const e = today[id];
    const accent = meta?.accent ?? "#c6f432";
    const tilt = i % 2 ? 0.012 : -0.012;
    g.save();
    g.translate(W / 2, y + 120);
    g.rotate(tilt);
    // Sticker: shadow, off-white edge, colour body.
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.beginPath();
    g.roundRect(-460 + 10, -110 + 12, 920, 220, 36);
    g.fill();
    g.fillStyle = "#fff8e7";
    g.beginPath();
    g.roundRect(-460, -110, 920, 220, 36);
    g.fill();
    g.fillStyle = accent;
    g.beginPath();
    g.roundRect(-452, -102, 904, 204, 30);
    g.fill();
    g.fillStyle = "#14101f";
    g.font = `800 64px ${fonts.hero}`;
    g.fillText(meta?.name ?? id, -410, -10, 560);
    g.font = `600 34px ${fonts.sans}`;
    g.fillText(meta?.tagline ?? "", -410, 50, 560);
    const result = !e ? "—" : e.pending ? "…" : dailyResultText(id, e.score, e.headline);
    g.textAlign = "right";
    g.font = `800 64px ${fonts.hero}`;
    g.fillText(result, 410, 22, 300);
    g.textAlign = "left";
    g.restore();
    y += 270;
  });

  // Streak + link.
  const streak = currentStreak(data, day);
  g.fillStyle = "#ffd23f";
  g.font = `400 54px ${fonts.marker}`;
  if (streak > 1) g.fillText(`🔥 ${streak}-day streak`, 80, 1235);
  g.fillStyle = "#8a91a7";
  g.font = `600 32px ${fonts.sans}`;
  g.fillText(`${window.location.host}/daily · same puzzles for everyone`, 80, 1295);
  return new Promise((res) => c.toBlob(res, "image/png"));
}
