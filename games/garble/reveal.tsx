"use client";

import { useEffect, useEffectEvent, useRef, useState, type CSSProperties } from "react";
import type { Player } from "@/shared/types";
import { Note, TimerBar } from "@/components/game-ui";
import type { DrawStroke, GarbleAction, GarbleEvent, GarbleView, PageView, RevealView } from "./server";
import { Drawing, useCacheVersion, useCached, type DrawingCache } from "./drawing";
import { REACTIONS, REACTION_NAMES } from "./shared";
import { LandingText, isTypingTarget, who } from "./ui";
import { Avatar } from "@/components/Avatar";

interface RevealProps {
  view: GarbleView;
  me: string;
  byId: Record<string, Player>;
  isPlayer: boolean;
  act: (a: GarbleAction) => void;
  serverNow: () => number;
  onEvent: (fn: (e: unknown) => void) => () => void;
  accent: string;
  cache: DrawingCache;
}

interface Floater {
  id: number;
  e: number;
  by: string;
  x: number;
  dx: number;
  rise: number;
}

let floatSeq = 0;

function isReact(e: unknown): e is Extract<GarbleEvent, { k: "react" }> {
  if (!e || typeof e !== "object") return false;
  const r = e as Record<string, unknown>;
  return (
    r.k === "react" &&
    typeof r.e === "number" &&
    Number.isInteger(r.e) &&
    r.e >= 0 &&
    r.e < REACTIONS.length &&
    typeof r.by === "string" &&
    typeof r.b === "number" &&
    typeof r.p === "number"
  );
}

/** Paper text colour for a player colour (they're tuned for the dark UI). */
const shade = (hex: string) => `color-mix(in oklab, ${hex} 70%, #1a1430)`;

