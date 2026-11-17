import Link from "next/link";

/** The Ruckus mark: a chamfered volt tile with a cut "R", plus the wide wordmark. */
export function LogoMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden focusable={false}>
      <defs>
        <linearGradient id="rk-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dcff6a" />
          <stop offset="1" stopColor="#b5e81c" />
        </linearGradient>
      </defs>
      {/* Tile with the top-right corner cut off. */}
      <path d="M6 2h22l10 10v22a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" fill="url(#rk-tile)" />
      <path d="M29 2.5 37.5 11H31a2 2 0 0 1-2-2z" fill="#05060a" fillOpacity="0.28" />
      {/* Geometric R with a detached leg: reads as R and as a little burst of motion. */}
      <path
        d="M12 30V10h9.5a6 6 0 0 1 0 12H12M20 22l7 8"
        fill="none"
        stroke="#05060a"
        strokeWidth="4.2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-2.5" aria-label="Ruckus home">
      <span className="transition-transform duration-500 ease-[cubic-bezier(0.34,1.4,0.5,1)] group-hover:-rotate-[8deg] group-hover:scale-105">
        <LogoMark className={small ? "size-8" : "size-9"} />
      </span>
      <span className={`font-hero font-extrabold tracking-[-0.02em] lowercase ${small ? "hidden text-base min-[420px]:inline" : "text-xl"}`}>
        ruckus
      </span>
    </Link>
  );
}
