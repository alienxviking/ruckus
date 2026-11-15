"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import usePartySocket from "partysocket/react";
import type { ChatMsg, ClientMsg, RoomView, RoomWire, ServerMsg } from "@/shared/types";
import { partyHost, type Identity } from "./identity";

export type ConnStatus = "connecting" | "open" | "closed";

const CHAT_LIMIT = 80;
/** Pings right after connecting (to sync the clock fast), then one every PING_EVERY_MS. */
const PING_BURST = [0, 250, 600, 1100];
const PING_EVERY_MS = 8_000;
const SAMPLES = 8;
/** Reconnect fast after a blip (jittered so a whole room doesn't reconnect in lockstep). */
const RECONNECT_MIN_MS = 250 + Math.random() * 500;

/** Local wall clock. Only ever called from socket callbacks and handlers, never during render. */
function localNow(): number {
  return Date.now();
}

function hello(identity: Identity): string {
  const { name, color, avatar, key } = identity;
  return JSON.stringify({ t: "hello", name, color, avatar, key } satisfies ClientMsg);
}

/** A tiny external store for the measured round trip, so ping updates re-render only the indicator. */
export interface PingStore {
  subscribe(fn: () => void): () => void;
  get(): number | null;
}

function createPingStore() {
  let rtt: number | null = null;
  const subs = new Set<() => void>();
  const store: PingStore & { set(v: number | null): void } = {
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    get: () => rtt,
    set(v) {
      if (v === rtt) return;
      rtt = v;
      for (const fn of subs) fn();
    },
  };
  return store;
}

/**
 * Clock sync, NTP style: each pong gives offset = server + rtt/2 - local. The sample with the
 * smallest round trip is the most accurate, so that one wins. Every server message also gives a
 * lower bound (the server can't have sent it in our future), which corrects drift between pings.
 */
function createClock() {
  const samples: { rtt: number; offset: number }[] = [];
  let offset: number | null = null;
  return {
    offset: () => offset ?? 0,
    pong(c: number, server: number, now: number): number {
      const rtt = Math.max(0, now - c);
      samples.push({ rtt, offset: server + rtt / 2 - now });
      if (samples.length > SAMPLES) samples.shift();
      let best = samples[0];
      for (const s of samples) if (s.rtt < best.rtt) best = s;
      offset = best.offset;
      return rtt;
    },
    bound(server: number, now: number) {
      const lower = server - now;
      if (offset === null || lower > offset) offset = lower;
    },
    reset() {
      samples.length = 0;
    },
  };
}

export function useRoom(code: string, identity: Identity) {
  const [roomWire, setRoomWire] = useState<RoomWire | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [view, setView] = useState<unknown>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [clock] = useState(createClock);
  const [ping] = useState(createPingStore);
  const listeners = useRef(new Set<(e: unknown) => void>());
  const identityRef = useRef(identity);
  const pingTimers = useRef<number[]>([]);

  const stopPings = () => {
    for (const t of pingTimers.current) window.clearTimeout(t);
    pingTimers.current = [];
  };

  const socket = usePartySocket({
    host: partyHost(),
    room: code.toLowerCase(),
    id: identity.id,
    minReconnectionDelay: RECONNECT_MIN_MS,
    maxReconnectionDelay: 4_000,
    reconnectionDelayGrowFactor: 1.5,
    connectionTimeout: 4_000,
    onOpen() {
      setStatus("open");
      socket.send(hello(identityRef.current));
      // Measure the round trip a few times straight away, then keep it fresh.
      stopPings();
      clock.reset();
      const sendPing = () => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "ping", c: localNow() } satisfies ClientMsg));
      };
      for (const at of PING_BURST) pingTimers.current.push(window.setTimeout(sendPing, at));
      pingTimers.current.push(window.setInterval(sendPing, PING_EVERY_MS));
    },
    onClose() {
      stopPings();
      ping.set(null);
      setStatus("closed");
    },
    onMessage(ev) {
      const now = localNow();
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.t === "pong") {
        ping.set(Math.round(clock.pong(msg.c, msg.now, now)));
        return;
      }
      clock.bound(msg.now, now);

      switch (msg.t) {
        case "room": {
          const { chat: full, ...rest } = msg.room;
          if (full) setChat(full);
          setRoomWire(rest);
          if (msg.room.phase === "lobby") setView(null);
          break;
        }
        case "chat": {
          const line = msg.msg;
          setChat((cur) => (cur.some((m) => m.id === line.id) ? cur : [...cur, line].slice(-CHAT_LIMIT)));
          break;
        }
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

  // Stop pinging when the room unmounts.
  useEffect(() => stopPings, []);

  // Phones drop sockets when the screen locks or the network changes. When the tab comes back
  // (or the network does), reconnect right away instead of waiting for the backoff timer, and
  // probe a socket that looks open so a dead one is noticed quickly.
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "ping", c: localNow() } satisfies ClientMsg));
      else socket.reconnect();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [socket]);

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

  const room = useMemo<RoomView | null>(() => (roomWire ? { ...roomWire, chat } : null), [roomWire, chat]);
  const act = useCallback((a: unknown) => send({ t: "act", a }), [send]);
  const serverNow = useCallback(() => localNow() + clock.offset(), [clock]);
  const onEvent = useCallback((fn: (e: unknown) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return useMemo(
    () => ({ room, view, status, error, rejected, send, act, serverNow, onEvent, me: identity.id, ping: ping as PingStore }),
    [room, view, status, error, rejected, send, act, serverNow, onEvent, identity.id, ping],
  );
}
