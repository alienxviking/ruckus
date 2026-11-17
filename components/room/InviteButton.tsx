"use client";

import { Check, Link2, QrCode } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

// The QR dialog (encoder + animated dialog) is fetched on first hover/focus of its button.
const loadInviteDialog = () => import("./InviteDialog");
const InviteDialog = dynamic(loadInviteDialog, { ssr: false });

export function InviteButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrMounted, setQrMounted] = useState(false);

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
    <div className="flex">
      <button className="btn rounded-r-none px-3 py-1.5" onClick={share} title="Copy invite link">
        <span className="font-mono font-bold tracking-[0.2em]">{code}</span>
        <span className={`flex items-center gap-1 text-xs ${copied ? "text-brand-2" : "text-muted"}`}>
          {copied ? (
            <Check aria-hidden className="animate-pop size-3.5" strokeWidth={2.5} />
          ) : (
            <Link2 aria-hidden className="size-3.5" strokeWidth={2} />
          )}
          <span className="hidden sm:inline">{copied ? "Copied!" : "Invite"}</span>
        </span>
      </button>
      <button
        className="btn -ml-px rounded-l-none px-2.5 py-1.5"
        aria-label="Show QR code"
        title="Show QR code"
        onPointerEnter={loadInviteDialog}
        onFocus={loadInviteDialog}
        onClick={() => {
          setQrMounted(true);
          setQrOpen(true);
        }}
      >
        <QrCode aria-hidden className="size-4" strokeWidth={2} />
      </button>
      {qrMounted && <InviteDialog open={qrOpen} onOpenChange={setQrOpen} code={code} />}
    </div>
  );
}
