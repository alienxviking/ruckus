import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Gamepad2, Keyboard, Smartphone, Trophy, User, Users } from "lucide-react";
import { CATALOG, CATALOG_BY_ID, CATEGORY_LABEL, type GameMeta } from "@/games/catalog";
import { RULES } from "@/games/rules";
import { RULE_ICONS } from "@/games/rule-icons";
import { CoverArt } from "@/components/CoverArt";
import { GameBadge } from "@/components/GameBadge";
import { Logo } from "@/components/Logo";
import { BackLink } from "@/components/play/BackLink";
import { FriendsButton } from "@/components/play/FriendsButton";
import { canPlayLocal } from "@/lib/local-games";
import { SITE_URL } from "@/lib/site";

// One page per game, for people (and search engines) looking for a game to play with friends.
export function generateStaticParams() {
  return CATALOG.map((g) => ({ game: g.id }));
}

const KIND: Record<GameMeta["category"], string> = {
  party: "party game",
  board: "board game",
  arena: "real-time action game",
  brain: "brain game",
};

const players = (g: GameMeta) => (g.minPlayers === g.maxPlayers ? `${g.minPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`);

function intro(g: GameMeta) {
  return `${g.name} is a free online ${KIND[g.category]} for ${players(g)}. Make a room, send the link, and everyone plays from their own phone or laptop. No app, no sign-up.`;
}

export async function generateMetadata({ params }: PageProps<"/games/[game]">): Promise<Metadata> {
  const { game } = await params;
  const g = CATALOG_BY_ID[game];
  if (!g) return {};
  return {
    title: `${g.name}: play online with friends, free · Ruckus`,
    description: `${g.tagline} ${intro(g)}`,
    alternates: { canonical: `/games/${g.id}` },
  };
}

export default function GamePage({ params }: PageProps<"/games/[game]">) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-24 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <Logo small />
        <BackLink href="/games">All games</BackLink>
      </header>
      <Suspense fallback={<div className="card h-72 w-full animate-pulse" />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}

