"use client";

// Dev-only "hot seat" simulator: runs a game's server logic in the browser with
// fake players and renders every player's screen side by side. Lets you (and
// scripts) exercise a game without PartyKit or multiple devices.
//
// Scripting hook (for Playwright etc.), available once loaded:
//   window.__sim.act(0, {...})      act as player p0 (or pass "p0")
//   window.__sim.warp(5000)         jump the clock forward 5s and tick once
//   window.__sim.state() / view(0)  inspect state / a player's view
//   window.__sim.result()           GameResult once ctx.end was called
//   window.__sim.setConnected(1, false)  simulate a disconnect
//   window.__sim.restart(4)         new game with 4 players

import { Component, useEffect, useReducer, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CATALOG, CATALOG_BY_ID } from "@/games/catalog";
import { SIM_LOADERS } from "@/games/sim-registry";
import type { GameDef } from "@/shared/game";
import type { Player } from "@/shared/types";
import { SimEngine, SPECTATOR, type AnyClient } from "./sim-engine";

export function Simulator({ gameId, initialPlayers }: { gameId: string; initialPlayers: number }) {
  const meta = CATALOG_BY_ID[gameId];
  const router = useRouter();
  const [loaded, setLoaded] = useState<{ def: GameDef; Client: AnyClient } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [engine, setEngine] = useState<SimEngine | null>(null);
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  const [width, setWidth] = useState(420);
  const [focus, setFocus] = useState<string | null>(null); // null = everyone side by side

  useEffect(() => {
    let cancelled = false;
    const loader = SIM_LOADERS[gameId];
    if (!loader) return;
    loader()
      .then(([s, c]) => {
        if (cancelled) return;
        setLoaded({ def: s.default, Client: c.default });
        setEngine(new SimEngine(s.default, c.default, initialPlayers, bump));
      })
      .catch((e) => !cancelled && setLoadError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [gameId, initialPlayers]);

  // Drive tick() like the room server does.
  useEffect(() => {
    engine?.start();
    return () => engine?.stop();
  }, [engine]);

  const restart = (n: number) => {
    if (loaded) setEngine(new SimEngine(loaded.def, loaded.Client, n, bump));
  };

  // Expose the scripting hook.
  useEffect(() => {
    if (!engine) return;
    const idOf = (who: number | string) => (typeof who === "number" ? `p${who}` : who);
    (window as unknown as { __sim: unknown }).__sim = {
      players: engine.players.map((p) => p.id),
      act: (who: number | string, a: unknown) => engine.act(idOf(who), a),
      warp: (ms: number) => engine.warp(ms),
      state: () => engine.snapshot(),
      view: (who: number | string) => engine.view(idOf(who)).view,
      result: () => engine.result,
      setConnected: (who: number | string, c: boolean) => engine.setConnected(idOf(who), c),
      restart: (n: number) => restart(n),
    };
  });

  if (!meta) return <p className="p-6">Unknown game “{gameId}”.</p>;

  const byId: Record<string, Player> = { [SPECTATOR.id]: SPECTATOR };
  for (const p of engine?.players ?? []) byId[p.id] = p;
  const viewers = engine ? [...engine.players, SPECTATOR] : [];
  const shown = focus ? viewers.filter((v) => v.id === focus) : viewers;
  const count = engine?.players.length ?? initialPlayers;

  return (
    <div className="mx-auto w-full px-3 py-4 sm:px-5" data-sim-version={version} data-sim-ready={engine ? "1" : "0"}>
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3 text-sm">
        <span className="font-display text-lg font-bold">
          {meta.emoji} {meta.name} <span className="font-sans text-xs font-normal text-muted">simulator</span>
        </span>
        <select
          aria-label="Game"
          className="input w-auto py-1"
          value={gameId}
          onChange={(e) => router.push(`/dev/${e.target.value}?n=${count}`)}
        >
          {CATALOG.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5">
          Players
          <select aria-label="Players" className="input w-auto py-1" value={count} onChange={(e) => restart(Number(e.target.value))}>
            {Array.from({ length: meta.maxPlayers - meta.minPlayers + 1 }, (_, i) => meta.minPlayers + i).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Frame
          <select aria-label="Frame width" className="input w-auto py-1" value={width} onChange={(e) => setWidth(Number(e.target.value))}>
            {[360, 420, 560, 800, 1100].map((w) => (
              <option key={w} value={w}>
                {w}px
              </option>
            ))}
          </select>
        </label>
        <select aria-label="Show" className="input w-auto py-1" value={focus ?? ""} onChange={(e) => setFocus(e.target.value || null)}>
          <option value="">Everyone</option>
          {viewers.map((v) => (
            <option key={v.id} value={v.id}>
              Only {v.name}
            </option>
          ))}
        </select>
        <button className="btn px-3 py-1" onClick={() => restart(count)}>
          Restart
        </button>
        <button className="btn px-3 py-1" onClick={() => engine?.warp(5000)}>
          +5s
        </button>
        <button className="btn px-3 py-1" onClick={() => engine?.warp(30000)}>
          +30s
        </button>
        {engine?.result && (
          <span className="rounded-lg bg-brand/15 px-2 py-1 font-semibold text-brand" data-sim-result>
            🏆 {engine.result.headline}
          </span>
        )}
      </div>

      {loadError && <pre className="card mb-4 overflow-auto p-3 text-xs text-red-300">{loadError}</pre>}
      {engine?.error && <pre className="card mb-4 overflow-auto p-3 text-xs text-red-300">{engine.error}</pre>}

      <div className="flex flex-wrap items-start gap-4">
        {engine &&
          !engine.error &&
          shown.map((v) => {
            const isPlayer = v.id !== SPECTATOR.id;
            const { view, error } = engine.view(v.id);
            const Client = engine.Client;
            const h = engine.handles[v.id];
            return (
              <div key={`${engine.id}:${v.id}`} data-viewer={v.id} className="card flex max-w-full shrink-0 flex-col gap-2 p-2" style={{ width }}>
                <div className="flex items-center justify-between gap-2 px-1 text-xs">
                  <span className="font-semibold" style={{ color: v.color }}>
                    {v.avatar} {v.name} <span className="text-muted">({v.id})</span>
                  </span>
                  {isPlayer && (
                    <button
                      className="rounded-md bg-panel-2 px-2 py-0.5 text-muted hover:text-text"
                      onClick={() => engine.setConnected(v.id, !v.connected)}
                    >
                      {v.connected ? "● online" : "○ offline"}
                    </button>
                  )}
                </div>
                <div className={`min-h-[480px] rounded-xl bg-ink p-2 ${isPlayer && !v.connected ? "opacity-40" : ""}`}>
                  {error ? (
                    <pre className="text-xs text-red-300">view() threw: {error}</pre>
                  ) : (
                    <FrameBoundary>
                      <Client
                        view={view}
                        me={v.id}
                        players={engine.players}
                        byId={byId}
                        isPlayer={isPlayer}
                        isHost={v.id === "p0"}
                        act={h.act}
                        serverNow={h.serverNow}
                        onEvent={h.onEvent}
                        accent={meta.accent}
                      />
                    </FrameBoundary>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

class FrameBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <pre className="text-xs whitespace-pre-wrap text-red-300" data-sim-crash>
          Client crashed: {String(this.state.error?.stack ?? this.state.error)}
        </pre>
      );
    }
    return this.props.children;
  }
}
