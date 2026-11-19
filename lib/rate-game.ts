// 👍/👎 after a game, sent anonymously to our own game server (POST /rate) for the stats page.
import { partyHost } from "./identity";

export function rateGame(gameId: string, v: 1 | -1) {
  send({ game: gameId, v });
}

/** A few words on what went wrong, after a 👎. */
export function sendRatingNote(gameId: string, note: string) {
  send({ game: gameId, note: note.slice(0, 140) });
}

function send(body: object) {
  const host = partyHost();
  const local = host.startsWith("localhost") || host.startsWith("127.");
  void fetch(`${local ? "http" : "https"}://${host}/rate`, {
    method: "POST",
    // text/plain: a "simple" request, so no CORS preflight.
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}