export function RevealPhase({ view, me, byId, isPlayer, act, serverNow, onEvent, accent, cache }: RevealProps) {
  const r = view.reveal!;
  const owner = who(byId, r.owner);
  const isOwner = isPlayer && r.owner === me;
  const key = `${r.book}:${r.page}`;
  const page = r.current;
  const [live, setLive] = useState<{ key: string; list: { e: number; by: string }[] }>({ key: "", list: [] });
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const showRef = useRef<HTMLDivElement>(null);

  // Reactions arrive as events: float them up and count them for the page on stage.
  useEffect(() => {
    const timers = new Set<number>();
    const off = onEvent((raw) => {
      if (!isReact(raw)) return;
      const k = `${raw.b}:${raw.p}`;
      const item = { e: raw.e, by: raw.by };
      setLive((cur) => (cur.key === k ? { key: k, list: [...cur.list, item] } : { key: k, list: [item] }));
      const id = ++floatSeq;
      // Rise most of the way up the stage, whatever its height.
      const rise = Math.round(Math.max(160, (showRef.current?.clientHeight ?? 300) * 0.8));
      setFloaters((f) => [
        ...f.slice(-30),
        { id, e: raw.e, by: raw.by, x: 10 + Math.random() * 80, dx: (Math.random() - 0.5) * 90, rise },
      ]);
      const t = window.setTimeout(() => {
        timers.delete(t);
        setFloaters((f) => f.filter((x) => x.id !== id));
      }, 2500);
      timers.add(t);
    });
    return () => {
      off();
      for (const t of timers) window.clearTimeout(t);
    };
  }, [onEvent]);

  const reactors = REACTIONS.map((_, e) => {
    const set = new Set(r.react[e] ?? []);
    if (live.key === key) for (const x of live.list) if (x.e === e) set.add(x.by);
    return set;
  });
  const canReact = isPlayer && !!page && page.by !== me && !page.blank && !page.auto;

  const react = (e: number) => {
    if (!canReact || reactors[e].has(me)) return;
    setLive((cur) => (cur.key === key ? { key, list: [...cur.list, { e, by: me }] } : { key, list: [{ e, by: me }] }));
    act({ type: "react", e });
  };

  const onKey = useEffectEvent((ev: KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || isTypingTarget(ev.target)) return;
    const i = "1234".indexOf(ev.key);
    if (i >= 0 && ev.key.length === 1) {
      ev.preventDefault();
      react(i);
    } else if (isOwner && (ev.key === "ArrowRight" || ev.key === "n" || ev.key === "N")) {
      ev.preventDefault();
      act({ type: "next" });
    }
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Earlier drawings of this book come from the cache; a late joiner asks for them.
  const version = useCacheVersion(cache);
  const missing =
    version >= 0 &&
    r.trail.some((p, i) => p.kind === "draw" && !p.blank && (page ? i === r.page - 1 : true) && !cache.get(`${r.book}:${i}`));
  useEffect(() => {
    if (!missing) return;
    act({ type: "book", b: r.book });
    const t = window.setInterval(() => act({ type: "book", b: r.book }), 1500);
    return () => window.clearInterval(t);
  }, [missing, r.book, act]);

  return (
    <>
      <header className="flex items-center gap-3">
        <span
          key={r.book}
          aria-hidden
          className="gb-book grid size-12 shrink-0 place-items-center rounded-2xl text-2xl"
          style={{ background: `${owner.color}26`, boxShadow: `inset 0 0 0 1px ${owner.color}66` }}
        >
          📕
        </span>
        <div className="min-w-0 flex-1">
          <p className="label">
            Book {r.book + 1} of {view.players.length}
          </p>
          <h2 className="truncate font-display text-xl leading-tight font-extrabold @md:text-2xl">
            <span style={{ color: owner.color }}>{owner.name}</span>&apos;s book
          </h2>
        </div>
        {isOwner ? (
          <button
            type="button"
            className="btn btn-primary min-h-11 shrink-0 px-4"
            onClick={() => act({ type: "next" })}
            aria-label={page ? "Next page" : "Next book"}
            aria-keyshortcuts="ArrowRight"
            title="Skip ahead (→)"
          >
            Next<span className="hidden @md:inline">{page ? " page" : " book"}</span> <span aria-hidden>▶</span>
          </button>
        ) : (
          <span className="hidden max-w-40 shrink-0 text-right text-xs text-muted @md:block">
            {owner.name} can skip ahead
          </span>
        )}
      </header>

      <div className="flex items-center gap-3">
        <PageDots pages={r.pages} page={r.page} accent={owner.color} />
        <div className="min-w-0 flex-1">
          <TimerBar endsAt={view.endsAt} total={view.phaseMs} serverNow={serverNow} color={owner.color} />
        </div>
      </div>

      <div ref={showRef} className="relative flex flex-col gap-3">
        <section
          className="card flex flex-col justify-center px-3 py-4 @md:px-6 @md:py-5"
          aria-label="The reveal"
          style={{
            // Text and drawing pages take the same room, so the reactions don't jump around.
            minHeight: "min(calc(46vh + 8rem), calc(75cqw + 7rem))",
            borderColor: `${owner.color}55`,
            background: `radial-gradient(120% 80% at 50% 0%, ${owner.color}14, transparent 60%), var(--color-panel)`,
          }}
        >
          {page ? (
            <PageBeat r={r} page={page} byId={byId} cache={cache} />
          ) : (
            <BookEnd r={r} owner={owner} byId={byId} cache={cache} />
          )}
        </section>
        {page && (
          <ReactionBar reactors={reactors} me={me} canReact={canReact} onReact={react} accent={accent} hint={hintFor(page, me, isPlayer)} />
        )}
        <Floaters floaters={floaters} byId={byId} />
      </div>
      {!isPlayer && <Note>👀 You&apos;re watching the reveal. Only players can react.</Note>}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce(r, page, byId, owner)}
      </p>
    </>
  );
}

function hintFor(page: PageView, me: string, isPlayer: boolean): string {
  if (!isPlayer) return "";
  if (page.auto) return "The game picked this prompt, so no reactions";
  if (page.blank) return "Nothing to react to on a blank page";
  if (page.by === me) return "That's your page! Let's see what they think 👀";
  return "Tap to react (keys 1–4). Most reactions wins!";
}

function announce(r: RevealView, page: PageView | null, byId: Record<string, Player>, owner: Player): string {
  if (!page) return `That's ${owner.name}'s book.`;
  const by = who(byId, page.by).name;
  if (page.blank) return `Page ${r.page + 1}: ${by} left it blank.`;
  if (page.kind === "draw") return `Page ${r.page + 1}: ${by}'s drawing.`;
  return `Page ${r.page + 1}: ${by} wrote: ${page.text}`;
}

function PageDots({ pages, page, accent }: { pages: number; page: number; accent: string }) {
  return (
    <ol className="flex shrink-0 items-center gap-1" aria-label={page < pages ? `Page ${page + 1} of ${pages}` : "End of the book"}>
      {Array.from({ length: pages }, (_, i) => {
        const now = i === page;
        const past = i < page;
        return (
          <li
            key={i}
            className="h-2 rounded-full transition-all duration-300"
            style={{
              width: now ? 18 : 8,
              background: now || past ? accent : "var(--color-line)",
              opacity: past ? 0.6 : 1,
            }}
          />
        );
      })}
    </ol>
  );
}

