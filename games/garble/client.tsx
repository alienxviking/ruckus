"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { GameClientProps } from "@/shared/client-game";
import type { GarbleAction, GarbleEvent, GarbleView } from "./server";
import { DrawingCache } from "./drawing";
import { FinalPhase } from "./final";
import { PlayPhase } from "./play";
import { RevealPhase } from "./reveal";
import { CSS } from "./ui";

function isBook(e: unknown): e is Extract<GarbleEvent, { k: "book" }> {
  if (!e || typeof e !== "object") return false;
  const r = e as Record<string, unknown>;
  return r.k === "book" && typeof r.b === "number" && Number.isInteger(r.b) && Array.isArray(r.pages);
}

export default function Garble({
  view,
  me,
  players,
  byId,
  isPlayer,
  act,
  serverNow,
  onEvent,
  accent,
}: GameClientProps<GarbleView, GarbleAction>) {
  // Drawings seen on stage (or fetched for the book browser) stay client-side,
  // since views only carry the page currently on stage.
  const [cache] = useState(() => new DrawingCache());

  useEffect(
    () =>
      onEvent((raw) => {
        if (!isBook(raw)) return;
        for (const pg of raw.pages) {
          if (pg && Number.isInteger(pg.p) && Array.isArray(pg.strokes)) cache.put(`${raw.b}:${pg.p}`, pg.strokes);
        }
      }),
    [onEvent, cache],
  );

  const reveal = view?.reveal ?? null;
  const onStage = reveal?.current?.kind === "draw" && reveal.current.strokes?.length ? reveal.current.strokes : null;
  const stageKey = reveal ? `${reveal.book}:${reveal.page}` : null;
  useEffect(() => {
    if (stageKey && onStage) cache.put(stageKey, onStage);
  }, [cache, stageKey, onStage]);

  const vars = { "--gb-accent": accent } as CSSProperties;

  if (!view) {
    return (
      <div className="card grid min-h-60 place-items-center p-6 text-muted" style={vars}>
        📚 Binding the books…
      </div>
    );
  }

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-3" style={vars}>
      <style href="ruckus-garble" precedence="default">
        {CSS}
      </style>
      {view.phase === "play" ? (
        <PlayPhase
          view={view}
          me={me}
          players={players}
          byId={byId}
          isPlayer={isPlayer}
          act={act}
          serverNow={serverNow}
          onEvent={onEvent}
          accent={accent}
        />
      ) : view.phase === "reveal" && view.reveal ? (
        <RevealPhase
          view={view}
          me={me}
          byId={byId}
          isPlayer={isPlayer}
          act={act}
          serverNow={serverNow}
          onEvent={onEvent}
          accent={accent}
          cache={cache}
        />
      ) : (
        <FinalPhase view={view} me={me} byId={byId} isPlayer={isPlayer} act={act} accent={accent} cache={cache} />
      )}
      {/* Keeps the last controls clear of the floating chat button on phones. */}
      <div aria-hidden className="h-16 @3xl:h-2" />
    </div>
  );
}
