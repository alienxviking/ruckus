import type { Metadata } from "next";
import Link from "next/link";
import { CATALOG, CATEGORY_LABEL, type GameCategory } from "@/games/catalog";
import { GameBadge } from "@/components/GameBadge";
import { Logo } from "@/components/Logo";
import { BackLink } from "@/components/play/BackLink";

export const metadata: Metadata = {
  title: `All ${CATALOG.length} games · Ruckus`,
  description: `${CATALOG.length} free online party, board, brain and real-time games to play with friends in the browser. Make a room, share the link, no sign-up.`,
  alternates: { canonical: "/games" },
};

const ORDER: GameCategory[] = ["party", "brain", "board", "arena"];

export default function GamesIndex() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <Logo />
        <BackLink href="/">Home</BackLink>
      </header>
      <h1 className="animate-rise font-hero text-4xl leading-[0.95] font-extrabold tracking-[-0.03em] sm:text-6xl">
        All <span className="text-brand-2">{CATALOG.length}</span> games
      </h1>
      <p className="mt-3 max-w-xl text-muted">
        Free games to play with friends online. Pick one, make a room, send the link. Everyone joins from their phone.
      </p>
      {ORDER.map((c) => {
        const games = CATALOG.filter((g) => g.category === c);
        if (!games.length) return null;
        return (
          <section key={c} className="mt-10">
            <h2 className="label mb-3">
              {CATEGORY_LABEL[c]} games · {games.length}
            </h2>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {games.map((g) => (
                <li key={g.id} className="min-w-0">
                  <Link href={`/games/${g.id}`} className="badge-trigger card lift flex items-center gap-3 p-3">
                    <GameBadge id={g.id} accent={g.accent} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display font-bold">{g.name}</span>
                      <span className="block truncate text-xs text-muted">{g.tagline}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted">
                      {g.minPlayers}–{g.maxPlayers}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
