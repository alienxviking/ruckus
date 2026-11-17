import Link from "next/link";
import { Rux } from "./Rux";

/** The Ruckus mark: Rux himself. */
export function LogoMark({ className = "size-9" }: { className?: string }) {
  return <Rux className={className} />;
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-1.5" aria-label="Ruckus home">
      <span className="transition-transform duration-500 ease-[cubic-bezier(0.34,1.4,0.5,1)] group-hover:-rotate-[10deg] group-hover:scale-110">
        <LogoMark className={small ? "h-9 w-8" : "h-11 w-10"} />
      </span>
      <span
        className={`font-hero leading-none font-extrabold tracking-[-0.03em] lowercase ${small ? "hidden text-xl min-[420px]:inline" : "text-2xl"}`}
      >
        ruckus
      </span>
    </Link>
  );
}
