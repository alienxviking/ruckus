import { ImageResponse } from "next/og";
import { CATALOG } from "@/games/catalog";

export const alt = "Ruckus: real-time party games with friends";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const VOLT = "#c6f432";

// Link preview for shared room links (WhatsApp, Discord, iMessage…).
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 80px",
          backgroundColor: "#05060a",
          backgroundImage:
            "radial-gradient(800px 420px at 0% 0%, rgba(198,244,50,0.16), transparent 70%), radial-gradient(700px 500px at 100% 0%, rgba(76,224,255,0.12), transparent 70%), linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 100% 100%, 56px 56px, 56px 56px",
          color: "#edf0f7",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="88" height="88" viewBox="0 0 40 40">
            <path d="M6 2h22l10 10v22a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" fill={VOLT} />
            <path
              d="M12 30V10h9.5a6 6 0 0 1 0 12H12M20 22l7 8"
              fill="none"
              stroke="#05060a"
              strokeWidth="4.2"
              strokeLinecap="square"
            />
          </svg>
          <div style={{ fontSize: 68, fontWeight: 800, letterSpacing: -2 }}>ruckus</div>
        </div>
        <div style={{ marginTop: 44, fontSize: 64, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5 }}>
          Make a room. Send the link.
        </div>
        <div style={{ marginTop: 8, fontSize: 64, fontWeight: 800, color: VOLT, letterSpacing: -1.5 }}>
          Cause a ruckus.
        </div>
        <div style={{ marginTop: 40, display: "flex", flexWrap: "wrap", gap: 12 }}>
          {CATALOG.slice(0, 8).map((g) => (
            <div
              key={g.id}
              style={{
                display: "flex",
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 24,
                background: "#0b0d13",
                border: `1.5px solid ${g.accent}`,
                color: g.accent,
              }}
            >
              {g.name}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
