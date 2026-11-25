"use client";

import type { Player, RoomView } from "@/shared/types";
import { Avatar } from "../Avatar";
import { Confetti } from "../Confetti";
import { RateGame } from "../RateGame";
import { Rux } from "../Rux";
import { ShareResult } from "./ShareResult";

/** A cheeky one-liner from Rux, picked by how it went for you (stable per game). */
function quip(seed: number, kind: "won" | "lost" | "draw" | "watch", winner: string): string {
  const lines = {
    won: ["tu toh chha gaya! 🔥", "kya baat hai, champion! 👑", "full on bawaal! you won 🎉", "GG, ekdum legend 😎"],
    lost: [`${winner} ne sabko dho diya 💀`, `${winner} ka jalwa hai bhai`, "agli baar pakka, promise 🤞", `${winner} > everyone (for now)`],
    draw: ["barabar ka muqabla! 🤝", "tie! koi nahi jeeta, sab jeete 😅", "kya mast takkar thi!"],
    watch: [`${winner} wins! 🎉`, `${winner} ne game utha liya 🔥`, "what a game, yaar!"],
  }[kind];
  return lines[seed % lines.length];
}

/**
 * The end-of-game moment: Rux on his megaphone announcing the result, and a podium with the
 * top three as avatar stickers (1st in the middle, raised). The host's buttons go underneath.
 */
