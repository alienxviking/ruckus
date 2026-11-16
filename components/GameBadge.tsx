import { GameGlyph } from "./game-icons";

const SIZES = {
  xs: "size-7 rounded-md",
  sm: "size-9 rounded-lg",
  md: "size-11 rounded-lg",
  lg: "size-14 rounded-xl",
  xl: "size-[4.5rem] rounded-2xl",
} as const;

/**
 * A game's logo: its glyph in an accent-tinted badge with a gradient hairline, inner
 * glow and scan lines. The sheen sweeps across when a parent `.badge-trigger` is
 * hovered, or when `active` / `sheen` is set. Purely decorative (aria-hidden).
 */
export function GameBadge({
  id,
  accent,
  size = "md",
  active,
  sheen,
  className = "",
  style,
}: {
  id: string;
  accent: string;
  size?: keyof typeof SIZES;
  active?: boolean;
  sheen?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={`game-badge ${SIZES[size]} ${className}`}
      data-active={active || undefined}
      data-sheen={sheen || undefined}
      style={{ "--accent": accent, ...style } as React.CSSProperties}
    >
      <GameGlyph id={id} className="glyph" />
    </span>
  );
}
