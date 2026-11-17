"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { PlayerChip, Note, StatusBanner, TimerBar } from "@/components/game-ui";
import { PLAYER_COLORS, type Player } from "@/shared/types";
import {
  FLAG_POINTS,
  GEM_POINTS,
  ITEMS,
  MINE_PENALTY,
  PLAY_MS,
  READY_MS,
  neighbors,
  type FinalRow,
  type MrAction,
  type MrEvent,
  type MrView,
} from "./shared";
import { HIDDEN, MineStore } from "./store";
import { Board, FIELD_CSS, type Mode } from "./field";
import { Avatar } from "@/components/Avatar";
import { feedback, sfx } from "@/lib/feedback";

type Props = GameClientProps<MrView, MrAction>;

const CSS = `
${FIELD_CSS}
.mr-veil { position: absolute; inset: 0; display: grid; place-items: center; border-radius: .9rem; text-align: center; z-index: 5; }
.mr-stun { background: radial-gradient(circle, rgb(60 20 40 / .55), rgb(20 10 30 / .72)); backdrop-filter: blur(1.5px) saturate(.6); }
.mr-frost { background: radial-gradient(circle, rgb(125 211 252 / .14), rgb(56 189 248 / .32)); box-shadow: inset 0 0 40px rgb(186 230 253 / .65); backdrop-filter: blur(1px) saturate(.5) hue-rotate(10deg); }
.mr-ready { background: rgb(14 12 29 / .22); pointer-events: none; place-items: start center; padding-top: 12px; }
.mr-dizzy { display: inline-block; font-size: 3.2rem; animation: mr-dizzy 1.1s ease-in-out infinite; }
@keyframes mr-dizzy { 0%, 100% { transform: rotate(-14deg) translateX(-4px); } 50% { transform: rotate(14deg) translateX(4px); } }
.mr-orbit { position: absolute; inset: -18px; animation: mr-spin 1.6s linear infinite; }
@keyframes mr-spin { to { transform: rotate(360deg); } }
.mr-count { animation: mr-count .5s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes mr-count { 0% { transform: scale(1.7); opacity: 0; } 100% { transform: none; opacity: 1; } }
.mr-go { animation: mr-go .9s ease-out both; }
@keyframes mr-go { 0% { transform: scale(.4); opacity: 0; } 30% { transform: scale(1.2); opacity: 1; } 100% { transform: scale(1.6); opacity: 0; } }
.mr-chip { transition: border-color .25s, background-color .25s, transform .2s; }
.mr-bump { animation: mr-bump .35s cubic-bezier(.2,1.6,.4,1); }
@keyframes mr-bump { 0% { transform: scale(1.35); } 100% { transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .mr-dizzy, .mr-orbit, .mr-count, .mr-go, .mr-bump { animation: none; }
}
`;

/** Server time, refreshed every `ms` (kept in state so rendering stays pure). */
function useServerClock(serverNow: () => number, ms: number) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(id);
  }, [serverNow, ms]);
  return now;
}

