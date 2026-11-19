import Link from "next/link";
import { CATALOG, CATALOG_BY_ID } from "@/games/catalog";
import { CoverArt } from "@/components/CoverArt";
import { HeroBackdrop } from "@/components/HeroBackdrop";
import { HomeActions } from "@/components/HomeActions";
import { MeLink } from "@/components/home/MeLink";
import { Logo } from "@/components/Logo";
import { Rux } from "@/components/Rux";
import { DailySticker } from "@/components/home/DailySticker";
import { RuxIntro } from "@/components/home/RuxIntro";
import { HomeLibrary } from "@/components/home/HomeLibrary";
import { WhenIdle } from "@/components/home/WhenIdle";
import { InstallHint } from "@/components/home/InstallHint";
import { LOCAL_GAMES } from "@/lib/local-games";

const LOCAL_IDS = LOCAL_GAMES.map((g) => g.id);

// Cover stickers slapped around Rux in the hero: [id, position, tilt, delay].
const STAGE: [string, string, string, number][] = [
  ["sumo", "left-0 top-6 w-40 xl:w-48", "-9deg", 520],
  ["smuggle", "right-0 top-0 w-36 xl:w-44", "8deg", 600],
  ["tug", "left-6 bottom-2 w-36 xl:w-44", "6deg", 680],
  ["hotseat", "right-2 bottom-8 w-40 xl:w-48", "-7deg", 760],
];

export default function Home() {
  return (
    <main className="w-full overflow-x-clip pb-24">
      <RuxIntro />
      {/* The moving backdrop (glows, a perspective floor running at you) behind the top of the page. */}
      <div className="relative isolate">
        <HeroBackdrop />
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <header className="flex items-center justify-between gap-3 py-4">
          <Logo />
          <nav className="flex items-center gap-2 text-sm font-bold">
            <Link href="/play" className="btn border-2 px-3 py-1.5">
              Play solo
            </Link>
            <Link href="/daily" className="btn hidden border-2 px-3 py-1.5 sm:inline-flex">
              Daily
            </Link>
            <MeLink />
          </nav>
        </header>

        {/* ---------- hero ---------- */}
        <section className="after-intro relative grid items-center gap-8 pt-6 pb-14 md:grid-cols-[1.1fr_1fr] md:pt-10 md:pb-20">
          <div>
            <p className="marker slap mb-2 inline-block text-xl text-brand-2 sm:text-2xl" style={{ "--tilt": "-3deg" } as React.CSSProperties}>
              {CATALOG.length} games. zero sign-ups. full bawaal.
            </p>
            {/* The biggest text on first paint: no fade-in, so it paints immediately. */}
            {/* Phones: Rux peeks in beside the headline (the big stage is for wider screens). */}
            <span aria-hidden className="bob pointer-events-none absolute top-16 right-3 w-[5.5rem] md:hidden" style={{ "--tilt": "8deg" } as React.CSSProperties}>
              <Rux mood="wink" className="w-full" />
            </span>
            <h1 className="font-hero text-[3.4rem] leading-[0.88] font-extrabold tracking-[-0.045em] sm:text-7xl lg:text-[5.6rem]">
              Cause a{" "}
              <span className="relative inline-block text-brand-2">
                ruckus.
                <svg aria-hidden viewBox="0 0 300 24" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-4 w-full sm:h-5">
                  <path d="M4 16 C70 4 140 22 210 9 S285 8 296 13" fill="none" stroke="#ff4fa3" strokeWidth="7" strokeLinecap="round" />
                </svg>
              </span>
            </h1>
            <p className="mt-5 max-w-md text-base text-muted sm:mt-6 sm:text-lg">
              Party games right in the browser. Start a room, drop the link in the group chat, and let it get loud. No app, no
              login, no nonsense.
            </p>
            <div className="mt-6 sm:mt-7">
              <HomeActions />
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/play"
                className="stk lift slap flex items-center gap-3 px-4 py-3"
                style={{ "--stk-bg": "var(--color-blue)", "--stk-fg": "#fff", "--tilt": "-2deg", "--lift-tilt": "-3deg", animationDelay: "300ms" } as React.CSSProperties}
              >
                <span aria-hidden className="text-3xl leading-none">
                  🤖
                </span>
                <span>
                  <span className="block font-hero text-lg leading-tight font-extrabold">Play solo / vs bots</span>
                  <span className="block text-sm font-semibold opacity-85">{LOCAL_GAMES.length} games, start right now</span>
                </span>
              </Link>
              <DailySticker />
            </div>
          </div>

          {/* Rux on stage, surrounded by game stickers. Decorative. */}
          <div aria-hidden className="relative mx-auto hidden aspect-square w-full max-w-[30rem] md:block">
            {STAGE.map(([id, pos, tilt, delay]) => (
              <span key={id} className={`absolute ${pos} slap`} style={{ "--tilt": tilt, animationDelay: `${delay}ms` } as React.CSSProperties}>
                <CoverArt game={CATALOG_BY_ID[id]} className="rounded-2xl border-[3px] border-paper shadow-[5px_6px_0_rgb(0_0_0/0.55)]" />
              </span>
            ))}
            <div className="absolute inset-x-0 top-1/2 mx-auto w-[64%] -translate-y-1/2">
              <span className="bob block" style={{ "--tilt": "-4deg" } as React.CSSProperties}>
                <Rux mood="shout" megaphone className="w-full drop-shadow-[6px_8px_0_rgb(0_0_0/0.5)]" />
              </span>
              <span
                className="slap marker absolute -top-12 -left-6 rounded-2xl border-[3px] border-ink bg-paper px-3 py-1 text-2xl text-ink shadow-[4px_5px_0_#000]"
                style={{ "--tilt": "-6deg", animationDelay: "900ms" } as React.CSSProperties}
              >
                oye! game time 📣
              </span>
            </div>
          </div>
        </section>

      </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        {/* ---------- what to play ---------- */}
        {/* Below the fold and heavy (66 cards): built once the first screen has settled. */}
        <WhenIdle minHeight="220vh">
          <HomeLibrary localIds={LOCAL_IDS} />
        </WhenIdle>

        <InstallHint />
        <footer className="mt-20 flex flex-col items-center gap-2 text-center">
          <Rux mood="sleepy" className="h-20 w-16" />
          <p className="marker text-2xl text-muted">bas itna hi. ab jao, khelo.</p>
          <p className="text-xs text-muted">Free · no sign-up · made for friends</p>
          <Link href="/games" className="text-xs font-bold text-muted underline decoration-dotted underline-offset-4 hover:text-text">
            Browse all games
          </Link>
        </footer>
      </div>
    </main>
  );
}
