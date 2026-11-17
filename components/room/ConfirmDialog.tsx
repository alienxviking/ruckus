"use client";

// Loaded on demand (see GameStage.tsx), like the profile dialog.
import {
  Root as DialogRoot,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@animate-ui/react/primitives/radix-ui/dialog";

export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-40 bg-ink/70 backdrop-blur-sm" />
        <DialogContent
          from="top"
          className="glass lit-edge fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 p-5"
        >
          <p className="label">Heads up</p>
          <DialogTitle className="mt-1 font-hero text-xl font-extrabold tracking-[-0.03em]">{title}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted">{description}</DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <DialogClose className="btn">Keep playing</DialogClose>
            <button
              className="btn btn-primary"
              autoFocus
              onClick={() => {
                onOpenChange(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
