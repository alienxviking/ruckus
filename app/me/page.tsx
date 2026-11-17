import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { BackLink } from "@/components/play/BackLink";
import { MePage } from "@/components/me/MePage";

export const metadata: Metadata = {
  title: "Your profile · Ruckus",
  robots: { index: false, follow: false },
};

export default function Me() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 sm:px-6">
      <header className="flex items-center justify-between py-4">
        <Logo />
        <BackLink href="/">Home</BackLink>
      </header>
      <MePage />
    </main>
  );
}
