// 👍/👎 after a game, sent anonymously to our own game server (POST /rate) for the stats page.
import { partyHost } from "./identity";

export function rateGame(gameId: string, v: 1 | -1) {
  const host = partyHost();
  const local = host.startsWith("localhost") || host.startsWith("127.");
  void fetch(`${local ? "http" : "https"}://${host}/rate`, {
    method: "POST",
    // text/plain: a "simple" request, so no CORS preflight.
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ game: gameId, v }),
    keepalive: true,
  }).catch(() => {});
}
