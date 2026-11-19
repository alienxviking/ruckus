"use client";

// Loaded on demand from the daily page: shows the story picture before it goes anywhere.
import { Check, Copy, Download, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Root as DialogRoot,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@animate-ui/react/primitives/radix-ui/dialog";
import { feedback } from "@/lib/feedback";

export default function SharePreview({
  open,
  onOpenChange,
  file,
  text,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
  text: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    queueMicrotask(() => setUrl(u));
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const phone = typeof window !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const canShare = !!file && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });
  const canCopy = typeof window !== "undefined" && "ClipboardItem" in window;

  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], text });
      feedback("pop");
    } catch {
      /* cancelled */
    }
  };
  const save = () => {
    if (!url || !file) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    feedback("pop");
  };
  const copy = async () => {
    if (!file) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ [file.type]: file })]);
      setCopied(true);
      feedback("pop");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* not allowed */
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-40 bg-ink/80 backdrop-blur-sm" />
        <DialogContent
          from="bottom"
          className="glass lit-edge fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="font-hero text-lg font-extrabold tracking-tight">Your story card</DialogTitle>
            <DialogClose className="grid size-9 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-text" aria-label="Close">
              <X aria-hidden className="size-4" strokeWidth={2.25} />
            </DialogClose>
          </div>
          <DialogDescription className="sr-only">A preview of the picture of today&apos;s daily results.</DialogDescription>
          <div className="mt-3 flex min-h-0 flex-1 justify-center">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local blob preview
              <img
                src={url}
                alt="Your daily challenge story card"
                className="aspect-[9/16] max-h-[62dvh] w-auto rounded-xl border border-line object-contain shadow-[4px_6px_0_rgb(0_0_0/0.5)]"
              />
            ) : (
              <div className="aspect-[9/16] h-[62dvh] max-h-[62dvh] animate-pulse rounded-xl bg-panel-2" />
            )}
          </div>
          <div className="mt-4 flex gap-2">
            {canShare && phone ? (
              <>
                <button className="btn btn-primary min-h-11 flex-1 justify-center font-bold" onClick={share} autoFocus>
                  <Share2 aria-hidden className="size-4" strokeWidth={2.25} /> Share
                </button>
                <button className="btn min-h-11 px-4" onClick={save}>
                  <Download aria-hidden className="size-4" strokeWidth={2.25} /> Save
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary min-h-11 flex-1 justify-center font-bold" onClick={save} autoFocus>
                  <Download aria-hidden className="size-4" strokeWidth={2.25} /> Download
                </button>
                {canCopy && (
                  <button className="btn min-h-11 px-4" onClick={copy}>
                    {copied ? <Check aria-hidden className="size-4" strokeWidth={2.5} /> : <Copy aria-hidden className="size-4" strokeWidth={2.25} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
