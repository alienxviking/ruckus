import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
import type { GameMeta } from "@/games/catalog";
import { GameCard } from "@/components/GameCard";
import { Logo } from "@/components/Logo";
import { BackLink } from "@/components/play/BackLink";
import { LOCAL_GAMES } from "@/lib/local-games";

export const metadata: Metadata = {
  title: "Play solo or vs bots · Ruckus",
  description: "No room needed: play Ruckus games on your own or against practice bots, right in the browser.",
};

const SOLO = LOCAL_GAMES.filter((g) => g.minPlayers <= 1);
const BOTS = LOCAL_GAMES.filter((g) => g.minPlayers > 1);

export default function PlayIndex() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <Logo />
        <BackLink href="/">Home</BackLink>
      </header>

      <section className="pt-4 pb-8 sm:pt-8">
        <p className="label animate-rise mb-3">No room · no waiting · no sign-up</p>
        <h1 className="animate-rise font-hero text-3xl leading-[1.05] font-extrabold tracking-[-0.03em] sm:text-5xl">
          Play <span className="text-brand-2">right now.</span>
        </h1>
        <p className="animate-rise mt-4 max-w-xl text-muted" style={{ animationDelay: "80ms" }}>
          Pick a game and play it on your own, or against practice bots. Everything runs in your browser. When your
          friends show up, take the same game to a room.
        </p>
        <Link
          href="/daily"
          className="card lit-edge animate-rise group mt-6 flex items-center gap-3 p-4 hover:bg-panel-2 sm:max-w-md"
          style={{ animationDelay: "140ms" }}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-ink text-brand-2">
            <CalendarDays aria-hidden className="size-5" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg font-bold">Daily challenge</span>
            <span className="block text-sm text-muted">3 games, same puzzles for everyone, new every day.</span>
          </span>
          <ChevronRight aria-hidden className="size-5 text-muted transition-transform group-hover:translate-x-0.5" />
        </Link>
      </section>

      <Shelf id="solo" title="Solo" sub="Just you against the clock (bots optional where they fit)." games={SOLO} />
      <Shelf id="bots" title="You vs bots" sub="Practice bots fill the other seats." games={BOTS} />
    </main>
  );
}

function Shelf({ id, title, sub, games }: { id: string; title: string; sub: string; games: GameMeta[] }) {
  if (!games.length) return null;
  return (
    <section aria-labelledby={`${id}-heading`} className="mb-12">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 id={`${id}-heading`} className="font-hero text-xl font-extrabold tracking-[-0.03em] sm:text-2xl">
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted">{sub}</p>
        </div>
        <span className="font-mono text-xs text-muted">{games.length} games</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((g, i) => (
          <li key={g.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
            <Link href={`/play/${g.id}`} className="badge-trigger block h-full rounded-[0.7rem]" aria-label={`Play ${g.name}`}>
              <GameCard game={g} index={i} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
