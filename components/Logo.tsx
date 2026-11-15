import Link from "next/link";

export function Logo({ small }: { small?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-2" aria-label="Ruckus home">
      <span
        aria-hidden
        className={`grid place-items-center rounded-xl bg-gradient-to-br from-brand to-brand-2 font-display font-black text-ink transition-transform group-hover:-rotate-6 ${
          small ? "size-8 text-lg" : "size-10 text-xl"
        }`}
      >
        R!
      </span>
      <span className={`font-display font-extrabold tracking-tight ${small ? "text-lg" : "text-2xl"}`}>
        ruckus
      </span>
    </Link>
  );
}
