import Link from "next/link";
import { ArrowRight, Bot, CalendarDays, Users } from "lucide-react";
import type { ReactNode } from "react";
import { CATALOG } from "@/games/catalog";
import { GameBadge } from "@/components/GameBadge";
import { HeroBackdrop } from "@/components/HeroBackdrop";
import { HomeActions } from "@/components/HomeActions";
import { Logo } from "@/components/Logo";
import { DailyCard } from "@/components/home/DailyCard";
import { HomeGames } from "@/components/home/HomeGames";
import { LOCAL_GAMES } from "@/lib/local-games";

// Under the headline: a mix of genres.
const FEATURED_IDS = ["sketch", "barrage", "trivia", "sumo", "impostor", "market", "garble"];
const FEATURED = FEATURED_IDS.map((id) => CATALOG.find((g) => g.id === id)).filter((g) => g !== undefined);
// On the solo card: games that play well on your own or against bots.
const SOLO_IDS = ["trivia", "minerush", "sumo", "tictactoe", "snakes"];
const SOLO_PICKS = SOLO_IDS.map((id) => LOCAL_GAMES.find((g) => g.id === id)).filter((g) => g !== undefined);
const LOCAL_IDS = LOCAL_GAMES.map((g) => g.id);

const LINES = ["Grab your friends.", "Or don't.", "Cause a ruckus."];

export default function Home() {
  return (
    <main className="w-full pb-24">
      <div className="relative isolate">
        <HeroBackdrop />
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <header className="flex items-center justify-between py-5">
            <Logo />
            <span className="label hidden items-center gap-2 sm:flex">
              <span className="text-text">{CATALOG.length}</span> games
              <span className="text-line">/</span> no sign-up
              <span className="text-line">/</span> free
            </span>
          </header>

          <section className="pt-6 pb-10 md:pt-12 md:pb-14">
            <p className="label animate-rise mb-5 flex items-center gap-2.5">
              <span className="relative flex size-2">
                <span className="absolute inset-0 rounded-full bg-brand-2 motion-safe:animate-ping" />
                <span className="relative size-2 rounded-full bg-brand-2" />
              </span>
              Real-time party games · 1–12 players
            </p>
            <div className="grid items-end gap-6 md:grid-cols-[1.3fr_1fr]">
              <h1 className="font-hero text-[2.1rem] leading-[1.02] font-extrabold tracking-[-0.025em] sm:text-5xl lg:text-[3.4rem]">
                {LINES.map((line, i) => (
                  <span key={line} className="animate-line block overflow-hidden pb-[0.08em]">
                    <span
                      className={i === LINES.length - 1 ? "text-brand-2" : i === 1 ? "text-muted" : undefined}
                      style={{ animationDelay: `${80 + i * 110}ms` }}
                    >
                      {line}
                    </span>
                  </span>
                ))}
              </h1>
              <div>
                {/* No fade-in: this is the biggest text on first paint (the LCP element). */}
                <p className="max-w-md text-lg text-muted">
                  {CATALOG.length} games in the browser. Start a room for friends, play solo against bots, or take on
                  today&apos;s daily challenge. Nothing to install.
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-2" aria-hidden>
                  {FEATURED.map((g, i) => (
                    <span key={g.id} className="animate-pop" style={{ animationDelay: `${480 + i * 60}ms` }}>
                      <span
                        className="animate-float block"
                        style={{ "--tilt": `${(i % 2 ? 1 : -1) * (2 + (i % 3))}deg`, animationDelay: `${-i * 0.8}s` } as React.CSSProperties}
                      >
                        <GameBadge id={g.id} accent={g.accent} size="sm" />
                      </span>
                    </span>
                  ))}
                  <span
                    className="animate-pop ml-1 font-mono text-xs tracking-wider text-muted"
                    style={{ animationDelay: `${480 + FEATURED.length * 60}ms` }}
                  >
                    +{CATALOG.length - FEATURED.length} more
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section aria-label="Ways to play" className="grid gap-3 pb-20 md:grid-cols-3">
            <Path
              n={1}
              Icon={Users}
              title="Play with friends"
              text="Make a room, send the link. 2–12 players, any phone or laptop."
              accent="var(--color-volt)"
              delay={420}
              glass
            >
              <HomeActions />
            </Path>

            <Path
              n={2}
              Icon={Bot}
              title="Play solo / vs bots"
              text={`No room, no waiting: ${LOCAL_GAMES.length} games you can start right now.`}
              accent="var(--color-cyan)"
              delay={500}
            >
              <div className="flex flex-1 flex-col">
                <div className="flex items-center gap-2" aria-hidden>
                  {SOLO_PICKS.map((g, i) => (
                    // Popping in (not painted in the first frame) keeps first paint fast.
                    <span key={g.id} className="animate-pop" style={{ animationDelay: `${600 + i * 60}ms` }}>
                      <GameBadge id={g.id} accent={g.accent} size="md" />
                    </span>
                  ))}
                </div>
                <p className="mt-3 min-h-[2.5rem] font-mono text-[11px] leading-5 text-muted">
                  Trivia, Mine Rush, Sumo and more.
                  <br />
                  Practice bots fill the empty seats.
                </p>
                <Link href="/play" className="btn mt-auto w-full py-3">
                  Pick a game
                  <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
                </Link>
              </div>
            </Path>

            <Path
              n={3}
              Icon={CalendarDays}
              title="Daily challenge"
              text="Three quick games, the same puzzles for everyone. Keep your streak."
              accent="var(--color-brand)"
              delay={580}
            >
              <DailyCard />
            </Path>
          </section>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <section aria-labelledby="games-heading">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="label mb-2">The library</p>
              <h2 id="games-heading" className="font-hero text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">
                The games
              </h2>
              <p className="mt-1 text-sm text-muted">Tap one to play it solo or with friends.</p>
            </div>
            <span className="hidden font-mono text-xs text-muted sm:block">
              {CATALOG.filter((g) => g.original).length} Ruckus originals
            </span>
          </div>
          <HomeGames localIds={LOCAL_IDS} />
        </section>
      </div>
    </main>
  );
}

function Path({
  n,
  Icon,
  title,
  text,
  accent,
  delay,
  glass,
  children,
}: {
  n: number;
  Icon: typeof Users;
  title: string;
  text: string;
  accent: string;
  delay: number;
  glass?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`${glass ? "glass" : "card"} lit-edge animate-rise flex flex-col p-5`}
      style={{ "--accent": accent, animationDelay: `${delay}ms` } as React.CSSProperties}
    >
      <div className="mb-4 flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-ink"
          style={{ color: accent }}
        >
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <div className="font-mono text-[11px] tracking-[0.14em] text-muted">0{n}</div>
          <h2 className="font-display text-xl leading-tight font-bold">{title}</h2>
        </div>
      </div>
      <p className="mb-4 text-sm text-muted">{text}</p>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
