import Link from "next/link";
import { notFound } from "next/navigation";
import { CATALOG } from "@/games/catalog";

export const metadata = { title: "Simulator · Ruckus", robots: { index: false } };

export default function DevIndex() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="font-display text-3xl font-bold">Game simulator</h1>
      <p className="mt-1 mb-6 text-muted">
        Runs a game&apos;s server logic in this tab with fake players, every player&apos;s screen side by side.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {CATALOG.map((g) => (
          <li key={g.id}>
            <Link className="card flex items-center gap-3 p-3 hover:bg-panel-2" href={`/dev/${g.id}`}>
              <span className="text-2xl">{g.emoji}</span>
              <span className="font-semibold">{g.name}</span>
              <span className="ml-auto text-xs text-muted">/dev/{g.id}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
