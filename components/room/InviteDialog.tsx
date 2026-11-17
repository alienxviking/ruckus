"use client";

// Loaded on demand (see InviteButton.tsx): the QR encoder and the animated dialog.
import {
  Root as DialogRoot,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@animate-ui/react/primitives/radix-ui/dialog";
import { Check, Copy, X } from "lucide-react";
import { useMemo, useState } from "react";
import { encode } from "uqr";

/** The QR as one SVG path (one square per dark module), so it stays crisp at any size. */
function QrSvg({ text }: { text: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(text, { ecc: "M", border: 2 });
    let d = "";
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, size: qr.size };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="block size-full" shapeRendering="crispEdges" role="img" aria-label="QR code for the room link">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#0b0a12" />
    </svg>
  );
}

export default function InviteDialog({
  open,
  onOpenChange,
  code,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
}) {
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/r/${code}`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-40 bg-ink/70 backdrop-blur-sm" />
        <DialogContent
          from="top"
          className="glass lit-edge fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-5"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="label">Invite</p>
              <DialogTitle className="mt-1 font-hero text-xl font-extrabold tracking-[-0.03em]">Scan to join</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-muted">
                Point a phone camera at the code, or send the link.
              </DialogDescription>
            </div>
            <DialogClose className="btn px-2 py-1.5" aria-label="Close">
              <X aria-hidden className="size-4" strokeWidth={2} />
            </DialogClose>
          </div>
          <div className="mx-auto aspect-square w-full max-w-64 overflow-hidden rounded-xl p-0 shadow-[0_0_0_1px_var(--color-line),0_20px_50px_-20px_var(--color-brand-2)]">
            {url && <QrSvg text={url} />}
          </div>
          <div className="mt-4 text-center">
            <div className="label">Room code</div>
            <div className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-brand-2">{code}</div>
          </div>
          <button className="btn mt-4 w-full" onClick={copy}>
            {copied ? (
              <Check aria-hidden className="animate-pop size-4 text-brand-2" strokeWidth={2.5} />
            ) : (
              <Copy aria-hidden className="size-4" strokeWidth={2} />
            )}
            <span className="truncate font-mono text-xs">{copied ? "Copied!" : url.replace(/^https?:\/\//, "")}</span>
          </button>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
