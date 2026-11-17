import { CATEGORY_LABEL, type GameMeta } from "@/games/catalog";

/** Search words from what someone typed (lowercase, split on spaces). */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when every term appears in the game's name, tagline, type, how-to or who it's for. */
export function matchesSearch(g: GameMeta, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = [
    g.name,
    g.tagline,
    CATEGORY_LABEL[g.category],
    g.teams ? "teams team" : "",
    g.call ? "call zoom meet video" : "",
    g.minPlayers === 1 ? "solo single 1 player" : "",
    g.maxPlayers <= 2 ? "2 player two duo 1v1" : "",
    ...g.how,
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((t) => hay.includes(t));
}
