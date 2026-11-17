import { memo } from "react";
import { avatarMarkup, AVATAR_LABEL } from "@/lib/avatar-art";
import { isAvatarId } from "@/shared/types";

/**
 * A player's avatar, sized like an emoji in the surrounding text (1.25em), so it drops into
 * any spot an emoji used to. Anything that isn't an avatar id (a fallback like "🙂" or "💀")
 * renders as plain text.
 */
export const Avatar = memo(function Avatar({
  id,
  className,
  size = "1.25em",
  title,
}: {
  id: string | undefined;
  className?: string;
  size?: string | number;
  /** Accessible name; avatars are decorative (aria-hidden) unless given one. */
  title?: string;
}) {
  if (!isAvatarId(id)) return <>{id}</>;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`inline-block shrink-0 align-[-0.28em] ${className ?? ""}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      data-avatar={id}
      dangerouslySetInnerHTML={{ __html: avatarMarkup(id) }}
    />
  );
});

export { AVATAR_LABEL };

/** An avatar placed inside an SVG scene, centred on (x, y), `size` user units across. */
export function SvgAvatar({
  id,
  x,
  y,
  size,
  opacity,
  className,
}: {
  id: string | undefined;
  x: number;
  y: number;
  size: number;
  opacity?: number;
  className?: string;
}) {
  if (!isAvatarId(id)) {
    return (
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.8} opacity={opacity} className={className}>
        {id}
      </text>
    );
  }
  return (
    <svg
      x={x - size / 2}
      y={y - size / 2}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      opacity={opacity}
      className={className}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: avatarMarkup(id) }}
    />
  );
}
