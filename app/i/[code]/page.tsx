import type { Metadata } from "next";
import { CATALOG_BY_ID } from "@/games/catalog";
import { normalizeCode } from "@/lib/identity";
import { inviteParams } from "@/lib/invite";
import { Rux } from "@/components/Rux";

// An invite link's landing: link previews read this page's metadata (the game's poster and
// "<name> invited you"); people are sent straight on to the room by a tiny script.

// Rendered per link on the server (the preview depends on the query): a tiny page, so blocking
// on it is fine.
export const instant = false;

type Props = { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const code = normalizeCode((await params).code);
  const { game, name } = inviteParams(await searchParams);
  const meta = game ? CATALOG_BY_ID[game] : undefined;
  const title = `${name ? `${name} invited you` : "You're invited"}${meta ? ` to ${meta.name}` : ""} · Ruckus`;
  const description = meta ? `${meta.tagline} Tap to join room ${code}. No app, no sign-up.` : `Tap to join room ${code} and play party games together. No sign-up.`;
  const q = new URLSearchParams();
  if (game) q.set("g", game);
  if (name) q.set("n", name);
  const image = `/og/invite?${q.toString()}`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function InvitePage({ params, searchParams }: Props) {
  const code = normalizeCode((await params).code);
  const { game } = inviteParams(await searchParams);
  const target = `/r/${code}${game ? `?game=${game}` : ""}`;
  return (
    <main className="grid flex-1 place-items-center p-6 text-center">
      {/* Straight on to the room (crawlers don't run scripts, so they keep the preview above). */}
      <script dangerouslySetInnerHTML={{ __html: `location.replace(${JSON.stringify(target)})` }} />
      <div>
        <Rux mood="grin" className="mx-auto w-24" />
        <p className="marker mt-3 text-2xl text-brand-2">aao aao! taking you to the room…</p>
        <a href={target} className="btn btn-primary mt-4">
          Join room {code}
        </a>
      </div>
    </main>
  );
}