export function ResultPodium({
  room,
  byId,
  me,
  accent,
  children,
}: {
  room: RoomView;
  byId: Record<string, Player>;
  me: string;
  accent: string;
  children: React.ReactNode;
}) {
  const result = room.result!;
  const iWon = result.winners.includes(me);
  const played = room.participants.includes(me);
  const scores = result.scores ?? {};
  // Ranking: winners first, then by score.
  const ranked = [...room.participants]
    .filter((id) => byId[id])
    .sort((x, y) => Number(result.winners.includes(y)) - Number(result.winners.includes(x)) || (scores[y] ?? 0) - (scores[x] ?? 0));
  const top = ranked.slice(0, 3);
  // Podium order on screen: 2nd, 1st, 3rd.
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  const firstName = byId[result.winners[0]]?.name ?? "someone";
  const kind = result.winners.length === 0 || result.winners.length > 1 ? (result.winners.length > 1 && iWon ? "won" : "draw") : iWon ? "won" : played ? "lost" : "watch";
  const line = quip(room.gameSeq + result.headline.length, kind, firstName);
  const hasScores = Object.keys(scores).length > 0;
  // Places with ties: winners share 1st; others share a place when their scores match.
  const placeOf = (id: string) => {
    if (result.winners.includes(id)) return 0;
    const better = ranked.filter((o) => result.winners.includes(o) || (scores[o] ?? 0) > (scores[id] ?? 0)).length;
    return Math.min(2, better > 0 && result.winners.length ? Math.max(1, better) : better);
  };
  // Everyone won (co-op games): one shared row instead of a podium.
  const allWon = ranked.length > 1 && ranked.every((id) => result.winners.includes(id));

  return (
    <div
      role="status"
      className="stk result-banner relative overflow-hidden p-4 sm:p-5"
      style={
        {
          background: `radial-gradient(90% 140% at 50% 0%, ${accent}33, transparent 65%), var(--color-panel)`,
          boxShadow: `6px 7px 0 color-mix(in oklab, ${accent} 55%, #000)`,
        } as React.CSSProperties
      }
    >
      {result.winners.length > 0 && <Confetti pieces={iWon ? 44 : 24} />}
      <div className="grid items-end gap-4 md:grid-cols-[auto_1fr]">
        {/* Rux announcing. */}
        <div className="flex items-end gap-2 md:flex-col md:items-start">
          <span className="slap w-24 shrink-0 sm:w-28" style={{ "--tilt": "-6deg" } as React.CSSProperties}>
            <Rux mood={kind === "lost" ? "wow" : "shout"} megaphone className="w-full" />
          </span>
          <span
            className="slap marker mb-3 rounded-2xl border-[3px] border-ink bg-paper px-3 py-1.5 text-xl leading-tight text-ink shadow-[3px_4px_0_var(--color-pink)] sm:text-2xl"
            style={{ "--tilt": "-3deg", animationDelay: "200ms" } as React.CSSProperties}
          >
            {line}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-center font-hero text-xl leading-tight font-extrabold tracking-[-0.02em] sm:text-2xl md:text-left">
            {result.headline}
          </p>
          {/* The podium. */}
          {allWon && (
            <div className="mt-4 flex flex-wrap items-end justify-center gap-3">
              {ranked.map((id, i) => {
                const p = byId[id];
                return (
                  <div key={id} className="slap flex flex-col items-center" style={{ "--tilt": `${i % 2 ? 4 : -4}deg`, animationDelay: `${200 + i * 90}ms` } as React.CSSProperties}>
                    <span
                      className="grid size-14 place-items-center rounded-2xl border-[3px] border-paper text-4xl shadow-[3px_4px_0_rgb(0_0_0/0.55)]"
                      style={{ background: `linear-gradient(180deg, ${p.color}55, ${p.color}22)` }}
                    >
                      <Avatar id={p.avatar} size="1em" />
                    </span>
                    <span className="mt-1 text-sm font-bold" style={{ color: p.color }}>
                      {id === me ? "You" : p.name}
                    </span>
                  </div>
                );
              })}
              <span className="marker w-full text-center text-xl text-brand-2">team win! sab jeete 🎉</span>
            </div>
          )}
          {!allWon && order.length > 0 && (
            <div className="mt-4 flex items-end justify-center gap-2 sm:gap-3">
              {order.map((id) => {
                const place = placeOf(id);
                const p = byId[id];
                const won = result.winners.includes(id);
                const h = place === 0 ? "h-20 sm:h-24" : place === 1 ? "h-14 sm:h-16" : "h-10 sm:h-12";
                return (
                  <div
                    key={id}
                    className="slap flex w-24 flex-col items-center sm:w-28"
                    style={{ "--tilt": place === 0 ? "0deg" : place === 1 ? "-3deg" : "3deg", animationDelay: `${300 + (2 - place) * 140}ms` } as React.CSSProperties}
                  >
                    {won && place === 0 && (
                      <span aria-hidden className="text-2xl leading-none">
                        👑
                      </span>
                    )}
                    <span
                      className={`grid place-items-center rounded-2xl border-[3px] border-paper shadow-[3px_4px_0_rgb(0_0_0/0.55)] ${place === 0 ? "size-16 text-4xl sm:size-20 sm:text-5xl" : "size-12 text-3xl sm:size-14 sm:text-4xl"}`}
                      style={{ background: `linear-gradient(180deg, ${p.color}55, ${p.color}22)` }}
                    >
                      <Avatar id={p.avatar} size="1em" />
                    </span>
                    <span className={`mt-1 max-w-full truncate text-sm font-bold ${id === me ? "text-brand-2" : ""}`} style={id === me ? undefined : { color: p.color }}>
                      {id === me ? "You" : p.name}
                    </span>
                    {hasScores && <span className="font-mono text-xs text-muted">{(scores[id] ?? 0).toLocaleString("en-US")}</span>}
                    <span
                      className={`mt-1 grid w-full place-items-center rounded-t-lg border-2 border-b-0 border-ink font-hero text-xl font-extrabold text-ink ${h}`}
                      style={{ background: place === 0 ? "var(--color-sun)" : place === 1 ? "#d7dbe6" : "#e0a26b" }}
                    >
                      {place + 1}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 md:justify-start">
            {played && <RateGame gameId={room.gameId} gameKey={`${room.code}-${room.gameSeq}`} />}
            <ShareResult
              gameId={room.gameId}
              me={me}
              allWon={allWon}
              gameKey={String(room.gameSeq)}
              players={ranked.map((id) => ({ id, name: byId[id].name, color: byId[id].color, won: result.winners.includes(id), ...(hasScores ? { score: scores[id] ?? 0 } : {}) }))}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 md:justify-start">{children}</div>
        </div>
      </div>
    </div>
  );
}