async function Body({ params }: Pick<PageProps<"/games/[game]">, "params">) {
  const { game } = await params;
  const g = CATALOG_BY_ID[game];
  if (!g) notFound();
  const rules = (await RULES[g.id]?.())?.rules;
  const solo = canPlayLocal(g.id);
  const more = [
    ...CATALOG.filter((x) => x.category === g.category && x.id !== g.id),
    ...CATALOG.filter((x) => x.category !== g.category),
  ].slice(0, 6);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: g.name,
    description: `${g.tagline} ${intro(g)}`,
    url: `${SITE_URL}/games/${g.id}`,
    genre: CATEGORY_LABEL[g.category],
    gamePlatform: "Web browser",
    applicationCategory: "Game",
    playMode: g.maxPlayers > 1 ? "MultiPlayer" : "SinglePlayer",
    numberOfPlayers: { "@type": "QuantitativeValue", minValue: g.minPlayers, maxValue: g.maxPlayers },
    offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
  };

  return (
    <article style={{ "--accent": g.accent } as React.CSSProperties}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      <section className="animate-rise grid items-center gap-6 sm:grid-cols-[auto_1fr]">
        <span className="slap w-44 sm:w-56" style={{ "--tilt": "-4deg" } as React.CSSProperties}>
          <CoverArt game={g} className="rounded-xl border-[3px] border-paper shadow-[5px_6px_0_rgb(0_0_0/0.55)]" />
        </span>
        <div className="min-w-0">
          <p className="marker text-xl leading-none" style={{ color: g.accent }}>
            free · no sign-up
          </p>
          <h1 className="mt-1 font-hero text-4xl leading-[0.95] font-extrabold tracking-[-0.03em] sm:text-6xl">{g.name}</h1>
          <p className="mt-2 text-lg font-semibold text-text/90">{g.tagline}</p>
          <ul className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
            <Chip Icon={Users}>{players(g)}</Chip>
            <Chip Icon={Clock}>~{g.minutes} min</Chip>
            <Chip Icon={Gamepad2}>{CATEGORY_LABEL[g.category]}</Chip>
          </ul>
        </div>
      </section>

      <p className="mt-6 max-w-2xl text-muted">{intro(g)}</p>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-start">
        <FriendsButton gameId={g.id} className="btn-primary min-h-12 w-full px-6 text-lg font-bold sm:w-auto" />
        {solo && (
          <Link href={`/play/${g.id}`} className="btn min-h-12 justify-center px-5">
            <User aria-hidden className="size-4" strokeWidth={2} />
            {g.minPlayers <= 1 ? "Play solo now" : "Try it vs bots"}
          </Link>
        )}
      </div>

      {rules ? (
        <>
          <h2 className="label mt-10 mb-3">How to play</h2>
          <ol className="grid gap-2 sm:grid-cols-3">
            {rules.quick.map((c, i) => {
              const Icon = RULE_ICONS[c.icon] ?? RULE_ICONS.sparkles;
              return (
                <li key={i} className="flex items-center gap-3 rounded-xl border-2 border-line bg-panel/70 p-3 sm:flex-col sm:text-center">
                  <span
                    aria-hidden
                    className="grid size-12 shrink-0 place-items-center rounded-xl border-2 border-ink text-ink shadow-[2px_3px_0_rgb(0_0_0/0.5)]"
                    style={{ background: g.accent, transform: `rotate(${[-5, 4, -3][i]}deg)` }}
                  >
                    <Icon className="size-6" strokeWidth={2.25} />
                  </span>
                  <span className="text-sm font-semibold">
                    <span className="mr-1.5 font-mono text-[11px] font-bold" style={{ color: g.accent }}>
                      {i + 1}
                    </span>
                    {c.text}
                  </span>
                </li>
              );
            })}
          </ol>
          <p
            className="mt-3 flex items-center gap-2.5 rounded-xl border-2 px-3 py-2 text-sm font-bold"
            style={{ borderColor: g.accent + "66", background: g.accent + "14" }}
          >
            <Trophy aria-hidden className="size-5 shrink-0" style={{ color: g.accent }} strokeWidth={2.25} />
            {rules.win}
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <Section title="The goal">
              <p>{rules.goal}</p>
            </Section>
            <Section title="How a game goes">
              <ol className="list-decimal space-y-1 pl-5">
                {rules.flow.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ol>
            </Section>
            <Section title="Scoring and winning">
              <ul className="list-disc space-y-1 pl-5">
                {rules.scoring.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </Section>
            {rules.controls.touch?.length || rules.controls.desktop?.length ? (
              <Section title="Controls">
                {rules.controls.touch?.length ? (
                  <p className="flex gap-2">
                    <Smartphone aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} /> {rules.controls.touch.join(" ")}
                  </p>
                ) : null}
                {rules.controls.desktop?.length ? (
                  <p className="mt-2 flex gap-2">
                    <Keyboard aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} /> {rules.controls.desktop.join(" ")}
                  </p>
                ) : null}
              </Section>
            ) : null}
            {rules.tips?.length ? (
              <Section title="Tips">
                <ul className="list-disc space-y-1 pl-5">
                  {rules.tips.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </Section>
            ) : null}
          </div>
        </>
      ) : (
        <ol className="mt-8 list-decimal space-y-1 pl-5 text-sm">
          {g.how.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ol>
      )}

      <h2 className="label mt-12 mb-3">More games to play with friends</h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
        {more.map((x) => (
          <li key={x.id} className="min-w-0">
            <Link href={`/games/${x.id}`} className="badge-trigger card lift flex items-center gap-3 p-3">
              <GameBadge id={x.id} accent={x.accent} size="sm" />
              <span className="min-w-0">
                <span className="block truncate font-display font-bold">{x.name}</span>
                <span className="block truncate text-xs text-muted">{x.tagline}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}

function Chip({ Icon, children }: { Icon: typeof Users; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5 rounded-full border-2 border-line bg-panel px-2.5 py-1">
      <Icon aria-hidden className="size-3.5" strokeWidth={2.25} style={{ color: "var(--accent)" }} />
      {children}
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="text-sm leading-relaxed text-text/90">
      <h3 className="mb-2 font-display text-lg font-bold">{title}</h3>
      {children}
    </section>
  );
}
