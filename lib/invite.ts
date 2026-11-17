// Invite links: /i/CODE?g=<game>&n=<name>. The page carries a rich preview (the game's poster,
// "<name> invited you") and sends people straight on to the room.
import { CATALOG_BY_ID } from "@/games/catalog";

/** Cleans the query: a known game id and a short plain name, or nothing. */
export function inviteParams(q: URLSearchParams | Record<string, string | string[] | undefined>) {
  const get = (k: string) => {
    const v = q instanceof URLSearchParams ? q.get(k) : q[k];
    return Array.isArray(v) ? v[0] : (v ?? undefined);
  };
  const g = get("g");
  const n = get("n");
  return {
    game: g && CATALOG_BY_ID[g] ? g : undefined,
    name:
      n
        ?.replace(/[^\p{L}\p{N} _.'-]/gu, "")
        .trim()
        .slice(0, 16) || undefined,
  };
}

/** The link to share for a room. */
export function inviteUrl(origin: string, code: string, gameId?: string, name?: string): string {
  const q = new URLSearchParams();
  if (gameId) q.set("g", gameId);
  if (name) q.set("n", name.slice(0, 16));
  const qs = q.toString();
  return `${origin}/i/${code}${qs ? `?${qs}` : ""}`;
}
