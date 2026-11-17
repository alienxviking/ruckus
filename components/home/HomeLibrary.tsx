"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { readMyGames, serverMyGames, subscribeMyGames, toggleFav } from "@/lib/my-games";
import { Bot, Dices, Users, X } from "lucide-react";
import { CATALOG, CATALOG_BY_ID, CATEGORY_LABEL, type GameMeta } from "@/games/catalog";
import { useCreateRoom } from "@/lib/useCreateRoom";
import { GameBrowser } from "../GameBrowser";
import { CoverArt } from "../CoverArt";
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
          <p className="marker -rotate-2 text-xl text-brand-2">can&apos;t decide?</p>
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
    title: "Big group chaos",
    note: "8+ people, maximum noise",
    tilt: "-2deg",
    color: "var(--color-pink)",
    test: (g) => g.maxPlayers >= 8 && (g.category === "party" || !!g.teams),
  },
  { title: "On a call", note: "talk it out on Meet / Zoom", tilt: "1.5deg", color: "var(--color-cyan)", test: (g) => !!g.call || CALL_FRIENDLY.has(g.id) },
  { title: "Just you two", note: "1v1, no excuses", tilt: "-1.5deg", color: "var(--color-sun)", test: (g) => g.minPlayers <= 2 && g.maxPlayers <= 4 },
  { title: "Real-time chaos", note: "reflexes on", tilt: "2deg", color: "var(--color-volt)", test: (g) => g.category === "arena" },
  { title: "Brain burners", note: "use that brain", tilt: "-1deg", color: "var(--color-blue)", test: (g) => g.category === "brain" },
];

function Row({
  title,
  note,
  tilt,
  color,
  games,
  onPick,
  max = 4,
}: {
  title: string;
  note: string;
  tilt: string;
  color: string;
  games: GameMeta[];
  onPick: (g: GameMeta) => void;
  max?: number;
}) {
  return (
    <section aria-label={title}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3
          className="inline-block whitespace-nowrap rounded-lg border-2 border-ink px-2.5 py-0.5 font-hero text-xl font-extrabold text-ink shadow-[3px_4px_0_#000]"
          style={{ background: color, transform: `rotate(${tilt})` }}
        >
          {title}
        </h3>
        <span className="marker text-lg text-muted">{note}</span>
      </div>
      {/* Phones: swipe sideways. Laptops: a tidy row. */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        {games.slice(0, max).map((g, i) => (
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

  const mine = useSyncExternalStore(subscribeMyGames, readMyGames, serverMyGames);
  const yours = [...new Set([...mine.favs, ...mine.recent])].map((id) => CATALOG_BY_ID[id]).filter(Boolean).slice(0, 8);

  return (
    <>
      {yours.length > 0 && (
        <div className="mb-12">
          <Row
            title="Your games"
            note={mine.favs.length ? "favourites first, then recently played" : "played recently"}
            tilt="-1.5deg"
            color="var(--color-pink)"
            games={yours}
            onPick={setPicked}
            max={8}
          />
        </div>
      )}
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

  // Focus the main action, close on Escape, and stop the page scrolling behind the card.
  useEffect(() => {
    first.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const solo = game.minPlayers <= 1;
  const fav = useSyncExternalStore(subscribeMyGames, readMyGames, serverMyGames).favs.includes(game.id);
  const players = game.minPlayers === game.maxPlayers ? `${game.minPlayers}` : `${game.minPlayers}–${game.maxPlayers}`;
  const kind = game.call ? "On a call" : game.teams ? "Teams" : CATEGORY_LABEL[game.category];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
      {/* Blurred backdrop: tap it to close. */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="play-backdrop fixed inset-0 bg-ink/60 backdrop-blur-md"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="play-sheet-title"
        className="stk slap relative w-full max-w-lg overflow-hidden p-0"
        style={
          {
            "--stk-bg": "var(--color-panel)",
            "--accent": game.accent,
            boxShadow: `7px 8px 0 color-mix(in oklab, ${game.accent} 55%, #000)`,
          } as React.CSSProperties
        }
      >
        <div className="relative">
          <CoverArt game={game} className="border-b-[3px] border-paper [aspect-ratio:16/7]" />
          <button
            className={`absolute top-3 right-14 grid size-9 place-items-center rounded-full border-2 border-ink text-lg shadow-[2px_3px_0_#000] transition-transform active:scale-90 ${
              fav ? "bg-pink text-ink" : "bg-paper text-ink"
            }`}
            aria-label={fav ? "Remove from favourites" : "Add to favourites"}
            aria-pressed={fav}
            title={fav ? "Remove from favourites" : "Add to favourites"}
            onClick={() => toggleFav(game.id)}
          >
            {fav ? "♥" : "♡"}
          </button>
          <button
            className="absolute top-3 right-3 grid size-9 place-items-center rounded-full border-2 border-ink bg-paper text-ink shadow-[2px_3px_0_#000] transition-transform hover:rotate-90"
            aria-label="Close"
            onClick={onClose}
          >
            <X aria-hidden className="size-4" strokeWidth={3} />
          </button>
        </div>
        <div className="p-5">
          <p className="marker text-xl leading-none" style={{ color: game.accent }}>
            how do you want to play?
          </p>
          <h3 id="play-sheet-title" className="mt-1 font-hero text-3xl leading-tight font-extrabold tracking-[-0.03em]">
            {game.name}
          </h3>
          <p className="mt-1 text-muted">{game.tagline}</p>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full bg-panel-2 px-2.5 py-1 font-semibold text-muted">
              <b className="text-text">{players}</b> players
            </span>
            <span className="rounded-full bg-panel-2 px-2.5 py-1 font-semibold text-muted">~{game.minutes} min</span>
            <span className="rounded-full bg-panel-2 px-2.5 py-1 font-semibold" style={{ color: game.accent }}>
              {kind}
            </span>
            {game.isNew && <span className="marker rounded-full bg-sun px-2.5 text-sm text-ink">new!</span>}
          </div>
          <ol className="mt-4 space-y-2 text-sm text-text/90">
            {game.how.map((line, i) => (
              <li key={i} className="flex gap-2.5">
                <span
                  className="grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-ink"
                  style={{ background: game.accent }}
                >
                  {i + 1}
                </span>
                {line}
              </li>
            ))}
          </ol>
          <div className={`mt-5 grid gap-2 ${local ? "sm:grid-cols-2" : ""}`}>
            <button ref={local ? undefined : first} className="stk-btn py-3 text-lg" onClick={() => create(game.id)} disabled={busy}>
              <Users aria-hidden className="size-5" strokeWidth={2.6} />
              {busy ? "Setting up…" : "Play with friends"}
            </button>
            {local && (
              <Link ref={first} href={`/play/${game.id}`} className="btn border-2 py-3 text-base font-bold">
                <Bot aria-hidden className="size-5" strokeWidth={2.2} />
                {solo ? "Play solo" : "Play vs bots"}
              </Link>
            )}
          </div>
          {!local && <p className="mt-2 text-center text-xs text-muted">{game.minPlayers}+ players: opens a room with this game picked.</p>}
          {error && (
            <p role="alert" className="mt-2 text-sm text-brand">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
