# Ruckus

Real-time party games for 2–12 friends in the browser. Make a room, send the link, play. No sign-up.

| Game | Players | What it is |
| --- | --- | --- |
| Sketch Storm | 2–12 | One draws, everyone races to guess |
| Trivia Rush | 1–12 | Same question for everyone, speed counts (180 fact-checked questions) |
| Letter Rush | 2–12 | One letter, six categories, vote out bad answers |
| Snake Brawl | 2–8 | Real-time snakes, best of three |
| Turf War | 2–8 | Real-time painting; close a loop to capture everything inside |
| Quick Draw | 2–12 | Reaction duel with fake-out signals |
| Odd One Out | 3–12 | Everyone has the same word except one player, who doesn't know it |
| Fib Finder | 3–10 | Write fake answers to strange true facts, then find the truth |
| Mind Meld | 2–12 | Co-op: keep going until everyone types the same word |
| On the Dial | 2–12 | One clue, a hidden target on a scale, everyone drags a live dial (co-op with 2) |
| Dots & Boxes | 2–4 | Draw lines, close boxes |
| Four in a Row | 2 | Classic, best of three |
| Tic-Tac-Toe | 2 | First to three rounds |

## Run it

```bash
npm install
npm run dev          # Next.js on :3000 + PartyKit game server on :1999
```

Open http://localhost:3000, create a room, and open the invite link in another browser (or a private window) to play
against yourself.

**From your phone:** the dev servers listen on your network, so on the same Wi-Fi open `http://<your-PC's-IP>:3000`.
The client connects to the game server on the same hostname automatically (port 1999). On Windows, allow Node through
the firewall if prompted.

## How it works

```
browser ──websocket──▶ PartyKit room (one Durable Object per room code)
                        ├─ players, host, chat, session win tally
                        └─ the active game: GameDef.setup / action / tick / view
```

- **Server-authoritative.** Clients only send intents (`{t:"act", a:{...}}`). The room runs the game's logic and sends
  every connection its own `view()` of the state, so secrets (hidden words, answers, other players' votes) never reach
  the wrong browser.
- **Transient events** (`ctx.emit`) carry high-frequency data such as drawing strokes and live dial positions without
  re-sending the whole state. Real-time games (Snake Brawl, Turf War) tick about 8 times a second and the browser
  interpolates between ticks, so motion is smooth at the display's refresh rate on roughly 5–11 KB/s per player.
- **Spectators.** Anyone who joins mid-game watches; games can accept read-only requests from spectators through the
  optional `spectatorAction` hook (Sketch Storm uses it to send the drawing so far).
- **Lazy game code.** Each game's UI is its own chunk, so a room only downloads the game being played.
- **Identity.** Each browser stores a random player id plus a secret key in `localStorage`. The key proves a socket owns
  that id, so refreshing or reconnecting keeps your seat, and nobody can hijack someone else's player.
- **Host** is the first player; if the host is gone for 8 s another player takes over. Disconnected players keep their
  spot in a running game and are removed from the lobby after 60 s.
- **Limits:** 12 players per room, per-connection message rate limits, chat throttling. Rooms live in memory and reset
  once everyone has been gone for 30 s.

## Project layout

```
app/                     Next.js pages: landing (/), room (/r/CODE), dev simulator (/dev/<game>)
components/room/         Lobby, game stage, players, chat
components/game-ui.tsx   Shared UI for games (PlayerChip, TimerBar, Scoreboard…)
party/server.ts          The PartyKit room server
shared/                  Protocol types, the GameDef interface, test helpers
games/<id>/              One folder per game: server.ts, client.tsx, <id>.test.ts, data.ts
games/catalog.ts         Names, rules text, player limits
games/*-registry.ts(x)   Wiring for server, client and simulator
scripts/                 Checks and end-to-end tests
```

## Adding a game

1. Create `games/<id>/server.ts` exporting a `GameDef` (see `shared/game.ts`; `games/tictactoe` is the smallest
   example). Validate every action, keep secrets out of `view()`, call `ctx.end()` once.
2. Create `games/<id>/client.tsx` (a React component receiving `GameClientProps`). Import only *types* from `./server`.
3. Add tests in `games/<id>/<id>.test.ts` using `shared/testing.ts`.
4. Register it in `games/catalog.ts`, `games/server-registry.ts`, `games/client-registry.tsx` and `games/sim-registry.ts`.
5. Try it in the simulator at http://localhost:3000/dev/<id>: every player's screen side by side, with time warp and
   disconnect toggles.

## Checks

| Command | What it does |
| --- | --- |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint over everything |
| `npm test` | Every game's unit tests |
| `node scripts/check-game.mjs <id>` | Typecheck + lint + tests for one game |
| `node scripts/e2e-room.mjs` | Real server: join, play a match, impostor rejection, reconnect |
| `npm run e2e` | Real server: every game gets fuzzed with hostile actions, a reconnect and a liveness check, plus bandwidth numbers |
| `node scripts/browser-smoke.mjs` | Real browsers (desktop, phone, tablet) start every game through the UI and screenshot it |
| `node scripts/sim-shot.mjs <id> --steps file.json` | Script the simulator and screenshot each step |

The e2e and browser scripts need `npm run dev` running. Browser scripts use the installed Microsoft Edge.

## Deploy

1. **Game server:** `npx partykit login`, then `npm run deploy:party`. It prints a host like
   `ruckus.<your-username>.partykit.dev`.
2. **Website:** deploy the Next.js app (e.g. Vercel) with the environment variable
   `NEXT_PUBLIC_PARTYKIT_HOST=ruckus.<your-username>.partykit.dev`. On another host, also set `NEXT_PUBLIC_SITE_URL`
   to the site's public URL so shared links show the preview image (see `.env.example`).

The website itself never needs a WebSocket server, so it runs on any static/serverless host.
