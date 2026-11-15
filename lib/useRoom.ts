"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import usePartySocket from "partysocket/react";
import type { ClientMsg, RoomView, ServerMsg } from "@/shared/types";
import { partyHost, type Identity } from "./identity";

export type ConnStatus = "connecting" | "open" | "closed";

/** Local wall clock. Only ever called from socket callbacks and handlers, never during render. */
function localNow(): number {
  return Date.now();
}

function hello(identity: Identity): string {
  const { name, color, avatar, key } = identity;
  return JSON.stringify({ t: "hello", name, color, avatar, key } satisfies ClientMsg);
}

export function useRoom(code: string, identity: Identity) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [view, setView] = useState<unknown>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const offset = useRef<number | null>(null); // serverTime - localTime, smoothed
  const listeners = useRef(new Set<(e: unknown) => void>());
  const identityRef = useRef(identity);

  const socket = usePartySocket({
    host: partyHost(),
    room: code.toLowerCase(),
    id: identity.id,
    onOpen() {
      setStatus("open");
      socket.send(hello(identityRef.current));
    },
    onClose() {
      setStatus("closed");
    },
    onMessage(ev) {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      // Track clock skew so countdowns line up across devices.
      const sample = msg.now - localNow();
      offset.current = offset.current === null ? sample : offset.current * 0.8 + sample * 0.2;

      switch (msg.t) {
        case "room":
          setRoom(msg.room);
          if (msg.room.phase === "lobby") setView(null);
          break;
        case "game":
          setView(msg.view);
          break;
        case "ev":
          for (const fn of listeners.current) fn(msg.e);
          break;
        case "err":
          setError(msg.msg);
          setTimeout(() => setError((cur) => (cur === msg.msg ? null : cur)), 4000);
          break;
        case "rejected":
          // Stop the auto-reconnect loop; the server won't change its mind.
          setRejected(msg.msg);
          socket.close();
          break;
      }
    },
  });

  const send = useCallback(
    (msg: ClientMsg) => {
      socket.send(JSON.stringify(msg));
    },
    [socket],
  );

  // Re-introduce ourselves when the player edits their name/look mid-session.
  useEffect(() => {
    identityRef.current = identity;
    if (socket.readyState === WebSocket.OPEN) socket.send(hello(identity));
  }, [identity, socket]);

  const act = useCallback((a: unknown) => send({ t: "act", a }), [send]);
  const serverNow = useCallback(() => localNow() + (offset.current ?? 0), []);
  const onEvent = useCallback((fn: (e: unknown) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return useMemo(
    () => ({ room, view, status, error, rejected, send, act, serverNow, onEvent, me: identity.id }),
    [room, view, status, error, rejected, send, act, serverNow, onEvent, identity.id],
  );
}
