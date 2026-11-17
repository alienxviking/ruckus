"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Dices, Users, X } from "lucide-react";
import { CATALOG, type GameMeta } from "@/games/catalog";
import { useCreateRoom } from "@/lib/useCreateRoom";
import { GameBrowser } from "../GameBrowser";
import { GameCard } from "../GameCard";
import { Rux } from "../Rux";

// ---------- "What are we playing?" ----------

const PEOPLE = [
  { id: "1", label: "Just me", n: 1 },
  { id: "2", label: "2 of us", n: 2 },
  { id: "4", label: "3–4", n: 4 },
  { id: "6", label: "5–8", n: 6 },
  { id: "10", label: "9+", n: 10 },
] as const;
const WHERE = [
  { id: "room", label: "Same room" },
  { id: "call", label: "On a call" },
] as const;
const TIME = [
  { id: "quick", label: "Quick one" },
  { id: "any", label: "We've got time" },
] as const;

type Where = (typeof WHERE)[number]["id"];
type Time = (typeof TIME)[number]["id"];

/** Talking-friendly games that also shine on a video call. */
const CALL_FRIENDLY = new Set(["impostor", "fib", "poll", "dial", "emojicharades", "mindmeld", "trivia", "letters", "liars", "sketch"]);

function picks(n: number, where: Where, time: Time, salt: number): GameMeta[] {
  const fits = CATALOG.filter((g) => n >= g.minPlayers && n <= g.maxPlayers && (time === "any" || g.minutes <= 5));
  const score = (g: GameMeta) => {
    let s = 0;
    if (where === "call") s += g.call ? 6 : CALL_FRIENDLY.has(g.id) ? 3 : g.category === "party" ? 1 : -3;
    if (n >= 4 && g.teams) s += 2;
    if (n === 2 && g.maxPlayers <= 4) s += 2;
    if (n === 1 && g.category === "brain") s += 1;
    if (g.isNew) s += 1;
    // A little shuffle (changes with "Shuffle"), so the same answers don't always come up.
    s += ((g.id.length * 7 + g.name.charCodeAt(0) + salt * 13) % 10) / 4;
    return s;
  };
  return fits.sort((a, b) => score(b) - score(a)).slice(0, 4);
}

