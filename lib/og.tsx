// Link-preview images (WhatsApp, Instagram, Discord, iMessage…), drawn with next/og.
// Server only: reads the brand fonts from assets/fonts and renders Rux and game glyphs to SVG.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isValidElement, type ReactNode } from "react";
import type { GameMeta } from "@/games/catalog";
import { GameGlyph } from "@/components/game-icons";
import { Rux, type RuxMood } from "@/components/Rux";

export const OG_SIZE = { width: 1200, height: 630 };
const INK = "#14101f";
const PAPER = "#fff8e7";

export async function ogFonts() {
  const [hero, marker] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/Bricolage-ExtraBold-Latin.ttf")),
    readFile(join(process.cwd(), "assets/fonts/CaveatBrush-Latin.ttf")),
  ]);
  return [
    { name: "Hero", data: hero, weight: 800 as const, style: "normal" as const },
    { name: "Marker", data: marker, weight: 400 as const, style: "normal" as const },
  ];
}

/**
 * A tiny React-to-SVG-string serializer for our own static icons (Rux, lucide glyphs): plain
 * elements, function components and forwardRef components, no hooks. Next doesn't allow
 * react-dom/server in image routes, and these are simple enough not to need it.
 */
const ATTR: Record<string, string> = { className: "class", strokeWidth: "stroke-width", strokeLinecap: "stroke-linecap", strokeLinejoin: "stroke-linejoin", fillOpacity: "fill-opacity", strokeDasharray: "stroke-dasharray" };
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function toMarkup(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return esc(String(node));
  if (Array.isArray(node)) return node.map(toMarkup).join("");
  if (!isValidElement(node)) return "";
  const type = node.type as unknown;
  const props = (node.props ?? {}) as Record<string, unknown>;
  // A lucide icon's inner <Icon> (browser-only in route handlers): draw its shape data directly.
  const iconNode = (props.icon as { node?: [string, Record<string, unknown>][] } | undefined)?.node;
  if (Array.isArray(iconNode)) {
    const sw = esc(String(props.strokeWidth ?? 2));
    const inner = iconNode
      .map(([tag, a]) => `<${tag}${Object.entries(a).filter(([k]) => k !== "key").map(([k, v]) => ` ${k}="${esc(String(v))}"`).join("")}/>`)
      .join("");
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  }
  if (typeof type === "function") return toMarkup((type as (p: unknown) => ReactNode)(props));
  if (type && typeof type === "object" && "render" in type) return toMarkup((type as { render: (p: unknown, r: null) => ReactNode }).render(props, null));
  if (typeof type === "symbol") return toMarkup(props.children as ReactNode); // fragments
  if (typeof type !== "string") return "";
  const attrs = Object.entries(props)
    .filter(([k, v]) => k !== "children" && v != null && v !== false && typeof v !== "function" && typeof v !== "object")
    .map(([k, v]) => ` ${ATTR[k] ?? (k.startsWith("aria") ? k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()) : k)}="${esc(String(v))}"`)
    .join("");
  return `<${type}${attrs}>${toMarkup(props.children as ReactNode)}</${type}>`;
}
const renderToStaticMarkup = (node: ReactNode) => toMarkup(node);

const svgUri = (markup: string) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(markup.includes("xmlns=") ? markup : markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"'));

function ruxUri(mood: RuxMood, megaphone = false) {
  return svgUri(renderToStaticMarkup(<Rux mood={mood} megaphone={megaphone} />));
}

function glyphUri(id: string, color: string) {
  return svgUri(
    renderToStaticMarkup(<GameGlyph id={id} />)
      .replace(/(stroke|fill)="currentColor"/g, `$1="${color}"`)
      .replace("<svg ", '<svg width="24" height="24" '),
  );
}

/** Dark wall with the site's colour blobs. */
const WALL = {
  backgroundColor: "#05060a",
  backgroundImage:
    "radial-gradient(520px 420px at 8% 0%, rgba(198,244,50,0.22), transparent 70%), radial-gradient(520px 460px at 100% 20%, rgba(255,79,163,0.2), transparent 70%), radial-gradient(600px 400px at 40% 120%, rgba(79,123,255,0.22), transparent 70%)",
};

/** The home page preview: "Cause a ruckus." with Rux on his megaphone. */
export function HomeCard({ games }: { games: number }) {
  return (
    <div style={{ ...WALL, width: "100%", height: "100%", display: "flex", alignItems: "center", padding: "0 80px", color: "#edf0f7" }}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ fontFamily: "Marker", fontSize: 44, color: "#c6f432", transform: "rotate(-3deg)" }}>
          {`${games} games. zero sign-ups. full bawaal.`}
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontFamily: "Hero", fontSize: 128, lineHeight: 0.9, letterSpacing: -5, marginTop: 18 }}>
          <span>Cause a</span>
          <span style={{ color: "#c6f432" }}>ruckus.</span>
        </div>
        <div style={{ fontSize: 32, color: "#8a91a7", marginTop: 28 }}>Party games in your browser. No app, no login.</div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img */}
      <img src={ruxUri("shout", true)} width={420} height={392} style={{ transform: "rotate(-6deg)" }} alt="" />
    </div>
  );
}

/** A game as a poster: name huge, glyph cropped off the edge, a stamp and a line on top. */
export function GameCard({ game, kicker, footer }: { game: GameMeta; kicker: string; footer: string }) {
  const players = game.minPlayers === game.maxPlayers ? `${game.minPlayers}P` : `${game.minPlayers}–${game.maxPlayers}P`;
  return (
    <div style={{ ...WALL, width: "100%", height: "100%", display: "flex", padding: 48 }}>
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          backgroundColor: game.accent,
          border: `8px solid ${PAPER}`,
          borderRadius: 40,
          padding: "48px 56px",
          color: INK,
          boxShadow: "14px 16px 0 rgba(0,0,0,0.55)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img */}
        <img src={glyphUri(game.id, INK)} width={440} height={440} style={{ position: "absolute", right: -70, bottom: -90, transform: "rotate(-12deg)", opacity: 0.9 }} alt="" />
        <div style={{ fontFamily: "Marker", fontSize: 50, transform: "rotate(-2deg)" }}>{kicker}</div>
        <div style={{ fontFamily: "Hero", fontSize: 112, lineHeight: 0.9, letterSpacing: -4, marginTop: 10, maxWidth: 760 }}>{game.name}</div>
        <div style={{ fontSize: 34, marginTop: 18, maxWidth: 680, fontWeight: 600 }}>{game.tagline}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: "auto" }}>
          <div style={{ display: "flex", padding: "6px 18px", border: `4px solid ${INK}`, borderRadius: 14, backgroundColor: PAPER, fontSize: 28, fontWeight: 700, letterSpacing: 2 }}>
            {players}
          </div>
          <div style={{ fontSize: 30, fontWeight: 700 }}>{footer}</div>
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img */}
      <img src={ruxUri("grin")} width={150} height={178} style={{ position: "absolute", right: 30, top: 4, transform: "rotate(12deg)" }} alt="" />
    </div>
  );
}
