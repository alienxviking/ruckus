"use client";

// Loaded on demand (see Room.tsx): Animate UI's animated Radix dialog brings the full
// motion runtime, which the rest of the room page doesn't need up front.
import {
  Root as DialogRoot,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@animate-ui/react/primitives/radix-ui/dialog";
import { X } from "lucide-react";
import { ProfileForm, type ProfileValues } from "./ProfileForm";

export default function ProfileDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ProfileValues;
  onSave: (v: ProfileValues) => void;
}) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-40 bg-ink/70 backdrop-blur-sm" />
        <DialogContent
          from="top"
          className="glass lit-edge fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-5"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="label">Profile</p>
              <DialogTitle className="mt-1 font-hero text-xl font-extrabold tracking-[-0.03em]">Your look</DialogTitle>
              <DialogDescription className="sr-only">Change your name, avatar and colour.</DialogDescription>
            </div>
            <DialogClose className="btn px-2 py-1.5" aria-label="Close">
              <X aria-hidden className="size-4" strokeWidth={2} />
            </DialogClose>
          </div>
          <ProfileForm initial={initial} submitLabel="Save" onSubmit={onSave} recoveryTip />
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
