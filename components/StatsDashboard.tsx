"use client";

import { Activity, Bug, Cpu, DoorOpen, KeyRound, Plug, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CATALOG_BY_ID } from "@/games/catalog";
import { partyHost } from "@/lib/identity";
import { GameBadge } from "./GameBadge";
import { Logo } from "./Logo";

interface Day {
  day: string;
  roomsCreated: number;
  connects: number;
  blocked: number;
  wsMessages: number;
  activeSeconds: number;
  games: Record<string, number>;
  ratings?: Record<string, { up: number; down: number }>;
  requests: number;
  gbSeconds: number;
  requestsPct: number;
  gbSecondsPct: number;
  errors?: number;
}
interface ErrorEntry {
  msg: string;
  stack: string;
  where: string;
  game: string;
  browser: string;
  count: number;
  first: number;
  last: number;
}
interface Snapshot {
  now: number;
  freeTier: { requests: number; gbSeconds: number };
  openRooms: number;
  today: Day;
  days: Day[];
  errors?: ErrorEntry[];
}

const KEY = "ruckus:stats-token";
const fmt = new Intl.NumberFormat("en");

function level(p: number) {
  return p >= 0.8 ? "#ff4769" : p >= 0.5 ? "#ffb020" : "#c6f432";
}

/** Usage against the Cloudflare free plan, refreshed every 30 s. */
export function StatsDashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Saved token (this browser only), read after mount.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      /* storage blocked */
    }
    if (saved) queueMicrotask(() => setToken(saved));
  }, []);

  const load = useCallback(async (t: string) => {
    const host = partyHost();
    const local = host.startsWith("localhost") || host.startsWith("127.");
    try {
      const res = await fetch(`${local ? "http" : "https"}://${host}/stats`, {
        headers: { Authorization: `Bearer ${t}` },
        cache: "no-store",
      });
      if (res.status === 401) throw new Error("That token isn't right.");
      if (!res.ok) throw new Error("Stats aren't switched on for this server (no STATS_TOKEN secret).");
      setData((await res.json()) as Snapshot);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the game server.");
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    const first = window.setTimeout(() => void load(token), 0);
    const id = window.setInterval(() => void load(token), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [token, load]);

  if (!token || (error && !data)) {
    return (
      <main className="mx-auto grid w-full max-w-md flex-1 place-items-center px-4 py-16">
        <form
          className="card lit-edge w-full p-6"
          onSubmit={(e) => {
            e.preventDefault();
            const t = draft.trim();
            if (!t) return;
            try {
              localStorage.setItem(KEY, t);
            } catch {
              /* not saved */
            }
            setError(null);
            setToken(t);
          }}
        >
          <Logo small />
          <h1 className="mt-5 font-hero text-2xl font-extrabold tracking-[-0.03em]">Usage</h1>
          <p className="mt-1 text-sm text-muted">Private dashboard. Enter the stats token to see today&apos;s usage.</p>
          <label htmlFor="stats-token" className="label mt-5 block">
            Token
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="stats-token"
              className="input flex-1 font-mono"
              type="password"
              autoComplete="off"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="btn btn-primary">
              <KeyRound aria-hidden className="size-4" strokeWidth={2} /> Open
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-brand">{error}</p>}
        </form>
      </main>
    );
  }

  if (!data) {
    return <main className="grid flex-1 place-items-center font-mono text-xs text-muted">Loading usage…</main>;
  }

  const t = data.today;
  const roomHoursLeft = Math.max(0, (data.freeTier.gbSeconds - t.gbSeconds) / (128 / 1024) / 3600);
  const topToday = Object.entries(t.games)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const allGames: Record<string, number> = {};
  for (const d of data.days) for (const [g, n] of Object.entries(d.games)) allGames[g] = (allGames[g] ?? 0) + n;
  const topAll = Object.entries(allGames)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const maxReq = Math.max(1, ...data.days.map((d) => d.requests));
  const resetIn = Math.max(0, 86_400_000 - (data.now % 86_400_000));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-2 py-5">
        <Logo small />
        <span className="font-mono text-xs text-muted">
          refreshes every 30 s · resets in {Math.floor(resetIn / 3600_000)}h {Math.floor((resetIn % 3600_000) / 60_000)}m (00:00 UTC)
        </span>
      </header>

      <h1 className="font-hero text-3xl font-extrabold tracking-[-0.03em]">Today&apos;s usage</h1>
      <p className="mt-1 text-sm text-muted">
        Estimated against the Cloudflare free plan. Going over never bills you: the game server just pauses until 00:00
        UTC.
      </p>

      <section className="mt-6 grid gap-3 md:grid-cols-2">
        <Meter
          Icon={Activity}
          label="Requests"
          value={t.requests}
          max={data.freeTier.requests}
          pct={t.requestsPct}
          note={`${fmt.format(t.wsMessages)} game messages, counted 20:1`}
        />
        <Meter
          Icon={Cpu}
          label="Compute (GB-s)"
          value={t.gbSeconds}
          max={data.freeTier.gbSeconds}
          pct={t.gbSecondsPct}
          note={`≈ ${roomHoursLeft.toFixed(1)} room-hours left today`}
        />
      </section>

      <section className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat Icon={DoorOpen} label="Rooms open now" value={data.openRooms} live />
        <Stat Icon={DoorOpen} label="Rooms created" value={t.roomsCreated} />
        <Stat Icon={Plug} label="Connections" value={t.connects} />
        <Stat Icon={ShieldAlert} label="Blocked by limits" value={t.blocked} warn={t.blocked > 0} />
      </section>

      <section className="mt-8 grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <div className="card p-4">
          <h2 className="label mb-3">Last {data.days.length} days · requests</h2>
          <ol className="space-y-1.5">
            {[...data.days].reverse().map((d) => (
              <li key={d.day} className="grid grid-cols-[3.5rem_1fr_4.5rem] items-center gap-3 font-mono text-xs">
                <span className="text-muted">{d.day.slice(5)}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-panel-2">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.max(1, (d.requests / maxReq) * 100)}%`, background: level(d.requestsPct) }}
                  />
                </span>
                <span className="text-right">{fmt.format(d.requests)}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="card p-4">
          <h2 className="label mb-3">Most played {topToday.length ? "today" : `· last ${data.days.length} days`}</h2>
          <ul className="space-y-2">
            {(topToday.length ? topToday : topAll).map(([id, n]) => {
              const g = CATALOG_BY_ID[id];
              return (
                <li key={id} className="flex items-center gap-3">
                  {g && <GameBadge id={g.id} accent={g.accent} size="sm" />}
                  <span className="min-w-0 flex-1 truncate font-semibold">{g?.name ?? id}</span>
                  <span className="font-mono text-sm">{n}</span>
                </li>
              );
            })}
            {!topAll.length && <li className="text-sm text-muted">No games played yet.</li>}
          </ul>
        </div>
      </section>
      <Ratings days={data.days} />
      <section className="card mt-6 p-4">
        <h2 className="label mb-3 flex items-center gap-2">
          <Bug aria-hidden className="size-3.5" strokeWidth={2} /> Crashes in players&apos; browsers
          <span className="ml-auto font-mono normal-case">{t.errors ?? 0} today</span>
        </h2>
        {data.errors?.length ? (
          <ul className="space-y-2">
            {data.errors.map((e) => (
              <li key={`${e.msg}|${e.where}|${e.game}`} className="rounded-lg border border-line bg-ink/40 p-3">
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="min-w-0 flex-1 truncate font-semibold">{e.msg}</span>
                    <span className="font-mono text-xs text-muted">
                      {e.game ? `${CATALOG_BY_ID[e.game]?.name ?? e.game} · ` : ""}
                      {e.where} · {e.browser} · ×{e.count} · {ago(data.now - e.last)}
                    </span>
                  </summary>
                  {e.stack && <pre className="mt-2 overflow-x-auto font-mono text-[11px] whitespace-pre text-muted">{e.stack}</pre>}
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No crashes reported. 🎉</p>
        )}
      </section>
      {error && <p className="mt-4 font-mono text-xs text-brand">Last refresh failed: {error}</p>}
    </main>
  );
}

function ago(ms: number) {
  const m = Math.round(ms / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

function Meter({
  Icon,
  label,
  value,
  max,
  pct,
  note,
}: {
  Icon: typeof Activity;
  label: string;
  value: number;
  max: number;
  pct: number;
  note: string;
}) {
  const c = level(pct);
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="label flex items-center gap-2">
          <Icon aria-hidden className="size-3.5" strokeWidth={2} /> {label}
        </span>
        <span className="font-mono text-sm" style={{ color: c }}>
          {pct > 0 && pct < 0.001 ? "<0.1" : (pct * 100).toFixed(pct < 0.1 ? 1 : 0)}%
        </span>
      </div>
      <div className="mt-2 font-display text-3xl font-bold tabular-nums">
        {fmt.format(value)} <span className="text-base font-medium text-muted">/ {fmt.format(max)}</span>
      </div>
      <div
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-panel-2"
        role="progressbar"
        aria-valuenow={Math.round(pct * 100)}
        aria-label={label}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${Math.min(100, Math.max(0.5, pct * 100))}%`, background: c, boxShadow: `0 0 12px ${c}` }}
        />
      </div>
      <p className="mt-2 font-mono text-[11px] text-muted">{note}</p>
    </div>
  );
}

function Stat({
  Icon,
  label,
  value,
  live,
  warn,
}: {
  Icon: typeof Activity;
  label: string;
  value: number;
  live?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="card p-4">
      <span className="label flex items-center gap-1.5">
        {live ? (
          <span aria-hidden className="relative flex size-2">
            <span className="absolute inset-0 rounded-full bg-brand-2 motion-safe:animate-ping" />
            <span className="relative size-2 rounded-full bg-brand-2" />
          </span>
        ) : (
          <Icon aria-hidden className="size-3.5" strokeWidth={2} />
        )}
        {label}
      </span>
      <div className={`mt-1.5 font-display text-2xl font-bold tabular-nums ${warn ? "text-brand" : ""}`}>
        {fmt.format(value)}
      </div>
    </div>
  );
}

/** 👍/👎 per game over the stored days: most-rated first, with the share of thumbs up. */
function Ratings({ days }: { days: Day[] }) {
  const sum: Record<string, { up: number; down: number }> = {};
  for (const d of days)
    for (const [g, r] of Object.entries(d.ratings ?? {})) {
      const t = (sum[g] ??= { up: 0, down: 0 });
      t.up += r.up;
      t.down += r.down;
    }
  const rows = Object.entries(sum)
    .map(([id, r]) => ({ id, ...r, n: r.up + r.down, pct: r.up / Math.max(1, r.up + r.down) }))
    .sort((a, b) => b.n - a.n);
  return (
    <section className="card mt-6 p-4">
      <h2 className="label mb-3">Ratings · last {days.length} days (👍 share, most rated first)</h2>
      {rows.length ? (
        <ul className="grid gap-x-6 gap-y-2 md:grid-cols-2">
          {rows.map((r) => {
            const g = CATALOG_BY_ID[r.id];
            return (
              <li key={r.id} className="flex items-center gap-3">
                {g && <GameBadge id={g.id} accent={g.accent} size="sm" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{g?.name ?? r.id}</span>
                  <span className="mt-1 block h-2 overflow-hidden rounded-full bg-panel-2">
                    <span className="block h-full rounded-full" style={{ width: `${r.pct * 100}%`, background: level(1 - r.pct) }} />
                  </span>
                </span>
                <span className="w-24 text-right font-mono text-xs">
                  👍 {r.up} · 👎 {r.down}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">No ratings yet. They appear after people finish games.</p>
      )}
    </section>
  );
}
