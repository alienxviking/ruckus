import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { BackLink } from "@/components/play/BackLink";
import { DailyChallenge } from "@/components/daily/DailyChallenge";

export const metadata: Metadata = {
  title: "Daily challenge · Ruckus",
  description: "Three quick games, the same puzzles for everyone, new every day at midnight India time.",
};

export default function DailyPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-3 pb-16 sm:px-5">
      <header className="page-top flex items-center justify-between gap-3 py-3">
        <Logo small />
        <BackLink href="/">Home</BackLink>
      </header>
      <DailyChallenge />
    </main>
  );
}
