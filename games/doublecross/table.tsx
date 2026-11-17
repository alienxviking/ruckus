"use client";

import { useEffect } from "react";
import type { Player } from "@/shared/types";
import type { Choice, DcView, TableView } from "./shared";
import { CHOICE_META, Card, Coin, Dots, GOLD, RepRow, STEAL, SPLIT, trustLine, vars, type Who } from "./ui";
import { Avatar } from "@/components/Avatar";

/** Per-seat status for the current phase: done talking, locked in, offline, or nothing yet. */
export type SeatState = "ready" | "locked" | "offline" | "thinking" | null;

export function seatState(phase: DcView["phase"], connected: boolean, ready: boolean, locked: boolean): SeatState {
  if (!connected) return "offline";
  if (phase === "talk") return ready ? "ready" : null;
  if (phase === "choose") return locked ? "locked" : "thinking";
  return null;
}

function StateBadge({ state, className = "" }: { state: SeatState; className?: string }) {
  if (!state || state === "thinking") return null;
  const map = {
    ready: { icon: "✓", bg: "#22c55e", text: "done talking" },
    locked: { icon: "🔒", bg: "#a78bfa", text: "locked in" },
    offline: { icon: "⚠", bg: "#f59e0b", text: "offline" },
  } as const;
  const m = map[state];
  return (
    <span
      className={`dc-pop grid size-5 place-items-center rounded-full border-2 border-panel text-[10px] leading-none font-bold text-ink ${className}`}
      style={{ background: m.bg }}
      title={m.text}
    >
      <span aria-hidden>{m.icon}</span>
      <span className="sr-only">{m.text}</span>
    </span>
  );
}

