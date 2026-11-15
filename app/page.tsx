import { CATALOG } from "@/games/catalog";
import { GameCard } from "@/components/GameCard";
import { HomeActions } from "@/components/HomeActions";
import { Logo } from "@/components/Logo";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <Logo />
        <span className="text-sm text-muted">{CATALOG.length} games · no sign-up</span>
      </header>

      <section className="grid items-center gap-10 py-10 md:grid-cols-[1.2fr_1fr] md:py-16">
        <div>
          <h1 className="font-display text-5xl leading-[1.02] font-extrabold tracking-tight sm:text-6xl">
            Make a room.
            <br />
            Send the link.
            <br />
            <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">
              Cause a ruckus.
            </span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-muted">
            Real-time party games for 2–12 friends, right in the browser. Draw, bluff, race and brawl,
            on your phone or laptop.
          </p>
        </div>
        <HomeActions />
      </section>

      <section aria-labelledby="games-heading">
        <h2 id="games-heading" className="mb-4 font-display text-2xl font-bold">
          The games
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CATALOG.map((g) => (
            <GameCard key={g.id} game={g} />
          ))}
        </div>
      </section>
    </main>
  );
}
