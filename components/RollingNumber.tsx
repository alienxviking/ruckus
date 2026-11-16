import { memo } from "react";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * A number whose digits roll like an odometer when it changes. Pure CSS: each digit is
 * a 0–9 column moved with a transform transition, so updates cost no JS animation and
 * the first render never animates. Use inside a monospace / tabular-nums context.
 */
export const RollingNumber = memo(function RollingNumber({
  value,
  format = (n: number) => n.toLocaleString(),
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const text = format(value);
  const chars = [...text];
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex tabular-nums">
        {chars.map((c, i) => {
          // Key digits by their place from the right, so a new leading digit slots in
          // without the others re-mounting.
          const key = chars.length - i;
          if (c < "0" || c > "9") return <span key={`s${key}`}>{c}</span>;
          return (
            <span key={key} className="roll-digit">
              <span style={{ "--d": +c } as React.CSSProperties}>
                {DIGITS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
});
