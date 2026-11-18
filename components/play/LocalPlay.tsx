"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Bot, Minus, Plus, User, Users } from "lucide-react";
import { CATALOG_BY_ID } from "@/games/catalog";
import { GAME_CONFIG } from "@/games/config";
import { readSettings, type SettingDef, type Settings } from "@/shared/settings";
import type { GameResult } from "@/shared/types";
import { BOT_AVATARS, BOT_NAMES, LocalEngine, ME, useLocalGame } from "@/lib/local-engine";
import { botRange, defaultBots } from "@/lib/local-games";
import { feedback } from "@/lib/feedback";
import { useCreateRoom } from "@/lib/useCreateRoom";
import { Avatar } from "../Avatar";
import { Confetti } from "../Confetti";
import { CoverArt } from "../CoverArt";
import { RateGame } from "../RateGame";
import { markPlayed } from "@/lib/my-games";
import { Rux } from "../Rux";
import { Magnetic } from "../Magnetic";
import { PlayerChip } from "../game-ui";
import { HowToPlay } from "../room/HowToPlay";
import { LocalSettings } from "./LocalSettings";
import { LocalStage, loadLocalGame, localMe, type LoadedGame } from "./LocalStage";

// ---- remembered choices per game (bot count + settings) ----

const PREFS = "ruckus:local-prefs:";
const prefListeners = new Set<() => void>();
const subscribePrefs = (fn: () => void) => {
  prefListeners.add(fn);
  return () => {
    prefListeners.delete(fn);
  };
};
function readPrefsRaw(id: string): string {
  try {
    return localStorage.getItem(PREFS + id) ?? "";
  } catch {
    return "";
  }
}
function writePrefs(id: string, prefs: { bots: number; settings: Settings }) {
  try {
    localStorage.setItem(PREFS + id, JSON.stringify(prefs));
  } catch {
    /* not remembered */
  }
  for (const fn of prefListeners) fn();
}

const NO_SETTINGS: SettingDef[] = [];

