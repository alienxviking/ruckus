"use client";

// Loaded on demand (see Recap.tsx).
import {
  Root as DialogRoot,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@animate-ui/react/primitives/radix-ui/dialog";
import { Download, Flame, Share2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { CATALOG_BY_ID } from "@/games/catalog";
import { buildRecap, type Recap } from "@/lib/recap";
import { avatarImage, preloadAvatars } from "@/lib/avatar-art";
import type { RoomView } from "@/shared/types";
import { Avatar } from "../Avatar";
import { GameBadge } from "../GameBadge";

export default function RecapDialog({
  open,
  onOpenChange,
  room,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  room: RoomView;
}) {
  const recap = useMemo(() => buildRecap(room.history, room.players), [room.history, room.players]);
  const [busy, setBusy] = useState(false);
  // Phones get the share sheet (straight into a chat or story); desktops just download it.
  const canShare =
    typeof navigator !== "undefined" && "canShare" in navigator && typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

  const exportImage = async () => {
    setBusy(true);
    try {
      const blob = await renderCard(recap);
      if (!blob) return;
      const file = new File([blob], "ruckus-recap.png", { type: "image/png" });
      if (canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Ruckus recap" }).catch(() => {});
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5_000);
      }
    } finally {
      setBusy(false);
    }
  };

  const maxWins = Math.max(1, ...recap.lines.map((l) => l.wins));

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-40 bg-ink/70 backdrop-blur-sm" />
        <DialogContent
          from="bottom"
          className="glass lit-edge fixed top-1/2 left-1/2 z-50 flex max-h-[88dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden"
        >
          <div className="flex items-center gap-3 border-b border-line p-5 pb-4">
            <div className="min-w-0 flex-1">
              <p className="label">Tonight so far</p>
              <DialogTitle className="font-hero text-xl font-extrabold tracking-[-0.03em]">Recap</DialogTitle>
            </div>
            <DialogClose className="btn shrink-0 p-2" aria-label="Close">
              <X aria-hidden className="size-4" strokeWidth={2} />
            </DialogClose>
          </div>
          <div className="overflow-y-auto overscroll-contain p-5 pt-4">
            <DialogDescription className="font-mono text-xs text-muted">
              {recap.games} games · {recap.minutes} min · {recap.lines.length} players
            </DialogDescription>

            {recap.champions.length > 0 && (
              <div className="mt-4 rounded-xl border border-brand-2/40 bg-brand-2/10 p-4 text-center">
                <p className="label text-brand-2">{recap.champions.length > 1 ? "Joint champions" : "Champion of the night"}</p>
                <p className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-hero text-2xl font-extrabold">
                  {recap.champions.map((c) => (
                    <span key={c.id} className="flex items-center gap-2" style={{ color: c.color }}>
                      <Avatar id={c.avatar} size="2rem" /> {c.name}
                    </span>
                  ))}
                </p>
                <p className="mt-1 font-mono text-xs text-muted">
                  {recap.champions[0].wins} {recap.champions[0].wins === 1 ? "win" : "wins"}
                </p>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              {recap.streak && (
                <div className="rounded-lg border border-line bg-ink/40 p-3">
                  <p className="label flex items-center gap-1">
                    <Flame aria-hidden className="size-3" strokeWidth={2} /> Hot streak
                  </p>
                  <p className="mt-1 font-semibold">
                    <Avatar id={recap.streak.line.avatar} /> {recap.streak.line.name}
                  </p>
                  <p className="font-mono text-xs text-muted">{recap.streak.n} wins in a row</p>
                </div>
              )}
              {recap.favourite && CATALOG_BY_ID[recap.favourite.gameId] && (
                <div className="rounded-lg border border-line bg-ink/40 p-3">
                  <p className="label">Most played</p>
                  <p className="mt-1 truncate font-semibold">{CATALOG_BY_ID[recap.favourite.gameId].name}</p>
                  <p className="font-mono text-xs text-muted">{recap.favourite.n} times</p>
                </div>
              )}
            </div>

            <h3 className="label mt-5 mb-2">Standings</h3>
            <ol className="space-y-1.5">
              {recap.lines.map((l, i) => (
                <li key={l.id} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-muted">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 truncate font-semibold" style={{ color: l.color }}>
                      <Avatar id={l.avatar} /> {l.name}
                    </span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-panel-2">
                      <span className="block h-full rounded-full" style={{ width: `${(l.wins / maxWins) * 100}%`, background: l.color }} />
                    </span>
                  </span>
                  <span className="font-mono text-xs">
                    <b className="text-sm">{l.wins}</b>
                    <span className="text-muted">/{l.played}</span>
                  </span>
                </li>
              ))}
            </ol>

            <h3 className="label mt-5 mb-2">Games</h3>
            <ul className="space-y-1.5">
              {[...room.history].reverse().map((h) => {
                const g = CATALOG_BY_ID[h.gameId];
                return (
                  <li key={h.at} className="flex items-center gap-2.5 text-sm">
                    {g && <GameBadge id={g.id} accent={g.accent} size="xs" />}
                    <span className="min-w-0 flex-1 truncate text-muted">{h.headline}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex justify-end gap-2 border-t border-line p-4">
            <button className="btn btn-primary" disabled={busy} onPointerEnter={preloadAvatars} onClick={exportImage}>
              {canShare ? <Share2 aria-hidden className="size-4" strokeWidth={2} /> : <Download aria-hidden className="size-4" strokeWidth={2} />}
              {busy ? "Making image…" : canShare ? "Share image" : "Save image"}
            </button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}

/** A 1080×1350 card for sharing (stories / chats). */
async function renderCard(recap: Recap): Promise<Blob | null> {
  preloadAvatars();
  // Wait (briefly) for every avatar on the card, accessories included, to finish loading.
  const ids = [...recap.champions, ...recap.lines].map((l) => l.avatar);
  for (let i = 0; i < 20 && ids.some((id) => !avatarImage(id)); i++) await new Promise((r) => setTimeout(r, 50));
  await document.fonts?.ready;
  const W = 1080;
  const H = 1350;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return null;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0b0d16");
  bg.addColorStop(1, "#05060a");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W * 0.2, 0, 0, W * 0.2, 0, W);
  glow.addColorStop(0, "rgba(198,244,50,0.22)");
  glow.addColorStop(1, "rgba(198,244,50,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  const font = (w: number, px: number) => `${w} ${px}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
  g.fillStyle = "#c6f432";
  g.font = font(800, 44);
  g.fillText("RUCKUS", 80, 120);
  g.fillStyle = "#9aa0b4";
  g.font = font(500, 32);
  g.fillText(`Tonight · ${recap.games} games · ${recap.minutes} min`, 80, 175);

  let y = 290;
  if (recap.champions.length) {
    g.fillStyle = "#c6f432";
    g.font = font(700, 30);
    g.fillText(recap.champions.length > 1 ? "JOINT CHAMPIONS" : "CHAMPION OF THE NIGHT", 80, y);
    y += 30;
    for (const ch of recap.champions.slice(0, 2)) {
      y += 110;
      const img = avatarImage(ch.avatar);
      if (img) g.drawImage(img, 80, y - 90, 110, 110);
      g.fillStyle = ch.color;
      g.font = font(800, 84);
      g.fillText(ch.name, 215, y - 4, W - 300);
    }
    g.fillStyle = "#9aa0b4";
    g.font = font(500, 32);
    y += 60;
    g.fillText(`${recap.champions[0].wins} ${recap.champions[0].wins === 1 ? "win" : "wins"}`, 80, y);
  }

  y += 90;
  g.fillStyle = "#9aa0b4";
  g.font = font(700, 28);
  g.fillText("STANDINGS", 80, y);
  y += 20;
  const maxWins = Math.max(1, ...recap.lines.map((l) => l.wins));
  for (const [i, l] of recap.lines.slice(0, 8).entries()) {
    y += 82;
    if (y > H - 90) break;
    g.fillStyle = "#6b7085";
    g.font = font(600, 30);
    g.fillText(String(i + 1), 80, y);
    const img = avatarImage(l.avatar);
    if (img) g.drawImage(img, 130, y - 46, 60, 60);
    g.fillStyle = l.color;
    g.font = font(700, 40);
    g.fillText(l.name, 210, y, 520);
    g.fillStyle = "#e8eaf2";
    g.font = font(800, 40);
    g.textAlign = "right";
    g.fillText(`${l.wins}`, W - 80, y);
    g.textAlign = "left";
    g.fillStyle = "#1a1d2b";
    g.fillRect(210, y + 16, W - 290 - 210 + 100, 10);
    g.fillStyle = l.color;
    g.fillRect(210, y + 16, ((W - 290 - 210 + 100) * l.wins) / maxWins, 10);
  }
  g.fillStyle = "#6b7085";
  g.font = font(500, 28);
  g.fillText("ruckus-game.vercel.app", 80, H - 60);
  return new Promise((res) => c.toBlob(res, "image/png"));
}
