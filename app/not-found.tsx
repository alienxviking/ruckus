import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Gamepad2, House } from "lucide-react";
import { CATALOG_BY_ID } from "@/games/catalog";
import { CoverArt } from "@/components/CoverArt";
import { Logo } from "@/components/Logo";
import { Rux } from "@/components/Rux";

// Every unknown URL (and a game that doesn't exist) lands here. Same vibe as the rest:
// Rux plays the zero, a Hinglish shrug, and a few games to get people playing anyway.
export const metadata: Metadata = {
  title: "Page not found · Ruckus",
  description: "That page doesn't exist. Start a room, or jump into one of 50 party games.",
};

// Stickers for "play one of these instead": [id, tilt].
const PICKS: [string, string][] = [
  ["snakes", "-6deg"],
  ["sketch", "4deg"],
  ["sumo", "-3deg"],
];

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-20 sm:px-6">
      <header className="flex items-center justify-between gap-3 py-4">
        <Logo />
        <Link href="/games" className="btn border-2 px-3 py-1.5 text-sm font-bold">
          All games
        </Link>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center pt-6 text-center sm:pt-10">
        <p className="marker slap mb-6 text-xl text-brand-2 sm:text-2xl" style={{ "--tilt": "-3deg" } as React.CSSProperties}>
          arre! ye page toh gayab hai 👀
        </p>

        {/* 4 · Rux · 4: Rux stands in for the zero. */}
        <h1 aria-label="404" className="flex items-center justify-center gap-1 font-hero leading-none font-extrabold tracking-[-0.06em] sm:gap-3">
          <span aria-hidden className="slap text-[8.5rem] sm:text-[12rem]" style={{ "--tilt": "-8deg" } as React.CSSProperties}>
            4
          </span>
          <span aria-hidden className="bob w-[7.5rem] sm:w-[10.5rem]" style={{ "--tilt": "6deg" } as React.CSSProperties}>
            <Rux mood="wow" className="w-full drop-shadow-[6px_8px_0_rgb(0_0_0/0.5)]" />
          </span>
          <span aria-hidden className="slap text-[8.5rem] text-brand-2 sm:text-[12rem]" style={{ "--tilt": "7deg", animationDelay: "120ms" } as React.CSSProperties}>
            4
          </span>
        </h1>

        <p className="mt-4 max-w-md text-base text-muted sm:text-lg">
          This page doesn&apos;t exist. Maybe the link is old, or a typo sneaked in. Rux checked everywhere, promise.
        </p>

        <div className="mt-7 flex w-full max-w-md flex-col gap-3 sm:flex-row">
          <Link href="/" className="stk-btn flex flex-1 items-center justify-center gap-2 px-5 py-3 text-lg">
            <House aria-hidden className="size-5" strokeWidth={2.4} />
            Take me home
          </Link>
          <Link href="/play" className="btn flex flex-1 items-center justify-center gap-2 px-5 py-3 font-bold">
            <Gamepad2 aria-hidden className="size-5" strokeWidth={2.2} />
            Play solo
          </Link>
        </div>
      </section>

      <section className="mt-16">
        <p className="marker text-center text-xl text-muted">ya phir, seedha khelo:</p>
        <ul className="mx-auto mt-5 grid max-w-3xl grid-cols-3 gap-3 sm:gap-5">
          {PICKS.map(([id, tilt], i) => {
            const game = CATALOG_BY_ID[id];
            if (!game) return null;
            return (
              <li key={id} className="min-w-0">
                <Link
                  href={`/games/${id}`}
                  className="lift slap group block"
                  style={{ "--tilt": tilt, "--lift-tilt": "0deg", animationDelay: `${300 + i * 90}ms` } as React.CSSProperties}
                >
                  <CoverArt game={game} className="rounded-2xl border-[3px] border-paper shadow-[5px_6px_0_rgb(0_0_0/0.55)]" />
                  <span className="mt-2 flex items-center justify-center gap-1 text-xs font-bold sm:text-sm text-muted group-hover:text-text">
                    {game.name} <ArrowRight aria-hidden className="size-3.5" strokeWidth={2.5} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
