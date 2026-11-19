"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useState } from "react";
import { inviteUrl, shareInvite, whatsappInvite } from "@/lib/invite";
import { Rux } from "../Rux";

/** Big invite prompt in the lobby while there are fewer than 3 people: the room only gets fun with friends. */
export function InviteCard({ code, gameId, name, humans, isHost }: { code: string; gameId: string; name?: string; humans: number; isHost: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = () => inviteUrl(window.location.origin, code, gameId, name);
  const flash = () => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const share = async () => {
    if ((await shareInvite(url())) === "copied") flash();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url());
      flash();
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="animate-rise card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span aria-hidden className="bob w-12 shrink-0" style={{ "--tilt": "-8deg" } as React.CSSProperties}>
          <Rux mood="wow" className="w-full" />
        </span>
        <div className="min-w-0">
          <p className="marker text-xl leading-tight">{humans < 2 ? "akele akele? 👀" : "ek aur bulao, maza double"}</p>
          <p className="text-sm text-muted">
            Send the link: friends join in one tap, no app or sign-up.
            {isHost && humans < 2 ? " Or add a practice bot in the players panel." : ""}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={share} className="btn btn-primary min-h-11 flex-1 px-4 font-bold sm:flex-none">
          {copied ? <Check aria-hidden className="size-4" strokeWidth={2.5} /> : <Share2 aria-hidden className="size-4" strokeWidth={2.25} />}
          {copied ? "Link copied!" : "Invite friends"}
        </button>
        <button
          type="button"
          onClick={() => window.open(whatsappInvite(url()), "_blank", "noopener,noreferrer")}
          aria-label="Invite on WhatsApp"
          title="Invite on WhatsApp"
          className="btn min-h-11 px-3"
          style={{ borderColor: "#25d36688", color: "#25d366" }}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="currentColor">
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15a8.2 8.2 0 0 1-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24s8.24 3.7 8.24 8.24-3.7 8.24-8.24 8.24Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.24-.64.8-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy invite link"
          title="Copy invite link"
          className="btn min-h-11 px-3 pointer-coarse:hidden"
        >
          <Copy aria-hidden className="size-4" strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
