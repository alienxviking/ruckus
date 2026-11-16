// CSS-only confetti burst: ~30 pieces animated with transform/opacity, no JS loop.
// Positions come from the index (not Math.random) so renders stay pure.

const COLORS = ["#c6f432", "#4ce0ff", "#ffffff", "#ff4769", "#a78bfa", "#facc15", "#34d399"];

export function Confetti({ pieces = 30 }: { pieces?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0 overflow-visible motion-reduce:hidden">
      {Array.from({ length: pieces }, (_, i) => {
        const r = (n: number) => ((i * 9301 + n * 49297) % 233280) / 233280; // cheap deterministic noise
        return (
          <span
            key={i}
            className="confetti-piece absolute top-0 block rounded-[1px]"
            style={
              {
                left: `${4 + r(1) * 92}%`,
                width: 6 + r(2) * 6,
                height: 10 + r(3) * 8,
                background: COLORS[i % COLORS.length],
                "--drift": `${(r(4) - 0.5) * 160}px`,
                "--spin": `${360 + r(5) * 540}deg`,
                animationDuration: `${1.6 + r(6) * 1.4}s`,
                animationDelay: `${r(7) * 0.5}s`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