// ---------- a page on stage ----------

function caption(page: PageView, first: boolean, byId: Record<string, Player>) {
  const p = who(byId, page.by);
  const name = <b style={{ color: p.color }}>{p.name}</b>;
  if (first && page.auto) return <>🎲 {name} left it blank, so the game picked a prompt</>;
  if (page.blank) return <>🤐 {name} left this page blank</>;
  if (first) return <>✍️ {name} started the book with</>;
  if (page.kind === "draw") return <>🎨 {name} drew it as</>;
  return <>💬 {name} described it as</>;
}

function PageBeat({ r, page, byId, cache }: { r: RevealView; page: PageView; byId: Record<string, Player>; cache: DrawingCache }) {
  const idx = r.page;
  const prev = idx > 0 ? r.trail[idx - 1] : null;
  const cached = useCached(cache, `${r.book}:${idx}`);
  const prevStrokes = useCached(cache, prev && prev.kind === "draw" ? `${r.book}:${idx - 1}` : null);
  // The cached copy is stable across re-sent views, so the pen replay doesn't restart.
  const strokes = cached ?? page.strokes;
  return (
    <div className="flex flex-col items-center gap-2">
      {prev && <PrevMini page={prev} strokes={prevStrokes} byId={byId} />}
      {prev && (
        <span aria-hidden className="text-lg leading-none text-muted">
          ↓
        </span>
      )}
      <div key={`${r.book}:${idx}`} className="gb-flip flex w-full flex-col items-center gap-2">
        <p className="text-center text-sm text-muted @md:text-base">{caption(page, idx === 0, byId)}</p>
        {page.kind === "draw" ? (
          page.blank ? (
            <BlankSheet />
          ) : (
            <div className="w-full" style={{ maxWidth: "calc(46vh * 4 / 3)" }}>
              <Drawing strokes={strokes} replay label={`Drawing by ${who(byId, page.by).name}`} className="gb-sheet rounded-xl" />
            </div>
          )
        ) : page.blank ? (
          <BlankSheet />
        ) : (
          <div className="gb-paper flex min-h-32 w-full max-w-2xl items-center justify-center rounded-2xl px-5 py-6 text-center">
            <LandingText text={`“${page.text}”`} className="font-display text-3xl leading-tight font-extrabold break-words @md:text-4xl" />
          </div>
        )}
      </div>
    </div>
  );
}

function BlankSheet() {
  return (
    <div className="gb-paper grid min-h-32 w-full max-w-md place-items-center rounded-2xl p-6 text-center text-[#7a6e93]">
      <p className="text-lg font-semibold">
        <span aria-hidden className="text-4xl">
          🤐
        </span>
        <br />
        left blank
      </p>
    </div>
  );
}

/** The page before the one on stage, small: what this page was responding to. */
function PrevMini({ page, strokes, byId }: { page: PageView; strokes: DrawStroke[] | undefined; byId: Record<string, Player> }) {
  const p = who(byId, page.by);
  if (page.kind === "draw" && !page.blank) {
    return (
      <figure className="flex w-full flex-col items-center gap-1 opacity-90">
        <div className="w-[46%] max-w-56 min-w-36">
          {strokes ? (
            <Drawing strokes={strokes} label={`Previous page: ${p.name}'s drawing`} className="rounded-lg ring-1 ring-white/15" />
          ) : (
            <div className="grid aspect-[4/3] w-full place-items-center rounded-lg bg-white/90 text-2xl">🎨</div>
          )}
        </div>
        <figcaption className="text-xs text-muted">
          <Avatar id={p.avatar} /> {p.name}&apos;s drawing
        </figcaption>
      </figure>
    );
  }
  return (
    <div className="gb-paper max-w-full rounded-xl px-3 py-1.5 text-center opacity-90">
      <p className="text-sm font-bold break-words @md:text-base">{page.blank ? "🤐 (blank)" : `“${page.text}”`}</p>
      <p className="text-[11px]" style={{ color: page.auto ? "#7a6e93" : shade(p.color) }}>
        {page.auto ? "🎲 picked by the game" : <><Avatar id={p.avatar} /> {p.name}</>}
      </p>
    </div>
  );
}

// ---------- the closing beat ----------

