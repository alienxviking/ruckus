"use client";

import Link from "next/link";
import { Flame, Gamepad2, Heart, Trophy } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CATALOG_BY_ID } from "@/games/catalog";
import { loadIdentity, saveIdentity, type Identity } from "@/lib/identity";
import { readMyGames, serverMyGames, subscribeMyGames } from "@/lib/my-games";
import { ACHIEVEMENTS, getProgress, subscribeProgress, UNLOCK_AT, type Progress } from "@/lib/progress";
import { ACCESSORY_LABEL } from "@/lib/avatar-art";
import { parseAvatar, type AccessoryId } from "@/shared/types";
import { Avatar } from "../Avatar";
import { CoverArt } from "../CoverArt";
import { Rux } from "../Rux";
import { TransferProgress } from "../TransferProgress";
import { ProfileForm } from "../room/ProfileForm";

const EMPTY: Progress = { v: 1, wins: 0, gameWins: {}, played: {}, run: 0, bestRun: 0, bigWins: 0 };

/** Your profile, outside any room: look, stats, achievements and the transfer code. */
export function MePage() {
  // Your saved look lives in this browser: read it once the page is here (not on the server).
  const [loaded, setLoaded] = useState<{ me: Identity | null } | null>(null);
  useEffect(() => {
    queueMicrotask(() => setLoaded({ me: loadIdentity() }));
  }, []);
  const me = loaded?.me ?? null;
  const setOverride = (v: Identity) => setLoaded({ me: v });
  const p = useSyncExternalStore(subscribeProgress, getProgress, () => EMPTY);
  const mine = useSyncExternalStore(subscribeMyGames, readMyGames, serverMyGames);
  const [editing, setEditing] = useState(false);

  // Older versions only counted wins, so "played" can lag behind: never show fewer games than wins.
  const played = Math.max(p.wins, Object.values(p.played).reduce((a, b) => a + b, 0));
  const topGames = Object.entries(p.played)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, n]) => ({ id, n, wins: p.gameWins[id] ?? 0 }))
    .filter((g) => CATALOG_BY_ID[g.id]);
  const winAccessories = (Object.entries(UNLOCK_AT) as [AccessoryId, number][]).filter(([, n]) => n > 0).sort((a, b) => a[1] - b[1]);
  const nextWin = winAccessories.find(([, n]) => p.wins < n);
  const acc = me ? parseAvatar(me.avatar)?.acc : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      {/* ---------- you ---------- */}
      <section className="stk p-5 sm:p-6" style={{ "--stk-bg": "var(--color-panel)" } as React.CSSProperties}>
        {!loaded ? (
          <div className="h-24" aria-busy="true" />
        ) : me && !editing ? (
          <div className="flex flex-wrap items-center gap-5">
            <span
              className="grid size-24 shrink-0 place-items-center rounded-3xl border-[3px] border-paper text-6xl shadow-[4px_5px_0_rgb(0_0_0/0.55)]"
              style={{ background: `radial-gradient(120% 120% at 30% 20%, ${me.color}66, ${me.color}22 70%)`, transform: "rotate(-4deg)" }}
            >
              <Avatar id={me.avatar} size="1em" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="marker text-xl leading-none text-brand-2">that&apos;s you!</p>
              <h1 className="mt-1 truncate font-hero text-4xl font-extrabold tracking-[-0.03em]" style={{ color: me.color }}>
                {me.name}
              </h1>
              <p className="mt-1 text-sm text-muted">{acc ? `Wearing: ${ACCESSORY_LABEL[acc]}` : "No accessory on yet"}</p>
            </div>
            <button className="btn border-2" onClick={() => setEditing(true)}>
              Edit look
            </button>
          </div>
        ) : (
          <div>
            <h1 className="mb-4 font-hero text-3xl font-extrabold tracking-[-0.03em]">{me ? "Edit your look" : "Make your player"}</h1>
            <ProfileForm
              initial={me ? { name: me.name, color: me.color, avatar: me.avatar } : undefined}
              submitLabel={me ? "Save" : "Save my player"}
              showTransfer={false}
              onSubmit={(v) => {
                setOverride(saveIdentity(v));
                setEditing(false);
              }}
            />
            {me && (
              <button className="btn mt-3 w-full" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        )}
      </section>

      {/* ---------- stats ---------- */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Wins" value={p.wins} Icon={Trophy} color="var(--color-sun)" tilt={-6} />
        <Stat label="Games played" value={played} Icon={Gamepad2} color="var(--color-cyan)" tilt={5} />
        <Stat label="Best win streak" value={p.bestRun} Icon={Flame} color="var(--color-pink)" tilt={-4} />
        <Stat label="Favourites" value={mine.favs.length} Icon={Heart} color="var(--color-volt)" tilt={6} />
      </section>
      <p className="-mt-2 text-center text-xs text-muted">Counts room games with at least one other person (bots and solo don&apos;t count).</p>

      {topGames.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-3 font-hero text-lg font-extrabold">Your most played</h2>
          <div className="grid grid-cols-3 gap-3">
            {topGames.map((g) => (
              <div key={g.id} className="min-w-0">
                <CoverArt game={CATALOG_BY_ID[g.id]} className="rounded-xl border-2 border-paper" />
                <p className="mt-1 truncate text-xs font-bold text-muted">
                  {g.n} played · {g.wins} won
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------- unlocks ---------- */}
      <section className="card p-4">
        <h2 className="flex items-baseline gap-2 font-hero text-lg font-extrabold">
          Unlocks <span className="text-sm font-semibold text-muted">earn accessories for your avatar</span>
        </h2>
        <div className="mt-3 rounded-xl border-2 border-line p-3">
          <p className="text-sm font-bold">
            Wins: {p.wins}
            {nextWin ? (
              <span className="font-semibold text-muted">
                {" "}
                · {nextWin[1] - p.wins} more for the {ACCESSORY_LABEL[nextWin[0]].toLowerCase()}
              </span>
            ) : (
              <span className="text-brand-2"> · all win unlocks earned!</span>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {winAccessories.map(([a, n]) => (
              <Badge key={a} acc={a} avatar={me?.avatar} done={p.wins >= n} note={`${n} ${n === 1 ? "win" : "wins"}`} />
            ))}
          </div>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {ACHIEVEMENTS.map((a) => {
            const [done, need] = a.progress(p);
            const ok = done >= need;
            return (
              <li key={a.id} className={`flex items-center gap-3 rounded-xl border-2 p-2.5 ${ok ? "border-brand-2/60 bg-brand-2/10" : "border-line"}`}>
                <Badge acc={a.accessory} avatar={me?.avatar} done={ok} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">
                    {a.title} {ok && "✓"}
                  </span>
                  <span className="block text-xs text-muted">{a.how}</span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-panel-2">
                    <span className="block h-full rounded-full bg-brand-2" style={{ width: `${Math.min(100, (done / need) * 100)}%` }} />
                  </span>
                </span>
                <span className="text-xs font-bold text-muted">
                  {Math.min(done, need)}/{need}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---------- transfer ---------- */}
      <section className="card p-4">
        <h2 className="font-hero text-lg font-extrabold">Save your progress</h2>
        <p className="mt-1 text-sm text-muted">
          Your wins and unlocks live in this browser. To carry them to your phone or another laptop, copy your code here and paste it
          there. No account needed.
        </p>
        <TransferProgress open />
      </section>

      <div className="flex flex-col items-center gap-2 pt-4">
        <Rux mood="wink" className="w-16" />
        <Link href="/" className="btn btn-primary">
          Back to the games
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, Icon, color, tilt }: { label: string; value: number; Icon: typeof Trophy; color: string; tilt: number }) {
  return (
    <div className="card flex flex-col items-center p-3 text-center">
      <span
        aria-hidden
        className="grid size-10 place-items-center rounded-xl border-2 border-ink text-ink shadow-[2px_3px_0_rgb(0_0_0/0.5)]"
        style={{ background: color, transform: `rotate(${tilt}deg)` }}
      >
        <Icon className="size-5" strokeWidth={2.5} />
      </span>
      <div className="mt-1 font-hero text-3xl font-extrabold tabular-nums">{value}</div>
      <div className="text-xs font-semibold text-muted">{label}</div>
    </div>
  );
}

function Badge({ acc, avatar, done, note }: { acc: AccessoryId; avatar?: string; done: boolean; note?: string }) {
  const base = avatar ? (parseAvatar(avatar)?.base ?? "fox") : "fox";
  return (
    <span className="flex flex-col items-center" title={`${ACCESSORY_LABEL[acc]}${done ? " (unlocked)" : ""}`}>
      <span className={`grid size-11 place-items-center rounded-xl bg-panel-2 text-3xl ${done ? "" : "opacity-35 grayscale"}`}>
        <Avatar id={`${base}+${acc}`} size="1em" />
      </span>
      {note && <span className={`mt-0.5 text-[11px] font-bold ${done ? "text-brand-2" : "text-muted"}`}>{note}</span>}
    </span>
  );
}
