"use client";

import { useEffect, useState } from "react";
import type { Player } from "@/shared/types";
import { PlayerChip, Scoreboard, StatusBanner } from "@/components/game-ui";
import type { FinalPage, FinalView, GarbleAction, GarbleView } from "./server";
import { Drawing, useCacheVersion, useCached, type DrawingCache } from "./drawing";
import { BADGE_NAMES, REACTIONS } from "./shared";
import { who } from "./ui";

interface FinalProps {
  view: GarbleView;
  me: string;
  byId: Record<string, Player>;
  isPlayer: boolean;
  act: (a: GarbleAction) => void;
  accent: string;
  cache: DrawingCache;
}

export function FinalPhase({ view, me, byId, isPlayer, act, accent, cache }: FinalProps) {
  const f = view.final;
  if (!f) return null;
  const mine = f.scores[me] ?? 0;
  return (
    <>
      <div aria-live="polite">
        <StatusBanner accent={accent}>
          📚 All {f.books.length} books are out!
          {isPlayer && (
            <span className="block text-sm font-semibold text-muted">
              Your pages got {mine} reaction{mine === 1 ? "" : "s"}
            </span>
          )}
        </StatusBanner>
      </div>
      <div className="grid items-start gap-3 @2xl:grid-cols-[minmax(0,1fr)_16rem]">
        <Awards f={f} byId={byId} accent={accent} />
        <Scoreboard scores={f.scores} byId={byId} order={view.players} highlight={me} title="Reactions received" />
      </div>
      <BookBrowser f={f} byId={byId} act={act} accent={accent} cache={cache} me={me} />
    </>
  );
}

