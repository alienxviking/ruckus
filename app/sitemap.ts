import type { MetadataRoute } from "next";
import { CATALOG } from "@/games/catalog";
import { LOCAL_GAMES } from "@/lib/local-games";
import { SITE_URL } from "@/lib/site";

// Every public page: home, the game pages (one per game) and the solo versions.
export default function sitemap(): MetadataRoute.Sitemap {
  const url = (path: string) => `${SITE_URL}${path}`;
  return [
    { url: url("/"), changeFrequency: "weekly", priority: 1 },
    { url: url("/games"), changeFrequency: "weekly", priority: 0.9 },
    { url: url("/play"), changeFrequency: "weekly", priority: 0.7 },
    { url: url("/daily"), changeFrequency: "daily", priority: 0.6 },
    ...CATALOG.map((g) => ({ url: url(`/games/${g.id}`), changeFrequency: "monthly" as const, priority: 0.8 })),
    ...LOCAL_GAMES.map((g) => ({ url: url(`/play/${g.id}`), changeFrequency: "monthly" as const, priority: 0.5 })),
  ];
}
