// Abuse limits that keep a public deployment inside free hosting tiers.
//
// One internal room ("__limits", unreachable from outside, see server.ts) keeps
// sliding-window counters per IP plus a global daily cap on new rooms. It lives
// in memory: if it is evicted after a quiet spell the windows simply restart.

export const LIMITS_ROOM = "__limits";

export type LimitKind = "create" | "connect" | "error";

interface Rule {
  windowMs: number;
  max: number;
}

/** Per-IP limits. Generous for real friends, useless for scripts. */
export const RULES: Record<LimitKind, Rule[]> = {
  // A few rooms per evening is normal; dozens is a script.
  create: [
    { windowMs: 10 * 60_000, max: 8 },
    { windowMs: 24 * 60 * 60_000, max: 40 },
  ],
  // Joins and reconnects (phones reconnect a lot) per IP.
  connect: [
    { windowMs: 60_000, max: 40 },
    { windowMs: 10 * 60_000, max: 200 },
  ],
  // Crash reports from browsers: a broken page reports a few, a script gets nowhere.
  error: [
    { windowMs: 10 * 60_000, max: 20 },
    { windowMs: 24 * 60 * 60_000, max: 100 },
  ],
};

/** Hard cap on new rooms per UTC day across everyone. */
export const GLOBAL_ROOMS_PER_DAY = 3000;

export class Limiter {
  private hits = new Map<string, number[]>();
  private day = "";
  private roomsToday = 0;

  /** Records the hit and says whether it's allowed. */
  check(kind: LimitKind, ip: string, now: number): { ok: true } | { ok: false; reason: string } {
    const rules = RULES[kind];
    const key = `${kind}:${ip}`;
    const longest = Math.max(...rules.map((r) => r.windowMs));
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < longest);
    for (const r of rules) {
      const n = list.filter((t) => now - t < r.windowMs).length;
      if (n >= r.max) {
        this.hits.set(key, list);
        return { ok: false, reason: kind === "create" ? "You've made a lot of rooms. Try again in a bit." : "Too many connections. Try again in a minute." };
      }
    }
    if (kind === "create") {
      const day = new Date(now).toISOString().slice(0, 10);
      if (day !== this.day) {
        this.day = day;
        this.roomsToday = 0;
      }
      if (this.roomsToday >= GLOBAL_ROOMS_PER_DAY) return { ok: false, reason: "Ruckus is very busy today. Try again tomorrow." };
      this.roomsToday++;
    }
    list.push(now);
    this.hits.set(key, list);
    // Keep memory bounded: forget idle IPs now and then.
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) if (!v.length || now - v[v.length - 1] > longest) this.hits.delete(k);
    }
    return { ok: true };
  }
}

/** Client IP as seen by Cloudflare. Local dev (no header, or loopback under wrangler dev) is never limited. */
export function clientIp(req: { headers: { get(name: string): string | null } }): string | null {
  const ip = req.headers.get("cf-connecting-ip");
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return null;
  return ip;
}

/** Room ids a browser may reach: real codes (lowercased) and test rooms. Never "__…". */
export function isPublicRoomId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{2,39}$/.test(id);
}

// ---------- usage stats (for the private /stats dashboard) ----------

/** Cloudflare Durable Objects free plan, per UTC day. */
export const FREE_TIER = { requests: 100_000, gbSeconds: 13_000 } as const;
/** Each Durable Object instance is billed at 128 MB while active. */
const GB_PER_ACTIVE_SECOND = 128 / 1024;
/** Incoming WebSocket messages are billed 20:1 as requests. */
const WS_MESSAGES_PER_REQUEST = 20;

export interface DayStats {
  day: string;
  roomsCreated: number;
  connects: number;
  /** Creates and connects refused by the limits above. */
  blocked: number;
  /** Requests handled by the limiter itself (it is a Durable Object too). */
  limiterRequests: number;
  /** Crash reports received (see Stats.recordError). */
  errors: number;
  /** HTTP requests rooms answered (create, "does it exist?"). */
  roomHttp: number;
  wsMessages: number;
  activeSeconds: number;
  /** Games started, by game id. */
  games: Record<string, number>;
}