function SeatCard({ p, you, view, seat, state }: { p: Player; you: boolean; view: DcView; seat: number; state: SeatState }) {
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl border px-1.5 py-2 text-center ${p.connected ? "" : "opacity-60"}`}
      style={{ borderColor: `${p.color}55`, background: `${p.color}10` }}
    >
      <span className="relative grid size-12 place-items-center rounded-full text-[28px] leading-none @lg:size-14 @lg:text-3xl" style={{ background: `${p.color}26` }}>
        <span aria-hidden><Avatar id={p.avatar} /></span>
        <StateBadge state={state} className="absolute -right-1 -bottom-1" />
      </span>
      <span className="max-w-full truncate text-sm font-bold" style={{ color: p.color }}>
        {you ? "You" : p.name}
      </span>
      {view.history.length > 0 ? (
        <span className="flex max-w-full flex-wrap justify-center">
          <RepRow history={view.history} seat={seat} rounds={view.history.length} size="sm" />
        </span>
      ) : null}
      <span className="text-[11px] leading-tight text-muted">
        {state === "thinking" ? (
          <>
            deciding
            <Dots />
          </>
        ) : (
          trustLine(view.history, seat)
        )}
      </span>
    </div>
  );
}

/** The pot and what each outcome pays, in one line. */
function PotLine({ pot, size, heist }: { pot: number; size: number; heist: boolean }) {
  const each = Math.floor(pot / size);
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-muted">
      <Coin v={pot} className="text-sm" />
      <span>
        <span style={{ color: SPLIT }}>{size === 2 ? "both split" : "all split"}</span> {each} each
      </span>
      <span aria-hidden>·</span>
      <span>
        <span style={{ color: STEAL }}>{heist || size > 2 ? "one thief" : "one steals"}</span> takes {pot}
      </span>
      <span aria-hidden>·</span>
      <span>{size === 2 ? "both steal" : "2+ thieves"}: 0</span>
    </p>
  );
}

/** Split-screen: you on one side, your partner (or two) on the other. */
export function TableHeader({
  view,
  who,
  mySeat,
  table,
  state,
}: {
  view: DcView;
  who: Who;
  mySeat: number;
  table: TableView;
  state: (seat: number) => SeatState;
}) {
  const others = table.seats.filter((s) => s !== mySeat);
  return (
    <Card label="Your table" className="dc-in flex flex-col gap-2.5">
      <div className="flex items-stretch gap-1.5 @lg:gap-2">
        <SeatCard p={who(mySeat)} you view={view} seat={mySeat} state={state(mySeat)} />
        <span aria-hidden className="grid shrink-0 place-items-center px-0.5 font-display text-lg font-extrabold text-muted @lg:px-1.5 @lg:text-xl">
          {others.length === 1 ? "vs" : "&"}
        </span>
        {others.map((s) => (
          <SeatCard key={s} p={who(s)} you={false} view={view} seat={s} state={state(s)} />
        ))}
      </div>
      <PotLine pot={table.pot} size={table.seats.length} heist={false} />
    </Card>
  );
}

/** Round 6: one vault, the whole crew. */
export function HeistHeader({ who, mySeat, table, state }: { who: Who; mySeat: number; table: TableView; state: (seat: number) => SeatState }) {
  return (
    <Card label="The Heist" className="dc-in flex flex-col items-center gap-2.5 text-center" style={{ borderColor: `${GOLD}66`, background: `linear-gradient(180deg, ${GOLD}14, transparent 70%), var(--color-panel)` }}>
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-3xl">
          🏦
        </span>
        <div className="text-left">
          <div className="font-display text-xl leading-tight font-extrabold" style={{ color: GOLD }}>
            The Heist
          </div>
          <div className="text-xs text-muted">everyone at one table · final round</div>
        </div>
      </div>
      <PotLine pot={table.pot} size={table.seats.length} heist />
      <ul className="flex flex-wrap justify-center gap-1.5" aria-label="The crew">
        {table.seats.map((s) => {
          const p = who(s);
          const st = state(s);
          return (
            <li
              key={s}
              className={`relative flex items-center gap-1 rounded-full border py-0.5 pr-2.5 pl-1 text-xs font-semibold ${p.connected ? "" : "opacity-60"}`}
              style={{ borderColor: `${p.color}66`, background: `${p.color}1a` }}
            >
              <span aria-hidden className="text-base">
                <Avatar id={p.avatar} />
              </span>
              <span className="max-w-[6.5rem] truncate" style={{ color: p.color }}>
                {s === mySeat ? "You" : p.name}
              </span>
              <StateBadge state={st} className="-mr-1.5 ml-0.5 size-4 text-[9px]" />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Every (other) table at a glance: who sits where, how chatty, who's done. */
export function TablesOverview({
  view,
  who,
  counts,
  skip,
  mySeat,
  state,
  title,
}: {
  view: DcView;
  who: Who;
  counts: number[];
  skip: number;
  mySeat: number;
  state: (seat: number) => SeatState;
  title: string;
}) {
  const shown = view.tables.map((t, g) => ({ t, g })).filter(({ g }) => g !== skip);
  if (!shown.length) return null;
  return (
    <Card label={title} className="dc-in">
      <div className="label mb-2 flex items-center justify-between gap-2">
        <span>{title}</span>
        <span className="font-normal tracking-normal normal-case">🔒 chats are private</span>
      </div>
      <ul className="grid gap-1.5 @lg:grid-cols-2">
        {shown.map(({ t, g }) => (
          <li key={g} className="flex items-center gap-2 rounded-xl bg-panel-2/70 px-2 py-1.5">
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
              {t.seats.map((s, i) => {
                const p = who(s);
                return (
                  <span key={s} className="flex min-w-0 items-center gap-1">
                    {i > 0 && (
                      <span aria-hidden className="text-[10px] text-muted">
                        ×
                      </span>
                    )}
                    <span className={`relative text-base leading-none ${p.connected ? "" : "opacity-50"}`} aria-hidden>
                      <Avatar id={p.avatar} />
                    </span>
                    <span className="max-w-[5.5rem] truncate text-xs font-semibold" style={{ color: p.color }}>
                      {s === mySeat ? "You" : p.name}
                    </span>
                    <StateBadge state={state(s)} className="size-4 text-[9px]" />
                  </span>
                );
              })}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
              <span title="messages sent">
                💬 <b className="font-mono text-text tabular-nums">{counts[g] ?? 0}</b>
              </span>
              <Coin v={t.pot} className="text-[11px]" />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** "Done talking" toggle: when everyone's done, the choice starts early. */
export function ReadyBar({ ready, onToggle, waiting }: { ready: boolean; onToggle: () => void; waiting: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={ready}
        className={`btn min-h-10 ${ready ? "" : "btn-primary"}`}
        style={ready ? { borderColor: "#22c55e88", background: "#22c55e1f" } : undefined}
      >
        {ready ? "✓ Done talking (tap to keep talking)" : "Done talking ✓"}
      </button>
      <span className="text-xs text-muted">
        {ready ? (waiting > 0 ? `Waiting on ${waiting} more…` : "Moving on…") : "Choices start when everyone's done."}
      </span>
    </div>
  );
}

/** Two big secret buttons. Tap to lock; tap the other to switch until everyone's in. */
export function ChoicePad({ choice, onPick, partnerLast, disabled }: { choice: Choice | null; onPick: (c: Choice) => void; partnerLast: { name: string; color: string; text: string } | null; disabled?: boolean }) {
  // Keys 1 / 2 (or ← / →) pick, ignoring typing in inputs (the room chat lives on this page).
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "")) return;
      const c: Choice | null = e.key === "1" || e.key === "ArrowLeft" ? "split" : e.key === "2" || e.key === "ArrowRight" ? "steal" : null;
      if (!c) return;
      e.preventDefault();
      onPick(c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPick, disabled]);

  return (
    <Card label="Your choice" className="dc-in flex flex-col gap-3">
      {partnerLast && (
        <p className="text-center text-sm text-muted">
          <span style={{ color: partnerLast.color }} className="font-semibold">
            {partnerLast.name}
          </span>{" "}
          said: <q className="text-text italic">{partnerLast.text}</q>
        </p>
      )}
      <div className="grid grid-cols-2 gap-3" role="group" aria-label="Split or steal">
        {(["split", "steal"] as const).map((c, i) => {
          const m = CHOICE_META[c];
          const on = choice === c;
          const off = choice !== null && !on;
          return (
            <button
              key={c}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              aria-keyshortcuts={String(i + 1)}
              aria-label={`${m.label}: ${m.hint}`}
              onClick={() => onPick(c)}
              className={`relative flex min-h-36 flex-col items-center justify-center gap-1 rounded-2xl border-2 px-2 py-4 outline-none focus-visible:ring-2 focus-visible:ring-text/70 active:scale-[.97] @lg:min-h-44 ${on ? "dc-glow" : ""}`}
              style={{
                borderColor: on ? m.color : `${m.color}55`,
                background: on ? `linear-gradient(180deg, ${m.color}38, ${m.color}14)` : `${m.color}10`,
                opacity: off ? 0.5 : 1,
                transition: "opacity .2s, border-color .2s, background .2s, transform .1s",
                ...vars({ "--dc-c": m.color }),
              }}
            >
              {on && (
                <span className="pointer-events-none absolute inset-x-0 -top-2.5 flex justify-center">
                  <span className="dc-pop rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-wider whitespace-nowrap text-ink" style={{ background: m.color }}>
                    🔒 LOCKED
                  </span>
                </span>
              )}
              <span aria-hidden className={`text-5xl leading-none @lg:text-6xl ${on ? "dc-pop" : ""}`} key={on ? "on" : "off"}>
                {m.emoji}
              </span>
              <span className="font-display text-2xl font-extrabold tracking-wide uppercase" style={{ color: m.color }}>
                {m.label}
              </span>
              <span className="text-xs text-muted">{m.hint}</span>
            </button>
          );
        })}
      </div>
      <p className="text-center text-xs text-muted">
        {choice ? (
          <>Only you know. Tap the other card to switch, until everyone&apos;s locked in.</>
        ) : (
          <>
            Secret until the flip. No choice counts as <b style={{ color: SPLIT }}>split</b>.<span className="hidden whitespace-nowrap sm:inline"> Keys 1 / 2.</span>
          </>
        )}
      </p>
    </Card>
  );
}
