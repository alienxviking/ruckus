import { CATEGORY_LABEL, type GameMeta } from "@/games/catalog";

export function GameCard({
  game,
  selected,
  onSelect,
  disabled,
  index = 0,
}: {
  game: GameMeta;
  selected?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  /** Position in the grid, for a staggered entrance. */
  index?: number;
}) {
  const players =
    game.minPlayers === game.maxPlayers ? `${game.minPlayers}` : `${game.minPlayers}–${game.maxPlayers}`;
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden
          className="game-emoji grid size-12 shrink-0 place-items-center rounded-xl text-2xl"
          style={{ background: game.accent + "22", boxShadow: `inset 0 0 0 1px ${game.accent}44` }}
        >
          {game.emoji}
        </span>
        <div className="flex flex-wrap justify-end gap-1.5 text-[11px] font-semibold">
          {game.isNew && (
            <span className="rounded-full px-2 py-0.5 text-ink" style={{ background: game.accent }}>
              NEW
            </span>
          )}
          {game.original && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-brand">ORIGINAL</span>}
          <span className="rounded-full bg-panel-2 px-2 py-0.5 text-muted">{CATEGORY_LABEL[game.category]}</span>
        </div>
      </div>
      <div className="mt-3 font-display text-lg font-bold">{game.name}</div>
      <p className="mt-0.5 text-sm text-muted">{game.tagline}</p>
      <div className="mt-3 flex gap-3 text-xs text-muted">
        <span>👥 {players}</span>
        <span>⏱ ~{game.minutes} min</span>
      </div>
    </>
  );

  const style = {
    "--accent": game.accent,
    animationDelay: `${Math.min(index, 12) * 35}ms`,
    ...(selected ? { borderColor: game.accent, boxShadow: `0 0 0 1px ${game.accent}, 0 12px 30px -14px ${game.accent}` } : {}),
  } as React.CSSProperties;
  const cls = "card game-card animate-rise block w-full p-4 text-left";
  if (!onSelect) {
    return (
      <div className={cls} style={style}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`${cls} disabled:cursor-default ${selected ? "bg-panel-2" : ""}`}
      style={style}
    >
      {body}
    </button>
  );
}
