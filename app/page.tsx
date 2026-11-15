import { CATALOG } from "@/games/catalog";
import { GameCard } from "@/components/GameCard";
import { HomeActions } from "@/components/HomeActions";
import { Logo } from "@/components/Logo";

const STEPS = [
  { emoji: "🚪", title: "Make a room", text: "One tap. You get a short code and a link." },
  { emoji: "📲", title: "Send the link", text: "Friends join from any phone or laptop. No app, no sign-up." },
  { emoji: "🎉", title: "Play together", text: "Pick a game, hit start. Everyone plays live, in sync." },
];

// A few game icons drifting gently next to the headline.
const FLOATERS = CATALOG.slice(0, 7).map((g, i) => ({
  emoji: g.emoji,
  accent: g.accent,
  tilt: `${(i % 2 ? 1 : -1) * (4 + (i % 3) * 2)}deg`,
  delay: `${-i * 0.7}s`,
}));

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <Logo />
        <span className="text-sm text-muted">{CATALOG.length} games · no sign-up</span>
      </header>

      <section className="grid items-center gap-10 py-10 md:grid-cols-[1.2fr_1fr] md:py-16">
        <div className="animate-rise">
          <div className="mb-6 flex flex-wrap gap-2.5" aria-hidden>
            {FLOATERS.map((f) => (
              <span
                key={f.emoji}
                className="animate-float grid size-11 place-items-center rounded-xl text-xl sm:size-12 sm:text-2xl"
                style={
                  {
                    background: f.accent + "22",
                    boxShadow: `inset 0 0 0 1px ${f.accent}55`,
                    "--tilt": f.tilt,
                    animationDelay: f.delay,
                  } as React.CSSProperties
                }
              >
                {f.emoji}
              </span>
            ))}
          </div>
          <h1 className="font-display text-5xl leading-[1.02] font-extrabold tracking-tight sm:text-6xl">
            Make a room.
            <br />
            Send the link.
            <br />
            <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">Cause a ruckus.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-muted">
            Real-time party games for 2–12 friends, right in the browser. Draw, bluff, race and brawl, on your phone or
            laptop.
          </p>
        </div>
        <div className="animate-rise" style={{ animationDelay: "120ms" }}>
          <HomeActions />
        </div>
      </section>

      <section aria-label="How it works" className="mb-14 grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <div
            key={s.title}
            className="card animate-rise flex items-start gap-3 p-4"
            style={{ animationDelay: `${200 + i * 80}ms` }}
          >
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-panel-2 text-xl">
              {s.emoji}
            </span>
            <div>
              <div className="font-display font-bold">
                <span className="mr-1.5 text-brand">{i + 1}.</span>
                {s.title}
              </div>
              <p className="mt-0.5 text-sm text-muted">{s.text}</p>
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="games-heading">
        <h2 id="games-heading" className="mb-4 font-display text-2xl font-bold">
          The games
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CATALOG.map((g, i) => (
            <GameCard key={g.id} game={g} index={i} />
          ))}
        </div>
      </section>
    </main>
  );
}
