"use client";

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
      <span className="text-xs text-muted">{copied ? "Copied!" : "Invite"}</span>
    </button>
  );
}
