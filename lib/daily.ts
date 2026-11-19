// The daily challenge: the same 3 solo games for everyone each day (Indian time), each with the same
// seeded puzzle. Results, personal bests and the day streak live in this browser only.

import { CATALOG_BY_ID } from "@/games/catalog";

/**
 * Games the daily challenge picks from (3 a day). Edit freely: solo games only (they run
 * with no bots), and ids that aren't in the catalog are ignored.
 */
export const DAILY_GAMES = ["trivia", "blitz", "minerush", "ladder", "stack", "pairs", "codeword", "wordwheel", "ninebox", "groupup"];
export const DAILY_COUNT = 3;

const DAY_MS = 86_400_000;
/** Days roll over at midnight India time (IST, UTC+5:30 all year: no daylight saving). */
const IST_MS = 5.5 * 3_600_000;
/** Day #1 of the daily challenge (midnight IST). */
const FIRST_DAY = Date.UTC(2026, 10, 17) - IST_MS;
const KEY = "ruckus:daily";

/** "2026-11-17" for the given time, as the date in India. */
export function dailyDay(t: number = Date.now()): string {
  return new Date(t + IST_MS).toISOString().slice(0, 10);
}

/** When that day starts: midnight in India. */
function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) - IST_MS;
}

export function prevDay(day: string): string {
  return dailyDay(dayStart(day) - DAY_MS);
}

/** Puzzle number shown in the share text. */
export function dailyNumber(day: string): number {
  return Math.floor((dayStart(day) - FIRST_DAY) / DAY_MS) + 1;
}

/** Milliseconds until the next midnight in India. */
export function msToNextDay(t: number = Date.now()): number {
  return DAY_MS - ((t + IST_MS) % DAY_MS);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Today's games: a stable shuffle of DAILY_GAMES keyed by the date. */
export function dailyGames(day: string): string[] {
  // Solo games only: the daily runs without bots.
  const pool = [...new Set(DAILY_GAMES)].filter((id) => (CATALOG_BY_ID[id]?.minPlayers ?? 2) <= 1);
  return pool
    .map((id) => ({ id, k: hash(`${day}|${id}`) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, DAILY_COUNT)
    .map((x) => x.id);
}

/** Seed for a game's ctx.random: same puzzle for everyone today. */
export function dailySeed(day: string, gameId: string): string {
  return `ruckus-daily:${day}:${gameId}`;
}

// ---------- results in localStorage ----------

export interface DailyEntry {
  /** Your score on the first (official) attempt; null when the game reports none. */
  score: number | null;
  headline: string;
  /** Started but not finished yet (left mid-game): it stays the official attempt. */
  pending?: boolean;
}

export interface DailyData {
  /** Official results per day, per game. Only the last couple of weeks are kept. */
  days: Record<string, Record<string, DailyEntry>>;
  /** Best official score per game. */
  best: Record<string, number>;
  /** Consecutive days with every daily game played; `day` is the last one counted. */
  streak: { day: string; count: number; best: number };
}

const EMPTY: DailyData = { days: {}, best: {}, streak: { day: "", count: 0, best: 0 } };
const listeners = new Set<() => void>();
let cacheRaw: string | null | undefined;
let cache: DailyData = EMPTY;

function parse(raw: string | null): DailyData {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw) as Partial<DailyData>;
    return {
      days: v.days && typeof v.days === "object" ? v.days : {},
      best: v.best && typeof v.best === "object" ? v.best : {},
      streak: {
        day: typeof v.streak?.day === "string" ? v.streak.day : "",
        count: Number(v.streak?.count) || 0,
        best: Number(v.streak?.best) || 0,
      },
    };
  } catch {
    return EMPTY;
  }
}

/** Saved results (cached: the same object until something changes). */
export function readDaily(): DailyData {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    /* blocked: nothing saved */
  }
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cache = parse(raw);
  }
  return cache;
}

export function subscribeDaily(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

// ---------- moving results to another device (part of the transfer code) ----------

/** Today's and recent results, best scores and streak, small enough for a transfer code. */
export function exportDaily(): DailyData {
  return readDaily();
}

function cleanEntry(v: unknown): DailyEntry | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  const score = typeof e.score === "number" && Number.isFinite(e.score) ? e.score : null;
  const headline = typeof e.headline === "string" ? e.headline.slice(0, 120) : "";
  return { score, headline, ...(e.pending === true ? { pending: true } : {}) };
}

/**
 * Adds results from another device: a day's game keeps whichever result is finished (this
 * device's if both are), best scores keep the higher, the streak keeps the more recent / longer.
 */
