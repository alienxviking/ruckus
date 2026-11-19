import { ImageResponse } from "next/og";
import { CATALOG, CATALOG_BY_ID } from "@/games/catalog";
import { GameCard, HomeCard, OG_SIZE, ogFonts } from "@/lib/og";

export const alt = "A Ruckus game";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return CATALOG.map((g) => ({ game: g.id }));
}

// Preview for /games/<game>: the game's poster.
export default async function Image({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const meta = CATALOG_BY_ID[game];
  const fonts = await ogFonts();
  if (!meta) return new ImageResponse(<HomeCard games={CATALOG.length} />, { ...OG_SIZE, fonts });
  return new ImageResponse(<GameCard game={meta} kicker="play it with friends" />, { ...OG_SIZE, fonts });
}
