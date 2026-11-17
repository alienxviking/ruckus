import { ImageResponse } from "next/og";
import { CATALOG } from "@/games/catalog";
import { HomeCard, OG_SIZE, ogFonts } from "@/lib/og";

export const alt = "Ruckus: cause a ruckus. Party games in your browser.";
export const size = OG_SIZE;
export const contentType = "image/png";

// The site's link preview (home page and anything without its own).
export default async function Image() {
  return new ImageResponse(<HomeCard games={CATALOG.length} />, { ...OG_SIZE, fonts: await ogFonts() });
}
