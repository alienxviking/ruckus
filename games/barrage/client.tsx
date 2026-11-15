"use client";

import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { GameClientProps } from "@/shared/client-game";
import { PLAYER_COLORS, type Player } from "@/shared/types";
import { Note, StatusBanner, TimerBar, useSecondsLeft } from "@/components/game-ui";
import type { BarrageAction, BarrageView, TankView } from "./server";
import {
  MAX_MOVE,
  MAX_POWER,
  MIN_POWER,
  WEAPONS,
  WEAPON_LIST,
  clamp,
  type Aim,
  type Weapon,
} from "./shared";
import { buildReplay, tankAlive, tankHp, type Replay } from "./replay";
import { Field } from "./field";

type Props = GameClientProps<BarrageView, BarrageAction>;

const CSS = `
.barrage-in { animation: barrage-in .32s cubic-bezier(.2,.8,.2,1) both; }
@keyframes barrage-in { from { opacity: 0; transform: translateY(6px) scale(.98); } }
.barrage-pop { animation: barrage-pop .45s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes barrage-pop { from { opacity: 0; transform: scale(.6); } }
.barrage-hurry { animation: barrage-hurry .9s ease-in-out infinite; }
@keyframes barrage-hurry { 0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,.0); } 50% { box-shadow: 0 0 0 5px rgba(245,158,11,.35); } }
.barrage-dot { display: inline-block; animation: barrage-dot 1.2s ease-in-out infinite; }
@keyframes barrage-dot { 0%, 70%, 100% { opacity: .25; } 35% { opacity: 1; } }
.barrage-range { height: 2.5rem; width: 100%; cursor: pointer; }
@media (prefers-reduced-motion: reduce) {
  .barrage-in, .barrage-pop, .barrage-hurry, .barrage-dot { animation: none; }
}
`;

const PALETTE = PLAYER_COLORS.map((c) => c.toLowerCase());

/** Each tank wears its player's colour, unless an earlier tank already wears it. */
function assignColors(key: string): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const row of key.split("\n")) {
    if (!row) continue;
    const [id, raw = ""] = row.split("\t");
    let c = /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : "";
    if (!c || used.has(c)) c = PALETTE.find((p) => !used.has(p)) ?? "#94a3b8";
    used.add(c);
    out[id] = c;
  }
  return out;
}

function subscribeReducedMotion(cb: () => void) {
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Ms since `at` on the server clock, refreshed a few times a second (0 while `at` is null). */
function useElapsed(at: number | null, serverNow: () => number) {
  const [state, setState] = useState<{ at: number | null; e: number }>({ at: null, e: 0 });
  const now = useEffectEvent(() => serverNow());
  useEffect(() => {
    if (at === null) return;
    const tick = () => setState({ at, e: now() - at });
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 200);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [at]);
  return state.at === at ? state.e : 0;
}

function isTyping(t: EventTarget | null) {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")
  );
}

function ammoOf(t: TankView, w: Weapon) {
  return w === "shell" ? Infinity : w === "heavy" ? t.heavy : t.split;
}

function normalize(a: Aim, t: TankView): Aim {
  const cap = Math.min(MAX_MOVE, t.fuel);
  return {
    angle: clamp(Math.round(a.angle), 0, 180),
    power: clamp(Math.round(a.power), MIN_POWER, MAX_POWER),
    weapon: ammoOf(t, a.weapon) > 0 ? a.weapon : "shell",
    move: clamp(Math.round(a.move), -cap, cap),
  };
}

const sameAim = (a: Aim, b: Aim) => a.angle === b.angle && a.power === b.power && a.weapon === b.weapon && a.move === b.move;

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export default function Barrage(props: Props) {
  const v = props.view;
  // Also guards against a stale view from another game arriving before ours.
  if (!v || !Array.isArray(v.tanks) || !Array.isArray(v.terrain)) return <Note>Rolling the tanks out…</Note>;
  return <Game {...props} view={v} />;
}