/** What a room sends when it goes idle: its usage since it woke up. */
export interface RoomReport {
  room: string;
  http: number;
  messages: number;
  activeMs: number;
  games: Record<string, number>;
}

const emptyDay = (day: string): DayStats => ({
  day,
  roomsCreated: 0,
  connects: 0,
  blocked: 0,
  limiterRequests: 0,
  errors: 0,
  roomHttp: 0,
  wsMessages: 0,
  activeSeconds: 0,
  games: {},
});

/** Estimated billable usage for a day, against the free plan. */
export function usageOf(d: DayStats) {
  const requests = d.limiterRequests + d.connects + d.roomHttp + Math.ceil(d.wsMessages / WS_MESSAGES_PER_REQUEST);
  const gbSeconds = Math.round(d.activeSeconds * GB_PER_ACTIVE_SECOND);
  return { requests, gbSeconds, requestsPct: requests / FREE_TIER.requests, gbSecondsPct: gbSeconds / FREE_TIER.gbSeconds };
}

/** A crash seen in someone's browser (no personal data: message, code location, game, browser). */
export interface ErrorReport {
  msg: string;
  stack: string;
  where: string;
  game: string;
  browser: string;
}

export interface ErrorEntry extends ErrorReport {
  count: number;
  first: number;
  last: number;
}

export const MAX_ERRORS = 40;

/** Trims and checks a report sent by a browser; null if it's junk. */
export function cleanErrorReport(raw: unknown): ErrorReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, n) : "");
  const msg = str(r.msg, 300).trim();
  if (!msg) return null;
  return {
    msg,
    stack: (typeof r.stack === "string" ? r.stack : "").slice(0, 800),
    where: str(r.where, 80),
    game: /^[a-z]{1,20}$/.test(String(r.game)) ? String(r.game) : "",
    browser: str(r.browser, 40),
  };
}

export class Stats {
  days: DayStats[] = [];
  /** Recent distinct crashes, newest first. */
  errors: ErrorEntry[] = [];

  recordError(e: ErrorReport, now: number) {
    this.today(now).errors++;
    const same = this.errors.find((x) => x.msg === e.msg && x.where === e.where && x.game === e.game);
    if (same) {
      same.count++;
      same.last = now;
      same.stack = e.stack || same.stack;
      same.browser = e.browser || same.browser;
      this.errors = [same, ...this.errors.filter((x) => x !== same)];
      return;
    }
    this.errors = [{ ...e, count: 1, first: now, last: now }, ...this.errors].slice(0, MAX_ERRORS);
  }
  /** Rooms currently awake (opened, no idle report yet), with when they opened. */
  open = new Map<string, number>();

  today(now: number): DayStats {
    const day = new Date(now).toISOString().slice(0, 10);
    let d = this.days[this.days.length - 1];
    if (!d || d.day !== day) {
      d = emptyDay(day);
      this.days.push(d);
      if (this.days.length > 14) this.days.splice(0, this.days.length - 14);
    }
    return d;
  }

  report(r: RoomReport, now: number) {
    const d = this.today(now);
    d.roomHttp += r.http;
    d.wsMessages += r.messages;
    d.activeSeconds += Math.round(r.activeMs / 1000);
    for (const [g, n] of Object.entries(r.games)) d.games[g] = (d.games[g] ?? 0) + n;
    this.open.delete(r.room);
  }

  snapshot(now: number) {
    // Rooms that never reported (evicted mid-session) stop counting as open after 6 h.
    for (const [room, at] of this.open) if (now - at > 6 * 3600_000) this.open.delete(room);
    const today = this.today(now);
    // Awake rooms haven't reported yet: count their time so far.
    let live = 0;
    for (const at of this.open.values()) live += (now - at) / 1000;
    const todayLive = { ...today, activeSeconds: today.activeSeconds + Math.round(live) };
    return {
      now,
      freeTier: FREE_TIER,
      openRooms: this.open.size,
      today: { ...todayLive, ...usageOf(todayLive) },
      days: this.days.map((d) => ({ ...d, ...usageOf(d) })),
      errors: this.errors,
    };
  }
}
