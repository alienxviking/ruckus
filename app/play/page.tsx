import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
import { PlayShelves } from "@/components/play/PlayShelves";
import { Rux } from "@/components/Rux";
import { Logo } from "@/components/Logo";
import { BackLink } from "@/components/play/BackLink";

export const metadata: Metadata = {
  title: "Play solo or vs bots · Ruckus",
  description: "No room needed: play Ruckus games on your own or against practice bots, right in the browser.",
};


export default function PlayIndex() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <Logo />
        <BackLink href="/">Home</BackLink>
      </header>

      <section className="relative pt-4 pb-8 sm:pt-8">
        <span aria-hidden className="bob absolute top-2 right-2 hidden w-28 sm:block" style={{ "--tilt": "8deg" } as React.CSSProperties}>
          <Rux mood="wink" className="w-full" />
        </span>
        <p className="marker slap mb-2 inline-block text-2xl text-brand-2" style={{ "--tilt": "-3deg" } as React.CSSProperties}>
          no room. no waiting. bas khelo.
        </p>
        <h1 className="animate-rise font-hero text-5xl leading-[0.9] font-extrabold tracking-[-0.04em] sm:text-7xl">
          Play <span className="text-brand-2">right now.</span>
        </h1>
        <p className="animate-rise mt-4 max-w-xl text-muted" style={{ animationDelay: "80ms" }}>
          Pick a game and play it on your own, or against practice bots. Everything runs in your browser. When your
          friends show up, take the same game to a room.
        </p>
        <Link
          href="/daily"
          className="stk lift slap group mt-6 flex items-center gap-3 p-4 sm:max-w-md"
          style={{ "--stk-bg": "var(--color-pink)", "--stk-fg": "#14101f", "--tilt": "-1.5deg", animationDelay: "140ms" } as React.CSSProperties}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-ink text-brand-2">
            <CalendarDays aria-hidden className="size-5" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-hero text-lg font-extrabold">Daily challenge</span>
            <span className="block text-sm font-semibold text-ink/75">3 games, same puzzles for everyone, new every day.</span>
          </span>
          <ChevronRight aria-hidden className="size-5 text-ink/70 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </section>

      <PlayShelves />
    </main>
  );
}
