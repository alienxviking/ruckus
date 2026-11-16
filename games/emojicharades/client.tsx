"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { GameClientProps } from "@/shared/client-game";
import { Note } from "@/components/game-ui";
import type { CharadesAction, CharadesView } from "./server";
import type { CharadesEvent } from "./shared";
import { EmojiPicker } from "./picker";
import { Feed, Final, GotItNote, GuessBox, Header, Scores, Stage, TurnResults, isTypingTarget, type Pending } from "./panels";

// Game-local animations (prefixed so they can't clash with the app or other games).
const CSS = `
@keyframes ec-pop { 0% { opacity: 0; transform: scale(.2) rotate(-25deg) } 60% { opacity: 1; transform: scale(1.25) rotate(6deg) } 100% { transform: none } }
.ec-pop { animation: ec-pop .38s cubic-bezier(.2, 1.4, .4, 1) both }
@keyframes ec-blink { 50% { opacity: 0 } }
.ec-caret { animation: ec-blink 1s steps(1) infinite }
.ec-key { transition: transform .08s ease-out, background-color .12s; -webkit-tap-highlight-color: transparent; touch-action: manipulation }
.ec-key:hover { background: var(--color-panel-2) }
.ec-key:active { transform: scale(.82); background: color-mix(in oklab, var(--ec-accent) 30%, transparent) }
.ec-key:focus-visible, .ec-removable:focus-visible { outline: 2px solid var(--ec-accent); outline-offset: -2px }
.ec-removable { transition: transform .1s, background-color .12s; touch-action: manipulation }
.ec-removable:hover { background: rgb(248 113 113 / .18); transform: scale(.94) }
.ec-removable:active { transform: scale(.8) }
.ec-stage { background: radial-gradient(circle at 50% 0%, color-mix(in oklab, var(--ec-accent) 14%, transparent), transparent 65%), var(--color-panel) }
@keyframes ec-float { 0% { opacity: 0; transform: translateY(12px) scale(.8) } 14% { opacity: 1; transform: none } 78% { opacity: 1; transform: none } 100% { opacity: 0; transform: translateY(-16px) } }
.ec-float { animation: ec-float 2.2s ease-out forwards }
@keyframes ec-toast { 0% { opacity: 0; transform: translateY(-8px) } 12% { opacity: 1; transform: none } 80% { opacity: 1; transform: none } 100% { opacity: 0 } }
.ec-toast { animation: ec-toast 2s ease-out forwards }
@keyframes ec-fade { 0% { opacity: 0 } 12% { opacity: 1 } 80% { opacity: 1 } 100% { opacity: 0 } }
@keyframes ec-burst { 0% { opacity: 1; transform: translate(-50%, -50%) scale(.3) } 100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1.15) } }
.ec-burst { animation: ec-burst 1.1s cubic-bezier(.2, .8, .3, 1) both }
@keyframes ec-wiggle { 0%, 100% { transform: rotate(-12deg) } 50% { transform: rotate(12deg) translateY(-3px) } }
.ec-wiggle { display: inline-block; animation: ec-wiggle 1.1s ease-in-out infinite }
@keyframes ec-flip { from { opacity: 0; transform: translateY(8px) rotateX(80deg) } to { opacity: 1; transform: none } }
.ec-flip { display: inline-block; animation: ec-flip .45s cubic-bezier(.2, 1.3, .4, 1) both }
@keyframes ec-crown { from { opacity: 0; transform: translateY(6px) rotate(-30deg) scale(.3) } }
.ec-crown { display: inline-block; animation: ec-crown .6s cubic-bezier(.2, 1.5, .4, 1) .45s both }
@keyframes ec-urgent { 50% { opacity: .5 } }
.ec-urgent { animation: ec-urgent .9s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) {
  .ec-float, .ec-toast { animation-name: ec-fade }
  .ec-burst { display: none }
  .ec-pop, .ec-wiggle, .ec-flip, .ec-urgent, .ec-crown, .ec-caret { animation: none }
}
`;

/** Gap between clue sends while the clue-giver taps away (trailing edge always sent). */
const SEND_GAP_MS = 120;
const PENDING_MS = 1500;