function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-bold transition-[transform,background-color,border-color] duration-150 active:scale-95 ${
              on ? "border-ink bg-brand-2 text-ink shadow-[2px_3px_0_#14101f]" : "border-line bg-panel text-muted hover:border-text/40 hover:text-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Picker({ onPick }: { onPick: (g: GameMeta) => void }) {
  const [people, setPeople] = useState<(typeof PEOPLE)[number]["id"]>("4");
  const [where, setWhere] = useState<Where>("room");
  const [time, setTime] = useState<Time>("any");
  const [salt, setSalt] = useState(0);
  const n = PEOPLE.find((p) => p.id === people)!.n;
  const list = useMemo(() => picks(n, where, time, salt), [n, where, time, salt]);

  return (
    <section aria-labelledby="picker-heading" className="stk p-4 sm:p-6" style={{ "--stk-bg": "var(--color-panel)" } as React.CSSProperties}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="marker -rotate-2 text-xl text-brand-2">kya khelein?</p>
          <h2 id="picker-heading" className="font-hero text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl">
            What are we playing?
          </h2>
        </div>
        <button type="button" className="btn border-2 px-3 py-1.5 text-sm font-bold" onClick={() => setSalt((s) => s + 1)}>
          <Dices aria-hidden className="size-4" strokeWidth={2.2} /> Shuffle
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div>
          <p className="mb-1.5 text-xs font-bold text-muted">How many of you?</p>
          <Chips options={PEOPLE} value={people} onChange={setPeople} label="How many of you" />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-bold text-muted">Where are you?</p>
          <Chips options={WHERE} value={where} onChange={setWhere} label="Where are you" />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-bold text-muted">How long?</p>
          <Chips options={TIME} value={time} onChange={setTime} label="How long" />
        </div>
      </div>
      {list.length ? (
        <div className="-mx-4 mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
          {list.map((g, i) => (
            <div
              key={`${g.id}-${salt}`}
              className="slap w-[72%] shrink-0 snap-start sm:w-auto"
              style={{ "--tilt": "0deg", animationDelay: `${i * 70}ms` } as React.CSSProperties}
            >
              <GameCard game={g} index={i} onSelect={() => onPick(g)} />
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-5 flex items-center gap-3 text-muted">
          <Rux mood="wow" className="h-14 w-12 shrink-0" /> Nothing fits that exactly. Try &ldquo;We&apos;ve got time&rdquo;.
        </p>
      )}
    </section>
  );
}

// ---------- curated rows ----------

const ROWS: { title: string; note: string; tilt: string; color: string; test: (g: GameMeta) => boolean }[] = [
  {
    title: "Big group bawaal",
    note: "8+ people, maximum noise",
    tilt: "-2deg",
    color: "var(--color-pink)",
    test: (g) => g.maxPlayers >= 8 && (g.category === "party" || !!g.teams),
  },
  { title: "On a call", note: "talk it out on Meet / Zoom", tilt: "1.5deg", color: "var(--color-cyan)", test: (g) => !!g.call || CALL_FRIENDLY.has(g.id) },
  { title: "Just you two", note: "1v1, no excuses", tilt: "-1.5deg", color: "var(--color-sun)", test: (g) => g.minPlayers <= 2 && g.maxPlayers <= 4 },
  { title: "Real-time chaos", note: "reflexes on", tilt: "2deg", color: "var(--color-volt)", test: (g) => g.category === "arena" },
  { title: "Brain burners", note: "dimaag lagao", tilt: "-1deg", color: "var(--color-blue)", test: (g) => g.category === "brain" },
];

function Row({ title, note, tilt, color, games, onPick }: { title: string; note: string; tilt: string; color: string; games: GameMeta[]; onPick: (g: GameMeta) => void }) {
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-baseline gap-3">
        <h3
          className="inline-block rounded-lg border-2 border-ink px-2.5 py-0.5 font-hero text-xl font-extrabold text-ink shadow-[3px_4px_0_#000]"
          style={{ background: color, transform: `rotate(${tilt})` }}
        >
          {title}
        </h3>
        <span className="marker text-lg text-muted">{note}</span>
      </div>
      {/* Phones: swipe sideways. Laptops: a tidy row. */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        {games.slice(0, 4).map((g, i) => (
          <div key={g.id} className="w-[72%] shrink-0 snap-start sm:w-auto">
            <GameCard game={g} index={i} onSelect={() => onPick(g)} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- the whole lower half of the home page ----------

export function HomeLibrary({ localIds }: { localIds: string[] }) {
  const [picked, setPicked] = useState<GameMeta | null>(null);
  // A fresh "nothing selected" id after every close, so the browser drops its highlight.
  const [closes, setCloses] = useState(0);
  const close = () => {
    setPicked(null);
    setCloses((n) => n + 1);
  };
  const rows = useMemo(() => ROWS.map((r) => ({ ...r, games: CATALOG.filter(r.test) })), []);

  return (
    <>
      <Picker onPick={setPicked} />
      <div className="mt-14 space-y-10">
        {rows.map((r) => (
          <Row key={r.title} {...r} onPick={setPicked} />
        ))}
      </div>
      <section aria-labelledby="all-heading" className="mt-16">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 id="all-heading" className="font-hero text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl">
            All {CATALOG.length} games
          </h2>
          <p className="marker text-xl text-muted">tap one to play it ↓</p>
        </div>
        <GameBrowser selectedId={picked?.id ?? `none-${closes}`} onSelect={setPicked} />
      </section>
      {picked && <PlaySheet key={picked.id} game={picked} local={localIds.includes(picked.id)} onClose={close} />}
    </>
  );
}

function PlaySheet({ game, local, onClose }: { game: GameMeta; local: boolean; onClose: () => void }) {
  const { create, busy, error } = useCreateRoom();
  const first = useRef<HTMLAnchorElement & HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const solo = game.minPlayers <= 1;
  return (
    <div
      role="dialog"
      aria-labelledby="play-sheet-title"
      className="stk slap fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md overflow-hidden p-0 sm:bottom-6"
      style={{ "--stk-bg": "var(--color-panel)", "--accent": game.accent } as React.CSSProperties}
    >
      <div className="flex items-center gap-3 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG */}
        <img src={`/covers/${game.id}.svg`} alt="" width={96} height={60} className="h-[60px] w-24 shrink-0 rounded-lg border-2 border-ink object-cover" />
        <div className="min-w-0 flex-1">
          <p className="marker text-lg leading-none text-brand-2">kaise khelna hai?</p>
          <h3 id="play-sheet-title" className="truncate font-hero text-xl font-extrabold">
            {game.name}
          </h3>
        </div>
        <button className="btn shrink-0 p-2" aria-label="Close" onClick={onClose}>
          <X aria-hidden className="size-4" strokeWidth={2.5} />
        </button>
      </div>
      <div className={`grid gap-2 px-3 pb-3 ${local ? "grid-cols-2" : ""}`}>
        {local && (
          <Link ref={first} href={`/play/${game.id}`} className="btn border-2 py-2.5 font-bold">
            <Bot aria-hidden className="size-4" strokeWidth={2.2} />
            {solo ? "Play solo" : "Play vs bots"}
          </Link>
        )}
        <button ref={local ? undefined : first} className="btn btn-primary py-2.5" onClick={() => create(game.id)} disabled={busy}>
          <Users aria-hidden className="size-4" strokeWidth={2.4} />
          {busy ? "Setting up…" : "With friends"}
        </button>
      </div>
      {!local && <p className="px-3 pb-3 text-xs text-muted">{game.minPlayers}+ players: opens a room with this game picked.</p>}
      {error && (
        <p role="alert" className="px-3 pb-3 text-sm text-brand">
          {error}
        </p>
      )}
    </div>
  );
}
