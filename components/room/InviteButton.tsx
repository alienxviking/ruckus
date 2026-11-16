"use client";

import { Check, Link2 } from "lucide-react";
import { useState } from "react";

export function InviteButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/r/${code}`;
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: "Join my Ruckus room", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* user cancelled share sheet or clipboard blocked */
    }
  }

  return (
    <button className="btn px-3 py-1.5" onClick={share} title="Copy invite link">
      <span className="font-mono font-bold tracking-[0.2em]">{code}</span>
      <span className={`flex items-center gap-1 text-xs ${copied ? "text-brand-2" : "text-muted"}`}>
        {copied ? (
          <Check aria-hidden className="animate-pop size-3.5" strokeWidth={2.5} />
        ) : (
          <Link2 aria-hidden className="size-3.5" strokeWidth={2} />
        )}
        {copied ? "Copied!" : "Invite"}
      </span>
    </button>
  );
}
