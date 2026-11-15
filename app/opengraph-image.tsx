import { ImageResponse } from "next/og";
import { CATALOG } from "@/games/catalog";

export const alt = "Ruckus: real-time party games with friends";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
          background: "radial-gradient(900px 500px at 0% 0%, #3a1830, #0e0c1d 70%)",
          color: "#f4f1ff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 24,
              background: "linear-gradient(135deg, #ff5d73, #ffb020)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 48,
              fontWeight: 900,
              color: "#0e0c1d",
            }}
          >
            R!
          </div>
          <div style={{ fontSize: 72, fontWeight: 800, letterSpacing: -2 }}>ruckus</div>
        </div>
        <div style={{ marginTop: 40, fontSize: 64, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5 }}>
          Make a room. Send the link.
        </div>
        <div style={{ marginTop: 8, fontSize: 64, fontWeight: 800, color: "#ff8a5b", letterSpacing: -1.5 }}>
          Cause a ruckus.
        </div>
        <div style={{ marginTop: 40, display: "flex", flexWrap: "wrap", gap: 12 }}>
          {CATALOG.slice(0, 9).map((g) => (
            <div
              key={g.id}
              style={{
                display: "flex",
                padding: "8px 18px",
                borderRadius: 999,
                fontSize: 26,
                background: "#211d3a",
                border: `2px solid ${g.accent}`,
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
