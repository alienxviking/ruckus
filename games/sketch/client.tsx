"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { Note } from "@/components/game-ui";
import type { SketchAction, SketchView } from "./server";
import { SketchCanvas, StrokeStore, isTypingTarget, useStrokeSync } from "./canvas";
import { CanvasOverlay, Feed, Final, GotItNote, GuessBox, Header, Scores, TurnResults } from "./panels";

// Game-local animations (prefixed so they can't clash with the app or other games).
const CSS = `
@keyframes sk-float { 0% { opacity: 0; transform: translateY(12px) scale(.8) } 14% { opacity: 1; transform: none } 78% { opacity: 1; transform: none } 100% { opacity: 0; transform: translateY(-16px) } }
.sk-float { animation: sk-float 2.2s ease-out forwards }
@keyframes sk-toast { 0% { opacity: 0; transform: translateY(-8px) } 12% { opacity: 1; transform: none } 80% { opacity: 1; transform: none } 100% { opacity: 0 } }
.sk-toast { animation: sk-toast 2s ease-out forwards }
@keyframes sk-fade { 0% { opacity: 0 } 12% { opacity: 1 } 80% { opacity: 1 } 100% { opacity: 0 } }
@keyframes sk-burst { 0% { opacity: 1; transform: translate(-50%, -50%) scale(.3) } 100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1.15) } }
.sk-burst { animation: sk-burst 1.1s cubic-bezier(.2, .8, .3, 1) both }
@keyframes sk-wiggle { 0%, 100% { transform: rotate(-12deg) } 50% { transform: rotate(12deg) translateY(-3px) } }
.sk-wiggle { display: inline-block; animation: sk-wiggle 1.1s ease-in-out infinite }
@keyframes sk-flip { from { opacity: 0; transform: translateY(8px) rotateX(80deg) } to { opacity: 1; transform: none } }
.sk-flip { display: inline-block; animation: sk-flip .45s cubic-bezier(.2, 1.3, .4, 1) both }
@keyframes sk-crown { from { opacity: 0; transform: translateY(6px) rotate(-30deg) scale(.3) } }
.sk-crown { display: inline-block; animation: sk-crown .6s cubic-bezier(.2, 1.5, .4, 1) .45s both }
/* New turn: the cover irises in over the fresh canvas (clip-path: paint only, no layout). */
@keyframes sk-iris { from { clip-path: circle(0% at 50% 50%) } to { clip-path: circle(75% at 50% 50%) } }
.sk-iris { animation: sk-iris .38s cubic-bezier(.65, 0, .35, 1) both }
@keyframes sk-urgent { 50% { opacity: .5 } }
.sk-urgent { animation: sk-urgent .9s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) {
  .sk-float, .sk-toast { animation-name: sk-fade }
  .sk-burst { display: none }
  .sk-wiggle, .sk-flip, .sk-urgent, .sk-crown, .sk-iris { animation: none }
}
`;

/** Keys 1-3 pick a word while choosing. */
function usePickKeys(view: SketchView | null, act: (a: SketchAction) => void) {
  const count = view && view.phase === "choose" && view.options ? view.options.length : 0;
  useEffect(() => {
    if (!count) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || isTypingTarget(e.target)) return;
      const i = "123".indexOf(e.key);
      if (i < 0 || i >= count) return;
      e.preventDefault();
      act({ type: "choose", index: i });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, act]);
}

export default function SketchStorm({
  view,
  me,
  byId,
  isPlayer,
  act,
  serverNow,
  onEvent,
  accent,
}: GameClientProps<SketchView, SketchAction>) {
  const [store] = useState(() => new StrokeStore());
  useStrokeSync(store, view, true, act, onEvent);
  usePickKeys(view, act);
  const vars = { "--sk-accent": accent } as CSSProperties;

  if (!view) {
    return (
      <div className="card grid min-h-60 place-items-center p-6 text-muted" style={vars}>
        Setting up the easel…
      </div>
    );
  }

  const artist = byId[view.artist];
  const canDraw = view.role === "artist" && view.phase === "draw";
  const label = canDraw
    ? "Your canvas: draw with a mouse, finger or pen"
    : `${artist?.name ?? "The artist"}’s drawing`;

  return (
    <div className="@container w-full" style={vars}>
      <style>{CSS}</style>
      {view.phase === "final" ? (
        <Final view={view} byId={byId} me={me} store={store} />
      ) : (
        <div className="flex flex-col gap-3">
          <Header view={view} byId={byId} serverNow={serverNow} accent={accent} />
          <div className="grid items-start gap-3 @3xl:grid-cols-[minmax(0,1fr)_16rem]">
            <div className="flex min-w-0 flex-col gap-3">
              <SketchCanvas
                store={store}
                canDraw={canDraw}
                act={act}
                label={label}
                overlay={<CanvasOverlay view={view} byId={byId} me={me} act={act} serverNow={serverNow} />}
              />
              {view.phase === "draw" &&
                view.role === "guesser" &&
                (view.guessed ? <GotItNote word={view.word} /> : <GuessBox act={act} onEvent={onEvent} />)}
              {view.phase === "reveal" && <TurnResults view={view} byId={byId} serverNow={serverNow} />}
              {!isPlayer && <Note>👀 You’re watching. Only players in this game can guess.</Note>}
            </div>
            <aside className="flex min-w-0 flex-col gap-3">
              <Feed feed={view.feed} byId={byId} me={me} className="order-1 @3xl:order-2" />
              <Scores view={view} byId={byId} me={me} className="order-2 @3xl:order-1" />
            </aside>
          </div>
        </div>
      )}
      {/* Keeps the last controls clear of the floating chat button on phones. */}
      <div aria-hidden className="h-16 @3xl:hidden" />
    </div>
  );
}
