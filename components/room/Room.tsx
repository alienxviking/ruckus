"use client";

import { MessageSquare, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { preloadGame } from "@/games/client-registry";
import type { Identity } from "@/lib/identity";
import { useRoom, type PingStore } from "@/lib/useRoom";
import type { Player } from "@/shared/types";
import { Logo } from "../Logo";
import { Chat } from "./Chat";
import { GameStage } from "./GameStage";
import { Lobby } from "./Lobby";
import { PlayerList } from "./PlayerList";
import type { ProfileValues } from "./ProfileForm";
import { InviteButton } from "./InviteButton";
import { SoundToggle, useRoomFeedback } from "./RoomFeedback";
import { Avatar } from "@/components/Avatar";
import { ACCESSORY_LABEL } from "@/lib/avatar-art";
import type { AccessoryId } from "@/shared/types";

// The animated profile dialog is fetched on first hover/focus of the profile button.
const loadProfileDialog = () => import("./ProfileDialog");
const ProfileDialog = dynamic(loadProfileDialog, { ssr: false });

export function Room({
  code,
  identity,
  onIdentity,
}: {
  code: string;
  identity: Identity;
  onIdentity: (v: ProfileValues) => void;
}) {
  const r = useRoom(code, identity);
  const [editing, setEditing] = useState(false);
  // Mounted from the first open on, so the dialog can animate out as well as in.
  const [dialogMounted, setDialogMounted] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Last chat line seen with the drawer open/closed, for the phone's unread dot.
  const [seenChat, setSeenChat] = useState<string | undefined>(undefined);

  const byId = useMemo(() => {
    const map: Record<string, Player> = {};
    for (const p of r.room?.players ?? []) map[p.id] = p;
    return map;
  }, [r.room?.players]);

  const room = r.room;
  const isHost = room?.hostId === r.me;
  const gameId = room?.gameId;
  // Unread = a message from another player (not system lines) since the drawer was last toggled.
  const chat = room?.chat ?? [];
  let lastFromOthers: string | undefined;
  for (let i = chat.length - 1; i >= 0; i--) {
    if (chat[i].from && chat[i].from !== r.me) {
      lastFromOthers = chat[i].id;
      break;
    }
  }
  const unread = !chatOpen && lastFromOthers !== undefined && lastFromOthers !== seenChat;
  const toggleChat = () => {
    setSeenChat(lastFromOthers);
    setChatOpen((v) => !v);
  };
  const playing = room?.phase === "playing";

  const { unlocked, dismissUnlocked } = useRoomFeedback(room, r.me, r.serverNow);
  const openProfile = () => {
    setDialogMounted(true);
    setEditing(true);
  };

  // Fetch the picked game's code while everyone is still in the lobby, so Start is instant.
  useEffect(() => {
    if (gameId) preloadGame(gameId);
  }, [gameId]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-3 sm:px-5">
      <header className="flex items-center justify-between gap-3 py-3">
        <Logo small />
        <div className="flex items-center gap-2">
          <ConnDot status={r.status} ping={r.ping} />
          <InviteButton code={code} />
          <SoundToggle />
          <button
            className="btn px-2.5 py-1.5"
            onPointerEnter={loadProfileDialog}
            onFocus={loadProfileDialog}
            onClick={() => {
              setDialogMounted(true);
              setEditing(true);
            }}
            aria-label="Edit your name and look"
            title="Edit profile"
          >
            <span aria-hidden><Avatar id={identity.avatar} /></span>
            <span className="hidden max-w-24 truncate text-sm sm:inline" style={{ color: identity.color }}>
              {identity.name}
            </span>
          </button>
        </div>
      </header>

      {r.error && (
        <div role="alert" className="card animate-rise mb-3 border-brand/60 px-4 py-2 text-sm">
          {r.error}
        </div>
      )}

      {room && !r.rejected && r.status !== "open" && <ReconnectBanner playing={playing} />}
      {unlocked.length > 0 && (
        <UnlockToast
          avatar={identity.avatar}
          items={unlocked}
          onWear={() => {
            dismissUnlocked();
            openProfile();
          }}
          onClose={dismissUnlocked}
        />
      )}

      {r.rejected ? (
        <div className="grid flex-1 place-items-center px-4">
          <div className="card lit-edge animate-pop max-w-sm p-6 text-center" role="alert" style={{ "--accent": "var(--color-brand)" } as React.CSSProperties}>
            <p className="label text-brand">Access denied</p>
            <p className="mt-2 font-display text-xl font-bold">Can&apos;t join this room</p>
            <p className="mt-1 text-muted">{r.rejected}</p>
            <Link className="btn btn-primary mt-5" href="/">
              Back to start
            </Link>
          </div>
        </div>
      ) : !room ? (
        <div className="grid flex-1 place-items-center text-muted" role="status">
          <div className="flex flex-col items-center gap-3">
            <span
              aria-hidden
              className="size-8 rounded-full border-2 border-line border-t-brand-2 motion-safe:animate-[spin_0.8s_linear_infinite]"
            />
            <span className="font-mono text-xs tracking-wide">
              {r.status === "closed" ? "Can't reach the game server. Retrying…" : "Joining the room…"}
            </span>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 gap-4 pb-24 lg:pb-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-w-0">
            {room.phase === "lobby" ? (
              <Lobby room={room} isHost={isHost} send={r.send} words={r.words} byId={byId} />
            ) : (
              <div className="animate-rise">
                <GameStage
                  room={room}
                  view={r.view}
                  me={r.me}
                  isHost={isHost}
                  byId={byId}
                  r={r}
                  headerExtra={
                    // On phones the chat toggle lives here during a game, so nothing floats over game controls.
                    <button
                      className="btn relative px-3 py-1.5 text-sm lg:hidden"
                      onClick={toggleChat}
                      aria-expanded={chatOpen}
                      aria-label={chatOpen ? "Close chat" : unread ? "Chat (new messages)" : "Chat"}
                    >
                      <MessageSquare aria-hidden className="size-4" strokeWidth={2} />
                      {unread && (
                        <span aria-hidden className="absolute -top-1 -right-1 size-2.5 rounded-full bg-brand ring-2 ring-ink" />
                      )}
                    </button>
                  }
                />
              </div>
            )}
          </section>

          <aside className="flex min-w-0 flex-col gap-4">
            <PlayerList room={room} me={r.me} isHost={isHost} send={r.send} />
            <div className="hidden lg:block">
              <Chat room={room} byId={byId} me={r.me} send={r.send} />
            </div>
          </aside>
        </div>
      )}

      {/* Mobile chat drawer */}
      {room && (
        <div className="lg:hidden">
          {/* In the lobby the chat button floats; during a game it sits in the game header instead. */}
          {!playing && (
            <button
              className="btn btn-primary fixed right-4 bottom-4 z-30 rounded-full shadow-lg shadow-black/40"
              onClick={toggleChat}
              aria-expanded={chatOpen}
            >
              {chatOpen ? <X aria-hidden className="size-4" strokeWidth={2.25} /> : <MessageSquare aria-hidden className="size-4" strokeWidth={2.25} />}
              {chatOpen ? "Close" : "Chat"}
              {unread && <span aria-hidden className="ml-1 size-2 rounded-full bg-ink" />}
            </button>
          )}
          {chatOpen && (
            <div className={`fixed inset-x-3 z-30 animate-rise ${playing ? "bottom-3" : "bottom-18"}`}>
              <div className="relative">
                <Chat room={room} byId={byId} me={r.me} send={r.send} compact />
                {playing && (
                  <button
                    className="btn absolute top-2 right-2 px-2.5 py-1 text-xs"
                    onClick={toggleChat}
                    aria-label="Close chat"
                  >
                    <X aria-hidden className="size-3.5" strokeWidth={2.25} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {dialogMounted && (
        <ProfileDialog
          open={editing}
          onOpenChange={setEditing}
          initial={identity}
          onSave={(v) => {
            onIdentity(v);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

const noPing = () => null;

/** "You unlocked a crown!" after a win, with a shortcut to the profile to wear it. */
function UnlockToast({
  avatar,
  items,
  onWear,
  onClose,
}: {
  avatar: string;
  items: AccessoryId[];
  onWear: () => void;
  onClose: () => void;
}) {
  const base = avatar.split("+")[0];
  const first = items[0];
  return (
    <div className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-3 lg:bottom-6">
      <div
        role="status"
        className="animate-pop lit-edge flex items-center gap-3 rounded-2xl border border-brand-2/50 bg-panel/95 py-2.5 pr-2.5 pl-3 shadow-[0_20px_50px_-20px_var(--color-brand-2)] backdrop-blur-md"
      >
        <span className="animate-trophy grid size-12 place-items-center rounded-xl bg-brand-2/15">
          <Avatar id={`${base}+${first}`} size={40} />
        </span>
        <span className="min-w-0">
          <span className="label text-brand-2">Unlocked</span>
          <span className="block font-display font-bold">{items.map((i) => ACCESSORY_LABEL[i]).join(" + ")}</span>
        </span>
        <button className="btn btn-primary px-3 py-1.5 text-sm" onClick={onWear}>
          Wear it
        </button>
        <button className="btn px-2 py-1.5" aria-label="Dismiss" onClick={onClose}>
          <X aria-hidden className="size-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/**
 * Shown while the socket is down (after a short grace, so blips don't flash it): your seat
 * is kept, so nobody panics and reloads.
 */
function ReconnectBanner({ playing }: { playing: boolean }) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  return (
    <div
      role="status"
      className="reconnect-banner pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-3"
    >
      <div className="flex items-center gap-3 rounded-full border border-yellow-400/40 bg-panel/95 backdrop-blur-md py-2 pr-4 pl-3 text-sm shadow-lg shadow-black/50">
        <span
          aria-hidden
          className="size-4 shrink-0 rounded-full border-2 border-yellow-400/30 border-t-yellow-400 motion-safe:animate-[spin_0.8s_linear_infinite]"
        />
        <span>
          <b>{online ? "Reconnecting…" : "You're offline"}</b>{" "}
          <span className="text-muted">
            {playing ? "You're still in the game." : "You're still in the room."}
            {online ? "" : " Waiting for your connection."}
          </span>
        </span>
      </div>
    </div>
  );
}

function ConnDot({ status, ping }: { status: string; ping: PingStore }) {
  const rtt = useSyncExternalStore(ping.subscribe, ping.get, noPing);
  const open = status === "open";
  // Round trip to the game server: green is great, yellow is fine, orange is laggy.
  const color = !open
    ? status === "connecting"
      ? "bg-yellow-400"
      : "bg-red-500"
    : rtt === null || rtt < 90
      ? "bg-green-400"
      : rtt < 180
        ? "bg-yellow-400"
        : "bg-orange-500";
  const label = open ? "Connected" : status === "connecting" ? "Connecting" : "Reconnecting";
  const detail = open && rtt !== null ? `${rtt} ms` : null;
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted tabular-nums"
      title={detail ? `${label} · ${detail} round trip to the game server` : label}
    >
      <span className={`size-2 rounded-full transition-colors duration-500 ${color} ${!open ? "animate-pulse" : ""}`} />
      <span className="sr-only sm:not-sr-only">{detail ?? label}</span>
    </span>
  );
}
