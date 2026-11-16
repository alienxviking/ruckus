import { DoorOpen, PartyPopper, Send } from "lucide-react";
import { CATALOG } from "@/games/catalog";
import { GameBadge } from "@/components/GameBadge";
import { GameBrowser } from "@/components/GameBrowser";
import { HeroBackdrop } from "@/components/HeroBackdrop";
import { HomeActions } from "@/components/HomeActions";
import { Logo } from "@/components/Logo";

const STEPS = [
  { Icon: DoorOpen, title: "Make a room", text: "One tap. You get a short code and a link." },
  { Icon: Send, title: "Send the link", text: "Friends join from any phone or laptop. No app, no sign-up." },
  { Icon: PartyPopper, title: "Play together", text: "Pick a game, hit start. Everyone plays live, in sync." },
];

// A few game badges under the headline: a mix of genres.
const FEATURED_IDS = ["sketch", "barrage", "trivia", "sumo", "impostor", "market", "garble"];
const FEATURED = FEATURED_IDS.map((id) => CATALOG.find((g) => g.id === id)).filter((g) => g !== undefined);

const LINES = ["Make a room.", "Send the link.", "Cause a ruckus."];

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

          <section className="grid items-center gap-10 pt-8 pb-16 md:grid-cols-[1.25fr_1fr] md:pt-16 md:pb-24">
            <div>
              <p className="label animate-rise mb-6 flex items-center gap-2.5">
                <span className="relative flex size-2">
                  <span className="absolute inset-0 rounded-full bg-brand-2 motion-safe:animate-ping" />
                  <span className="relative size-2 rounded-full bg-brand-2" />
                </span>
                Real-time party games · 2–12 players
              </p>
              <h1 className="font-hero text-[2.1rem] leading-[1.02] font-extrabold tracking-[-0.025em] sm:text-5xl lg:text-[3.55rem]">
                {LINES.map((line, i) => (
                  <span key={line} className="animate-line block overflow-hidden pb-[0.08em]">
                    <span
                      className={i === LINES.length - 1 ? "text-brand-2" : undefined}
                      style={{ animationDelay: `${80 + i * 110}ms` }}
                    >
                      {line}
                    </span>
                  </span>
                ))}
              </h1>
              <p className="animate-rise mt-6 max-w-md text-lg text-muted" style={{ animationDelay: "420ms" }}>
                Draw, bluff, trade, race and brawl with 2–12 friends, right in the browser. On your phone or laptop.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-2 sm:gap-2.5" aria-hidden>
                {FEATURED.map((g, i) => (
                  <span key={g.id} className="animate-pop" style={{ animationDelay: `${520 + i * 60}ms` }}>
                    <span
                      className="animate-float block"
                      style={{ "--tilt": `${(i % 2 ? 1 : -1) * (2 + (i % 3))}deg`, animationDelay: `${-i * 0.8}s` } as React.CSSProperties}
                    >
                      <GameBadge id={g.id} accent={g.accent} size="sm" className="sm:size-11" />
                    </span>
                  </span>
                ))}
                <span
                  className="animate-pop ml-1 font-mono text-xs tracking-wider text-muted"
                  style={{ animationDelay: `${520 + FEATURED.length * 60}ms` }}
                >
                  +{CATALOG.length - FEATURED.length} more
                </span>
              </div>
            </div>
            <div className="animate-rise" style={{ animationDelay: "260ms" }}>
              <HomeActions />
            </div>
          </section>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <section aria-label="How it works" className="mb-20 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <div
              key={s.title}
              className="animate-rise flex items-start gap-4 bg-panel p-5"
              style={{ animationDelay: `${600 + i * 90}ms` }}
            >
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-ink text-brand-2"
              >
                <s.Icon className="size-[18px]" strokeWidth={1.75} />
              </span>
              <div>
                <div className="font-mono text-[11px] tracking-[0.14em] text-muted">0{i + 1}</div>
                <div className="mt-0.5 font-display text-lg font-bold">{s.title}</div>
                <p className="mt-0.5 text-sm text-muted">{s.text}</p>
              </div>
            </div>
          ))}
        </section>

        <section aria-labelledby="games-heading">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="label mb-2">The library</p>
              <h2 id="games-heading" className="font-hero text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">
                The games
              </h2>
            </div>
            <span className="hidden font-mono text-xs text-muted sm:block">
              {CATALOG.filter((g) => g.original).length} Ruckus originals
            </span>
          </div>
          <GameBrowser />
        </section>
      </div>
    </main>
  );
}
