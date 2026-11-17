"use client";

// Loaded on demand (see HowToPlay.tsx), like the confirm dialog.
import {
  Root as DialogRoot,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@animate-ui/react/primitives/radix-ui/dialog";
import { ExternalLink, Gamepad2, Keyboard, Smartphone, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CATALOG_BY_ID } from "@/games/catalog";
import { RULES, type GameRules } from "@/games/rules";
import { canPlayLocal, hasBots } from "@/lib/local-games";
import { GameBadge } from "../GameBadge";

export default function RulesDialog({
  open,
  onOpenChange,
  gameId,
  note,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gameId: string;
  note?: string;
}) {
  const meta = CATALOG_BY_ID[gameId];
  const [loaded, setLoaded] = useState<{ id: string; rules: GameRules | null } | null>(null);

  useEffect(() => {
    if (!open || loaded?.id === gameId) return;
    let live = true;
    const load = RULES[gameId];
    (load ? load().then((m) => m.rules) : Promise.resolve(null))
      .catch(() => null)
      .then((rules) => live && setLoaded({ id: gameId, rules }));
    return () => {
      live = false;
    };
  }, [open, gameId, loaded?.id]);

  const rules = loaded?.id === gameId ? loaded.rules : undefined;
  const accent = meta?.accent ?? "#c6f432";

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-40 bg-ink/70 backdrop-blur-sm" />
        <DialogContent
          from="bottom"
          className="glass lit-edge fixed top-1/2 left-1/2 z-50 flex max-h-[88dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden"
        >
          <div className="flex items-center gap-3 border-b border-line p-5 pb-4">
            {meta && <GameBadge id={meta.id} accent={accent} size="md" />}
            <div className="min-w-0 flex-1">
              <p className="label">How to play</p>
              <DialogTitle className="truncate font-hero text-xl font-extrabold tracking-[-0.03em]">
                {meta?.name ?? "This game"}
              </DialogTitle>
            </div>
            <DialogClose className="btn shrink-0 p-2" aria-label="Close">
              <X aria-hidden className="size-4" strokeWidth={2} />
            </DialogClose>
          </div>

          <div className="overflow-y-auto overscroll-contain p-5 pt-4">
            {note && (
              <p className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-ink/50 px-3 py-2 text-xs text-muted">
                <span aria-hidden>⏸️</span> {note}
              </p>
            )}
            {meta && (
              <p className="font-mono text-[11px] text-muted">
                {meta.minPlayers === meta.maxPlayers ? meta.minPlayers : `${meta.minPlayers}–${meta.maxPlayers}`} players ·
                about {meta.minutes} min
              </p>
            )}

            {rules === undefined ? (
              <p className="py-10 text-center font-mono text-xs text-muted">Loading rules…</p>
            ) : rules === null ? (
              <>
                <DialogDescription className="sr-only">Short rules for {meta?.name}</DialogDescription>
                <Numbered items={meta?.how ?? []} accent={accent} className="mt-4" />
              </>
            ) : (
              <>
                <DialogDescription
                  className="mt-3 rounded-lg border px-4 py-3 text-sm font-semibold"
                  style={{ borderColor: accent + "55", background: accent + "14" }}
                >
                  <span className="label mb-0.5 block" style={{ color: accent }}>
                    Goal
                  </span>
                  {rules.goal}
                </DialogDescription>

                <Section title="How a game goes">
                  <Numbered items={rules.flow} accent={accent} />
                </Section>

                {(rules.controls.desktop?.length || rules.controls.touch?.length) && (
                  <Section title="Controls">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {rules.controls.desktop?.length ? (
                        <Controls Icon={Keyboard} label="Keyboard & mouse" items={rules.controls.desktop} />
                      ) : null}
                      {rules.controls.touch?.length ? (
                        <Controls Icon={Smartphone} label="Phone & tablet" items={rules.controls.touch} />
                      ) : null}
                    </div>
                  </Section>
                )}

                <Section title="Scoring & winning">
                  <Bullets items={rules.scoring} accent={accent} />
                </Section>

                {rules.tips?.length ? (
                  <Section title="Tips">
                    <Bullets items={rules.tips} accent={accent} />
                  </Section>
                ) : null}
              </>
            )}
            <TrySolo gameId={gameId} accent={accent} />
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}

/**
 * "Try it solo": practise this game alone or against bots. In a room it opens a new tab so
 * you don't leave your friends; it's hidden where you're already playing locally.
 */
function TrySolo({ gameId, accent }: { gameId: string; accent: string }) {
  const path = usePathname() ?? "";
  if (!canPlayLocal(gameId) || path.startsWith("/play/") || path.startsWith("/daily")) return null;
  const inRoom = path.startsWith("/r/") || path.startsWith("/room");
  const bots = hasBots(gameId) && (CATALOG_BY_ID[gameId]?.maxPlayers ?? 1) > 1;
  return (
    <div
      className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3"
      style={{ borderColor: accent + "44", background: accent + "0d" }}
    >
      <Gamepad2 aria-hidden className="size-5 shrink-0" style={{ color: accent }} strokeWidth={1.75} />
      <p className="min-w-0 flex-1 text-sm text-muted">
        {bots ? "Practise against bots first, no room needed." : "Have a go on your own, no room needed."}
      </p>
      <Link
        href={`/play/${gameId}`}
        className="btn px-3 py-1.5 text-sm"
        {...(inRoom ? { target: "_blank", rel: "noopener" } : {})}
      >
        Try it solo
        {inRoom && <ExternalLink aria-hidden className="size-3.5" strokeWidth={2} />}
        {inRoom && <span className="sr-only">(opens in a new tab)</span>}
      </Link>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="label mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Numbered({ items, accent, className = "" }: { items: string[]; accent: string; className?: string }) {
  return (
    <ol className={`space-y-2 text-sm text-text/90 ${className}`}>
      {items.map((line, i) => (
        <li key={i} className="flex gap-3">
          <span className="pt-px font-mono text-xs font-medium" style={{ color: accent }}>
            {String(i + 1).padStart(2, "0")}
          </span>
          <span>{line}</span>
        </li>
      ))}
    </ol>
  );
}

function Bullets({ items, accent }: { items: string[]; accent: string }) {
  return (
    <ul className="space-y-1.5 text-sm text-text/90">
      {items.map((line, i) => (
        <li key={i} className="flex gap-2.5">
          <span aria-hidden className="mt-[0.45em] size-1.5 shrink-0 rounded-full" style={{ background: accent }} />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

function Controls({ Icon, label, items }: { Icon: typeof Keyboard; label: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-line bg-ink/40 p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted">
        <Icon aria-hidden className="size-3.5" strokeWidth={2} /> {label}
      </p>
      <ul className="space-y-1 text-sm text-text/90">
        {items.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