function Awards({ f, byId, accent }: { f: FinalView; byId: Record<string, Player>; accent: string }) {
  const best = Math.max(0, ...Object.values(f.scores));
  const top = best > 0 ? Object.keys(f.scores).filter((id) => f.scores[id] === best) : [];
  return (
    <section className="card flex flex-col gap-3 p-3 @md:p-4" aria-label="Awards">
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="label">Most-loved pages</span>
        {top.length ? (
          <>
            <span aria-hidden className="gb-book text-4xl">
              🏆
            </span>
            <div className="flex flex-wrap justify-center gap-1.5">
              {top.map((id) => (
                <PlayerChip key={id} player={who(byId, id)} />
              ))}
            </div>
            <span className="text-sm text-muted">
              {best} reaction{best === 1 ? "" : "s"}
              {top.length > 1 ? " each" : ""}
            </span>
          </>
        ) : (
          <span className="text-sm text-muted">Tough crowd: nobody reacted this time 🤐</span>
        )}
      </div>
      {f.badges.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 @xl:grid-cols-2">
          {f.badges.map((b, i) => (
            <li
              key={b.e}
              className="gb-slide flex items-center gap-2.5 rounded-xl border border-line bg-panel-2 px-3 py-2"
              style={{ animationDelay: `${150 + i * 90}ms`, borderColor: `${accent}44` }}
            >
              <span aria-hidden className="text-3xl leading-none">
                {REACTIONS[b.e]}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs font-bold text-muted">{BADGE_NAMES[b.e]}</span>
                <span className="flex flex-wrap gap-1">
                  {b.ids.map((id) => (
                    <PlayerChip key={id} player={who(byId, id)} size="sm" />
                  ))}
                </span>
              </div>
              <span className="shrink-0 font-mono text-lg font-bold tabular-nums">
                {b.n}
                <span className="sr-only"> {REACTIONS[b.e]} reactions</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BookBrowser({
  f,
  byId,
  act,
  accent,
  cache,
  me,
}: {
  f: FinalView;
  byId: Record<string, Player>;
  act: (a: GarbleAction) => void;
  accent: string;
  cache: DrawingCache;
  me: string;
}) {
  const [sel, setSel] = useState(() => Math.max(0, f.books.findIndex((b) => b.owner === me)));
  const b = Math.min(sel, f.books.length - 1);
  const book = f.books[b];
  const version = useCacheVersion(cache);
  const missing = version >= 0 && !!book && book.pages.some((p, i) => p.kind === "draw" && !p.blank && !cache.get(`${b}:${i}`));

  // Drawings we didn't see during the reveal: ask for this book (retrying if the request was dropped).
  useEffect(() => {
    if (!missing) return;
    act({ type: "book", b });
    const t = window.setInterval(() => act({ type: "book", b }), 1500);
    return () => window.clearInterval(t);
  }, [missing, b, act]);

  if (!book) return null;
  const owner = who(byId, book.owner);
  const go = (d: number) => setSel((b + d + f.books.length) % f.books.length);

  return (
    <section className="card flex flex-col gap-3 p-3 @md:p-4" aria-label="Browse the books">
      <div className="flex items-center gap-2">
        <h2 className="mr-auto font-display text-lg font-extrabold">📚 The books</h2>
        <button type="button" className="btn size-10 p-0" aria-label="Previous book" onClick={() => go(-1)}>
          ◀
        </button>
        <span className="w-12 text-center text-sm text-muted tabular-nums">
          {b + 1}/{f.books.length}
        </span>
        <button type="button" className="btn size-10 p-0" aria-label="Next book" onClick={() => go(1)}>
          ▶
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pick a book">
        {f.books.map((bk, i) => {
          const p = who(byId, bk.owner);
          const on = i === b;
          return (
            <button
              key={i}
              type="button"
              aria-pressed={on}
              onClick={() => setSel(i)}
              className="flex min-h-10 max-w-full items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors"
              style={{
                borderColor: on ? p.color : "var(--color-line)",
                background: on ? `${p.color}26` : "var(--color-panel-2)",
              }}
            >
              <span aria-hidden>{p.avatar}</span>
              <span className="truncate" style={{ color: p.color }}>
                {p.name}
              </span>
            </button>
          );
        })}
      </div>
      <h3 className="text-sm text-muted">
        <span aria-hidden>📕 </span>
        <b style={{ color: owner.color }}>{owner.name}</b>&apos;s book · {book.pages.length} pages
      </h3>
      <ol key={b} className="flex flex-col gap-3">
        {book.pages.map((p, i) => (
          <li key={i} className="gb-slide" style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}>
            <BookPage page={p} n={i} b={b} byId={byId} cache={cache} accent={accent} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function BookPage({
  page,
  n,
  b,
  byId,
  cache,
  accent,
}: {
  page: FinalPage;
  n: number;
  b: number;
  byId: Record<string, Player>;
  cache: DrawingCache;
  accent: string;
}) {
  const p = who(byId, page.by);
  const strokes = useCached(cache, page.kind === "draw" && !page.blank ? `${b}:${n}` : null);
  const verb = n === 0 ? (page.auto ? "🎲 the game's prompt" : "✍️ wrote") : page.kind === "draw" ? "🎨 drew" : "💬 described";
  const total = page.r.reduce((s, x) => s + x, 0);
  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span
          className="grid size-6 place-items-center rounded-full text-[11px] font-black text-ink tabular-nums"
          style={{ background: accent }}
        >
          {n + 1}
        </span>
        <PlayerChip player={p} size="sm" />
        <span>{verb}</span>
        {total > 0 && (
          <span className="ml-auto flex gap-2" aria-label="Reactions">
            {page.r.map((c, e) =>
              c ? (
                <span key={e} className="tabular-nums">
                  {REACTIONS[e]} {c}
                </span>
              ) : null,
            )}
          </span>
        )}
      </figcaption>
      {page.kind === "draw" && !page.blank ? (
        <div className="w-full max-w-md">
          {strokes ? (
            <Drawing strokes={strokes} label={`Page ${n + 1}: ${p.name}'s drawing`} className="gb-sheet rounded-xl" />
          ) : (
            <div className="grid aspect-[4/3] w-full place-items-center rounded-xl bg-white/90 text-sm text-[#7a6e93]">
              Loading the drawing…
            </div>
          )}
        </div>
      ) : (
        <div className="gb-paper max-w-xl rounded-xl px-4 py-2.5">
          <p className="font-display text-lg leading-snug font-bold break-words @md:text-xl">
            {page.blank ? <span className="text-[#7a6e93]">🤐 left blank</span> : `“${page.text}”`}
          </p>
        </div>
      )}
    </figure>
  );
}