// Players may pick look-alike colours in the lobby; on a territory board that's unreadable,
// so a colour too close to an earlier one is swapped for the free palette colour that stands
// out most. Deterministic, so every screen agrees.
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function oklab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = toLinear(((n >> 16) & 255) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const colorDistance = (a: string, b: string) => {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
const PALETTE = PLAYER_COLORS.map((c) => c.toLowerCase());
function displayColors(ids: string[], byId: Record<string, Player>): string[] {
  const used: string[] = [];
  return ids.map((id) => {
    let c = (byId[id]?.color ?? "").toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(c) || used.some((u) => colorDistance(u, c) < 0.12)) {
      let best = -1;
      for (const p of PALETTE) {
        if (used.includes(p)) continue;
        const d = Math.min(Infinity, ...used.map((u) => colorDistance(u, p)));
        if (d > best) [best, c] = [d, p];
      }
    }
    used.push(c);
    return c;
  });
}

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function MineRush(props: Props) {
  if (!props.view) {
    return (
      <div className="card grid min-h-[40vh] place-items-center p-6">
        <Note>Burying the mines…</Note>
      </div>
    );
  }
  return <Game {...props} view={props.view} />;
}

function Game({ view, byId, isPlayer, act, serverNow, onEvent, accent }: Props & { view: MrView }) {
  const [store] = useState(() => {
    const s = new MineStore();
    s.applyView(view);
    return s;
  });
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const now = useServerClock(serverNow, 250);
  const [mode, setMode] = useState<Mode>("dig");
  const [news, setNews] = useState({ text: "", n: 0 });

  // Full views (rare) and op events (frequent) both land in the store; newer wins.
  useEffect(() => {
    store.applyView(view, performance.now());
  }, [store, view]);

  const syncAt = useRef(0);
  useEffect(
    () =>
      onEvent((raw) => {
        const e = raw as MrEvent | null;
        if (!e || typeof e !== "object") return;
        if (e.t === "op") {
          const t = performance.now();
          if (store.applyOp(e, t) === "gap" && t - syncAt.current > 1500) {
            syncAt.current = t;
            act({ type: "sync" });
          }
          if (e.p === store.me) {
            let text = "";
            if (e.x.length) text = `Boom! ${e.d} points, stunned.`;
            else text = `Opened ${e.o.length} cell${e.o.length === 1 ? "" : "s"}, ${e.d >= 0 ? "+" : ""}${e.d}.`;
            for (const [, k] of e.k) text += ` ${ITEMS[k].label}!`;
            if (e.sm) text += ` Scan flagged ${e.sm.length} mine${e.sm.length === 1 ? "" : "s"}.`;
            setNews((p) => ({ text, n: p.n + 1 }));
            if (e.x.length) feedback("hit");
            else if (e.k.length) feedback("score");
            else if (e.o.length) sfx("pop");
          } else if (e.fz && store.me >= 0) {
            setNews((p) => ({ text: "Frozen!", n: p.n + 1 }));
            feedback("bump");
          } else if (e.x.length) sfx("bump"); // someone else hit a mine
        } else if (e.t === "no") {
          store.nack(e);
          sfx("error");
        }
        else if (e.t === "full" && e.v) store.applyView(e.v, performance.now());
      }),
    [onEvent, store, act],
  );

  useEffect(() => {
    const id = setInterval(() => store.prune(performance.now()), 200);
    return () => clearInterval(id);
  }, [store]);

  // ----- derived -----
  const ids = view.ids;
  const idKey = ids.join(",");
  const colors = useMemo(() => displayColors(idKey ? idKey.split(",") : [], byId), [idKey, byId]);
  const names = useMemo(() => (idKey ? idKey.split(",") : []).map((id) => byId[id]?.name ?? "Someone"), [idKey, byId]);
  const me = view.you;
  const myRow = me >= 0 ? store.ps[me] : undefined;
  const live = isPlayer && me >= 0 && view.phase === "play";
  const stunLeft = myRow && live ? Math.max(0, myRow.stun - now) : 0;
  const frozenLeft = myRow && live ? Math.max(0, myRow.frozen - now) : 0;
  const left = view.safe - store.opened;
  const flagsUsed = store.flagCount();

  // ----- actions (instant locally, then the server confirms) -----
  const blocked = useCallback(() => {
    const r = store.ps[store.me];
    const t = serverNow();
    return !r || t < r.stun || t < r.frozen;
  }, [store, serverNow]);

  const chord = useCallback(
    (cell: number) => {
      const n = store.cells[cell];
      if (n < 1 || n > 8) return;
      const around = neighbors(store.w, store.h, cell);
      const flagged = around.filter((c) => store.cells[c] === HIDDEN && store.flags[c]).length;
      const targets = around.filter((c) => store.cells[c] === HIDDEN && !store.flags[c] && !store.pending.has(c));
      if (flagged !== n || !targets.length) return;
      store.dig(targets, cell, performance.now());
      act({ type: "chord", cell });
    },
    [store, act],
  );

  const onDig = useCallback(
    (cell: number) => {
      if (blocked()) return;
      const code = store.cells[cell];
      if (code === HIDDEN) {
        if (store.flags[cell] || store.pending.has(cell)) return;
        store.dig([cell], cell, performance.now());
        act({ type: "open", cell });
      } else chord(cell);
    },
    [store, act, blocked, chord],
  );

  const onFlag = useCallback(
    (cell: number) => {
      if (blocked()) return;
      if (store.cells[cell] !== HIDDEN) return chord(cell);
      if (store.pending.has(cell)) return;
      const on = !store.flags[cell];
      if (on && store.flagCount() >= view.mines) return;
      const q = store.flag(cell, on);
      act({ type: "flag", cell, on, q });
    },
    [store, act, blocked, chord, view.mines],
  );

  // ----- status line -----
  let leader = -1;
  store.ps.forEach((r, i) => {
    if (leader < 0 || r.score > store.ps[leader].score) leader = i;
  });
  const startsIn = view.startsAt - now;

  // Countdown ticks for the last 3 seconds, then "go" as the field opens.
  const count = view.phase === "ready" ? Math.max(1, Math.ceil(startsIn / 1000)) : view.phase === "play" ? 0 : -1;
  const lastCount = useRef(count);
  useEffect(() => {
    const prev = lastCount.current;
    lastCount.current = count;
    if (count === prev) return;
    if (count >= 1 && count <= 3) sfx("tick");
    else if (count === 0 && prev > 0) {
      if (isPlayer) feedback("go");
      else sfx("go");
    }
  }, [count, isPlayer]);
  let status: ReactNode;
  if (view.phase === "ready") status = <>Get ready… the field opens in {Math.max(1, Math.ceil(startsIn / 1000))}</>;
  else if (view.phase === "over")
    status =
      view.why === "cleared" ? "🧹 Field cleared! Final scores" : view.why === "abandoned" ? "🏳️ Everyone left the field" : "⏰ Time's up! Final scores";
  else if (!isPlayer || me < 0)
    status =
      leader >= 0 ? (
        <>
          👀 <span style={{ color: colors[leader] }}>{names[leader]}</span> leads · {left} safe cells left
        </>
      ) : (
        <>👀 {left} safe cells left</>
      );
  else if (stunLeft > 0) status = <>😵‍💫 Boom! Stunned for {Math.ceil(stunLeft / 1000)}s</>;
  else if (frozenLeft > 0)
    status = (
      <>
        🥶 Frozen by <span style={{ color: colors[myRow!.frozenBy] }}>{names[myRow!.frozenBy] ?? "someone"}</span>!
      </>
    );
  else status = <>⛏️ Dig! {left} safe cells left</>;

  const bannerKey = `${view.phase}-${stunLeft > 0}-${frozenLeft > 0}`;

  // ----- overlay over the board -----
  let overlay: ReactNode = null;
  if (view.phase === "ready" && startsIn > 0) {
    const n = Math.ceil(startsIn / 1000);
    overlay = (
      <div className="mr-veil mr-ready" aria-hidden>
        <div className="flex items-center gap-3 rounded-full border border-line bg-ink/85 py-1.5 pr-4 pl-2 shadow-lg">
          <span
            key={n}
            className="mr-count grid size-11 place-items-center rounded-full font-display text-3xl font-extrabold text-ink"
            style={{ background: accent }}
          >
            {n}
          </span>
          <span className="text-sm font-semibold">Study the opening…</span>
        </div>
      </div>
    );
  } else if (view.phase === "play" && now - view.startsAt < 900 && now >= view.startsAt) {
    overlay = (
      <div className="mr-veil pointer-events-none" aria-hidden>
        <div className="mr-go font-display text-6xl font-extrabold" style={{ color: accent, textShadow: "0 4px 24px #000c" }}>
          GO!
        </div>
      </div>
    );
  } else if (stunLeft > 0) {
    overlay = (
      <div className="mr-veil mr-stun" role="status">
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-black/45 px-6 py-4">
          <span className="relative inline-block">
            <span className="mr-orbit" aria-hidden>
              <span className="absolute top-0 left-1/2 -ml-2 text-lg">💫</span>
              <span className="absolute bottom-0 left-1/2 -ml-2 text-lg">⭐</span>
            </span>
            <span className="mr-dizzy" aria-hidden>
              😵‍💫
            </span>
          </span>
          <span className="font-display text-2xl font-extrabold text-red-200">Stunned!</span>
          <span className="rounded-full bg-black/40 px-3 py-1 font-mono text-sm font-bold tabular-nums">
            {(Math.ceil(stunLeft / 100) / 10).toFixed(1)}s · −{MINE_PENALTY}
          </span>
        </div>
      </div>
    );
  } else if (frozenLeft > 0) {
    overlay = (
      <div className="mr-veil mr-frost" role="status">
        <div className="flex flex-col items-center gap-1 rounded-2xl bg-sky-950/60 px-6 py-4">
          <span className="text-5xl" aria-hidden>
            🥶
          </span>
          <span className="font-display text-2xl font-extrabold text-sky-100">Frozen!</span>
          <span className="text-sm text-sky-100/90">
            by <b style={{ color: colors[myRow!.frozenBy] }}>{names[myRow!.frozenBy] ?? "someone"}</b>
          </span>
        </div>
      </div>
    );
  }

  const tools =
    live || (isPlayer && view.phase === "ready") ? (
      <div className="flex rounded-xl border border-line bg-panel-2 p-0.5" role="group" aria-label="Tap action">
        {(["dig", "flag"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            className={`h-10 rounded-[0.6rem] px-3 text-sm font-bold transition-colors ${
              mode === m ? "text-ink" : "text-muted hover:text-text"
            }`}
            style={mode === m ? { background: m === "dig" ? accent : "#fbbf24" } : undefined}
            onClick={() => setMode(m)}
          >
            {m === "dig" ? "⛏️ Dig" : "🚩 Flag"}
          </button>
        ))}
      </div>
    ) : null;

  const stats = (
    <>
      <span title="Mines on the field">💣 {view.mines}</span>
      {me >= 0 && (
        <span title="Your flags (private)">
          🚩 {view.phase === "over" && view.fin ? view.fin[me].right + view.fin[me].wrong : flagsUsed}
        </span>
      )}
      <span title="Safe cells left">⬜ {Math.max(0, left)}</span>
    </>
  );

  return (
    <div className="mx-auto flex w-full max-w-[56rem] flex-col gap-3 pb-14 sm:pb-2">
      <style href="ruckus-minerush" precedence="default">
        {CSS}
      </style>

      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={bannerKey} accent={stunLeft > 0 ? "#ef4444" : frozenLeft > 0 ? "#7dd3fc" : accent}>
          <span className="block truncate">{status}</span>
        </StatusBanner>
      </div>

      {view.phase !== "over" && (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            {view.phase === "ready" ? (
              <TimerBar endsAt={view.startsAt} total={READY_MS} serverNow={serverNow} color={accent} />
            ) : (
              <TimerBar endsAt={view.endsAt} total={PLAY_MS} serverNow={serverNow} color={accent} />
            )}
          </div>
          <span className="w-12 text-right font-mono text-sm font-bold tabular-nums" aria-label="Time left">
            {fmtClock(view.phase === "ready" ? PLAY_MS : view.endsAt - now)}
          </span>
        </div>
      )}

      <Scores view={view} store={store} colors={colors} byId={byId} now={now} leader={leader} />

      {view.abandonAt && view.phase !== "over" && (
        <p role="status" className="card border-amber-400/50 px-3 py-2 text-center text-sm">
          📡 Everyone&apos;s disconnected. The game ends in {Math.max(0, Math.ceil((view.abandonAt - now) / 1000))}s unless
          someone comes back.
        </p>
      )}

      <Board
        store={store}
        version={version}
        colors={colors}
        names={names}
        mode={mode}
        live={live}
        over={view.phase === "over"}
        myColor={me >= 0 ? colors[me] : "#fff"}
        onDig={onDig}
        onFlag={onFlag}
        overlay={overlay}
        tools={tools}
        stats={stats}
      />

      <span className="sr-only" aria-live="assertive">
        {news.n > 0 ? news.text : ""}
      </span>

      {view.phase === "over" && view.fin ? (
        <Standings view={view} fin={view.fin} colors={colors} byId={byId} />
      ) : (
        <Legend isPlayer={isPlayer} solo={view.ids.length === 1} />
      )}
    </div>
  );
}

// ---------- scores strip ----------

function Scores({
  view,
  store,
  colors,
  byId,
  now,
  leader,
}: {
  view: MrView;
  store: MineStore;
  colors: string[];
  byId: Record<string, Player>;
  now: number;
  leader: number;
}) {
  const n = view.ids.length;
  const cols = n <= 4 ? n : Math.ceil(n / 2);
  const playing = view.phase === "play";
  return (
    <ol
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(0, 1fr))` }}
      aria-label="Scores"
    >
      {view.ids.map((id, i) => {
        const p = byId[id];
        const r = store.ps[i];
        if (!r) return null;
        const c = colors[i];
        const stunned = playing && r.stun > now;
        const frozen = playing && r.frozen > now;
        const isMe = i === view.you;
        const lead = leader === i && r.score > 0;
        const away = p?.connected === false;
        const state = away ? "offline" : stunned ? "stunned" : frozen ? "frozen" : "";
        return (
          <li
            key={id}
            className={`mr-chip flex min-w-0 items-center gap-1.5 rounded-xl border px-1.5 py-1 ${away ? "opacity-50" : ""}`}
            style={{
              borderColor: isMe ? c : `${c}50`,
              background: stunned ? "#7f1d1d66" : frozen ? "#0c4a6e77" : `${c}14`,
              boxShadow: isMe ? `0 0 0 1px ${c}` : undefined,
            }}
          >
            <span aria-hidden className="relative grid size-7 shrink-0 place-items-center rounded-lg text-lg leading-none" style={{ background: `${c}22` }}>
              <Avatar id={p?.avatar ?? "🙂"} />
              {lead && <span className="absolute -top-2.5 -right-1.5 text-xs">👑</span>}
              {state && (
                <span className="absolute -right-1.5 -bottom-1.5 text-xs">{away ? "📡" : stunned ? "😵" : "🥶"}</span>
              )}
            </span>
            <span className="min-w-0 flex-1 leading-none">
              <span className="block truncate text-[11px] font-bold" style={{ color: c }}>
                {isMe ? "You" : (p?.name ?? "Player")}
                {state && <span className="sr-only"> ({state})</span>}
              </span>
              <span key={r.score} className="mr-bump mt-0.5 inline-block font-display text-base leading-none font-extrabold tabular-nums">
                {r.score}
                <span className="sr-only"> points</span>
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- help ----------

function Legend({ isPlayer, solo }: { isPlayer: boolean; solo: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 text-center text-xs text-muted">
      <p className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        <span>⬜ +1 per cell</span>
        <span>
          {ITEMS.g.emoji} +{GEM_POINTS}
        </span>
        <span>{ITEMS.s.emoji} flags mines near it</span>
        {!solo && <span>{ITEMS.f.emoji} freezes rivals</span>}
        <span>💥 −{MINE_PENALTY} + stun</span>
        <span>
          🚩 ±{FLAG_POINTS} at the end
        </span>
      </p>
      {isPlayer ? (
        <>
          <p className="hidden sm:block">Click to dig · right-click to flag · click a number to clear around it · arrows + Space/F</p>
          <p className="sm:hidden">Tap to dig · long-press to flag · tap a number to clear around it · pinch to zoom</p>
        </>
      ) : (
        <Note>👀 You&apos;re watching. Everyone digs the same field at once; flags are private.</Note>
      )}
    </div>
  );
}

// ---------- final standings ----------

const MEDALS = ["🥇", "🥈", "🥉"];

function Standings({
  view,
  fin,
  colors,
  byId,
}: {
  view: MrView;
  fin: FinalRow[];
  colors: string[];
  byId: Record<string, Player>;
}) {
  const order = fin.map((_, i) => i).sort((a, b) => fin[b].score - fin[a].score);
  const rank = (i: number) => 1 + fin.filter((f) => f.score > fin[i].score).length;
  return (
    <section className="card animate-rise flex flex-col gap-2 p-3" aria-label="Final standings">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label">Final standings</span>
        {view.you >= 0 && <span className="text-[11px] text-muted">✓ right flag +{FLAG_POINTS} · ✗ wrong −{FLAG_POINTS}</span>}
      </div>
      <ol className="flex flex-col gap-1.5">
        {order.map((i) => {
          const f = fin[i];
          const p = byId[view.ids[i]];
          const r = rank(i);
          return (
            <li
              key={view.ids[i]}
              className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-xl px-2 py-1.5"
              style={{
                background: i === view.you ? `${colors[i]}1c` : undefined,
                border: `1px solid ${r === 1 ? colors[i] + "88" : "transparent"}`,
              }}
            >
              <span className="row-span-2 text-center text-lg" aria-label={`Rank ${r}`}>
                {MEDALS[r - 1] ?? r}
              </span>
              <span className="flex min-w-0">
                <PlayerChip player={p} size="sm" />
              </span>
              <span className="row-span-2 font-display text-2xl font-extrabold tabular-nums" style={{ color: colors[i] }}>
                {f.score}
              </span>
              <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-muted">
                <span title="Cells opened">⛏️ {f.opened}</span>
                {f.gems > 0 && <span title="Gems">💎 {f.gems}</span>}
                {f.booms > 0 && <span title="Mines hit">💥 {f.booms}</span>}
                {f.scans > 0 && <span title="Scans">🔍 {f.scans}</span>}
                {f.freezes > 0 && <span title="Freezes">❄️ {f.freezes}</span>}
                {f.right + f.wrong > 0 && (
                  <span title="Flags right / wrong" className="whitespace-nowrap">
                    🚩 {f.right}✓ {f.wrong}✗{" "}
                    <b className={f.flagPts > 0 ? "text-green-400" : f.flagPts < 0 ? "text-red-400" : ""}>
                      {f.flagPts >= 0 ? "+" : ""}
                      {f.flagPts}
                    </b>
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
