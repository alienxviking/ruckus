// Sends crashes from players' browsers to our own game server (POST /errors), so broken games
// show up on the private /stats page. Nothing personal is sent: no names, chat, room codes,
// IDs or full user agents; just the message, where in the code, which game and the browser.
import { partyHost } from "./identity";

const MAX_PER_PAGE = 5;
let sent = 0;
const seen = new Set<string>();
let currentGame = "";

/** The game on screen right now (included with reports). */
export function setReportGame(id: string | null) {
  currentGame = id ?? "";
}

function browser(): string {
  const ua = navigator.userAgent;
  const name = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Other";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${name}${os ? ` · ${os}` : ""}`;
}

/** Strip origins and query strings from a stack, and keep the first few frames. */
function cleanStack(stack: string | undefined): string {
  if (!stack) return "";
  return stack
    .split("\n")
    .slice(0, 6)
    .map((l) => l.replace(/https?:\/\/[^/\s)]+/g, "").replace(/\?[^\s):]*/g, "").trim())
    .join("\n")
    .slice(0, 800);
}

/** Where on the site, with room codes taken out. */
function where(): string {
  return window.location.pathname.replace(/^\/r\/[^/]+/, "/r/:code").slice(0, 80);
}

export function reportError(err: unknown, extra?: { game?: string }) {
  if (typeof window === "undefined" || process.env.NODE_ENV !== "production") return;
  if (sent >= MAX_PER_PAGE) return;
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Unknown error");
  const msg = (e.message || String(e)).slice(0, 300);
  // Noise from extensions, old cached tabs and network blips isn't worth reporting.
  if (/ResizeObserver loop|Script error\.?$|Loading chunk|ChunkLoadError|Failed to fetch|NetworkError|Load failed/i.test(msg)) return;
  const key = `${msg}|${extra?.game ?? currentGame}`;
  if (seen.has(key)) return;
  seen.add(key);
  sent++;
  const host = partyHost();
  const local = host.startsWith("localhost") || host.startsWith("127.");
  const body = JSON.stringify({ msg, stack: cleanStack(e.stack), where: where(), game: extra?.game ?? currentGame, browser: browser() });
  void fetch(`${local ? "http" : "https"}://${host}/errors`, {
    method: "POST",
    // text/plain keeps it a "simple" request: no CORS preflight (one request, not two).
    headers: { "Content-Type": "text/plain" },
    body,
    keepalive: true,
  }).catch(() => {});
}

let installed = false;
/** Catch uncaught errors and rejected promises everywhere on the page. */
export function installErrorReporting() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => reportError(ev.error ?? ev.message));
  window.addEventListener("unhandledrejection", (ev) => reportError(ev.reason));
}
