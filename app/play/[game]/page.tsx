import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CATALOG_BY_ID } from "@/games/catalog";
import { Logo } from "@/components/Logo";
import { BackLink } from "@/components/play/BackLink";
import { LocalPlay } from "@/components/play/LocalPlay";
import { canPlayLocal, LOCAL_GAMES } from "@/lib/local-games";

// Every locally playable game is prerendered: the page is static, the game runs in the browser.
export function generateStaticParams() {
  return LOCAL_GAMES.map((g) => ({ game: g.id }));
}

export async function generateMetadata({ params }: PageProps<"/play/[game]">): Promise<Metadata> {
  const { game } = await params;
  const meta = CATALOG_BY_ID[game];
  return meta
    ? { title: `${meta.name} · Play solo · Ruckus`, description: `${meta.tagline} Play it now, solo or against bots.` }
    : {};
}

export default function PlayGame({ params }: PageProps<"/play/[game]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-3 pb-16 sm:px-5">
      <header className="page-top flex items-center justify-between gap-3 py-3">
        <Logo small />
        <BackLink href="/play">All games</BackLink>
      </header>
      <Suspense fallback={<div className="card mx-auto h-72 w-full max-w-3xl animate-pulse" />}>
        <Game params={params} />
      </Suspense>
    </main>
  );
}

async function Game({ params }: Pick<PageProps<"/play/[game]">, "params">) {
  const { game } = await params;
  if (!canPlayLocal(game)) notFound();
  return <LocalPlay gameId={game} />;
}