export function mergeDaily(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const r = raw as Record<string, unknown>;
  const cur = readDaily();
  const days: DailyData["days"] = {};
  const inDays = r.days && typeof r.days === "object" ? (r.days as Record<string, unknown>) : {};
  const keys = new Set([...Object.keys(cur.days), ...Object.keys(inDays).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))]);
  for (const day of [...keys].sort().reverse().slice(0, 14)) {
    const mine = cur.days[day] ?? {};
    const theirs = inDays[day] && typeof inDays[day] === "object" ? (inDays[day] as Record<string, unknown>) : {};
    const out: Record<string, DailyEntry> = { ...mine };
    for (const [id, v] of Object.entries(theirs)) {
      if (!CATALOG_BY_ID[id]) continue;
      const e = cleanEntry(v);
      if (!e) continue;
      const m = out[id];
      if (!m || (m.pending && !e.pending)) out[id] = e;
    }
    days[day] = out;
  }
  const best = { ...cur.best };
  if (r.best && typeof r.best === "object")
    for (const [id, v] of Object.entries(r.best as Record<string, unknown>))
      if (CATALOG_BY_ID[id] && typeof v === "number" && Number.isFinite(v) && (best[id] === undefined || v > best[id])) best[id] = v;
  const s = (r.streak && typeof r.streak === "object" ? r.streak : {}) as Record<string, unknown>;
  const theirs = {
    day: typeof s.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.day) ? s.day : "",
    count: Math.max(0, Math.floor(Number(s.count) || 0)),
    best: Math.max(0, Math.floor(Number(s.best) || 0)),
  };
  const a = cur.streak;
  const later = theirs.day > a.day || (theirs.day === a.day && theirs.count > a.count) ? theirs : a;
  const streak = { day: later.day, count: later.count, best: Math.max(a.best, theirs.best, later.count) };
  try {
    localStorage.setItem(KEY, JSON.stringify({ days, best, streak } satisfies DailyData));
  } catch {
    /* not saved */
  }
  for (const fn of listeners) fn();
}

/** The streak as it stands today: it lapses once a whole day goes by unplayed. */
export function currentStreak(d: DailyData, today: string): number {
  return d.streak.day === today || d.streak.day === prevDay(today) ? d.streak.count : 0;
}

/** Whether today's official attempt at this game has started (finished or not). */
export function attempted(d: DailyData, day: string, gameId: string): boolean {
  return !!d.days[day]?.[gameId];
}

/**
 * Records an attempt. Only the first attempt at a game each day counts: call it with
 * `pending` when the game starts, then again with the result. Returns false for replays
 * (which are just for fun).
 */
export function recordDaily(day: string, gameId: string, entry: DailyEntry): boolean {
  const d = readDaily();
  const prev = d.days[day]?.[gameId];
  if (prev && !prev.pending) return false;
  if (prev && entry.pending) return false;
  const today = { ...(d.days[day] ?? {}), [gameId]: entry };
  // Keep two weeks of history.
  const days: DailyData["days"] = { [day]: today };
  for (const k of Object.keys(d.days).sort().reverse().slice(0, 13)) if (k !== day) days[k] = d.days[k];
  const best = { ...d.best };
  if (entry.score !== null && (best[gameId] === undefined || entry.score > best[gameId])) best[gameId] = entry.score;
  let streak = d.streak;
  const all = dailyGames(day).every((id) => today[id] && !today[id].pending);
  if (all && streak.day !== day) {
    const count = streak.day === prevDay(day) ? streak.count + 1 : 1;
    streak = { day, count, best: Math.max(streak.best, count) };
  }
  try {
    localStorage.setItem(KEY, JSON.stringify({ days, best, streak } satisfies DailyData));
  } catch {
    /* private mode: results just won't stick */
  }
  for (const fn of listeners) fn();
  return true;
}

/**
 * How a daily result reads. Most games show their score; Word Ladder is a race for the fewest
 * steps, so it shows those (its score only ranks them).
 */
export function dailyResultText(gameId: string, score: number | null, headline: string): string {
  if (gameId === "ladder") {
    const m = / in (\d+) steps/.exec(headline);
    if (m) return `${m[1]} steps`;
  }
  return score === null ? "done" : score.toLocaleString("en-US");
}

/** Wordle-style summary: game names and scores only, nothing personal. */
export function shareText(day: string, d: DailyData, url: string): string {
  const today = d.days[day] ?? {};
  const lines = dailyGames(day).map((id) => {
    const meta = CATALOG_BY_ID[id];
    const e = today[id];
    const score = !e
      ? "not played"
      : e.pending
        ? "unfinished"
        : dailyResultText(id, e.score, e.headline);
    return `${meta?.emoji ?? "🎮"} ${meta?.name ?? id}: ${score}`;
  });
  const streak = currentStreak(d, day);
  return [
    `Ruckus Daily #${dailyNumber(day)}`,
    ...lines,
    ...(streak > 1 ? [`🔥 ${streak}-day streak`] : []),
    url,
  ].join("\n");
}