function Game({ view, me, players, byId, isPlayer, act, serverNow, accent }: Omit<Props, "view"> & { view: BarrageView }) {
  const reduced = useReducedMotion();
  const colorKey = players.map((p) => `${p.id}\t${p.color}`).join("\n");
  const colors = useMemo(() => assignColors(colorKey), [colorKey]);
  const rp = useMemo(() => buildReplay(view), [view]);
  const e = useElapsed(rp ? rp.r.at : null, serverNow);
  const secs = useSecondsLeft(view.phase === "aim" ? view.endsAt : null, serverNow);
  const awaySecs = useSecondsLeft(view.awayAt, serverNow);

  const mine = view.tanks.find((t) => t.id === me) ?? null;
  const mySlot = view.tanks.findIndex((t) => t.id === me);
  // During a volley the view already holds the outcome: only trust what the replay has shown so far.
  const myTankUp = !!mine && (rp && mySlot >= 0 ? tankAlive(rp, mySlot, e) : mine.alive);
  const [draft, setDraft] = useState<{ turn: number; aim: Aim } | null>(null);
  const shooting = isPlayer && view.phase === "aim" && !!mine?.alive;
  const aim: Aim | null = shooting ? (draft && draft.turn === view.turn ? draft.aim : view.aim) : null;
  const locked = !!mine?.locked;
  const canAim = shooting && !locked && !!aim && !!mine;

  // Aim changes are sent at most ~8 times a second (the latest one always gets through).
  const outbox = useRef<{ timer: ReturnType<typeof setTimeout> | null; last: number; pending: Aim | null }>({
    timer: null,
    last: 0,
    pending: null,
  });
  useEffect(() => {
    const box = outbox.current;
    return () => {
      if (box.timer !== null) clearTimeout(box.timer);
    };
  }, []);

  const update = (patch: Partial<Aim>) => {
    if (!canAim || !aim || !mine) return;
    const next = normalize({ ...aim, ...patch }, mine);
    if (sameAim(next, aim)) return;
    setDraft({ turn: view.turn, aim: next });
    const box = outbox.current;
    box.pending = next;
    if (box.timer === null) {
      const wait = Math.max(0, box.last + 120 - performance.now());
      box.timer = setTimeout(() => {
        box.timer = null;
        box.last = performance.now();
        if (box.pending) act({ type: "aim", ...box.pending });
        box.pending = null;
      }, wait);
    }
  };
  const fire = () => {
    if (!canAim || !aim) return;
    const box = outbox.current;
    if (box.timer !== null) clearTimeout(box.timer);
    box.timer = null;
    box.pending = null;
    act({ type: "fire", ...aim });
  };

  const onKey = useEffectEvent((ev: KeyboardEvent) => {
    if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || isTyping(ev.target)) return;
    if (!canAim || !aim) return;
    const step = ev.shiftKey ? 5 : 1;
    const k = ev.key;
    if (k === "ArrowLeft") update({ angle: aim.angle + step });
    else if (k === "ArrowRight") update({ angle: aim.angle - step });
    else if (k === "ArrowUp") update({ power: aim.power + step });
    else if (k === "ArrowDown") update({ power: aim.power - step });
    else if (k === "a" || k === "A") update({ move: aim.move - 5 });
    else if (k === "d" || k === "D") update({ move: aim.move + 5 });
    else if (k === "1" || k === "2" || k === "3") update({ weapon: WEAPON_LIST[Number(k) - 1] });
    else if (k === " ") {
      if (!ev.repeat) fire();
    } else return;
    ev.preventDefault();
  });
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => onKey(ev);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const name = (id: string | undefined) => (id === me ? "You" : (id && byId[id]?.name) || "Someone");
  const aliveNow = view.tanks.filter((t, i) => (rp ? tankAlive(rp, i, e) : t.alive));
  const live = view.tanks.filter((t) => t.alive && byId[t.id]?.connected !== false);
  const lockedCount = live.filter((t) => t.locked).length;
  const waitingFor = live.filter((t) => !t.locked && t.id !== me).map((t) => byId[t.id]?.name ?? "Someone");

  // ----- status copy -----
  let head: ReactNode;
  let sub: ReactNode;
  const volleyDone = !!rp && e >= rp.lastMs + 250;
  if (view.phase === "aim") {
    if (canAim) {
      head = "🎯 Aim and fire!";
      sub = view.turn === 1 ? "Drag back from your tank, or use the controls" : `${lockedCount} of ${live.length} locked in`;
    } else if (shooting && locked) {
      head = "✅ Locked in";
      sub = !waitingFor.length
        ? "Everyone's in. Here it comes!"
        : waitingFor.length > 3
          ? `Waiting for ${waitingFor.length} more…`
          : `Waiting for ${joinNames(waitingFor)}…`;
    } else if (isPlayer && mine && !myTankUp) {
      head = "💀 Your tank is scrap";
      sub = `Watch the rest fight it out · ${lockedCount} of ${live.length} locked in`;
    } else {
      head = `🎯 Turn ${view.turn}: tanks are aiming`;
      sub = `${lockedCount} of ${live.length} locked in`;
    }
  } else if (view.phase === "resolve" && rp) {
    if (!volleyDone) {
      head = "💥 Incoming!";
      sub = `Turn ${view.turn} · ${rp.r.aims.length} shell${rp.r.aims.length === 1 ? "" : "s"} in the air`;
    } else {
      [head, sub] = volleySummary(rp, view, name);
    }
  } else if (view.phase === "final") {
    const f = view.final;
    const won = !!f?.winners.includes(me);
    head = won ? (f?.reason === "draw" ? "🤝 You share the draw" : "🏆 You win!") : "🏁 Battle over";
    sub =
      f?.reason === "last"
        ? "Last tank standing"
        : f?.reason === "draw"
          ? "Everyone left went down in the same volley"
          : f?.reason === "turns"
            ? `${view.maxTurns} turns up: most armour wins`
            : "Players left the battlefield";
  }

  const hurry = canAim && secs <= 5;
  const ring =
    view.phase === "final"
      ? (colors[view.final?.winners[0] ?? ""] ?? accent)
      : canAim
        ? (colors[me] ?? accent)
        : view.phase === "resolve"
          ? "#f8717188"
          : accent + "66";

  const label =
    `Battlefield, turn ${view.turn} of ${view.maxTurns}. ` +
    `Wind ${view.wind === 0 ? "calm" : `${Math.abs(view.wind)} to the ${view.wind > 0 ? "right" : "left"}`}. ` +
    `${aliveNow.length} tank${aliveNow.length === 1 ? "" : "s"} left: ` +
    view.tanks
      .map((t, i) => {
        const hp = rp ? tankHp(rp, i, e) : t.hp;
        const up = rp ? tankAlive(rp, i, e) : t.alive;
        return `${byId[t.id]?.name ?? "Someone"} ${up ? `${hp} HP` : "destroyed"}`;
      })
      .join(", ") +
    ".";

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3 pb-16 @3xl:pb-2">
      <style href="ruckus-barrage" precedence="default">
        {CSS}
      </style>

      <div aria-live="polite" aria-atomic="true">
        <StatusBanner key={`${view.phase}-${view.turn}-${volleyDone}`} accent={accent}>
          <div className="truncate">{head}</div>
          <div className="truncate font-sans text-sm font-normal text-muted">{sub || " "}</div>
        </StatusBanner>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="truncate font-semibold">
            Turn {view.turn}
            <span className="font-normal text-muted"> of {view.maxTurns}</span>
            <span className="font-normal text-muted">
              {" "}
              · 💨 {view.wind === 0 ? "calm" : `${Math.abs(view.wind)} ${view.wind > 0 ? "→" : "←"}`}
            </span>
          </span>
          <span className={`shrink-0 tabular-nums ${hurry ? "font-bold text-amber-300" : "text-muted"}`}>
            {view.phase === "aim" ? `⏱ ${secs}s` : view.phase === "resolve" ? "💥 volley" : `🏁 ${aliveNow.length} left`}
          </span>
        </div>
        <TimerBar
          endsAt={view.phase === "final" ? 0 : view.endsAt}
          total={view.total}
          serverNow={serverNow}
          color={view.phase === "resolve" ? "#f87171" : hurry ? "#fbbf24" : accent}
        />
      </div>

      {view.awayAt !== null && (
        <p role="status" className="card barrage-in border-amber-400/50 px-3 py-2 text-center text-sm">
          <span aria-hidden>📡 </span>
          Not enough tanks have a driver. The battle ends in <b className="tabular-nums">{awaySecs}s</b> unless
          someone comes back.
        </p>
      )}

      <Field
        view={view}
        rp={rp}
        me={me}
        colors={colors}
        byId={byId}
        aim={aim}
        aiming={canAim}
        hint={canAim && view.turn === 1 && !(draft && draft.turn === view.turn)}
        onAim={(patch) => update(patch)}
        reduced={reduced}
        serverNow={serverNow}
        label={label}
        ring={ring}
      />

      {canAim && aim && mine ? (
        <Controls aim={aim} tank={mine} accent={accent} color={colors[me] ?? accent} hurry={hurry} onChange={update} onFire={fire} />
      ) : shooting && locked && aim ? (
        <LockedCard aim={aim} waitingFor={waitingFor} color={colors[me] ?? accent} />
      ) : null}

      {!isPlayer && <Note>👀 You&apos;re watching. Players aim in secret, then every shell flies at once.</Note>}
      {isPlayer && mine && !myTankUp && view.phase !== "final" && (
        <Note>Your tank is out, but stick around: the volleys are the best part.</Note>
      )}

      {view.phase === "final" ? (
        <Final view={view} byId={byId} colors={colors} me={me} />
      ) : (
        <Roster view={view} rp={rp} e={e} byId={byId} colors={colors} me={me} mySlot={mySlot} />
      )}

      {canAim && (
        <p className="hidden text-center text-xs text-muted @3xl:block">
          <Kbd>←</Kbd> <Kbd>→</Kbd> angle · <Kbd>↑</Kbd> <Kbd>↓</Kbd> power (<Kbd>Shift</Kbd> ×5) · <Kbd>A</Kbd> <Kbd>D</Kbd>{" "}
          drive · <Kbd>1</Kbd>–<Kbd>3</Kbd> weapon · <Kbd>Space</Kbd> fire
        </p>
      )}
    </div>
  );
}

