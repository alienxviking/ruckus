"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, Copy, Flame, Image as ImageIcon, Play, RotateCcw, Trophy } from "lucide-react";
import dynamic from "next/dynamic";
import { renderDailyCard } from "@/lib/daily-card";
import { CATALOG_BY_ID } from "@/games/catalog";
import { GAME_CONFIG } from "@/games/config";
import { readSettings } from "@/shared/settings";
import type { GameResult } from "@/shared/types";
import {
  currentStreak,
  dailyGames,
  dailyNumber,
  dailyResultText,
  dailySeed,
  msToNextDay,
  readDaily,
  recordDaily,
  shareText,
  subscribeDaily,
  dailyDay,
  type DailyData,
} from "@/lib/daily";
import { LocalEngine, ME, useLocalGame } from "@/lib/local-engine";
import { feedback } from "@/lib/feedback";
import { Confetti } from "../Confetti";
import { GameBadge } from "../GameBadge";
import { Rux } from "../Rux";
import { Magnetic } from "../Magnetic";
import { LocalStage, loadLocalGame, localMe, type LoadedGame } from "../play/LocalStage";

// The story-card preview dialog, fetched when someone first asks for the picture.
const loadSharePreview = () => import("./SharePreview");
const SharePreview = dynamic(loadSharePreview, { ssr: false });

const SERVER_DATA: DailyData = { days: {}, best: {}, streak: { day: "", count: 0, best: 0 } };

// A once-a-second clock for the countdown (and to roll over at midnight India time).
const subscribeSecond = (fn: () => void) => {
  const t = setInterval(fn, 1000);
  return () => clearInterval(t);
};
const nowSecond = () => Math.floor(Date.now() / 1000);

const fmt = (n: number) => n.toLocaleString("en-US");

function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

interface Run {
  day: string;
  gameId: string;
  official: boolean;
  engine: LocalEngine;
  game: LoadedGame;
}

