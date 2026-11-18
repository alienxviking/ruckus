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
import { ChevronDown, ExternalLink, Gamepad2, Keyboard, Smartphone, Trophy, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CATALOG_BY_ID } from "@/games/catalog";
import { RULES, type GameRules } from "@/games/rules";
import { RULE_ICONS } from "@/games/rule-icons";
import type { QuickCard } from "@/games/rules-types";
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
                <DialogDescription className="sr-only">{rules.goal}</DialogDescription>
                {rules.quick?.length ? (
                  <>
                    <QuickCards cards={rules.quick} accent={accent} />
                    {rules.win && (
                      <div
                        className="qc-in mt-3 flex items-center gap-2.5 rounded-xl border-2 px-3 py-2"
                        style={{ borderColor: accent + "66", background: accent + "14", animationDelay: "360ms" }}
                      >
                        <Trophy aria-hidden className="qc-bounce size-5 shrink-0" style={{ color: accent }} strokeWidth={2.25} />
                        <p className="text-sm font-bold">
                          <span className="sr-only">To win: </span>
                          {rules.win}
                        </p>
                      </div>
                    )}
                    <QuickControls controls={rules.controls} />
                    <details className="group mt-4 rounded-xl border border-line">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-bold text-muted hover:text-text [&::-webkit-details-marker]:hidden">
                        All the details
                        <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" strokeWidth={2.25} />
                      </summary>
                      <div className="border-t border-line px-3 pb-4">
                        <FullRules rules={rules} accent={accent} />
                      </div>
                    </details>
                  </>
                ) : (
                  <FullRules rules={rules} accent={accent} />
                )}
              </>
            )}
            <TrySolo gameId={gameId} accent={accent} />
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}

const QC_STYLES = `
@keyframes qc-in { from { opacity: 0; transform: translateY(8px) scale(.96); } }
.qc-in { animation: qc-in .4s cubic-bezier(.2,.9,.25,1.2) both; }
@keyframes qc-tap { 0%, 60%, 100% { transform: scale(1); } 30% { transform: scale(.82) translateY(2px); } }
@keyframes qc-ring { 0%, 25% { opacity: 0; transform: scale(.6); } 35% { opacity: .9; } 70%, 100% { opacity: 0; transform: scale(1.5); } }
@keyframes qc-wiggle { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-12deg); } 75% { transform: rotate(12deg); } }
@keyframes qc-bounce { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-6px); } 60% { transform: translateY(0) scale(1.06, .94); } }
@keyframes qc-spin { 0% { transform: rotate(0); } 60%, 100% { transform: rotate(360deg); } }
@keyframes qc-float { 0%, 100% { transform: translateY(2px); } 50% { transform: translateY(-4px); } }
@keyframes qc-pulse { 0%, 100% { transform: scale(1); } 15% { transform: scale(1.18); } 30% { transform: scale(1); } 45% { transform: scale(1.12); } }
@keyframes qc-slide { 0%, 100% { transform: translateX(-5px); } 50% { transform: translateX(5px); } }
.qc-anim-tap { animation: qc-tap 1.6s ease-in-out infinite; }
.qc-anim-wiggle { animation: qc-wiggle 1.2s ease-in-out infinite; }
.qc-anim-bounce, .qc-bounce { animation: qc-bounce 1.3s ease-in-out infinite; }
.qc-anim-spin { animation: qc-spin 2.2s cubic-bezier(.5,0,.3,1) infinite; }
.qc-anim-float { animation: qc-float 2.4s ease-in-out infinite; }
.qc-anim-pulse { animation: qc-pulse 1.5s ease-in-out infinite; }
.qc-anim-slide { animation: qc-slide 1.6s ease-in-out infinite; }
.qc-ring { animation: qc-ring 1.6s ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .qc-in, .qc-ring, [class*="qc-anim-"], .qc-bounce { animation: none; } }
`;

/** The three picture cards: what you do, in order, each with a little looping animation. */
function QuickCards({ cards, accent }: { cards: QuickCard[]; accent: string }) {
  return (
    <>
      <style>{QC_STYLES}</style>
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
        {cards.map((c, i) => {
          const Icon = RULE_ICONS[c.icon] ?? RULE_ICONS.sparkles;
          return (
            <li
              key={i}
              className="qc-in flex items-center gap-3 rounded-xl border-2 border-line bg-panel-2/60 p-2.5 sm:flex-col sm:p-3 sm:text-center"
              style={{ animationDelay: `${i * 120}ms` }}
            >
              <span
                aria-hidden
                className="relative grid size-12 shrink-0 place-items-center rounded-xl border-2 border-ink text-ink shadow-[2px_3px_0_rgb(0_0_0/0.5)] sm:size-14"
                style={{ background: accent, transform: `rotate(${[-5, 4, -3][i]}deg)` }}
              >
                {c.anim === "tap" && <span className="qc-ring absolute inset-0 rounded-xl border-2" style={{ borderColor: accent }} />}
                <Icon className={`qc-anim-${c.anim} size-6 sm:size-7`} strokeWidth={2.25} style={{ animationDelay: `${i * 250}ms` }} />
              </span>
              <span className="flex min-w-0 items-baseline gap-1.5 text-sm leading-snug font-semibold sm:flex-col sm:items-center sm:gap-0.5">
                <span className="font-mono text-[11px] font-bold" style={{ color: accent }}>
                  {i + 1}
                </span>
                {c.text}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** Controls in one line: touch on phones, keyboard on computers. */
function QuickControls({ controls }: { controls: GameRules["controls"] }) {
  const touch = controls.touch?.[0];
  const desk = controls.desktop?.[0];
  if (!touch && !desk) return null;
  return (
    <div className="mt-3 text-xs text-muted">
      {touch && (
        <p className={`flex items-start gap-1.5 ${desk ? "pointer-fine:hidden" : ""}`}>
          <Smartphone aria-hidden className="mt-px size-3.5 shrink-0" strokeWidth={2} /> {touch}
        </p>
      )}
      {desk && (
        <p className={`items-start gap-1.5 ${touch ? "hidden pointer-fine:flex" : "flex"}`}>
          <Keyboard aria-hidden className="mt-px size-3.5 shrink-0" strokeWidth={2} /> {desk}
        </p>
      )}
    </div>
  );
}

/** The full written rules (under "All the details" when there are quick cards). */
function FullRules({ rules, accent }: { rules: GameRules; accent: string }) {
  return (
    <>
      <div className="mt-3 rounded-lg border px-4 py-3 text-sm font-semibold" style={{ borderColor: accent + "55", background: accent + "14" }}>
        <span className="label mb-0.5 block" style={{ color: accent }}>
          Goal
        </span>
        {rules.goal}
      </div>

      <Section title="How a game goes">
        <Numbered items={rules.flow} accent={accent} />
      </Section>

      {(rules.controls.desktop?.length || rules.controls.touch?.length) && (
        <Section title="Controls">
          <div className="grid gap-3 sm:grid-cols-2">
            {rules.controls.desktop?.length ? <Controls Icon={Keyboard} label="Keyboard & mouse" items={rules.controls.desktop} /> : null}
            {rules.controls.touch?.length ? <Controls Icon={Smartphone} label="Phone & tablet" items={rules.controls.touch} /> : null}
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