/** Keys 1-3 pick a phrase while choosing. */
function usePickKeys(view: CharadesView | null, act: (a: CharadesAction) => void) {
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

/** Coalesce clue edits: send at most one every SEND_GAP_MS, always ending on the latest. */
function useClueSender(act: (a: CharadesAction) => void) {
  const box = useRef({ at: 0, timer: 0, latest: [] as string[] });
  useEffect(() => {
    const b = box.current;
    return () => window.clearTimeout(b.timer);
  }, []);
  return useCallback(
    (clue: string[]) => {
      const b = box.current;
      b.latest = clue;
      if (b.timer) return;
      const flush = () => {
        b.timer = 0;
        b.at = performance.now();
        act({ type: "clue", emoji: b.latest });
      };
      const wait = b.at + SEND_GAP_MS - performance.now();
      if (wait <= 0) flush();
      else b.timer = window.setTimeout(flush, wait);
    },
    [act],
  );
}

export default function EmojiCharades({ view, me, byId, isPlayer, act, serverNow, onEvent, accent }: GameClientProps<CharadesView, CharadesAction>) {
  const [clueEv, setClueEv] = useState<{ t: number; v: number; e: string[] } | null>(null);
  const [draft, setDraft] = useState<{ t: number; e: string[] } | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const pendingSeq = useRef(0);
  const sendClue = useClueSender(act);
  usePickKeys(view, act);

  useEffect(
    () =>
      onEvent((raw) => {
        const e = raw as CharadesEvent | null;
        if (e && e.k === "close") setPending((p) => p.filter((x) => x.text.trim().toLowerCase() !== String(e.text).toLowerCase()));
        if (!e || e.k !== "clue" || !Array.isArray(e.e)) return;
        setClueEv((cur) => (cur && (cur.t > e.t || (cur.t === e.t && cur.v >= e.v)) ? cur : { t: e.t, v: e.v, e: e.e }));
      }),
    [onEvent],
  );

  const feedTop = view?.feed.length ? view.feed[view.feed.length - 1].n : 0;
  const onSent = useCallback(
    (text: string) => {
      const id = ++pendingSeq.current;
      setPending((p) => [...p.slice(-4), { id, text, after: feedTop }]);
      window.setTimeout(() => setPending((p) => p.filter((x) => x.id !== id)), PENDING_MS);
    },
    [feedTop],
  );

  const vars = { "--ec-accent": accent } as CSSProperties;

  if (!view) {
    return (
      <div className="card grid min-h-60 place-items-center p-6 text-muted" style={vars}>
        Warming up the emoji…
      </div>
    );
  }

  const isGiver = view.role === "giver";
  const editing = isGiver && view.phase === "clue";
  const clue = isGiver
    ? draft && draft.t === view.turn && view.phase === "clue"
      ? draft.e
      : view.clue
    : clueEv && clueEv.t === view.turn && clueEv.v > view.clueRev && view.phase !== "choose"
      ? clueEv.e
      : view.clue;

  const changeClue = (next: string[]) => {
    setDraft({ t: view.turn, e: next });
    sendClue(next);
  };

  // A pending guess settles when my line (or my correct guess) shows up in the feed.
  const shown = pending.filter(
    (p) => !view.feed.some((f) => f.n > p.after && f.by === me && (f.kind === "correct" || (f.kind === "guess" && f.text === p.text))),
  );

  return (
    <div className="@container w-full" style={vars}>
      <style>{CSS}</style>
      {view.phase === "final" ? (
        <Final view={view} byId={byId} me={me} />
      ) : (
        <div className="flex flex-col gap-3">
          <Header view={view} byId={byId} serverNow={serverNow} accent={accent} />
          <div className="grid items-start gap-3 @3xl:grid-cols-[minmax(0,1fr)_16rem]">
            <div className="flex min-w-0 flex-col gap-3">
              <Stage
                view={view}
                byId={byId}
                me={me}
                clue={clue}
                act={act}
                onRemove={editing ? (i) => changeClue(clue.filter((_, j) => j !== i)) : null}
                serverNow={serverNow}
              />
              {editing && <EmojiPicker clue={clue} onChange={changeClue} />}
              {view.phase === "clue" &&
                view.role === "guesser" &&
                (view.guessed ? <GotItNote phrase={view.phrase} /> : <GuessBox act={act} onEvent={onEvent} onSent={onSent} />)}
              {view.phase === "reveal" && <TurnResults view={view} byId={byId} serverNow={serverNow} />}
              {!isPlayer && <Note>👀 You’re watching. Only players in this game can guess.</Note>}
            </div>
            <aside className="flex min-w-0 flex-col gap-3">
              <Feed feed={view.feed} pending={shown} byId={byId} me={me} className="order-1 @3xl:order-2" />
              <Scores view={view} byId={byId} me={me} className="order-2 @3xl:order-1" />
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
