import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/** Small "← back" button for the solo/daily pages. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="btn px-3 py-1.5 text-sm">
      <ArrowLeft aria-hidden className="size-4" strokeWidth={2} />
      {children}
    </Link>
  );
}
