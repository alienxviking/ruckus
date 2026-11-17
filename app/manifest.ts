import type { MetadataRoute } from "next";

// Installable app: "Add to Home Screen" opens Ruckus full-screen, without browser chrome.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ruckus: party games with friends",
    short_name: "Ruckus",
    description: "Make a room, share the link, play real-time party games together. No sign-up.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#05060a",
    theme_color: "#05060a",
    categories: ["games", "entertainment", "social"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