function volleySummary(rp: Replay, view: BarrageView, name: (id: string | undefined) => string): [ReactNode, ReactNode] {
  const idOf = (slot: number) => view.tanks[slot]?.id;
  const deaths = rp.r.deaths;
  const dealt = new Map<number, number>();
  let self = 0;
  for (const b of rp.r.booms) {
    for (let k = 0; k + 1 < b.d.length; k += 2) {
      if (b.d[k] === b.s) self += b.d[k + 1];
      else dealt.set(b.s, (dealt.get(b.s) ?? 0) + b.d[k + 1]);
    }
  }
  let best = -1;
  let bestDmg = 0;
  for (const [s, d] of dealt) if (d > bestDmg) [best, bestDmg] = [s, d];
  const hitLine = best >= 0 ? `${name(idOf(best))} dealt the most: ${bestDmg} damage` : "";
  if (deaths.length) {
    const fell = deaths.filter((d) => d.why === "abyss").map((d) => name(idOf(d.s)));
    const ko = deaths.filter((d) => d.why === "hp").map((d) => name(idOf(d.s)));
    const parts: string[] = [];
    if (ko.length) parts.push(`${joinNames(ko)} ${ko.length === 1 && ko[0] !== "You" ? "is" : "are"} destroyed`);
    if (fell.length) parts.push(`${joinNames(fell)} fell into the abyss`);
    return [`💀 ${parts.join(" · ")}!`, hitLine || "Brutal."];
  }
  if (best >= 0) return [`💥 ${name(idOf(best))} hit${name(idOf(best)) === "You" ? "" : "s"} for ${bestDmg}!`, "Reload and go again"];
  if (self > 0) return ["🤦 Own goal!", "Only friendly fire this time"];
  return ["💨 Clean miss, all round", "Mind the wind"];
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-panel-2 px-1 py-px font-mono text-[11px] text-text">{children}</kbd>;
}