export function DailyChallenge() {
  const sec = useSyncExternalStore(subscribeSecond, nowSecond, () => 0);
  const data = useSyncExternalStore(subscribeDaily, readDaily, () => SERVER_DATA);
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState(false);

  if (!sec) return <Skeleton />;
  const day = dailyDay(sec * 1000);
  const games = dailyGames(day);

  const play = async (gameId: string) => {
    setLoading(gameId);
    setError(false);
    try {
      const game = await loadLocalGame(gameId);
      const d = readDaily();
      const official = !d.days[day]?.[gameId];
      if (official) recordDaily(day, gameId, { score: null, headline: "Unfinished", pending: true });
      const engine = new LocalEngine({
        def: game.def,
        me: localMe(),
        bots: 0,
        settings: readSettings(GAME_CONFIG[gameId]?.settings, {}),
        seed: dailySeed(day, gameId),
      });
      feedback("start");
      setRun({ day, gameId, official, engine, game });
      window.scrollTo({ top: 0 });
    } catch {
      setError(true);
    } finally {
      setLoading(null);
    }
  };

  if (run) {
    return (
      <DailyRun
        key={run.engine.id}
        run={run}
        data={data}
        next={games.find((id) => !data.days[run.day]?.[id])}
        onBack={() => setRun(null)}
        onPlay={play}
      />
    );
  }

  const today = data.days[day] ?? {};
  const done = games.filter((id) => today[id] && !today[id].pending).length;
  const streak = currentStreak(data, day);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <section className="animate-rise relative pt-2 pb-6">
        <span aria-hidden className="bob absolute top-0 right-0 hidden w-24 sm:block" style={{ "--tilt": "6deg" } as React.CSSProperties}>
          <Rux mood="grin" className="w-full" />
        </span>
        <p className="label mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            Daily <span className="text-text">#{dailyNumber(day)}</span>
          </span>
          <span className="text-line">/</span>
          <span>{day}</span>
          <span className="text-line">/</span>
          <span>
            New in <span className="text-text tabular-nums">{countdown(msToNextDay(sec * 1000))}</span>
          </span>
        </p>
        <h1 className="font-hero text-5xl leading-[0.9] font-extrabold tracking-[-0.04em] sm:text-7xl">
          Daily <span className="text-pink">challenge</span>
        </h1>
        <p className="marker mt-2 text-2xl text-brand-2">today: 3 games, same puzzles for everyone</p>
        <p className="mt-3 max-w-xl text-muted">
          Three games, the same puzzles for everyone today. Your first try is your score; replays are just for fun.
        </p>
      </section>

      <div className="mb-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
        <Stat label="Today" value={`${done}/${games.length}`} />
        <Stat
          label="Streak"
          value={
            <span className="inline-flex items-center gap-1.5">
              {streak > 0 && <Flame aria-hidden className="size-5 text-brand" strokeWidth={2} />}
              {streak}
            </span>
          }
        />
        <Stat label="Best streak" value={String(Math.max(data.streak.best, streak))} />
      </div>

      <ol className="grid gap-3">
        {games.map((id, i) => {
          const meta = CATALOG_BY_ID[id];
          const e = today[id];
          const best = data.best[id];
          return (
            <li
              key={id}
              className="card animate-rise flex items-center gap-3 p-3 sm:gap-4 sm:p-4"
              style={{ "--accent": meta.accent, animationDelay: `${80 + i * 60}ms` } as React.CSSProperties}
            >
              <span className="hidden font-mono text-xs text-muted sm:inline">0{i + 1}</span>
              <GameBadge id={id} accent={meta.accent} size="lg" sheen={!e} />
              <div className="w-0 min-w-0 flex-1">
                <div className="font-display text-lg leading-tight font-bold">{meta.name}</div>
                <p className="truncate text-sm text-muted">{meta.tagline}</p>
                <p className="mt-1 font-mono text-[11px] text-muted">
                  {e ? (
                    e.pending ? (
                      <span>Unfinished: your first try counts</span>
                    ) : (
                      <>
                        Score <span className="text-brand-2">{dailyResultText(id, e.score, e.headline)}</span>
                      </>
                    )
                  ) : (
                    "Not played yet"
                  )}
                  {best !== undefined && <> · best {fmt(best)}</>}
                </p>
              </div>
              {e ? (
                <button className="btn px-3 py-2 text-sm" onClick={() => play(id)} disabled={loading !== null}>
                  <RotateCcw aria-hidden className="size-4" strokeWidth={2} />
                  {loading === id ? (
                    "Loading…"
                  ) : (
                    <>
                      Replay<span className="hidden sm:inline"> for fun</span>
                    </>
                  )}
                </button>
              ) : (
                <Magnetic>
                  <button className="btn btn-primary px-4 py-2" onClick={() => play(id)} disabled={loading !== null}>
                    <Play aria-hidden className="size-4" strokeWidth={2.25} />
                    {loading === id ? "Loading…" : "Play"}
                  </button>
                </Magnetic>
              )}
            </li>
          );
        })}
      </ol>

      {error && (
        <p role="alert" className="card mt-3 border-brand/60 px-4 py-2 text-sm">
          Couldn&apos;t load that game. Check your connection and try again.
        </p>
      )}

      {Object.keys(today).length > 0 && <Share day={day} data={data} all={done === games.length} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-panel px-4 py-3">
      <div className="label text-[10px]">{label}</div>
      <div className="mt-0.5 font-display text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Share({ day, data, all }: { day: string; data: DailyData; all: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = shareText(day, data, `${window.location.origin}/daily`);
  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // No async clipboard (plain-http LAN, older browsers): copy via a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.append(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
    }
    if (!ok) return;
    setCopied(true);
    feedback("pop");
    setTimeout(() => setCopied(false), 2000);
  };
  // The picture version: a story card, previewed first, then shared or saved from there.
  const [making, setMaking] = useState(false);
  const [card, setCard] = useState<File | null>(null);
  const [preview, setPreview] = useState(false);
  const shareImage = async () => {
    setMaking(true);
    try {
      const css = getComputedStyle(document.documentElement);
      const font = (v: string, fallback: string) => css.getPropertyValue(v).trim() || fallback;
      const blob = await renderDailyCard(day, data, {
        hero: font("--font-hero-face", "sans-serif"),
        marker: font("--font-marker-face", "cursive"),
        sans: font("--font-geist-sans", "sans-serif"),
      });
      if (!blob) return;
      setCard(new File([blob], `ruckus-daily-${day}.png`, { type: "image/png" }));
      setPreview(true);
    } finally {
      setMaking(false);
    }
  };
  const today = data.days[day] ?? {};
  const streak = currentStreak(data, day);
  const games = dailyGames(day);
  return (
    <section
      aria-labelledby="share-heading"
      className="animate-rise relative mt-5 overflow-hidden rounded-2xl border-2 p-4 sm:p-5"
      style={{
        borderColor: all ? "color-mix(in srgb, var(--color-brand-2) 60%, transparent)" : "var(--color-line)",
        background: all
          ? "radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--color-brand-2) 14%, transparent), transparent 60%), var(--color-panel)"
          : "var(--color-panel)",
      }}
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="bob w-12 shrink-0 sm:w-14" style={{ "--tilt": "-8deg" } as React.CSSProperties}>
          <Rux mood={all ? "wink" : "grin"} className="w-full" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="marker text-lg leading-none text-brand-2">{all ? "aaj ka kaam khatam!" : "aadha ho gaya, chalo"}</p>
          <h2 id="share-heading" className="mt-1 font-hero text-xl leading-tight font-extrabold tracking-tight sm:text-2xl">
            Ruckus Daily #{dailyNumber(day)}
          </h2>
        </div>
        {streak > 1 && (
          <span className="flex shrink-0 items-center gap-1 rounded-full border-2 border-brand/50 bg-brand/10 px-2.5 py-1 text-sm font-bold">
            <Flame aria-hidden className="size-4 text-brand" strokeWidth={2.25} />
            {streak}
            <span className="sr-only">-day streak</span>
          </span>
        )}
      </div>

      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Today's scores">
        {games.map((id) => {
          const meta = CATALOG_BY_ID[id];
          const e = today[id];
          const value = !e ? "–" : e.pending ? "unfinished" : dailyResultText(id, e.score, e.headline);
          return (
            <li key={id} className="flex items-center gap-1.5 rounded-full border border-line bg-ink/50 py-0.5 pr-2.5 pl-0.5 text-xs">
              {meta && <GameBadge id={id} accent={meta.accent} size="xs" className="!rounded-full" />}
              <span className="sr-only">{meta?.name ?? id}:</span>
              <span className="font-mono font-bold tabular-nums" style={{ color: e && !e.pending ? meta?.accent : undefined }}>
                {value}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex gap-2">
        <button className={`btn min-h-11 flex-1 justify-center text-base font-bold ${all ? "btn-primary" : ""}`} onClick={shareImage} onPointerEnter={loadSharePreview} disabled={making}>
          <ImageIcon aria-hidden className="size-4" strokeWidth={2.2} />
          {making ? "Making…" : all ? "Share my day" : "Share so far"}
        </button>
        <button className="btn min-h-11 px-3.5 text-sm" onClick={copy} aria-live="polite" title="Copy as text">
          {copied ? <Check aria-hidden className="size-4" strokeWidth={2.25} /> : <Copy aria-hidden className="size-4" strokeWidth={2} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {card && <SharePreview open={preview} onOpenChange={setPreview} file={card} text={text} />}
    </section>
  );
}

function DailyRun({
  run,
  data,
  next,
  onBack,
  onPlay,
}: {
  run: Run;
  data: DailyData;
  next: string | undefined;
  onBack: () => void;
  onPlay: (id: string) => void;
}) {
  const snap = useLocalGame(run.engine);
  const result = snap?.result ?? null;
  const [quitting, setQuitting] = useState(false);

  // Lock in the official score the moment the game ends.
  const saved = useRef(false);
  useEffect(() => {
    if (!result || saved.current) return;
    saved.current = true;
    const score = result.scores?.[ME];
    if (run.official) recordDaily(run.day, run.gameId, { score: typeof score === "number" ? score : null, headline: result.headline });
    feedback(result.winners.includes(ME) || typeof score === "number" ? "win" : "end");
  }, [result, run]);

  if (!snap) return null;
  const quit = () => {
    if (run.official && !result) {
      if (!quitting) return setQuitting(true);
      recordDaily(run.day, run.gameId, { score: 0, headline: "Gave up" });
    }
    run.engine.stop();
    onBack();
  };

  return (
    <div className="animate-rise">
      <LocalStage
        gameId={run.gameId}
        engine={run.engine}
        Client={run.game.Client}
        snap={snap}
        pausable={false}
        label={run.official ? `Daily #${dailyNumber(run.day)}` : "Replay"}
        actions={
          !result && (
            <button className={`btn min-h-10 px-3 py-1.5 text-sm ${quitting ? "border-brand/70 text-brand" : ""}`} onClick={quit}>
              {quitting ? "Quit: score 0?" : "Quit"}
            </button>
          )
        }
        banner={
          result && (
            <DailyResult run={run} result={result} data={data} next={next} onBack={onBack} onPlay={onPlay} />
          )
        }
      />
    </div>
  );
}

function DailyResult({
  run,
  result,
  data,
  next,
  onBack,
  onPlay,
}: {
  run: Run;
  result: GameResult;
  data: DailyData;
  next: string | undefined;
  onBack: () => void;
  onPlay: (id: string) => void;
}) {
  const meta = CATALOG_BY_ID[run.gameId];
  const a = meta?.accent ?? "#c6f432";
  const score = result.scores?.[ME];
  const official = data.days[run.day]?.[run.gameId];
  const best = data.best[run.gameId];
  const nextMeta = next ? CATALOG_BY_ID[next] : undefined;
  return (
    <div
      role="status"
      className="card result-banner relative flex flex-col gap-4 p-4 sm:p-5"
      style={{
        borderColor: a + "aa",
        background: `radial-gradient(90% 140% at 0% 0%, ${a}2a, transparent 60%), var(--color-panel)`,
        boxShadow: `0 0 0 1px ${a}33, 0 20px 50px -24px ${a}`,
      }}
    >
      <span aria-hidden className="banner-sweep" />
      {run.official && typeof score === "number" && score > 0 && <Confetti pieces={36} />}
      <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
        <span
          aria-hidden
          className="game-badge animate-trophy size-14 shrink-0 rounded-xl"
          style={{ "--accent": "var(--color-brand-2)" } as React.CSSProperties}
          data-sheen="true"
        >
          <Trophy className="glyph" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="label mb-1 text-brand-2">{run.official ? "Official score" : "Replay (just for fun)"}</div>
          <div className="font-display text-3xl font-bold tracking-tight tabular-nums">
            {typeof score === "number" ? dailyResultText(run.gameId, score, result.headline) : "Done"}
          </div>
          <div className="mt-1 text-sm text-muted">{result.headline}</div>
          <div className="mt-1 font-mono text-[11px] text-muted">
            {!run.official && official && official.score !== null && <>Today&apos;s official: {fmt(official.score)} · </>}
            {best !== undefined && <>Your best: {fmt(best)}</>}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
        {nextMeta ? (
          <Magnetic>
            <button className="btn btn-primary" onClick={() => onPlay(nextMeta.id)}>
              Next: {nextMeta.name}
            </button>
          </Magnetic>
        ) : (
          <Magnetic>
            <button className="btn btn-primary" onClick={onBack}>
              See today&apos;s results
            </button>
          </Magnetic>
        )}
        {nextMeta && (
          <button className="btn" onClick={onBack}>
            Today&apos;s challenge
          </button>
        )}
        <button className="btn" onClick={() => onPlay(run.gameId)}>
          <RotateCcw aria-hidden className="size-4" strokeWidth={2} />
          Replay for fun
        </button>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl" aria-busy="true">
      <div className="pt-2 pb-6">
        <div className="label mb-3">Daily</div>
        <h1 className="font-hero text-3xl leading-[1.05] font-extrabold tracking-[-0.03em] sm:text-5xl">
          Daily <span className="text-brand-2">challenge</span>
        </h1>
        <p className="mt-3 max-w-xl text-muted">Loading today&apos;s games…</p>
      </div>
      <div className="grid gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card h-24 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
