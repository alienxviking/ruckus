"use client";

import { useRef } from "react";
import { CATEGORY_LABEL, type GameMeta } from "@/games/catalog";
import { GameBadge } from "./GameBadge";

export function GameCard({
  game,
  selected,
  onSelect,
  disabled,
}: {
  game: GameMeta;
  selected?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  /** Position in the grid (the browser staggers the entrance). */
  index?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const frame = useRef(0);
  const players =
    game.minPlayers === game.maxPlayers ? `${game.minPlayers}` : `${game.minPlayers}–${game.maxPlayers}`;

  // Tilt + spotlight for fine pointers: CSS variables feed transforms only.
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const el = ref.current;
    if (!el) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const px = (clientX - r.left) / r.width;
      const py = (clientY - r.top) / r.height;
      el.dataset.tilting = "true";
      el.style.setProperty("--mx", `${(px * r.width).toFixed(0)}px`);
      el.style.setProperty("--my", `${(py * r.height).toFixed(0)}px`);
      el.style.setProperty("--rx", `${((0.5 - py) * 5).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${((px - 0.5) * 7).toFixed(2)}deg`);
    });
  };
  const onPointerLeave = () => {
    const el = ref.current;
    cancelAnimationFrame(frame.current);
    if (!el) return;
    delete el.dataset.tilting;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  };

  const tags = (cls: string) => (
    <div aria-hidden className={`flex flex-wrap gap-1 font-mono text-[10px] font-medium tracking-[0.1em] uppercase ${cls}`}>
      {game.isNew && (
        <span className="rounded-sm px-1.5 py-0.5 text-ink" style={{ background: game.accent }}>
          New
        </span>
      )}
      {game.original && (
        <span className="rounded-sm border border-brand-2/20 bg-brand-2/5 px-1.5 py-0.5 text-brand-2/85">Original</span>
      )}
      <span className="rounded-sm border border-line px-1.5 py-0.5 text-muted">{CATEGORY_LABEL[game.category]}</span>
    </div>
  );

  const body = (
    <>
      <span aria-hidden className="spot" />
      {/* Phones: badge beside the text, compact. Wider: badge on top, tags top-right. */}
      <div className="flex items-start gap-3.5 sm:block">
        <div className="flex items-start justify-between gap-3">
          <GameBadge id={game.id} accent={game.accent} size="md" active={selected} />
          {tags("hidden sm:flex justify-end")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg leading-tight font-bold tracking-tight sm:mt-3.5">
            {game.name}
            <span className="sr-only">
              {" "}
              ({CATEGORY_LABEL[game.category]}
              {game.original ? ", original" : ""}
              {game.isNew ? ", new" : ""})
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">{game.tagline}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] tracking-wide text-muted sm:mt-3.5 sm:flex-nowrap">
            <span
              aria-hidden
              className="accent-rule hidden h-px flex-1 sm:block"
              style={{ background: `linear-gradient(90deg, ${game.accent}, transparent)` }}
            />
            {tags("sm:hidden")}
            <span className="shrink-0">
              <span className="text-text/90">{players}</span> players
            </span>
            <span className="shrink-0">
              ~<span className="text-text/90">{game.minutes}</span> min
            </span>
          </div>
        </div>
      </div>
    </>
  );

  const style = {
    "--accent": game.accent,
  } as React.CSSProperties;
  const cls = `card game-card badge-trigger relative block h-full w-full p-4 text-left ${selected ? "bg-panel-2" : ""}`;
  if (!onSelect) {
    return (
      <div
        ref={ref as React.RefObject<HTMLDivElement>}
        className={cls}
        style={style}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        {body}
      </div>
    );
  }
  return (
    <button
      ref={ref as React.RefObject<HTMLButtonElement>}
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`${cls} disabled:cursor-default`}
      style={style}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {body}
    </button>
  );
}