function BookEnd({ r, owner, byId, cache }: { r: RevealView; owner: Player; byId: Record<string, Player>; cache: DrawingCache }) {
  const version = useCacheVersion(cache);
  const pages = r.trail;
  return (
    <div className="gb-slide flex flex-col items-center gap-3">
      <p className="text-center font-display text-2xl font-extrabold @md:text-3xl">
        <span aria-hidden className="gb-book">
          📕
        </span>{" "}
        That&apos;s <span style={{ color: owner.color }}>{owner.name}</span>&apos;s book!
      </p>
      <ol className="grid w-full grid-cols-2 gap-2 @lg:grid-cols-4" aria-label="Every page of this book">
        {pages.map((p, i) => (
          <li key={i} className="gb-slide" style={{ animationDelay: `${120 + i * 90}ms` }}>
            <Tile
              page={p}
              n={i}
              tag={i === 0 ? "start" : i === pages.length - 1 ? "end" : null}
              strokes={version >= 0 ? cache.get(`${r.book}:${i}`) : undefined}
              byId={byId}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Tile({
  page,
  n,
  tag,
  strokes,
  byId,
}: {
  page: PageView;
  n: number;
  tag: "start" | "end" | null;
  strokes: DrawStroke[] | undefined;
  byId: Record<string, Player>;
}) {
  const p = who(byId, page.by);
  return (
    <figure className="relative flex flex-col gap-1">
      {page.kind === "draw" && !page.blank ? (
        strokes ? (
          <Drawing strokes={strokes} label={`Page ${n + 1}: ${p.name}'s drawing`} className="rounded-lg" />
        ) : (
          <div className="grid aspect-[4/3] w-full place-items-center rounded-lg bg-white/90 text-2xl">🎨</div>
        )
      ) : (
        <div className="gb-paper grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-lg p-2 text-center">
          <p className="line-clamp-4 text-sm leading-snug font-bold break-words @md:text-base">
            {page.blank ? "🤐 blank" : `“${page.text}”`}
          </p>
        </div>
      )}
      {tag && (
        <span
          className="absolute top-1 left-1 rounded-md px-1.5 py-0.5 text-[10px] font-black tracking-wider text-white uppercase"
          style={{ background: tag === "start" ? "#16a34a" : "#db2777" }}
        >
          {tag}
        </span>
      )}
      <figcaption className="flex min-w-0 items-center gap-1 text-[11px] text-muted">
        <span className="tabular-nums">{n + 1}.</span>
        {page.auto ? (
          <span className="truncate">🎲 the game</span>
        ) : (
          <>
            <span aria-hidden><Avatar id={p.avatar} /></span>
            <span className="truncate" style={{ color: p.color }}>
              {p.name}
            </span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

// ---------- reactions ----------

function ReactionBar({
  reactors,
  me,
  canReact,
  onReact,
  accent,
  hint,
}: {
  reactors: Set<string>[];
  me: string;
  canReact: boolean;
  onReact: (e: number) => void;
  accent: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="React to this page">
        {REACTIONS.map((emo, e) => {
          const n = reactors[e].size;
          const mine = reactors[e].has(me);
          return (
            <button
              key={e}
              type="button"
              aria-pressed={mine}
              aria-label={`${REACTION_NAMES[e]} ${emo}: ${n}`}
              aria-keyshortcuts={String(e + 1)}
              disabled={!canReact && !mine}
              onClick={() => onReact(e)}
              className="btn h-12 min-w-[4.25rem] gap-1.5 px-3 text-2xl leading-none"
              style={mine ? { borderColor: accent, background: `${accent}26` } : undefined}
            >
              <span aria-hidden>{emo}</span>
              <span key={n} className={`text-sm font-bold tabular-nums ${n ? "gb-bump" : "opacity-40"}`}>
                {n}
              </span>
            </button>
          );
        })}
      </div>
      {hint && <p className="text-center text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Floaters({ floaters, byId }: { floaters: Floater[]; byId: Record<string, Player> }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {floaters.map((f) => {
        const p = who(byId, f.by);
        return (
          <span
            key={f.id}
            className="gb-float flex flex-col items-center"
            style={{ left: `${f.x}%`, "--dx": `${f.dx}px`, "--rise": `${-f.rise}px` } as CSSProperties}
          >
            <span className="text-4xl drop-shadow-[0_4px_8px_rgba(0,0,0,0.45)]">{REACTIONS[f.e]}</span>
            <span
              className="mt-0.5 rounded-full px-1.5 text-[10px] font-bold whitespace-nowrap text-ink"
              style={{ background: p.color }}
            >
              {p.name}
            </span>
          </span>
        );
      })}
    </div>
  );
}
