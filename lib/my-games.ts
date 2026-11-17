// Your favourite games and the ones you played lately, kept in this browser.
import { CATALOG_BY_ID } from "@/games/catalog";

const KEY = "ruckus:my-games";
const MAX_RECENT = 8;

export interface MyGames {
  favs: string[];
  /** Newest first. */
  recent: string[];
}

const EMPTY: MyGames = { favs: [], recent: [] };
let cache: MyGames | null = null;
const listeners = new Set<() => void>();

const valid = (ids: unknown): string[] =>
  Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && !!CATALOG_BY_ID[x]).slice(0, 60) : [];

export function readMyGames(): MyGames {
  if (cache) return cache;
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    cache = raw ? { favs: valid(raw.favs), recent: valid(raw.recent) } : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function save(next: MyGames) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* not saved: still works for this visit */
  }
  for (const fn of listeners) fn();
}

export function subscribeMyGames(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export const serverMyGames = () => EMPTY;

export function toggleFav(id: string) {
  const g = readMyGames();
  save({ ...g, favs: g.favs.includes(id) ? g.favs.filter((x) => x !== id) : [id, ...g.favs] });
}

/** Call when a game starts (in a room or solo). */
export function markPlayed(id: string) {
  if (!CATALOG_BY_ID[id]) return;
  const g = readMyGames();
  if (g.recent[0] === id) return;
  save({ ...g, recent: [id, ...g.recent.filter((x) => x !== id)].slice(0, MAX_RECENT) });
}
