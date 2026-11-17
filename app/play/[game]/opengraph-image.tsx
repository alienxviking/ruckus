import { ImageResponse } from "next/og";
import { CATALOG_BY_ID } from "@/games/catalog";
import { LOCAL_GAMES } from "@/lib/local-games";
import { GameCard, HomeCard, OG_SIZE, ogFonts } from "@/lib/og";

export const alt = "A Ruckus game";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return LOCAL_GAMES.map((g) => ({ game: g.id }));
}

// Preview for /play/<game>: the game's poster.
export default async function Image({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const meta = CATALOG_BY_ID[game];
  const fonts = await ogFonts();
  if (!meta) return new ImageResponse(<HomeCard games={Object.keys(CATALOG_BY_ID).length} />, { ...OG_SIZE, fonts });
  return new ImageResponse(
    <GameCard game={meta} kicker={meta.minPlayers <= 1 ? "play it solo, right now" : "play it vs bots, right now"} />,
    { ...OG_SIZE, fonts },
  );
}
