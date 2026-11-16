// Abuse limits that keep a public deployment inside free hosting tiers.
//
// One internal room ("__limits", unreachable from outside, see server.ts) keeps
// sliding-window counters per IP plus a global daily cap on new rooms. It lives
// in memory: if it is evicted after a quiet spell the windows simply restart.

export const LIMITS_ROOM = "__limits";

export type LimitKind = "create" | "connect";

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

/** Client IP as seen by Cloudflare. Missing in local dev, where nothing is limited. */
export function clientIp(req: { headers: { get(name: string): string | null } }): string | null {
  return req.headers.get("cf-connecting-ip");
}

/** Room ids a browser may reach: real codes (lowercased) and test rooms. Never "__…". */
export function isPublicRoomId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{2,39}$/.test(id);
}