// ---------- controls ----------

function Controls({
  aim,
  tank,
  accent,
  color,
  hurry,
  onChange,
  onFire,
}: {
  aim: Aim;
  tank: TankView;
  accent: string;
  color: string;
  hurry: boolean;
  onChange: (patch: Partial<Aim>) => void;
  onFire: () => void;
}) {
  const id = useId();
  const cap = Math.min(MAX_MOVE, tank.fuel);
  const w = WEAPONS[aim.weapon];
  return (
    <section aria-label="Your shot" className="card barrage-in p-3" style={{ borderColor: color + "55" }}>
      <div className="grid gap-3 @2xl:grid-cols-[1fr_15rem] @2xl:gap-5">
        <div className="flex flex-col gap-2 @2xl:order-2">
          <div role="radiogroup" aria-label="Weapon" className="grid grid-cols-3 gap-1.5">
            {WEAPON_LIST.map((wk, i) => {
              const spec = WEAPONS[wk];
              const left = ammoOf(tank, wk);
              const on = aim.weapon === wk;
              const ammo = left === Infinity ? "∞" : `×${left}`;
              return (
                <button
                  key={wk}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${spec.name}, ${left === Infinity ? "unlimited" : `${left} left`}`}
                  aria-keyshortcuts={String(i + 1)}
                  disabled={left <= 0}
                  title={spec.blurb}
                  onClick={() => onChange({ weapon: wk })}
                  className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-text/70 disabled:cursor-not-allowed disabled:opacity-35"
                  style={{
                    borderColor: on ? accent : "var(--color-line)",
                    background: on ? accent + "26" : "var(--color-panel-2)",
                  }}
                >
                  <span aria-hidden className="text-lg leading-none">
                    {spec.emoji}
                  </span>
                  <span className="text-[11px] leading-tight font-semibold">
                    {spec.name} <span className="text-muted">{ammo}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onFire}
            aria-keyshortcuts="Space"
            className={`btn btn-primary min-h-12 w-full font-display text-lg font-extrabold ${hurry ? "barrage-hurry" : ""}`}
          >
            <span aria-hidden>🔥</span> Fire!
          </button>
          <p className="text-center text-[11px] text-muted">
            {w.emoji} {w.name}: {w.blurb}
          </p>
        </div>

        <div className="flex flex-col gap-2 @2xl:order-1">
          <Row
            id={`${id}-angle`}
            label="Angle"
            value={aim.angle}
            min={0}
            max={180}
            rtl
            display={
              <>
                <span aria-hidden className="mr-1 inline-block text-muted" style={{ transform: `rotate(${-aim.angle}deg)` }}>
                  ➜
                </span>
                {aim.angle}°
              </>
            }
            onChange={(v) => onChange({ angle: v })}
            minus={{ label: "Tilt barrel left", icon: "↺", delta: 1 }}
            plus={{ label: "Tilt barrel right", icon: "↻", delta: -1 }}
            accent={accent}
          />
          <Row
            id={`${id}-power`}
            label="Power"
            value={aim.power}
            min={MIN_POWER}
            max={MAX_POWER}
            display={<>{aim.power}</>}
            onChange={(v) => onChange({ power: v })}
            minus={{ label: "Less power", icon: "−", delta: -1 }}
            plus={{ label: "More power", icon: "+", delta: 1 }}
            accent={accent}
          />
          <Row
            id={`${id}-move`}
            label="Drive"
            value={aim.move}
            min={-cap}
            max={cap}
            disabled={cap <= 0}
            display={
              <>
                {aim.move === 0 ? "stay" : `${aim.move > 0 ? "→" : "←"} ${Math.abs(aim.move)}`}
                <span className="ml-1.5 text-[11px] font-normal text-muted">⛽{tank.fuel - Math.abs(aim.move)}</span>
              </>
            }
            onChange={(v) => onChange({ move: v })}
            minus={{ label: "Drive left", icon: "◀", delta: -5 }}
            plus={{ label: "Drive right", icon: "▶", delta: 5 }}
            accent={accent}
          />
        </div>
      </div>
    </section>
  );
}

function Row({
  id,
  label,
  value,
  min,
  max,
  rtl,
  disabled,
  display,
  onChange,
  minus,
  plus,
  accent,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  rtl?: boolean;
  disabled?: boolean;
  display: ReactNode;
  onChange: (v: number) => void;
  minus: { label: string; icon: string; delta: number };
  plus: { label: string; icon: string; delta: number };
  accent: string;
}) {
  return (
    <div className={disabled ? "opacity-50" : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="label">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-sm font-bold tabular-nums">
          {display}
        </output>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="btn size-10 shrink-0 p-0 text-lg"
          aria-label={minus.label}
          disabled={disabled}
          onClick={() => onChange(value + minus.delta)}
        >
          {minus.icon}
        </button>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          dir={rtl ? "rtl" : undefined}
          disabled={disabled}
          onChange={(ev) => onChange(Number(ev.target.value))}
          className="barrage-range min-w-0 flex-1"
          style={{ accentColor: accent }}
        />
        <button
          type="button"
          className="btn size-10 shrink-0 p-0 text-lg"
          aria-label={plus.label}
          disabled={disabled}
          onClick={() => onChange(value + plus.delta)}
        >
          {plus.icon}
        </button>
      </div>
    </div>
  );
}

function LockedCard({ aim, waitingFor, color }: { aim: Aim; waitingFor: string[]; color: string }) {
  const w = WEAPONS[aim.weapon];
  return (
    <section aria-label="Your shot" className="card barrage-pop flex items-center gap-3 px-4 py-3" style={{ borderColor: color + "88" }}>
      <span aria-hidden className="text-3xl">
        🔒
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-display font-bold">Shot locked</span>
          <span className="shrink-0 text-xs text-muted">
            {waitingFor.length ? (
              <>
                {waitingFor.length} still aiming
                <span aria-hidden>
                  <span className="barrage-dot">.</span>
                  <span className="barrage-dot" style={{ animationDelay: ".15s" }}>
                    .
                  </span>
                  <span className="barrage-dot" style={{ animationDelay: ".3s" }}>
                    .
                  </span>
                </span>
              </>
            ) : (
              "all in!"
            )}
          </span>
        </div>
        <div className="font-mono text-sm text-muted tabular-nums">
          {aim.angle}° · power {aim.power} · <span aria-hidden>{w.emoji}</span> {w.name}
          {aim.move !== 0 ? ` · drive ${aim.move > 0 ? "→" : "←"}${Math.abs(aim.move)}` : ""}
        </div>
      </div>
    </section>
  );
}

// ---------- roster ----------

function hpColor(hp: number) {
  return hp > 60 ? "#4ade80" : hp > 30 ? "#fbbf24" : "#f87171";
}

function Roster({
  view,
  rp,
  e,
  byId,
  colors,
  me,
  mySlot,
}: {
  view: BarrageView;
  rp: Replay | null;
  e: number;
  byId: Record<string, Player>;
  colors: Record<string, string>;
  me: string;
  mySlot: number;
}) {
  // Left to right, the way they sit on the battlefield.
  const order = view.tanks.map((t, i) => ({ t, i })).sort((a, b) => (rp ? rp.x1[a.i] - rp.x1[b.i] : a.t.x - b.t.x));
  return (
    <section aria-label="Tanks">
      <ul className="grid grid-cols-2 gap-1.5 @3xl:grid-cols-4">
        {order.map(({ t, i }) => {
          const p = byId[t.id];
          const color = colors[t.id] ?? "#94a3b8";
          const hp = rp ? tankHp(rp, i, e) : t.hp;
          const alive = rp ? tankAlive(rp, i, e) : t.alive;
          const offline = p?.connected === false;
          let status: ReactNode;
          if (!alive) status = <span className="text-red-300">{t.why === "abyss" ? "fell" : "KO"}</span>;
          else if (rp) {
            const a = rp.r.aims.find((x) => x[0] === i);
            status = a ? (
              <span className="font-mono tabular-nums">
                {a[1]}° · {a[2]}
              </span>
            ) : (
              "held fire"
            );
          } else if (offline) status = "📡 away";
          else if (t.locked) status = <span className="font-semibold text-green-400">✓ locked</span>;
          else status = "aiming…";
          return (
            <li
              key={t.id}
              className={`flex min-w-0 items-center gap-2 rounded-xl border px-2 py-1.5 transition-opacity ${alive ? "" : "opacity-55"}`}
              style={{
                borderColor: i === mySlot ? color : color + "44",
                background: color + (i === mySlot ? "1f" : "10"),
              }}
            >
              <span aria-hidden className="text-lg leading-none">
                {alive ? (p?.avatar ?? "🙂") : "💀"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1 text-xs">
                  <span className="truncate font-bold" style={{ color }}>
                    {p?.name ?? "Someone"}
                    {t.id === me && <span className="font-normal text-muted"> (you)</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">{status}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2"
                    role="meter"
                    aria-label={`${p?.name ?? "Someone"} armour`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={hp}
                  >
                    <div
                      className="h-full rounded-full transition-[width,background-color] duration-300"
                      style={{ width: `${hp}%`, background: hpColor(hp) }}
                    />
                  </div>
                  <span className="w-6 text-right font-mono text-[11px] font-bold tabular-nums">{hp}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- final ----------

function Final({
  view,
  byId,
  colors,
  me,
}: {
  view: BarrageView;
  byId: Record<string, Player>;
  colors: Record<string, string>;
  me: string;
}) {
  const winners = new Set(view.final?.winners ?? []);
  const ranked = view.tanks
    .slice()
    .sort(
      (a, b) =>
        Number(winners.has(b.id)) - Number(winners.has(a.id)) ||
        Number(b.alive) - Number(a.alive) ||
        b.hp - a.hp ||
        (b.diedTurn ?? 0) - (a.diedTurn ?? 0) ||
        b.dealt - a.dealt,
    );
  const most = (k: "dealt" | "kills") => {
    const best = Math.max(0, ...view.tanks.map((t) => t[k]));
    return best > 0 ? view.tanks.filter((t) => t[k] === best) : [];
  };
  const wreckers = most("dealt");
  const hunters = most("kills");
  const nm = (t: TankView) => (t.id === me ? "You" : (byId[t.id]?.name ?? "Someone"));
  return (
    <section aria-label="Final standings" className="card barrage-in p-3 sm:p-4">
      <div className="label mb-2">Final standings · {view.turn} turn{view.turn === 1 ? "" : "s"}</div>
      <ol className="flex flex-col gap-1.5">
        {ranked.map((t, i) => {
          const p = byId[t.id];
          const color = colors[t.id] ?? "#94a3b8";
          const won = winners.has(t.id);
          return (
            <li
              key={t.id}
              className="barrage-in flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2"
              style={{
                animationDelay: `${i * 60}ms`,
                borderColor: won ? color : "var(--color-line)",
                background: won ? color + "1c" : "transparent",
              }}
            >
              <span className="w-5 shrink-0 text-center font-mono text-xs text-muted">{won ? "👑" : i + 1}</span>
              <span aria-hidden className="text-lg leading-none">
                {p?.avatar ?? "🙂"}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold" style={{ color }}>
                {p?.name ?? "Someone"}
                {t.id === me && <span className="font-normal text-muted"> (you)</span>}
              </span>
              <span className="shrink-0 text-right font-mono text-xs text-muted tabular-nums">
                {t.alive ? (
                  <span className="font-bold" style={{ color: hpColor(t.hp) }}>
                    ❤ {t.hp}
                  </span>
                ) : (
                  <span>💀 T{t.diedTurn ?? "?"}</span>
                )}
                <span className="ml-2 hidden @md:inline">💥 {t.dealt}</span>
                <span className="ml-2 hidden @md:inline">🎯 {t.kills}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {(wreckers.length > 0 || hunters.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {wreckers.length > 0 && (
            <span className="barrage-pop rounded-full border border-line bg-panel-2 px-2.5 py-1">
              💥 Demolition expert: <b>{wreckers.map(nm).join(", ")}</b> ({wreckers[0].dealt} damage)
            </span>
          )}
          {hunters.length > 0 && (
            <span className="barrage-pop rounded-full border border-line bg-panel-2 px-2.5 py-1" style={{ animationDelay: "120ms" }}>
              🎯 Tank hunter: <b>{hunters.map(nm).join(", ")}</b> ({hunters[0].kills} KO{hunters[0].kills === 1 ? "" : "s"})
            </span>
          )}
        </div>
      )}
    </section>
  );
}
