import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CATALOG_BY_ID } from "@/games/catalog";
import { Simulator } from "@/components/dev/Simulator";

export const metadata: Metadata = { title: "Simulator · Ruckus", robots: { index: false } };

// Dev-only tool: hidden in production builds.
export default function SimPage({ params, searchParams }: PageProps<"/dev/[game]">) {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <SimFromParams params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function SimFromParams({ params, searchParams }: Pick<PageProps<"/dev/[game]">, "params" | "searchParams">) {
  const { game } = await params;
  const sp = await searchParams;
  const meta = CATALOG_BY_ID[game];
  if (!meta) notFound();
  const requested = Number(Array.isArray(sp.n) ? sp.n[0] : sp.n);
  const n = Number.isFinite(requested)
    ? Math.min(meta.maxPlayers, Math.max(meta.minPlayers, Math.round(requested)))
    : Math.min(meta.maxPlayers, Math.max(meta.minPlayers, 3));
  return <Simulator gameId={game} initialPlayers={n} />;
}
