"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import { PLAYER_COLORS, type Player } from "@/shared/types";
import type { TurfAction, TurfEvent, TurfView } from "./server";
import { DIRS, FREEZE_MS, PLAY_MS, POWER_INFO } from "./shared";
import { TurfBoard, parsePainters, rgba, textureCss, type Painter } from "./board";
import { TurfPredictor } from "./predict";

type Props = GameClientProps<TurfView, TurfAction>;

const KEY_DIR: Record<string, number> = {
  ArrowUp: 0,
  ArrowRight: 1,
  ArrowDown: 2,
  ArrowLeft: 3,
  KeyW: 0,
  KeyD: 1,
  KeyS: 2,
  KeyA: 3,
};
const ARROWS = ["▲", "▶", "▼", "◀"];
const MEDALS = ["🥇", "🥈", "🥉"];

export default function TurfWar(props: Props) {
  if (!props.view) {
    return (
      <div className="card grid min-h-[40vh] place-items-center p-6">
        <Note>Rolling out the map…</Note>
      </div>
    );
  }
  return <TurfGame {...props} view={props.view} />;
}

/** Server time, refreshed every `ms` (kept in state so rendering stays pure). */
function useServerClock(serverNow: () => number, ms: number) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(id);
  }, [serverNow, ms]);
  return now;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** sRGB hex -> OKLab, for judging how alike two turf colours look. */
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
function colorDistance(a: string, b: string) {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
const PALETTE = PLAYER_COLORS.map((c) => c.toLowerCase());

/**
 * Turf colour per painter. Players may pick the same (or a look-alike) colour in the lobby;
 * on a territory map that would be unreadable, so a colour too close to one taken earlier is
 * swapped for the free palette colour that stands out most. Deterministic, so every screen
 * agrees (and it matches Snake Brawl's rule).
 */
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

/** Competition ranking (ties share a place), 1-based. */
function ranks(painters: Painter[]): number[] {
  return painters.map((p) => 1 + painters.filter((q) => q.n > p.n).length);
}

const pctText = (n: number, total: number, digits = 0) => ((100 * n) / total).toFixed(digits);
/** Remaining time with one decimal, rounded up so a running effect never reads "0.0". */
const secondsText = (ms: number) => (Math.ceil(ms / 100) / 10).toFixed(1);

function TurfGame({ view, byId, isPlayer, act, serverNow, onEvent, accent }: Props & { view: TurfView }) {
  const now = useServerClock(serverNow, 200);
  const secsLeft = useSecondsLeft(view.endsAt, serverNow);
  const painters = useMemo(() => parsePainters(view.players), [view.players]);
  const ids = painters.map((p) => p.id).join(",");
  const colors = useMemo(() => displayColors(ids ? ids.split(",") : [], byId), [ids, byId]);
  const avatars = painters.map((p) => byId[p.id]?.avatar ?? "🖌️");
  const away = painters.map((p) => byId[p.id]?.connected === false);
  const names = painters.map((p) => byId[p.id]?.name ?? "Someone");
  const total = view.w * view.h;
  const meIdx = view.you;
  const mine: Painter | undefined = meIdx >= 0 ? painters[meIdx] : undefined;
  const canSteer = isPlayer && !!mine && view.phase !== "over";
  const place = ranks(painters);

  // ----- steering -----
  // Runs your own painter a network trip ahead so turns show at once (see predict.ts).
  const [pred] = useState(() => new TurfPredictor());
  // Last direction you pressed (lights up the D-pad until the server has turned you).
  const [pressed, setPressed] = useState<{ dir: number; tick: number } | null>(null);
  const steer = useCallback(
    (dir: number) => {
      // The predictor drops presses the server would ignore and stamps the tick the turn lands on.
      const stamp = pred.press(dir, serverNow(), performance.now());
      if (!stamp) return;
      setPressed({ dir, tick: pred.tick });
      act({ type: "turn", dir: DIRS[dir], ...stamp });
    },
    [act, pred, serverNow],
  );

  useEffect(() => {
    if (!canSteer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const dir = KEY_DIR[e.key] ?? KEY_DIR[e.code];
      if (dir === undefined) return;
      e.preventDefault(); // arrows would scroll the page
      if (!e.repeat) steer(dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSteer, steer]);

  // ----- screen-reader news from transient events -----
  const [news, setNews] = useState({ text: "", n: 0 });
  const infoRef = useRef({ meIdx, names });
  useEffect(() => {
    infoRef.current = { meIdx, names };
  });
  useEffect(
    () =>
      onEvent((raw) => {
        const e = raw as TurfEvent | null;
        if (!e || typeof e !== "object") return;
        const { meIdx: mi, names: nm } = infoRef.current;
        let text = "";
        if (e.type === "capture" && e.by === mi) text = `You filled a loop: +${e.n} tiles!`;
        else if (e.type === "power" && e.by === mi) text = `${POWER_INFO[e.kind]?.label ?? "Power-up"}!`;
        else if (e.type === "power" && e.kind === "freeze" && mi >= 0) text = `Frozen by ${nm[e.by] ?? "someone"}!`;
        if (text) setNews((prev) => ({ text, n: prev.n + 1 }));
      }),
    [onEvent],
  );

  // ----- derived status -----
  const frozenFor = mine && view.phase === "play" ? Math.min(FREEZE_MS, Math.max(0, mine.frozen - now)) : 0;
  const dashFor = mine && view.phase === "play" ? Math.max(0, mine.dash - now) : 0;
  const leaderIdx = painters.reduce((best, p, i) => (best === -1 || p.n > painters[best].n ? i : best), -1);
  const showGo = view.phase === "play" && now - (view.endsAt - PLAY_MS) < 900;
  const abandonIn =
    view.abandonAt && view.phase !== "over" ? Math.max(0, Math.ceil((view.abandonAt - now) / 1000)) : null;

  let status: ReactNode;
  if (view.phase === "countdown") {
    status = mine ? (
      <>
        Get ready! Heading{" "}
        <span style={{ color: colors[meIdx] }}>
          {ARROWS[mine.dir]} {DIRS[mine.dir]}
        </span>
      </>
    ) : (
      "Get ready…"
    );
  } else if (view.phase === "play") {
    if (!mine) {
      status =
        leaderIdx >= 0 ? (
          <>
            🖌️ <span style={{ color: colors[leaderIdx] }}>{names[leaderIdx]}</span> leads with{" "}
            {pctText(painters[leaderIdx].n, total)}%
          </>
        ) : (
          "🖌️ Painting…"
        );
    } else if (frozenFor > 0) status = "🧊 Frozen! Hang tight…";
    else if (mine.out > 0) status = `↩️ Loop open (${mine.out}): get home to fill it`;
    else if (dashFor > 0) status = "⚡ Dash! Double speed";
    else status = "🖌️ Paint! Close loops to fill";
  } else {
    status = view.endReason === "abandoned" ? "🏳️ Ended early: not enough painters" : "🏁 Time! Here's the final map";
  }

  const phaseLine =
    view.phase === "countdown"
      ? "Get ready."
      : view.phase === "play"
        ? secsLeft <= 10
          ? "Ten seconds left!"
          : "Go! Paint the map."
        : view.endReason === "abandoned"
          ? "The game ended early: not enough painters. Final standings are below the map."
          : "Time is up. Final standings are below the map.";

  const boardLabel =
    `Turf map, ${view.w} by ${view.h} tiles. ` +
    (mine ? `You are the ${avatars[meIdx]} painter at column ${mine.x + 1}, row ${mine.y + 1}, heading ${DIRS[mine.dir]}. ` : "") +
    (leaderIdx >= 0 ? `${names[leaderIdx]} leads with ${pctText(painters[leaderIdx].n, total)}% of the map.` : "");

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3">
      <StatusBanner accent={accent}>
        <span className="block text-base @md:text-xl">{status}</span>
      </StatusBanner>

      {view.phase === "play" && (
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <TimerBar endsAt={view.endsAt} total={PLAY_MS} serverNow={serverNow} color={secsLeft <= 10 ? "#f87171" : accent} />
          </div>
          <span
            className={`w-12 text-right font-mono text-sm font-bold tabular-nums ${secsLeft <= 10 ? "text-red-400" : "text-muted"}`}
          >
            {secsLeft}s<span className="sr-only"> left</span>
          </span>
        </div>
      )}

      <TurfBoard
        view={view}
        colors={colors}
        avatars={avatars}
        away={away}
        me={meIdx}
        steer={canSteer ? steer : null}
        pred={pred}
        serverNow={serverNow}
        onEvent={onEvent}
        label={boardLabel}
      >
        {view.phase === "countdown" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-ink/25">
            <span
              key={secsLeft}
              className="animate-pop font-display text-6xl font-extrabold text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.6)] @md:text-8xl"
            >
              {Math.max(1, secsLeft)}
            </span>
          </div>
        )}
        {showGo && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span
              className="animate-pop font-display text-6xl font-extrabold drop-shadow-[0_3px_0_rgba(0,0,0,0.7)] @md:text-8xl"
              style={{ color: accent }}
            >
              GO!
            </span>
          </div>
        )}
      </TurfBoard>

      {abandonIn !== null && (
        <div className="card animate-rise border-brand-2/50 px-4 py-2 text-center text-sm">
          <span aria-hidden>⏳ Not enough painters online. The game ends in {abandonIn}s unless someone reconnects.</span>
          <span className="sr-only" role="status">
            Not enough painters online. The game ends in a few seconds unless someone reconnects.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3 @xl:flex-row">
        {canSteer && mine && (
          <div className="flex items-stretch gap-3 @xl:shrink-0">
            <DPad
              className="hidden @max-xl:grid pointer-coarse:grid"
              current={pressed && view.tick <= pressed.tick + 4 ? pressed.dir : mine.dir}
              color={colors[meIdx]}
              avatar={avatars[meIdx]}
              onTurn={steer}
            />
            <MyStats
              painter={mine}
              idx={meIdx}
              color={colors[meIdx]}
              avatar={avatars[meIdx]}
              place={place[meIdx]}
              of={painters.length}
              total={total}
              frozenFor={frozenFor}
              dashFor={dashFor}
              hint={view.phase === "countdown" ? "Leave your turf, loop back, and everything inside turns yours." : null}
            />
          </div>
        )}
        <Standings
          painters={painters}
          colors={colors}
          names={names}
          avatars={avatars}
          away={away}
          me={meIdx}
          total={total}
          place={place}
          final={view.phase === "over"}
          winners={view.winners ?? null}
        />
      </div>

      {canSteer && (
        <p className="hidden text-center text-xs text-muted @xl:block">
          Steer with <Kbd>←</Kbd>
          <Kbd>↑</Kbd>
          <Kbd>→</Kbd>
          <Kbd>↓</Kbd> or <Kbd>W</Kbd>
          <Kbd>A</Kbd>
          <Kbd>S</Kbd>
          <Kbd>D</Kbd>, or swipe on the map. Turns queue up, so tap ahead.
        </p>
      )}
      {!isPlayer && <Note>👀 You&apos;re watching this round. Jump in next game!</Note>}

      <p className="sr-only" aria-live="polite">
        {phaseLine}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {news.text}
        {news.n % 2 ? "​" : ""}
      </p>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-grid min-w-5 place-items-center rounded border border-line bg-panel-2 px-1 font-mono text-[11px] text-text">
      {children}
    </kbd>
  );
}

function DPad({
  className,
  current,
  color,
  avatar,
  onTurn,
}: {
  className: string;
  current: number;
  color: string;
  avatar: string;
  onTurn: (dir: number) => void;
}) {
  const button = (dir: number, area: string) => (
    <button
      type="button"
      aria-label={`Steer ${DIRS[dir]}`}
      className="btn size-12 touch-none p-0 text-lg"
      style={{
        gridArea: area,
        ...(current === dir ? { borderColor: color, background: rgba(color, 0.22), color } : {}),
      }}
      onPointerDown={(e) => {
        e.preventDefault(); // instant response; no focus ring flash, no double fire
        onTurn(dir);
      }}
      onClick={(e) => {
        if (e.detail === 0) onTurn(dir); // keyboard activation
      }}
    >
      <span aria-hidden>{ARROWS[dir]}</span>
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Steering pad"
      className={`${className} shrink-0 select-none gap-1.5`}
      style={{ gridTemplateAreas: '". u ." "l c r" ". d ."', gridTemplateColumns: "repeat(3, 3rem)" }}
    >
      {button(0, "u")}
      {button(3, "l")}
      <span
        aria-hidden
        className="grid size-12 place-items-center rounded-full text-2xl"
        style={{ gridArea: "c", background: rgba(color, 0.18), boxShadow: `inset 0 0 0 2px ${rgba(color, 0.5)}` }}
      >
        {avatar}
      </span>
      {button(1, "r")}
      {button(2, "d")}
    </div>
  );
}

function MyStats({
  painter,
  idx,
  color,
  avatar,
  place,
  of,
  total,
  frozenFor,
  dashFor,
  hint,
}: {
  painter: Painter;
  idx: number;
  color: string;
  avatar: string;
  place: number;
  of: number;
  total: number;
  frozenFor: number;
  dashFor: number;
  hint: string | null;
}) {
  return (
    <div className="card flex min-w-0 flex-1 flex-col justify-center gap-2 px-3 py-2.5 @xl:w-56 @xl:flex-none">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-xl text-2xl"
          style={{ background: textureCss(idx, color), boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.25)" }}
        >
          {avatar}
        </span>
        <div className="min-w-0">
          {/* Re-keyed per whole percent so the number pops as your turf grows or shrinks. */}
          <div
            key={pctText(painter.n, total)}
            className="animate-pop font-display text-2xl leading-none font-extrabold tabular-nums"
            style={{ color }}
          >
            {pctText(painter.n, total)}%
          </div>
          <div className="mt-1 flex flex-wrap gap-x-1.5 text-xs leading-snug text-muted">
            <span className="whitespace-nowrap">{place === 1 ? "🏆 1st" : `#${place} of ${of}`}</span>
            <span className="whitespace-nowrap">{painter.n} tiles</span>
          </div>
        </div>
      </div>
      {hint && <p className="text-xs leading-snug text-muted">{hint}</p>}
      {(frozenFor > 0 || dashFor > 0 || painter.out > 0) && (
        <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
          {frozenFor > 0 && (
            <span className="animate-pop rounded-full bg-sky-400/15 px-2 py-0.5 text-sky-300">
              🧊 {secondsText(frozenFor)}s
            </span>
          )}
          {dashFor > 0 && (
            <span className="animate-pop rounded-full bg-yellow-400/15 px-2 py-0.5 text-yellow-300">
              ⚡ {secondsText(dashFor)}s
            </span>
          )}
          {painter.out > 0 && (
            <span className="rounded-full px-2 py-0.5" style={{ background: rgba(color, 0.15), color }}>
              ↩️ loop {painter.out}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Standings({
  painters,
  colors,
  names,
  avatars,
  away,
  me,
  total,
  place,
  final,
  winners,
}: {
  painters: Painter[];
  colors: string[];
  names: string[];
  avatars: string[];
  away: boolean[];
  me: number;
  total: number;
  place: number[];
  final: boolean;
  winners: string[] | null;
}) {
  const order = painters.map((_, i) => i).sort((a, b) => painters[b].n - painters[a].n || a - b);
  const top = Math.max(1, ...painters.map((p) => p.n));
  const claimed = painters.reduce((sum, p) => sum + p.n, 0);
  return (
    <section
      className={`card min-w-0 flex-1 p-3 ${final ? "animate-rise" : ""}`}
      aria-label={final ? "Final standings" : "Territory"}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="label">{final ? "Final standings" : "Territory"}</h2>
        <span className="text-xs text-muted tabular-nums">{pctText(total - claimed, total)}% unclaimed</span>
      </div>
      <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-panel-2" aria-hidden>
        {order.map((i) => (
          <div
            key={painters[i].id}
            className="h-full transition-[width] duration-300 ease-out"
            style={{ width: `${(100 * painters[i].n) / total}%`, background: colors[i] }}
          />
        ))}
      </div>
      <ol className={`grid gap-x-4 gap-y-1 ${final ? "" : "@md:grid-cols-2"}`}>
        {order.map((i) => {
          const p = painters[i];
          const won = final && !!winners?.includes(p.id);
          return (
            <li
              key={p.id}
              className={`flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 ${i === me ? "bg-panel-2" : ""} ${won ? "ring-1" : ""}`}
              style={won ? { ["--tw-ring-color" as string]: colors[i] } : undefined}
            >
              <span
                className={`w-6 shrink-0 text-center tabular-nums ${final && place[i] <= 3 ? "text-lg leading-none" : "text-sm text-muted"}`}
              >
                <span className="sr-only">Place </span>
                {final && place[i] <= 3 ? MEDALS[place[i] - 1] : place[i]}
              </span>
              <span
                aria-hidden
                className="relative grid size-7 shrink-0 place-items-center rounded-md text-base"
                style={{
                  background: textureCss(i, colors[i]),
                  opacity: away[i] ? 0.55 : 1,
                  boxShadow: i === me ? "0 0 0 2px #fff" : undefined,
                }}
              >
                {away[i] ? "💤" : avatars[i]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold" style={{ color: colors[i] }}>
                    {names[i]}
                    {i === me && <span className="sr-only"> (you)</span>}
                    {away[i] && <span className="sr-only"> (away)</span>}
                  </span>
                  <span className="shrink-0 font-mono text-sm font-bold tabular-nums">
                    {pctText(p.n, total, final ? 1 : 0)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
                  <div
                    className="h-full rounded-full transition-[width] duration-300 ease-out"
                    style={{ width: `${(100 * p.n) / top}%`, background: colors[i] }}
                  />
                </div>
              </div>
              {final && <span className="w-16 shrink-0 text-right text-xs text-muted tabular-nums">{p.n} tiles</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