export function LocalPlay({ gameId }: { gameId: string }) {
  const meta = CATALOG_BY_ID[gameId];
  const defs = GAME_CONFIG[gameId]?.settings ?? NO_SETTINGS;
  const range = botRange(meta);

  const raw = useSyncExternalStore(subscribePrefs, () => readPrefsRaw(gameId), () => "");
  const prefs = useMemo(() => {
    let saved: { bots?: unknown; settings?: Settings } = {};
    try {
      saved = raw ? JSON.parse(raw) : {};
    } catch {
      /* ignore */
    }
    const n = Number(saved.bots);
    const bots = Number.isInteger(n) ? Math.min(range.max, Math.max(range.min, n)) : defaultBots(meta);
    return { bots, settings: readSettings(defs, saved.settings) };
  }, [raw, range.min, range.max, meta, defs]);

  const myAvatar = useSyncExternalStore(subscribePrefs, () => localMe().avatar, () => "fox");
  const [game, setGame] = useState<LoadedGame | null>(null);
  const [engine, setEngine] = useState<LocalEngine | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [starting, setStarting] = useState(false);

  // Fetch the game's code while you choose, so Start is instant.
  useEffect(() => {
    let live = true;
    loadLocalGame(gameId).then(
      (g) => live && setGame(g),
      () => live && setLoadError(true),
    );
    return () => {
      live = false;
    };
  }, [gameId]);

  const start = async () => {
    setStarting(true);
    try {
      const g = game ?? (await loadLocalGame(gameId));
      setGame(g);
      setEngine(
        new LocalEngine({ def: g.def, me: localMe(), bots: prefs.bots, settings: prefs.settings, persistMemory: true }),
      );
      feedback("start");
      markPlayed(gameId);
      window.scrollTo({ top: 0 });
    } catch {
      setLoadError(true);
    } finally {
      setStarting(false);
    }
  };

  if (engine && game) {
    return (
      <Playing
        gameId={gameId}
        engine={engine}
        game={game}
        bots={prefs.bots}
        onAgain={start}
        onQuit={() => setEngine(null)}
      />
    );
  }

  const set = (next: Partial<{ bots: number; settings: Settings }>) => writePrefs(gameId, { ...prefs, ...next });
  const solo = range.max === 0;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div
        className="animate-rise stk relative overflow-hidden p-5 sm:p-6"
        style={{ "--accent": meta.accent, "--stk-bg": "var(--color-panel)", boxShadow: `6px 7px 0 color-mix(in oklab, ${meta.accent} 55%, #000)` } as React.CSSProperties}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{ background: `radial-gradient(70% 90% at 0% 0%, ${meta.accent}22, transparent 60%)` }}
        />
        <div className="relative flex items-start gap-4">
          <span className="slap w-32 shrink-0 sm:w-44" style={{ "--tilt": "-4deg" } as React.CSSProperties}>
            <CoverArt game={meta} className="rounded-xl border-[3px] border-paper shadow-[4px_5px_0_rgb(0_0_0/0.55)]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="marker mb-1 text-xl leading-none" style={{ color: meta.accent }}>
              {solo ? "solo" : range.min === 0 ? "solo or vs bots" : "vs bots"}
            </p>
            <h1 className="font-hero text-3xl leading-[0.95] font-extrabold tracking-[-0.03em] sm:text-4xl">{meta.name}</h1>
            <p className="mt-1 text-muted">{meta.tagline}</p>
          </div>
        </div>
        <ol className="relative mt-5 space-y-2 text-sm text-text/90">
          {meta.how.map((line, i) => (
            <li key={i} className="flex gap-3">
              <span className="pt-px font-mono text-xs font-medium" style={{ color: meta.accent }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
        <div className="relative mt-4">
          <HowToPlay gameId={gameId} />
        </div>
      </div>

      <div className="mt-3 grid gap-3">
        <div className="card animate-rise p-4" style={{ animationDelay: "60ms" }}>
          <h2 className="label mb-3 flex items-center gap-2">
            <Bot aria-hidden className="size-3.5" strokeWidth={2} /> Opponents
          </h2>
          {solo ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <User aria-hidden className="size-4 text-brand-2" strokeWidth={2} />
              Just you: a solo game. Beat your best score.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2" role="group" aria-label="Number of bots">
                <button
                  type="button"
                  className="btn size-10 p-0"
                  aria-label="Fewer bots"
                  disabled={prefs.bots <= range.min}
                  onClick={() => set({ bots: prefs.bots - 1 })}
                >
                  <Minus aria-hidden className="size-4" strokeWidth={2.25} />
                </button>
                <output aria-live="polite" className="w-20 text-center">
                  <span className="block font-display text-2xl leading-none font-bold">{prefs.bots}</span>
                  <span className="text-xs font-semibold text-muted">{prefs.bots === 1 ? "bot" : "bots"}</span>
                </output>
                <button
                  type="button"
                  className="btn size-10 p-0"
                  aria-label="More bots"
                  disabled={prefs.bots >= range.max}
                  onClick={() => set({ bots: prefs.bots + 1 })}
                >
                  <Plus aria-hidden className="size-4" strokeWidth={2.25} />
                </button>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" aria-hidden>
                <span className="text-2xl">
                  <Avatar id={myAvatar} />
                </span>
                {prefs.bots > 0 && <span className="font-mono text-xs text-muted">vs</span>}
                {Array.from({ length: prefs.bots }, (_, i) => (
                  <span key={i} className="animate-pop text-2xl" title={BOT_NAMES[i]}>
                    <Avatar id={BOT_AVATARS[i % BOT_AVATARS.length]} />
                  </span>
                ))}
                {prefs.bots === 0 && <span className="text-sm text-muted">Solo run</span>}
              </div>
            </div>
          )}
        </div>

        {defs.length > 0 && (
          <div className="animate-rise" style={{ animationDelay: "120ms" }}>
            <LocalSettings
              defs={defs}
              value={prefs.settings}
              onChange={(key, v) => set({ settings: { ...prefs.settings, [key]: v } })}
            />
          </div>
        )}

        {loadError && (
          <p role="alert" className="card border-brand/60 px-4 py-2 text-sm">
            Couldn&apos;t load this game. Check your connection and try again.
          </p>
        )}

        <div className="animate-rise flex flex-col gap-2 sm:flex-row" style={{ animationDelay: "160ms" }}>
          <Magnetic className="flex-1">
            <button className="btn btn-primary w-full py-3 text-lg" onClick={start} disabled={starting}>
              {starting ? "Loading…" : "Start"}
            </button>
          </Magnetic>
          <FriendsButton gameId={gameId} className="py-3" />
        </div>
      </div>
    </div>
  );
}

function Playing({
  gameId,
  engine,
  game,
  bots,
  onAgain,
  onQuit,
}: {
  gameId: string;
  engine: LocalEngine;
  game: LoadedGame;
  bots: number;
  onAgain: () => void;
  onQuit: () => void;
}) {
  const snap = useLocalGame(engine);
  const result = snap?.result ?? null;
  // Win/lose sound once per game. (Local wins never count towards unlocks.)
  const cued = useRef<LocalEngine | null>(null);
  useEffect(() => {
    if (!result || cued.current === engine) return;
    cued.current = engine;
    feedback(result.winners.includes(ME) ? "win" : "end");
  }, [result, engine]);

  if (!snap) return null;
  return (
    <div className="animate-rise">
      <LocalStage
        gameId={gameId}
        engine={engine}
        Client={game.Client}
        snap={snap}
        label={bots ? `vs ${bots} ${bots === 1 ? "bot" : "bots"}` : "solo"}
        actions={
          !result && (
            <button className="btn min-h-10 px-3 py-1.5 text-sm" onClick={onQuit}>
              Quit
            </button>
          )
        }
        banner={result && <LocalResult gameId={gameId} result={result} engine={engine} onAgain={onAgain} onSetup={onQuit} />}
      />
    </div>
  );
}

function LocalResult({
  gameId,
  result,
  engine,
  onAgain,
  onSetup,
}: {
  gameId: string;
  result: GameResult;
  engine: LocalEngine;
  onAgain: () => void;
  onSetup: () => void;
}) {
  const meta = CATALOG_BY_ID[gameId];
  const a = meta?.accent ?? "#c6f432";
  const iWon = result.winners.includes(ME);
  const scores = result.scores;
  const standings = scores
    ? engine.players
        .filter((p) => scores[p.id] !== undefined)
        // Winners first (some games rank by more than score), then by score.
        .sort((x, y) => Number(result.winners.includes(y.id)) - Number(result.winners.includes(x.id)) || scores[y.id] - scores[x.id])
    : [];
  const solo = engine.players.length === 1;

  return (
    <div
      role="status"
      className="stk result-banner relative flex flex-col gap-4 overflow-hidden p-4 sm:p-5"
      style={{
        background: `radial-gradient(90% 140% at 50% 0%, ${a}33, transparent 65%), var(--color-panel)`,
        boxShadow: `6px 7px 0 color-mix(in oklab, ${a} 55%, #000)`,
      }}
    >
      {(iWon || (solo && scores?.[ME])) && <Confetti pieces={36} />}
      <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
        <span className="slap w-20 shrink-0 sm:w-24" style={{ "--tilt": "-6deg" } as React.CSSProperties}>
          <Rux mood={solo || iWon ? "shout" : "wow"} megaphone className="w-full" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="marker text-2xl leading-none" style={{ color: a }}>
            {solo ? (scores?.[ME] ? "shabaash! done ✅" : "arre, next time! 🤞") : iWon ? "tu toh chha gaya! 🔥" : "agli baar pakka 🤞"}
          </div>
          <div className="mt-1 font-hero text-xl leading-tight font-extrabold tracking-[-0.02em] sm:text-2xl">{result.headline}</div>
          {/* Word Ladder's score only ranks steps; its headline already says how you did. */}
          {solo && gameId !== "ladder" && scores?.[ME] !== undefined && (
            <div className="mt-1 text-sm font-semibold text-muted">
              Your score <span className="font-hero text-lg text-brand-2">{scores[ME].toLocaleString("en-US")}</span>
            </div>
          )}
        </div>
      </div>
      {!solo && standings.length > 0 && (
        <ol className="flex flex-wrap justify-center gap-1.5 sm:justify-start">
          {standings.map((p, i) => (
            <li key={p.id}>
              <PlayerChip player={p} size="sm" dim={!result.winners.includes(p.id) && i > 0}>
                <span className="text-xs font-bold text-text/80">{scores![p.id].toLocaleString("en-US")}</span>
              </PlayerChip>
            </li>
          ))}
        </ol>
      )}
      {!solo && !standings.length && result.winners.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5 sm:justify-start">
          {result.winners.map((id) => (
            <PlayerChip key={id} player={engine.byId[id]} size="sm" />
          ))}
        </div>
      )}
      <div className="flex justify-center sm:justify-start">
        <RateGame gameId={gameId} gameKey={`local-${engine.id}`} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-start">
        <button className="stk-btn col-span-2 px-5 py-2.5 text-lg sm:col-span-1" onClick={onAgain}>
          Play again
        </button>
        <button className="btn" onClick={onSetup}>
          Change setup
        </button>
        <Link className="btn" href="/play">
          Change game
        </Link>
        <div className="col-span-2 sm:col-span-1">
          <FriendsButton gameId={gameId} className="w-full" />
        </div>
      </div>
    </div>
  );
}

/** "Play this with friends": makes a room with this game picked. */
export function FriendsButton({ gameId, className = "" }: { gameId: string; className?: string }) {
  const { create, busy, error } = useCreateRoom();
  return (
    <div className="flex flex-col">
      <button className={`btn ${className}`} onClick={() => create(gameId)} disabled={busy}>
        <Users aria-hidden className="size-4" strokeWidth={2} />
        {busy ? "Creating room…" : "Play this with friends"}
      </button>
      {error && (
        <p role="alert" className="mt-1.5 max-w-xs text-xs text-brand">
          {error}
        </p>
      )}
    </div>
  );
}
