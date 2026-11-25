"use client";

import { Camera } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { CATALOG_BY_ID } from "@/games/catalog";
import type { CardPlayer } from "@/lib/result-card";

// The preview dialog (shared with the daily card) and the card renderer load on first use.
const loadSharePreview = () => import("../daily/SharePreview");
const SharePreview = dynamic(loadSharePreview, { ssr: false });

/** "Share result": the podium as a story picture, previewed before it goes anywhere. */
export function ShareResult({ gameId, players, me, allWon, gameKey }: { gameId: string; players: CardPlayer[]; me: string; allWon: boolean; gameKey: string }) {
  const [making, setMaking] = useState(false);
  const [card, setCard] = useState<File | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const make = async () => {
    if (card) return setOpen(true);
    setMaking(true);
    const meta = CATALOG_BY_ID[gameId];
    const winner = players.find((p) => p.won);
    setText(`${winner ? `${winner.id === me ? "I" : winner.name} won` : "We played"} ${meta?.name ?? "a game"} on Ruckus 🎮 ${window.location.origin}/games/${gameId}`);
    try {
      const { renderResultCard } = await import("@/lib/result-card");
      const css = getComputedStyle(document.documentElement);
      const font = (v: string, fallback: string) => css.getPropertyValue(v).trim() || fallback;
      const blob = await renderResultCard(
        { gameId, players, me, allWon },
        { hero: font("--font-hero-face", "sans-serif"), marker: font("--font-marker-face", "cursive"), sans: font("--font-geist-sans", "sans-serif") },
      );
      if (!blob) return;
      setCard(new File([blob], `ruckus-${gameId}-${gameKey}.png`, { type: "image/png" }));
      setOpen(true);
    } finally {
      setMaking(false);
    }
  };

  return (
    <>
      <button type="button" className="btn min-h-11 px-4 text-sm font-bold" onClick={make} onPointerEnter={loadSharePreview} disabled={making}>
        <Camera aria-hidden className="size-4" strokeWidth={2.3} />
        {making ? "Making…" : "Share result"}
      </button>
      {card && <SharePreview open={open} onOpenChange={setOpen} file={card} text={text} />}
    </>
  );
}
