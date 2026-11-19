// Progress across every room, kept in this browser: wins and achievements unlock accessories.
// Cosmetic only, so a local record is enough (nothing to cheat for). A transfer code moves it
// to another device without accounts.

import { CATALOG_BY_ID, type GameCategory } from "@/games/catalog";
import type { AccessoryId } from "@/shared/types";
import { currentStreak, dailyDay, exportDaily, mergeDaily, subscribeDaily } from "./daily";

const KEY = "ruckus:progress";
const OLD_KEY = "ruckus:wins";

export interface Progress {
  v: 1;
  /** Games won (with at least one other person playing). */
  wins: number;
  /** Wins per game id, and games played per game id. */
  gameWins: Record<string, number>;
  played: Record<string, number>;
  /** Current and best run of wins in a row. */
  run: number;
  bestRun: number;
  /** Wins in games with 6+ people. */
  bigWins: number;
}

const EMPTY: Progress = { v: 1, wins: 0, gameWins: {}, played: {}, run: 0, bestRun: 0, bigWins: 0 };

/** Wins needed for each accessory that unlocks by winning (0 = free from the start). */
export const UNLOCK_AT: Partial<Record<AccessoryId, number>> = {
  cap: 0,
  beanie: 0,
  shades: 0,
  bow: 0,
  flower: 0,
  headphones: 0,
  party: 1,
  horns: 2,
  halo: 3,
  tophat: 5,
  wizard: 8,
  crown: 12,
};

const winsIn = (p: Progress, cat: GameCategory) =>
  Object.entries(p.gameWins).reduce((n, [id, w]) => n + (CATALOG_BY_ID[id]?.category === cat ? w : 0), 0);
const teamWins = (p: Progress) => Object.entries(p.gameWins).reduce((n, [id, w]) => n + (CATALOG_BY_ID[id]?.teams ? w : 0), 0);

export interface Achievement {
  id: string;
  title: string;
  /** How to earn it, shown on the locked accessory. */
  how: string;
  accessory: AccessoryId;
  /** Progress towards it: [done, needed]. */
  progress: (p: Progress) => [number, number];
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "hattrick", title: "Hat trick", how: "Win 3 games in a row", accessory: "laurel", progress: (p) => [p.bestRun, 3] },
  { id: "allrounder", title: "All-rounder", how: "Win 5 different games", accessory: "chef", progress: (p) => [Object.values(p.gameWins).filter((n) => n > 0).length, 5] },
  { id: "explorer", title: "Explorer", how: "Play 15 different games", accessory: "astro", progress: (p) => [Object.keys(p.played).length, 15] },
  { id: "crowd", title: "Crowd pleaser", how: "Win a game with 6 or more players", accessory: "viking", progress: (p) => [p.bigWins, 1] },
  { id: "brain", title: "Big brain", how: "Win 3 Brain games", accessory: "grad", progress: (p) => [winsIn(p, "brain"), 3] },
  { id: "arena", title: "Arena ace", how: "Win 3 Real-time games", accessory: "bandana", progress: (p) => [winsIn(p, "arena"), 3] },
  { id: "board", title: "Board boss", how: "Win 3 Board games", accessory: "monocle", progress: (p) => [winsIn(p, "board"), 3] },
  { id: "team", title: "Team player", how: "Win 3 team games", accessory: "eyepatch", progress: (p) => [teamWins(p), 3] },
];

const ACHIEVEMENT_FOR = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.accessory, a])) as Partial<Record<AccessoryId, Achievement>>;

/** Why an accessory is locked (null when it's yours to wear). */
export function lockReason(acc: AccessoryId, p: Progress): string | null {
  const a = ACHIEVEMENT_FOR[acc];
  if (a) {
    const [done, need] = a.progress(p);
    return done >= need ? null : `${a.title}: ${a.how.toLowerCase()} (${Math.min(done, need)}/${need})`;
  }
  const need = UNLOCK_AT[acc] ?? 0;
  return p.wins >= need ? null : `Win ${need} ${need === 1 ? "game" : "games"} to unlock (${p.wins}/${need})`;
}

function unlockedSet(p: Progress): Set<AccessoryId> {
  const out = new Set<AccessoryId>();
  for (const [acc, need] of Object.entries(UNLOCK_AT)) if (p.wins >= (need ?? 0)) out.add(acc as AccessoryId);
  for (const a of ACHIEVEMENTS) {
    const [done, need] = a.progress(p);
    if (done >= need) out.add(a.accessory);
  }
  return out;
}

// ---------- storage ----------

let cache: Progress | null = null;
let cacheRaw: string | null = null;
const listeners = new Set<() => void>();

