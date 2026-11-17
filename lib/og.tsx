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

/** The home page preview: "Cause a ruckus." with Rux on his megaphone. Text sits in the middle
 *  square, because WhatsApp and friends crop link thumbnails to a centred square. */
export function HomeCard({ games }: { games: number }) {
  return (
    <div style={{ ...WALL, position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#edf0f7" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img */}
      <img src={ruxUri("shout", true)} width={330} height={308} style={{ position: "absolute", right: -40, bottom: 40, transform: "rotate(-6deg)" }} alt="" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", width: 680 }}>
        <div style={{ fontFamily: "Marker", fontSize: 56, color: "#c6f432", transform: "rotate(-3deg)" }}>{`${games} games. zero sign-ups.`}</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "Hero", fontSize: 150, lineHeight: 0.88, letterSpacing: -6, marginTop: 14 }}>
          <span>Cause a</span>
          <span style={{ color: "#c6f432" }}>ruckus.</span>
        </div>
      </div>
    </div>
  );
}

/** A game as a poster: name huge, glyph cropped off the edge, a stamp and a line on top.
 *  Everything you need to read sits in the middle square: chat apps (WhatsApp, iMessage) crop
 *  link thumbnails to a centred square, while Discord/X show the full width. */
export function GameCard({ game, kicker }: { game: GameMeta; kicker: string }) {
  return (
    <div style={{ ...WALL, width: "100%", height: "100%", display: "flex", padding: 36 }}>
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          backgroundColor: game.accent,
          border: `8px solid ${PAPER}`,
          borderRadius: 40,
          color: INK,
          boxShadow: "14px 16px 0 rgba(0,0,0,0.55)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img */}
        <img src={glyphUri(game.id, INK)} width={360} height={360} style={{ position: "absolute", left: -90, bottom: -80, transform: "rotate(14deg)", opacity: 0.85 }} alt="" />
        {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img */}
        <img src={glyphUri(game.id, INK)} width={300} height={300} style={{ position: "absolute", right: -70, top: -60, transform: "rotate(-12deg)", opacity: 0.35 }} alt="" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 580 }}>
          <div style={{ fontFamily: "Marker", fontSize: 60, transform: "rotate(-2deg)" }}>{kicker}</div>
          <div style={{ fontFamily: "Hero", fontSize: game.name.length > 12 ? 112 : 140, lineHeight: 0.9, letterSpacing: -4, marginTop: 14, textAlign: "center" }}>{game.name}</div>
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img */}
      <img src={ruxUri("grin")} width={150} height={178} style={{ position: "absolute", right: 40, bottom: 30, transform: "rotate(10deg)" }} alt="" />
    </div>
  );
}
