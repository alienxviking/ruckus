import type { MetadataRoute } from "next";

// Installable app: "Add to Home Screen" opens Ruckus full screen like a game (Android hides the
// status bar too; swipe down to see it). iPhone treats fullscreen as standalone and draws under
// its status bar instead (statusBarStyle in layout.tsx). The body keeps clear of notches.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ruckus",
    short_name: "Ruckus",
    description: "Make a room, share the link, play real-time party games together. No sign-up.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "any",
    background_color: "#05060a",
    theme_color: "#05060a",
    categories: ["games", "entertainment", "social"],
    icons: [
      { src: "/icons/rux-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/rux-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/rux-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/rux-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