function sanitize(raw: unknown): Progress | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(1e6, Math.floor(v)) : 0);
  const map = (v: unknown) => {
    const out: Record<string, number> = {};
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (/^[a-z]{1,20}$/.test(k) && n(x)) out[k] = n(x);
    return out;
  };
  return { v: 1, wins: n(r.wins), gameWins: map(r.gameWins), played: map(r.played), run: n(r.run), bestRun: n(r.bestRun), bigWins: n(r.bigWins) };
}

export function getProgress(): Progress {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw === null) {
      // Older versions only counted wins.
      const old = Number(localStorage.getItem(OLD_KEY));
      if (Number.isFinite(old) && old > 0) raw = JSON.stringify({ ...EMPTY, wins: Math.floor(old) });
    }
  } catch {
    return cache ?? EMPTY;
  }
  if (raw === cacheRaw && cache) return cache;
  let parsed: Progress | null = null;
  try {
    parsed = raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    parsed = null;
  }
  cacheRaw = raw;
  cache = parsed ?? EMPTY;
  return cache;
}

function save(p: Progress) {
  const raw = JSON.stringify(p);
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    /* not saved */
  }
  cache = p;
  cacheRaw = raw;
  for (const fn of listeners) fn();
}

export function subscribeProgress(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => e.key === KEY && fn();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** Total wins (kept for older callers). */
export function getWins(): number {
  return getProgress().wins;
}

/**
 * Counts a finished room game you played. Only games with at least one other person count
 * (practice bots don't). Returns the accessories this just unlocked.
 */
export function recordResult(r: { gameId: string; won: boolean; humans: number }): AccessoryId[] {
  if (r.humans < 2) return [];
  const before = getProgress();
  const p: Progress = { ...before, gameWins: { ...before.gameWins }, played: { ...before.played } };
  p.played[r.gameId] = (p.played[r.gameId] ?? 0) + 1;
  if (r.won) {
    p.wins++;
    p.gameWins[r.gameId] = (p.gameWins[r.gameId] ?? 0) + 1;
    p.run++;
    p.bestRun = Math.max(p.bestRun, p.run);
    if (r.humans >= 6) p.bigWins++;
  } else p.run = 0;
  const had = unlockedSet(before);
  save(p);
  return [...unlockedSet(p)].filter((a) => !had.has(a));
}

// ---------- transfer code ----------
// RK2 carries unlocks and daily challenge results; RK1 (unlocks only) still imports.

const PREFIX = "RK2-";
const OLD_PREFIX = "RK1-";

function checksum(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36).slice(0, 4).padStart(4, "0");
}

const toB64 = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

/** A code that carries this browser's unlocks and daily results to another device. */
export function exportCode(): string {
  const body = toB64(JSON.stringify({ p: getProgress(), d: exportDaily() }));
  return `${PREFIX}${body}.${checksum(body)}`;
}

/** Changes whenever the code would: progress or daily results. */
export function subscribeTransfer(fn: () => void) {
  const a = subscribeProgress(fn);
  const b = subscribeDaily(fn);
  return () => {
    a();
    b();
  };
}

/** Adds a transfer code's progress to this browser (keeps the higher of each number). */
export function importCode(code: string): { ok: true; wins: number; streak: number } | { ok: false; error: string } {
  const c = code.trim().replace(/\s+/g, "");
  const v2 = c.startsWith(PREFIX);
  if (!v2 && !c.startsWith(OLD_PREFIX)) return { ok: false, error: "That doesn't look like a Ruckus transfer code." };
  const [body, sum] = c.slice(PREFIX.length).split(".");
  if (!body || !sum || checksum(body) !== sum) return { ok: false, error: "That code is incomplete. Copy the whole thing." };
  let incoming: Progress | null = null;
  let daily: unknown = null;
  try {
    const raw = JSON.parse(fromB64(body));
    incoming = sanitize(v2 ? raw?.p : raw);
    daily = v2 ? raw?.d : null;
  } catch {
    incoming = null;
  }
  if (!incoming) return { ok: false, error: "That code couldn't be read." };
  const cur = getProgress();
  const maxMap = (a: Record<string, number>, b: Record<string, number>) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
    return out;
  };
  const merged: Progress = {
    v: 1,
    wins: Math.max(cur.wins, incoming.wins),
    gameWins: maxMap(cur.gameWins, incoming.gameWins),
    played: maxMap(cur.played, incoming.played),
    run: Math.max(cur.run, incoming.run),
    bestRun: Math.max(cur.bestRun, incoming.bestRun),
    bigWins: Math.max(cur.bigWins, incoming.bigWins),
  };
  save(merged);
  if (daily) mergeDaily(daily);
  const d = exportDaily();
  return { ok: true, wins: merged.wins, streak: currentStreak(d, dailyDay()) };
}
