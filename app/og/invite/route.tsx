import { ImageResponse } from "next/og";
import { CATALOG, CATALOG_BY_ID } from "@/games/catalog";
import { GameCard, HomeCard, OG_SIZE, ogFonts } from "@/lib/og";
import { inviteParams } from "@/lib/invite";

// The preview image for invite links (/i/CODE?g=<game>&n=<name>): the picked game's poster
// with "<name> invited you". Cached hard: the same link always draws the same picture.
export async function GET(req: Request) {
  const { game, name } = inviteParams(new URL(req.url).searchParams);
  const meta = game ? CATALOG_BY_ID[game] : undefined;
  const fonts = await ogFonts();
  const body = meta ? (
    <GameCard game={meta} kicker={name ? `${name} invited you!` : "you're invited!"} footer="tap to join · ruckus" />
  ) : (
    <HomeCard games={CATALOG.length} />
  );
  return new ImageResponse(body, {
    ...OG_SIZE,
    fonts,
    headers: { "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable" },
  });
}
